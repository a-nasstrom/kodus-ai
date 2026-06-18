import { AutomationStatus } from '@libs/automation/domain/automation/enum/automation-status';
import { CancelPullRequestExecutionUseCase } from '@libs/code-review/application/use-cases/dashboard/cancel-pull-request-execution.use-case';
import { JobStatus } from '@libs/core/workflow/domain/enums/job-status.enum';
import { WORKFLOW_JOB_CANCELLED_MESSAGE } from '@libs/core/workflow/infrastructure/workflow-job-cancellation';
import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';

describe('CancelPullRequestExecutionUseCase', () => {
    let useCase: CancelPullRequestExecutionUseCase;

    const automationExecutionService = {
        findById: jest.fn(),
        updateCodeReview: jest.fn(),
        updateStageLog: jest.fn(),
    };
    const codeReviewExecutionService = {
        find: jest.fn().mockResolvedValue([]),
    };
    const jobRepository = {
        update: jest.fn(),
    };
    const workflowJobCancellationService = {
        requestCancellation: jest.fn(),
    };
    const pipelineChecksService = {
        cancelActiveCheck: jest.fn(),
    };
    const authorizationService = {
        ensure: jest.fn(),
    };
    const request = {
        user: {
            organization: { uuid: 'org-1' },
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        useCase = new CancelPullRequestExecutionUseCase(
            automationExecutionService as any,
            codeReviewExecutionService as any,
            jobRepository as any,
            workflowJobCancellationService as any,
            pipelineChecksService as any,
            request as any,
            authorizationService as any,
        );
    });

    it('cancels an in-progress execution', async () => {
        automationExecutionService.findById.mockResolvedValue({
            uuid: 'exec-1',
            status: AutomationStatus.IN_PROGRESS,
            dataExecution: {
                workflowJobId: 'job-1',
                organizationAndTeamData: {
                    organizationId: 'org-1',
                    teamId: 'team-1',
                },
            },
        });
        automationExecutionService.updateCodeReview.mockResolvedValue({
            execution: { uuid: 'exec-1' },
        });

        const result = await useCase.execute({
            executionUuid: 'exec-1',
            teamId: 'team-1',
        });

        expect(jobRepository.update).toHaveBeenCalledWith('job-1', {
            status: JobStatus.CANCELLED,
            lastError: WORKFLOW_JOB_CANCELLED_MESSAGE,
            errorClassification: expect.any(String),
        });
        expect(
            workflowJobCancellationService.requestCancellation,
        ).toHaveBeenCalledWith('job-1');
        expect(automationExecutionService.updateCodeReview).toHaveBeenCalledWith(
            { uuid: 'exec-1' },
            {
                status: AutomationStatus.SKIPPED,
                errorMessage: WORKFLOW_JOB_CANCELLED_MESSAGE,
            },
            WORKFLOW_JOB_CANCELLED_MESSAGE,
            'Kody Review Finished',
        );
        expect(result.executionUuid).toBe('exec-1');
        expect(result.status).toBe(AutomationStatus.SKIPPED);
    });

    it('returns idempotently when already cancelled', async () => {
        automationExecutionService.findById.mockResolvedValue({
            uuid: 'exec-1',
            status: AutomationStatus.SKIPPED,
            errorMessage: WORKFLOW_JOB_CANCELLED_MESSAGE,
            updatedAt: new Date('2026-06-18T12:00:00Z'),
            dataExecution: {
                organizationAndTeamData: {
                    organizationId: 'org-1',
                    teamId: 'team-1',
                },
            },
        });

        const result = await useCase.execute({
            executionUuid: 'exec-1',
            teamId: 'team-1',
        });

        expect(result.status).toBe(AutomationStatus.SKIPPED);
        expect(jobRepository.update).not.toHaveBeenCalled();
    });

    it('throws when execution is not in progress', async () => {
        automationExecutionService.findById.mockResolvedValue({
            uuid: 'exec-1',
            status: AutomationStatus.SUCCESS,
            dataExecution: {
                organizationAndTeamData: {
                    organizationId: 'org-1',
                    teamId: 'team-1',
                },
            },
        });

        await expect(
            useCase.execute({ executionUuid: 'exec-1', teamId: 'team-1' }),
        ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws when execution is outside org/team scope', async () => {
        automationExecutionService.findById.mockResolvedValue({
            uuid: 'exec-1',
            status: AutomationStatus.IN_PROGRESS,
            dataExecution: {
                organizationAndTeamData: {
                    organizationId: 'other-org',
                    teamId: 'team-1',
                },
            },
        });

        await expect(
            useCase.execute({ executionUuid: 'exec-1', teamId: 'team-1' }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when organization is missing from request', async () => {
        const useCaseWithoutOrg = new CancelPullRequestExecutionUseCase(
            automationExecutionService as any,
            codeReviewExecutionService as any,
            jobRepository as any,
            workflowJobCancellationService as any,
            pipelineChecksService as any,
            { user: {} } as any,
            authorizationService as any,
        );

        await expect(
            useCaseWithoutOrg.execute({
                executionUuid: 'exec-1',
                teamId: 'team-1',
            }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
