import { spawnSync } from 'node:child_process';
import { ScaffoldExecutionError } from './errors.ts';
import type { ScaffoldVerification } from './interfaces.ts';

/** Runs backend architecture linting and TypeScript checking synchronously. */
export class VerificationRunner implements ScaffoldVerification {
    /** Executes both required backend checks and throws on the first failure. */
    public verify(backendRoot: string): void {
        this.runScript(backendRoot, 'lint');
        this.runScript(backendRoot, 'typecheck');
    }

    /** Executes one required npm script. */
    private runScript(backendRoot: string, script: string): void {
        const result = spawnSync(this.command(), ['run', script], {
            cwd: backendRoot,
            stdio: 'inherit',
        });
        if (result.error) {
            throw new ScaffoldExecutionError(
                `Unable to run backend ${script}: ${result.error.message}`,
            );
        }
        if (result.status !== 0) {
            throw new ScaffoldExecutionError(
                `Backend ${script} failed with exit code ${this.exitCode(result.status)}.`,
            );
        }
    }

    /** Returns the platform-specific npm executable. */
    private command(): string {
        return process.platform === 'win32' ? 'npm.cmd' : 'npm';
    }

    /** Normalizes a missing child-process status to an execution error. */
    private exitCode(status: number | null): number {
        return status === null ? 2 : status;
    }
}
