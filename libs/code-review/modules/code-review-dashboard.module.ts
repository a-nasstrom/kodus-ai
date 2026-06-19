import { Module, forwardRef } from '@nestjs/common';
import { GetEnrichedPullRequestsUseCase } from '../application/use-cases/dashboard/get-enriched-pull-requests.use-case';
import { CancelPullRequestExecutionUseCase } from '../application/use-cases/dashboard/cancel-pull-request-execution.use-case';
import { AutomationModule } from '@libs/automation/modules/automation.module';
import { PlatformDataModule } from '@libs/platformData/platformData.module';
import { PermissionsModule } from '@libs/identity/modules/permissions.module';
import { CodeReviewExecutionModule } from '@libs/code-review/modules/codeReviewExecution.module';
import { IntegrationConfigCoreModule } from '@libs/integrations/modules/config-core.module';
import { OrganizationParametersModule } from '@libs/organization/modules/organizationParameters.module';
import { CodeReviewPipelineModule } from '@libs/code-review/pipeline/code-review-pipeline.module';

@Module({
    imports: [
        forwardRef(() => AutomationModule),
        forwardRef(() => PlatformDataModule),
        forwardRef(() => IntegrationConfigCoreModule),
        forwardRef(() => PermissionsModule),
        forwardRef(() => CodeReviewExecutionModule),
        forwardRef(() => OrganizationParametersModule),
        forwardRef(() => CodeReviewPipelineModule),
    ],
    providers: [GetEnrichedPullRequestsUseCase, CancelPullRequestExecutionUseCase],
    exports: [GetEnrichedPullRequestsUseCase, CancelPullRequestExecutionUseCase],
})
export class CodeReviewDashboardModule {}
