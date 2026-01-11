import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs/promises';
import { reviewService } from '../services/review.service.js';
import { terminalFormatter } from '../formatters/terminal.js';
import { jsonFormatter } from '../formatters/json.js';
import { markdownFormatter } from '../formatters/markdown.js';
import { promptFormatter } from '../formatters/prompt.js';
import type { GlobalOptions, OutputFormat, ReviewResult } from '../types/index.js';

export const prCommand = new Command('pr')
  .description('Pull request commands');

prCommand
  .command('suggestions')
  .description('Fetch suggestions for a pull request')
  .option('--pr-url <url>', 'Pull request URL')
  .option('--pr-number <number>', 'Pull request number')
.option('--repo-id <id>', 'Repository ID for the pull request')
.option('--severity <list>', 'Comma-separated severities to include')
.option('--category <list>', 'Comma-separated categories to include')
.action(async (options: { prUrl?: string; prNumber?: string; repoId?: string; severity?: string; category?: string }, cmd: Command) => {

    const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
    const spinner = ora();

    try {
      const prNumber = options.prNumber !== undefined ? Number(options.prNumber) : undefined;

      if (options.prNumber !== undefined && Number.isNaN(prNumber)) {
        throw new Error('Invalid --pr-number value');
      }

      if (!options.prUrl && !(prNumber && options.repoId)) {
        console.error(chalk.red('Provide --pr-url or both --pr-number and --repo-id.'));
        process.exit(1);
      }

      const shouldRequestMarkdown = globalOpts.format === 'prompt' || globalOpts.format === 'markdown';

      spinner.start(chalk.cyan('Fetching pull request suggestions...'));

      const { result, markdown } = await reviewService.getPullRequestSuggestions({
        prUrl: options.prUrl,
        prNumber,
        repositoryId: options.repoId,
        format: shouldRequestMarkdown ? 'markdown' : undefined,
        severity: options.severity,
        category: options.category,
      });

      spinner.succeed(chalk.green('Suggestions fetched'));

      const output = markdown && shouldRequestMarkdown
        ? markdown
        : formatOutput(result, globalOpts.format);

      if (globalOpts.output) {
        await fs.writeFile(globalOpts.output, output, 'utf-8');
        console.log(chalk.green(`\nOutput saved to ${globalOpts.output}`));
      } else {
        console.log(output);
      }

    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch pull request suggestions'));

      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }

      process.exit(1);
    }
  });

function formatOutput(result: ReviewResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return jsonFormatter.format(result);
    case 'markdown':
      return markdownFormatter.format(result);
    case 'prompt':
      return promptFormatter.format(result);
    case 'terminal':
    default:
      return terminalFormatter.format(result);
  }
}
