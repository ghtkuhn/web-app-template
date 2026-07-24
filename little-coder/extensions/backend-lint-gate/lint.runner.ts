import { spawnSync } from 'node:child_process';
import type {
    BackendMutation,
    BackendLintIssue,
    BackendLintResult,
    BackendLintRunner,
    RepairCheckResult,
    RepairCheckRunner,
} from './backend-lint-gate.ts';

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
            'node',
            [
                'code/backend/script/linter.ts',
                '--format',
                'json',
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
    const payload = parsePayload(result.stdout);
    if (!payload) {
        return {
            status: 'failed',
            reason: 'architecture JSON was not parseable',
        };
    }
    const issues = payload.issues;
    if (result.status === 0 && issues.length === 0) {
        return { status: 'green', issues: [] };
    }
    if (result.status === 1 && issues.length > 0) {
        return { status: 'red', issues };
    }
    return {
        status: 'failed',
        reason:
            result.status === 2
                ? 'architecture linter failed'
                : 'architecture JSON did not match the process status',
    };
}

/** Validates the complete versioned diagnostic payload. */
function parsePayload(
    output: string,
): { readonly issues: readonly BackendLintIssue[] } | null {
    try {
        const value = JSON.parse(output) as unknown;
        if (
            !value ||
            typeof value !== 'object' ||
            (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
            !Array.isArray((value as { issues?: unknown }).issues)
        ) {
            return null;
        }
        const issues = (value as { issues: unknown[] }).issues;
        return issues.every(isBackendLintIssue) ? { issues } : null;
    } catch {
        return null;
    }
}

/** Checks required diagnostic fields and one-based source positions. */
function isBackendLintIssue(value: unknown): value is BackendLintIssue {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const issue = value as Partial<BackendLintIssue>;
    const start = issue.location?.start;
    const end = issue.location?.end;
    return Boolean(
        typeof issue.ruleId === 'string' &&
            typeof issue.file === 'string' &&
            typeof issue.reason === 'string' &&
            typeof issue.fix === 'string' &&
            start &&
            end &&
            Number.isInteger(start.line) &&
            start.line >= 1 &&
            Number.isInteger(start.column) &&
            start.column >= 1 &&
            Number.isInteger(end.line) &&
            end.line >= start.line &&
            Number.isInteger(end.column) &&
            end.column >= 1,
    );
}
