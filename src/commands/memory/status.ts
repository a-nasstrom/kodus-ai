import chalk from 'chalk';
import { gitService } from '../../services/git.service.js';
import { memoryService } from '../../services/memory.service.js';
import { loadConfig } from '../../utils/module-matcher.js';

export async function statusAction(): Promise<void> {
  const isRepo = await gitService.isGitRepository();
  if (!isRepo) {
    console.error(chalk.red('Error: Not a git repository.'));
    process.exit(1);
  }

  const repoRoot = (await gitService.getGitRoot()).trim();

  let branch: string;
  try {
    branch = (await gitService.getCurrentBranch()).trim();
  } catch {
    console.error(chalk.red('Error: Could not determine current branch.'));
    process.exit(1);
    return;
  }

  console.log(chalk.bold(`Branch: ${branch}`));
  console.log('');

  // PR memory status
  const prMemory = await memoryService.readPrMemory(repoRoot, branch);
  if (prMemory && prMemory.meta) {
    const meta = prMemory.meta;
    console.log(chalk.green('PR Memory:'));
    console.log(`  Sessions: ${meta.sessionCount}`);
    console.log(`  Last SHA: ${meta.lastSha}`);
    console.log(`  Agent: ${meta.agent}`);
    console.log(`  Updated: ${meta.updatedAt}`);

    // Count decisions in content
    const decisionCount = (prMemory.content.match(/^### \[\w+\]/gm) || []).length;
    const captureCount = (prMemory.content.match(/^### \d{4}-\d{2}-\d{2}T/gm) || []).length;
    console.log(`  Decisions: ${decisionCount}`);
    console.log(`  Captures: ${captureCount}`);
  } else {
    console.log(chalk.dim('No PR memory for this branch yet.'));
  }

  console.log('');

  // Module config status
  const config = await loadConfig(repoRoot);
  if (config) {
    console.log(chalk.green(`Module config: ${config.modules.length} module(s)`));
    for (const mod of config.modules) {
      console.log(chalk.dim(`  - ${mod.id}: ${mod.paths.join(', ')}`));
    }
  } else {
    console.log(chalk.dim('No module config found. Run `kodus decisions enable` to create one.'));
  }
}
