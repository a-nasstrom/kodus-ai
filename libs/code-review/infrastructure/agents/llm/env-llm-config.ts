/**
 * Pure, side-effect-free inspection of the self-hosted `.env`-driven LLM
 * configuration. Mirrors the provider-selection branches of `getInternalModel`
 * in `byok-to-vercel.ts` but never instantiates an SDK client — safe to call
 * from HTTP handlers that only want to *describe* what the pipeline would use.
 *
 * The API key itself is intentionally not exposed: the UI surfaces these
 * values to logged-in admins, not to the pipeline, and leaking the secret
 * defeats the point of the BYOK/env split.
 */

export type EnvLLMProviderId =
    | 'openai'
    | 'openai_compatible'
    | 'anthropic'
    | 'google_gemini'
    | 'google_vertex';

export interface EnvLLMDescriptor {
    /** True iff the env configures a usable provider + key pair. */
    configured: boolean;
    /** Value of `API_LLM_PROVIDER_MODEL` when not `auto`. */
    model?: string;
    providerId?: EnvLLMProviderId;
    /** `API_OPENAI_FORCE_BASE_URL` (OpenAI-compatible proxy endpoint). */
    baseUrl?: string;
    /** `API_VERTEX_AI_LOCATION` when provider resolves to Vertex. */
    vertexLocation?: string;
}

const CLAUDE_MODEL_PATTERN = /^claude[-_]/i;
const GEMINI_MODEL_PATTERN = /^gemini[-_]/i;

/**
 * Mirrors `isProxyBaseURL` from byok-to-vercel.ts. An explicit baseURL that
 * isn't `api.anthropic.com` forces the OpenAI-compatible SDK regardless of
 * the model name prefix, because the proxy only speaks OpenAI Chat
 * Completions.
 */
function isProxyBaseURL(baseURL: string | undefined): boolean {
    if (!baseURL) return false;
    return !/(^|\/\/)api\.anthropic\.com\b/i.test(baseURL);
}

function looksLikeBase64Json(value: string): boolean {
    try {
        const decoded = Buffer.from(value, 'base64').toString('utf-8');
        const parsed = JSON.parse(decoded) as { project_id?: string };
        return !!parsed?.project_id;
    } catch {
        return false;
    }
}

/**
 * Describe the active env-based LLM config. Returns `{ configured: false }`
 * on cloud-mode installs (`API_LLM_PROVIDER_MODEL` unset or `"auto"`) and
 * on self-hosted installs that have the model set but no usable key.
 */
export function describeEnvLLMConfig(
    env: NodeJS.ProcessEnv = process.env,
): EnvLLMDescriptor {
    const envMode = env.API_LLM_PROVIDER_MODEL ?? 'auto';
    if (envMode === 'auto') {
        return { configured: false };
    }

    const openaiKey = env.API_OPEN_AI_API_KEY;
    const openaiBaseURL = env.API_OPENAI_FORCE_BASE_URL;
    const vertexKey = env.API_VERTEX_AI_API_KEY;
    const googleAiStudioKey =
        env.API_GOOGLE_AI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY;
    const vertexLocation = env.API_VERTEX_AI_LOCATION || undefined;
    const viaProxy = isProxyBaseURL(openaiBaseURL);

    const isGemini = GEMINI_MODEL_PATTERN.test(envMode);
    const isClaude = CLAUDE_MODEL_PATTERN.test(envMode);

    if (isGemini && !viaProxy) {
        if (googleAiStudioKey) {
            return {
                configured: true,
                model: envMode,
                providerId: 'google_gemini',
            };
        }
        if (vertexKey) {
            if (looksLikeBase64Json(vertexKey)) {
                return {
                    configured: true,
                    model: envMode,
                    providerId: 'google_vertex',
                    vertexLocation: vertexLocation || 'us-central1',
                };
            }
            return {
                configured: true,
                model: envMode,
                providerId: 'google_gemini',
            };
        }
    }

    if (isClaude && openaiKey && !viaProxy) {
        return {
            configured: true,
            model: envMode,
            providerId: 'anthropic',
            baseUrl: openaiBaseURL || undefined,
        };
    }

    if (openaiKey) {
        return {
            configured: true,
            model: envMode,
            providerId: 'openai_compatible',
            baseUrl: openaiBaseURL || 'https://api.openai.com/v1',
        };
    }

    return { configured: false };
}
