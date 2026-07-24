import { spawnSync } from 'node:child_process';
import type {
    BackendMutation,
    BackendLintIssue,
    BackendLintResult,
    BackendLintRunner,
    RepairCheckResult,
    RepairCheckRunner,
} from './backend-lint-gate.ts';

const DIAGNOSTIC =
    /^(?:ERROR|FATAL) \[([A-Z0-9_]+)\] ([^:]+): (.+)$/gmu;

/** Runs and parses the focused backend architecture linter synchronously. */
export class ProcessBackendLintRunner implements BackendLintRunner {
    private readonly projectRoot: string;

    /** Creates a runner bound to one project root. */
    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /** Executes the linter with a bounded runtime and normalized output. */
    public run(): BackendLintResult {
        const result = spawnSync(
            'npm',
            [
                'run',
                'lint:architecture',
                '--workspace',
                '@app/backend',
            ],
            {
                cwd: this.projectRoot,
                encoding: 'utf8',
                timeout: 30_000,
                env: process.env,
            },
        );
        return parseBackendLintResult({
            status: result.status,
            stdout: result.stdout ?? '',
            stderr: result.stderr ?? '',
            error: result.error,
        });
    }
}

/** Runs the smallest deterministic compile or test check after a mutation. */
export class ProcessRepairCheckRunner implements RepairCheckRunner {
    private readonly projectRoot: string;

    /** Creates a focused runner bound to one project root. */
    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /** Runs backend TypeScript and the mutated test file when applicable. */
    public run(mutation: BackendMutation): RepairCheckResult {
        const typecheck = this.execute('npm', [
            'run',
            'typecheck',
            '--workspace',
            '@app/backend',
        ]);
        if (typecheck) {
            return { status: 'failed', reason: typecheck };
        }
        if (
            mutation.file.startsWith('code/backend/test/') &&
            mutation.file.endsWith('.test.ts')
        ) {
            const test = this.execute('node', [
                '--test',
                mutation.file,
            ]);
            if (test) {
                return { status: 'failed', reason: test };
            }
            return {
                status: 'passed',
                summary: `typecheck and ${mutation.file} passed`,
            };
        }
        return { status: 'passed', summary: 'backend typecheck passed' };
    }

    /** Returns a compact failure or null for a successful process. */
    private execute(command: string, arguments_: string[]): string | null {
        const result = spawnSync(command, arguments_, {
            cwd: this.projectRoot,
            encoding: 'utf8',
            timeout: 30_000,
            env: process.env,
        });
        if (result.error) {
            return result.error.name === 'ETIMEDOUT'
                ? `${command} timed out`
                : result.error.message;
        }
        return result.status === 0
            ? null
            : `${command} exited ${result.status ?? 'without status'}`;
    }
}

/** Process output accepted by the deterministic linter-result parser. */
export interface BackendLintProcessResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly error?: Error;
}

/** Converts process output into the gate's fail-closed result contract. */
export function parseBackendLintResult(
    result: BackendLintProcessResult,
): BackendLintResult {
    if (result.error) {
        return {
            status: 'failed',
            reason:
                result.error.name === 'ETIMEDOUT'
                    ? 'architecture lint timed out'
                    : result.error.message,
        };
    }
    if (result.status === 0) {
        return { status: 'green', issues: [] };
    }
    const output = `${result.stdout}\n${result.stderr}`;
    const issues = [...output.matchAll(DIAGNOSTIC)].map(
            (match): BackendLintIssue => ({
                ruleId: match[1],
                file: match[2],
                message: match[3],
            }),
        );
    if (result.status === 1 && issues.length > 0) {
        return { status: 'red', issues };
    }
    return {
        status: 'failed',
        reason:
            result.status === 2
                ? 'architecture linter failed'
                : 'architecture output was not parseable',
    };
}
