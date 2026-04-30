import 'dotenv/config';

import { setupSentry } from '@libs/core/infrastructure/config/log/sentry';
import {
    createLangfuseSpanProcessor,
    registerLangfuseStandalone,
} from '@libs/core/log/langfuse';

const langfuseProcessor = createLangfuseSpanProcessor();
const sentryStarted = setupSentry(
    'worker',
    langfuseProcessor ? [langfuseProcessor] : [],
);
if (langfuseProcessor && !sentryStarted) {
    registerLangfuseStandalone();
}
