import type { ContextPack } from '@kodus/flow';

import type { CodeReviewPayload } from '@/shared/utils/langchainCommon/prompts/configuration/codeReview';
import { prompt_codereview_system_gemini_v2 } from '@/shared/utils/langchainCommon/prompts/configuration/codeReview';

const createBaseContextPack = (knowledgeContent: string): ContextPack => ({
    id: 'ctx::test',
    domain: 'code',
    version: '1.0.0',
    createdAt: Date.now(),
    createdBy: 'test-suite',
    budget: {
        limit: 10_000,
        usage: 0,
        breakdown: {},
    },
    layers: [
        {
            id: 'ctx::knowledge',
            kind: 'catalog',
            priority: 1,
            tokens: knowledgeContent.length,
            content: [
                {
                    id: 'knowledge::rule',
                    filePath: 'docs/rules.md',
                    repositoryName: 'kodus-runtime',
                    content: knowledgeContent,
                    lineRange: { start: 1, end: 5 },
                },
            ],
            references: [],
            metadata: {
                sourceType: 'knowledge',
            },
        },
    ],
});

describe('prompt_codereview_system_gemini_v2', () => {
    it('injects knowledge layer references into the generation instructions', () => {
        const knowledgeContent =
            '# Kodus Rules\n- Validate all external dependencies';

        const payload: CodeReviewPayload = {
            v2PromptOverrides: {
                categories: {
                    descriptions: {
                        bug: 'Bug focus',
                        performance: 'Performance focus',
                        security: 'Security focus',
                    },
                },
                severity: {
                    flags: {
                        critical: 'Critical impact',
                        high: 'High impact',
                        medium: 'Medium impact',
                        low: 'Low impact',
                    },
                },
                generation: {
                    main: 'Provide actionable findings',
                },
            },
            contextPack: createBaseContextPack(knowledgeContent),
        };

        const result = prompt_codereview_system_gemini_v2(payload);

        expect(result).toContain('docs/rules.md');
        expect(result).toContain(knowledgeContent);
        expect(result).toContain('## External Context & Injected Knowledge');
    });

    it('injects memories as additional context using only title and rule', () => {
        const payload: CodeReviewPayload = {
            memories: [
                {
                    title: 'Avoid mutable defaults',
                    rule: 'Never mutate default array/object parameters in functions.',
                    // extra fields from kody rules shape should be ignored in prompt rendering
                    path: 'src/**',
                } as any,
            ],
        };

        const result = prompt_codereview_system_gemini_v2(payload);

        expect(result).toContain('## Memories');
        expect(result).toContain('Title: Avoid mutable defaults');
        expect(result).toContain(
            'Rule: Never mutate default array/object parameters in functions.',
        );
        expect(result).toContain('## External Context & Injected Knowledge');
    });
});
