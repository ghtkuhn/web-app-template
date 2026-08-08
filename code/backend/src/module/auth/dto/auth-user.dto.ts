import { BaseDTO } from '../../../base/base.dto.ts';
import type { AuthRuntimeUser } from '../interfaces.ts';

/** Public, non-sensitive user representation returned with a session. */
export class AuthUserDTO extends BaseDTO {
    public readonly id: string;
    public readonly name: string;
    public readonly email: string;
    public readonly emailVerified: boolean;
    public readonly image: string | null;

    /** Maps Better Auth's controlled user result to a transport DTO. */
    constructor(user: AuthRuntimeUser) {
        super();
        this.id = user.id;
        this.name = user.name;
        this.email = user.email;
        this.emailVerified = user.emailVerified;
        this.image = user.image ?? null;
    }
}
