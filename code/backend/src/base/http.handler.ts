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
     * Processes one HTTP request after native-server adaptation.
     *
     * @param request A standard Web Request object (fetch API).
     * @returns A transport-neutral result for HTTP serialization.
     */
    protected async processRequest(request: Request): Promise<HandlerResult> {
        throw new Error(
            'processRequest must be implemented by a concrete HttpHandler',
        );
    }
}
