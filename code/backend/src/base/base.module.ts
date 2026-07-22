import { IBaseModule, IHandler, HandlerResult } from './interfaces.ts';

/**
 * BaseModule acts as the Unified Gateway for a domain module.
 *
 * RESPONSIBILITIES:
 * - Act as the sole public entry point for the module.
 * - Route requests to the appropriate handler (HTTP, WS, CLI, Node) via .dispatch().
 * - Encapsulate all internal logic (Services, Stores) from other modules.
 *
 * IMPORT RULES:
 * - ALLOWED: Handlers, Base classes.
 * - FORBIDDEN: Services, Stores, Domain Objects (these should be managed by handlers/controllers).
 *
 * CONSTRAINTS:
 * - Must NOT contain business logic.
 * - All inter-module communication MUST go through this class via .dispatch('node', ...).
 */
export abstract class BaseModule implements IBaseModule {
  protected handlers: Map<string, IHandler> = new Map();

  /**
   * Registers a handler for a specific transport interface.
   */
  registerHandler(type: string, handler: IHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * The only public method to interact with this module.
   * @param type The interface to use ('http', 'ws', 'cli', 'node').
   * @param input The request data/payload.
   */
  async dispatch(type: string, input: any): Promise<HandlerResult> {
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
    } catch (error: any) {
      return {
        success: false,
        error: `Module Dispatch Error: ${error.message || 'Unknown error'}`,
        statusCode: 500,
      };
    }
  }
}
