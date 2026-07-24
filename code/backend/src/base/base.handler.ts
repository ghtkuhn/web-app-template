import type { IHandler, HandlerResult } from './interfaces.ts';

/**
 * BaseHandler is the root for all API entry points (HTTP, WS, CLI, Node).
 *
 * RESPONSIBILITIES:
 * - Provide a common interface for handling requests.
 * - Normalize uncaught handler failures into a safe transport-neutral result.
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
     * Handles one transport-specific input and shields callers from exceptions.
     *
     * @param input Transport-specific input (e.g., Request object, CLI args).
     * @returns A transport-neutral success or failure result.
     */
    async handle(input: TInput): Promise<HandlerResult<TOutput>> {
        try {
            return await this.processRequest(input);
        } catch {
            return {
                success: false,
                error: 'Internal Server Error',
                statusCode: 500,
            };
        }
    }

    /**
     * Processes one request after transport adaptation.
     *
     * @param input Transport-specific input supplied by the module gateway.
     * @returns A transport-neutral result for the caller to serialize.
     */
    protected abstract processRequest(
        input: TInput,
    ): Promise<HandlerResult<TOutput>>;
}
