import { Injectable } from '@nestjs/common';

import { ModelSpend } from '@libs/analytics/domain/spend-limit/spend-limit.types';

import { TokenPrice, TokenPricingUseCase } from './token-pricing.use-case';

const UNKNOWN_MODEL = '(unknown)';

/** A usage row carrying token counts and (optionally) the model that produced them. */
export interface CostUsageRow {
    input: number;
    output: number;
    outputReasoning: number;
    /** Input tokens served from cache. Subset of `input`. */
    cacheRead?: number;
    /** Input tokens that created cache entries on this call (Anthropic). */
    cacheWrite?: number;
    model?: string;
}

interface ModelUsageAgg {
    input: number;
    output: number;
    outputReasoning: number;
    cacheRead: number;
    cacheWrite: number;
}

/**
 * Single source of truth for turning token usage into US$. Buckets usage by
 * model and prices each independently because rates vary by ~10x across
 * providers — averaging into one flat rate drops the signal entirely. Used by
 * both the cost-estimate projection and the monthly spend tracker so the two
 * can never disagree on what a workload costs.
 */
@Injectable()
export class ModelCostCalculator {
    constructor(private readonly tokenPricingUseCase: TokenPricingUseCase) {}

    /** Per-model billed cost for the given usage rows. */
    async spendByModel(rows: CostUsageRow[]): Promise<ModelSpend[]> {
        const perModel = this.bucketByModel(rows);

        const out: ModelSpend[] = [];
        for (const [model, agg] of perModel) {
            out.push({ model, spentUsd: await this.costForModel(model, agg) });
        }
        return out;
    }

    /** Total billed cost across every model in the given usage rows. */
    async totalCost(rows: CostUsageRow[]): Promise<number> {
        const byModel = await this.spendByModel(rows);
        return byModel.reduce((sum, m) => sum + m.spentUsd, 0);
    }

    private bucketByModel(rows: CostUsageRow[]): Map<string, ModelUsageAgg> {
        const perModel = new Map<string, ModelUsageAgg>();
        for (const row of rows) {
            const key = (row.model && row.model.trim()) || UNKNOWN_MODEL;
            const agg = perModel.get(key) ?? {
                input: 0,
                output: 0,
                outputReasoning: 0,
                cacheRead: 0,
                cacheWrite: 0,
            };
            agg.input += row.input;
            agg.output += row.output;
            agg.outputReasoning += row.outputReasoning;
            agg.cacheRead += row.cacheRead ?? 0;
            agg.cacheWrite += row.cacheWrite ?? 0;
            perModel.set(key, agg);
        }
        return perModel;
    }

    private async costForModel(
        model: string,
        agg: ModelUsageAgg,
    ): Promise<number> {
        if (model === UNKNOWN_MODEL) return 0;

        const info = await this.tokenPricingUseCase.execute(model);
        const rates = info.pricing;

        // Tier selection: when the catalog defines a separate rate above 200K
        // prompt tokens (only Gemini Pro today), use it once the aggregate
        // input for this model clears that bar. Code-review workloads always
        // do; anything else overestimates by at most ~2x, acceptable here.
        const shouldUseAbove200k = agg.input > 200_000;

        const pick = (price: TokenPrice) =>
            shouldUseAbove200k && typeof price.above200k === 'number'
                ? price.above200k
                : price.default;

        const inputRate = pick(rates.input);
        const outputRate = pick(rates.output);
        const cacheReadRate = pick(rates.cacheRead);
        const cacheWriteRate = pick(rates.cacheWrite);

        // Cache reads are a subset of input tokens — subtract them from the
        // billable-at-full-price pool so we don't charge input AND cache for
        // the same tokens.
        const uncachedInput = Math.max(0, agg.input - agg.cacheRead);

        return (
            uncachedInput * inputRate +
            agg.cacheRead * cacheReadRate +
            agg.cacheWrite * cacheWriteRate +
            agg.output * outputRate
        );
    }
}
