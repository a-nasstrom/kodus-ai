import { createLogger } from '@kodus/flow';
import { CodeReviewPipelineContext } from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import {
    AUTOMATION_EXECUTION_SERVICE_TOKEN,
    IAutomationExecutionService,
} from '@libs/automation/domain/automationExecution/contracts/automation-execution.service';
import { PipelineObserverContext } from '@libs/core/infrastructure/pipeline/interfaces/pipeline-observer.interface';
import { ChecksAdapterFactory } from '@libs/core/infrastructure/pipeline/services/checks-adapter.factory';
import { PipelineChecksService } from '@libs/core/infrastructure/pipeline/services/pipeline-checks.service';
import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class CodeReviewPipelineChecksService extends PipelineChecksService {
    private readonly persistLogger = createLogger(
        CodeReviewPipelineChecksService.name,
    );

    constructor(
        checksAdapterFactory: ChecksAdapterFactory,
        @Inject(AUTOMATION_EXECUTION_SERVICE_TOKEN)
        private readonly automationExecutionService: IAutomationExecutionService,
    ) {
        super(checksAdapterFactory);
    }

    protected override async afterCheckRunCreated(
        _observerContext: PipelineObserverContext,
        context: CodeReviewPipelineContext,
        checkRunId: string | number,
    ): Promise<void> {
        const executionUuid = context.pipelineMetadata?.lastExecution?.uuid;
        const fullName = context.repository?.fullName;

        if (!executionUuid || !fullName) {
            return;
        }

        const [owner, name] = fullName.split('/');
        if (!owner || !name) {
            return;
        }

        try {
            const execution =
                await this.automationExecutionService.findById(executionUuid);
            if (!execution) {
                return;
            }

            await this.automationExecutionService.update(
                { uuid: executionUuid },
                {
                    dataExecution: {
                        ...execution.dataExecution,
                        checkRunId,
                        checkRepositoryOwner: owner,
                        checkRepositoryName: name,
                    },
                },
            );
        } catch (error) {
            this.persistLogger.warn({
                message: 'Failed to persist check run metadata for cancellation',
                context: CodeReviewPipelineChecksService.name,
                error,
                metadata: { executionUuid, checkRunId },
            });
        }
    }
}
