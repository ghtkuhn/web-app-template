import { betterAuth } from 'better-auth';
import { bearer, openAPI } from 'better-auth/plugins';
import { BaseServiceOperation } from '../../../../base/base.service.operation.ts';
import type {
    AuthRuntime,
    AuthRuntimeServiceDependencies,
} from '../../interfaces.ts';

/** Creates the module's single Better Auth protocol runtime. */
export class CreateAuthRuntimeOperation extends BaseServiceOperation<
    void,
    AuthRuntime,
    AuthRuntimeServiceDependencies
> {
    /** Builds Better Auth over the application-owned Kysely connection. */
    public execute(_input: void): AuthRuntime {
        const { database, options } = this.dependencies;
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
