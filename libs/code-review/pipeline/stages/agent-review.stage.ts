import { createLogger } from '@kodus/flow';
import { Output, jsonSchema } from 'ai';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { getInternalModel } from '@libs/code-review/infrastructure/agents/llm/byok-to-vercel';
import {
    tracedGenerateText,
    buildLangSmithProviderOptions,
} from '@libs/code-review/infrastructure/agents/llm/agent-loop';
import type { LangSmithTelemetryMetadata } from '@libs/code-review/infrastructure/agents/llm/agent-loop';

import { BasePipelineStage } from '@libs/core/infrastructure/pipeline/abstracts/base-stage.abstract';
import { StageVisibility } from '@libs/core/infrastructure/pipeline/enums/stage-visibility.enum';
import { CodeSuggestion } from '@libs/core/infrastructure/config/types/general/codeReview.type';
import { ReviewOrchestratorService } from '@libs/code-review/infrastructure/agents/review-orchestrator.service';
import { ObservabilityService } from '@libs/core/log/observability.service';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@libs/automation/domain/automationExecution/contracts/automation-execution.service';
import { AutomationStatus } from '@libs/automation/domain/automation/enum/automation-status';
import { AgentProgressEvent } from '@libs/code-review/infrastructure/agents/base-code-review-agent.provider';
import {
    resolveKodyRuleSeverityLevel,
    SeverityLevel,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { DocumentationSearchAdapter } from '@libs/code-review/infrastructure/agents/llm/agent-tools.factory';
import { DeliveryStatus } from '@libs/platformData/domain/pullRequests/enums/deliveryStatus.enum';

/**
 * Extract valid line ranges from a unified diff patch.
 * Returns an array of [start, end] tuples representing lines on the RIGHT side
 * that GitHub allows for inline comments.
 *
 * For each hunk, we track which RIGHT-side lines exist (context + added).
 * GitHub only allows comments on lines that appear in the diff.
 */
function extractValidDiffLines(patch?: string): Array<[number, number]> {
    if (!patch) return [];

    const ranges: Array<[number, number]> = [];
    const lines = patch.split('\n');
    let rightLine = 0;
    let hunkStart = 0;

    for (const line of lines) {
        // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            // Save previous hunk
            if (hunkStart > 0 && rightLine > hunkStart) {
                ranges.push([hunkStart, rightLine - 1]);
            }
            rightLine = parseInt(hunkMatch[1], 10);
            hunkStart = rightLine;
            continue;
        }

        if (hunkStart === 0) continue; // before first hunk

        if (line.startsWith('-')) {
            // Deleted line — only exists on LEFT side, skip
            continue;
        }

        if (line.startsWith('\\')) {
            // "No newline at end of file" — skip
            continue;
        }

        // Context line (space prefix) or added line (+) — exists on RIGHT
        rightLine++;
    }

    // Save last hunk
    if (hunkStart > 0 && rightLine > hunkStart) {
        ranges.push([hunkStart, rightLine - 1]);
    }

    return ranges;
}

/**
 * Snap suggestion line numbers to the closest valid diff range.
 * If the suggestion lines don't overlap any diff range, finds the nearest one.
 */
function snapLinesToDiff(
    suggestion: Partial<CodeSuggestion>,
    validRanges: Array<[number, number]>,
): Partial<CodeSuggestion> {
    if (validRanges.length === 0) return suggestion;

    const start = suggestion.relevantLinesStart;
    const end = suggestion.relevantLinesEnd;

    if (!start || !end) {
        // No lines specified — use the first valid range
        const [rs, re] = validRanges[0];
        return {
            ...suggestion,
            relevantLinesStart: rs,
            relevantLinesEnd: Math.min(re, rs + 5),
        };
    }

    // Find all overlapping ranges and pick the best one (largest overlap)
    let bestOverlap: [number, number] | null = null;
    let bestOverlapSize = 0;

    for (const [rs, re] of validRanges) {
        if (start <= re && end >= rs) {
            const overlapStart = Math.max(start, rs);
            const overlapEnd = Math.min(end, re);
            const overlapSize = overlapEnd - overlapStart;
            if (overlapSize > bestOverlapSize) {
                bestOverlapSize = overlapSize;
                bestOverlap = [overlapStart, overlapEnd];
            }
        }
    }

    if (bestOverlap) {
        return {
            ...suggestion,
            relevantLinesStart: bestOverlap[0],
            relevantLinesEnd: bestOverlap[1],
        };
    }

    // No overlap — find the closest range
    let closestRange = validRanges[0];
    let closestDist = Infinity;

    for (const [rs, re] of validRanges) {
        const dist = Math.min(Math.abs(start - rs), Math.abs(start - re));
        if (dist < closestDist) {
            closestDist = dist;
            closestRange = [rs, re];
        }
    }

    const [rs, re] = closestRange;
    const clampedStart = Math.max(rs, Math.min(start, re));
    const clampedEnd = Math.min(re, Math.max(clampedStart, end));

    return {
        ...suggestion,
        relevantLinesStart: clampedStart,
        relevantLinesEnd: clampedEnd,
    };
}

export const DOCUMENTATION_SEARCH_ADAPTER_TOKEN = Symbol(
    'DOCUMENTATION_SEARCH_ADAPTER_TOKEN',
);

/**
 * Pipeline stage that runs the agent-based code review.
 *
 * Agent-based code review:
 * - Passes all changed files + sandbox to the ReviewOrchestrator
 * - Orchestrator dispatches specialized agents (bug, security, performance) in parallel
 * - Agents investigate the codebase using sandbox tools before suggesting
 * - Results are stored in context.fileAnalysisResults for downstream stages
 */
@Injectable()
export class AgentReviewStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'AgentReviewStage';
    readonly label = 'Agent-Based Code Review';
    readonly visibility = StageVisibility.PRIMARY;

    private readonly logger = createLogger(AgentReviewStage.name);

    constructor(
        private readonly reviewOrchestrator: ReviewOrchestratorService,
        private readonly observabilityService: ObservabilityService,
        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,
        @Optional()
        // ReflectionAgentProvider removed
        @Optional()
        @Inject(DOCUMENTATION_SEARCH_ADAPTER_TOKEN)
        private readonly documentationSearchService?: DocumentationSearchAdapter,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        const prNumber = context.pullRequest?.number;
        const changedFiles = context.changedFiles;

        if (!changedFiles?.length) {
            this.logger.log({
                message: `[AGENT] Skipping agent review: no changed files for PR#${prNumber}`,
                context: this.stageName,
            });
            return context;
        }

        if (!context.sandboxHandle?.remoteCommands) {
            this.logger.warn({
                message: `[AGENT] Skipping agent review: no sandbox available for PR#${prNumber}. Agent review requires a sandbox for code investigation.`,
                context: this.stageName,
                metadata: {
                    prNumber,
                    organizationAndTeamData: context.organizationAndTeamData,
                },
            });
            return context;
        }

        const reviewOptions = context.codeReviewConfig?.reviewOptions || {
            bug: true,
            security: true,
            performance: true,
        };

        const startTime = Date.now();

        this.logger.log({
            message: `[AGENT] Starting agent review for PR#${prNumber} with ${changedFiles.length} files`,
            context: this.stageName,
            metadata: {
                prNumber,
                filesCount: changedFiles.length,
                reviewOptions,
                organizationId: context.organizationAndTeamData?.organizationId,
                teamId: context.organizationAndTeamData?.teamId,
            },
        });

        try {
            // Build progress callback for real-time agent traces in PR timeline
            const executionUuid =
                context.pipelineMetadata?.lastExecution?.uuid ||
                context.correlationId;
            const repositoryId = context.repository?.id;

            // Shared telemetry metadata for all LangSmith-traced calls in this pipeline run
            const telemetryMeta: LangSmithTelemetryMetadata = {
                organizationId: context.organizationAndTeamData?.organizationId,
                teamId: context.organizationAndTeamData?.teamId,
                pullRequestId: prNumber,
                repositoryId,
            };

            const onAgentProgress = this.createAgentProgressCallback(
                executionUuid,
                prNumber,
                repositoryId,
            );

            const result = await this.reviewOrchestrator.execute({
                organizationAndTeamData: context.organizationAndTeamData,
                changedFiles,
                remoteCommands: context.sandboxHandle.remoteCommands,
                prNumber,
                repositoryId,
                repositoryFullName:
                    context.repository?.fullName ||
                    context.pullRequest?.base?.repo?.fullName ||
                    '',
                languageResultPrompt:
                    context.codeReviewConfig?.languageResultPrompt || 'en-US',
                memoryRules: context.codeReviewConfig?.kodyMemoryRules,
                v2PromptOverrides: context.codeReviewConfig?.v2PromptOverrides,
                generationMain:
                    context.codeReviewConfig?.v2PromptOverrides?.generation
                        ?.main,
                documentationSearchService:
                    this.documentationSearchService || undefined,
                prTitle: context.pullRequest?.title,
                prBody: context.pullRequest?.body,
                kodyRules: context.codeReviewConfig?.kodyRules,
                reviewOptions,
                onAgentProgress,
                gitHubToken: await this.resolveGitHubToken(context),
                baseBranch:
                    context.sandboxHandle?.baseBranch ||
                    context.pullRequest?.base?.ref ||
                    context.repository?.defaultBranch,
            });

            const durationMs = Date.now() - startTime;

            this.logger.log({
                message: `[TIMING] AgentReviewStage completed for PR#${prNumber}: ${result.suggestions.length} suggestions in ${durationMs}ms`,
                context: this.stageName,
                metadata: {
                    prNumber,
                    suggestionsCount: result.suggestions.length,
                    agentResults: result.agentResults.map((r) => ({
                        agent: r.agentName,
                        suggestions: r.suggestions.length,
                        turns: r.turnsUsed,
                        durationMs: r.durationMs,
                    })),
                    durationMs,
                },
            });

            // Snap suggestion line numbers to valid diff ranges before passing downstream.
            // GitHub rejects inline comments on lines that aren't part of the diff.
            const validatedSuggestions = result.suggestions.map((s) => {
                const file = changedFiles.find(
                    (f) => f.filename === s.relevantFile,
                );
                if (!file) return s;
                const validRanges = extractValidDiffLines(file.patch);
                const snapped = snapLinesToDiff(s, validRanges);
                if (
                    snapped.relevantLinesStart !== s.relevantLinesStart ||
                    snapped.relevantLinesEnd !== s.relevantLinesEnd
                ) {
                    this.logger.log({
                        message: `[AGENT] Snapped lines for ${s.relevantFile}: ${s.relevantLinesStart}-${s.relevantLinesEnd} → ${snapped.relevantLinesStart}-${snapped.relevantLinesEnd}`,
                        context: this.stageName,
                    });
                }
                return snapped;
            });

            // Verify/Discover removed — was hurting recall across all models.
            // Benchmark showed F1 drops of -5.7pp to -18.3pp with verify enabled.
            const reflectedSuggestions = validatedSuggestions;

            // Classify level (issue/warning) using Gemini 3 Flash
            // Separated from agent generation for consistency — BYOK models
            // are unreliable at classification but good at finding bugs.
            //
            // Kody Rules suggestions skip LLM classification — their level comes
            // directly from the severityLevel configured by the user on the rule.
            const kodyRulesSuggestions = reflectedSuggestions.filter(
                (s) => s.label === 'kody_rules',
            );
            const nonKodyRulesSuggestions = reflectedSuggestions.filter(
                (s) => s.label !== 'kody_rules',
            );

            // Map Kody Rules severity to level using the rule's configured severityLevel.
            // The agent returns the rule UUID in brokenKodyRulesIds — use it for exact matching.
            const kodyRulesById = new Map(
                (context.codeReviewConfig?.kodyRules ?? [])
                    .filter((r) => r.uuid)
                    .map((r) => [r.uuid!, r]),
            );
            const kodyRulesWithLevel = kodyRulesSuggestions.map((s) => {
                const ruleUuid = s.brokenKodyRulesIds?.[0];
                const matchedRule = ruleUuid
                    ? kodyRulesById.get(ruleUuid)
                    : undefined;
                const severityLevel = matchedRule
                    ? resolveKodyRuleSeverityLevel(matchedRule)
                    : SeverityLevel.ISSUE;
                return { ...s, level: severityLevel };
            });

            const prContext = [
                context.pullRequest?.title
                    ? `PR: ${context.pullRequest.title}`
                    : '',
                context.pullRequest?.body
                    ? context.pullRequest.body.substring(0, 500)
                    : '',
            ]
                .filter(Boolean)
                .join('\n');

            const levelOverrides =
                context.codeReviewConfig?.v2PromptOverrides?.level;
            const classifiedNonRules = await this.classifyLevels(
                nonKodyRulesSuggestions,
                prNumber,
                prContext,
                levelOverrides,
                telemetryMeta,
            );

            // Merge back: classified non-rules + kody rules with user-defined levels
            const classified = [...classifiedNonRules, ...kodyRulesWithLevel];

            // Deduplicate suggestions that describe the same issue.
            // Kody Rules skip dedup — they are user-defined rules that must always be reported.
            const kodyRulesForDedup = classified.filter(
                (s) => s.label === 'kody_rules',
            );
            const nonKodyRulesForDedup = classified.filter(
                (s) => s.label !== 'kody_rules',
            );

            let dedupedNonRules = nonKodyRulesForDedup;
            try {
                dedupedNonRules = await this.deduplicateSuggestions(
                    nonKodyRulesForDedup,
                    prNumber,
                    context.codeReviewConfig?.byokConfig,
                    telemetryMeta,
                );
            } catch (dedupError) {
                this.logger.warn({
                    message: `[DEDUP] Failed for PR#${prNumber}, keeping all suggestions`,
                    context: this.stageName,
                    error: dedupError,
                });
            }

            const deduped = [...dedupedNonRules, ...kodyRulesForDedup];

            // Enrich kody_rules suggestions with links to the rule page
            const baseUrl = process.env.API_USER_INVITE_BASE_URL || '';
            for (const s of deduped) {
                if (s.label !== 'kody_rules' || !s.brokenKodyRulesIds?.[0])
                    continue;
                const ruleId = s.brokenKodyRulesIds[0];
                const rule = kodyRulesById.get(ruleId);
                if (!rule?.title) continue;

                const repoPath =
                    rule.repositoryId === 'global'
                        ? 'global'
                        : rule.repositoryId;
                const ruleLink = `${baseUrl}/settings/code-review/${repoPath}/kody-rules/${ruleId}`;
                const escapedTitle = rule.title.replace(
                    /([[\]\\`*_{}()#+\-.!])/g,
                    '\\$1',
                );
                const markdownLink = `[${escapedTitle}](${ruleLink})`;

                let content = s.suggestionContent || '';
                if (content.includes(rule.title)) {
                    // Replace the first occurrence of the title with the link
                    content = content.replace(rule.title, markdownLink);
                } else {
                    // Append a link line at the end
                    content += `\n\nKody rule violation: ${markdownLink}`;
                }
                s.suggestionContent = content;
            }

            // Separate PR-level kody rules (no file/lines) from file-level suggestions.
            // PR-level suggestions go to validSuggestionsByPR → CreatePrLevelCommentsStage.
            const prLevelSuggestions = deduped.filter(
                (s) =>
                    s.label === 'kody_rules' &&
                    !s.relevantFile &&
                    !s.relevantLinesStart,
            );
            const fileLevelSuggestions = deduped.filter(
                (s) =>
                    !(
                        s.label === 'kody_rules' &&
                        !s.relevantFile &&
                        !s.relevantLinesStart
                    ),
            );

            // Sort file-level suggestions: kody_rules first, then by level (critical > issue > warning)
            const levelOrder: Record<string, number> = {
                critical: 0,
                issue: 1,
                warning: 2,
            };
            fileLevelSuggestions.sort((a, b) => {
                // kody_rules always first within the same file
                const aIsRule = a.label === 'kody_rules' ? 0 : 1;
                const bIsRule = b.label === 'kody_rules' ? 0 : 1;
                if (aIsRule !== bIsRule) return aIsRule - bIsRule;
                // Then by level
                const aLevel = levelOrder[a.level || 'warning'] ?? 2;
                const bLevel = levelOrder[b.level || 'warning'] ?? 2;
                return aLevel - bLevel;
            });

            return this.updateContext(context, (draft) => {
                const byFile = new Map<string, Partial<CodeSuggestion>[]>();
                for (const s of fileLevelSuggestions) {
                    const file = s.relevantFile || '';
                    if (!byFile.has(file)) byFile.set(file, []);
                    byFile.get(file)!.push(s);
                }

                draft.fileAnalysisResults = [];
                for (const [filename, suggestions] of byFile) {
                    const file = changedFiles.find(
                        (f) => f.filename === filename,
                    );
                    if (file) {
                        draft.fileAnalysisResults.push({
                            validSuggestionsToAnalyze: suggestions,
                            discardedSuggestionsBySafeGuard: [],
                            file,
                        });
                    }
                }

                // PR-level kody rules go to validSuggestionsByPR for CreatePrLevelCommentsStage
                if (prLevelSuggestions.length > 0) {
                    if (!draft.validSuggestionsByPR) {
                        draft.validSuggestionsByPR = [];
                    }
                    draft.validSuggestionsByPR.push(
                        ...prLevelSuggestions.map((s) => ({
                            id:
                                s.brokenKodyRulesIds?.[0] ||
                                crypto.randomUUID(),
                            suggestionContent: s.suggestionContent || '',
                            oneSentenceSummary: s.oneSentenceSummary || '',
                            label: (s.label as any) || 'kody_rules',
                            level: s.level,
                            severity: s.level as any, // Use resolved severityLevel for badge display
                            brokenKodyRulesIds: s.brokenKodyRulesIds,
                            deliveryStatus: DeliveryStatus.NOT_SENT,
                        })),
                    );
                }

                draft.validSuggestions = deduped;
            });
        } catch (error) {
            const durationMs = Date.now() - startTime;
            this.logger.error({
                message: `[AGENT] Agent review failed for PR#${prNumber} after ${durationMs}ms, continuing with empty results`,
                context: this.stageName,
                error,
                metadata: {
                    prNumber,
                    durationMs,
                    organizationAndTeamData: context.organizationAndTeamData,
                },
            });

            // Non-fatal: return context with empty results
            return this.updateContext(context, (draft) => {
                draft.fileAnalysisResults = [];
            });
        }
    }

    /**
     * Deduplicate suggestions that describe the same issue using LLM.
     * Groups by file, then asks Gemini Flash which suggestions are duplicates.
     */
    /**
     * Classify each suggestion as "issue" or "warning" using Gemini 3 Flash
     * via OpenRouter. Separated from agent generation because BYOK models
     * are inconsistent at classification.
     *
     * Uses XML prompt (dr1) + stripped category labels to avoid keyword
     * anchoring bias. Eval score: 85% on 34 test cases.
     */
    private async classifyLevels(
        suggestions: Partial<CodeSuggestion>[],
        prNumber: number,
        prContext?: string,
        levelOverrides?: {
            critical?: string;
            issue?: string;
            warning?: string;
        },
        telemetryMeta?: LangSmithTelemetryMetadata,
    ): Promise<Partial<CodeSuggestion>[]> {
        if (suggestions.length === 0) return suggestions;

        // Use Gemini 3 Flash for classification via Google AI
        // Falls back to getInternalModel() if Google key not available
        let model: any;
        const googleKey =
            process.env.API_GOOGLE_AI_API_KEY || process.env.GOOGLE_API_KEY;
        if (googleKey) {
            const { createGoogleGenerativeAI } = require('@ai-sdk/google');
            model = createGoogleGenerativeAI({ apiKey: googleKey })(
                'gemini-3-flash-preview',
            );
        } else {
            model = getInternalModel();
        }
        if (!model) {
            return suggestions.map((s) => ({ ...s, level: 'issue' as const }));
        }

        try {
            // Strip category labels ([security], [bug], [performance]) to avoid
            // keyword anchoring bias — the classifier should reason from the
            // description, not the label.
            const summaries = suggestions
                .map(
                    (s, i) =>
                        `[${i}] ${s.relevantFile}:${s.relevantLinesStart}-${s.relevantLinesEnd}
  Description: ${s.suggestionContent?.substring(0, 300) || s.oneSentenceSummary || 'N/A'}
  Existing code: ${s.existingCode?.substring(0, 150) || 'N/A'}
  Suggested fix: ${s.improvedCode?.substring(0, 150) || 'N/A'}`,
                )
                .join('\n\n');

            const classifyResult: any = await tracedGenerateText({
                model: model as any,
                experimental_telemetry: {
                    isEnabled: true,
                    functionId: 'classify-suggestions',
                },
                providerOptions: buildLangSmithProviderOptions(
                    'classify-suggestions',
                    telemetryMeta,
                ),
                output: Output.object({
                    schema: jsonSchema({
                        type: 'object',
                        properties: {
                            classifications: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        index: { type: 'number' },
                                        level: {
                                            type: 'string',
                                            enum: [
                                                'critical',
                                                'issue',
                                                'warning',
                                            ],
                                        },
                                    },
                                    required: ['index', 'level'],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ['classifications'],
                        additionalProperties: false,
                    }),
                }) as any,
                prompt: `<LevelClassifier>
  <Context>Each finding was confirmed by an expert code review agent. Classify only — do not question validity.</Context>${prContext ? `\n  <PRContext>${prContext}</PRContext>` : ''}
  <Definitions>
    <Level name="critical">${levelOverrides?.critical || 'The code WILL crash, lose/corrupt data, or open a severe security breach in production. Immediate fix required before merge. Examples: null pointer dereference on every request, SQL injection, unhandled exception that kills the process, data written to wrong table/column, authentication bypass.'}</Level>
    <Level name="issue">${levelOverrides?.issue || 'The code produces WRONG results or fails to perform its intended function in at least one scenario, but does not cause catastrophic failure. Should be fixed but can be evaluated. Examples: race condition under concurrent load, missing error handling that returns wrong status code, edge case that produces incorrect output, missing await that may lose data.'}</Level>
    <Level name="warning">${levelOverrides?.warning || 'The code produces CORRECT results and performs its intended function in ALL scenarios but is suboptimal. Examples: N+1 query, missing caching, verbose code, unnecessary allocation, style issues.'}</Level>
  </Definitions>
  <DecisionRule>
    Step 1: "Will this crash, lose data, or open a security breach on EVERY or MOST requests that hit this code path?"
    YES → critical.

    Step 2: "Does the code produce WRONG output, fail silently, or break in at least one realistic scenario?"
    YES → issue.

    Step 3: Everything else → warning.

    critical = guaranteed production incident. The bug hits most/all users on this code path.
    issue = real bug but requires specific conditions (edge case, race condition, specific input).
    warning = code works correctly but could be better.

    "Runs without error" does NOT mean "correct". Code that executes silently but produces the wrong data or does nothing when it should — is issue (or critical if it affects most requests).

    Security: authentication bypass, injection, data exposure → critical. Missing rate limits, weak entropy → warning. Side-channel leaks → issue.
  </DecisionRule>
  <Findings>
${summaries}
  </Findings>
</LevelClassifier>`,
            });

            // Track token usage for classification LLM call
            try {
                const classifyUsage =
                    classifyResult.usage ?? classifyResult.totalUsage;
                if (classifyUsage) {
                    const classifyModelName = googleKey
                        ? 'gemini-3-flash'
                        : 'gpt-5.4-mini';
                    await this.observabilityService.runInSpan(
                        'classify-levels',
                        async () => classifyResult,
                        {
                            'gen_ai.usage.input_tokens':
                                classifyUsage.inputTokens ?? 0,
                            'gen_ai.usage.output_tokens':
                                classifyUsage.outputTokens ?? 0,
                            'gen_ai.usage.total_tokens':
                                classifyUsage.totalTokens ??
                                (classifyUsage.inputTokens ?? 0) +
                                    (classifyUsage.outputTokens ?? 0),
                            'gen_ai.response.model': classifyModelName,
                            'gen_ai.run.name': 'code-review-classify',
                            'type': 'system',
                            'prNumber': prNumber,
                        },
                    );
                }
            } catch {
                // Observability is best-effort
            }

            const output =
                (classifyResult as any).object ??
                (classifyResult as any).output;
            const classifications = output?.classifications || [];

            const levelMap = new Map<
                number,
                'critical' | 'issue' | 'warning'
            >();
            for (const c of classifications) {
                if (c.index != null && c.level) {
                    levelMap.set(c.index, c.level);
                }
            }

            const result = suggestions.map((s, i) => ({
                ...s,
                level: levelMap.get(i) || ('issue' as const),
            }));

            const criticalCount = result.filter(
                (s) => s.level === 'critical',
            ).length;
            const issueCount = result.filter((s) => s.level === 'issue').length;
            const warningCount = result.filter(
                (s) => s.level === 'warning',
            ).length;

            this.logger.log({
                message: `[CLASSIFY] PR#${prNumber}: ${criticalCount} critical, ${issueCount} issues, ${warningCount} warnings (${suggestions.length} total)`,
                context: this.stageName,
            });

            return result;
        } catch (error) {
            this.logger.warn({
                message: `[CLASSIFY] Failed for PR#${prNumber}, defaulting all to issue`,
                context: this.stageName,
                error,
            });
            // On failure, default to issue (inclusive)
            return suggestions.map((s) => ({
                ...s,
                level: 'issue' as const,
            }));
        }
    }

    private async deduplicateSuggestions(
        suggestions: Partial<CodeSuggestion>[],
        prNumber: number,
        byokConfig?: any,
        telemetryMeta?: LangSmithTelemetryMetadata,
    ): Promise<Partial<CodeSuggestion>[]> {
        if (suggestions.length <= 1) return suggestions;

        // Use Gemini 3 Flash for dedup — excellent structured output + code understanding
        const googleKey =
            process.env.API_GOOGLE_AI_API_KEY ||
            process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        if (!googleKey) return suggestions;

        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        const model = createGoogleGenerativeAI({ apiKey: googleKey })(
            'gemini-3-flash-preview',
        );

        try {
            // Build summaries with file + lines for cross-file comparison
            const summaries = suggestions
                .map(
                    (s, i) =>
                        `[${i}] ${s.relevantFile || 'unknown'}:${s.relevantLinesStart}-${s.relevantLinesEnd} [${s.label || 'unknown'}/${s.level || 'warning'}]: ${s.oneSentenceSummary || s.suggestionContent?.substring(0, 200)}${s.improvedCode ? `\n    fix: ${s.improvedCode.substring(0, 100)}` : ''}`,
                )
                .join('\n');

            const dedupResult: any = await tracedGenerateText({
                model: model as any,
                experimental_telemetry: {
                    isEnabled: true,
                    functionId: 'dedup-suggestions',
                },
                providerOptions: buildLangSmithProviderOptions(
                    'dedup-suggestions',
                    telemetryMeta,
                ),
                output: Output.object({
                    schema: jsonSchema({
                        type: 'object',
                        properties: {
                            groups: {
                                type: 'array',
                                description:
                                    'Groups of suggestions. Each group has a representative and its duplicates.',
                                items: {
                                    type: 'object',
                                    properties: {
                                        keep: {
                                            type: 'number',
                                            description:
                                                'Index of the best suggestion to keep as representative',
                                        },
                                        duplicates: {
                                            type: 'array',
                                            items: { type: 'number' },
                                            description:
                                                'Indices of duplicate suggestions (same bug, same or different locations)',
                                        },
                                    },
                                    required: ['keep', 'duplicates'],
                                    additionalProperties: false,
                                },
                            },
                            unique: {
                                type: 'array',
                                items: { type: 'number' },
                                description:
                                    'Indices of suggestions that have no duplicates',
                            },
                        },
                        required: ['groups', 'unique'],
                        additionalProperties: false,
                    }),
                }) as any,
                prompt: `You have ${suggestions.length} code review suggestions across multiple files in a PR. Identify duplicates and group them.

BE CONSERVATIVE — when in doubt, do NOT group. Only group when you are highly confident they describe the exact same bug.

There are TWO types of duplicates:

1. **EXACT DUPLICATES** (same bug, same location): Multiple suggestions pointing to the same file and overlapping lines describing the same issue. Keep the one with the most detail, discard the rest.

2. **CROSS-LOCATION DUPLICATES** (same bug pattern, different locations): Suggestions describing the EXACT SAME code pattern/bug but applied in different files (e.g., "forEach with async callback" found in 3 different files, or "missing null check on the same API call" in 2 files). These should be GROUPED — keep the best one as representative, list the others as duplicates.

NOT duplicates (keep both):
- Different bugs in the same file or nearby lines (e.g., "nil pointer" and "missing validation" in the same controller — these are DIFFERENT bugs)
- Different root causes even if they sound similar (e.g., "add nil check" vs "fix typo" — different problems)
- Suggestions about different code even if the description sounds similar

IGNORE the category label (bug/security/performance) when deciding — two agents can independently find the same issue.
Prefer keeping the suggestion with the most detail or clearest fix as the representative.

${summaries}`,
            });

            // Track token usage
            try {
                const dedupUsage = dedupResult.usage ?? dedupResult.totalUsage;
                if (dedupUsage) {
                    await this.observabilityService.runInSpan(
                        'dedup-suggestions',
                        async () => dedupResult,
                        {
                            'gen_ai.usage.input_tokens':
                                dedupUsage.inputTokens ?? 0,
                            'gen_ai.usage.output_tokens':
                                dedupUsage.outputTokens ?? 0,
                            'gen_ai.usage.total_tokens':
                                dedupUsage.totalTokens ??
                                (dedupUsage.inputTokens ?? 0) +
                                    (dedupUsage.outputTokens ?? 0),
                            'gen_ai.response.model': 'internal-dedup',
                            'gen_ai.run.name': 'code-review-dedup',
                            'type': 'system',
                            'prNumber': prNumber,
                        },
                    );
                }
            } catch {
                // Observability is best-effort
            }

            const dedupOutput =
                (dedupResult as any).object ?? (dedupResult as any).output;

            this.logger.log({
                message: `[DEDUP-DEBUG] PR#${prNumber}: input=${suggestions.length}, groups=${dedupOutput?.groups?.length ?? 0}, unique=${dedupOutput?.unique?.length ?? 0}`,
                context: this.stageName,
            });

            const groups: Array<{
                keep: number;
                duplicates: number[];
            }> = dedupOutput?.groups || [];
            const unique: number[] = dedupOutput?.unique || [];

            // Safety: if LLM returns nothing useful, keep all
            if (groups.length === 0 && unique.length === 0) {
                this.logger.warn({
                    message: `[DEDUP] PR#${prNumber}: LLM returned empty result, keeping all ${suggestions.length} suggestions`,
                    context: this.stageName,
                });
                return suggestions;
            }

            const result: Partial<CodeSuggestion>[] = [];

            // Add unique suggestions as-is
            for (const idx of unique) {
                if (idx >= 0 && idx < suggestions.length) {
                    result.push(suggestions[idx]);
                }
            }

            // Process groups
            for (const group of groups) {
                const keepIdx = group.keep;
                const dupIndices = group.duplicates || [];

                if (keepIdx < 0 || keepIdx >= suggestions.length) continue;

                const kept = { ...suggestions[keepIdx] };

                // Collect locations from duplicates that are in DIFFERENT locations
                const otherLocations: string[] = [];
                for (const dupIdx of dupIndices) {
                    if (dupIdx < 0 || dupIdx >= suggestions.length) continue;
                    const dup = suggestions[dupIdx];
                    const dupLocation = `${dup.relevantFile}:${dup.relevantLinesStart}-${dup.relevantLinesEnd}`;
                    const keptLocation = `${kept.relevantFile}:${kept.relevantLinesStart}-${kept.relevantLinesEnd}`;

                    if (dupLocation !== keptLocation) {
                        otherLocations.push(dupLocation);
                    }

                    this.logger.log({
                        message: `[DEDUP-REMOVED] PR#${prNumber} ${dup.relevantFile}:${dup.relevantLinesStart}-${dup.relevantLinesEnd} [${dup.label}/${dup.severity}] "${dup.oneSentenceSummary || dup.suggestionContent?.substring(0, 80)}"`,
                        context: this.stageName,
                    });
                }

                // Append other locations to the suggestion content
                if (otherLocations.length > 0) {
                    const locationsList = otherLocations
                        .map((loc) => `- \`${loc}\``)
                        .join('\n');
                    kept.suggestionContent = `${kept.suggestionContent}\n\n**Also found in:**\n${locationsList}`;
                }

                result.push(kept);
            }

            const totalRemoved = suggestions.length - result.length;
            if (totalRemoved > 0) {
                this.logger.log({
                    message: `[DEDUP] PR#${prNumber}: ${suggestions.length} → ${result.length} (removed ${totalRemoved} duplicates, ${groups.length} groups merged)`,
                    context: this.stageName,
                });
            }

            return result;
        } catch (error) {
            this.logger.warn({
                message: `[DEDUP] PR#${prNumber}: Failed, keeping all ${suggestions.length} suggestions`,
                context: this.stageName,
                error,
            });
            return suggestions;
        }
    }

    /**
     * Creates a callback that writes agent progress to the PR timeline.
     * Each agent gets its own timeline entry (visibility: secondary).
     * Tool calls are batched — updates happen every 5 steps, not every call.
     */
    private createAgentProgressCallback(
        executionUuid: string | undefined,
        prNumber: number | undefined,
        repositoryId: string | undefined,
    ): (event: AgentProgressEvent) => void {
        // Track accumulated tool calls per agent for the final entry
        const agentToolCalls = new Map<
            string,
            Array<{ tool: string; args: string }>
        >();

        return (event: AgentProgressEvent) => {
            const stageName = `AgentReview::${event.agentName.replace('kodus-', '').replace('-review-agent', '')}`;
            const label = this.formatAgentLabel(event);

            // Fire-and-forget — don't block the agent loop
            this.writeAgentTrace(
                executionUuid,
                prNumber,
                repositoryId,
                stageName,
                event,
                label,
                agentToolCalls,
            ).catch(() => {
                // Best effort — don't fail the review if timeline write fails
            });
        };
    }

    private formatAgentLabel(event: AgentProgressEvent): string {
        const name = event.agentName
            .replace('kodus-', '')
            .replace('-review-agent', '');
        const icon =
            name === 'bug'
                ? 'Bug'
                : name === 'security'
                  ? 'Security'
                  : name === 'rules'
                    ? 'Rules'
                    : 'Performance';

        const duration = event.durationMs
            ? `in ${Math.round(event.durationMs / 1000)}s`
            : '';

        switch (event.status) {
            case 'started':
                return `${icon} Agent — investigating...`;
            case 'investigating':
                return `${icon} Agent — step ${event.step}, ${event.toolCalls?.length ?? 0} tool calls`;
            case 'completed': {
                const suffix =
                    event.source === 'second-chance'
                        ? ' (recovered via second-chance)'
                        : event.source === 'generate-object'
                          ? ' (structured by fallback)'
                          : '';
                return `${icon} Agent — ${event.findings ?? 0} findings ${duration}${suffix}`;
            }
            case 'error': {
                if (event.finishReason === 'timeout') {
                    return `${icon} Agent — timed out after ${duration} (${event.step ?? 0} steps)`;
                }
                if (event.finishReason === 'max-steps') {
                    return `${icon} Agent — hit step limit (${event.step ?? 0} steps, no findings)`;
                }
                return `${icon} Agent — failed ${duration}`;
            }
            default:
                return `${icon} Agent`;
        }
    }

    private async writeAgentTrace(
        executionUuid: string | undefined,
        prNumber: number | undefined,
        repositoryId: string | undefined,
        stageName: string,
        event: AgentProgressEvent,
        label: string,
        agentToolCalls: Map<string, Array<{ tool: string; args: string }>>,
    ): Promise<void> {
        if (!executionUuid && !prNumber) return;

        // Accumulate tool calls
        if (event.toolCalls) {
            const existing = agentToolCalls.get(event.agentName) || [];
            existing.push(...event.toolCalls);
            agentToolCalls.set(event.agentName, existing);
        }

        const status =
            event.status === 'completed'
                ? AutomationStatus.SUCCESS
                : event.status === 'error'
                  ? AutomationStatus.ERROR
                  : AutomationStatus.IN_PROGRESS;

        const metadata: Record<string, any> = {
            visibility: 'secondary',
            label,
        };

        // On completion/error, include full tool trace summary
        if (event.status === 'completed' || event.status === 'error') {
            const allCalls = agentToolCalls.get(event.agentName) || [];
            metadata.agentTrace = {
                steps: event.step,
                findings: event.findings,
                durationMs: event.durationMs,
                totalTokens: event.totalTokens,
                toolCalls: allCalls.slice(-30), // Keep last 30 to avoid huge payloads
                toolSummary: this.summarizeToolCalls(allCalls),
            };
        }

        const filter = executionUuid
            ? { uuid: executionUuid }
            : { pullRequestNumber: prNumber, repositoryId };

        try {
            // First event → create entry. Subsequent events → update existing.
            if (event.status === 'started') {
                await this.automationExecutionService.updateCodeReview(
                    filter,
                    { status },
                    label,
                    stageName,
                    metadata,
                );
            } else {
                // Find existing entry and update it (don't create duplicates)
                const existing = executionUuid
                    ? await this.automationExecutionService.findLatestStageLog(
                          executionUuid,
                          stageName,
                      )
                    : null;

                if (existing) {
                    const updateData: any = {
                        status,
                        message: label,
                        metadata: { ...existing.metadata, ...metadata },
                    };
                    if (
                        status === AutomationStatus.SUCCESS ||
                        status === AutomationStatus.ERROR
                    ) {
                        updateData.finishedAt = new Date();
                    }
                    await this.automationExecutionService.updateStageLog(
                        existing.uuid,
                        updateData,
                    );
                } else {
                    // Fallback: create if not found
                    await this.automationExecutionService.updateCodeReview(
                        filter,
                        { status },
                        label,
                        stageName,
                        metadata,
                    );
                }
            }
        } catch {
            // Best effort
        }
    }

    /**
     * Resolve GitHub token for cross-repo file reading (readReference tool).
     * Uses the same token that was used to clone the repo for the sandbox.
     */
    private async resolveGitHubToken(
        context: CodeReviewPipelineContext,
    ): Promise<string | undefined> {
        try {
            if (context.getFreshCloneParams) {
                const params = await context.getFreshCloneParams();
                return params?.authToken;
            }
        } catch {
            // Best effort — tool just won't be available
        }
        return undefined;
    }

    private summarizeToolCalls(
        calls: Array<{ tool: string; args: string }>,
    ): Record<string, number> {
        const summary: Record<string, number> = {};
        for (const c of calls) {
            summary[c.tool] = (summary[c.tool] || 0) + 1;
        }
        return summary;
    }
}
