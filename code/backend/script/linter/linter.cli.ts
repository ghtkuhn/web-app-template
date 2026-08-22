import type {
    LintIssue,
    LintJsonResult,
    LintResult,
    LintWriter,
} from './interfaces.ts';
import { BackendLinter } from './backend.linter.ts';
import { DiagnosticRenderer } from '../../../../script/lint-diagnostics/diagnostic.renderer.ts';
import { RuleCatalog } from './rule.catalog.ts';

/** Formats linter results for command-line execution and maps exit codes. */
export class LinterCli {
    private readonly projectRoot: string;
    private readonly stdout: LintWriter;
    private readonly stderr: LintWriter;
    private readonly format: 'text' | 'json';
    private readonly renderer: DiagnosticRenderer;
    private readonly catalog = new RuleCatalog();

    /** Creates a CLI adapter with replaceable streams for tests. */
    constructor(
        projectRoot: string,
        stdout: LintWriter = process.stdout,
        stderr: LintWriter = process.stderr,
        format: 'text' | 'json' = 'text',
    ) {
        this.projectRoot = projectRoot;
        this.stdout = stdout;
        this.stderr = stderr;
        this.format = format;
        this.renderer = new DiagnosticRenderer(this.projectRoot);
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
            if (this.format === 'json') {
                this.writeJson({
                    filesChecked: 0,
                    issues: [this.failureIssue(message)],
                });
                return 2;
            }
            this.stderr.write(this.renderer.render(this.failureIssue(message)));
            return 2;
        }
    }

    /** Writes issues or a compact success summary. */
    private writeResult(result: LintResult): void {
        if (this.format === 'json') {
            this.writeJson(result);
            return;
        }
        if (result.issues.length === 0) {
            this.stdout.write(
                `Backend architecture valid (${result.filesChecked} files checked).\n`,
            );
            return;
        }

        for (const issue of result.issues) {
            this.stderr.write(this.renderer.render(issue));
        }
    }

    /** Writes the versioned machine contract as one JSON document. */
    private writeJson(result: LintResult): void {
        const payload: LintJsonResult = {
            schemaVersion: 2,
            filesChecked: result.filesChecked,
            issues: result.issues,
        };
        this.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    /** Creates a structured unexpected-failure diagnostic. */
    private failureIssue(reason: string): LintIssue {
        return this.catalog.create({
            ruleId: 'LINTER_FAILURE',
            severity: 'fatal',
            file: 'code/backend',
            observed: reason,
            location: null,
        });
    }
}
