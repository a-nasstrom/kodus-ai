import { createLogger } from '@kodus/flow';
import type {
    CreateCheckRunParams,
    IChecksAdapter,
    UpdateCheckRunParams,
} from '@libs/core/infrastructure/pipeline/interfaces/checks-adapter.interface';
import {
    CheckConclusion,
    CheckStatus,
} from '@libs/core/infrastructure/pipeline/interfaces/checks-adapter.interface';
import { Injectable } from '@nestjs/common';
import { repoCreateStatus } from '@llamaduck/forgejo-ts';
import { ForgejoService } from '../forgejo.service';

/**
 * Forgejo commit status states per the Forgejo API.
 * Unlike GitHub's Checks API, Forgejo uses the simpler commit status model:
 * POST a new status with the same `context` on the same SHA to "update".
 */
const COMMIT_STATUS_CONTEXT = 'kodus-code-review';

const statusStateMap: Record<CheckStatus, string> = {
    [CheckStatus.IN_PROGRESS]: 'pending',
    [CheckStatus.COMPLETED]: 'success',
};

const conclusionStateMap: Record<CheckConclusion, string> = {
    [CheckConclusion.SUCCESS]: 'success',
    [CheckConclusion.FAILURE]: 'failure',
    [CheckConclusion.NEUTRAL]: 'warning', // Forgejo-specific state
    [CheckConclusion.SKIPPED]: 'warning',
};

@Injectable()
export class ForgejoChecksService implements IChecksAdapter {
    private readonly logger = createLogger(ForgejoChecksService.name);

    constructor(private readonly forgejoService: ForgejoService) {}

    async createCheckRun(
        params: CreateCheckRunParams,
    ): Promise<string | null> {
        const {
            organizationAndTeamData,
            repository,
            headSha,
            output,
            status,
        } = params;

        try {
            const authDetail =
                await this.forgejoService.getAuthDetails(
                    organizationAndTeamData,
                );
            if (!authDetail) {
                this.logger.warn({
                    message:
                        'Skipping Forgejo commit status creation — no auth details',
                    context: ForgejoChecksService.name,
                    metadata: { repository: repository.name, headSha },
                });
                return null;
            }

            const client =
                this.forgejoService.createForgejoClient(authDetail);

            const state = statusStateMap[status] ?? 'pending';

            await repoCreateStatus({
                client,
                path: {
                    owner: repository.owner,
                    repo: repository.name,
                    sha: headSha,
                },
                body: {
                    state,
                    context: COMMIT_STATUS_CONTEXT,
                    description: output?.title || output?.summary || '',
                    target_url: output?.text,
                },
            });

            this.logger.log({
                message: 'Created Forgejo commit status',
                context: ForgejoChecksService.name,
                metadata: {
                    repository: repository.name,
                    headSha,
                    state,
                },
            });

            // Encode the SHA into the returned ID so updateCheckRun can
            // recover it — Forgejo has no update endpoint; we repost by SHA.
            return `sha:${headSha}`;
        } catch (error) {
            this.logger.error({
                message: 'Failed to create Forgejo commit status',
                context: ForgejoChecksService.name,
                error,
                metadata: { repository: repository.name, headSha },
            });
            return null;
        }
    }

    async updateCheckRun(params: UpdateCheckRunParams): Promise<boolean> {
        const {
            organizationAndTeamData,
            repository,
            status,
            conclusion,
            output,
        } = params;

        // Forgejo has no update endpoint — repost with the same context.
        // Recover the head SHA from the checkRunId we stored in createCheckRun.
        const headSha = this.resolveHeadSha(params);
        if (!headSha) {
            this.logger.warn({
                message:
                    'Cannot update Forgejo commit status — head SHA unavailable',
                context: ForgejoChecksService.name,
                metadata: {
                    checkRunId: params.checkRunId,
                    repository: repository.name,
                },
            });
            return false;
        }

        try {
            const authDetail =
                await this.forgejoService.getAuthDetails(
                    organizationAndTeamData,
                );
            if (!authDetail) {
                this.logger.warn({
                    message:
                        'Skipping Forgejo commit status update — no auth details',
                    context: ForgejoChecksService.name,
                    metadata: { repository: repository.name },
                });
                return false;
            }

            const client =
                this.forgejoService.createForgejoClient(authDetail);

            const state = this.resolveState(status, conclusion);

            await repoCreateStatus({
                client,
                path: {
                    owner: repository.owner,
                    repo: repository.name,
                    sha: headSha,
                },
                body: {
                    state,
                    context: COMMIT_STATUS_CONTEXT,
                    description: output?.title || output?.summary || '',
                    target_url: output?.text,
                },
            });

            this.logger.log({
                message: 'Updated Forgejo commit status',
                context: ForgejoChecksService.name,
                metadata: {
                    checkRunId: params.checkRunId,
                    repository: repository.name,
                    state,
                },
            });

            return true;
        } catch (error) {
            this.logger.error({
                message: 'Failed to update Forgejo commit status',
                context: ForgejoChecksService.name,
                error,
                metadata: {
                    checkRunId: params.checkRunId,
                    repository: repository.name,
                },
            });
            return false;
        }
    }

    private resolveState(
        status?: CheckStatus,
        conclusion?: CheckConclusion,
    ): string {
        if (status === CheckStatus.COMPLETED && conclusion) {
            return conclusionStateMap[conclusion] ?? 'success';
        }
        if (status) {
            return statusStateMap[status] ?? 'pending';
        }
        return 'pending';
    }

    /**
     * Recover the head SHA from the checkRunId stored by PipelineChecksService.
     * Forgejo commit status IDs are numeric and not needed for updates;
     * we encode the SHA as `sha:<hash>` so updates can repost by SHA.
     */
    private resolveHeadSha(
        params: UpdateCheckRunParams,
    ): string | null {
        const { checkRunId } = params;
        if (typeof checkRunId === 'string' && checkRunId.startsWith('sha:')) {
            return checkRunId.slice(4);
        }
        return null;
    }
}
