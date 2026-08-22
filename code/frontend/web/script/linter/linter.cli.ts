import type {
    LintIssue,
    LintJsonResult,
    LintResult,
    LintWriter,
} from './interfaces.ts';
import { FrontendLinter } from './frontend.linter.ts';
import { DiagnosticRenderer } from '../../../../../script/lint-diagnostics/diagnostic.renderer.ts';
import { RuleCatalog } from './rule.catalog.ts';

/** Formats frontend architecture diagnostics and stable process exit codes. */
export class LinterCli {
    private readonly linter: FrontendLinter;
    private readonly stdout: LintWriter;
    private readonly stderr: LintWriter;
    private readonly format: 'text' | 'json';
    private readonly renderer: DiagnosticRenderer;
    private readonly catalog = new RuleCatalog();

    constructor(
        projectRoot: string,
        stdout: LintWriter = process.stdout,
        stderr: LintWriter = process.stderr,
        format: 'text' | 'json' = 'text',
    ) {
        this.linter = new FrontendLinter(projectRoot);
        this.stdout = stdout;
        this.stderr = stderr;
        this.format = format;
        this.renderer = new DiagnosticRenderer(projectRoot);
    }

    public run(): number {
        let result: LintResult;
        try {
            result = this.linter.run();
        } catch (error: unknown) {
            const issue = this.failureIssue(
                error instanceof Error
                    ? error.message
                    : 'Unknown frontend linter failure',
            );
            if (this.format === 'json') {
                this.writeJson({ filesChecked: 0, issues: [issue] });
            } else {
                this.stderr.write(this.renderer.render(issue));
            }
            return 2;
        }
        if (this.format === 'json') {
            this.writeJson(result);
            return result.issues.some((issue) => issue.severity === 'fatal')
                ? 2
                : result.issues.length > 0 ? 1 : 0;
        }
        if (result.issues.length === 0) {
            this.stdout.write(
                `Frontend architecture valid (${result.filesChecked} files checked).\n`,
            );
            return 0;
        }
        for (const issue of result.issues) {
            this.stderr.write(this.renderer.render(issue));
        }
        return result.issues.some((issue) => issue.severity === 'fatal')
            ? 2
            : 1;
    }

    private writeJson(result: LintResult): void {
        const payload: LintJsonResult = {
            schemaVersion: 2,
            filesChecked: result.filesChecked,
            issues: result.issues,
        };
        this.stdout.write(`${JSON.stringify(payload)}\n`);
    }

    private failureIssue(observed: string): LintIssue {
        return this.catalog.create({
            ruleId: 'FRONTEND_LINTER_FAILURE',
            severity: 'fatal',
            file: 'code/frontend/web',
            observed,
            location: null,
        });
    }
}
