import type {
    IBaseModule,
} from '../../base/interfaces.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../../database.ts';
import type { DatabaseType } from '../../base/interfaces.ts';
import type { AuthSessionDTO } from './dto/auth-session.dto.ts';
import type { AuthNodeRequest } from './types.ts';

/** Minimal Fetch protocol exposed by the Better Auth runtime. */
export interface AuthHttpProtocol {
    handler(request: Request): Promise<Response>;
}

/** User fields returned by Better Auth session lookup. */
export interface AuthRuntimeUser {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
}

/** Session fields returned by Better Auth session lookup. */
export interface AuthRuntimeSession {
    id: string;
    userId: string;
    expiresAt: Date;
}

/** Runtime API subset consumed by the application service. */
export interface AuthRuntime extends AuthHttpProtocol {
    api: {
        getSession(input: {
            headers: Headers;
        }): Promise<{
            user: AuthRuntimeUser;
            session: AuthRuntimeSession;
        } | null>;
        generateOpenAPISchema(): Promise<AuthOpenApiDocument>;
    };
}

/** OpenAPI document shape returned by Better Auth's schema generator. */
export interface AuthOpenApiDocument {
    readonly openapi: string;
    readonly paths: Readonly<Record<string, unknown>>;
    readonly components?: Readonly<Record<string, unknown>>;
    readonly tags?: readonly unknown[];
}

/** Validated options used to create one Better Auth runtime. */
export interface AuthRuntimeOptions {
    readonly secret: string;
    readonly baseUrl: string;
    readonly registrationEnabled: boolean;
    readonly trustedOrigins: readonly string[];
}

/** Dependencies of the one-time Auth runtime bootstrap Operation. */
export interface AuthRuntimeServiceDependencies {
    readonly database: Kysely<Database>;
    readonly databaseType: DatabaseType;
    readonly options: AuthRuntimeOptions;
}

/** Dependencies shared by Auth application Operations. */
export interface AuthServiceDependencies {
    readonly runtime: AuthRuntime;
}

/** Public in-process contract exposed by the Auth module. */
export interface AuthModulePort
    extends IBaseModule<AuthNodeRequest, AuthSessionDTO> {}
