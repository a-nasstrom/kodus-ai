import { CodeReviewPipelineChecksService } from '@libs/code-review/infrastructure/services/code-review-pipeline-checks.service';
import { CheckStatus } from '@libs/core/infrastructure/pipeline/interfaces/checks-adapter.interface';
import { ChecksAdapterFactory } from '@libs/core/infrastructure/pipeline/services/checks-adapter.factory';
import { checkStageMap } from '@libs/core/infrastructure/pipeline/services/pipeline-checks.service';

describe('CodeReviewPipelineChecksService', () => {
    let service: CodeReviewPipelineChecksService;
    let checksAdapter: { createCheckRun: jest.Mock };
    let checksAdapterFactory: { getAdapter: jest.Mock };
    let automationExecutionService: {
        findById: jest.Mock;
        update: jest.Mock;
    };

    const mockObserverContext = {} as any;
    const mockContext = {
        organizationAndTeamData: { organizationId: 'org-1', teamId: 'team-1' },
        repository: { fullName: 'acme/repo' },
        pullRequest: {
            head: { sha: 'test-sha' },
        },
        platformType: 'github',
        pipelineMetadata: {
            lastExecution: { uuid: 'exec-1' },
        },
    } as any;

    beforeEach(() => {
        checksAdapter = {
            createCheckRun: jest.fn().mockResolvedValue('new-check-id'),
        };
        checksAdapterFactory = {
            getAdapter: jest.fn().mockReturnValue(checksAdapter),
        };
        automationExecutionService = {
            findById: jest.fn().mockResolvedValue({
                uuid: 'exec-1',
                dataExecution: { workflowJobId: 'job-1' },
            }),
            update: jest.fn().mockResolvedValue(undefined),
        };

        service = new CodeReviewPipelineChecksService(
            checksAdapterFactory as unknown as ChecksAdapterFactory,
            automationExecutionService as any,
        );
    });

    it('persists checkRunId before startCheck returns', async () => {
        await service.startCheck(
            mockObserverContext,
            mockContext,
            '_pipelineStart',
        );

        expect(mockObserverContext.checkRunId).toBe('new-check-id');
        expect(automationExecutionService.update).toHaveBeenCalledWith(
            { uuid: 'exec-1' },
            {
                dataExecution: expect.objectContaining({
                    workflowJobId: 'job-1',
                    checkRunId: 'new-check-id',
                    checkRepositoryOwner: 'acme',
                    checkRepositoryName: 'repo',
                }),
            },
        );
        expect(checksAdapter.createCheckRun).toHaveBeenCalledWith(
            expect.objectContaining({
                status: CheckStatus.IN_PROGRESS,
                name: checkStageMap._pipelineStart.name,
            }),
        );
    });
});
