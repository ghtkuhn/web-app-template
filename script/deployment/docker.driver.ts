import type {
    ComponentName,
    DeploymentProfile,
    DockerTarget,
} from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';

/** Builds and operates Docker-backed deployment components. */
export class DockerDeploymentDriver {
    private readonly projectRoot: string;
    private readonly processes: ProcessRunner;

    public constructor(
        projectRoot: string,
        processes = new ProcessRunner(),
    ) {
        this.projectRoot = projectRoot;
        this.processes = processes;
    }

    public build(component: ComponentName, target: DockerTarget): void {
        this.processes.run('docker', [
            'build',
            '--file',
            `deployment/docker/${component}.Dockerfile`,
            '--tag',
            target.image,
            '.',
        ], { cwd: this.projectRoot });
    }

    public deploy(
        profile: DeploymentProfile,
        components: readonly ComponentName[],
        releaseId: string,
    ): void {
        this.compose(
            profile,
            ['up', '--detach', '--wait', ...components],
            releaseId,
        );
        if (components.includes('backend')) {
            this.databaseCommand(profile, ['retain']);
        }
    }

    public stop(
        profile: DeploymentProfile,
        components: readonly ComponentName[],
    ): void {
        this.compose(profile, ['stop', ...components]);
    }

    public status(
        profile: DeploymentProfile,
        components: readonly ComponentName[],
    ): string {
        return this.compose(profile, ['ps', ...components]);
    }

    private compose(
        profile: DeploymentProfile,
        arguments_: readonly string[],
        releaseId = 'maintenance',
    ): string {
        return this.processes.run(
            'docker',
            [
                'compose',
                '--file',
                'deployment/docker-compose.yml',
                '--project-name',
                `web-app-${profile.name}`,
                ...arguments_,
            ],
            {
                cwd: this.projectRoot,
                env: {
                    ...process.env,
                    DEPLOYMENT_PROFILE: profile.name,
                    BACKEND_IMAGE:
                        profile.backend.enabled &&
                        profile.backend.target.driver === 'docker'
                            ? profile.backend.target.image
                            : 'web-app-backend:local',
                    FRONTEND_IMAGE:
                        profile.frontend.enabled &&
                        profile.frontend.target.driver === 'docker'
                            ? profile.frontend.target.image
                            : 'web-app-frontend:local',
                    BACKEND_HTTP_PORT:
                        profile.backend.enabled &&
                        profile.backend.target.driver === 'docker'
                            ? String(profile.backend.target.hostPort)
                            : '3000',
                    BACKEND_WEBSOCKET_PORT:
                        profile.backend.enabled
                            ? String(
                                  new URL(
                                      profile.backend.publicWebSocketUrl,
                                  ).port || 3001,
                              )
                            : '3001',
                    FRONTEND_HTTP_PORT:
                        profile.frontend.enabled &&
                        profile.frontend.target.driver === 'docker'
                            ? String(profile.frontend.target.hostPort)
                            : '8080',
                    DEPLOY_NODE_ENV:
                        profile.environment === 'prod'
                            ? 'production'
                            : 'development',
                    DEPLOY_SQLITE_PATH:
                        profile.backend.enabled
                            ? profile.backend.sqlitePath
                            : '/var/lib/web-app/backend.sqlite',
                    DB_BACKUP_RETENTION:
                        profile.backend.enabled
                            ? String(
                                  profile.backend.databaseBackupRetention ?? 10,
                              )
                            : '10',
                    DEPLOYMENT_RELEASE_ID: releaseId,
                    DEPLOY_ACTIVE_MODULES:
                        profile.backend.enabled
                            ? profile.backend.activeModules.join(',')
                            : 'health',
                    DEPLOY_ALLOWED_ORIGINS:
                        profile.backend.enabled
                            ? profile.backend.allowedOrigins.join(',')
                            : '',
                    DEPLOY_AUTH_ENABLED:
                        profile.backend.enabled &&
                        profile.backend.activeModules.includes('auth')
                            ? 'true'
                            : 'false',
                    DEPLOY_AUTH_REGISTRATION_ENABLED:
                        profile.backend.enabled &&
                        profile.backend.authRegistrationEnabled
                            ? 'true'
                            : 'false',
                    DEPLOY_BETTER_AUTH_BASE_URL:
                        profile.backend.enabled
                            ? profile.backend.publicHttpUrl
                            : 'http://localhost:3000',
                    FRONTEND_API_BASE_URL:
                        profile.frontend.enabled
                            ? profile.frontend.runtime.apiBaseUrl
                            : '/',
                    FRONTEND_WEBSOCKET_URL:
                        profile.frontend.enabled
                            ? profile.frontend.runtime.webSocketUrl
                            : 'ws://localhost:3001',
                    FRONTEND_PRESENTATION_LOCK:
                        profile.frontend.enabled
                            ? profile.frontend.runtime.presentationLock ?? 'null'
                            : 'null',
                    FRONTEND_AUTH_ENABLED:
                        profile.frontend.enabled &&
                        profile.frontend.runtime.authEnabled
                            ? 'true'
                            : 'false',
                    FRONTEND_REGISTRATION_ENABLED:
                        profile.frontend.enabled &&
                        profile.frontend.runtime.registrationEnabled
                            ? 'true'
                            : 'false',
                },
            },
        );
    }

    /** Lists persistent SQLite backups through a one-shot backend container. */
    public databaseList(profile: DeploymentProfile): string {
        return this.databaseCommand(profile, ['list']);
    }

    /** Restores a backup while the backend remains stopped on failure. */
    public databaseRestore(
        profile: DeploymentProfile,
        backupId: string,
    ): string {
        this.stop(profile, ['backend']);
        const output = this.databaseCommand(profile, ['restore', backupId]);
        this.deploy(profile, ['backend'], `restore-${Date.now()}`);
        return output;
    }

    private databaseCommand(
        profile: DeploymentProfile,
        arguments_: readonly string[],
    ): string {
        return this.compose(profile, [
            'run',
            '--rm',
            '--no-deps',
            'backend',
            'node',
            '--experimental-transform-types',
            'code/backend/script/database-maintenance.ts',
            ...arguments_,
        ]);
    }
}
