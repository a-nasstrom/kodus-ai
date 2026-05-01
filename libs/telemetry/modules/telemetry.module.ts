import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

import {
    KodyRulesModel,
    KodyRulesSchema,
} from '@libs/kodyRules/infrastructure/adapters/repositories/schemas/kodyRules.model';
import { GlobalParametersModule } from '@libs/organization/modules/global-parameters.module';
import {
    PullRequestsModel,
    PullRequestsSchema,
} from '@libs/platformData/infrastructure/adapters/repositories/schemas/pullRequests.model';

import { HeartbeatCollectorService } from '../application/services/heartbeat-collector.service';
import { SelfHostedBeaconService } from '../application/services/self-hosted-beacon.service';
import { TelemetryService } from '../application/services/telemetry.service';
import { BeaconHttpProvider } from '../infrastructure/providers/beacon-http.provider';
import { N8nProvider } from '../infrastructure/providers/n8n.provider';
import { PostHogProvider } from '../infrastructure/providers/posthog.provider';
import { ResendEventsProvider } from '../infrastructure/providers/resend-events.provider';

@Global()
@Module({
    imports: [
        ConfigModule,
        GlobalParametersModule,
        MongooseModule.forFeature([
            { name: PullRequestsModel.name, schema: PullRequestsSchema },
            { name: KodyRulesModel.name, schema: KodyRulesSchema },
        ]),
    ],
    providers: [
        PostHogProvider,
        ResendEventsProvider,
        N8nProvider,
        TelemetryService,
        BeaconHttpProvider,
        HeartbeatCollectorService,
        SelfHostedBeaconService,
    ],
    exports: [TelemetryService, SelfHostedBeaconService],
})
export class TelemetryModule {}
