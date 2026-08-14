import { BaseModule } from '../../base/base.module.ts';
import type {
    ApplicationInfrastructure,
    DatabaseType,
    NamedModuleDefinition,
} from '../../base/interfaces.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../../database.ts';
import { config } from '../../config.ts';
import { AuthHttpHandler } from './api/auth.http.handler.ts';
import { AuthNodeHandler } from './api/auth.node.handler.ts';
import { AUTH_MODULE_NAME } from './constants.ts';
import { AuthController } from './controller/auth.controller.ts';
import type { AuthSessionDTO } from './dto/auth-session.dto.ts';
import type { AuthModulePort } from './interfaces.ts';
import { AuthService } from './service/auth.service.ts';
import { AuthRuntimeService } from './service/auth-runtime.service.ts';
import type { AuthNodeRequest } from './types.ts';

export { AUTH_MODULE_NAME } from './constants.ts';
// fallow-ignore-next-line unused-export -- Public Node-port response contract.
export { AuthSessionDTO } from './dto/auth-session.dto.ts';
export type { AuthModulePort } from './interfaces.ts';
export type { AuthNodeRequest } from './types.ts';

/** Public gateway for Better Auth HTTP and in-process session verification. */
export class AuthModule
    extends BaseModule<AuthNodeRequest, AuthSessionDTO>
    implements AuthModulePort
{
    // module-sync:start
    /** Generated registry metadata. Change module.manifest.json, then run module:sync. */
    public static readonly definition = {
        name: AUTH_MODULE_NAME,
        dependencies: [],
        create: (
            _dependencies,
            infrastructure: ApplicationInfrastructure,
        ) =>
            new AuthModule(
                infrastructure.database,
                infrastructure.databaseType,
            ),
    } satisfies NamedModuleDefinition;
    // module-sync:end

    /** Composes one shared Better Auth runtime for HTTP and Node access. */
    constructor(database: Kysely<Database>, databaseType: DatabaseType) {
        super();
        const runtime = new AuthRuntimeService({
            database,
            databaseType,
            options: {
                secret: config.auth.secret,
                baseUrl: config.auth.baseUrl,
                registrationEnabled: config.auth.registrationEnabled,
                trustedOrigins: config.security.allowedOrigins,
            },
        }).createAuthRuntime();
        const service = new AuthService({
            runtime,
        });
        const controller = new AuthController(service);
        this.registerHandler('http', new AuthHttpHandler(runtime));
        this.registerHandler('node', new AuthNodeHandler(controller));
    }
}
