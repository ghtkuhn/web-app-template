import { spawnSync } from 'node:child_process';

function outputSection(label: string, output: string | null): string | null {
    const normalized = (output ?? '')
        .replaceAll('\u0000', '')
        .replaceAll('\r\n', '\n')
        .trim();
    return normalized ? `${label}:\n${normalized}` : null;
}

function failureDiagnostic(
    stdout: string | null,
    stderr: string | null,
    redactions: readonly string[],
    maxCharacters = 16_384,
): string | null {
    const sections = [
        outputSection('stdout', stdout),
        outputSection('stderr', stderr),
    ].filter((value): value is string => value !== null);
    if (sections.length === 0) {
        return null;
    }
    let output = sections.join('\n');
    for (const value of [...new Set(redactions)]
        .filter((item) => item.length > 0)
        .sort((left, right) => right.length - left.length)) {
        output = output.split(value).join('[REDACTED]');
    }
    const limit = Number.isSafeInteger(maxCharacters) && maxCharacters > 0
        ? maxCharacters
        : 16_384;
    if (output.length > limit) {
        output = `[earlier child-process output omitted]\n${
            output.slice(-limit)
        }`;
    }
    return output;
}

/** Preserves process state without retaining arguments, stdin, or raw output. */
export class ProcessExecutionError extends Error {
    public readonly command: string;
    public readonly exitCode: number | null;
    public readonly signal: NodeJS.Signals | null;
    public readonly diagnostic: string | null;

    public constructor(
        command: string,
        exitCode: number | null,
        signal: NodeJS.Signals | null,
        diagnostic: string | null = null,
    ) {
        const outcome = exitCode === null
            ? signal
                ? `signal ${signal}`
                : 'an execution error'
            : `exit code ${exitCode}`;
        super(`${command} failed with ${outcome}.${
            diagnostic ? `\n${diagnostic}` : ''
        }`);
        this.name = 'ProcessExecutionError';
        this.command = command;
        this.exitCode = exitCode;
        this.signal = signal;
        this.diagnostic = diagnostic;
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
            failureOutput?: {
                readonly redact: readonly string[];
                readonly maxCharacters?: number;
            };
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
                options.failureOutput
                    ? failureDiagnostic(
                          result.stdout,
                          result.stderr,
                          options.failureOutput.redact,
                          options.failureOutput.maxCharacters,
                      )
                    : null,
            );
        }
        return result.stdout.trim();
    }
}
