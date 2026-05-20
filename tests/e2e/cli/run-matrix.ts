#!/usr/bin/env -S node --experimental-strip-types
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveScenarios } from "../scenarios/index.js";
import { runMatrix } from "../lib/runner.js";
import { summarize, writeAll } from "../lib/evidence.js";
import { logger } from "../lib/log.js";
import type { MatrixCell, ScenarioResult, Target } from "../lib/types.js";

const log = logger("cli:matrix");

interface MatrixFile {
    id: string;
    description?: string;
    scenarios: string[];
    cells: MatrixCell[];
}

function parseArgs(): {
    matrixPath: string;
    targetFilter?: Target;
    dryRun: boolean;
    skipMissingTokens: boolean;
} {
    const args = process.argv.slice(2);
    const positional: string[] = [];
    const flags: Record<string, string | boolean> = {};
    // Flags that take no value — treat them as booleans even if a positional
    // follows. Without this list the naive lookahead consumes the matrix path
    // as the value of `--skip-missing-tokens`.
    const booleanFlags = new Set(["dry-run", "skip-missing-tokens"]);
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("--")) {
            const key = a.slice(2);
            const next = args[i + 1];
            if (!booleanFlags.has(key) && next && !next.startsWith("--")) {
                flags[key] = next;
                i++;
            } else {
                flags[key] = true;
            }
        } else {
            positional.push(a);
        }
    }
    const matrixPath = (flags.matrix as string) ?? positional[0];
    if (!matrixPath) {
        console.error(
            "usage: run-matrix <matrix.yml> [--target cloud|self-hosted] [--dry-run] [--skip-missing-tokens]",
        );
        process.exit(2);
    }
    return {
        matrixPath: resolve(matrixPath),
        targetFilter: flags.target as Target | undefined,
        dryRun: Boolean(flags["dry-run"]),
        skipMissingTokens: Boolean(flags["skip-missing-tokens"]),
    };
}

// Env vars each provider needs to function. Used by --skip-missing-tokens to
// filter cells locally before any provisioning happens. Keep in sync with
// `requireEnv` calls in tests/e2e/providers/*.ts.
const PROVIDER_REQUIRED_ENV: Record<string, string[]> = {
    github: ["GH_TEST_TOKEN", "GH_TEST_REPO"],
    gitlab: ["GL_TEST_TOKEN", "GL_TEST_REPO"],
    bitbucket: ["BB_TEST_USER", "BB_TEST_APP_PASSWORD", "BB_TEST_REPO"],
    "azure-devops": [
        "AZ_TEST_TOKEN",
        "AZ_TEST_ORG",
        "AZ_TEST_PROJECT",
        "AZ_TEST_REPO",
    ],
};

function missingEnvFor(provider: string): string[] {
    const required = PROVIDER_REQUIRED_ENV[provider] ?? [];
    return required.filter((v) => !process.env[v]);
}

// Some scenarios need extra inputs beyond the provider token — e.g. a license
// JWT on disk. With `--skip-missing-tokens`, we drop the scenario from the run
// instead of letting it fail at runtime. The check runs once per scenario id
// (not per cell), so the message surfaces before we provision anything.
//
// Keep in sync with the file/env reads inside each scenario's run() body.
interface ScenarioRequirement {
    files?: string[]; // absolute paths; presence required
    envOrFiles?: Array<{ env: string; defaultFile: string }>; // satisfied if either present
}

function resolveHome(p: string): string {
    return p.startsWith("~/")
        ? `${process.env.HOME ?? ""}${p.slice(1)}`
        : p;
}

const SCENARIO_REQUIRED: Record<string, ScenarioRequirement> = {
    "per-seat-license-toggle": {
        envOrFiles: [
            {
                env: "SH_LICENSE_KEY_PATH",
                defaultFile: "~/.kodus-dev/license-seats1.jwt",
            },
        ],
    },
};

function missingScenarioRequirements(scenarioId: string): string[] {
    const req = SCENARIO_REQUIRED[scenarioId];
    if (!req) return [];
    const missing: string[] = [];
    for (const f of req.files ?? []) {
        if (!existsSync(resolveHome(f))) missing.push(`file:${f}`);
    }
    for (const { env, defaultFile } of req.envOrFiles ?? []) {
        const envVal = process.env[env];
        const path = envVal ? resolveHome(envVal) : resolveHome(defaultFile);
        if (!existsSync(path)) {
            missing.push(`${env} (or file ${defaultFile})`);
        }
    }
    return missing;
}

async function main() {
    const { matrixPath, targetFilter, dryRun, skipMissingTokens } = parseArgs();
    const raw = readFileSync(matrixPath, "utf8");
    const matrix = parseYaml(raw) as MatrixFile;

    let scenarios = resolveScenarios(matrix.scenarios);
    let cells = targetFilter
        ? matrix.cells.filter((c) => c.target === targetFilter)
        : matrix.cells;

    let preSkipped: Array<{ cell: MatrixCell; missing: string[] }> = [];
    let scenarioSkipped: Array<{ scenarioId: string; missing: string[] }> = [];
    if (skipMissingTokens) {
        const kept: MatrixCell[] = [];
        for (const cell of cells) {
            const missing = missingEnvFor(cell.provider);
            if (missing.length > 0) {
                preSkipped.push({ cell, missing });
            } else {
                kept.push(cell);
            }
        }
        if (preSkipped.length > 0) {
            log.info(
                `Skipping ${preSkipped.length} cells (missing provider tokens — won't fail the run):`,
            );
            for (const { cell, missing } of preSkipped) {
                log.info(
                    `  - ${cell.provider} × ${cell.target} × ${cell.license} (need: ${missing.join(", ")})`,
                );
            }
        }
        const keptScenarios = scenarios.filter((s) => {
            const missing = missingScenarioRequirements(s.id);
            if (missing.length > 0) {
                scenarioSkipped.push({ scenarioId: s.id, missing });
                return false;
            }
            return true;
        });
        if (scenarioSkipped.length > 0) {
            log.info(
                `Skipping ${scenarioSkipped.length} scenario(s) (missing scenario-specific inputs):`,
            );
            for (const { scenarioId, missing } of scenarioSkipped) {
                log.info(`  - ${scenarioId} (need: ${missing.join(", ")})`);
            }
        }
        scenarios = keptScenarios;
        cells = kept;
        if (cells.length === 0) {
            log.err(
                "All cells were skipped due to missing provider tokens. Set at least one provider's env vars and re-run.",
            );
            process.exit(2);
        }
    }

    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
    log.info(`Matrix ${matrix.id} (${cells.length} cells × ${scenarios.length} scenarios) runId=${runId}`);

    const allResults: ScenarioResult[] = [];
    const startedAt = new Date().toISOString();
    const targetsToRun: Target[] = targetFilter
        ? [targetFilter]
        : Array.from(new Set(cells.map((c) => c.target))) as Target[];

    for (const target of targetsToRun) {
        const targetCells = cells.filter((c) => c.target === target);
        if (!targetCells.length) continue;
        log.info(`--- Running ${targetCells.length} cells for target=${target}`);
        const outcome = await runMatrix({
            artifactRoot: `${process.cwd()}/evidence`,
            runId,
            target,
            cells: targetCells,
            scenarios,
            dryRun,
        });
        allResults.push(...outcome.results);
    }
    const finishedAt = new Date().toISOString();
    const bundle = { runId, startedAt, finishedAt, results: allResults };

    const artifactDir = `${process.cwd()}/evidence/${runId}`;
    writeAll(artifactDir, bundle);

    const summary = summarize(bundle);
    const preSkippedNote =
        preSkipped.length > 0
            ? ` — ${preSkipped.length} cells SKIPPED upfront (missing tokens)`
            : "";
    log.info(
        `Result: ${summary.passed}/${summary.total} passed (failed=${summary.failed}, skipped=${summary.skipped}, blocked=${summary.blocked})${preSkippedNote}`,
    );
    log.info(`Evidence: ${artifactDir}`);

    if (summary.failed > 0 || summary.blocked > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    log.err((err as Error).stack ?? String(err));
    process.exit(1);
});
