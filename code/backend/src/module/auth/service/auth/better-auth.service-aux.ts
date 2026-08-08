import { betterAuth } from 'better-auth';
import { bearer, openAPI } from 'better-auth/plugins';
import type { Kysely } from 'kysely';
import { BaseServiceAux } from '../../../../base/base.service.aux.ts';
import type { Database } from '../../../../database.ts';
import type { AuthRuntime } from '../../interfaces.ts';

/** Creates the module-private Better Auth protocol runtime. */
export class BetterAuthServiceAux extends BaseServiceAux {
    /** Builds Better Auth over the process-owned Kysely client. */
    public create(
        database: Kysely<Database>,
        options: {
            secret: string;
            baseUrl: string;
            registrationEnabled: boolean;
            trustedOrigins: readonly string[];
        },
    ): AuthRuntime {
        return betterAuth({
            database: { db: database, type: 'sqlite', casing: 'camel' },
            secret: options.secret,
            baseURL: options.baseUrl,
            trustedOrigins: [...options.trustedOrigins],
            emailAndPassword: {
                enabled: true,
                disableSignUp: !options.registrationEnabled,
            },
            user: { modelName: 'auth_user' },
            session: { modelName: 'auth_session' },
            account: { modelName: 'auth_account' },
            verification: { modelName: 'auth_verification' },
            plugins: [
                bearer({ requireSignature: true }),
                openAPI({ disableDefaultReference: true }),
            ],
            telemetry: { enabled: false },
        });
    }
}
