import {
    NullSandboxProvider,
    NULL_SANDBOX_INSTANCE,
} from '@libs/code-review/infrastructure/adapters/services/nullSandbox.service';

describe('NullSandboxProvider', () => {
    let provider: NullSandboxProvider;

    beforeEach(() => {
        provider = new NullSandboxProvider();
    });

    describe('isAvailable', () => {
        it('should return false', () => {
            expect(provider.isAvailable()).toBe(false);
        });
    });

    describe('createSandboxWithRepo', () => {
        it('should throw an error', async () => {
            await expect(provider.createSandboxWithRepo()).rejects.toThrow(
                'No sandbox provider configured',
            );
        });
    });
});

describe('NULL_SANDBOX_INSTANCE', () => {
    it('should have type "null"', () => {
        expect(NULL_SANDBOX_INSTANCE.type).toBe('null');
    });

    it('should have empty repoDir', () => {
        expect(NULL_SANDBOX_INSTANCE.repoDir).toBe('');
    });

    describe('run', () => {
        it('should return exitCode 1', async () => {
            const result = await NULL_SANDBOX_INSTANCE.run('echo hello');
            expect(result.exitCode).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr).toBe('');
        });
    });

    describe('readFile', () => {
        it('should throw an error', async () => {
            await expect(
                NULL_SANDBOX_INSTANCE.readFile('/some/path'),
            ).rejects.toThrow('No sandbox configured');
        });
    });

    describe('writeFile', () => {
        it('should throw an error', async () => {
            await expect(
                NULL_SANDBOX_INSTANCE.writeFile('/some/path', 'content'),
            ).rejects.toThrow('No sandbox configured');
        });
    });

    describe('cleanup', () => {
        it('should resolve without error', async () => {
            await expect(
                NULL_SANDBOX_INSTANCE.cleanup(),
            ).resolves.toBeUndefined();
        });
    });

    describe('remoteCommands', () => {
        it('grep should return empty string', async () => {
            const result =
                await NULL_SANDBOX_INSTANCE.remoteCommands.grep(
                    'pattern',
                    '/path',
                );
            expect(result).toBe('');
        });

        it('read should return empty string', async () => {
            const result =
                await NULL_SANDBOX_INSTANCE.remoteCommands.read('/path', 1, 10);
            expect(result).toBe('');
        });

        it('listDir should return empty string', async () => {
            const result =
                await NULL_SANDBOX_INSTANCE.remoteCommands.listDir('/path', 2);
            expect(result).toBe('');
        });
    });
});
