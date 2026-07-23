import type { LintWriter } from './interfaces.ts';
import { FrontendLinter } from './frontend.linter.ts';

/** Formats frontend architecture diagnostics and stable process exit codes. */
export class LinterCli {
    private readonly linter: FrontendLinter;
    private readonly stdout: LintWriter;
    private readonly stderr: LintWriter;

    constructor(
        projectRoot: string,
        stdout: LintWriter = process.stdout,
        stderr: LintWriter = process.stderr,
    ) {
        this.linter = new FrontendLinter(projectRoot);
        this.stdout = stdout;
        this.stderr = stderr;
    }

    public run(): number {
        const result = this.linter.run();
        if (result.issues.length === 0) {
            this.stdout.write(
                `Frontend architecture valid (${result.filesChecked} files checked).\n`,
            );
            return 0;
        }
        for (const issue of result.issues) {
            this.stderr.write(
                `${issue.file} [${issue.ruleId}] ${issue.message}\n`,
            );
        }
        return result.issues.some((issue) => issue.severity === 'fatal')
            ? 2
            : 1;
    }
}
