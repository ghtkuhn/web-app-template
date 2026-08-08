import { NodeHandler } from '../../../base/node.handler.ts';
import type { HandlerResult } from '../../../base/interfaces.ts';
import { AuthController } from '../controller/auth.controller.ts';
import type { AuthSessionDTO } from '../dto/auth-session.dto.ts';
import type { AuthNodeRequest } from '../types.ts';

/** Adapts typed in-process Auth requests to the Controller. */
export class AuthNodeHandler extends NodeHandler<
    AuthNodeRequest,
    AuthSessionDTO
> {
    private readonly controller: AuthController;

    /** Receives the transport-neutral Auth Controller. */
    constructor(controller: AuthController) {
        super();
        this.controller = controller;
    }

    /** Executes the single discriminated session operation. */
    protected async processRequest(
        request: AuthNodeRequest,
    ): Promise<HandlerResult<AuthSessionDTO>> {
        if (request.operation === 'getSession') {
            return this.controller.getSession(request.bearerToken);
        }
        return {
            success: false,
            error: 'Unknown Auth operation',
            statusCode: 400,
        };
    }
}
