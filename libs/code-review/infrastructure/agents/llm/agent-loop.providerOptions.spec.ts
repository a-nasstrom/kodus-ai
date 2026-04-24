import { BYOKProvider } from '@kodus/kodus-common/llm';

import {
    buildProviderOptions,
    buildReasoningProviderOptions,
    EFFORT_TO_BUDGET,
    type ReasoningEffort,
} from './agent-loop';

describe('buildReasoningProviderOptions', () => {
    describe('returns {} when reasoning is off or provider is missing', () => {
        const cases: Array<{
            name: string;
            provider?: BYOKProvider | string;
            effort?: ReasoningEffort;
            modelName?: string;
        }> = [
            { name: 'effort=undefined', provider: BYOKProvider.ANTHROPIC },
            { name: 'effort=none', provider: BYOKProvider.ANTHROPIC, effort: 'none' },
            { name: 'provider=undefined', effort: 'high' },
            { name: 'provider=empty string', provider: '', effort: 'high' },
        ];

        it.each(cases)('$name → {}', ({ provider, effort, modelName }) => {
            expect(
                buildReasoningProviderOptions(provider, effort, modelName),
            ).toEqual({});
        });
    });

    describe('Anthropic', () => {
        it('uses adaptive thinking + outputConfig.effort for sonnet-4 family', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.ANTHROPIC,
                    'high',
                    'claude-sonnet-4-5-20250929',
                ),
            ).toEqual({
                anthropic: {
                    thinking: { type: 'adaptive' },
                    outputConfig: { effort: 'high' },
                },
            });
        });

        it('uses adaptive thinking for opus-4 family', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.ANTHROPIC,
                    'medium',
                    'claude-opus-4-1-20250805',
                ),
            ).toEqual({
                anthropic: {
                    thinking: { type: 'adaptive' },
                    outputConfig: { effort: 'medium' },
                },
            });
        });

        it('falls back to budgetTokens for older models (sonnet-3.7)', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.ANTHROPIC,
                    'high',
                    'claude-3-7-sonnet-20250219',
                ),
            ).toEqual({
                anthropic: {
                    thinking: {
                        type: 'enabled',
                        budgetTokens: EFFORT_TO_BUDGET.high,
                    },
                },
            });
        });

        it('falls back to budgetTokens when modelName is undefined (regression: agentName bug)', () => {
            // The original bug: agentName ("kodus-generalist-review-agent") was passed as modelName.
            // It does not match sonnet-4/opus-4 → should fall through to budgetTokens.
            // This test guarantees the behavior is consistent regardless of the modelName value.
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.ANTHROPIC,
                    'low',
                    undefined,
                ),
            ).toEqual({
                anthropic: {
                    thinking: {
                        type: 'enabled',
                        budgetTokens: EFFORT_TO_BUDGET.low,
                    },
                },
            });
        });
    });

    describe('Google Gemini', () => {
        it('uses thinkingLevel for Gemini 3+ (gemini-3.1-pro-preview)', () => {
            // This is THE regression we just shipped. Old code passed agentName,
            // detection failed, fell through to thinkingBudget. Now we pass modelId.
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.GOOGLE_GEMINI,
                    'high',
                    'gemini-3.1-pro-preview',
                ),
            ).toEqual({
                google: {
                    thinkingConfig: { thinkingLevel: 'high' },
                },
            });
        });

        it('uses thinkingLevel for any model containing "gemini-3"', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.GOOGLE_GEMINI,
                    'low',
                    'gemini-3-flash',
                ),
            ).toEqual({
                google: {
                    thinkingConfig: { thinkingLevel: 'low' },
                },
            });
        });

        it('uses thinkingBudget for Gemini 2.5', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.GOOGLE_GEMINI,
                    'high',
                    'gemini-2.5-pro',
                ),
            ).toEqual({
                google: {
                    thinkingConfig: { thinkingBudget: EFFORT_TO_BUDGET.high },
                },
            });
        });

        it('uses thinkingBudget for medium effort on Gemini 2.5', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.GOOGLE_GEMINI,
                    'medium',
                    'gemini-2.5-flash',
                ),
            ).toEqual({
                google: {
                    thinkingConfig: { thinkingBudget: EFFORT_TO_BUDGET.medium },
                },
            });
        });

        it('treats GOOGLE_VERTEX same as GOOGLE_GEMINI', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.GOOGLE_VERTEX,
                    'high',
                    'gemini-3.1-pro-preview',
                ),
            ).toEqual({
                google: {
                    thinkingConfig: { thinkingLevel: 'high' },
                },
            });
        });
    });

    describe('OpenAI', () => {
        it('emits reasoningEffort under openai key for o-series', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.OPENAI,
                    'high',
                    'o3-mini',
                ),
            ).toEqual({
                openai: { reasoningEffort: 'high' },
            });
        });

        it('emits reasoningEffort=low under openai key', () => {
            expect(
                buildReasoningProviderOptions(BYOKProvider.OPENAI, 'low'),
            ).toEqual({
                openai: { reasoningEffort: 'low' },
            });
        });
    });

    describe('OpenRouter', () => {
        it('emits reasoning.effort under openrouter key', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.OPEN_ROUTER,
                    'medium',
                ),
            ).toEqual({
                openrouter: { reasoning: { effort: 'medium' } },
            });
        });
    });

    describe('OpenAI-Compatible', () => {
        it('emits thinking.type=enabled (effort ignored)', () => {
            expect(
                buildReasoningProviderOptions(
                    BYOKProvider.OPENAI_COMPATIBLE,
                    'high',
                ),
            ).toEqual({
                openaiCompatible: { thinking: { type: 'enabled' } },
            });
        });
    });

    describe('Unknown providers', () => {
        it('returns {} for NOVITA (no thinking mapping yet)', () => {
            expect(
                buildReasoningProviderOptions(BYOKProvider.NOVITA, 'high'),
            ).toEqual({});
        });

        it('returns {} for unknown string provider', () => {
            expect(
                buildReasoningProviderOptions('madeup-provider', 'high'),
            ).toEqual({});
        });
    });
});

describe('buildProviderOptions', () => {
    it('always includes langsmith metadata', () => {
        const result = buildProviderOptions('my-run', {
            organizationId: 'org-1',
            teamId: 'team-1',
        });
        expect(result.langsmith).toEqual({
            name: 'my-run',
            metadata: {
                organizationId: 'org-1',
                teamId: 'team-1',
                pullRequestId: undefined,
                repositoryId: undefined,
                provider: undefined,
            },
        });
    });

    it('includes reasoning when effort + provider + model are provided', () => {
        const result = buildProviderOptions('main-loop', undefined, {
            byokProvider: BYOKProvider.GOOGLE_GEMINI,
            reasoningEffort: 'high',
            modelName: 'gemini-3.1-pro-preview',
        });
        expect(result.langsmith).toBeDefined();
        expect(result.google).toEqual({
            thinkingConfig: { thinkingLevel: 'high' },
        });
    });

    it('omits provider-specific reasoning when effort is none', () => {
        const result = buildProviderOptions('main-loop', undefined, {
            byokProvider: BYOKProvider.GOOGLE_GEMINI,
            reasoningEffort: 'none',
            modelName: 'gemini-3.1-pro-preview',
        });
        expect(result.google).toBeUndefined();
        expect(result.anthropic).toBeUndefined();
        expect(result.openai).toBeUndefined();
    });

    it('JSON override takes precedence over effort preset', () => {
        const result = buildProviderOptions('main-loop', undefined, {
            byokProvider: BYOKProvider.ANTHROPIC,
            reasoningEffort: 'high',
            modelName: 'claude-sonnet-4-5-20250929',
            reasoningConfigOverride: JSON.stringify({
                anthropic: { thinking: { type: 'enabled', budgetTokens: 999 } },
            }),
        });
        expect(result.anthropic).toEqual({
            thinking: { type: 'enabled', budgetTokens: 999 },
        });
        // Override replaces the preset entirely
        expect(result.anthropic.outputConfig).toBeUndefined();
    });

    it('falls back to effort preset when override JSON is invalid', () => {
        const result = buildProviderOptions('main-loop', undefined, {
            byokProvider: BYOKProvider.GOOGLE_GEMINI,
            reasoningEffort: 'high',
            modelName: 'gemini-3.1-pro-preview',
            reasoningConfigOverride: 'not-valid-json{{',
        });
        expect(result.google).toEqual({
            thinkingConfig: { thinkingLevel: 'high' },
        });
    });

    it('passes the run name through to langsmith', () => {
        const result = buildProviderOptions('agent-loop-coverage-recovery');
        expect(result.langsmith.name).toBe('agent-loop-coverage-recovery');
    });
});
