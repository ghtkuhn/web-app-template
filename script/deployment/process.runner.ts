import { spawnSync } from 'node:child_process';

/** Preserves process state without exposing arguments or captured output. */
export class ProcessExecutionError extends Error {
    public readonly command: string;
    public readonly exitCode: number | null;
    public readonly signal: NodeJS.Signals | null;

    public constructor(
        command: string,
        exitCode: number | null,
        signal: NodeJS.Signals | null,
    ) {
        const outcome = exitCode === null
            ? signal
                ? `signal ${signal}`
                : 'an execution error'
            : `exit code ${exitCode}`;
        super(`${command} failed with ${outcome}.`);
        this.name = 'ProcessExecutionError';
        this.command = command;
        this.exitCode = exitCode;
        this.signal = signal;
    }
}

/** Runs external deployment tools without invoking a shell. */
export class ProcessRunner {
    public run(
        command: string,
        arguments_: readonly string[],
        options: {
            cwd?: string;
            env?: NodeJS.ProcessEnv;
            input?: string;
        } = {},
    ): string {
        const result = spawnSync(command, arguments_, {
            cwd: options.cwd,
            env: options.env,
            input: options.input,
            encoding: 'utf8',
            stdio: 'pipe',
        });
        if (result.error || result.status !== 0) {
            throw new ProcessExecutionError(
                command,
                result.status,
                result.signal,
            );
        }
        return result.stdout.trim();
    }
}
