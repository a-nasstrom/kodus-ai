export const WORKFLOW_JOB_CANCEL_CACHE_PREFIX = 'workflow:cancel:';

/** Keep cancel flags long enough to cover code-review job timeout (1h45m). */
export const WORKFLOW_JOB_CANCEL_TTL_MS = 2 * 60 * 60 * 1000;

export const WORKFLOW_JOB_CANCEL_POLL_INTERVAL_MS = 2000;

export const WORKFLOW_JOB_CANCELLED_MESSAGE = 'Cancelled by user';

export function buildWorkflowJobCancelCacheKey(jobId: string): string {
    return `${WORKFLOW_JOB_CANCEL_CACHE_PREFIX}${jobId}`;
}
