import type { IHandler, HandlerResult } from './interfaces.ts';

/**
 * BaseHandler is the root for all API entry points (HTTP, WS, CLI, Node).
 *
 * RESPONSIBILITIES:
 * - Provide a common interface for handling requests.
 * - Implement cross-cutting concerns like logging and telemetry.
 *
 * IMPORT RULES:
 * - ALLOWED: Controllers, Base classes.
 * - FORBIDDEN: Stores, Services (Handlers must go through Controllers).
 *
 * CONSTRAINTS:
 * - Must remain transport-agnostic. No HTTP/WS specific libraries here.
 */
export abstract class BaseHandler<
    TInput = unknown,
    TOutput = unknown,
> implements IHandler<TInput, TOutput> {
    /**
     * The main entry point for the handler.
     * @param input Transport-specific input (e.g., Request object, CLI args).
     */
    async handle(input: TInput): Promise<HandlerResult<TOutput>> {
        try {
            return await this.processRequest(input);
        } catch (error: unknown) {
            return {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Internal Server Error',
                statusCode: 500,
            };
        }
    }

    /**
     * Abstract method to be implemented by specialized handlers.
     */
    protected abstract processRequest(
        input: TInput,
    ): Promise<HandlerResult<TOutput>>;
}
