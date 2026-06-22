#!/usr/bin/env npx ts-node
/* eslint-disable no-console */

/**
 * One-shot backfill for the widened Kody Rules `origin` enum and the
 * generalized `requestType` values.
 *
 * Two field remaps over the embedded `rules[]` of every `kodyRules` document:
 *
 *   1. `origin` — legacy values (`user`/`library`/`generated`) are mapped onto
 *      the widened set via `resolveKodyRuleOrigin` (the same helper the runtime
 *      uses), so migrated and freshly-written rows agree:
 *        - IDE/repo rule-file sourcePath → `repo_file_sync`
 *        - legacy `library`             → `library`
 *        - legacy `generated`           → `past_reviews`
 *        - else                         → `manual`
 *
 *   2. `requestType` — `memory_create` → `create`, `memory_update` → `update`.
 *
 * Idempotent: rules already on a widened `origin`/`requestType` are left as-is,
 * so re-running is safe.
 *
 * Usage:
 *   npx ts-node scripts/migrate-kody-rules-origin-and-request-type.ts [--dry-run] [--env=.env.prod]
 *
 * Required env: API_MG_DB_* (or MONGODB_URI) — same Mongo connection as the API.
 */

import 'dotenv/config';

import * as path from 'path';
import { MongoClient } from 'mongodb';

import {
    LegacyKodyRuleOrigin,
    resolveKodyRuleOrigin,
} from '@libs/common/utils/kody-rules/resolve-origin';
import { KodyRulesOrigin } from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

const NEW_ORIGINS = new Set<string>(Object.values(KodyRulesOrigin));
const LEGACY_ORIGINS = new Set<LegacyKodyRuleOrigin>([
    'user',
    'library',
    'generated',
]);

const REQUEST_TYPE_MAP: Record<string, string> = {
    memory_create: 'create',
    memory_update: 'update',
};

function parseArgs() {
    const argv = process.argv.slice(2);
    const get = (flag: string) => {
        const eq = argv.find((a) => a.startsWith(`${flag}=`));
        return eq ? eq.slice(flag.length + 1) : undefined;
    };
    return { dryRun: argv.includes('--dry-run'), envFile: get('--env') };
}

function loadEnvFile(envFile?: string): void {
    if (!envFile) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dotenv = require('dotenv') as typeof import('dotenv');
    dotenv.config({ path: path.resolve(envFile), override: true });
}

function buildMongoUri(): string {
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
    const host = process.env.API_MG_DB_HOST ?? 'localhost';
    const port = process.env.API_MG_DB_PORT ?? '27017';
    const user = process.env.API_MG_DB_USERNAME;
    const pass = process.env.API_MG_DB_PASSWORD;
    const auth = user && pass ? `${user}:${encodeURIComponent(pass)}@` : '';
    const db = process.env.API_MG_DB_DATABASE ?? 'kodus';
    return `mongodb://${auth}${host}:${port}/${db}?authSource=admin`;
}

/** Returns the migrated rule, or null when nothing changed. */
export function migrateRule(rule: any): any | null {
    let changed = false;
    const next = { ...rule };

    const origin = rule?.origin;
    if (!origin || !NEW_ORIGINS.has(origin)) {
        next.origin = resolveKodyRuleOrigin({
            legacyOrigin: LEGACY_ORIGINS.has(origin)
                ? (origin as LegacyKodyRuleOrigin)
                : undefined,
            sourcePath: rule?.sourcePath,
        });
        changed = true;
    }

    const mappedRequestType = REQUEST_TYPE_MAP[rule?.requestType];
    if (mappedRequestType) {
        next.requestType = mappedRequestType;
        changed = true;
    }

    return changed ? next : null;
}

async function main() {
    const { dryRun, envFile } = parseArgs();
    loadEnvFile(envFile);

    const client = new MongoClient(buildMongoUri());
    await client.connect();
    const db = client.db(process.env.API_MG_DB_DATABASE ?? 'kodus');
    const collection = db.collection('kodyRules');

    let docsScanned = 0;
    let docsUpdated = 0;
    let rulesMigrated = 0;

    try {
        const cursor = collection.find({});
        for await (const doc of cursor) {
            docsScanned += 1;
            const rules: any[] = Array.isArray(doc.rules) ? doc.rules : [];

            let docChanged = false;
            const nextRules = rules.map((rule) => {
                const migrated = migrateRule(rule);
                if (migrated) {
                    docChanged = true;
                    rulesMigrated += 1;
                    return migrated;
                }
                return rule;
            });

            if (!docChanged) continue;
            docsUpdated += 1;

            if (!dryRun) {
                await collection.updateOne(
                    { _id: doc._id },
                    { $set: { rules: nextRules } },
                );
            }
        }
    } finally {
        await client.close();
    }

    console.log(
        `[migrate-kody-rules]${dryRun ? ' [DRY RUN]' : ''} scanned ${docsScanned} org doc(s); ` +
            `${docsUpdated} doc(s) ${dryRun ? 'would be' : ''} updated; ${rulesMigrated} rule(s) remapped.`,
    );
}

if (require.main === module) {
    main().catch((err) => {
        console.error(
            'migrate-kody-rules-origin-and-request-type crashed:',
            err,
        );
        process.exit(1);
    });
}
