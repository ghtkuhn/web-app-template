import type {
    IBaseModule,
    IHandler,
    HandlerResult,
    TransportType,
} from './interfaces.ts';

/**
 * BaseModule acts as the Unified Gateway for a domain module.
 *
 * RESPONSIBILITIES:
 * - Act as the sole public entry point for the module.
 * - Route requests to the appropriate handler (HTTP, WS, CLI, Node) via .dispatch().
 * - Encapsulate all internal logic (Services, Stores) from other modules.
 *
 * IMPORT RULES:
 * - ALLOWED: Its own Handlers and internal dependency chain for construction.
 * - FORBIDDEN: Other modules' internals, Composition entry points, database drivers.
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic.
 * - Internal Controllers, Services, and Stores are composed here but remain private.
 * - Stores receive database infrastructure from the module's registry factory.
 * - All inter-module communication MUST go through this class via .dispatch('node', ...).
 */
export abstract class BaseModule<
    TNodeInput = unknown,
    TNodeOutput = unknown,
> implements IBaseModule<TNodeInput, TNodeOutput> {
    protected handlers: Map<TransportType, IHandler<unknown, unknown>> =
        new Map();

    /**
     * Registers a handler for a specific transport interface.
     */
    registerHandler<TInput, TOutput>(
        type: TransportType,
        handler: IHandler<TInput, TOutput>,
    ): void {
        this.handlers.set(type, handler as IHandler<unknown, unknown>);
    }

    /**
     * The only public method to interact with this module.
     * @param type The interface to use ('http', 'ws', 'cli', 'node').
     * @param input The request data/payload.
     */
    async dispatch(
        type: 'node',
        input: TNodeInput,
    ): Promise<HandlerResult<TNodeOutput>>;
    async dispatch(
        type: Exclude<TransportType, 'node'>,
        input: unknown,
    ): Promise<HandlerResult>;
    async dispatch(
        type: TransportType,
        input: TNodeInput | unknown,
    ): Promise<HandlerResult> {
        const handler = this.handlers.get(type);
        if (!handler) {
            return {
                success: false,
                error: `Interface '${type}' is not supported by this module.`,
                statusCode: 405, // Method Not Allowed / Interface Not Supported
            };
        }

        try {
            return await handler.handle(input);
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                error: `Module Dispatch Error: ${message}`,
                statusCode: 500,
            };
        }
    }
}
