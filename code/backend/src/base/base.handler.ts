import { IHandler, HandlerResult } from './interfaces.ts';

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
export abstract class BaseHandler implements IHandler {
  /**
   * The main entry point for the handler.
   * @param input Transport-specific input (e.g., Request object, CLI args).
   */
  async handle(input: any): Promise<HandlerResult> {
    try {
      return await this.processRequest(input);
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Internal Server Error',
        statusCode: 500,
      };
    }
  }

  /**
   * Abstract method to be implemented by specialized handlers.
   */
  protected abstract processRequest(input: any): Promise<HandlerResult>;
}
