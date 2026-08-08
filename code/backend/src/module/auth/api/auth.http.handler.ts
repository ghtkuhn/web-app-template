import { DelegatedHttpHandler } from '../../../base/delegated.http.handler.ts';
import type { AuthHttpProtocol } from '../interfaces.ts';

/** Delegates `/api/auth/*` to Better Auth's Fetch protocol engine. */
export class AuthHttpHandler extends DelegatedHttpHandler {
    private readonly protocol: AuthHttpProtocol;

    /** Receives the configured Better Auth protocol. */
    constructor(protocol: AuthHttpProtocol) {
        super();
        this.protocol = protocol;
    }

    /** Preserves Better Auth's complete Fetch response. */
    protected async processRequest(request: Request): Promise<Response> {
        return this.protocol.handler(request);
    }
}
