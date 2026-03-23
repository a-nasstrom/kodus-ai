import 'dotenv/config';

import { setupSentryAndOpenTelemetry } from '@libs/core/infrastructure/config/log/otel';

setupSentryAndOpenTelemetry({ componentType: 'webhook' });
