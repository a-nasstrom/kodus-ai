import 'dotenv/config';
import { Template, defaultBuildLogger } from 'e2b';
import { kodusTemplate } from './template';

async function main() {
    await Template.build(kodusTemplate, {
        alias: 'kodus-sandbox',
        cpuCount: 2,
        memoryMB: 1024,
        onBuildLogs: defaultBuildLogger(),
    });
}

main().catch(console.error);
