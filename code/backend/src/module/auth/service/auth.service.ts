import type { Kysely } from 'kysely';
import { BaseWorkflowService } from '../../../base/base.workflow.service.ts';
import type { Database } from '../../../database.ts';
import { AuthSessionDTO } from '../dto/auth-session.dto.ts';
import { AuthUserDTO } from '../dto/auth-user.dto.ts';
import type {
    AuthHttpProtocol,
    AuthRuntime,
} from '../interfaces.ts';
import { BetterAuthServiceAux } from './auth/better-auth.service-aux.ts';

/** Owns Better Auth session access and safe DTO mapping. */
export class AuthService extends BaseWorkflowService {
    public readonly protocol: AuthHttpProtocol;
    private readonly runtime: AuthRuntime;

    /** Creates the Better Auth runtime over shared application infrastructure. */
    constructor(
        database: Kysely<Database>,
        options: {
            secret: string;
            baseUrl: string;
            registrationEnabled: boolean;
            trustedOrigins: readonly string[];
        },
    ) {
        super();
        this.runtime = new BetterAuthServiceAux().create(database, options);
        this.protocol = this.runtime;
    }

    /** Resolves a signed Bearer session and maps only safe public fields. */
    public async getSession(
        bearerToken: string,
    ): Promise<AuthSessionDTO | null> {
        const headers = new Headers({
            Authorization: `Bearer ${bearerToken}`,
        });
        const result = await this.runtime.api.getSession({ headers });
        return result
            ? new AuthSessionDTO(
                  result.session,
                  new AuthUserDTO(result.user),
              )
            : null;
    }
}
