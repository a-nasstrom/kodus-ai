import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { MatrixCell, ProviderName, Target } from "../types.js";

interface MatrixFile {
    id: string;
    scenarios: string[];
    cells: MatrixCell[];
}

function loadMatrix(name: string): MatrixFile {
    const path = resolve(import.meta.dirname, "..", "..", "matrix", name);
    return parseYaml(readFileSync(path, "utf8")) as MatrixFile;
}

const validTargets: Target[] = ["cloud", "self-hosted"];
const validProviders: ProviderName[] = [
    "github",
    "gitlab",
    "bitbucket",
    "azure-devops",
];

test("p0.yml loads and has expected shape", () => {
    const m = loadMatrix("p0.yml");
    assert.equal(m.id, "p0");
    assert.ok(Array.isArray(m.scenarios));
    assert.ok(m.scenarios.length > 0);
    assert.ok(Array.isArray(m.cells));
    assert.ok(m.cells.length > 0);
});

test("release.yml loads and includes upgrade scenario", () => {
    const m = loadMatrix("release.yml");
    assert.equal(m.id, "release");
    assert.ok(m.scenarios.includes("upgrade-n-1-to-n"));
});

test("every cell in every matrix uses valid axes", () => {
    for (const name of ["p0.yml", "release.yml"]) {
        const m = loadMatrix(name);
        for (const cell of m.cells) {
            assert.ok(
                validTargets.includes(cell.target),
                `${name}: invalid target ${cell.target}`,
            );
            assert.ok(
                validProviders.includes(cell.provider),
                `${name}: invalid provider ${cell.provider}`,
            );
            assert.ok(
                [
                    "free",
                    "trial",
                    "paid",
                    "community-byok",
                    "license-paid",
                    "license-free",
                ].includes(cell.license),
                `${name}: invalid license ${cell.license}`,
            );
        }
    }
});

test("p0.yml has at least one cell per provider (covering all 4)", () => {
    const m = loadMatrix("p0.yml");
    const providers = new Set(m.cells.map((c) => c.provider));
    for (const p of validProviders) {
        assert.ok(providers.has(p), `p0.yml missing provider: ${p}`);
    }
});

test("p0.yml covers both targets", () => {
    const m = loadMatrix("p0.yml");
    const targets = new Set(m.cells.map((c) => c.target));
    assert.ok(targets.has("cloud"), "p0.yml missing cloud target");
    assert.ok(targets.has("self-hosted"), "p0.yml missing self-hosted target");
});

test("p0.yml license matrix has at least free/trial/paid for cloud", () => {
    const m = loadMatrix("p0.yml");
    const cloudLicenses = new Set(
        m.cells.filter((c) => c.target === "cloud").map((c) => c.license),
    );
    assert.ok(cloudLicenses.has("free"), "cloud missing free");
    assert.ok(cloudLicenses.has("trial"), "cloud missing trial");
    assert.ok(cloudLicenses.has("paid"), "cloud missing paid");
});

test("p0.yml license matrix has paid and free for self-hosted", () => {
    const m = loadMatrix("p0.yml");
    const shLicenses = new Set(
        m.cells.filter((c) => c.target === "self-hosted").map((c) => c.license),
    );
    assert.ok(shLicenses.has("license-paid"), "self-hosted missing license-paid");
    assert.ok(shLicenses.has("license-free"), "self-hosted missing license-free");
});
