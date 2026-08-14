import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
    ComponentName,
    DeploymentDatabase,
    DeploymentProfile,
} from './interfaces.ts';

/** Renders ephemeral component configuration without writing secrets to profiles. */
export class DeploymentConfigRenderer {
    /** Validates backend database settings and secrets without writing a file. */
    public validateBackend(
        profile: DeploymentProfile,
        environment: NodeJS.ProcessEnv = process.env,
    ): void {
        if (!profile.backend.enabled) {
            throw new Error('Backend is disabled.');
        }
        this.database(
            profile.backend.database,
            profile.environment,
            environment,
        );
    }

    public render(
        profile: DeploymentProfile,
        component: ComponentName,
        environment: NodeJS.ProcessEnv = process.env,
        releaseId = 'development',
    ): string {
        const directory = fs.mkdtempSync(
            path.join(os.tmpdir(), 'web-app-deployment-config-'),
        );
        const filePath = path.join(
            directory,
            component === 'backend' ? 'backend.env' : 'runtime-config.js',
        );
        const content = component === 'backend'
            ? this.backend(profile, environment, releaseId)
            : this.frontend(profile);
        fs.writeFileSync(filePath, content, { mode: 0o600 });
        return filePath;
    }

    private backend(
        profile: DeploymentProfile,
        environment: NodeJS.ProcessEnv,
        releaseId: string,
    ): string {
        if (!profile.backend.enabled) {
            throw new Error('Backend is disabled.');
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseId)) {
            throw new Error('Deployment release identifier is invalid.');
        }
        return [
            `NODE_ENV=${profile.environment === 'prod' ? 'production' : 'development'}`,
            `APP_SECRET=${environment.APP_SECRET ?? ''}`,
            'HTTP_ENABLED=true',
            'PORT=3000',
            `HTTP_MAX_BODY_BYTES=${environment.HTTP_MAX_BODY_BYTES ?? '1048576'}`,
            `HTTP_REQUEST_TIMEOUT_MS=${environment.HTTP_REQUEST_TIMEOUT_MS ?? '30000'}`,
            `HTTP_HEADERS_TIMEOUT_MS=${environment.HTTP_HEADERS_TIMEOUT_MS ?? '10000'}`,
            'WEBSOCKET_ENABLED=true',
            'WEBSOCKET_PORT=3001',
            ...this.database(
                profile.backend.database,
                profile.environment,
                environment,
            ),
            `DEPLOYMENT_RELEASE_ID=${releaseId}`,
            `ACTIVE_MODULES=${profile.backend.activeModules.join(',')}`,
            `ALLOWED_ORIGINS=${profile.backend.allowedOrigins.join(',')}`,
            `AUTH_ENABLED=${profile.backend.activeModules.includes('auth')}`,
            `AUTH_REGISTRATION_ENABLED=${profile.backend.authRegistrationEnabled}`,
            `BETTER_AUTH_BASE_URL=${profile.backend.publicHttpUrl}`,
            `BETTER_AUTH_SECRET=${environment.BETTER_AUTH_SECRET ?? ''}`,
            '',
        ].join('\n');
    }

    private database(
        database: DeploymentDatabase,
        deploymentEnvironment: DeploymentProfile['environment'],
        environment: NodeJS.ProcessEnv,
    ): readonly string[] {
        if (database.type === 'sqlite') {
            if (!/^\/[A-Za-z0-9_./-]+$/.test(database.path)) {
                throw new Error(
                    'SQLite deployment path must be a safe absolute path.',
                );
            }
            return [
                'DB_TYPE=sqlite',
                `DB_SQLITE_PATH=${database.path}`,
                `DB_BACKUP_RETENTION=${database.backupRetention}`,
            ];
        }
        const connectionString = environment[database.connectionUrlSecret];
        if (!connectionString || /[\r\n]/u.test(connectionString)) {
            throw new Error(
                `${database.connectionUrlSecret} must contain a PostgreSQL connection URL.`,
            );
        }
        const url = this.postgresUrl(connectionString);
        if (
            deploymentEnvironment === 'prod' &&
            (
                url.protocol !== 'postgresql:' ||
                url.searchParams.get('sslmode') !== 'verify-full'
            )
        ) {
            throw new Error(
                'Production PostgreSQL requires sslmode=verify-full.',
            );
        }
        return [
            'DB_TYPE=postgres',
            `DATABASE_URL=${connectionString}`,
            `DB_POSTGRES_POOL_MAX=${database.poolMax ?? 10}`,
            `DB_POSTGRES_IDLE_TIMEOUT_MS=${database.idleTimeoutMs ?? 30000}`,
            `DB_POSTGRES_CONNECTION_TIMEOUT_MS=${database.connectionTimeoutMs ?? 10000}`,
        ];
    }

    private postgresUrl(connectionString: string): URL {
        let url: URL;
        try {
            url = new URL(connectionString);
        } catch {
            throw new Error('DATABASE_URL must be an absolute URL.');
        }
        if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
            throw new Error('DATABASE_URL must use a PostgreSQL protocol.');
        }
        return url;
    }

    private frontend(profile: DeploymentProfile): string {
        if (!profile.frontend.enabled) {
            throw new Error('Frontend is disabled.');
        }
        return [
            'window.__APP_CONFIG__ = {',
            `    apiBaseUrl: ${JSON.stringify(profile.frontend.runtime.apiBaseUrl)},`,
            `    webSocketUrl: ${JSON.stringify(profile.frontend.runtime.webSocketUrl)},`,
            `    presentationLock: ${JSON.stringify(profile.frontend.runtime.presentationLock)},`,
            `    authEnabled: ${JSON.stringify(profile.frontend.runtime.authEnabled)},`,
            `    registrationEnabled: ${JSON.stringify(profile.frontend.runtime.registrationEnabled)},`,
            '};',
            '',
        ].join('\n');
    }
}
