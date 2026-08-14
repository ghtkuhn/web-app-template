import { ScaffoldInputError } from '../scaffold-module/errors.ts';
import type {
    OperationScaffoldRequest,
    OperationScaffoldWriter,
} from './interfaces.ts';
import { OperationScaffolder } from './operation.scaffolder.ts';

/** Non-interactive command adapter for Service Operation scaffolding. */
export class OperationScaffoldCli {
    private readonly scaffolder: OperationScaffolder;
    private readonly stdout: OperationScaffoldWriter;
    private readonly stderr: OperationScaffoldWriter;

    /** Creates a CLI with injectable streams. */
    constructor(
        scaffolder: OperationScaffolder,
        stdout: OperationScaffoldWriter = process.stdout,
        stderr: OperationScaffoldWriter = process.stderr,
    ) {
        this.scaffolder = scaffolder;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Executes one request and returns its stable exit code. */
    public run(arguments_: readonly string[]): number {
        if (arguments_.length === 1 && arguments_[0] === '--help') {
            this.stdout.write(this.help());
            return 0;
        }
        try {
            const result = this.scaffolder.scaffold(this.parse(arguments_));
            this.stdout.write(
                `Created Operation draft '${result.className}'.\n- ${result.file}\n`,
            );
            return 0;
        } catch (error: unknown) {
            this.stderr.write(
                `${error instanceof Error ? error.message : 'Unknown scaffold failure'}\n`,
            );
            return error instanceof ScaffoldInputError ? 1 : 2;
        }
    }

    /** Parses three names plus required input and output flags. */
    private parse(arguments_: readonly string[]): OperationScaffoldRequest {
        if (arguments_.length !== 7) {
            throw new ScaffoldInputError(
                'Expected <module> <service> <operation> --input <type|void> --output <type|void>.',
            );
        }
        const flags = new Map<string, string>();
        for (let index = 3; index < arguments_.length; index += 2) {
            const flag = arguments_[index];
            const value = arguments_[index + 1];
            if (!['--input', '--output'].includes(flag) || flags.has(flag)) {
                throw new ScaffoldInputError(`Unknown or duplicate flag '${flag}'.`);
            }
            flags.set(flag, value);
        }
        const inputType = flags.get('--input');
        const outputType = flags.get('--output');
        if (!inputType || !outputType) {
            throw new ScaffoldInputError('Both --input and --output are required.');
        }
        return {
            moduleName: arguments_[0],
            serviceName: arguments_[1],
            operationName: arguments_[2],
            inputType,
            outputType,
        };
    }

    /** Documents syntax and stable exit codes. */
    private help(): string {
        return [
            'Usage: npm run scaffold:operation -- <module> <service> <operation> --input <type|void> --output <type|void>',
            '',
            'The Service owner and named module-local contracts must already exist.',
            'The generated abstract draft is not routed until execute() is implemented and module:sync runs.',
            '',
            'Exit codes:',
            '  0  Operation draft created and backend checks passed',
            '  1  Invalid arguments, owner, contract, name, or existing target',
            '  2  Parsing, writing, or verification failure',
            '',
        ].join('\n');
    }
}
