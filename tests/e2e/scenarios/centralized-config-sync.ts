import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { http } from "../lib/http.js";
import { login, signUp } from "../lib/onboarding.js";
import { pollUntil } from "../providers/base.js";
import {
    deepIncludesString,
    disable,
    getStatus,
    init,
    mintTeamKey,
    revokeTeamKeyByName,
    selectRepoByFullName,
    sync,
} from "../lib/centralized-config.js";
import type { RunContext, Scenario } from "../lib/types.js";

// ---------------------------------------------------------------------------
// Centralized Config sync (config-as-code, COMPREHENSIVE).
//
// Exercises nearly the whole centralized-config mechanism end-to-end against a
// real target: mint a team key → select the source repo → status(off) →
// init(manual) → status(on) → sync → assert the source repo's kodus-config.yml
// AND a .kody-rules/review rule actually landed in Kodus's DB → disable →
// status(off). Covers
// apps/api/src/controllers/cli/cli-centralized-config.controller.ts and the
// init/sync use-cases plus the file→DB merge in codeBaseConfig.service.ts.
//
// FULLY ISOLATED: signs up its own throwaway org. Enabling centralized config
// makes a tenant's code-review config read-only and writes org-global config
// from the repo — doing that on a shared review tenant would disturb
// code-review-basic / kody-rules on the same cell. A disposable org keeps the
// blast radius to zero.
//
// REQUIRES A SEEDED SOURCE REPO. Set CENTRALIZED_CONFIG_TEST_REPO=owner/name to
// a repo the GitHub PAT can see that contains, on its DEFAULT branch:
//   - kodus-config.yml at the root with, under ignorePaths, the sentinel glob
//     below (a path that matches nothing real, so it never affects a review).
//   - .kody-rules/review/<anything>.yml whose `title` is the rule title below.
// Without the env var the scenario records `skipped` (not failed), the same way
// the github-app cell skips when GH_APP_TEST_REPO is unset.
// ---------------------------------------------------------------------------

const PASSWORD = "E2eCentralized!2026x";

// Must appear under `ignorePaths` in the source repo's root kodus-config.yml.
// A glob that matches nothing real so a stray sync never changes review output.
const SENTINEL_IGNORE_PATH = "**/__kodus_e2e_centralized_sentinel__/**";

// Must be the `title` of a rule file under .kody-rules/review/ in the source repo.
const SENTINEL_RULE_TITLE = "e2e-centralized-rule";

export const centralizedConfigSync: Scenario = {
    id: "centralized-config-sync",
    title: "Centralized config: init → sync propagates repo config + rules to Kodus",
    priority: "P1",
    appliesTo: {
        target: ["cloud", "self-hosted"],
        provider: ["github"],
        license: ["paid", "license-paid"],
    },
    timeoutSec: 600,
    async run(ctx: RunContext) {
        const sourceRepoFullName = process.env.CENTRALIZED_CONFIG_TEST_REPO;
        if (!sourceRepoFullName) {
            ctx.skip(
                "CENTRALIZED_CONFIG_TEST_REPO is unset — no seeded centralized-config source repo to point init/sync at",
            );
        }

        // Throwaway org → full isolation from shared review tenants.
        const email = `e2e-centralized-${Date.now()}@kodus.local`;
        await signUp(ctx.target, { email, password: PASSWORD });
        const session = await login(ctx.target, { email, password: PASSWORD });

        // Connect the GitHub PAT integration and select the source repo so
        // `init` can resolve it (getSelectedRepository requires it selected).
        await ctx.kodus.registerIntegration(session);
        const sourceRepo = await selectRepoByFullName(
            ctx.target,
            session,
            sourceRepoFullName!,
        );

        const keyName = `e2e-centralized-${ctx.runId.slice(0, 8)}`;
        const teamKey = await mintTeamKey(ctx.target, session, keyName);

        try {
            // 1) Baseline: centralized config off.
            const before = await getStatus(ctx.target, teamKey);
            ctx.assert(
                before.enabled === false,
                `Expected centralized config disabled on a fresh org, got: ${JSON.stringify(before)}`,
            );

            // 2) init(manual): enable + select source repo, NO PR side effect.
            const initRes = await init(
                ctx.target,
                teamKey,
                String(sourceRepo.id),
                "manual",
            );
            ctx.assert(
                initRes.success,
                `init(manual) did not succeed: ${JSON.stringify(initRes)}`,
            );

            // 3) Status now reports enabled + the source repo.
            const afterInit = await getStatus(ctx.target, teamKey);
            ctx.assert(
                afterInit.enabled === true,
                `Expected enabled=true after init, got: ${JSON.stringify(afterInit)}`,
            );
            ctx.assert(
                String(afterInit.repository?.id) === String(sourceRepo.id),
                `Status repository id mismatch after init: ${JSON.stringify(afterInit)} vs ${sourceRepo.id}`,
            );

            // 4) sync: pull config + rules from the repo's default branch.
            const syncRes = await sync(ctx.target, teamKey);
            ctx.assert(
                syncRes.success,
                `sync did not succeed: ${JSON.stringify(syncRes)}`,
            );

            // 5) The root kodus-config.yml landed in the synced code_review_config
            //    param. Poll briefly — the write is awaited server-side but the
            //    read-side cache can lag a beat under load.
            const configSynced = await pollUntil<boolean>(
                async () => {
                    const resp = await http(
                        `${ctx.target.apiBaseUrl}/parameters/find-by-key?key=code_review_config&teamId=${encodeURIComponent(session.teamId)}`,
                        {
                            headers: {
                                Authorization: `Bearer ${session.accessToken}`,
                            },
                            timeoutMs: 20_000,
                        },
                    );
                    return deepIncludesString(resp.body, SENTINEL_IGNORE_PATH)
                        ? true
                        : null;
                },
                { intervalSec: 3, timeoutSec: 45 },
            );
            ctx.assert(
                configSynced,
                `Sentinel ignorePath "${SENTINEL_IGNORE_PATH}" from the source repo's kodus-config.yml did not appear in the synced code_review_config within 45s. The source repo may not carry the sentinel, or the config sync did not write it.`,
            );

            // 6) The .kody-rules/review rule was imported (status SYNCED).
            const ruleSynced = await pollUntil<boolean>(
                async () => {
                    const resp = await http(
                        `${ctx.target.apiBaseUrl}/kody-rules/find-by-organization-id`,
                        {
                            headers: {
                                Authorization: `Bearer ${session.accessToken}`,
                            },
                            timeoutMs: 20_000,
                        },
                    );
                    return deepIncludesString(resp.body, SENTINEL_RULE_TITLE)
                        ? true
                        : null;
                },
                { intervalSec: 3, timeoutSec: 45 },
            );
            ctx.assert(
                ruleSynced,
                `Rule titled "${SENTINEL_RULE_TITLE}" from the source repo's .kody-rules/review/ did not appear in Kodus within 45s of sync. The rules sync half did not land.`,
            );

            writeFileSync(
                join(ctx.artifactDir, "centralized-config.json"),
                JSON.stringify(
                    {
                        sourceRepo: sourceRepo.full_name,
                        init: initRes,
                        sync: syncRes,
                        statusAfterInit: afterInit,
                    },
                    null,
                    2,
                ),
            );

            // 7) disable → back to non-centralized.
            const disableRes = await disable(ctx.target, teamKey);
            ctx.assert(
                disableRes.success,
                `disable did not succeed: ${JSON.stringify(disableRes)}`,
            );
            const afterDisable = await getStatus(ctx.target, teamKey);
            ctx.assert(
                afterDisable.enabled === false,
                `Expected enabled=false after disable, got: ${JSON.stringify(afterDisable)}`,
            );

            return {
                sourceRepo: sourceRepo.full_name,
                initMessage: initRes.message,
                syncMessage: syncRes.message,
                configSynced,
                ruleSynced,
            };
        } finally {
            // Best-effort: leave the throwaway org without the key and with
            // centralized config off, even on an assertion failure.
            try {
                await disable(ctx.target, teamKey);
            } catch {
                /* best effort */
            }
            await revokeTeamKeyByName(ctx.target, session, keyName);
        }
    },
};

export default centralizedConfigSync;
