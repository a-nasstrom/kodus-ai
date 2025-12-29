import { Command } from 'commander';
import { loginAction } from './login.js';
import { signupAction } from './signup.js';
import { logoutAction } from './logout.js';
import { statusAction } from './status.js';
import { tokenAction } from './token.js';

export const authCommand = new Command('auth')
  .description('Authentication commands');

authCommand
  .command('login')
  .description('Login with email and password')
  .option('-e, --email <email>', 'Email address')
  .option('-p, --password <password>', 'Password')
  .action(loginAction);

authCommand
  .command('signup')
  .description('Create a new account')
  .action(signupAction);

authCommand
  .command('logout')
  .description('Remove local credentials')
  .action(logoutAction);

authCommand
  .command('status')
  .description('Show authentication status and usage limits')
  .action(statusAction);

authCommand
  .command('token')
  .description('Generate a token for CI/CD')
  .action(tokenAction);

