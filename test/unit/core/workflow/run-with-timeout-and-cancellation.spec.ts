import { JobAbortedError } from './abort-signal-race';
import {
    runWithTimeout,
    runWithTimeoutAndCancellation,
} from './run-with-timeout';

describe('runWithTimeoutAndCancellation', () => {
    it('aborts work when cancellation is requested before timeout', async () => {
        let observedSignal: AbortSignal | undefined;
        let isCancelled = false;

        const work = jest.fn(async (signal: AbortSignal) => {
            observedSignal = signal;
            await new Promise((resolve) => setTimeout(resolve, 5000));
            return 'done';
        });

        const promise = runWithTimeoutAndCancellation(
            work,
            60_000,
            'timeout',
            {
                isCancelled: async () => isCancelled,
                pollIntervalMs: 20,
            },
        );

        await new Promise((resolve) => setTimeout(resolve, 30));
        isCancelled = true;

        await expect(promise).rejects.toBeInstanceOf(JobAbortedError);
        expect(observedSignal?.aborted).toBe(true);
        expect(work).toHaveBeenCalled();
    });

    it('falls back to timeout behavior when no cancellation hook is provided', async () => {
        await expect(
            runWithTimeout(
                async () => {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return 'done';
                },
                10,
                'timeout hit',
            ),
        ).rejects.toThrow('timeout hit');
    });
});
