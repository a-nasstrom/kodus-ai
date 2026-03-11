import { Command } from 'commander';
import chalk from 'chalk';
import { repoConfigService } from '../services/repo-config.service.js';
import { exitWithCode } from '../utils/cli-exit.js';
import { cliError, cliInfo } from '../utils/logger.js';
import { normalizeCommandError } from '../utils/command-errors.js';

export async function configRepoAction(repository = '.'): Promise<void> {
    try {
        const result = await repoConfigService.addRepository(repository);

        if (result.status === 'already-added') {
            cliInfo(
                chalk.yellow(
                    `Repository '${result.repositoryFullName}' is already added to Kodus.`,
                ),
            );
            return;
        }

        cliInfo(
            chalk.green(
                `Repository '${result.repositoryFullName}' was added to Kodus successfully.`,
            ),
        );
    } catch (error) {
        const normalized = normalizeCommandError(error);
        cliError(chalk.red(normalized.message));
        exitWithCode(normalized.exitCode);
    }
}

export async function configRepoAddAction(repository = '.'): Promise<void> {
    await configRepoAction(repository);
}

export async function configRemoteAction(repository = '.'): Promise<void> {
    await configRepoAction(repository);
}

export async function configRemoteAddAction(repository = '.'): Promise<void> {
    await configRepoAction(repository);
}

export async function configRepoListAction(): Promise<void> {
    try {
        const repositories = await repoConfigService.listRepositories();

        if (repositories.length === 0) {
            cliInfo(chalk.yellow('No repositories are currently configured.'));
            return;
        }

        cliInfo('Configured repositories:');
        for (const repository of repositories) {
            cliInfo(`- ${repository.fullName}`);
        }
    } catch (error) {
        const normalized = normalizeCommandError(error);
        cliError(chalk.red(normalized.message));
        exitWithCode(normalized.exitCode);
    }
}

export const configCommand = new Command('config').description(
    'Configuration commands',
);

configCommand
    .option(
        '-r, --remote [repository]',
        "Add remote repository config. Use '.' for the current repo.",
    )
    .action(async (options, command) => {
        if (options.remote !== undefined) {
            const repository =
                typeof options.remote === 'string' ? options.remote : '.';
            await configRemoteAction(repository);
            return;
        }

        command.help();
    });

function registerRemoteRepositoryConfig(
    command: Command,
    description: string,
    handlers: {
        action: (repository?: string) => Promise<void>;
        addAction: (repository?: string) => Promise<void>;
    },
) {
    command
        .description(description)
        .argument(
            '[repository]',
            "Repository to add. Use '.' for the current repo.",
            '.',
        )
        .action(handlers.action);

    command
        .command('add [repository]')
        .description("Add a repository to Kodus. Use '.' for the current repo.")
        .action(handlers.addAction);

    command
        .command('list')
        .description('List repositories already configured in Kodus.')
        .action(configRepoListAction);
}

registerRemoteRepositoryConfig(
    configCommand.command('remote'),
    'Manage remote repository configuration in Kodus.',
    {
        action: configRemoteAction,
        addAction: configRemoteAddAction,
    },
);

const repoAliasCommand = configCommand.command('repo');
(repoAliasCommand as Command & { _hidden?: boolean })._hidden = true;

registerRemoteRepositoryConfig(
    repoAliasCommand,
    'Manage remote repository configuration in Kodus.',
    {
        action: configRepoAction,
        addAction: configRepoAddAction,
    },
);
