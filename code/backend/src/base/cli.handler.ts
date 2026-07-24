import { BaseHandler } from './base.handler.ts';
import type { CliHandlerInput, HandlerResult } from './interfaces.ts';

/**
 * Adapts parsed CLI commands to a module controller.
 * Output formatting and process exit codes remain inside `CliRunner`.
 */
export abstract class CliHandler extends BaseHandler<CliHandlerInput> {
    /**
     * Processes one structured command received from the CLI transport.
     *
     * @param input Parsed command, arguments, and options.
     * @returns A transport-neutral result for CLI serialization.
     */
    protected async processRequest(
        input: CliHandlerInput,
    ): Promise<HandlerResult> {
        throw new Error(
            'processRequest must be implemented by a concrete CliHandler',
        );
    }
}
