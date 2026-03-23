import * as os from 'os';

type HeartbeatValue = Date | number | string | undefined;

function normalizeHeartbeatValue(value: HeartbeatValue): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    return String(value);
}

export function formatHeartbeatContext(
    env?: string,
    component?: string,
    extra: Record<string, HeartbeatValue> = {},
): string {
    const context = {
        env,
        component,
        host: os.hostname(),
        ...extra,
    };

    return Object.entries(context)
        .map(([key, value]) => [key, normalizeHeartbeatValue(value)] as const)
        .filter(([, value]) => value && value.length > 0)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
}
