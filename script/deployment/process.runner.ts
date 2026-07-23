import { spawnSync } from 'node:child_process';

/** Runs external deployment tools without invoking a shell. */
export class ProcessRunner {
    public run(
        command: string,
        arguments_: readonly string[],
        options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
    ): string {
        const result = spawnSync(command, arguments_, {
            cwd: options.cwd,
            env: options.env,
            encoding: 'utf8',
            stdio: 'pipe',
        });
        if (result.status !== 0) {
            throw new Error(
                result.stderr || result.stdout || `${command} failed.`,
            );
        }
        return result.stdout.trim();
    }
}
