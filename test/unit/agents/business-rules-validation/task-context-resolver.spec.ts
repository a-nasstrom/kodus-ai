import {
    buildBusinessSignalsFromSources,
    buildPrTextContext,
    dedupeTaskReferences,
    hasExplicitTaskReferenceInput,
    mergeTaskContextSources,
    resolveTaskReferences,
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

    describe('resolveTaskReferences', () => {
        it('uses ticket keys and links from pipeline businessSignals only', () => {
            const refs = resolveTaskReferences({
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

        it('includes explicit taskId and taskUrl without re-scanning PR fields', () => {
            const refs = resolveTaskReferences({
                taskId: 'PROJ-999',
                taskUrl: 'https://kodustech.atlassian.net/browse/PROJ-888',
                businessSignals: undefined,
            });

            expect(refs.map((ref) => ref.label)).toEqual(
                expect.arrayContaining(['PROJ-999', 'PROJ-888']),
            );
        });

        it('extracts ticket keys from user-provided taskReference only', () => {
            const refs = resolveTaskReferences({
                taskReference:
                    '@kody -v business-logic\nAcceptance criteria for PROJ-55',
            });

            expect(refs).toEqual([
                expect.objectContaining({ kind: 'key', value: 'PROJ-55' }),
            ]);
        });

        it('does not infer ticket keys when no signals or explicit references exist', () => {
            expect(resolveTaskReferences({})).toEqual([]);
        });
    });

    describe('shouldAttemptMcpFetch', () => {
        it('returns true when explicit task references exist even without connected MCP hints', () => {
            expect(
                shouldAttemptMcpFetch(
                    [{ kind: 'key', value: 'PROJ-1', label: 'PROJ-1' }],
                    { hasExplicitTaskReference: true },
                ),
            ).toBe(true);
        });

        it('returns true for pipeline signals when task MCP is connected', () => {
            expect(
                shouldAttemptMcpFetch(
                    [{ kind: 'key', value: 'PROJ-1', label: 'PROJ-1' }],
                    {
                        connectedTaskMcps: ['jira'],
                        hasExplicitTaskReference: false,
                    },
                ),
            ).toBe(true);
        });

        it('returns false for pipeline signals when no task MCP is connected', () => {
            expect(
                shouldAttemptMcpFetch(
                    [{ kind: 'key', value: 'PROJ-1', label: 'PROJ-1' }],
                    {
                        connectedTaskMcps: [],
                        hasExplicitTaskReference: false,
                    },
                ),
            ).toBe(false);
        });

        it('returns false when references are empty', () => {
            expect(shouldAttemptMcpFetch([], { connectedTaskMcps: ['jira'] })).toBe(
                false,
            );
        });
    });

    describe('hasExplicitTaskReferenceInput', () => {
        it('detects explicit taskId, taskUrl, or taskReference', () => {
            expect(hasExplicitTaskReferenceInput({ taskId: 'PROJ-1' })).toBe(
                true,
            );
            expect(
                hasExplicitTaskReferenceInput({
                    taskReference: '@kody -v business-logic',
                }),
            ).toBe(true);
            expect(hasExplicitTaskReferenceInput({})).toBe(false);
        });
    });

    describe('buildBusinessSignalsFromSources', () => {
        it('merges explicit task id with scanned combined sources', () => {
            const signals = buildBusinessSignalsFromSources({
                combinedForTickets: 'Implements PROJ-100',
                bodyForKeywords: 'Given user acceptance criteria',
                taskId: 'PROJ-200',
            });

            expect(signals.ticketKeys).toEqual(
                expect.arrayContaining(['PROJ-100', 'PROJ-200']),
            );
            expect(signals.requirementKeywords).toContain('acceptance criteria');
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
