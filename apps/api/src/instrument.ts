import 'dotenv/config';

import { setupSentry } from '@libs/core/infrastructure/config/log/sentry';
import {
    createLangfuseSpanProcessor,
    registerLangfuseStandalone,
} from '@libs/core/log/langfuse';

// Order matters: build the Langfuse span processor first so it can be
// passed to Sentry's OTel setup. If we registered Langfuse after Sentry,
// the second `trace.setGlobalTracerProvider` would be silently dropped
// by the OTel ProxyTracerProvider and Langfuse would receive nothing —
// which is what was happening in prod.
const langfuseProcessor = createLangfuseSpanProcessor();
const sentryStarted = setupSentry(
    'api',
    langfuseProcessor ? [langfuseProcessor] : [],
);
if (langfuseProcessor && !sentryStarted) {
    registerLangfuseStandalone();
}
