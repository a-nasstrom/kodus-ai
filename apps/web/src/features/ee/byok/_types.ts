export type ReasoningEffort = "none" | "low" | "medium" | "high";

export type BYOKConfig = {
    model: string;
    apiKey: string;
    provider: string;
    baseURL?: string;
    temperature?: number;
    maxInputTokens?: number;
    maxConcurrentRequests?: number;
    maxOutputTokens?: number;
    reasoningEffort?: ReasoningEffort;
    /** Raw JSON override for provider-specific reasoning config.
     *  When set, takes precedence over reasoningEffort preset.
     *  Format: provider options object (e.g. {"budget_tokens": 25000}). */
    reasoningConfigOverride?: string;
};
