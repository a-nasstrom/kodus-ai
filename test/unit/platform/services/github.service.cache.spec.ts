/**
 * Cache behavior tests for GithubService read methods that hit the
 * `gh:*` cache namespace introduced in commit b7606bb5c.
 *
 * We instantiate the real GithubService and stub out
 *   - getGithubAuthDetails (auth lookup)
 *   - instanceOctokit (Octokit creation)
 * so the only thing we exercise is the cache key path + the optional
 * `headSha` bypass.
 *
 * Three methods covered:
 *   1. getDefaultBranch                 (cache key: {org, repoId})
 *   2. getFilesByPullRequestId          (opt-in: {org, repoId, prNum, headSha})
 *   3. getCommitsForPullRequestForCodeReview (opt-in, same shape)
 */

jest.mock('@kodus/flow', () => ({
    createLogger: () => ({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
    }),
    getObservability: () => ({
        getContext: () => ({}),
    }),
}));

import { GithubService } from '@libs/platform/infrastructure/adapters/services/github/github.service';
import { CacheService } from '@libs/core/cache/cache.service';

type MockOctokit = {
    repos: { get: jest.Mock };
    rest: { pulls: { listFiles: jest.Mock } };
    pulls: { listCommits: jest.Mock };
    paginate: jest.Mock;
};

function makeMockCache(): CacheService {
    const store = new Map<string, { value: string; expiresAt: number }>();
    const now = () => Date.now();
    return {
        getFromCache: jest.fn(async <T,>(key: string | number) => {
            const k = String(key);
            const entry = store.get(k);
            if (!entry || entry.expiresAt < now()) {
                store.delete(k);
                return null;
            }
            return JSON.parse(entry.value) as T;
        }),
        addToCache: jest.fn(
            async <T,>(key: string | number, item: T, ttl = 60000) => {
                store.set(String(key), {
                    value: JSON.stringify(item),
                    expiresAt: now() + ttl,
                });
            },
        ),
        removeFromCache: jest.fn(async (key: string | number) => {
            store.delete(String(key));
        }),
        clearCache: jest.fn(async () => {
            store.clear();
        }),
        cacheExists: jest.fn(async (key: string | number) =>
            store.has(String(key)),
        ),
        getMultipleFromCache: jest.fn(),
        deleteByKeyPattern: jest.fn(async () => {
            store.clear();
        }),
    } as unknown as CacheService;
}

function makeService(): {
    service: GithubService;
    cache: CacheService;
    octokit: MockOctokit;
} {
    const cache = makeMockCache();
    const service = new GithubService(
        {} as any, // integrationService
        {} as any, // authIntegrationService
        {} as any, // integrationConfigService
        cache,
        {} as any, // configService
    );

    const octokit: MockOctokit = {
        repos: { get: jest.fn() },
        rest: { pulls: { listFiles: jest.fn() } },
        pulls: { listCommits: jest.fn() },
        paginate: jest.fn(),
    };

    // Bypass the auth + octokit creation paths — these touch DB / network
    jest.spyOn(service as any, 'getGithubAuthDetails').mockResolvedValue({
        org: 'quintoandar',
    });
    jest.spyOn(service as any, 'instanceOctokit').mockResolvedValue(
        octokit as any,
    );

    return { service, cache, octokit };
}

describe('GithubService — cache layer (commit b7606bb5c)', () => {
    describe('getDefaultBranch', () => {
        const params = {
            organizationAndTeamData: { organizationId: 'org-1', teamId: 't1' },
            repository: { id: 'repo-1', name: 'backend-services' },
        };

        it('hits GitHub on first call, returns the default branch', async () => {
            const { service, octokit } = makeService();
            octokit.repos.get.mockResolvedValue({
                data: { default_branch: 'main' },
            });

            const result = await service.getDefaultBranch(params);

            expect(result).toBe('main');
            expect(octokit.repos.get).toHaveBeenCalledTimes(1);
            expect(octokit.repos.get).toHaveBeenCalledWith({
                owner: 'quintoandar',
                repo: 'backend-services',
            });
        });

        it('serves from cache on the second call (no GitHub call)', async () => {
            const { service, octokit } = makeService();
            octokit.repos.get.mockResolvedValue({
                data: { default_branch: 'main' },
            });

            const first = await service.getDefaultBranch(params);
            const second = await service.getDefaultBranch(params);

            expect(first).toBe('main');
            expect(second).toBe('main');
            expect(octokit.repos.get).toHaveBeenCalledTimes(1);
        });

        it('uses repository.id in the cache key (different repos do not collide)', async () => {
            const { service, octokit } = makeService();
            octokit.repos.get
                .mockResolvedValueOnce({ data: { default_branch: 'main' } })
                .mockResolvedValueOnce({ data: { default_branch: 'develop' } });

            const a = await service.getDefaultBranch(params);
            const b = await service.getDefaultBranch({
                ...params,
                repository: { id: 'repo-2', name: 'other-repo' },
            });

            expect(a).toBe('main');
            expect(b).toBe('develop');
            expect(octokit.repos.get).toHaveBeenCalledTimes(2);
        });

        it('does NOT poison the cache when default_branch is missing', async () => {
            const { service, cache, octokit } = makeService();
            octokit.repos.get.mockResolvedValue({ data: {} });

            const result = await service.getDefaultBranch(params);

            expect(result).toBeUndefined();
            expect(cache.addToCache).not.toHaveBeenCalled();
        });
    });

    describe('getFilesByPullRequestId', () => {
        const baseParams = {
            organizationAndTeamData: { organizationId: 'org-1', teamId: 't1' },
            repository: { id: 'repo-1', name: 'backend-services' },
            prNumber: 26306,
        };

        const fakeFiles = [
            {
                filename: 'src/a.ts',
                sha: 'file-sha-1',
                status: 'modified',
                additions: 1,
                deletions: 0,
                changes: 1,
                patch: '@@ ...',
            },
        ];

        it('with headSha: hits GitHub once, then serves from cache', async () => {
            const { service, octokit } = makeService();
            octokit.paginate.mockResolvedValue(fakeFiles);

            const first = await service.getFilesByPullRequestId({
                ...baseParams,
                headSha: 'sha-abc',
            });
            const second = await service.getFilesByPullRequestId({
                ...baseParams,
                headSha: 'sha-abc',
            });

            expect(first).toHaveLength(1);
            expect(first[0].filename).toBe('src/a.ts');
            expect(second).toEqual(first);
            expect(octokit.paginate).toHaveBeenCalledTimes(1);
        });

        it('different headSha → different cache key → second call hits GitHub again', async () => {
            const { service, octokit } = makeService();
            octokit.paginate
                .mockResolvedValueOnce(fakeFiles)
                .mockResolvedValueOnce([
                    { ...fakeFiles[0], filename: 'src/b.ts' },
                ]);

            const first = await service.getFilesByPullRequestId({
                ...baseParams,
                headSha: 'sha-old',
            });
            const second = await service.getFilesByPullRequestId({
                ...baseParams,
                headSha: 'sha-new',
            });

            expect(first[0].filename).toBe('src/a.ts');
            expect(second[0].filename).toBe('src/b.ts');
            expect(octokit.paginate).toHaveBeenCalledTimes(2);
        });

        it('without headSha: cache is bypassed (legacy callers unchanged)', async () => {
            const { service, cache, octokit } = makeService();
            octokit.paginate.mockResolvedValue(fakeFiles);

            await service.getFilesByPullRequestId(baseParams);
            await service.getFilesByPullRequestId(baseParams);

            expect(octokit.paginate).toHaveBeenCalledTimes(2);
            expect(cache.addToCache).not.toHaveBeenCalled();
        });

        it('does not cache an empty file list (avoids serving stale empty after PR sync)', async () => {
            const { service, cache, octokit } = makeService();
            octokit.paginate.mockResolvedValue([]);

            await service.getFilesByPullRequestId({
                ...baseParams,
                headSha: 'sha-abc',
            });

            expect(cache.addToCache).not.toHaveBeenCalled();
        });
    });

    describe('getCommitsForPullRequestForCodeReview', () => {
        const baseParams = {
            organizationAndTeamData: { organizationId: 'org-1', teamId: 't1' },
            repository: { id: 'repo-1', name: 'backend-services' },
            prNumber: 26306,
        };

        const fakeCommits = [
            {
                sha: 'commit-1',
                commit: {
                    author: {
                        name: 'Dev',
                        email: 'dev@example.com',
                        date: '2026-05-13T10:00:00Z',
                    },
                    message: 'feat: x',
                },
                author: { id: 1, login: 'dev' },
                parents: [{ sha: 'parent-1' }],
            },
        ];

        it('with headSha: hits GitHub once, then serves from cache', async () => {
            const { service, octokit } = makeService();
            octokit.paginate.mockResolvedValue(fakeCommits);

            const first = await service.getCommitsForPullRequestForCodeReview({
                ...baseParams,
                headSha: 'sha-abc',
            });
            const second = await service.getCommitsForPullRequestForCodeReview(
                {
                    ...baseParams,
                    headSha: 'sha-abc',
                },
            );

            expect(first).toHaveLength(1);
            expect(first?.[0].sha).toBe('commit-1');
            expect(second).toEqual(first);
            expect(octokit.paginate).toHaveBeenCalledTimes(1);
        });

        it('without headSha: cache is bypassed', async () => {
            const { service, cache, octokit } = makeService();
            octokit.paginate.mockResolvedValue(fakeCommits);

            await service.getCommitsForPullRequestForCodeReview(baseParams);
            await service.getCommitsForPullRequestForCodeReview(baseParams);

            expect(octokit.paginate).toHaveBeenCalledTimes(2);
            expect(cache.addToCache).not.toHaveBeenCalled();
        });
    });
});
