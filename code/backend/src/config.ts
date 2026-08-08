/**
 * Central Configuration Management
 * Provides type-safe access to environment variables with sensible defaults for development.
 */
export const config = {
    server: {
        enabled: process.env.HTTP_ENABLED !== 'false',
        port: parseInt(process.env.PORT || '3000', 10),
        nodeEnv: process.env.NODE_ENV || 'development',
    },
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
    database: {
        type: (process.env.DB_TYPE || 'sqlite') as 'sqlite' | 'postgres',
        sqlitePath: process.env.DB_SQLITE_PATH || 'data/sqlite/backend.sqlite',
        backupRetention: parseInt(
            process.env.DB_BACKUP_RETENTION || '10',
            10,
        ),
        releaseId: process.env.DEPLOYMENT_RELEASE_ID || 'development',
        postgres: {
            host: process.env.DB_POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.DB_POSTGRES_PORT || '5432', 10),
            user: process.env.DB_POSTGRES_USER || 'postgres',
            password: process.env.DB_POSTGRES_PASSWORD || 'password',
            name: process.env.DB_POSTGRES_NAME || 'backend_db',
        },
    },
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
    (!config.database.sqlitePath.startsWith('/') ||
        config.security.allowedOrigins.length === 0 ||
        config.security.allowedOrigins.includes('*'))
) {
    throw new Error(
        'Production requires an absolute SQLite path and explicit allowed origins.',
    );
}

export type Config = typeof config;

if (
    !Number.isInteger(config.database.backupRetention) ||
    config.database.backupRetention < 1
) {
    throw new Error('DB_BACKUP_RETENTION must be an integer of at least 1.');
}
