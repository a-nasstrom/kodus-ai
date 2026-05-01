import { createLogger } from '@kodus/flow';
import { Injectable } from '@nestjs/common';

const DEFAULT_ENDPOINT = 'https://telemetry.kodus.io/v1/heartbeat';
const TIMEOUT_MS = 5_000;

/**
 * Pure HTTP transport for the self-hosted beacon. One responsibility: POST a
 * pre-built payload to the receiver and surface only "did it land" — the
 * caller decides what to do on failure.
 *
 * Endpoint and disable flags are read every call so operators can flip them at
 * runtime without restarting the worker (cron is daily — short-lived envs are
 * fine).
 */
@Injectable()
export class BeaconHttpProvider {
    private readonly logger = createLogger(BeaconHttpProvider.name);

    isDisabled(): boolean {
        return (
            isTruthy(process.env.KODUS_TELEMETRY_DISABLED) ||
            isTruthy(process.env.DO_NOT_TRACK)
        );
    }

    endpoint(): string {
        return process.env.KODUS_TELEMETRY_URL ?? DEFAULT_ENDPOINT;
    }

    async send(
        payload: Record<string, unknown>,
        kodusVersion: string,
    ): Promise<boolean> {
        const url = this.endpoint();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                body: JSON.stringify(payload),
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': `kodus-self-hosted/${kodusVersion}`,
                },
                method: 'POST',
                signal: controller.signal,
            });

            if (response.status === 204) {
                return true;
            }

            this.logger.warn({
                message: 'beacon rejected heartbeat',
                context: BeaconHttpProvider.name,
                metadata: { status: response.status, url },
            });
            return false;
        } catch (error) {
            this.logger.warn({
                message: 'beacon transport failed',
                context: BeaconHttpProvider.name,
                metadata: {
                    error:
                        error instanceof Error ? error.message : String(error),
                    url,
                },
            });
            return false;
        } finally {
            clearTimeout(timer);
        }
    }
}

function isTruthy(value: string | undefined): boolean {
    if (!value) {
        return false;
    }
    return /^(1|true|yes|on)$/i.test(value);
}
