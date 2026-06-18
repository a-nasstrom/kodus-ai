/**
 * Runs `work` with a hard deadline.
 *
 * When the deadline hits:
 *   1. The created AbortController is aborted, propagating cancellation to
 *      any callee that wires the signal into its async ops (LLM SDK,
 *      fetch, octokit, etc.). Without that wiring, work continues running
 *      in the background — Promise.race alone cannot cancel a pending
 *      promise.
 *   2. The race rejects with `timeoutMessage`, so the caller's catch block
 *      runs immediately and can do its cleanup chain.
 *
 * Extracted from JobProcessorRouterService for standalone unit testing
 * (the router itself drags in the entire code-review DI graph through
 * processor imports).
 */
import { JobAbortedError } from './abort-signal-race';
import {
    WORKFLOW_JOB_CANCEL_POLL_INTERVAL_MS,
    WORKFLOW_JOB_CANCELLED_MESSAGE,
} from './workflow-job-cancellation';

export async function runWithTimeout<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    try {
        return await Promise.race([work(controller.signal), timeoutPromise]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

export async function runWithTimeoutAndCancellation<T>(
    work: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    options?: {
        isCancelled?: () => Promise<boolean>;
        pollIntervalMs?: number;
        cancelMessage?: string;
    },
): Promise<T> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let pollId: ReturnType<typeof setInterval> | undefined;
    const cancelMessage =
        options?.cancelMessage ?? WORKFLOW_JOB_CANCELLED_MESSAGE;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort(timeoutMessage);
            reject(new Error(timeoutMessage));
        }, timeoutMs);
    });

    const cancelPromise = options?.isCancelled
        ? new Promise<never>((_, reject) => {
              const poll = async () => {
                  try {
                      if (await options.isCancelled!()) {
                          controller.abort(cancelMessage);
                          reject(new JobAbortedError(cancelMessage));
                      }
                  } catch {
                      // Ignore polling errors — timeout still applies.
                  }
              };

              pollId = setInterval(
                  poll,
                  options.pollIntervalMs ?? WORKFLOW_JOB_CANCEL_POLL_INTERVAL_MS,
              );
              void poll();
          })
        : null;

    try {
        const racers: Array<Promise<T>> = [work(controller.signal), timeoutPromise];
        if (cancelPromise) {
            racers.push(cancelPromise);
        }
        return await Promise.race(racers);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        if (pollId) {
            clearInterval(pollId);
        }
    }
}
