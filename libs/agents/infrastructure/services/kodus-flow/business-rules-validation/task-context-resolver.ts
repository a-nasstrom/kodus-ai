import type { TaskContextNormalized } from '@libs/agents/skills/capabilities';
import type {
    BusinessRulesSignals,
    TaskContextManifest,
    TaskReference,
    TaskReferenceSource,
} from './types';

export type {
    TaskContextManifest,
    TaskReference,
    TaskReferenceKind,
    TaskReferenceSource,
} from './types';

export const MAX_TASK_REFERENCES = 5;

const ISSUE_KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9_]+-\d+)\b/g;
const PIPELINE_TICKET_KEY_PATTERN = /[A-Za-z][A-Za-z0-9_]+-\d+/g;

const REQUIREMENT_KEYWORDS = [
    'requirement',
    'acceptance criteria',
    'user story',
    'given',
    'when',
    'then',
] as const;

export interface MergeTaskContextSourcesInput {
    mcpNormalizedList: TaskContextNormalized[];
    prTextContext: string;
}

export interface MergeTaskContextSourcesResult {
    taskContext: string;
    taskContextNormalized?: TaskContextNormalized;
}

export function buildPrTextContext(input: {
    title?: string;
    body?: string;
    branch?: string;
}): string {
    const sections: string[] = ['## From PR', ''];

    const title = input.title?.trim() ?? '';
    const branch = input.branch?.trim() ?? '';
    const body = input.body?.trim() ?? '';

    if (title) {
        sections.push(`Title: ${title}`);
    }
    if (branch) {
        sections.push(`Branch: ${branch}`);
    }
    if (body) {
        sections.push('', 'Description:', body);
    }

    const content = sections.join('\n').trim();
    if (!title && !branch && !body) {
        return '';
    }

    return content;
}

export function buildBusinessSignalsFromSources(input: {
    title?: string;
    branch?: string;
    body?: string;
    /** @deprecated Prefer title, branch, and body for ordered ticket scoping. */
    combinedForTickets?: string;
    bodyForKeywords?: string;
    taskId?: string;
    taskUrl?: string;
}): BusinessRulesSignals {
    const title = input.title?.trim() ?? '';
    const branch = input.branch?.trim() ?? '';
    const body =
        input.body?.trim() ??
        (input.title || input.branch
            ? ''
            : (input.combinedForTickets?.trim() ?? ''));
    const keywordsBody = input.bodyForKeywords?.trim() ?? body;
    const normalizedTaskId = input.taskId?.trim().toUpperCase();
    const normalizedTaskUrl = input.taskUrl?.trim();

    const titleKeys = extractTicketKeysFromText(title);
    const branchKeys = extractTicketKeysFromText(branch);
    const bodyKeys = extractTicketKeysFromText(body);

    const ticketKeys = buildScopedTicketKeys({
        explicitTaskId: normalizedTaskId,
        titleKeys,
        branchKeys,
        bodyKeys,
    });

    const scannedLinks = uniqueNonEmpty([
        ...extractUrlsFromText(title),
        ...extractUrlsFromText(branch),
        ...extractUrlsFromText(body),
    ]);
    const taskLinks = uniqueNonEmpty([
        ...(normalizedTaskUrl ? [normalizeUrl(normalizedTaskUrl)] : []),
        ...scannedLinks,
    ]);

    const lower = keywordsBody.toLowerCase();
    const requirementKeywords = REQUIREMENT_KEYWORDS.filter((keyword) =>
        lower.includes(keyword),
    );

    return {
        ticketKeys,
        taskLinks,
        requirementKeywords,
    };
}

export function resolveTaskReferences(input: {
    title?: string;
    branch?: string;
    body?: string;
    businessSignals?: BusinessRulesSignals;
    taskId?: string;
    taskUrl?: string;
    taskReference?: string;
}): TaskReference[] {
    const hasRawSources =
        input.title !== undefined ||
        input.branch !== undefined ||
        input.body !== undefined;

    if (hasRawSources) {
        return resolveTaskReferencesFromSources(input).slice(
            0,
            MAX_TASK_REFERENCES,
        );
    }

    const explicitKeys = uniqueNonEmpty([
        ...(input.taskId?.trim() ? [input.taskId.trim()] : []),
        ...extractIssueKeysFromUserProvidedText(input.taskReference),
    ]);
    const explicitLinks = uniqueNonEmpty([
        ...(input.taskUrl?.trim() ? [input.taskUrl.trim()] : []),
        ...extractUrlsFromUserProvidedText(input.taskReference),
    ]);

    const keys = uniqueNonEmpty([
        ...explicitKeys,
        ...(input.businessSignals?.ticketKeys ?? []),
    ]);
    const links = uniqueNonEmpty([
        ...explicitLinks,
        ...(input.businessSignals?.taskLinks ?? []),
    ]);

    return dedupeTaskReferences(keys, links, {
        explicitKeys: new Set(explicitKeys.map((key) => key.toUpperCase())),
        explicitLinks: new Set(explicitLinks.map((url) => normalizeUrl(url))),
    }).slice(0, MAX_TASK_REFERENCES);
}

export function buildTaskContextManifest(input: {
    title?: string;
    branch?: string;
    body?: string;
    businessSignals?: BusinessRulesSignals;
    taskId?: string;
    taskUrl?: string;
    taskReference?: string;
}): TaskContextManifest {
    const references = resolveTaskReferences(input);
    const primaryReference = resolvePrimaryTaskReference({
        title: input.title,
        taskId: input.taskId,
        taskUrl: input.taskUrl,
        references,
    });

    return {
        primaryReference,
        references,
    };
}

function resolvePrimaryTaskReference(input: {
    title?: string;
    taskId?: string;
    taskUrl?: string;
    references: TaskReference[];
}): TaskReference | undefined {
    const titleKeys = extractTicketKeysFromText(input.title);
    if (titleKeys.length > 0) {
        const titleKey = titleKeys[0]!;
        const matched = input.references.find(
            (reference) =>
                reference.kind === 'key' &&
                reference.value.toUpperCase() === titleKey,
        );
        if (matched) {
            return matched;
        }

        return {
            kind: 'key',
            value: titleKey,
            label: titleKey,
            source: 'title',
        };
    }

    const explicitTaskId = input.taskId?.trim().toUpperCase();
    if (explicitTaskId) {
        return (
            input.references.find(
                (reference) =>
                    reference.kind === 'key' &&
                    reference.value.toUpperCase() === explicitTaskId,
            ) ?? {
                kind: 'key',
                value: explicitTaskId,
                label: explicitTaskId,
                source: 'explicit',
            }
        );
    }

    const explicitTaskUrl = input.taskUrl?.trim();
    if (explicitTaskUrl) {
        return (
            input.references.find(
                (reference) =>
                    reference.kind === 'url' &&
                    normalizeUrl(reference.value) === normalizeUrl(explicitTaskUrl),
            ) ?? {
                kind: 'url',
                value: explicitTaskUrl,
                label: explicitTaskUrl,
                source: 'explicit',
            }
        );
    }

    return input.references[0];
}

const TASK_REFERENCE_SOURCE_PRIORITY: Record<TaskReferenceSource, number> = {
    explicit: 4,
    title: 3,
    branch: 2,
    body: 1,
};

function resolveTaskReferencesFromSources(input: {
    title?: string;
    branch?: string;
    body?: string;
    businessSignals?: BusinessRulesSignals;
    taskId?: string;
    taskUrl?: string;
    taskReference?: string;
}): TaskReference[] {
    const ordered: TaskReference[] = [];
    const keyIndex = new Map<string, number>();
    const urlIndex = new Map<string, number>();

    const upsertKey = (rawKey: string, source: TaskReferenceSource): void => {
        const normalizedKey = rawKey.trim().toUpperCase();
        if (!normalizedKey) {
            return;
        }

        const existingIndex = keyIndex.get(normalizedKey);
        if (existingIndex === undefined) {
            keyIndex.set(normalizedKey, ordered.length);
            ordered.push({
                kind: 'key',
                value: normalizedKey,
                label: normalizedKey,
                source,
            });
            return;
        }

        const existing = ordered[existingIndex]!;
        if (
            TASK_REFERENCE_SOURCE_PRIORITY[source] >
            TASK_REFERENCE_SOURCE_PRIORITY[existing.source]
        ) {
            ordered[existingIndex] = {
                ...existing,
                source,
            };
        }
    };

    const upsertUrl = (rawUrl: string, source: TaskReferenceSource): void => {
        const normalizedUrl = normalizeUrl(rawUrl);
        if (!normalizedUrl) {
            return;
        }

        const keyFromUrl = extractIssueKeyFromUrl(normalizedUrl);
        if (keyFromUrl) {
            const normalizedKey = keyFromUrl.toUpperCase();
            if (keyIndex.has(normalizedKey)) {
                return;
            }
        }

        const existingIndex = urlIndex.get(normalizedUrl);
        if (existingIndex === undefined) {
            urlIndex.set(normalizedUrl, ordered.length);
            ordered.push({
                kind: 'url',
                value: normalizedUrl,
                label: keyFromUrl?.toUpperCase() ?? normalizedUrl,
                source,
            });
            return;
        }

        const existing = ordered[existingIndex]!;
        if (
            TASK_REFERENCE_SOURCE_PRIORITY[source] >
            TASK_REFERENCE_SOURCE_PRIORITY[existing.source]
        ) {
            ordered[existingIndex] = {
                ...existing,
                source,
            };
        }
    };

    if (input.taskId?.trim()) {
        upsertKey(input.taskId.trim(), 'explicit');
    }
    for (const key of extractIssueKeysFromUserProvidedText(input.taskReference)) {
        upsertKey(key, 'explicit');
    }
    if (input.taskUrl?.trim()) {
        upsertUrl(input.taskUrl.trim(), 'explicit');
    }
    for (const url of extractUrlsFromUserProvidedText(input.taskReference)) {
        upsertUrl(url, 'explicit');
    }

    const title = input.title?.trim() ?? '';
    const branch = input.branch?.trim() ?? '';
    const body = input.body?.trim() ?? '';

    for (const key of extractTicketKeysFromText(title)) {
        upsertKey(key, 'title');
    }
    for (const url of extractUrlsFromText(title)) {
        upsertUrl(url, 'title');
    }

    for (const key of extractTicketKeysFromText(branch)) {
        upsertKey(key, 'branch');
    }
    for (const url of extractUrlsFromText(branch)) {
        upsertUrl(url, 'branch');
    }

    const scopedBodyKeys = buildScopedTicketKeys({
        titleKeys: extractTicketKeysFromText(title),
        branchKeys: extractTicketKeysFromText(branch),
        bodyKeys: extractTicketKeysFromText(body),
    });
    for (const key of scopedBodyKeys) {
        upsertKey(key, 'body');
    }
    for (const url of extractUrlsFromText(body)) {
        upsertUrl(url, 'body');
    }

    for (const key of input.businessSignals?.ticketKeys ?? []) {
        upsertKey(key, 'body');
    }
    for (const url of input.businessSignals?.taskLinks ?? []) {
        upsertUrl(url, 'body');
    }

    return ordered;
}

/** @deprecated Use resolveTaskReferences */
export function resolvePipelineTaskReferences(input: {
    businessSignals?: BusinessRulesSignals;
    taskId?: string;
    taskUrl?: string;
    taskReference?: string;
}): TaskReference[] {
    return resolveTaskReferences(input);
}

export function shouldAttemptMcpFetch(references: TaskReference[]): boolean {
    return references.length > 0;
}

export function dedupeTaskReferences(
    keys: string[],
    links: string[],
    sourceHints?: {
        explicitKeys?: Set<string>;
        explicitLinks?: Set<string>;
    },
): TaskReference[] {
    const references: TaskReference[] = [];
    const seenKeys = new Set<string>();
    const seenUrls = new Set<string>();

    const addKey = (rawKey: string, source: TaskReferenceSource): void => {
        const normalizedKey = rawKey.trim().toUpperCase();
        if (!normalizedKey || seenKeys.has(normalizedKey)) {
            return;
        }
        seenKeys.add(normalizedKey);
        references.push({
            kind: 'key',
            value: normalizedKey,
            label: normalizedKey,
            source,
        });
    };

    for (const key of keys) {
        const normalizedKey = key.trim().toUpperCase();
        const source = sourceHints?.explicitKeys?.has(normalizedKey)
            ? 'explicit'
            : 'body';
        addKey(key, source);
    }

    for (const link of links) {
        const normalizedUrl = normalizeUrl(link);
        if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
            continue;
        }

        const keyFromUrl = extractIssueKeyFromUrl(normalizedUrl);
        if (keyFromUrl) {
            const normalizedKey = keyFromUrl.toUpperCase();
            if (seenKeys.has(normalizedKey)) {
                seenUrls.add(normalizedUrl);
                continue;
            }
        }

        seenUrls.add(normalizedUrl);
        const source = sourceHints?.explicitLinks?.has(normalizedUrl)
            ? 'explicit'
            : 'body';
        references.push({
            kind: 'url',
            value: normalizedUrl,
            label: keyFromUrl?.toUpperCase() ?? normalizedUrl,
            source,
        });
    }

    return references;
}

export function mergeTaskContextSources(
    input: MergeTaskContextSourcesInput,
): MergeTaskContextSourcesResult {
    const sections: string[] = [];
    const mergedAcceptanceCriteria: string[] = [];
    const mergedLinks: string[] = [];
    let primaryNormalized: TaskContextNormalized | undefined;

    for (const ticket of input.mcpNormalizedList) {
        const label = ticket.id?.trim() || ticket.title?.trim() || 'ticket';
        sections.push(`## From ticket ${label}`, '', formatTicketSection(ticket));

        if (ticket.acceptanceCriteria?.length) {
            for (const criterion of ticket.acceptanceCriteria) {
                const trimmed = criterion.trim();
                if (!trimmed) {
                    continue;
                }
                mergedAcceptanceCriteria.push(`[${label}] ${trimmed}`);
            }
        }

        if (ticket.links?.length) {
            mergedLinks.push(...ticket.links);
        }

        if (!primaryNormalized) {
            primaryNormalized = ticket;
        }
    }

    const prText = input.prTextContext.trim();
    if (prText) {
        if (sections.length > 0) {
            sections.push('');
        }
        sections.push(prText);
    }

    const taskContext = sections.join('\n').trim();
    if (!taskContext) {
        return { taskContext: '' };
    }

    if (input.mcpNormalizedList.length === 0) {
        return { taskContext };
    }

    if (input.mcpNormalizedList.length === 1 && !prText) {
        return {
            taskContext,
            taskContextNormalized: input.mcpNormalizedList[0],
        };
    }

    const titles = input.mcpNormalizedList
        .map((ticket) => ticket.title?.trim())
        .filter((title): title is string => Boolean(title));

    return {
        taskContext,
        taskContextNormalized: {
            id:
                input.mcpNormalizedList.length === 1
                    ? primaryNormalized?.id
                    : input.mcpNormalizedList
                          .map((ticket) => ticket.id)
                          .filter(Boolean)
                          .join(', '),
            title: titles.length ? titles.join(' | ') : primaryNormalized?.title,
            description: taskContext,
            acceptanceCriteria: mergedAcceptanceCriteria.length
                ? mergedAcceptanceCriteria
                : undefined,
            links: mergedLinks.length ? uniqueNonEmpty(mergedLinks) : undefined,
            sourceProvider: primaryNormalized?.sourceProvider,
        },
    };
}

function formatTicketSection(ticket: TaskContextNormalized): string {
    const parts: string[] = [];

    if (ticket.title) {
        parts.push(`Title: ${ticket.title}`);
    }
    if (ticket.description) {
        parts.push(`Description:\n${ticket.description}`);
    }
    if (ticket.acceptanceCriteria?.length) {
        parts.push(
            `Acceptance Criteria:\n${ticket.acceptanceCriteria
                .map((item) => `- ${item}`)
                .join('\n')}`,
        );
    }
    if (ticket.links?.length) {
        parts.push(`Links:\n${ticket.links.map((item) => `- ${item}`).join('\n')}`);
    }

    return parts.join('\n\n');
}

function extractTicketKeysFromText(text?: string): string[] {
    if (!text?.trim()) {
        return [];
    }

    const keys = new Set<string>();
    for (const match of text.matchAll(PIPELINE_TICKET_KEY_PATTERN)) {
        keys.add(match[0].toUpperCase());
    }

    return [...keys];
}

function buildScopedTicketKeys(input: {
    explicitTaskId?: string;
    titleKeys: string[];
    branchKeys: string[];
    bodyKeys: string[];
}): string[] {
    const { explicitTaskId, titleKeys, branchKeys, bodyKeys } = input;

    if (titleKeys.length > 0) {
        return uniqueNonEmpty([
            ...(explicitTaskId ? [explicitTaskId] : []),
            ...titleKeys,
            ...branchKeys,
        ]).slice(0, MAX_TASK_REFERENCES);
    }

    return uniqueNonEmpty([
        ...(explicitTaskId ? [explicitTaskId] : []),
        ...branchKeys,
        ...bodyKeys,
    ]).slice(0, MAX_TASK_REFERENCES);
}

function extractUrlsFromText(text?: string): string[] {
    if (!text?.trim()) {
        return [];
    }

    const matches = text.match(/https?:\/\/[^\s)>\]"']+/g) ?? [];
    return uniqueNonEmpty(
        matches.map((url) => normalizeUrl(url)).filter(Boolean),
    );
}

function extractIssueKeysFromUserProvidedText(text?: string): string[] {
    if (!text?.trim()) {
        return [];
    }

    const keys = new Set<string>();
    for (const match of text.matchAll(ISSUE_KEY_PATTERN)) {
        if (match[1]) {
            keys.add(match[1].toUpperCase());
        }
    }

    return [...keys];
}

function extractUrlsFromUserProvidedText(text?: string): string[] {
    if (!text?.trim()) {
        return [];
    }

    const matches = text.match(/https?:\/\/[^\s)>\]"']+/g) ?? [];
    return uniqueNonEmpty(
        matches.map((url) => normalizeUrl(url)).filter(Boolean),
    );
}

function extractIssueKeyFromUrl(url: string): string | undefined {
    for (const match of url.matchAll(ISSUE_KEY_PATTERN)) {
        if (match[1]) {
            return match[1].toUpperCase();
        }
    }
    return undefined;
}

function normalizeUrl(url: string): string {
    return url.trim().replace(/[),.;]+$/g, '');
}

function uniqueNonEmpty(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        result.push(trimmed);
    }

    return result;
}
