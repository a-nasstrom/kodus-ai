import { ChatAnthropic } from '@langchain/anthropic';
import { AnthropicVertex } from '@anthropic-ai/vertex-sdk';
import { GoogleAuth } from 'google-auth-library';
import { resolveModelOptions } from './resolver';
import {
    AdapterBuildParams,
    ProviderAdapter,
    LLM_TIMEOUT_MS,
    LLM_MAX_RETRIES,
} from './types';

interface VertexCredentials {
    project_id: string;
    [key: string]: unknown;
}

const VERTEX_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

/**
 * Claude (Anthropic) models on Google Vertex AI.
 *
 * The Gemini-only `ChatVertexAI` (langchain `@langchain/google-vertexai`)
 * cannot talk to Anthropic publisher models — it builds
 * `publishers/google/...` URLs and 404s for `claude-*`. So for Vertex Claude
 * we use `ChatAnthropic` (which speaks the Anthropic Messages protocol) with
 * its client swapped for `AnthropicVertex` from `@anthropic-ai/vertex-sdk`,
 * which targets `publishers/anthropic/...:rawPredict` and authenticates with
 * the BYOK service-account via `google-auth-library`.
 *
 * Reasoning/thinking config mirrors AnthropicAdapter so Claude behaves the
 * same whether it's reached via the direct Anthropic API or via Vertex.
 */
export class VertexAnthropicAdapter implements ProviderAdapter {
    build(params: AdapterBuildParams): ChatAnthropic {
        const { model, apiKey, vertexLocation, options } = params;

        // BYOK service-account key: raw JSON (pasted file) or base64 of it.
        const raw = (apiKey || '').trim();
        const decoded = raw.startsWith('{')
            ? raw
            : Buffer.from(raw, 'base64').toString('utf-8');
        const credentials = JSON.parse(decoded) as VertexCredentials;
        const region =
            vertexLocation?.trim() ||
            process.env.API_VERTEX_AI_LOCATION ||
            'global';

        const resolved = resolveModelOptions(model, {
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
            maxReasoningTokens: options?.maxReasoningTokens,
            reasoningLevel: options?.reasoningLevel,
        });

        const maxTokens = resolved.resolvedMaxTokens ?? 4096;

        const isAdaptive = resolved.reasoningType === 'adaptive';
        const isBudget = resolved.reasoningType === 'budget';
        const reasoningBudget = options?.disableReasoning
            ? undefined
            : resolved.supportsReasoning && isBudget
              ? resolved.resolvedReasoningTokens
              : undefined;

        let thinkingConfig: any;
        if (isAdaptive && !options?.disableReasoning) {
            thinkingConfig = { type: 'adaptive' };
        } else if (typeof reasoningBudget === 'number') {
            thinkingConfig = { type: 'enabled', budget_tokens: reasoningBudget };
        }

        const effortLevel =
            isAdaptive && !options?.disableReasoning
                ? (resolved.resolvedReasoningLevel ?? 'low')
                : undefined;

        const googleAuth = new GoogleAuth({
            credentials: credentials as any,
            scopes: VERTEX_SCOPES,
        });

        const payload: ConstructorParameters<typeof ChatAnthropic>[0] = {
            model,
            // ChatAnthropic validates a non-empty apiKey even though the
            // overridden client (AnthropicVertex) does the real GCP auth.
            apiKey: 'vertex-byok',
            ...(resolved.temperature !== undefined && !thinkingConfig
                ? { temperature: resolved.temperature }
                : {}),
            maxTokens,
            ...(thinkingConfig ? { thinking: thinkingConfig } : {}),
            callbacks: options?.callbacks,
            maxRetries: LLM_MAX_RETRIES,
            clientOptions: { timeout: LLM_TIMEOUT_MS },
            // Swap the underlying client for the Vertex-Anthropic one. It
            // exposes the same `messages` surface ChatAnthropic drives.
            createClient: (() =>
                new AnthropicVertex({
                    projectId: credentials.project_id,
                    region,
                    // Cast: google-auth-library's GoogleAuth<AuthClient> vs the
                    // GoogleAuth<JSONClient> the vertex-sdk types expect is a
                    // structural-generics mismatch only; same object at runtime.
                    googleAuth: googleAuth as any,
                })) as any,
        };

        if (effortLevel) {
            (payload as any).modelKwargs = {
                ...((payload as any).modelKwargs ?? {}),
                output_config: { effort: effortLevel },
            };
        }

        return new ChatAnthropic(payload);
    }
}
