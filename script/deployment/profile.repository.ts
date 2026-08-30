import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type {
    BackendDeployment,
    DeploymentDatabase,
    DeploymentProfile,
    DeploymentTarget,
    DisabledDeployment,
} from './interfaces.ts';
import {
    DeploymentProjectConfigRepository,
} from './project-config.repository.ts';

interface LegacyBackendDeployment
    extends Omit<BackendDeployment, 'database'>
{
    readonly sqlitePath: string;
    readonly databaseBackupRetention?: number;
}

interface LegacyDeploymentProfile
    extends Omit<DeploymentProfile, 'schemaVersion' | 'backend'>
{
    readonly schemaVersion: 1;
    readonly backend: LegacyBackendDeployment | DisabledDeployment;
}

type StoredDeploymentProfile = DeploymentProfile | LegacyDeploymentProfile;

/** Loads, validates, and safely scaffolds deployment profiles. */
export class DeploymentProfileRepository {
    private readonly profilesRoot: string;
    private readonly validateProfile;
    private readonly projectRoot: string;

    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        this.profilesRoot = path.join(projectRoot, 'deployment/profiles');
        const schema = JSON.parse(fs.readFileSync(
            path.join(projectRoot, 'deployment/profile.schema.json'),
            'utf8',
        ));
        this.validateProfile = new Ajv2020({
            allErrors: true,
            strict: true,
            formats: {
                uri: {
                    type: 'string',
                    validate: (value: string) => {
                        try {
                            new URL(value);
                            return true;
                        } catch {
                            return false;
                        }
                    },
                },
            },
        }).compile(schema);
    }

    /** Loads a named profile or local when omitted. */
    public load(name = 'local'): DeploymentProfile {
        this.assertName(name);
        const versionedPath = path.join(this.profilesRoot, `${name}.json`);
        const localPath = path.join(
            this.profilesRoot,
            `${name}.local.json`,
        );
        const filePath = fs.existsSync(versionedPath)
            ? versionedPath
            : localPath;
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (!this.validateProfile(parsed)) {
            throw new Error(
                `Invalid deployment profile '${name}': ${this.validateProfile.errors?.map((error) => error.message).join(', ')}`,
            );
        }
        const stored = parsed as StoredDeploymentProfile;
        this.assertStoredVersion(stored);
        const profile = this.normalize(stored);
        this.assertSecurity(profile);
        return profile;
    }

    /** Loads every checked-in profile in deterministic name order. */
    public loadAll(): readonly DeploymentProfile[] {
        return fs.readdirSync(this.profilesRoot)
            .filter(
                (name) =>
                    name.endsWith('.json') &&
                    !name.endsWith('.local.json'),
            )
            .sort()
            .map((name) => this.load(name.slice(0, -5)));
    }

    /** Creates a new profile using explicit drivers or the project default. */
    public scaffold(
        name: string,
        sourceName = 'local',
        backendDriver?: string,
        frontendDriver?: string,
        databaseType = 'sqlite',
    ): string {
        this.assertName(name);
        const target = path.join(this.profilesRoot, `${name}.json`);
        if (fs.existsSync(target)) {
            throw new Error(`Deployment profile '${name}' already exists.`);
        }
        const source = this.load(sourceName);
        const environment = this.environment(name);
        const database = this.database(databaseType);
        const defaultDriver = new DeploymentProjectConfigRepository(
            this.projectRoot,
        ).load().platform;
        const backendTarget = source.backend.enabled
            ? this.target(
                  name,
                  environment,
                  'backend',
                  backendDriver ?? defaultDriver,
              )
            : undefined;
        const frontendTarget = source.frontend.enabled
            ? this.target(
                  name,
                  environment,
                  'frontend',
                  frontendDriver ?? defaultDriver,
              )
            : undefined;
        const profile: DeploymentProfile = {
            ...source,
            schemaVersion: 2,
            name,
            environment,
            requiredSecrets: this.requiredSecrets(
                source.requiredSecrets,
                database,
                [backendTarget, frontendTarget].filter(
                    (target): target is DeploymentTarget => Boolean(target),
                ),
            ),
            backend: source.backend.enabled
                ? {
                      ...source.backend,
                      publicHttpUrl: environment === 'prod'
                          ? `https://api.${name}.example.com`
                          : source.backend.publicHttpUrl,
                      publicWebSocketUrl: environment === 'prod'
                          ? `wss://api.${name}.example.com/ws`
                          : source.backend.publicWebSocketUrl,
                      allowedOrigins: environment === 'prod'
                          ? [`https://${name}.example.com`]
                          : source.backend.allowedOrigins,
                      target: backendTarget as DeploymentTarget,
                      database: database.type === 'sqlite' &&
                          backendTarget !== undefined &&
                          backendTarget.driver !== 'docker'
                          ? {
                                ...database,
                                path: `/var/lib/${backendTarget.installationId}/backend.sqlite`,
                            }
                          : database,
                  }
                : source.backend,
            frontend: source.frontend.enabled
                ? {
                      ...source.frontend,
                      publicUrl: environment === 'prod'
                          ? `https://${name}.example.com`
                          : source.frontend.publicUrl,
                      target: frontendTarget as DeploymentTarget,
                      runtime: environment === 'prod'
                          ? {
                                ...source.frontend.runtime,
                                apiBaseUrl:
                                    `https://api.${name}.example.com`,
                                webSocketUrl:
                                    `wss://api.${name}.example.com/ws`,
                            }
                          : source.frontend.runtime,
                  }
                : source.frontend,
        };
        if (!this.validateProfile(profile)) {
            throw new Error(
                `Generated deployment profile is invalid: ${this.validateProfile.errors?.map((error) => error.message).join(', ')}`,
            );
        }
        this.assertSecurity(profile as DeploymentProfile, true);
        fs.writeFileSync(target, `${JSON.stringify(profile, null, 4)}\n`);
        return target;
    }

    private target(
        profileName: string,
        environment: DeploymentProfile['environment'],
        component: 'backend' | 'frontend',
        driver: string,
    ): DeploymentTarget {
        if (!['docker', 'proxmox-lxc', 'existing-lxc'].includes(driver)) {
            throw new Error(`Unknown deployment driver '${driver}'.`);
        }
        if (driver === 'docker') {
            return {
                driver: 'docker',
                image: `web-app-${component}:${profileName}`,
                hostPort: component === 'backend' ? 3000 : 8080,
            };
        }
        const ssh = {
            installationId: profileName,
            sshAuthentication: 'private-key' as const,
            sshHost: `${component}.local`,
            sshPort: 22,
            sshHostKeyFingerprint:
                'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        };
        if (driver === 'existing-lxc') {
            return {
                driver,
                ...ssh,
            };
        }
        return {
            driver: 'proxmox-lxc',
            ...ssh,
            sshUser: 'root',
            apiUrl: 'https://proxmox.local:8006',
            node: 'pve',
            vmid: component === 'backend' ? 200 : 201,
            hostname: `web-app-${component}`,
            storage: 'local-lvm',
            template:
                'local:vztmpl/debian-13-standard_13.0-1_amd64.tar.zst',
            bridge: 'vmbr0',
            address: 'dhcp',
            gateway: '192.168.1.1',
            nameserver: '1.1.1.1',
            firewall: true,
            startOnBoot: true,
            stopContainer: true,
            sshPublicKey: 'replace-with-public-key',
            cores: 2,
            memoryMb: component === 'backend' ? 1024 : 512,
            swapMb: 512,
            diskGb: 8,
            allowInsecureTls:
                environment === 'local' || environment === 'dev',
        };
    }

    private database(type: string): DeploymentDatabase {
        if (type === 'sqlite') {
            return {
                type,
                path: '/var/lib/web-app/backend.sqlite',
                backupRetention: 10,
            };
        }
        if (type === 'postgres') {
            return {
                type,
                connectionUrlSecret: 'DATABASE_URL',
                backupStrategy: 'external',
                poolMax: 10,
                idleTimeoutMs: 30000,
                connectionTimeoutMs: 10000,
            };
        }
        throw new Error(`Unknown database type '${type}'.`);
    }

    private requiredSecrets(
        source: readonly string[],
        database: DeploymentDatabase,
        targets: readonly DeploymentTarget[],
    ): readonly string[] {
        const secrets = new Set(source);
        if (database.type === 'postgres') {
            secrets.add(database.connectionUrlSecret);
        } else {
            secrets.delete('DATABASE_URL');
        }
        for (const target of targets) {
            if (target.driver === 'docker') {
                continue;
            }
            secrets.add(
                target.sshAuthentication === 'password'
                    ? 'DEPLOYMENT_SSH_PASSWORD'
                    : 'DEPLOYMENT_SSH_PRIVATE_KEY',
            );
        }
        return [...secrets].sort((left, right) => left.localeCompare(right));
    }

    private assertSecurity(
        profile: DeploymentProfile,
        allowScaffoldHostKeyPlaceholder = false,
    ): void {
        const serialized = JSON.stringify(profile);
        for (const forbidden of ['password', 'privatekey', 'tokensecret']) {
            if (new RegExp(`"${forbidden}"\\s*:`, 'iu').test(serialized)) {
                throw new Error(`Profiles must not contain '${forbidden}'.`);
            }
        }
        this.assertDatabaseConfiguration(profile);
        this.assertAuthConfiguration(profile);
        this.assertSshSecrets(profile);
        this.assertProductionUrls(profile);
        if (!allowScaffoldHostKeyPlaceholder) {
            this.assertProductionHostKeys(profile);
        }
        if (
            profile.environment !== 'local' &&
            profile.environment !== 'dev'
        ) {
            this.assertVerifiedProxmoxTls(profile);
        }
    }

    private assertSshSecrets(profile: DeploymentProfile): void {
        for (const component of [profile.backend, profile.frontend]) {
            if (!component.enabled || component.target.driver === 'docker') {
                continue;
            }
            const secret = component.target.sshAuthentication === 'password'
                ? 'DEPLOYMENT_SSH_PASSWORD'
                : 'DEPLOYMENT_SSH_PRIVATE_KEY';
            if (!profile.requiredSecrets.includes(secret)) {
                throw new Error(`${component.target.driver} requires ${secret}.`);
            }
        }
    }

    private assertProductionUrls(profile: DeploymentProfile): void {
        if (profile.environment !== 'prod') {
            return;
        }
        if (
            !profile.backend.enabled ||
            profile.backend.allowedOrigins.length === 0 ||
            new URL(profile.backend.publicHttpUrl).protocol !== 'https:' ||
            new URL(profile.backend.publicWebSocketUrl).protocol !== 'wss:' ||
            profile.backend.allowedOrigins.some(
                (origin) => new URL(origin).protocol !== 'https:',
            )
        ) {
            throw new Error(
                'Production backend requires TLS URLs and an HTTPS Origin allowlist.',
            );
        }
        if (
            !profile.frontend.enabled ||
            new URL(profile.frontend.publicUrl).protocol !== 'https:' ||
            new URL(profile.frontend.runtime.apiBaseUrl).protocol !== 'https:' ||
            new URL(profile.frontend.runtime.webSocketUrl).protocol !== 'wss:'
        ) {
            throw new Error('Production frontend requires TLS runtime URLs.');
        }
    }

    private assertProductionHostKeys(profile: DeploymentProfile): void {
        if (profile.environment !== 'prod') {
            return;
        }
        for (const component of [profile.backend, profile.frontend]) {
            if (
                component.enabled &&
                component.target.driver !== 'docker' &&
                component.target.sshHostKeyFingerprint ===
                    'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
            ) {
                throw new Error(
                    'Production LXC targets require a real SSH host-key fingerprint.',
                );
            }
        }
    }

    private assertDatabaseConfiguration(profile: DeploymentProfile): void {
        if (!profile.backend.enabled) {
            return;
        }
        const database = profile.backend.database;
        if (
            profile.environment === 'prod' &&
            database.type === 'sqlite' &&
            !path.isAbsolute(database.path)
        ) {
            throw new Error(
                'Production SQLite requires an absolute persistent path.',
            );
        }
        if (
            database.type === 'postgres' &&
            !profile.requiredSecrets.includes(database.connectionUrlSecret)
        ) {
            throw new Error(
                'PostgreSQL deployments must require DATABASE_URL.',
            );
        }
    }

    private assertStoredVersion(profile: StoredDeploymentProfile): void {
        if (!profile.backend.enabled) {
            return;
        }
        if (profile.schemaVersion === 1 && !('sqlitePath' in profile.backend)) {
            throw new Error('Deployment profile version 1 requires sqlitePath.');
        }
        if (profile.schemaVersion === 2 && !('database' in profile.backend)) {
            throw new Error('Deployment profile version 2 requires database.');
        }
    }

    private normalize(profile: StoredDeploymentProfile): DeploymentProfile {
        if (profile.schemaVersion === 2) {
            return profile;
        }
        if (!profile.backend.enabled) {
            return {
                ...profile,
                schemaVersion: 2,
                backend: { enabled: false },
            };
        }
        const {
            sqlitePath,
            databaseBackupRetention,
            ...backend
        } = profile.backend;
        return {
            ...profile,
            schemaVersion: 2,
            backend: {
                ...backend,
                database: {
                    type: 'sqlite',
                    path: sqlitePath,
                    backupRetention: databaseBackupRetention ?? 10,
                },
            },
        };
    }

    private environment(name: string): DeploymentProfile['environment'] {
        if (
            name === 'local' ||
            name === 'dev' ||
            name === 'staging' ||
            name === 'prod'
        ) {
            return name;
        }
        return 'dev';
    }

    /** Validates alignment between Backend Auth and public Frontend flags. */
    private assertAuthConfiguration(profile: DeploymentProfile): void {
        const authEnabled = profile.backend.enabled &&
            profile.backend.activeModules.includes('auth');
        if (
            authEnabled &&
            !profile.requiredSecrets.includes('BETTER_AUTH_SECRET')
        ) {
            throw new Error(
                'Auth deployments must require BETTER_AUTH_SECRET.',
            );
        }
        if (
            profile.frontend.enabled &&
            profile.frontend.runtime.authEnabled !== authEnabled
        ) {
            throw new Error(
                'Frontend authEnabled must match the backend Auth module.',
            );
        }
        if (
            profile.frontend.enabled &&
            profile.frontend.runtime.registrationEnabled &&
            (!profile.backend.enabled ||
                !profile.backend.authRegistrationEnabled)
        ) {
            throw new Error(
                'Frontend registration requires backend registration.',
            );
        }
    }

    /** Rejects insecure Proxmox TLS outside local development profiles. */
    private assertVerifiedProxmoxTls(profile: DeploymentProfile): void {
        for (const component of [profile.backend, profile.frontend]) {
            if (
                component.enabled &&
                component.target.driver === 'proxmox-lxc' &&
                component.target.allowInsecureTls
            ) {
                throw new Error(
                    `${profile.environment} profiles require verified Proxmox TLS.`,
                );
            }
        }
    }

    private assertName(name: string): void {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
            throw new Error(`Invalid deployment profile name '${name}'.`);
        }
    }
}
