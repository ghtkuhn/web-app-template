import { BaseHandler } from './base.handler.ts';
import type { HandlerResult } from './interfaces.ts';

/**
 * HttpHandler adapts the internal Controller logic to HTTP (using Fetch API standards).
 *
 * RESPONSIBILITIES:
 * - Parse incoming Request objects.
 * - Return a transport-neutral HandlerResult to the HTTP server.
 *
 * IMPORT RULES:
 * - ALLOWED: Controllers, Base classes.
 * - FORBIDDEN: Stores, Services.
 */
export abstract class HttpHandler extends BaseHandler<Request> {
    /**
     * Specialized processRequest for HTTP.
     * @param request A standard Web Request object (fetch API).
     */
    protected async processRequest(request: Request): Promise<HandlerResult> {
        // Implementation will be handled in concrete module handlers,
        // but this base class ensures the type contract.
        throw new Error(
            'processRequest must be implemented by a concrete HttpHandler',
        );
    }
}
