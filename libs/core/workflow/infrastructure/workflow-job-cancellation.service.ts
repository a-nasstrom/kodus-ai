import { Inject, Injectable } from '@nestjs/common';
import { CacheService } from '@libs/core/cache/cache.service';
import { JobStatus } from '@libs/core/workflow/domain/enums/job-status.enum';
import {
    IWorkflowJobRepository,
    WORKFLOW_JOB_REPOSITORY_TOKEN,
} from '@libs/core/workflow/domain/contracts/workflow-job.repository.contract';
import {
    WORKFLOW_JOB_CANCEL_TTL_MS,
    buildWorkflowJobCancelCacheKey,
} from './workflow-job-cancellation';

@Injectable()
export class WorkflowJobCancellationService {
    constructor(
        private readonly cacheService: CacheService,
        @Inject(WORKFLOW_JOB_REPOSITORY_TOKEN)
        private readonly jobRepository: IWorkflowJobRepository,
    ) {}

    async requestCancellation(jobId: string): Promise<void> {
        await this.cacheService.addToCache(
            buildWorkflowJobCancelCacheKey(jobId),
            true,
            WORKFLOW_JOB_CANCEL_TTL_MS,
        );
    }

    async isCancellationRequested(jobId: string): Promise<boolean> {
        const cached = await this.cacheService.getFromCache<boolean>(
            buildWorkflowJobCancelCacheKey(jobId),
        );
        if (cached) {
            return true;
        }

        const job = await this.jobRepository.findOne(jobId);
        return job?.status === JobStatus.CANCELLED;
    }
}
