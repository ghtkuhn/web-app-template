import type { LintResult, LintWriter } from './interfaces.ts';
import { BackendLinter } from './backend.linter.ts';

const ARCHITECTURE_GUIDANCE =
    'You must Read code/backend/ARCHITECTURE.md to understand the required backend structure.\n';

/** Formats linter results for command-line execution and maps exit codes. */
export class LinterCli {
    private readonly projectRoot: string;
    private readonly stdout: LintWriter;
    private readonly stderr: LintWriter;

    /** Creates a CLI adapter with replaceable streams for tests. */
    constructor(
        projectRoot: string,
        stdout: LintWriter = process.stdout,
        stderr: LintWriter = process.stderr,
    ) {
        this.projectRoot = projectRoot;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Runs the linter, writes deterministic diagnostics, and returns an exit code. */
    public run(): number {
        try {
            const result = new BackendLinter({
                projectRoot: this.projectRoot,
            }).run();
            this.writeResult(result);
            if (result.issues.some((issue) => issue.severity === 'fatal')) {
                return 2;
            }
            return result.issues.length > 0 ? 1 : 0;
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'Unknown linter error';
            this.stderr.write(ARCHITECTURE_GUIDANCE);
            this.stderr.write(`FATAL [LINTER_FAILURE] ${message}\n`);
            return 2;
        }
    }

    /** Writes issues or a compact success summary. */
    private writeResult(result: LintResult): void {
        if (result.issues.length === 0) {
            this.stdout.write(
                `Backend architecture valid (${result.filesChecked} files checked).\n`,
            );
            return;
        }

        this.stderr.write(ARCHITECTURE_GUIDANCE);
        for (const issue of result.issues) {
            const prefix = issue.severity === 'fatal' ? 'FATAL' : 'ERROR';
            this.stderr.write(
                `${prefix} [${issue.ruleId}] ${issue.file}: ${issue.message}\n`,
            );
        }
    }
}
