import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ScaffoldExecutionError } from '../scaffold-module/errors.ts';
import type { TestScaffoldVerification } from './interfaces.ts';

/** Runs every backend check required by the test scaffold contract. */
export class TestScaffoldVerificationRunner implements TestScaffoldVerification {
    private readonly execute: (command: string, args: readonly string[], cwd: string) => { status: number | null; error?: Error };

    public constructor(execute = (command: string, args: readonly string[], cwd: string): { status: number | null; error?: Error } =>
        spawnSync(command, [...args], { cwd, stdio: 'inherit' })) {
        this.execute = execute;
    }

    /** Runs backend checks and only the newly created test. */
    public verify(backendRoot: string, testFile: string): void {
        for (const script of ['lint', 'typecheck']) {
            this.runScript(backendRoot, script);
        }
        const result = this.execute(process.execPath, ['--test', '--test-concurrency=1', path.relative(backendRoot, testFile)], backendRoot);
        const detail = this.failureDetail(result.error, result.status);
        if (detail) throw new ScaffoldExecutionError(`Created test failed with ${detail}.`);
    }

    /** Runs one npm script and converts failures to scaffold errors. */
    private runScript(backendRoot: string, script: string): void {
        const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = this.execute(command, ['run', script], backendRoot);
        const detail = this.failureDetail(result.error, result.status);
        if (detail) {
            throw new ScaffoldExecutionError(
                `Backend ${script} failed with ${detail}.`,
            );
        }
    }

    /** Describes a process failure or returns null for success. */
    private failureDetail(error: Error | undefined, status: number | null): string | null {
        if (error) {
            return error.message;
        }
        return status === 0 ? null : `exit code ${status ?? 2}`;
    }
}
