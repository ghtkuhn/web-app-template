import { ScaffoldInputError } from './errors.ts';
import { FileScaffolder } from './file.scaffolder.ts';
import { FileTypeCatalog } from './file-type.catalog.ts';
import type {
    FileScaffoldRequest,
    ScaffoldWriter,
} from './interfaces.ts';

/** Non-interactive command-line adapter for architecture-file scaffolding. */
export class FileScaffoldCli {
    private readonly scaffolder: FileScaffolder;
    private readonly stdout: ScaffoldWriter;
    private readonly stderr: ScaffoldWriter;
    private readonly catalog = new FileTypeCatalog();

    /** Creates a CLI with explicit dependencies for deterministic tests. */
    constructor(
        scaffolder: FileScaffolder,
        stdout: ScaffoldWriter = process.stdout,
        stderr: ScaffoldWriter = process.stderr,
    ) {
        this.scaffolder = scaffolder;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Parses one request, executes it, and returns a documented exit code. */
    public run(arguments_: readonly string[]): number {
        if (arguments_.length === 1 && arguments_[0] === '--help') {
            this.stdout.write(this.help());
            return 0;
        }
        try {
            return this.execute(this.parse(arguments_));
        } catch (error: unknown) {
            this.stderr.write(`${this.message(error)}\n`);
            return this.errorCode(error);
        }
    }

    /** Parses positional values and the optional Aux owner. */
    private parse(arguments_: readonly string[]): FileScaffoldRequest {
        if (arguments_.length === 3) {
            return {
                moduleName: arguments_[0],
                fileType: arguments_[1],
                name: arguments_[2],
            };
        }
        if (arguments_.length === 5 && arguments_[3] === '--owner') {
            return {
                moduleName: arguments_[0],
                fileType: arguments_[1],
                name: arguments_[2],
                owner: arguments_[4],
            };
        }
        throw new ScaffoldInputError(
            'Expected <module> <type> <name> [--owner <owner>].',
        );
    }

    /** Executes one parsed scaffold request. */
    private execute(request: FileScaffoldRequest): number {
        const result = this.scaffolder.scaffold(request);
        this.stdout.write(
            `Created ${result.fileType} '${result.className}'.\n- ${result.file}\nBackend lint and typecheck passed.\n`,
        );
        return 0;
    }

    /** Returns one safe error message. */
    private message(error: unknown): string {
        return error instanceof Error ? error.message : 'Unknown failure';
    }

    /** Maps expected error categories to stable process exit codes. */
    private errorCode(error: unknown): number {
        return error instanceof ScaffoldInputError ? 1 : 2;
    }

    /** Returns usage, supported types, owner rules, and exit codes. */
    private help(): string {
        return [
            'Usage: npm run scaffold:file -- <module> <type> <name> [--owner <owner>]',
            '',
            'Types:',
            `  ${this.catalog.types().join(', ')}`,
            '',
            'The --owner option is required for *-aux types and forbidden otherwise.',
            '',
            'Exit codes:',
            '  0  File created and backend checks passed',
            '  1  Invalid arguments, owner, module, type, name, or existing target',
            '  2  Template, writing, or verification failure',
            '',
        ].join('\n');
    }
}
