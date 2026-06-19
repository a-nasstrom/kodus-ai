import { CodeReviewPipelineContext } from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { PlatformType } from '@libs/core/domain/enums';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import { CheckConclusion, CheckStatus } from './checks-adapter.interface';
import { PipelineObserverContext } from './pipeline-observer.interface';

export const PIPELINE_CHECKS_SERVICE_TOKEN = Symbol(
    'PIPELINE_CHECKS_SERVICE_TOKEN',
);

export interface IPipelineChecksService {
    startCheck(
        observerContext: PipelineObserverContext,
        context: CodeReviewPipelineContext,
        stageName: string,
        status?: CheckStatus,
    ): Promise<void>;
    updateCheck(
        observerContext: PipelineObserverContext,
        context: CodeReviewPipelineContext,
        stageName: string,
        status: CheckStatus,
        conclusion?: CheckConclusion,
    ): Promise<void>;
    finalizeCheck(
        observerContext: PipelineObserverContext,
        context: CodeReviewPipelineContext,
        conclusion: CheckConclusion,
        stageName?: string,
        reason?: string,
    ): Promise<void>;
    cancelActiveCheck(params: {
        organizationAndTeamData: OrganizationAndTeamData;
        repository: { owner: string; name: string };
        checkRunId: string | number;
        platformType: PlatformType;
        reason?: string;
    }): Promise<void>;
}
