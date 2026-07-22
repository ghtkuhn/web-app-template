import { BaseHandler } from './base.handler.ts';
import { HandlerResult } from './interfaces.ts';

/**
 * HttpHandler adapts the internal Controller logic to HTTP (using Fetch API standards).
 *
 * RESPONSIBILITIES:
 * - Parse incoming Request objects.
 * - Convert HandlerResult into a standard Response object.
 *
 * IMPORT RULES:
 * - ALLOWED: Controllers, Base classes.
 * - FORBIDDEN: Stores, Services.
 */
export abstract class HttpHandler extends BaseHandler {
  /**
   * Specialized processRequest for HTTP.
   * @param request A standard Web Request object (fetch API).
   */
  protected async processRequest(request: Request): Promise<HandlerResult> {
    // Implementation will be handled in concrete module handlers,
    // but this base class ensures the type contract.
    throw new Error('processRequest must be implemented by a concrete HttpHandler');
  }

  /**
   * Helper to convert HandlerResult into a Fetch Response object.
   */
  protected createResponse(result: HandlerResult): Response {
    const status = result.statusCode || (result.success ? 200 : 500);
    const body = JSON.stringify({
      success: result.success,
      data: result.data,
      error: result.error,
    });

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
