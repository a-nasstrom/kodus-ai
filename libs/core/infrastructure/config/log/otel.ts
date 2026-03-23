import * as Sentry from '@sentry/nestjs';

let sentryInitialized = false;

interface SetupSentryOptions {
    componentType?: string;
}

export function setupSentryAndOpenTelemetry(
    options: SetupSentryOptions = {},
) {
    if (sentryInitialized) {
        return;
    }

    const dsn = process.env.API_BETTERSTACK_DSN;

    if (!dsn) {
        return;
    }

    const environment =
        process.env.API_NODE_ENV || process.env.NODE_ENV || 'development';
    const componentType = options.componentType || 'api';

    try {
        Sentry.init({
            dsn,
            environment,
            release: `kodus-orchestrator@${
                process.env.SENTRY_RELEASE || environment
            }`,
            serverName: `kodus-${componentType}`,
            initialScope: {
                tags: {
                    component: componentType,
                },
            },
        });

        sentryInitialized = true;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'unknown error';

        console.warn(
            '[Sentry] initialization failed, continuing without error tracking:',
            message,
        );
    }
}

interface ReportExceptionOptions {
    context?: string;
    extra?: Record<string, unknown>;
}

export async function reportExceptionToSentry(
    exception: unknown,
    options: ReportExceptionOptions = {},
): Promise<void> {
    if (!sentryInitialized) {
        return;
    }

    Sentry.withScope((scope) => {
        if (options.context) {
            scope.setTag('context', options.context);
        }

        for (const [key, value] of Object.entries(options.extra ?? {})) {
            scope.setExtra(key, value);
        }

        Sentry.captureException(
            exception instanceof Error ? exception : new Error(String(exception)),
        );
    });

    try {
        await Sentry.flush(2_000);
    } catch {
        // Keep bootstrap and fatal error flows best-effort.
    }
}
