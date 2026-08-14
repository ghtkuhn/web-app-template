import path from 'node:path';
import type { DatabaseType } from './base/interfaces.ts';

/** Shared configuration fields used by every database dialect. */
interface CommonDatabaseConfig {
    /** Stable release identifier recorded in migration backup metadata. */
    releaseId: string;
}

/** Validated SQLite runtime configuration. */
export interface SqliteDatabaseConfig extends CommonDatabaseConfig {
    /** Selects the embedded SQLite dialect. */
    type: 'sqlite';
    /** Project-relative or absolute SQLite database path. */
    sqlitePath: string;
    /** Number of successful migration backups retained locally. */
    backupRetention: number;
}

/** Validated PostgreSQL runtime configuration. */
export interface PostgresDatabaseConfig extends CommonDatabaseConfig {
    /** Selects the external PostgreSQL dialect. */
    type: 'postgres';
    /** Secret connection URL passed directly to the PostgreSQL pool. */
    connectionString: string;
    /** Maximum number of connections retained by the process pool. */
    poolMax: number;
    /** Time after which an unused pool connection may be closed. */
    idleTimeoutMs: number;
    /** Maximum time allowed while establishing a pool connection. */
    connectionTimeoutMs: number;
}

/** Runtime database configuration narrowed by the selected dialect. */
export type DatabaseConfig = SqliteDatabaseConfig | PostgresDatabaseConfig;

/** Validated native HTTP transport configuration. */
export interface HttpTransportConfig {
    enabled: boolean;
    port: number;
    nodeEnv: string;
    maxBodyBytes: number;
    requestTimeoutMs: number;
    headersTimeoutMs: number;
}

/** Parses the native HTTP transport environment contract. */
export class HttpTransportConfigLoader {
    /** Builds one validated HTTP transport configuration. */
    public static load(environment: NodeJS.ProcessEnv): HttpTransportConfig {
        return {
            enabled: environment.HTTP_ENABLED !== 'false',
            port: parseInt(environment.PORT || '3000', 10),
            nodeEnv: environment.NODE_ENV || 'development',
            maxBodyBytes: this.parsePositiveInteger(
                environment.HTTP_MAX_BODY_BYTES,
                1_048_576,
                'HTTP_MAX_BODY_BYTES',
            ),
            requestTimeoutMs: this.parsePositiveInteger(
                environment.HTTP_REQUEST_TIMEOUT_MS,
                30_000,
                'HTTP_REQUEST_TIMEOUT_MS',
            ),
            headersTimeoutMs: this.parsePositiveInteger(
                environment.HTTP_HEADERS_TIMEOUT_MS,
                10_000,
                'HTTP_HEADERS_TIMEOUT_MS',
            ),
        };
    }

    /** Parses one strictly positive decimal integer or returns its default. */
    private static parsePositiveInteger(
        value: string | undefined,
        fallback: number,
        name: string,
    ): number {
        if (value === undefined) {
            return fallback;
        }
        if (!/^[1-9][0-9]*$/u.test(value)) {
            throw new Error(`${name} must be a positive integer.`);
        }
        const parsed = Number(value);
        if (!Number.isSafeInteger(parsed)) {
            throw new Error(`${name} must be a positive safe integer.`);
        }
        return parsed;
    }
}

/** Parses and validates the database-specific environment contract. */
export class DatabaseConfigLoader {
    /** Builds one validated database configuration from environment values. */
    public static load(environment: NodeJS.ProcessEnv): DatabaseConfig {
        const type = environment.DB_TYPE || 'sqlite';
        if (!this.isDatabaseType(type)) {
            throw new Error(
                `DB_TYPE must be 'sqlite' or 'postgres'; received '${type}'.`,
            );
        }
        return type === 'sqlite'
            ? this.loadSqlite(environment)
            : this.loadPostgres(environment);
    }

    private static loadSqlite(
        environment: NodeJS.ProcessEnv,
    ): SqliteDatabaseConfig {
        return {
            type: 'sqlite',
            sqlitePath:
                environment.DB_SQLITE_PATH || 'data/sqlite/backend.sqlite',
            backupRetention: this.parseInteger(
                environment.DB_BACKUP_RETENTION,
                10,
                'DB_BACKUP_RETENTION',
                1,
            ),
            releaseId:
                environment.DEPLOYMENT_RELEASE_ID || 'development',
        };
    }

    private static loadPostgres(
        environment: NodeJS.ProcessEnv,
    ): PostgresDatabaseConfig {
        const connectionString = environment.DATABASE_URL || '';
        this.assertPostgresUrl(connectionString, environment.NODE_ENV);
        return {
            type: 'postgres',
            connectionString,
            poolMax: this.parseInteger(
                environment.DB_POSTGRES_POOL_MAX,
                10,
                'DB_POSTGRES_POOL_MAX',
                1,
            ),
            idleTimeoutMs: this.parseInteger(
                environment.DB_POSTGRES_IDLE_TIMEOUT_MS,
                30000,
                'DB_POSTGRES_IDLE_TIMEOUT_MS',
                0,
            ),
            connectionTimeoutMs: this.parseInteger(
                environment.DB_POSTGRES_CONNECTION_TIMEOUT_MS,
                10000,
                'DB_POSTGRES_CONNECTION_TIMEOUT_MS',
                0,
            ),
            releaseId:
                environment.DEPLOYMENT_RELEASE_ID || 'development',
        };
    }

    private static isDatabaseType(value: string): value is DatabaseType {
        return value === 'sqlite' || value === 'postgres';
    }

    private static parseInteger(
        value: string | undefined,
        fallback: number,
        name: string,
        minimum: number,
    ): number {
        const parsed = value === undefined ? fallback : Number(value);
        if (!Number.isInteger(parsed) || parsed < minimum) {
            throw new Error(`${name} must be an integer of at least ${minimum}.`);
        }
        return parsed;
    }

    private static assertPostgresUrl(
        connectionString: string,
        nodeEnvironment: string | undefined,
    ): void {
        const url = this.parsePostgresUrl(connectionString);
        this.assertPostgresProtocol(url);
        this.assertPostgresLocation(url);
        if (nodeEnvironment === 'production') {
            this.assertProductionPostgresTls(url);
        }
    }

    private static parsePostgresUrl(connectionString: string): URL {
        let url: URL;
        try {
            url = new URL(connectionString);
        } catch {
            throw new Error(
                'DATABASE_URL must be an absolute PostgreSQL connection URL when DB_TYPE=postgres.',
            );
        }
        return url;
    }

    private static assertPostgresProtocol(url: URL): void {
        if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
            throw new Error(
                'DATABASE_URL must use the postgres: or postgresql: protocol.',
            );
        }
    }

    private static assertPostgresLocation(url: URL): void {
        if (!url.hostname || url.pathname === '/' || url.pathname === '') {
            throw new Error(
                'DATABASE_URL must include a host and database name.',
            );
        }
    }

    private static assertProductionPostgresTls(url: URL): void {
        if (
            url.protocol !== 'postgresql:' ||
            url.searchParams.get('sslmode') !== 'verify-full'
        ) {
            throw new Error(
                'Production PostgreSQL requires a postgresql: DATABASE_URL with sslmode=verify-full.',
            );
        }
    }
}

/** Central validated application configuration. */
export const config = {
    server: HttpTransportConfigLoader.load(process.env),
    websocket: {
        enabled: process.env.WEBSOCKET_ENABLED !== 'false',
        port: parseInt(process.env.WEBSOCKET_PORT || '3001', 10),
        maxMessageBytes: parseInt(
            process.env.WEBSOCKET_MAX_MESSAGE_BYTES || '1048576',
            10,
        ),
        heartbeatIntervalMs: parseInt(
            process.env.WEBSOCKET_HEARTBEAT_INTERVAL_MS || '30000',
            10,
        ),
    },
    cli: {
        enabled: process.env.CLI_ENABLED !== 'false',
    },
    modules: {
        /** Module gateways instantiated during application startup. */
        active: (process.env.ACTIVE_MODULES || 'health')
            .split(',')
            .map((name) => name.trim())
            .filter(Boolean)
            .concat(process.env.AUTH_ENABLED === 'true' ? ['auth'] : [])
            .filter((name, index, names) => names.indexOf(name) === index),
    },
    database: DatabaseConfigLoader.load(process.env),
    security: {
        appSecret:
            process.env.APP_SECRET || 'dev-secret-key-do-not-use-in-production',
        allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    },
    auth: {
        enabled: process.env.AUTH_ENABLED === 'true',
        registrationEnabled:
            process.env.AUTH_REGISTRATION_ENABLED === 'true',
        secret: process.env.BETTER_AUTH_SECRET || '',
        baseUrl:
            process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3000',
    },
    logging: {
        level: process.env.LOG_LEVEL || 'info',
    },
};

if (config.auth.enabled && config.auth.secret.length < 32) {
    throw new Error(
        'BETTER_AUTH_SECRET must contain at least 32 characters when Auth is enabled.',
    );
}

try {
    new URL(config.auth.baseUrl);
} catch {
    throw new Error('BETTER_AUTH_BASE_URL must be an absolute URL.');
}

if (
    config.server.nodeEnv === 'production' &&
    config.security.appSecret === 'dev-secret-key-do-not-use-in-production'
) {
    throw new Error('APP_SECRET is required in production.');
}
if (
    config.server.nodeEnv === 'production' &&
    (config.security.allowedOrigins.length === 0 ||
        config.security.allowedOrigins.includes('*'))
) {
    throw new Error(
        'Production requires explicit allowed origins.',
    );
}

if (
    config.server.nodeEnv === 'production' &&
    config.database.type === 'sqlite' &&
    !path.isAbsolute(config.database.sqlitePath)
) {
    throw new Error('Production SQLite requires an absolute database path.');
}

export type Config = typeof config;
