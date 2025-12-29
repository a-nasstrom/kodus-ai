import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { gitService } from '../services/git.service.js';
import { reviewService } from '../services/review.service.js';
import { authService } from '../services/auth.service.js';
import { terminalFormatter } from '../formatters/terminal.js';
import { jsonFormatter } from '../formatters/json.js';
import { markdownFormatter } from '../formatters/markdown.js';
import { showTrialLimitPrompt, checkTrialStatus } from '../utils/rate-limit.js';
import type { GlobalOptions, OutputFormat, ReviewResult, TrialReviewResult } from '../types/index.js';
import fs from 'fs/promises';

export const reviewCommand = new Command('review')
  .description('Analyze modified files for code review')
  .argument('[files...]', 'Specific files to analyze')
  .option('-s, --staged', 'Analyze only staged files')
  .option('-c, --commit <sha>', 'Analyze diff from a specific commit')
  .option('--rules-only', 'Review using only configured rules (no general suggestions)')
  .option('--fast', 'Fast mode: quicker analysis with lighter checks')
  .action(async (files: string[], options: { staged?: boolean; commit?: string; rulesOnly?: boolean; fast?: boolean }, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals() as GlobalOptions & { staged?: boolean; commit?: string };
    const spinner = ora();

    try {
      const isAuthenticated = await authService.isAuthenticated();
      
      if (!globalOpts.quiet) {
        spinner.start(chalk.blue('Checking authentication...'));
      }

      let result: ReviewResult | TrialReviewResult;

      if (isAuthenticated) {
        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Fetching configuration from platform...');
        }
        
        const config = await reviewService.getConfig(globalOpts.org, globalOpts.repo);
        
        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Getting file changes...');
        }

        const diff = await getDiff(files, options);
        
        if (!diff) {
          spinner.fail(chalk.yellow('No changes to review'));
          return;
        }

        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Analyzing code...');
        }

        result = await reviewService.analyze(diff, config, options.rulesOnly, options.fast);
        const modeLabel = options.fast ? ' (fast mode)' : '';
        spinner.succeed(chalk.green(`Review complete!${modeLabel}`));
      } else {
        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Running in trial mode...');
        }

        const trialStatus = await checkTrialStatus();
        
        if (trialStatus.isLimited) {
          spinner.stop();
          showTrialLimitPrompt(trialStatus);
          return;
        }

        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Getting file changes...');
        }

        const diff = await getDiff(files, options);
        
        if (!diff) {
          spinner.fail(chalk.yellow('No changes to review'));
          return;
        }

        if (!globalOpts.quiet) {
          spinner.text = chalk.blue('Analyzing code (trial mode)...');
        }

        result = await reviewService.trialAnalyze(diff);
        spinner.succeed(chalk.green(`Review complete! (Trial: ${(result as TrialReviewResult).trialInfo.reviewsUsed}/${(result as TrialReviewResult).trialInfo.reviewsLimit} reviews today)`));
      }

      const output = formatOutput(result, globalOpts.format);

      if (globalOpts.output) {
        await fs.writeFile(globalOpts.output, output, 'utf-8');
        console.log(chalk.green(`\nOutput saved to ${globalOpts.output}`));
      } else if (globalOpts.format === 'terminal') {
        console.log(output);
      } else {
        console.log(output);
      }

    } catch (error) {
      spinner.fail(chalk.red('Review failed'));
      if (error instanceof Error) {
        console.error(chalk.red(error.message));
      }
      process.exit(1);
    }
  });

async function getDiff(files: string[], options: { staged?: boolean; commit?: string }): Promise<string> {
  if (files && files.length > 0) {
    return gitService.getDiffForFiles(files);
  }
  
  if (options.commit) {
    return gitService.getDiffForCommit(options.commit);
  }
  
  if (options.staged) {
    return gitService.getStagedDiff();
  }
  
  return gitService.getWorkingTreeDiff();
}

function formatOutput(result: ReviewResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return jsonFormatter.format(result);
    case 'markdown':
      return markdownFormatter.format(result);
    case 'terminal':
    default:
      return terminalFormatter.format(result);
  }
}

