import chalk from 'chalk';
import ora from 'ora';
import { authService } from '../../services/auth.service.js';
import { checkTrialStatus, getTrialIdentifier } from '../../utils/rate-limit.js';

export async function statusAction(): Promise<void> {
  const spinner = ora();

  try {
    const isAuthenticated = await authService.isAuthenticated();

    if (isAuthenticated) {
      const credentials = await authService.getCredentials();
      
      if (!credentials) {
        console.log(chalk.yellow('\nNo credentials found.'));
        return;
      }
      
      console.log(chalk.bold('\nAuthentication Status\n'));
      console.log(`${chalk.dim('Mode:')}  ${chalk.green('Logged In')}`);
      console.log(`${chalk.dim('Email:')} ${credentials.user.email}`);
      
      const expiresAt = new Date(credentials.expiresAt);
      const timeUntilExpiry = expiresAt.getTime() - Date.now();
      const hoursUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60 * 60));
      
      if (timeUntilExpiry > 0) {
        if (hoursUntilExpiry < 1) {
          console.log(`${chalk.dim('Token:')}  ${chalk.yellow('Expires in < 1 hour')}`);
        } else if (hoursUntilExpiry < 24) {
          console.log(`${chalk.dim('Token:')}  ${chalk.yellow(`Expires in ${hoursUntilExpiry} hours`)}`);
        } else {
          console.log(`${chalk.dim('Token:')}  ${chalk.green('Valid')}`);
        }
      } else {
        console.log(`${chalk.dim('Token:')}  ${chalk.red('Expired')}`);
        console.log(chalk.yellow('\nYour session has expired. Run `kodus auth login` to refresh.'));
        return;
      }
      
      if (credentials.user.orgs && credentials.user.orgs.length > 0) {
        console.log(`${chalk.dim('Organizations:')}`);
        credentials.user.orgs.forEach((org) => {
          console.log(`  ${chalk.dim('•')} ${org}`);
        });
      }

    } else {
      spinner.start(chalk.blue('Checking trial status...'));
      
      const trialStatus = await checkTrialStatus();
      
      spinner.stop();

      console.log(chalk.bold('\nAuthentication Status\n'));
      console.log(`${chalk.dim('Mode:')}           ${chalk.yellow('Trial')}`);
      console.log(`${chalk.dim('Reviews today:')} ${trialStatus.reviewsUsed}/${trialStatus.reviewsLimit}`);
      console.log(`${chalk.dim('Files limit:')}   ${trialStatus.filesLimit} per review`);
      console.log(`${chalk.dim('Resets at:')}     ${new Date(trialStatus.resetsAt).toLocaleString()}`);
      
      if (trialStatus.isLimited) {
        console.log(chalk.yellow('\n⚡ Daily limit reached!'));
      }

      console.log(chalk.dim('\nSign up to remove limits: ') + chalk.cyan('kodus auth signup'));
    }

  } catch (error) {
    spinner.fail(chalk.red('Failed to get status'));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

