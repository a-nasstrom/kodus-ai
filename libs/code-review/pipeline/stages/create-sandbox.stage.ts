import { createLogger } from '@kodus/flow';
import { Inject, Injectable } from '@nestjs/common';

import {
    ISandboxProvider,
    SANDBOX_PROVIDER_TOKEN,
} from '@libs/code-review/domain/contracts/sandbox.provider';
import { BasePipelineStage } from '@libs/core/infrastructure/pipeline/abstracts/base-stage.abstract';
import { StageVisibility } from '@libs/core/infrastructure/pipeline/enums/stage-visibility.enum';
import { CodeManagementService } from '@libs/platform/infrastructure/adapters/services/codeManagement.service';
import { PlatformType } from '@libs/core/domain/enums';
import { CodeReviewPipelineContext } from '../context/code-review-pipeline.context';
import { CliReviewPipelineContext } from '@libs/cli-review/pipeline/context/cli-review-pipeline.context';
import { parseGitRemoteUrl } from './collect-cross-file-context.stage';

/**
 * Creates and stores a sandbox instance in the pipeline context.
 *
 * Extracted from CollectCrossFileContextStage so that the sandbox can be
 * shared across multiple downstream stages (agent review, safeguard, etc.)
 * without coupling sandbox lifecycle to cross-file context collection.
 */
@Injectable()
export class CreateSandboxStage extends BasePipelineStage<CodeReviewPipelineContext> {
    readonly stageName = 'CreateSandboxStage';
    readonly label = 'Preparing Sandbox';
    readonly visibility = StageVisibility.SECONDARY;

    private readonly logger = createLogger(CreateSandboxStage.name);

    constructor(
        @Inject(SANDBOX_PROVIDER_TOKEN)
        private readonly sandboxProvider: ISandboxProvider,
        private readonly codeManagementService: CodeManagementService,
    ) {
        super();
    }

    protected async executeStage(
        context: CodeReviewPipelineContext,
    ): Promise<CodeReviewPipelineContext> {
        // Skip if sandbox already exists (e.g. created by CollectCrossFileContext in v2)
        if (context.sandboxHandle) {
            this.logger.log({
                message: 'Sandbox already exists in context, skipping creation',
                context: this.stageName,
            });
            return context;
        }

        const isCliMode = context.origin === 'cli';
        const cliContext = isCliMode
            ? (context as unknown as CliReviewPipelineContext)
            : undefined;
        const label = isCliMode
            ? `branch ${cliContext?.gitContext?.branch ?? 'unknown'}`
            : `PR#${context?.pullRequest?.number}`;

        // Guard: skip in fast mode
        if (cliContext?.isFastMode) {
            this.logger.log({
                message: `Skipping sandbox creation: fast mode`,
                context: this.stageName,
            });
            return context;
        }

        // Guard: skip if no changed files
        if (!context?.changedFiles?.length) {
            this.logger.log({
                message: `Skipping sandbox creation: no changed files for ${label}`,
                context: this.stageName,
            });
            return context;
        }

        // Guard: skip if sandbox is not available
        if (!this.sandboxProvider.isAvailable()) {
            this.logger.log({
                message: `Skipping sandbox creation: no sandbox provider configured for ${label}`,
                context: this.stageName,
            });
            return context;
        }

        // Guard (CLI): skip if no git remote available
        if (isCliMode && !cliContext?.gitContext?.remote) {
            this.logger.log({
                message: `Skipping sandbox creation: no git remote in CLI context`,
                context: this.stageName,
            });
            return context;
        }

        let cleanup: (() => Promise<void>) | undefined;

        try {
            const cloneInfo = await this.resolveCloneParams(context, cliContext);
            if (!cloneInfo) {
                this.logger.warn({
                    message: `resolveCloneParams returned null for ${label}`,
                    context: this.stageName,
                });
                return context;
            }

            this.logger.log({
                message: `Creating sandbox for ${label}`,
                context: this.stageName,
                metadata: {
                    cloneUrl: cloneInfo.url,
                    platform: cloneInfo.platform,
                    branch: cloneInfo.branch,
                    prNumber: cloneInfo.prNumber,
                    hasAuthToken: !!cloneInfo.authToken,
                },
            });

            const sandbox = await this.sandboxProvider.createSandboxWithRepo({
                cloneUrl: cloneInfo.url,
                authToken: cloneInfo.authToken,
                authUsername: cloneInfo.authUsername,
                branch: cloneInfo.branch,
                prNumber: cloneInfo.prNumber,
                platform: cloneInfo.platform,
            });

            cleanup = sandbox.cleanup;

            this.logger.log({
                message: `Sandbox created successfully for ${label}`,
                context: this.stageName,
            });

            return this.updateContext(context, (draft) => {
                draft.sandboxHandle = {
                    remoteCommands: sandbox.remoteCommands,
                    cleanup: sandbox.cleanup,
                };
                draft.sandboxCloneParams = {
                    cloneUrl: cloneInfo.url,
                    authToken: cloneInfo.authToken,
                    authUsername: cloneInfo.authUsername,
                    branch: cloneInfo.branch,
                    prNumber: cloneInfo.prNumber,
                    platform: cloneInfo.platform,
                };
            });
        } catch (error) {
            this.logger.error({
                message: `Failed to create sandbox for ${label}, continuing without it`,
                context: this.stageName,
                error,
                metadata: {
                    organizationAndTeamData: context?.organizationAndTeamData,
                    prNumber: context?.pullRequest?.number,
                },
            });
            if (cleanup) {
                try {
                    await cleanup();
                } catch (cleanupErr) {
                    this.logger.warn({
                        message: `Sandbox cleanup failed after creation error`,
                        context: this.stageName,
                        error: cleanupErr,
                    });
                }
            }
            return context;
        }
    }

    private async resolveCloneParams(
        context: CodeReviewPipelineContext,
        cliContext?: CliReviewPipelineContext,
    ): Promise<{
        url: string;
        authToken: string;
        authUsername?: string;
        branch: string;
        prNumber?: number;
        platform: PlatformType;
    } | null> {
        if (context.origin !== 'cli') {
            const cloneParams = await this.codeManagementService.getCloneParams(
                {
                    repository: context.repository,
                    organizationAndTeamData: context.organizationAndTeamData,
                },
                context.platformType,
            );

            return {
                url: cloneParams.url,
                authToken: cloneParams.auth?.token || '',
                authUsername: cloneParams.auth?.username,
                branch: context.branch,
                prNumber: context.pullRequest.number,
                platform: context.platformType,
            };
        }

        // CLI mode
        const gitContext = cliContext?.gitContext;
        if (!gitContext?.remote) return null;

        const parsed = parseGitRemoteUrl(gitContext.remote);
        if (!parsed) {
            this.logger.warn({
                message: `Could not parse git remote URL: ${gitContext.remote}`,
                context: this.stageName,
            });
            return null;
        }

        const platform = gitContext.inferredPlatform || PlatformType.GITHUB;
        const branch = gitContext.branch || 'main';

        let authToken = '';
        let authUsername: string | undefined;
        let cloneUrl = gitContext.remote;

        try {
            const cloneParams = await this.codeManagementService.getCloneParams(
                {
                    repository: {
                        id: '0',
                        defaultBranch: branch,
                        fullName: parsed.fullName,
                        name: parsed.name,
                    },
                    organizationAndTeamData: context.organizationAndTeamData,
                },
                platform,
            );
            authToken = cloneParams.auth?.token || '';
            authUsername = cloneParams.auth?.username;
            if (cloneParams.url) {
                cloneUrl = cloneParams.url;
            }
        } catch (error) {
            this.logger.warn({
                message: `Could not get auth token for CLI sandbox, trying without auth`,
                context: this.stageName,
                error,
            });
        }

        // Ensure HTTPS (E2B requires HTTPS for token auth)
        if (cloneUrl.startsWith('git@')) {
            const sshMatch = cloneUrl.match(
                /git@([^:]+):(.+?)(?:\.git)?$/,
            );
            if (sshMatch) {
                cloneUrl = `https://${sshMatch[1]}/${sshMatch[2]}`;
            } else {
                this.logger.warn({
                    message: `Could not parse SSH-like git remote URL: ${cloneUrl}`,
                    context: this.stageName,
                });
                return null;
            }
        }

        return {
            url: cloneUrl,
            authToken,
            authUsername,
            branch,
            prNumber: undefined,
            platform,
        };
    }
}
