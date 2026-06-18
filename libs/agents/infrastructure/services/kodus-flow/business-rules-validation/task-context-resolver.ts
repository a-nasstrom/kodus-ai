import type { TaskContextNormalized } from '@libs/agents/skills/capabilities';
import type { BusinessRulesSignals } from './types';

export const MAX_TASK_REFERENCES = 5;

const ISSUE_KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9_]+-\d+)\b/g;

export type TaskReferenceKind = 'key' | 'url';

export interface TaskReference {
    kind: TaskReferenceKind;
    value: string;
    label: string;
}

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

export function resolvePipelineTaskReferences(input: {
    businessSignals?: BusinessRulesSignals;
}): TaskReference[] {
    const keys = uniqueNonEmpty(input.businessSignals?.ticketKeys ?? []);
    const links = uniqueNonEmpty(input.businessSignals?.taskLinks ?? []);

    return dedupeTaskReferences(keys, links).slice(0, MAX_TASK_REFERENCES);
}

export function dedupeTaskReferences(
    keys: string[],
    links: string[],
): TaskReference[] {
    const references: TaskReference[] = [];
    const seenKeys = new Set<string>();
    const seenUrls = new Set<string>();

    const addKey = (rawKey: string): void => {
        const normalizedKey = rawKey.trim().toUpperCase();
        if (!normalizedKey || seenKeys.has(normalizedKey)) {
            return;
        }
        seenKeys.add(normalizedKey);
        references.push({
            kind: 'key',
            value: normalizedKey,
            label: normalizedKey,
        });
    };

    for (const key of keys) {
        addKey(key);
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
        references.push({
            kind: 'url',
            value: normalizedUrl,
            label: keyFromUrl?.toUpperCase() ?? normalizedUrl,
        });
    }

    return references;
}

export function shouldAttemptMcpFetch(
    connectedTaskMcps: string[] | undefined,
    references: TaskReference[],
): boolean {
    return (
        Array.isArray(connectedTaskMcps) &&
        connectedTaskMcps.length > 0 &&
        references.length > 0
    );
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
