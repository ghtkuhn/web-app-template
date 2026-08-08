import { BaseDTO } from '../../../base/base.dto.ts';
import type { AuthRuntimeSession } from '../interfaces.ts';
import { AuthUserDTO } from './auth-user.dto.ts';

/** Public session representation excluding tokens and account credentials. */
export class AuthSessionDTO extends BaseDTO {
    public readonly id: string;
    public readonly expiresAt: string;
    public readonly user: AuthUserDTO;

    /** Maps Better Auth's session and user result to safe DTOs. */
    constructor(session: AuthRuntimeSession, user: AuthUserDTO) {
        super();
        this.id = session.id;
        this.expiresAt = session.expiresAt.toISOString();
        this.user = user;
    }
}
