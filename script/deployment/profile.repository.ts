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

    /** Creates a new profile using Docker unless drivers are explicit. */
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
        const profile: DeploymentProfile = {
            ...source,
            schemaVersion: 2,
            name,
            environment,
            requiredSecrets: this.requiredSecrets(
                source.requiredSecrets,
                database,
            ),
            backend: source.backend.enabled
                ? {
                      ...source.backend,
                      target: this.target(
                          name,
                          environment,
                          'backend',
                          backendDriver ?? 'docker',
                      ),
                      database,
                  }
                : source.backend,
            frontend: source.frontend.enabled
                ? {
                      ...source.frontend,
                      target: this.target(
                          name,
                          environment,
                          'frontend',
                          frontendDriver ?? 'docker',
                      ),
                  }
                : source.frontend,
        };
        if (!this.validateProfile(profile)) {
            throw new Error(
                `Generated deployment profile is invalid: ${this.validateProfile.errors?.map((error) => error.message).join(', ')}`,
            );
        }
        this.assertSecurity(profile as DeploymentProfile);
        fs.writeFileSync(target, `${JSON.stringify(profile, null, 4)}\n`);
        return target;
    }

    private target(
        profileName: string,
        environment: DeploymentProfile['environment'],
        component: 'backend' | 'frontend',
        driver: string,
    ): DeploymentTarget {
        if (!['docker', 'proxmox-lxc'].includes(driver)) {
            throw new Error(`Unknown deployment driver '${driver}'.`);
        }
        if (driver === 'docker') {
            return {
                driver: 'docker',
                image: `web-app-${component}:${profileName}`,
                hostPort: component === 'backend' ? 3000 : 8080,
            };
        }
        return {
            driver: 'proxmox-lxc',
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
            sshHost: `${component}.local`,
            sshUser: 'root',
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
    ): readonly string[] {
        const secrets = new Set(source);
        if (database.type === 'postgres') {
            secrets.add(database.connectionUrlSecret);
        } else {
            secrets.delete('DATABASE_URL');
        }
        return [...secrets].sort((left, right) => left.localeCompare(right));
    }

    private assertSecurity(profile: DeploymentProfile): void {
        const serialized = JSON.stringify(profile).toLowerCase();
        for (const forbidden of ['password', 'privatekey', 'tokensecret']) {
            if (serialized.includes(`"${forbidden}"`)) {
                throw new Error(`Profiles must not contain '${forbidden}'.`);
            }
        }
        this.assertDatabaseConfiguration(profile);
        this.assertAuthConfiguration(profile);
        if (
            profile.environment !== 'local' &&
            profile.environment !== 'dev'
        ) {
            this.assertVerifiedProxmoxTls(profile);
        }
    }

    private assertDatabaseConfiguration(profile: DeploymentProfile): void {
        if (!profile.backend.enabled) {
            return;
        }
        const database = profile.backend.database;
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
