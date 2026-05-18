// undici (Node's built-in fetch) ships a `headersTimeout` of 300_000ms.
// It fires INDEPENDENT of our AbortSignal — when Kodus's slow endpoints
// (e.g. Bitbucket `finish-onboarding` regularly takes 3–5 minutes while
// it clones, generates rules, and round-trips an LLM) don't send the
// first response byte by 5 minutes, the connection is killed with
// `TypeError: fetch failed` and the test sees a flaky network error.
//
// Install a custom undici Dispatcher with longer header/body timeouts on
// the global dispatcher so every `fetch` call in the test runner uses it.
// The bound is high enough (10 minutes) that legitimate hangs still
// surface, but well above the worst-case real onboarding latency we've
// measured.
import { Agent, setGlobalDispatcher } from "undici";

const TEN_MINUTES_MS = 10 * 60 * 1000;
setGlobalDispatcher(
    new Agent({
        headersTimeout: TEN_MINUTES_MS,
        bodyTimeout: TEN_MINUTES_MS,
    }),
);

export interface HttpOptions {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
    status: number;
    headers: Headers;
    body: T;
    raw: string;
}

export async function http<T = unknown>(
    url: string,
    opts: HttpOptions = {},
): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const init: RequestInit = {
        method: opts.method ?? "GET",
        headers: opts.headers ?? {},
        signal: controller.signal,
    };
    if (opts.body !== undefined && opts.body !== null) {
        init.body =
            typeof opts.body === "string"
                ? opts.body
                : JSON.stringify(opts.body);
        if (
            typeof init.body === "string" &&
            !(opts.headers && Object.keys(opts.headers).some((k) => k.toLowerCase() === "content-type"))
        ) {
            init.headers = {
                ...(init.headers as Record<string, string>),
                "Content-Type": "application/json",
            };
        }
    }

    try {
        const resp = await fetch(url, init);
        const raw = await resp.text();
        let body: unknown = raw;
        const ct = resp.headers.get("content-type") ?? "";
        if (ct.includes("application/json") && raw.length > 0) {
            try {
                body = JSON.parse(raw);
            } catch {
                /* leave raw */
            }
        }
        return {
            status: resp.status,
            headers: resp.headers,
            body: body as T,
            raw,
        };
    } finally {
        clearTimeout(timer);
    }
}

export function ensureOk<T>(
    resp: HttpResponse<T>,
    label: string,
): HttpResponse<T> {
    if (resp.status >= 200 && resp.status < 300) return resp;
    throw new Error(
        `${label}: HTTP ${resp.status}\n${resp.raw.slice(0, 500)}`,
    );
}
