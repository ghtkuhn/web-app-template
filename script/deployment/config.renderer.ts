import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
    ComponentName,
    DeploymentProfile,
} from './interfaces.ts';

/** Renders ephemeral component configuration without writing secrets to profiles. */
export class DeploymentConfigRenderer {
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
        if (!/^\/[A-Za-z0-9_./-]+$/.test(profile.backend.sqlitePath)) {
            throw new Error('SQLite deployment path must be a safe absolute path.');
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseId)) {
            throw new Error('Deployment release identifier is invalid.');
        }
        return [
            `NODE_ENV=${profile.environment === 'prod' ? 'production' : 'development'}`,
            `APP_SECRET=${environment.APP_SECRET ?? ''}`,
            'HTTP_ENABLED=true',
            'PORT=3000',
            'WEBSOCKET_ENABLED=true',
            'WEBSOCKET_PORT=3001',
            'DB_TYPE=sqlite',
            `DB_SQLITE_PATH=${profile.backend.sqlitePath}`,
            `DB_BACKUP_RETENTION=${profile.backend.databaseBackupRetention ?? 10}`,
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
