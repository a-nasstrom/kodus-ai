import * as fs from "fs";
import { join } from "path";

import { http } from "../lib/http.js";
import { login, signUp } from "../lib/onboarding.js";
import type { RunContext, Scenario, TargetContext } from "../lib/types.js";

// ---------------------------------------------------------------------------
// RBAC authorization matrix (full-stack, COMPREHENSIVE).
//
// Replays the committed RBAC manifest
// (apps/api/src/controllers/__tests__/rbac-matrix.manifest.json) against a
// real, provisioned target, exercising the COMPLETE request path:
// JwtAuthGuard → PolicyGuard → PermissionsAbilityFactory + the global layers.
//
// The manifest is the SINGLE SOURCE OF TRUTH: derived from every gated
// controller endpoint's @CheckPolicies and the REAL PermissionsAbilityFactory
// (see rbac-matrix.shared.ts); a jest drift-guard (rbac-matrix.manifest.spec.ts)
// fails CI if a controller's gating changes without regenerating it. So this
// live test and the static grid can never disagree about what the matrix says
// — and here we prove the running API actually enforces it, for EVERY gated
// endpoint, not a hand-picked few.
//
// Tier-gated endpoints (Cockpit, SSO, …) sit behind a SEPARATE guard
// (EnterpriseTierGuard / CockpitTierGuard) that 403s regardless of role when
// the org isn't licensed. We neutralize that by running where the freshly
// signed-up org is on TRIAL (treated as enterprise preview), which unlocks
// those guards. To stay honest if that ever breaks, OWNER is the canary: owner
// has every permission, so an owner 401/403 can only be a non-RBAC guard —
// those endpoints are SKIPPED for RBAC assertion and reported (never silently
// passed). If MOST endpoints are owner-blocked, the org wasn't tier-unlocked
// and the run fails loudly instead of reporting a hollow green.
//
// IDEMPOTENT BY CONSTRUCTION (safe on shared QA, cannot touch other orgs):
//   - GET endpoints are read-only — fired for every role.
//   - Mutations (POST/PUT/PATCH/DELETE) are fired ONLY for roles the manifest
//     marks `deny`, asserting the 403 that PolicyGuard returns BEFORE the
//     handler runs — so no mutation handler ever executes. The allow-side of
//     mutations is proven by the static manifest (rbac-matrix.manifest.spec.ts),
//     never fired live. Net: the scenario performs zero state changes beyond
//     signing up its own throwaway org + inviting its own users.
// ---------------------------------------------------------------------------

const PASSWORD = "E2eRbac!2026x";

type RbacRole = "owner" | "billing_manager" | "repo_admin" | "contributor";
const NON_OWNER_ROLES: RbacRole[] = [
    "billing_manager",
    "repo_admin",
    "contributor",
];

type ManifestEntry = {
    key: string;
    httpMethod: string;
    urlPath: string;
    expected: Record<RbacRole, "allow" | "deny">;
};

// e2e scripts run with cwd = tests/e2e (see package.json), matching the
// process.cwd() convention used across this package (benchmark/, cli/).
const MANIFEST_PATH = join(
    process.cwd(),
    "..",
    "..",
    "apps",
    "api",
    "src",
    "controllers",
    "__tests__",
    "rbac-matrix.manifest.json",
);

function loadManifest(): ManifestEntry[] {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as ManifestEntry[];
}

// Replace `:param` segments with a throwaway value so the request reaches the
// guards. PolicyGuard runs before validation, so a downstream 400/404 on a
// dummy id still reflects "allowed by policy" (not 401/403).
function concreteUrl(urlPath: string): string {
    return urlPath.replace(/:[A-Za-z0-9_]+/g, "1");
}

type RoleSession = { role: RbacRole; accessToken: string };

/**
 * Invite a user with a specific RBAC role into the owner's team, activate it,
 * and return an authenticated session. (Mechanics validated end-to-end against
 * QA on 2026-05-27; see git history of this file.)
 */
async function provisionUserWithRole(
    ctx: RunContext,
    target: TargetContext,
    ownerToken: string,
    teamId: string,
    role: RbacRole,
): Promise<RoleSession> {
    const email = `e2e-rbac-${role}-${Date.now()}@kodus.local`;
    const name = `e2e ${role}`;
    const authed = { Authorization: `Bearer ${ownerToken}` };

    const invite = await http(`${target.apiBaseUrl}/team-members`, {
        method: "POST",
        headers: authed,
        body: {
            teamId,
            members: [
                {
                    email,
                    name,
                    role,
                    teamRole: "team_member",
                    active: true,
                    communicationId: email,
                },
            ],
        },
        timeoutMs: 30_000,
    });
    if (invite.status < 200 || invite.status >= 300) {
        ctx.skip(
            `provisioning: invite ${role} failed (HTTP ${invite.status}): ${invite.raw.slice(0, 250)}`,
        );
    }

    const list = await http<{
        data: { members: Array<{ email: string; userId: string }> };
    }>(`${target.apiBaseUrl}/team-members?teamId=${teamId}`, {
        method: "GET",
        headers: authed,
        timeoutMs: 20_000,
    });
    const userId = list.body?.data?.members?.find((m) => m.email === email)
        ?.userId;
    ctx.assert(
        userId,
        `provisioning: no userId for ${email}. Members: ${list.raw.slice(0, 250)}`,
    );

    const complete = await http(
        `${target.apiBaseUrl}/user/invite/complete-invitation`,
        {
            method: "POST",
            body: { uuid: userId, name, password: PASSWORD },
            timeoutMs: 20_000,
        },
    );
    if (complete.status < 200 || complete.status >= 300) {
        ctx.skip(
            `provisioning: complete-invitation ${role} failed (HTTP ${complete.status}): ${complete.raw.slice(0, 250)}`,
        );
    }

    // The invite lands the user as contributor; set the real RBAC role.
    const patch = await http(`${target.apiBaseUrl}/user/${userId}`, {
        method: "PATCH",
        headers: authed,
        body: { role },
        timeoutMs: 20_000,
    });
    if (patch.status < 200 || patch.status >= 300) {
        ctx.skip(
            `provisioning: set role ${role} failed (HTTP ${patch.status}): ${patch.raw.slice(0, 250)}`,
        );
    }

    const session = await login(target, { email, password: PASSWORD });
    return { role, accessToken: session.accessToken };
}

async function hit(
    target: TargetContext,
    entry: ManifestEntry,
    token: string,
): Promise<number> {
    const method = entry.httpMethod as
        | "GET"
        | "POST"
        | "PUT"
        | "PATCH"
        | "DELETE";
    const res = await http(`${target.apiBaseUrl}${concreteUrl(entry.urlPath)}`, {
        method,
        headers: { Authorization: `Bearer ${token}` },
        // Empty body for mutations: passes the guard, fails validation
        // downstream (no real mutation) — enough to read the policy verdict.
        body: method === "GET" ? undefined : {},
        timeoutMs: 20_000,
    });
    return res.status;
}

export const rbacAuthorization: Scenario = {
    id: "rbac-authorization",
    title: "RBAC: every gated endpoint enforces the manifest verdict per role",
    priority: "P0",
    appliesTo: {
        target: ["cloud", "self-hosted"],
        provider: ["github"], // RBAC is provider-agnostic; one provider suffices
        // Trial (fresh cloud org) and licensed self-hosted both unlock the
        // tier-gated guards so their RBAC is actually exercised here.
        license: ["trial", "paid", "license-paid"],
    },
    timeoutSec: 900,
    async run(ctx: RunContext) {
        const manifest = loadManifest();
        ctx.assert(
            manifest.length > 30,
            `manifest looks empty (${manifest.length}) — regenerate with UPDATE_RBAC_MANIFEST=1`,
        );

        // Fresh, disposable org — the signup creator is OWNER + ACTIVE.
        const ownerEmail = `e2e-rbac-owner-${Date.now()}@kodus.local`;
        await signUp(ctx.target, { email: ownerEmail, password: PASSWORD });
        const owner = await login(ctx.target, {
            email: ownerEmail,
            password: PASSWORD,
        });

        const teamRes = await http<{ data: Array<{ uuid: string }> }>(
            `${ctx.target.apiBaseUrl}/team`,
            {
                method: "GET",
                headers: { Authorization: `Bearer ${owner.accessToken}` },
                timeoutMs: 20_000,
            },
        );
        const teamId = teamRes.body?.data?.[0]?.uuid;
        ctx.assert(
            teamId,
            `could not resolve owner teamId: ${teamRes.raw.slice(0, 200)}`,
        );

        const sessions: RoleSession[] = [
            { role: "owner", accessToken: owner.accessToken },
        ];
        for (const role of NON_OWNER_ROLES) {
            sessions.push(
                await provisionUserWithRole(
                    ctx,
                    ctx.target,
                    owner.accessToken,
                    teamId,
                    role,
                ),
            );
        }
        const tokenOf = (role: RbacRole) =>
            sessions.find((s) => s.role === role)!.accessToken;

        const failures: string[] = [];
        const tierSkipped: string[] = []; // owner-blocked GET => non-RBAC guard
        let asserted = 0; // verdicts checked live
        let mutationAllowDeferred = 0; // allow-side mutations left to the manifest
        let getCount = 0;

        for (const entry of manifest) {
            // IDEMPOTENCY: a mutation only runs its handler when the guard
            // ALLOWS it — that's the only side-effectful path. So for
            // mutations we fire ONLY the roles the manifest marks `deny` and
            // assert 403, which PolicyGuard returns BEFORE the handler (zero
            // side effect, fully idempotent, can't touch any org). The
            // allow-side of mutations is proven by the static manifest
            // (rbac-matrix.manifest.spec.ts) and never fired here.
            if (entry.httpMethod !== "GET") {
                for (const role of NON_OWNER_ROLES) {
                    if (entry.expected[role] !== "deny") {
                        mutationAllowDeferred++;
                        continue;
                    }
                    const status = await hit(ctx.target, entry, tokenOf(role));
                    if (status !== 403) {
                        failures.push(
                            `${role} should be DENIED on ${entry.httpMethod} ${entry.urlPath} (expected 403, got ${status})`,
                        );
                    }
                    asserted++;
                }
                continue;
            }

            // GET is read-only (safe + idempotent). OWNER canary: owner has
            // every permission, so a 401/403 here is a non-RBAC guard
            // (tier/license/feature) — report and skip rather than mis-assert.
            getCount++;
            const ownerStatus = await hit(ctx.target, entry, tokenOf("owner"));
            if (ownerStatus === 401 || ownerStatus === 403) {
                tierSkipped.push(
                    `${entry.httpMethod} ${entry.urlPath} (owner ${ownerStatus})`,
                );
                continue;
            }

            for (const role of NON_OWNER_ROLES) {
                const status = await hit(ctx.target, entry, tokenOf(role));
                const expected = entry.expected[role];
                if (expected === "deny" && status !== 403) {
                    failures.push(
                        `${role} should be DENIED on ${entry.httpMethod} ${entry.urlPath} (expected 403, got ${status})`,
                    );
                } else if (
                    expected === "allow" &&
                    (status === 401 || status === 403)
                ) {
                    failures.push(
                        `${role} should be ALLOWED on ${entry.httpMethod} ${entry.urlPath} (got ${status})`,
                    );
                }
                asserted++;
            }
        }

        // Loud, non-silent reporting of what couldn't be RBAC-tested (tier).
        if (tierSkipped.length) {
            console.log(
                `[rbac] ${tierSkipped.length} GET endpoint(s) skipped — owner blocked by a non-RBAC guard (org not tier-unlocked?):\n  ${tierSkipped.join("\n  ")}`,
            );
        }
        console.log(
            `[rbac] live verdicts asserted: ${asserted} (all GET allow/deny + every mutation deny). Mutation allow-side (${mutationAllowDeferred}) is covered by rbac-matrix.manifest.spec.ts — never fired live, so the run stays idempotent.`,
        );

        ctx.assert(
            failures.length === 0,
            `RBAC mismatches (${failures.length}):\n  ${failures.join("\n  ")}`,
        );

        // If most GETs were owner-blocked, the org wasn't tier-unlocked (not
        // trial/licensed) — tier-gated RBAC was NOT actually validated. Fail
        // loudly rather than report a hollow green.
        ctx.assert(
            getCount > 0 && tierSkipped.length < getCount / 2,
            `Over half the GET endpoints (${tierSkipped.length}/${getCount}) had owner blocked — the test org is not trial/licensed, so tier-gated RBAC was NOT validated. Run against a trial (fresh cloud) or licensed target.`,
        );

        return {
            endpoints: manifest.length,
            cellsAsserted: asserted,
            mutationAllowDeferred,
            tierSkipped: tierSkipped.length,
        };
    },
};

export default rbacAuthorization;
