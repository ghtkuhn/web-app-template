import type { BaseModule } from './base.module.ts';
import type {
    CliHandlerInput,
    CliRunnerConfig,
    HandlerResult,
    OutputWriter,
} from './interfaces.ts';

/** Executes one CLI invocation against the shared module gateway registry. */
export class CliRunner {
    private readonly modules: Map<string, BaseModule>;
    private readonly stdout: OutputWriter;
    private readonly stderr: OutputWriter;

    /** Creates a CLI runner with optionally replaceable output streams for tests. */
    constructor(config: CliRunnerConfig) {
        this.modules = new Map(Object.entries(config.modules));
        this.stdout = config.stdout ?? process.stdout;
        this.stderr = config.stderr ?? process.stderr;
    }

    /** Parses `<module> <command> [arguments] [--options]` and returns an exit code. */
    public async run(argv: string[]): Promise<number> {
        const [moduleName, command, ...tokens] = argv;
        if (!moduleName || !command) {
            this.writeError(
                'Usage: <module> <command> [arguments] [--options]',
            );
            return 2;
        }

        const module = this.modules.get(moduleName);
        if (!module) {
            this.writeError(`Unknown module '${moduleName}'.`);
            return 2;
        }

        const result = await module.dispatch(
            'cli',
            this.parseInput(command, tokens),
        );
        this.writeResult(result);
        return result.success ? 0 : 1;
    }

    /** Converts raw positional tokens into the handler's structured input. */
    private parseInput(command: string, tokens: string[]): CliHandlerInput {
        const input: CliHandlerInput = {
            command,
            arguments: [],
            options: {},
        };

        for (let index = 0; index < tokens.length; index += 1) {
            const token = tokens[index];
            if (!token.startsWith('--')) {
                input.arguments.push(token);
                continue;
            }

            const option = token.slice(2);
            const separatorIndex = option.indexOf('=');
            if (separatorIndex >= 0) {
                input.options[option.slice(0, separatorIndex)] = option.slice(
                    separatorIndex + 1,
                );
                continue;
            }

            const nextToken = tokens[index + 1];
            if (nextToken && !nextToken.startsWith('--')) {
                input.options[option] = nextToken;
                index += 1;
            } else {
                input.options[option] = true;
            }
        }
        return input;
    }

    /** Writes a handler result as a stable JSON envelope. */
    private writeResult(result: HandlerResult): void {
        let payload: { success: boolean; data?: unknown; error?: string };
        if (result.success) {
            payload = { success: true, data: result.data };
        } else {
            payload = {
                success: false,
                error: result.error ?? 'Command failed',
            };
        }
        const destination = result.success ? this.stdout : this.stderr;
        destination.write(`${JSON.stringify(payload, null, 4)}\n`);
    }

    /** Writes a CLI usage or configuration failure. */
    private writeError(message: string): void {
        const payload = { success: false, error: message };
        this.stderr.write(`${JSON.stringify(payload, null, 4)}\n`);
    }
}
