import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import * as Sentry from '@sentry/nestjs';

let sentryInitialized = false;

/**
 * Returns `true` when Sentry was actually initialized (DSN present and
 * `Sentry.init` succeeded). Callers use this to decide whether they still
 * need to register their own OTel TracerProvider — when Sentry initializes,
 * it sets the global TracerProvider itself and any extra
 * `openTelemetrySpanProcessors` are wired into it; when Sentry skips
 * (no DSN), the caller must install its own provider.
 */
export function setupSentry(
    componentType: 'api' | 'worker' | 'webhook',
    openTelemetrySpanProcessors: SpanProcessor[] = [],
): boolean {
    if (sentryInitialized) {
        return true;
    }

    const environment =
        process.env.API_NODE_ENV || process.env.NODE_ENV || 'development';

    const dsn = process.env.API_BETTERSTACK_DSN;
    if (!dsn) {
        return false;
    }

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
            openTelemetrySpanProcessors,
        });

        sentryInitialized = true;
        return true;
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'unknown error';

        console.warn(
            '[Sentry] initialization failed, continuing without error tracking:',
            message,
        );
        return false;
    }
}

interface ReportExceptionOptions {
    context?: string;
    extra?: Record<string, unknown>;
    tags?: Record<string, string | number | boolean>;
}

function withSentryScope(
    options: ReportExceptionOptions,
    callback: () => void,
): void {
    if (!sentryInitialized) {
        return;
    }

    Sentry.withScope((scope) => {
        if (options.context) {
            scope.setTag('context', options.context);
        }

        for (const [key, value] of Object.entries(options.tags ?? {})) {
            scope.setTag(key, String(value));
        }

        for (const [key, value] of Object.entries(options.extra ?? {})) {
            scope.setExtra(key, value);
        }

        callback();
    });
}

async function flushSentry(): Promise<void> {
    try {
        await Sentry.flush(2_000);
    } catch {
        // Keep bootstrap and fatal error flows best-effort.
    }
}

export async function reportExceptionToSentry(
    exception: unknown,
    options: ReportExceptionOptions = {},
): Promise<void> {
    if (!sentryInitialized) {
        return;
    }

    withSentryScope(options, () => {
        Sentry.captureException(
            exception instanceof Error
                ? exception
                : new Error(String(exception)),
        );
    });

    await flushSentry();
}

export async function reportMessageToSentry(
    message: string,
    options: ReportExceptionOptions = {},
): Promise<void> {
    if (!sentryInitialized) {
        return;
    }

    withSentryScope(options, () => {
        Sentry.captureMessage(message);
    });

    await flushSentry();
}
