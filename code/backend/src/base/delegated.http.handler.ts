import type {
    HandlerResult,
    HttpDispatchResult,
    IHandler,
} from './interfaces.ts';

/**
 * Controlled adapter boundary for external protocols implemented with Fetch.
 *
 * Normal application handlers must continue through Controllers. This base is
 * reserved for third-party protocol engines that already own request routing,
 * response bodies, cookies, and headers.
 */
export abstract class DelegatedHttpHandler
    implements IHandler<Request, never, HttpDispatchResult>
{
    /** Preserves a delegated Response and sanitizes uncaught adapter failures. */
    public async handle(request: Request): Promise<HttpDispatchResult> {
        try {
            return await this.processRequest(request);
        } catch {
            return this.failure();
        }
    }

    /** Delegates one request to the external Fetch-compatible protocol engine. */
    protected abstract processRequest(request: Request): Promise<Response>;

    /** Returns the stable application failure envelope. */
    private failure(): HandlerResult {
        return {
            success: false,
            error: 'Internal Server Error',
            statusCode: 500,
        };
    }
}
