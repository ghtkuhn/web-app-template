import type {
    IBaseModule,
    IHandler,
    HandlerResult,
    HttpDispatchResult,
    TransportType,
} from './interfaces.ts';

/**
 * BaseModule acts as the Unified Gateway for a domain module.
 *
 * RESPONSIBILITIES:
 * - Act as the sole public entry point for the module.
 * - Route requests to the appropriate handler (HTTP, WebSocket, CLI, Node) via `dispatch()`.
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
 * - Inter-module callers use the injected public module port and `dispatch('node', ...)`.
 */
export abstract class BaseModule<
    TNodeInput = unknown,
    TNodeOutput = unknown,
> implements IBaseModule<TNodeInput, TNodeOutput> {
    protected handlers: Map<TransportType, IHandler<unknown, unknown, unknown>> =
        new Map();

    /**
     * Registers the private handler used for one transport.
     *
     * @param type Transport gateway owned by the handler.
     * @param handler Handler implementation to invoke for that transport.
     */
    registerHandler<TInput, TOutput, TResult = HandlerResult<TOutput>>(
        type: TransportType,
        handler: IHandler<TInput, TOutput, TResult>,
    ): void {
        this.handlers.set(
            type,
            handler as IHandler<unknown, unknown, unknown>,
        );
    }

    /**
     * Dispatches external or in-process input through a registered handler.
     *
     * This is the public interaction method exposed by module ports;
     * `registerHandler()` exists only for module construction.
     *
     * @param type The interface to use (`http`, `websocket`, `cli`, or `node`).
     * @param input The request data/payload.
     * @returns The selected handler result or a controlled unsupported-transport error.
     */
    async dispatch(
        type: 'node',
        input: TNodeInput,
    ): Promise<HandlerResult<TNodeOutput>>;
    async dispatch(
        type: 'http',
        input: Request,
    ): Promise<HttpDispatchResult>;
    async dispatch(
        type: Exclude<TransportType, 'node' | 'http'>,
        input: unknown,
    ): Promise<HandlerResult>;
    async dispatch(
        type: TransportType,
        input: TNodeInput | unknown,
    ): Promise<HandlerResult | Response> {
        const handler = this.handlers.get(type);
        if (!handler) {
            return {
                success: false,
                error: `Interface '${type}' is not supported by this module.`,
                statusCode: 405, // Method Not Allowed / Interface Not Supported
            };
        }

        try {
            const result = await handler.handle(input);
            return result instanceof Response
                ? result
                : result as HandlerResult;
        } catch {
            return {
                success: false,
                error: 'Internal module error',
                statusCode: 500,
            };
        }
    }
}
