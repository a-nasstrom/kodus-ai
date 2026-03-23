import * as Sentry from '@sentry/nestjs';
import {
    reportExceptionToSentry,
    setupSentryAndOpenTelemetry,
} from './otel';

jest.mock('@sentry/nestjs', () => ({
    init: jest.fn(),
    withScope: jest.fn((callback) =>
        callback({
            setTag: jest.fn(),
            setExtra: jest.fn(),
        }),
    ),
    captureException: jest.fn(),
    flush: jest.fn().mockResolvedValue(true),
}));

describe('otel', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {
            ...originalEnv,
            API_BETTERSTACK_DSN: 'https://examplePublicKey@example.ingest.sentry.io/1',
            API_NODE_ENV: 'production',
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('captures and flushes reported exceptions after sentry setup', async () => {
        setupSentryAndOpenTelemetry({ componentType: 'api' });

        await reportExceptionToSentry(new Error('bootstrap failed'), {
            context: 'Bootstrap',
            extra: { phase: 'startup' },
        });

        expect(Sentry.captureException).toHaveBeenCalledTimes(1);
        expect(Sentry.flush).toHaveBeenCalledTimes(1);
    });
});
