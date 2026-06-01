import { TokenUsageBreakdown } from '../token-usage/types/tokenUsage.types';

/**
 * Alert thresholds, as a percentage of the configured monthly limit. Each one
 * fires its notification at most once per period; see the spend-limit cron.
 * Kept here (not in the cron) because it's the shared contract between the
 * alert path and a future blocking gate.
 */
export const SPEND_LIMIT_THRESHOLDS = [50, 75, 90, 100] as const;

export type SpendLimitThreshold = (typeof SPEND_LIMIT_THRESHOLDS)[number];

/** Spend attributed to a single BYOK model over a period, in US$. */
export interface ModelSpend {
    model: string;
    spentUsd: number;
}

/** Month-to-date BYOK spend for an organization, priced at current rates. */
export interface MonthlySpendResult {
    organizationId: string;
    /** Calendar month the spend covers — YYYY-MM in UTC. */
    periodKey: string;
    spentUsd: number;
    tokenUsage: TokenUsageBreakdown;
    byModel: ModelSpend[];
}

/**
 * The seam consumed by both the notification cron (which reads
 * `crossedThresholds` + `periodKey`) and, later, a blocking pipeline gate
 * (which would read `isOverLimit`). Computing this is decoupled from acting
 * on it so the future gate is a drop-in.
 */
export interface SpendLimitStatus {
    spentUsd: number;
    limitUsd: number;
    /** spentUsd / limitUsd as a percentage. 0 when no positive limit is set. */
    pct: number;
    /** True once spend reaches or exceeds the limit (pct >= 100). */
    isOverLimit: boolean;
    /** Thresholds that `pct` has reached, ascending. */
    crossedThresholds: number[];
}

export interface SpendLimitEvaluation extends SpendLimitStatus {
    organizationId: string;
    periodKey: string;
    byModel: ModelSpend[];
}
