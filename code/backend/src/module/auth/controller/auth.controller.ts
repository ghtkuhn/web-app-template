import { BaseController } from '../../../base/base.controller.ts';
import type { HandlerResult } from '../../../base/interfaces.ts';
import type { AuthSessionDTO } from '../dto/auth-session.dto.ts';
import { AuthService } from '../service/auth.service.ts';

/** Coordinates transport-neutral session lookup. */
export class AuthController extends BaseController {
    private readonly service: AuthService;

    /** Receives the module-private Auth service. */
    constructor(service: AuthService) {
        super();
        this.service = service;
    }

    /** Returns a session DTO or a controlled unauthorized result. */
    public async getSession(
        bearerToken: string,
    ): Promise<HandlerResult<AuthSessionDTO>> {
        const session = await this.service.getSession({ bearerToken });
        return session
            ? this.success(session)
            : {
                  success: false,
                  error: 'Unauthorized',
                  statusCode: 401,
              };
    }
}
