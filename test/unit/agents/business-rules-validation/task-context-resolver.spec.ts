import {
    buildBusinessSignalsFromSources,
    buildPrTextContext,
    buildTaskContextManifest,
    dedupeTaskReferences,
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
        it('returns true when references are non-empty', () => {
            expect(
                shouldAttemptMcpFetch([
                    {
                        kind: 'key',
                        value: 'PROJ-1',
                        label: 'PROJ-1',
                        source: 'title',
                    },
                ]),
            ).toBe(true);
        });

        it('returns false when references are empty', () => {
            expect(shouldAttemptMcpFetch([])).toBe(false);
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

        it('anchors ticket scope to the PR title when body contains SRS cross-refs', () => {
            const signals = buildBusinessSignalsFromSources({
                title: 'LKDB-301: Unread messages folder in Messenger',
                body: [
                    'SRS: https://symfa.atlassian.net/wiki/spaces/SPD/pages/5192515598/SRS+Data+Breach+Operations+Portal',
                    'Cross-refs: LKDB-138, LKDB-169, LKDB-5, LKDB-109, LKDB-110, LKDB-21',
                ].join('\n'),
                bodyForKeywords: 'acceptance criteria',
            });

            expect(signals.ticketKeys).toEqual(['LKDB-301']);
            expect(signals.taskLinks).toEqual([
                'https://symfa.atlassian.net/wiki/spaces/SPD/pages/5192515598/SRS+Data+Breach+Operations+Portal',
            ]);
        });

        it('builds a manifest with title as primary reference', () => {
            const manifest = buildTaskContextManifest({
                title: 'LKDB-301: Unread messages folder in Messenger',
                businessSignals: buildBusinessSignalsFromSources({
                    title: 'LKDB-301: Unread messages folder in Messenger',
                    body: 'Adds unread folder row',
                }),
            });

            expect(manifest.primaryReference).toEqual(
                expect.objectContaining({
                    kind: 'key',
                    value: 'LKDB-301',
                    source: 'title',
                }),
            );
            expect(manifest.references[0]?.value).toBe('LKDB-301');
            expect(manifest.references[0]?.source).toBe('title');
        });

        it('tags branch and body references with source metadata', () => {
            const refs = resolveTaskReferences({
                title: 'Feature without ticket',
                branch: 'feature/PROJ-55-fix',
                body: 'See PROJ-99 and https://example.atlassian.net/browse/PROJ-100',
            });

            expect(refs).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        kind: 'key',
                        value: 'PROJ-55',
                        source: 'branch',
                    }),
                    expect.objectContaining({
                        kind: 'key',
                        value: 'PROJ-99',
                        source: 'body',
                    }),
                ]),
            );
        });

        it('resolves MCP references from title ticket for SRS-heavy PR bodies', () => {
            const refs = resolveTaskReferences({
                businessSignals: buildBusinessSignalsFromSources({
                    title: 'LKDB-301: Unread messages folder in Messenger',
                    body: 'See LKDB-138 and https://symfa.atlassian.net/wiki/spaces/SPD/pages/5192515598',
                }),
            });

            expect(refs).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ kind: 'key', value: 'LKDB-301' }),
                ]),
            );
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

        it('ignores lowercase branch tokens that are not valid issue keys', () => {
            const refs = resolveTaskReferences({
                title: 'Feature without ticket',
                branch: 'feature/v2-1-hotfix',
                body: 'No ticket keys here',
            });

            expect(refs).toEqual([]);
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

        it('deduplicates normalized tickets by id before merging sections', () => {
            const merged = mergeTaskContextSources({
                mcpNormalizedList: [
                    {
                        id: 'PROJ-100',
                        title: 'Epic checkout',
                        description: 'Agent payload',
                    },
                    {
                        id: 'PROJ-100',
                        title: 'Epic checkout duplicate',
                        description: 'Deterministic duplicate',
                    },
                ],
                prTextContext: '',
            });

            expect(merged.taskContext.match(/## From ticket PROJ-100/g)).toHaveLength(
                1,
            );
        });

        it('surfaces unresolved MCP references in the merged task context', () => {
            const merged = mergeTaskContextSources({
                mcpNormalizedList: [
                    {
                        id: 'PROJ-100',
                        title: 'Epic checkout',
                        description: 'Loaded ticket',
                    },
                ],
                prTextContext: '',
                unresolvedReferences: [
                    {
                        kind: 'key',
                        value: 'PROJ-999',
                        label: 'PROJ-999',
                        source: 'body',
                    },
                ],
            });

            expect(merged.taskContext).toContain('## Unresolved task references');
            expect(merged.taskContext).toContain('PROJ-999');
        });
    });
});
