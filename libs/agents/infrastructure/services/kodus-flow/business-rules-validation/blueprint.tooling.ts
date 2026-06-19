import {
    fetchAllTaskContexts,
    fetchPullRequestDiff,
    fetchPullRequestMetadata,
    fetchTaskContext as fetchTaskContextCapability,
    isUsableTaskContextNormalized,
    PrDiffReadParams,
    PrMetadataReadParams,
} from '@libs/agents/skills/capabilities';
import { createCapabilityToolRuntime } from '@libs/agents/skills/runtime/capability-runtime.resolver';
import {
    CapabilityExecutionHooks,
    CapabilityExecutionTrace,
    SkillCapabilityRuntimeConfig,
    ToolCaller,
} from '@libs/agents/skills/runtime/skill-runtime.types';

import {
    BusinessRulesContext,
    TaskContextNormalized,
    TaskQuality,
} from './types';
import type {
    TaskContextManifest,
    TaskReference,
} from './task-context-resolver';

export const SKILL_NAME = 'business-rules-validation';
export const PR_METADATA_CAPABILITY = 'pr.metadata.read';
export const PR_DIFF_CAPABILITY = 'pr.diff.read';

interface ToolingResult<T> {
    value: T;
    traces: CapabilityExecutionTrace[];
}

export interface TaskContextManifestFetchResult {
    value: TaskContextNormalized[];
    traces: CapabilityExecutionTrace[];
    unresolvedReferences: TaskReference[];
}

interface ExecutionScope {
    organizationId: string;
    teamId: string;
}

interface PullRequestRef {
    organizationId: string;
    teamId: string;
    repositoryId: string;
    pullRequestNumber: number;
}

export interface BusinessRulesBlueprintTooling {
    fetchPullRequestBody: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<string | undefined>>;
    fetchPullRequestDiff: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<string>>;
    fetchTaskContext: (
        ctx: BusinessRulesContext,
    ) => Promise<ToolingResult<TaskContextNormalized | undefined>>;
    resolveTaskContextFromManifest: (
        ctx: BusinessRulesContext,
        manifest: TaskContextManifest,
    ) => Promise<TaskContextManifestFetchResult>;
}

export function resolvePullRequestDescription(
    ctx: BusinessRulesContext,
): string {
    const description = ctx.prepareContext?.pullRequestDescription;
    return typeof description === 'string' ? description : '';
}

export function resolveTaskContext(ctx: BusinessRulesContext): string {
    const taskContext = ctx.prepareContext?.taskContext;
    return typeof taskContext === 'string' ? taskContext : '';
}

export function classifyTaskQuality(taskContext: string): TaskQuality {
    return classifyTaskQualityFromSources({ taskContext });
}

export function classifyTaskQualityFromSources(input: {
    taskContext?: string;
    taskContextNormalized?: TaskContextNormalized;
}): TaskQuality {
    const normalizedTask = input.taskContextNormalized;
    if (normalizedTask) {
        const hasTitle = hasMeaningfulText(normalizedTask.title);
        const hasDescription = hasMeaningfulText(normalizedTask.description);
        const hasAcceptanceCriteria =
            Array.isArray(normalizedTask.acceptanceCriteria) &&
            normalizedTask.acceptanceCriteria.some((item) =>
                hasMeaningfulText(item),
            );

        if (!hasTitle && !hasDescription && !hasAcceptanceCriteria) {
            return 'EMPTY';
        }

        if (hasAcceptanceCriteria && (hasTitle || hasDescription)) {
            return 'COMPLETE';
        }

        if (hasTitle && hasDescription) {
            return 'PARTIAL';
        }

        if (hasDescription) {
            return normalizedTask.description!.trim().length >= 80
                ? 'PARTIAL'
                : 'MINIMAL';
        }

        return 'MINIMAL';
    }

    const normalized = input.taskContext?.trim() ?? '';
    if (!normalized.length) {
        return 'EMPTY';
    }

    const ticketSectionCount = countSections(normalized, '## From ticket');
    const hasFromPr = /(^|\n)\s*## From PR\b/im.test(normalized);
    const prSection = hasFromPr
        ? extractMarkdownSection(normalized, 'From PR')
        : '';

    const hasAcceptanceCriteriaSection =
        /(^|\n)\s*acceptance criteria\s*:/im.test(normalized) ||
        /(^|\n)\s*acceptance criteria\s*:/im.test(prSection);
    const hasTitleSection =
        /(^|\n)\s*title\s*:/im.test(normalized) ||
        /(^|\n)\s*title\s*:/im.test(prSection);
    const hasDescriptionSection =
        /(^|\n)\s*description\s*:/im.test(normalized) ||
        /(^|\n)\s*description\s*:/im.test(prSection);
    const bulletLikeRequirements = countRequirementListItems(
        prSection || normalized,
    );

    if (ticketSectionCount === 0 && hasFromPr) {
        if (
            !hasAcceptanceCriteriaSection &&
            bulletLikeRequirements < 1 &&
            !hasTitleSection &&
            normalized.length < 80
        ) {
            return 'EMPTY';
        }
    }

    if (
        ticketSectionCount >= 1 &&
        (hasFromPr || hasAcceptanceCriteriaSection || bulletLikeRequirements >= 1)
    ) {
        return hasAcceptanceCriteriaSection || bulletLikeRequirements >= 2
            ? 'COMPLETE'
            : 'PARTIAL';
    }

    if (
        (hasAcceptanceCriteriaSection || bulletLikeRequirements >= 2) &&
        (hasDescriptionSection || hasTitleSection || normalized.length >= 120)
    ) {
        return 'COMPLETE';
    }

    if (hasFromPr && (prSection.trim().length >= 20 || hasTitleSection)) {
        return hasAcceptanceCriteriaSection || bulletLikeRequirements >= 2
            ? 'COMPLETE'
            : 'PARTIAL';
    }

    if (hasDescriptionSection || normalized.length >= 80) {
        return 'PARTIAL';
    }

    return 'MINIMAL';
}

function resolvePullRequestMetadataToolArgs(
    ctx: BusinessRulesContext,
): PrMetadataReadParams | undefined {
    const pullRequestRef = resolvePullRequestRef(ctx);
    if (!pullRequestRef) {
        return undefined;
    }

    const repositoryName =
        resolveRepositoryName(ctx) ?? pullRequestRef.repositoryId;

    return {
        organizationId: pullRequestRef.organizationId,
        teamId: pullRequestRef.teamId,
        repositoryId: pullRequestRef.repositoryId,
        repositoryName,
        pullRequestNumber: pullRequestRef.pullRequestNumber,
    };
}

function resolvePullRequestDiffToolArgs(
    ctx: BusinessRulesContext,
): PrDiffReadParams | undefined {
    const pullRequestRef = resolvePullRequestRef(ctx);
    if (!pullRequestRef) {
        return undefined;
    }

    const repositoryName = resolveRepositoryName(ctx);

    return {
        organizationId: pullRequestRef.organizationId,
        teamId: pullRequestRef.teamId,
        repositoryId: pullRequestRef.repositoryId,
        repositoryName,
        pullRequestNumber: pullRequestRef.pullRequestNumber,
    };
}

export function createBusinessRulesBlueprintTooling(
    fetcher: ToolCaller,
    capabilityRuntime: SkillCapabilityRuntimeConfig,
    hooks?: CapabilityExecutionHooks<BusinessRulesContext>,
): BusinessRulesBlueprintTooling {
    const providerType = capabilityRuntime.providerType || 'external';
    const registeredTools = getRegisteredToolNames(fetcher);
    const capabilityTools = createCapabilityToolRuntime({
        config: capabilityRuntime,
        registeredTools,
    });

    return {
        fetchPullRequestBody: async (ctx: BusinessRulesContext) => {
            const args = resolvePullRequestMetadataToolArgs(ctx);
            const toolName = capabilityTools.getToolName(
                PR_METADATA_CAPABILITY,
            );
            const metadata = await fetchPullRequestMetadata(
                fetcher,
                toolName,
                args,
                buildCapabilityExecutionContext(ctx, providerType),
            );

            await recordCapabilityExecutionTraces(hooks, metadata.traces);

            return {
                value: metadata.body,
                traces: metadata.traces,
            };
        },

        fetchPullRequestDiff: async (ctx: BusinessRulesContext) => {
            const args = resolvePullRequestDiffToolArgs(ctx);
            const toolName = capabilityTools.getToolName(PR_DIFF_CAPABILITY);
            const diff = await fetchPullRequestDiff(
                fetcher,
                toolName,
                args,
                buildCapabilityExecutionContext(ctx, providerType),
            );

            await recordCapabilityExecutionTraces(hooks, diff.traces);

            return {
                value: diff.diff,
                traces: diff.traces,
            };
        },

        fetchTaskContext: async (ctx: BusinessRulesContext) => {
            const scope = resolveExecutionScope(ctx);
            const taskContext = await fetchTaskContextCapability(
                fetcher,
                capabilityRuntime,
                buildTaskContextReadParams(
                    ctx,
                    scope,
                    capabilityTools,
                    hooks,
                    providerType,
                ),
                {
                    getSeedTaskContextTools: hooks?.getSeedTaskContextTools,
                    getCachedTaskContextTools: hooks?.getCachedTaskContextTools,
                    saveCachedTaskContextTools:
                        hooks?.saveCachedTaskContextTools,
                    resolvePreferredTool: hooks?.resolvePreferredTool,
                    recordExecution: hooks?.recordExecution,
                },
            );

            return {
                value: taskContext.normalized,
                traces: taskContext.traces,
            };
        },

        resolveTaskContextFromManifest: async (
            ctx: BusinessRulesContext,
            manifest: TaskContextManifest,
        ) => {
            if (!manifest.references.length) {
                return { value: [], traces: [], unresolvedReferences: [] };
            }

            const scope = resolveExecutionScope(ctx);
            const resolutionMode =
                hooks?.resolveTaskContextMode?.(ctx, providerType) ??
                'agent_first';
            const capabilityHooks = {
                getSeedTaskContextTools: hooks?.getSeedTaskContextTools,
                getCachedTaskContextTools: hooks?.getCachedTaskContextTools,
                saveCachedTaskContextTools:
                    hooks?.saveCachedTaskContextTools,
                resolvePreferredTool: hooks?.resolvePreferredTool,
                recordExecution: hooks?.recordExecution,
            };
            const baseParams = buildTaskContextReadParams(
                ctx,
                scope,
                capabilityTools,
                hooks,
                providerType,
                {
                    manifest,
                    resolutionMode,
                },
            );
            const traces: CapabilityExecutionTrace[] = [];
            let unresolvedReferences: TaskReference[] = [];

            if (resolutionMode === 'agent_first') {
                const agentResult = await fetchTaskContextCapability(
                    fetcher,
                    capabilityRuntime,
                    baseParams,
                    capabilityHooks,
                );
                traces.push(...agentResult.traces);

                if (isUsableTaskContextNormalized(agentResult.normalized)) {
                    const normalizedTickets: TaskContextNormalized[] = [
                        agentResult.normalized,
                    ];
                    const supplementalReferences =
                        resolveSupplementalReferences(
                            manifest,
                            agentResult.normalized,
                        );

                    if (supplementalReferences.length > 0) {
                        const supplementalResults = await fetchAllTaskContexts(
                            fetcher,
                            capabilityRuntime,
                            {
                                ...baseParams,
                                taskContextResolutionMode: 'cache_first',
                            },
                            supplementalReferences.map((reference) => ({
                                kind: reference.kind,
                                value: reference.value,
                            })),
                            capabilityHooks,
                        );
                        traces.push(...supplementalResults.traces);
                        normalizedTickets.push(
                            ...supplementalResults.normalized,
                        );
                        unresolvedReferences = mapScopedReferencesToTaskReferences(
                            supplementalResults.unresolvedReferences,
                        );
                    }

                    return {
                        value: normalizedTickets,
                        traces,
                        unresolvedReferences,
                    };
                }
            }

            const perReferenceResults = await fetchAllTaskContexts(
                fetcher,
                capabilityRuntime,
                {
                    ...baseParams,
                    taskContextResolutionMode: 'cache_first',
                },
                manifest.references.map((reference) => ({
                    kind: reference.kind,
                    value: reference.value,
                })),
                capabilityHooks,
            );
            traces.push(...perReferenceResults.traces);
            unresolvedReferences = mapScopedReferencesToTaskReferences(
                perReferenceResults.unresolvedReferences,
            );

            return {
                value: perReferenceResults.normalized,
                traces,
                unresolvedReferences,
            };
        },
    };
}

function buildTaskContextReadParams(
    ctx: BusinessRulesContext,
    scope: ExecutionScope,
    capabilityTools: ReturnType<typeof createCapabilityToolRuntime>,
    hooks: CapabilityExecutionHooks<BusinessRulesContext> | undefined,
    providerType: string,
    overrides?: {
        manifest?: TaskContextManifest;
        resolutionMode?: 'cache_first' | 'agent_first';
    },
) {
    const manifest = overrides?.manifest;
    const primaryReference = manifest?.primaryReference;
    const taskReferences = manifest?.references ?? [];
    const resolutionMode =
        overrides?.resolutionMode ??
        hooks?.resolveTaskContextMode?.(ctx, providerType) ??
        'agent_first';

    return {
        skillName: SKILL_NAME,
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        repositoryOwner: resolveRepositoryOwner(ctx),
        repositoryName: resolveRepositoryName(ctx),
        pullRequestNumber: resolvePullRequestNumber(ctx),
        prBody: ctx.prBody,
        headRef: resolvePullRequestHeadRef(ctx),
        userQuestion: readPrepareContextString(ctx, 'userQuestion'),
        pullRequestDescription: readPrepareContextString(
            ctx,
            'pullRequestDescription',
        ),
        pullRequestTitle: readPrepareContextString(ctx, 'pullRequestTitle'),
        taskContext: readPrepareContextString(ctx, 'taskContext'),
        taskId:
            primaryReference?.kind === 'key'
                ? primaryReference.value
                : readPrepareContextString(ctx, 'taskId'),
        taskUrl:
            primaryReference?.kind === 'url'
                ? primaryReference.value
                : readPrepareContextString(ctx, 'taskUrl'),
        taskReference:
            primaryReference?.label ??
            readPrepareContextString(ctx, 'taskReference'),
        userLanguage: ctx.userLanguage,
        thread: ctx.thread,
        excludedTools: resolveExcludedTools(capabilityTools),
        businessSignals: asBusinessSignalHints(ctx.prepareContext?.businessSignals),
        primaryReference,
        taskReferences,
        taskContextResolutionMode: resolutionMode,
        enableAgenticFallback:
            resolutionMode === 'agent_first'
                ? true
                : ctx.prepareContext?.enableAgenticFallback,
    };
}

function countSections(value: string, header: string): number {
    const pattern = new RegExp(`(^|\\n)\\s*${escapeRegExp(header)}\\b`, 'gim');
    return [...value.matchAll(pattern)].length;
}

function extractMarkdownSection(value: string, header: string): string {
    const pattern = new RegExp(
        `(?:^|\\n)\\s*## ${escapeRegExp(header)}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`,
        'im',
    );
    const match = value.match(pattern);
    return match?.[1]?.trim() ?? '';
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolvePullRequestNumber(
    ctx: BusinessRulesContext,
): number | undefined {
    const nested = ctx.prepareContext?.pullRequest?.pullRequestNumber;
    if (typeof nested === 'number') {
        return nested;
    }
    const legacy = ctx.prepareContext?.pullRequestNumber;
    if (typeof legacy === 'number') {
        return legacy;
    }
    return undefined;
}

function resolveExecutionScope(ctx: BusinessRulesContext): ExecutionScope {
    return {
        organizationId:
            ctx.organizationAndTeamData?.organizationId ?? 'unknown-org',
        teamId: ctx.organizationAndTeamData?.teamId ?? 'unknown-team',
    };
}

function resolvePullRequestRef(
    ctx: BusinessRulesContext,
): PullRequestRef | undefined {
    const organizationId = ctx.organizationAndTeamData?.organizationId;
    const teamId = ctx.organizationAndTeamData?.teamId;
    const repositoryId = resolveRepositoryId(ctx);
    const pullRequestNumber = resolvePullRequestNumber(ctx);

    if (
        typeof organizationId !== 'string' ||
        typeof teamId !== 'string' ||
        typeof repositoryId !== 'string' ||
        typeof pullRequestNumber !== 'number'
    ) {
        return undefined;
    }

    return {
        organizationId,
        teamId,
        repositoryId,
        pullRequestNumber,
    };
}

function resolveRepositoryId(ctx: BusinessRulesContext): string | undefined {
    const repositoryId = ctx.prepareContext?.repository?.id;
    if (typeof repositoryId === 'string' && repositoryId.trim().length > 0) {
        return repositoryId;
    }
    if (typeof repositoryId === 'number') {
        return String(repositoryId);
    }
    return undefined;
}

function resolveRepositoryName(ctx: BusinessRulesContext): string | undefined {
    const repositoryName = ctx.prepareContext?.repository?.name;
    return typeof repositoryName === 'string' ? repositoryName : undefined;
}

function resolveRepositoryOwner(ctx: BusinessRulesContext): string | undefined {
    const repositoryOwner = ctx.prepareContext?.repository?.owner;
    return typeof repositoryOwner === 'string' ? repositoryOwner : undefined;
}

function resolvePullRequestHeadRef(
    ctx: BusinessRulesContext,
): string | undefined {
    const headRef = ctx.prepareContext?.pullRequest?.headRef;
    if (typeof headRef === 'string') {
        return headRef;
    }
    const legacy = ctx.prepareContext?.headRef;
    return typeof legacy === 'string' ? legacy : undefined;
}

function readPrepareContextString(
    ctx: BusinessRulesContext,
    key: keyof NonNullable<BusinessRulesContext['prepareContext']>,
): string | undefined {
    const value = ctx.prepareContext?.[key];
    return typeof value === 'string' && value.trim().length > 0
        ? value
        : undefined;
}

function resolveExcludedTools(capabilityTools: {
    getToolName: (capability: string) => string | undefined;
}): string[] {
    return [
        capabilityTools.getToolName(PR_METADATA_CAPABILITY),
        capabilityTools.getToolName(PR_DIFF_CAPABILITY),
    ].filter((toolName): toolName is string => typeof toolName === 'string');
}

function getRegisteredToolNames(fetcher: ToolCaller): string[] {
    return fetcher
        .getRegisteredTools()
        .map((tool) => tool.name ?? '')
        .filter((toolName) => toolName.trim().length > 0);
}

function buildCapabilityExecutionContext(
    ctx: BusinessRulesContext,
    provider: string,
): {
    skillName: string;
    organizationId: string;
    teamId: string;
    provider: string;
} {
    const scope = resolveExecutionScope(ctx);
    return {
        skillName: SKILL_NAME,
        organizationId: scope.organizationId,
        teamId: scope.teamId,
        provider,
    };
}

async function recordCapabilityExecutionTraces(
    hooks: CapabilityExecutionHooks<BusinessRulesContext> | undefined,
    traces: CapabilityExecutionTrace[],
): Promise<void> {
    await Promise.all(traces.map((trace) => hooks?.recordExecution?.(trace)));
}

function asBusinessSignalHints(
    value: BusinessRulesContext['prepareContext'] extends {
        businessSignals?: infer T;
    }
        ? T
        : unknown,
):
    | {
          ticketKeys?: string[];
          taskLinks?: string[];
          requirementKeywords?: string[];
      }
    | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const input = value as {
        ticketKeys?: unknown;
        taskLinks?: unknown;
        requirementKeywords?: unknown;
    };

    const ticketKeys = sanitizeStringArray(input.ticketKeys);
    const taskLinks = sanitizeStringArray(input.taskLinks);
    const requirementKeywords = sanitizeStringArray(input.requirementKeywords);

    if (!ticketKeys && !taskLinks && !requirementKeywords) {
        return undefined;
    }

    return {
        ticketKeys,
        taskLinks,
        requirementKeywords,
    };
}

function resolveSupplementalReferences(
    manifest: TaskContextManifest,
    agentTicket: TaskContextNormalized,
): TaskReference[] {
    const agentSurface = buildAgentTaskContextSurface(agentTicket);
    const primaryKey =
        manifest.primaryReference?.kind === 'key'
            ? manifest.primaryReference.value.trim().toUpperCase()
            : undefined;
    const primaryUrl =
        manifest.primaryReference?.kind === 'url'
            ? normalizeTaskReferenceUrl(manifest.primaryReference.value)
            : undefined;

    return manifest.references.filter((reference) => {
        if (
            primaryKey &&
            reference.kind === 'key' &&
            reference.value.trim().toUpperCase() === primaryKey
        ) {
            return false;
        }

        if (
            primaryUrl &&
            reference.kind === 'url' &&
            normalizeTaskReferenceUrl(reference.value) === primaryUrl
        ) {
            return false;
        }

        if (reference.kind === 'key') {
            const normalizedKey = reference.value.trim().toUpperCase();
            if (
                !normalizedKey ||
                agentSurfaceContainsIssueKey(agentSurface, normalizedKey)
            ) {
                return false;
            }

            return true;
        }

        const normalizedUrl = normalizeTaskReferenceUrl(reference.value);
        if (!normalizedUrl) {
            return false;
        }

        return !agentSurface.includes(normalizedUrl.toUpperCase());
    });
}

function mapScopedReferencesToTaskReferences(
    references: Array<{ kind: 'key' | 'url'; value: string }>,
): TaskReference[] {
    return references.map((reference) => ({
        kind: reference.kind,
        value:
            reference.kind === 'key'
                ? reference.value.trim().toUpperCase()
                : reference.value.trim(),
        label: reference.value.trim(),
        source: 'body' as const,
    }));
}

function normalizeTaskReferenceUrl(url: string): string {
    return url.trim().replace(/[),.;]+$/g, '');
}

function buildAgentTaskContextSurface(
    ticket: TaskContextNormalized,
): string {
    return [ticket.id, ticket.title, ticket.description]
        .filter((part): part is string => typeof part === 'string')
        .join('\n')
        .toUpperCase();
}

function agentSurfaceContainsIssueKey(
    agentSurface: string,
    issueKey: string,
): boolean {
    const normalizedKey = issueKey.trim().toUpperCase();
    if (!normalizedKey) {
        return false;
    }

    const pattern = new RegExp(
        `(?<![A-Z0-9])${escapeRegExp(normalizedKey)}(?![A-Z0-9])`,
        'i',
    );
    return pattern.test(agentSurface);
}

function sanitizeStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const sanitized = value.filter(
        (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
    );

    return sanitized.length ? sanitized : undefined;
}

function hasMeaningfulText(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
}

function countRequirementListItems(value: string): number {
    return value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) =>
            /^(?:[-*]\s+|\d+\.\s+)(?!\[[ xX]\]\s*$).{10,}$/u.test(line),
        ).length;
}
