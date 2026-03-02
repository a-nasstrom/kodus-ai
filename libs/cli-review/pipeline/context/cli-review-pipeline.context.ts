import { CodeReviewPipelineContext } from '@libs/code-review/pipeline/context/code-review-pipeline.context';
import { CliReviewResponse } from '@libs/cli-review/domain/types/cli-review.types';
import { PlatformType } from '@libs/core/domain/enums';

export interface CliGitContext {
    remote?: string;
    branch?: string;
    commitSha?: string;
    inferredPlatform?: PlatformType;
}

/**
 * Pipeline context for CLI code review
 * Extends CodeReviewPipelineContext to reuse existing stages
 * PR-specific fields are populated with dummy values
 */
export interface CliReviewPipelineContext extends CodeReviewPipelineContext {
    // CLI-specific fields
    isFastMode: boolean;
    isTrialMode: boolean;
    startTime: number;
    correlationId: string;
    cliResponse?: CliReviewResponse;
    gitContext?: CliGitContext;
}
