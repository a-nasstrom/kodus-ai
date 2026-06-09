import {
    CheckConclusion,
    CheckStatus,
} from '@libs/core/infrastructure/pipeline/interfaces/checks-adapter.interface';
import { ForgejoChecksService } from '@libs/platform/infrastructure/adapters/services/forgejo/forgejo-checks.service';

jest.mock('@kodus/flow', () => ({
    createLogger: () => ({
        log: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
    }),
}));

jest.mock('@llamaduck/forgejo-ts', () => ({
    repoCreateStatus: jest.fn().mockResolvedValue({ data: { id: 42 } }),
}));

import { repoCreateStatus } from '@llamaduck/forgejo-ts';

const mockRepoCreateStatus = repoCreateStatus as jest.Mock;

describe('ForgejoChecksService', () => {
    let service: ForgejoChecksService;
    let mockGetAuthDetails: jest.Mock;
    let mockCreateForgejoClient: jest.Mock;

    const mockAuthDetail = {
        accessToken: 'encrypted-token',
        host: 'https://git.example.com',
    };

    const mockOrganizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    const mockRepository = {
        owner: 'myorg',
        name: 'myrepo',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockRepoCreateStatus.mockResolvedValue({ data: { id: 42 } });

        mockGetAuthDetails = jest.fn().mockResolvedValue(mockAuthDetail);
        mockCreateForgejoClient = jest.fn().mockReturnValue({});

        service = new ForgejoChecksService({
            getAuthDetails: mockGetAuthDetails,
            createForgejoClient: mockCreateForgejoClient,
        } as unknown as Parameters<typeof ForgejoChecksService>[0]);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('createCheckRun', () => {
        it('should post a pending commit status and return sha-prefixed ID', async () => {
            const result = await service.createCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                headSha: 'abc123def456',
                status: CheckStatus.IN_PROGRESS,
                name: 'kodus-code-review',
                output: {
                    title: 'Code Review In Progress',
                    summary: 'Analyzing changes...',
                },
            });

            expect(result).toBe('sha:abc123def456');
            expect(mockGetAuthDetails).toHaveBeenCalledWith(
                mockOrganizationAndTeamData,
            );
            expect(mockCreateForgejoClient).toHaveBeenCalledWith(
                mockAuthDetail,
            );
            expect(mockRepoCreateStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: {
                        owner: 'myorg',
                        repo: 'myrepo',
                        sha: 'abc123def456',
                    },
                    body: expect.objectContaining({
                        state: 'pending',
                        context: 'kodus-code-review',
                        description: 'Code Review In Progress',
                    }),
                }),
            );
        });

        it('should use output.summary as description when title is empty', async () => {
            await service.createCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                headSha: 'abc123',
                status: CheckStatus.IN_PROGRESS,
                name: 'test',
                output: { title: '', summary: 'Fallback summary' },
            });

            expect(mockRepoCreateStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({
                        description: 'Fallback summary',
                    }),
                }),
            );
        });

        it('should return null when auth details are unavailable', async () => {
            mockGetAuthDetails.mockResolvedValue(null);

            const result = await service.createCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                headSha: 'abc123',
                status: CheckStatus.IN_PROGRESS,
                name: 'test',
                output: { title: 'Test', summary: '' },
            });

            expect(result).toBeNull();
        });

        it('should return null on API error', async () => {
            mockRepoCreateStatus.mockRejectedValue(new Error('API failure'));

            const result = await service.createCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                headSha: 'abc123',
                status: CheckStatus.IN_PROGRESS,
                name: 'test',
                output: { title: 'Test', summary: '' },
            });

            expect(result).toBeNull();
        });
    });

    describe('updateCheckRun', () => {
        it('should repost status with success state on completion', async () => {
            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 'sha:abc123def456',
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.SUCCESS,
                output: {
                    title: 'Code Review Complete',
                    summary: 'No issues found',
                },
            });

            expect(result).toBe(true);
            expect(mockRepoCreateStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: expect.objectContaining({ sha: 'abc123def456' }),
                    body: expect.objectContaining({ state: 'success' }),
                }),
            );
        });

        it('should repost with failure state on failure conclusion', async () => {
            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 'sha:abc123',
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.FAILURE,
            });

            expect(result).toBe(true);
            expect(mockRepoCreateStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ state: 'failure' }),
                }),
            );
        });

        it('should repost with warning state for neutral conclusion', async () => {
            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 'sha:abc123',
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.NEUTRAL,
            });

            expect(result).toBe(true);
            expect(mockRepoCreateStatus).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: expect.objectContaining({ state: 'warning' }),
                }),
            );
        });

        it('should return false when checkRunId does not contain SHA', async () => {
            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 42,
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.SUCCESS,
            });

            expect(result).toBe(false);
        });

        it('should return false when auth details are unavailable', async () => {
            mockGetAuthDetails.mockResolvedValue(null);

            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 'sha:abc123',
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.SUCCESS,
            });

            expect(result).toBe(false);
        });

        it('should return false on API error', async () => {
            mockRepoCreateStatus.mockRejectedValue(new Error('Network error'));

            const result = await service.updateCheckRun({
                organizationAndTeamData: mockOrganizationAndTeamData,
                repository: mockRepository,
                checkRunId: 'sha:abc123',
                status: CheckStatus.COMPLETED,
                conclusion: CheckConclusion.SUCCESS,
            });

            expect(result).toBe(false);
        });
    });
});
