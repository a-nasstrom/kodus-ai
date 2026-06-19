import { UserRequest } from '@libs/core/infrastructure/config/types/http/user-request.type';
import { IUseCase } from '@libs/core/domain/interfaces/use-case.interface';
import { createLogger } from '@kodus/flow';
import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@libs/automation/domain/automationExecution/contracts/automation-execution.service';
import { AutomationStatus } from '@libs/automation/domain/automation/enum/automation-status';
import {
    Action,
    ResourceType,
} from '@libs/identity/domain/permissions/enums/permissions.enum';
import { AuthorizationService } from '@libs/identity/infrastructure/adapters/services/permissions/authorization.service';
import {
    IWorkflowJobRepository,
    WORKFLOW_JOB_REPOSITORY_TOKEN,
} from '@libs/core/workflow/domain/contracts/workflow-job.repository.contract';
import { JobStatus } from '@libs/core/workflow/domain/enums/job-status.enum';
import { ErrorClassification } from '@libs/core/workflow/domain/enums/error-classification.enum';
import { WorkflowJobCancellationService } from '@libs/core/workflow/infrastructure/workflow-job-cancellation.service';
import { WORKFLOW_JOB_CANCELLED_MESSAGE } from '@libs/core/workflow/infrastructure/workflow-job-cancellation';
import {
    CODE_REVIEW_EXECUTION_SERVICE,
    ICodeReviewExecutionService,
} from '@libs/automation/domain/codeReviewExecutions/contracts/codeReviewExecution.service.contract';
import { IAutomationExecution } from '@libs/automation/domain/automationExecution/interfaces/automation-execution.interface';
import {
    IPipelineChecksService,
    PIPELINE_CHECKS_SERVICE_TOKEN,
} from '@libs/core/infrastructure/pipeline/interfaces/pipeline-checks-service.interface';
import { PlatformType } from '@libs/core/domain/enums';
import { CancelPullRequestExecutionResponseDto } from '@libs/code-review/dtos/dashboard/cancel-pull-request-execution.dto';

export interface CancelPullRequestExecutionInput {
    executionUuid: string;
    teamId: string;
}

@Injectable()
export class CancelPullRequestExecutionUseCase implements IUseCase {
    private readonly logger = createLogger(
        CancelPullRequestExecutionUseCase.name,
    );

    constructor(
        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,
        @Inject(CODE_REVIEW_EXECUTION_SERVICE)
        private readonly codeReviewExecutionService: ICodeReviewExecutionService<IAutomationExecution>,
        @Inject(WORKFLOW_JOB_REPOSITORY_TOKEN)
        private readonly jobRepository: IWorkflowJobRepository,
        private readonly workflowJobCancellationService: WorkflowJobCancellationService,
        @Inject(PIPELINE_CHECKS_SERVICE_TOKEN)
        private readonly pipelineChecksService: IPipelineChecksService,
        @Inject(REQUEST)
        private readonly request: UserRequest,
        private readonly authorizationService: AuthorizationService,
    ) {}

    async execute(
        input: CancelPullRequestExecutionInput,
    ): Promise<CancelPullRequestExecutionResponseDto> {
        const organizationId = this.request.user?.organization?.uuid;
        if (!organizationId) {
            throw new BadRequestException(
                'Organization UUID is missing in the request',
            );
        }

        if (!input.teamId) {
            throw new BadRequestException('teamId is required');
        }

        await this.authorizationService.ensure({
            user: this.request.user,
            action: Action.Update,
            resource: ResourceType.PullRequests,
        });

        const execution = await this.automationExecutionService.findById(
            input.executionUuid,
        );

        if (!execution || !this.belongsToScope(execution, organizationId, input.teamId)) {
            throw new NotFoundException('Review execution not found');
        }

        if (execution.status !== AutomationStatus.IN_PROGRESS) {
            if (
                execution.status === AutomationStatus.SKIPPED &&
                this.isCancelledExecution(execution)
            ) {
                return {
                    executionUuid: execution.uuid,
                    status: execution.status,
                    cancelledAt:
                        execution.updatedAt?.toISOString() ??
                        new Date().toISOString(),
                };
            }

            throw new ConflictException('Review is not in progress');
        }

        const workflowJobId = execution.dataExecution?.workflowJobId as
            | string
            | undefined;

        if (workflowJobId) {
            await this.jobRepository.update(workflowJobId, {
                status: JobStatus.CANCELLED,
                lastError: WORKFLOW_JOB_CANCELLED_MESSAGE,
                errorClassification: ErrorClassification.PERMANENT,
            });
            await this.workflowJobCancellationService.requestCancellation(
                workflowJobId,
            );
        }

        await this.finalizeGitHubCheckIfNeeded(execution);
        await this.skipInProgressStageLogs(execution.uuid);

        const cancelledAt = new Date().toISOString();
        await this.automationExecutionService.updateCodeReview(
            { uuid: execution.uuid },
            {
                status: AutomationStatus.SKIPPED,
                errorMessage: WORKFLOW_JOB_CANCELLED_MESSAGE,
            },
            WORKFLOW_JOB_CANCELLED_MESSAGE,
            'Kody Review Finished',
        );

        this.logger.log({
            message: 'Pull request review execution cancelled by user',
            context: CancelPullRequestExecutionUseCase.name,
            metadata: {
                executionUuid: execution.uuid,
                workflowJobId,
                organizationId,
                teamId: input.teamId,
            },
        });

        return {
            executionUuid: execution.uuid,
            status: AutomationStatus.SKIPPED,
            cancelledAt,
        };
    }

    private belongsToScope(
        execution: IAutomationExecution,
        organizationId: string,
        teamId: string,
    ): boolean {
        const scope = execution.dataExecution?.organizationAndTeamData;
        return (
            scope?.organizationId === organizationId && scope?.teamId === teamId
        );
    }

    private isCancelledExecution(execution: IAutomationExecution): boolean {
        const message = execution.errorMessage?.trim().toLowerCase() ?? '';
        return message.includes('cancelled by user');
    }

    private async skipInProgressStageLogs(
        executionUuid: string,
    ): Promise<void> {
        const stageLogs = await this.codeReviewExecutionService.find({
            automationExecution: { uuid: executionUuid },
            status: AutomationStatus.IN_PROGRESS,
        } as any);

        await Promise.all(
            stageLogs.map((stageLog) =>
                this.automationExecutionService.updateStageLog(stageLog.uuid, {
                    status: AutomationStatus.SKIPPED,
                    message: WORKFLOW_JOB_CANCELLED_MESSAGE,
                    finishedAt: new Date(),
                }),
            ),
        );
    }

    private async finalizeGitHubCheckIfNeeded(
        execution: IAutomationExecution,
    ): Promise<void> {
        const checkRunId = execution.dataExecution?.checkRunId;
        const owner = execution.dataExecution?.checkRepositoryOwner;
        const name = execution.dataExecution?.checkRepositoryName;
        const platformType = execution.dataExecution
            ?.platformType as PlatformType;
        const organizationAndTeamData =
            execution.dataExecution?.organizationAndTeamData;

        if (
            !checkRunId ||
            !owner ||
            !name ||
            !platformType ||
            !organizationAndTeamData
        ) {
            return;
        }

        await this.pipelineChecksService.cancelActiveCheck({
            organizationAndTeamData,
            repository: { owner, name },
            checkRunId,
            platformType,
            reason: WORKFLOW_JOB_CANCELLED_MESSAGE,
        });
    }
}
