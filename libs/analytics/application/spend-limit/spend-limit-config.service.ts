import { Inject, Injectable } from '@nestjs/common';

import { OrganizationParametersKey } from '@libs/core/domain/enums';
import { OrganizationAndTeamData } from '@libs/core/infrastructure/config/types/general/organizationAndTeamData';
import {
    IOrganizationParametersService,
    ORGANIZATION_PARAMETERS_SERVICE_TOKEN,
} from '@libs/organization/domain/organizationParameters/contracts/organizationParameters.service.contract';

import {
    PriceabilityResult,
    SpendLimitConfig,
    SpendLimitEvaluation,
} from '@libs/analytics/domain/spend-limit/spend-limit.types';
import { ManualPricingOverrides } from '@libs/analytics/domain/token-usage/types/pricing.types';

import { MonthlySpendUseCase } from '../use-cases/usage/monthly-spend.use-case';
import { PricingResolver } from '../use-cases/usage/pricing-resolver';

/**
 * Read/write access to the per-org spend-limit config, plus the two
 * composition points the rest of the feature builds on:
 *
 *  - `evaluate` — read the config and, when a limit is enabled, score
 *    month-to-date spend against it (the primitive the alert cron calls).
 *  - `checkPriceability` — the enablement gate's core question.
 *
 * It only reads/evaluates; it never sends notifications or blocks reviews.
 */
@Injectable()
export class SpendLimitConfigService {
    constructor(
        @Inject(ORGANIZATION_PARAMETERS_SERVICE_TOKEN)
        private readonly organizationParametersService: IOrganizationParametersService,
        private readonly monthlySpend: MonthlySpendUseCase,
        private readonly pricingResolver: PricingResolver,
    ) {}

    async getConfig(
        organizationAndTeamData: OrganizationAndTeamData,
    ): Promise<SpendLimitConfig | null> {
        const parameter = await this.organizationParametersService
            .findByKey(
                OrganizationParametersKey.SPEND_LIMIT_CONFIG,
                organizationAndTeamData,
            )
            .catch(() => null);

        return (parameter?.configValue as SpendLimitConfig) ?? null;
    }

    async saveConfig(
        organizationAndTeamData: OrganizationAndTeamData,
        config: SpendLimitConfig,
    ): Promise<void> {
        await this.organizationParametersService.createOrUpdateConfig(
            OrganizationParametersKey.SPEND_LIMIT_CONFIG,
            config,
            organizationAndTeamData,
        );
    }

    /**
     * Score month-to-date BYOK spend against the configured limit. Returns
     * null when no usable limit is configured (absent, disabled, or
     * non-positive) — there is nothing to evaluate or alert on.
     */
    async evaluate(
        organizationAndTeamData: OrganizationAndTeamData,
        now: Date = new Date(),
    ): Promise<SpendLimitEvaluation | null> {
        const config = await this.getConfig(organizationAndTeamData);
        if (!config?.enabled || !(config.monthlyLimitUsd > 0)) {
            return null;
        }

        return this.monthlySpend.getStatus(
            organizationAndTeamData.organizationId,
            config.monthlyLimitUsd,
            now,
            config.modelPricing,
        );
    }

    /** Whether every given model can be priced (catalog or manual override). */
    async checkPriceability(
        models: string[],
        overrides?: ManualPricingOverrides,
    ): Promise<PriceabilityResult> {
        const resolved = await this.pricingResolver.resolveMany(
            models,
            overrides,
        );
        const unpriceable = resolved
            .filter((r) => !r.priced)
            .map((r) => r.model);

        return { priceable: unpriceable.length === 0, unpriceable };
    }
}
