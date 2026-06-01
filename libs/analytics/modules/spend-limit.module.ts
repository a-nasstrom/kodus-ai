import { Module, forwardRef } from '@nestjs/common';

import { OrganizationParametersModule } from '@libs/organization/modules/organizationParameters.module';

import { ConfigureSpendLimitUseCase } from '../application/spend-limit/configure-spend-limit.use-case';
import { SpendLimitConfigService } from '../application/spend-limit/spend-limit-config.service';
import { AnalyticsModule } from './analytics.module';

/**
 * Composes the spend-limit config layer: spend computation (AnalyticsModule)
 * + org-parameter persistence (OrganizationParametersModule). The alert cron
 * (Phase 4) and the config endpoint (Phase 5) wire from here.
 */
@Module({
    imports: [
        AnalyticsModule,
        forwardRef(() => OrganizationParametersModule),
    ],
    providers: [SpendLimitConfigService, ConfigureSpendLimitUseCase],
    exports: [SpendLimitConfigService, ConfigureSpendLimitUseCase],
})
export class SpendLimitModule {}
