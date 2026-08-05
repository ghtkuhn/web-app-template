import { spawnSync } from 'node:child_process';
import { ScaffoldExecutionError } from '../scaffold-module/errors.ts';
import type { TestScaffoldVerification } from './interfaces.ts';

/** Runs every backend check required by the test scaffold contract. */
export class TestScaffoldVerificationRunner implements TestScaffoldVerification {
    /** Runs architecture lint, typecheck, and the central test runner. */
    public verify(backendRoot: string): void {
        for (const script of ['lint', 'typecheck', 'test']) {
            this.runScript(backendRoot, script);
        }
    }

    /** Runs one npm script and converts failures to scaffold errors. */
    private runScript(backendRoot: string, script: string): void {
        const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const result = spawnSync(command, ['run', script], {
            cwd: backendRoot,
            stdio: 'inherit',
        });
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
