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
    /**
     * Fast mode: cap agent step budget and skip heavy verification/recovery
     * passes. Used by the CLI for pre-commit feedback. The concrete
     * behavior is driven by `codeReviewConfig.reviewMode === 'fast'`, which
     * is set by the CLI use case when this flag is true.
     */
    isFastMode: boolean;
    isTrialMode: boolean;
    startTime: number;
    correlationId: string;
    cliResponse?: CliReviewResponse;
    gitContext?: CliGitContext;
}
