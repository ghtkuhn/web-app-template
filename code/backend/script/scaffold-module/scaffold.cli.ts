import {
    ScaffoldExecutionError,
    ScaffoldInputError,
} from './errors.ts';
import type { ScaffoldWriter } from './interfaces.ts';
import { ModuleScaffolder } from './module.scaffolder.ts';

/** Non-interactive command-line adapter for module scaffolding. */
export class ScaffoldCli {
    private readonly scaffolder: ModuleScaffolder;
    private readonly stdout: ScaffoldWriter;
    private readonly stderr: ScaffoldWriter;

    /** Creates a CLI with explicit dependencies for deterministic tests. */
    constructor(
        scaffolder: ModuleScaffolder,
        stdout: ScaffoldWriter = process.stdout,
        stderr: ScaffoldWriter = process.stderr,
    ) {
        this.scaffolder = scaffolder;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Parses arguments, runs the scaffold, and returns its stable exit code. */
    public run(arguments_: readonly string[]): number {
        if (this.isHelpRequest(arguments_)) {
            this.stdout.write(this.help());
            return 0;
        }
        if (arguments_.length !== 1) {
            this.stderr.write(`${this.help()}\nExpected exactly one module name.\n`);
            return 1;
        }

        return this.execute(arguments_[0]);
    }

    /** Runs one validated-arity scaffold request. */
    private execute(moduleName: string): number {
        try {
            const result = this.scaffolder.scaffold(moduleName);
            this.stdout.write(
                `Created module '${result.moduleName}'.\n${result.files
                    .map((file) => `- ${file}`)
                    .join('\n')}\nRegistered and activated '${result.moduleName}'.\nBackend lint and typecheck passed.\n`,
            );
            return 0;
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'Unknown failure';
            this.stderr.write(`${message}\n`);
            return this.errorCode(error);
        }
    }

    /** Returns true for the only supported help invocation. */
    private isHelpRequest(arguments_: readonly string[]): boolean {
        return arguments_.length === 1 && arguments_[0] === '--help';
    }

    /** Maps expected error categories to documented process exit codes. */
    private errorCode(error: unknown): number {
        if (error instanceof ScaffoldInputError) {
            return 1;
        }
        if (error instanceof ScaffoldExecutionError) {
            return 2;
        }
        return 2;
    }

    /** Returns command usage and exit-code documentation. */
    private help(): string {
        return [
            'Usage: npm run scaffold:module -- <kebab-case-name>',
            '',
            'Exit codes:',
            '  0  Module created, registered, activated, and verified',
            '  1  Invalid arguments or existing module',
            '  2  Generation, parsing, writing, or verification failure',
            '',
        ].join('\n');
    }
}
