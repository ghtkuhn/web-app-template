import { spawnSync } from 'node:child_process';

/** Runs the Fallow audit with project-specific exit-code semantics. */
class FallowAudit {
    /**
     * Executes Fallow and treats findings as a successful audit.
     *
     * Fallow exits with code 1 when it reports findings. Only execution errors
     * and exit codes of 2 or greater fail the combined verification command.
     */
    public run(): number {
        const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        const result = spawnSync(
            command,
            ['fallow', 'audit', '--format', 'json'],
            { stdio: 'inherit' },
        );

        if (result.error) {
            console.error(`Unable to run Fallow: ${result.error.message}`);
            return 2;
        }
        if (result.status === 0 || result.status === 1) {
            return 0;
        }
        return 2;
    }
}

process.exitCode = new FallowAudit().run();
