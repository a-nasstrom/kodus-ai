import type {
    KodusSession,
    Provider,
    ProviderRepoRef,
    TargetContext,
    TenantCredentials,
} from "./types.js";
import { ensureOk, http } from "./http.js";
import { logger } from "./log.js";

const log = logger("onboarding");

interface LoginEnvelope {
    data?: { accessToken?: string };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const segments = jwt.split(".");
    if (segments.length < 2) throw new Error("invalid JWT");
    const padded = segments[1] + "=".repeat((4 - (segments[1].length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    try {
        return JSON.parse(decoded) as Record<string, unknown>;
    } catch (err) {
        throw new Error(`Could not decode JWT payload: ${(err as Error).message}`);
    }
}

// Signs up a fresh Kodus tenant. Used by smoke/matrix runs against
// self-hosted droplets so every (provider × target) cell starts with a
// virgin organization — no leftover integrations, repos, or rules from
// previous cells. Without this, re-running the matrix against the same
// droplet would re-use whichever tenant happened to onboard first, and
// `getTypeIntegration` (which doesn't filter by platform) would route
// dispatches to whatever provider was registered first — silently
// breaking every subsequent provider's webhook auto-register flow.
export async function signUp(
    target: TargetContext,
    creds: { email: string; password: string; name?: string },
): Promise<void> {
    log.info(`Signing up tenant ${creds.email}`);
    // Kodus's API has been spelled both `/auth/signUp` (camelCase) and
    // `/auth/signup` (lowercase) at different versions — try the canonical
    // form first, fall back to the lowercase variant on a 404.
    let resp = await http(`${target.apiBaseUrl}/auth/signUp`, {
        method: "POST",
        body: {
            name: creds.name ?? `e2e-${Date.now()}`,
            email: creds.email,
            password: creds.password,
        },
        timeoutMs: 30_000,
    });
    if (resp.status === 404) {
        resp = await http(`${target.apiBaseUrl}/auth/signup`, {
            method: "POST",
            body: {
                name: creds.name ?? `e2e-${Date.now()}`,
                email: creds.email,
                password: creds.password,
            },
            timeoutMs: 30_000,
        });
    }
    // 409 (or any 4xx that looks like "already exists") is idempotent OK
    // for our purposes — the tenant exists, we'll log in next. Kodus has
    // shipped this as 409 and as 400 with different message shapes at
    // various versions, so match loosely on the response text.
    if (resp.status === 409 || (resp.status === 400 && /already|exists/i.test(resp.raw))) {
        log.info(`Tenant ${creds.email} already exists — reusing`);
        return;
    }
    ensureOk(resp, "onboarding:signUp");
    log.ok(`Tenant ${creds.email} created`);
}

export async function login(
    target: TargetContext,
    creds: TenantCredentials,
): Promise<KodusSession> {
    log.info(`Logging in as ${creds.email} via ${target.apiBaseUrl}`);
    const resp = await http<LoginEnvelope>(
        `${target.apiBaseUrl}/auth/login`,
        {
            method: "POST",
            body: { email: creds.email, password: creds.password },
            timeoutMs: 20_000,
        },
    );
    ensureOk(resp, "onboarding:login");
    const accessToken = resp.body.data?.accessToken;
    if (!accessToken) {
        throw new Error(
            `Login response missing accessToken: ${resp.raw.slice(0, 400)}`,
        );
    }
    const payload = decodeJwtPayload(accessToken);
    const organizationId = String(payload.organizationId ?? "");
    if (!organizationId) {
        throw new Error("JWT payload missing organizationId");
    }
    const teamsResp = await http<{ data: { uuid: string }[] }>(
        `${target.apiBaseUrl}/team/`,
        {
            headers: { Authorization: `Bearer ${accessToken}` },
            timeoutMs: 15_000,
        },
    );
    ensureOk(teamsResp, "onboarding:listTeams");
    const teamId = teamsResp.body.data?.[0]?.uuid;
    if (!teamId) {
        throw new Error("No team found for the logged-in user");
    }
    log.ok(`org=${organizationId} team=${teamId}`);
    return { accessToken, organizationId, teamId };
}

export async function registerIntegration(
    target: TargetContext,
    provider: Provider,
    session: KodusSession,
): Promise<void> {
    log.info(`Registering ${provider.integrationType} integration`);
    const extras = provider.authExtraFields?.() ?? {};
    const resp = await http<{ data: { status?: string } }>(
        `${target.apiBaseUrl}/code-management/auth-integration`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}` },
            body: {
                integrationType: provider.integrationType,
                authMode: provider.authMode(),
                token: provider.authToken(),
                organizationAndTeamData: {
                    organizationId: session.organizationId,
                    teamId: session.teamId,
                },
                ...extras,
            },
            timeoutMs: 30_000,
        },
    );
    ensureOk(resp, "onboarding:registerIntegration");
    if (resp.body.data?.status !== "SUCCESS") {
        throw new Error(
            `auth-integration did not return SUCCESS: ${resp.raw.slice(0, 400)}`,
        );
    }
}

export async function registerRepo(
    target: TargetContext,
    provider: Provider,
    session: KodusSession,
): Promise<ProviderRepoRef> {
    const repoRef = await provider.repoRef();
    log.info(`Looking up ${repoRef.full_name} in available repos`);
    const listResp = await http<{
        data: Array<{
            full_name?: string;
            id: string | number;
            name?: string;
            // Bitbucket-shape: Kodus exposes org via `organizationName`
            // (workspace slug) instead of folding it into full_name.
            organizationName?: string;
        }>;
    }>(
        `${target.apiBaseUrl}/code-management/repositories/org?teamId=${encodeURIComponent(session.teamId)}`,
        {
            headers: { Authorization: `Bearer ${session.accessToken}` },
            timeoutMs: 30_000,
        },
    );
    ensureOk(listResp, "onboarding:listRepos");
    // Each provider Kodus integrates with returns a slightly different
    // repo shape on /repositories/org. Try several fields so we don't
    // have to maintain a per-provider matcher in the test runner:
    //   * github exposes `full_name` ("org/repo")
    //   * bitbucket exposes `organizationName` (workspace slug) + `name`
    //     and we synthesize the same "workspace/repo" form locally
    //   * azure-repos / gitlab also exposes name only — match by id (with
    //     UUID-brace stripping for parity with sanitizeUUID server-side).
    const stripBraces = (id: unknown): string =>
        String(id ?? "").replace(/^\{|\}$/g, "");
    const wantedFullName = repoRef.full_name;
    const wantedId = stripBraces(repoRef.id);
    const found =
        listResp.body.data?.find((r) => r.full_name === wantedFullName) ??
        listResp.body.data?.find(
            (r) =>
                r.organizationName != null &&
                r.name != null &&
                `${r.organizationName}/${r.name}` === wantedFullName,
        ) ??
        listResp.body.data?.find((r) => stripBraces(r.id) === wantedId);
    if (!found) {
        // Keep the response shape in the error so a future provider-shape
        // mismatch is debuggable without re-instrumenting. Truncate to
        // avoid spamming logs on accounts with hundreds of repos.
        throw new Error(
            `Repo ${repoRef.full_name} not in integration's available list. ` +
                `Got ${listResp.body.data?.length ?? 0} entries: ` +
                JSON.stringify(
                    listResp.body.data?.slice(0, 5).map((r) => ({
                        id: r.id,
                        full_name: r.full_name,
                        name: r.name,
                        organizationName: r.organizationName,
                    })),
                ).slice(0, 800),
        );
    }
    const registerResp = await http<{ data: { status: boolean } }>(
        `${target.apiBaseUrl}/code-management/repositories`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}` },
            body: {
                teamId: session.teamId,
                type: "replace",
                repositories: [found],
            },
            timeoutMs: 30_000,
        },
    );
    ensureOk(registerResp, "onboarding:registerRepo");
    if (!registerResp.body.data?.status) {
        throw new Error(
            `Repo registration failed: ${registerResp.raw.slice(0, 400)}`,
        );
    }
    // Normalize back to ProviderRepoRef. `found` may not carry `full_name`
    // (Bitbucket case — Kodus folds workspace + name separately); fall back
    // to the originally-requested form so callers always have a stable
    // "workspace/repo" handle to log against.
    const normalized: ProviderRepoRef = {
        id: found.id,
        name: found.name ?? repoRef.name,
        full_name: found.full_name ?? repoRef.full_name,
    };
    log.ok(`Repo ${normalized.full_name} registered`);
    return normalized;
}

export async function finishOnboarding(
    target: TargetContext,
    session: KodusSession,
    repo: ProviderRepoRef,
): Promise<void> {
    log.info("Finishing onboarding");
    // finish-onboarding does substantial work synchronously: clones the
    // repo to sync kody rules, generates per-repo rules via LLM, and
    // chains a few use-cases. Bitbucket onboarding measured between
    // 2m24s and 3m50s in observed runs (the clone path is meaningfully
    // slower there than on github/gitlab). 360s keeps the smoke from
    // aborting on the slowest seen run while still failing loudly if
    // Kodus hangs forever.
    const resp = await http(
        `${target.apiBaseUrl}/code-management/finish-onboarding`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}` },
            body: {
                teamId: session.teamId,
                reviewPR: false,
                repositoryId: String(repo.id),
                repositoryName: repo.name ?? repo.full_name,
            },
            timeoutMs: 360_000,
        },
    );
    ensureOk(resp, "onboarding:finishOnboarding");
}
