import { assertContextWindowFitsOverhead } from './base-code-review-agent.provider';
import { AgentContextWindowTooSmallError } from './llm/errors';

describe('assertContextWindowFitsOverhead', () => {
    it('does not throw when contextWindow comfortably exceeds the static overhead', () => {
        expect(() =>
            assertContextWindowFitsOverhead({
                input: {
                    changedFiles: [],
                    prTitle: 'Add feature',
                    prBody: 'small body',
                },
                contextWindow: 128_000,
                modelName: 'gemini-2.5-pro',
            }),
        ).not.toThrow();
    });

    it('throws AgentContextWindowTooSmallError when overhead alone exceeds the window (Llama 12,288)', () => {
        // The agent's static prompt overhead is ~15_500 tokens (system prompt
        // + tool schemas). A 12_288-token Llama cannot fit even an empty PR.
        expect(() =>
            assertContextWindowFitsOverhead({
                input: {
                    changedFiles: [
                        { filename: 'a.ts', patch: 'diff --git a/a.ts b/a.ts' },
                    ] as any,
                    prTitle: 'tiny',
                    prBody: 'tiny',
                },
                contextWindow: 12_288,
                modelName: 'meta-llama/Llama-3.3-70B-Instruct',
            }),
        ).toThrow(AgentContextWindowTooSmallError);
    });

    it('error carries the numeric context for telemetry/UI', () => {
        try {
            assertContextWindowFitsOverhead({
                input: {
                    changedFiles: [],
                    prTitle: '',
                    prBody: '',
                },
                contextWindow: 12_288,
                modelName: 'llama',
            });
            throw new Error('should have thrown');
        } catch (e) {
            expect(e).toBeInstanceOf(AgentContextWindowTooSmallError);
            const err = e as AgentContextWindowTooSmallError;
            expect(err.contextWindow).toBe(12_288);
            expect(err.overheadTokens).toBeGreaterThan(12_288);
            expect(err.modelName).toBe('llama');
        }
    });

    it('does NOT throw at 32_768 (Llama 32K still fits the overhead with margin)', () => {
        expect(() =>
            assertContextWindowFitsOverhead({
                input: {
                    changedFiles: [],
                    prTitle: '',
                    prBody: '',
                },
                contextWindow: 32_768,
                modelName: 'llama-32k',
            }),
        ).not.toThrow();
    });
});
