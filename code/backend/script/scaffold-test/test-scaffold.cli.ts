import { ScaffoldInputError } from '../scaffold-module/errors.ts';
import type { TestScaffoldWriter } from './interfaces.ts';
import { TestScaffolder } from './test.scaffolder.ts';

/** Non-interactive command-line adapter for module-test scaffolding. */
export class TestScaffoldCli {
    private readonly scaffolder: TestScaffolder;
    private readonly stdout: TestScaffoldWriter;
    private readonly stderr: TestScaffoldWriter;

    /** Creates the CLI with explicit output dependencies. */
    constructor(
        scaffolder: TestScaffolder,
        stdout: TestScaffoldWriter = process.stdout,
        stderr: TestScaffoldWriter = process.stderr,
    ) {
        this.scaffolder = scaffolder;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Parses arguments, executes one scaffold, and returns a stable exit code. */
    public run(arguments_: readonly string[]): number {
        const argumentResult = this.validateArguments(arguments_);
        if (argumentResult !== null) {
            return argumentResult;
        }
        return this.execute(arguments_[0]);
    }

    /** Handles help and invalid arity before scaffold execution. */
    private validateArguments(arguments_: readonly string[]): number | null {
        if (arguments_.length === 1 && arguments_[0] === '--help') {
            this.stdout.write(this.help());
            return 0;
        }
        if (arguments_.length === 1) {
            return null;
        }
        this.stderr.write(`${this.help()}\nExpected exactly one module name.\n`);
        return 1;
    }

    /** Executes one validated scaffold request. */
    private execute(moduleName: string): number {
        try {
            const result = this.scaffolder.scaffold(moduleName);
            this.stdout.write(
                `Created module test '${result.file}'.\nTest catalog updated; backend lint, typecheck, and tests passed.\n`,
            );
            return 0;
        } catch (error: unknown) {
            this.stderr.write(
                `${error instanceof Error ? error.message : 'Unknown failure'}\n`,
            );
            return this.errorCode(error);
        }
    }

    /** Maps expected input errors separately from execution failures. */
    private errorCode(error: unknown): number {
        return error instanceof ScaffoldInputError ? 1 : 2;
    }

    /** Returns command syntax and exit-code documentation. */
    private help(): string {
        return [
            'Usage: npm run scaffold:test -- <existing-module>',
            '',
            'Exit codes:',
            '  0  Test created, cataloged, and verified',
            '  1  Invalid arguments, unknown module, or collision',
            '  2  Writing, catalog, or verification failure',
            '',
        ].join('\n');
    }
}
