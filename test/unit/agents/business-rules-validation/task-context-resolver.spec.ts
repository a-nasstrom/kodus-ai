import {
    buildPrTextContext,
    dedupeTaskReferences,
    mergeTaskContextSources,
    resolvePipelineTaskReferences,
    shouldAttemptMcpFetch,
} from '@libs/agents/infrastructure/services/kodus-flow/business-rules-validation/task-context-resolver';

describe('task-context-resolver', () => {
    describe('buildPrTextContext', () => {
        it('builds a From PR section from title, branch and body', () => {
            const result = buildPrTextContext({
                title: 'Fix export PROJ-1',
                branch: 'feature/export',
                body: 'Implements export for admin users.',
            });

            expect(result).toContain('## From PR');
            expect(result).toContain('Title: Fix export PROJ-1');
            expect(result).toContain('Branch: feature/export');
            expect(result).toContain('Implements export for admin users.');
        });

        it('returns empty string when all inputs are blank', () => {
            expect(buildPrTextContext({})).toBe('');
        });
    });

    describe('dedupeTaskReferences', () => {
        it('deduplicates keys and URLs pointing to the same issue', () => {
            const refs = dedupeTaskReferences(
                ['PROJ-123', 'proj-123'],
                [
                    'https://kodustech.atlassian.net/browse/PROJ-123',
                    'https://kodustech.atlassian.net/browse/PROJ-456',
                ],
            );

            expect(refs).toHaveLength(2);
            expect(refs.map((ref) => ref.label)).toEqual(
                expect.arrayContaining(['PROJ-123', 'PROJ-456']),
            );
            expect(
                refs.some(
                    (ref) =>
                        ref.kind === 'key' && ref.value === 'PROJ-123',
                ),
            ).toBe(true);
        });
    });

    describe('resolvePipelineTaskReferences', () => {
        it('uses ticket keys and links from pipeline businessSignals only', () => {
            const refs = resolvePipelineTaskReferences({
                businessSignals: {
                    ticketKeys: ['PROJ-100', 'PROJ-101'],
                    taskLinks: [
                        'https://kodustech.atlassian.net/browse/PROJ-102',
                    ],
                    requirementKeywords: [],
                },
            });

            expect(refs.map((ref) => ref.label)).toEqual(
                expect.arrayContaining(['PROJ-100', 'PROJ-101', 'PROJ-102']),
            );
        });

        it('does not infer ticket keys from PR text when businessSignals are absent', () => {
            const refs = resolvePipelineTaskReferences({
                businessSignals: undefined,
            });

            expect(refs).toEqual([]);
        });

        it('ignores version-like strings in PR text without pipeline signals', () => {
            const refs = resolvePipelineTaskReferences({
                businessSignals: {
                    ticketKeys: [],
                    taskLinks: [],
                    requirementKeywords: [],
                },
            });

            expect(refs).toEqual([]);
        });
    });

    describe('shouldAttemptMcpFetch', () => {
        it('returns true only when MCPs and references are both present', () => {
            expect(
                shouldAttemptMcpFetch(['jira'], [
                    { kind: 'key', value: 'PROJ-1', label: 'PROJ-1' },
                ]),
            ).toBe(true);
            expect(shouldAttemptMcpFetch([], [{ kind: 'key', value: 'PROJ-1', label: 'PROJ-1' }])).toBe(
                false,
            );
            expect(shouldAttemptMcpFetch(['jira'], [])).toBe(false);
        });
    });

    describe('mergeTaskContextSources', () => {
        it('merges multiple ticket sections with From PR', () => {
            const merged = mergeTaskContextSources({
                mcpNormalizedList: [
                    {
                        id: 'PROJ-100',
                        title: 'Epic checkout',
                        description: 'Parent epic scope',
                    },
                    {
                        id: 'PROJ-101',
                        title: 'Sub-task validation',
                        acceptanceCriteria: ['Reject invalid card'],
                    },
                ],
                prTextContext: buildPrTextContext({
                    title: 'Checkout fixes',
                    body: 'Implements validation rules.',
                }),
            });

            expect(merged.taskContext).toContain('## From ticket PROJ-100');
            expect(merged.taskContext).toContain('## From ticket PROJ-101');
            expect(merged.taskContext).toContain('## From PR');
            expect(merged.taskContextNormalized?.acceptanceCriteria).toEqual([
                '[PROJ-101] Reject invalid card',
            ]);
        });

        it('returns PR-only context when MCP list is empty', () => {
            const prText = buildPrTextContext({ title: 'Title-only fix' });
            const merged = mergeTaskContextSources({
                mcpNormalizedList: [],
                prTextContext: prText,
            });

            expect(merged.taskContext).toBe(prText);
            expect(merged.taskContextNormalized).toBeUndefined();
        });
    });
});
