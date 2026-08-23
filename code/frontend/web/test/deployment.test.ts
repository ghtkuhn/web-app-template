import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { DeploymentProfileRepository } from '../../../../script/deployment/profile.repository.ts';
import {
    ProxmoxLxcDeploymentDriver,
    type ProxmoxApi,
} from '../../../../script/deployment/proxmox.driver.ts';
import { DockerDeploymentDriver } from '../../../../script/deployment/docker.driver.ts';
import { ExistingLxcDeploymentDriver } from '../../../../script/deployment/existing-lxc.driver.ts';
import { DeploymentConfigRenderer } from '../../../../script/deployment/config.renderer.ts';
import { ReleaseBuilder } from '../../../../script/deployment/release.builder.ts';
import {
    LXC_INFRASTRUCTURE_SCHEMA_VERSION,
    LxcRuntimeContract,
} from '../../../../script/deployment/lxc-runtime.contract.ts';
import {
    LXC_CONTRACT_FILES,
    LxcContractCatalog,
} from '../../../../script/deployment/lxc-contract.catalog.ts';
import type {
    DockerTarget,
    ExistingLxcTarget,
    ProxmoxLxcTarget,
} from '../../../../script/deployment/interfaces.ts';
import {
    ProcessExecutionError,
    ProcessRunner,
} from '../../../../script/deployment/process.runner.ts';

const roots: string[] = [];
const HOST_KEY_FINGERPRINT =
    'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function existingTarget(
    sshAuthentication: ExistingLxcTarget['sshAuthentication'] = 'private-key',
): ExistingLxcTarget {
    return {
        driver: 'existing-lxc',
        installationId: 'sample-app',
        sshAuthentication,
        sshHost: 'existing.test',
        sshPort: 2222,
        sshUser: 'app',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
    };
}

function repository(): DeploymentProfileRepository {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-profile-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'deployment/profiles'), { recursive: true });
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    fs.copyFileSync(
        path.join(projectRoot, 'deployment/profile.schema.json'),
        path.join(root, 'deployment/profile.schema.json'),
    );
    fs.copyFileSync(
        path.join(projectRoot, 'deployment/profiles/local.json'),
        path.join(root, 'deployment/profiles/local.json'),
    );
    return new DeploymentProfileRepository(root);
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('local and scaffolded profiles default to independent Docker targets', () => {
    const profiles = repository();
    const local = profiles.load();
    expect(local.backend.enabled && local.backend.target.driver).toBe('docker');
    expect(local.frontend.enabled && local.frontend.target.driver).toBe('docker');
    expect(
        local.backend.enabled &&
        local.backend.database.type === 'sqlite' &&
        local.backend.database.backupRetention,
    )
        .toBe(10);
    profiles.scaffold('staging');
    const staging = profiles.load('staging');
    expect(staging.environment).toBe('staging');
    expect(staging.backend.enabled && staging.backend.target.driver).toBe('docker');
    expect(staging.frontend.enabled && staging.frontend.target.driver).toBe('docker');
});

test('aggregate validation excludes ignored local profile overrides', () => {
    const profiles = repository();
    const localOverride = profiles.scaffold('workstation');
    fs.renameSync(
        localOverride,
        localOverride.replace('.json', '.local.json'),
    );
    expect(profiles.loadAll().map((profile) => profile.name)).toEqual([
        'local',
    ]);
});

test('profile scaffold supports explicit Proxmox per component', () => {
    const profiles = repository();
    profiles.scaffold('dev', 'local', 'proxmox-lxc', 'docker');
    const profile = profiles.load('dev');
    expect(profile.backend.enabled && profile.backend.target.driver)
        .toBe('proxmox-lxc');
    expect(profile.frontend.enabled && profile.frontend.target.driver)
        .toBe('docker');
});

test('profile scaffold supports isolated Existing-LXC targets and SQLite', () => {
    const profiles = repository();
    profiles.scaffold('dev', 'local', 'existing-lxc', 'existing-lxc');
    const profile = profiles.load('dev');

    expect(profile.backend.enabled && profile.backend.target.driver)
        .toBe('existing-lxc');
    expect(profile.frontend.enabled && profile.frontend.target.driver)
        .toBe('existing-lxc');
    expect(profile.requiredSecrets).toContain('DEPLOYMENT_SSH_PRIVATE_KEY');
    expect(
        profile.backend.enabled && profile.backend.target.driver ===
            'existing-lxc' && profile.backend.target.sshUser,
    ).toBe('app');
    expect(
        profile.backend.enabled &&
        profile.backend.database.type === 'sqlite' &&
        profile.backend.database.path,
    ).toBe('/var/lib/dev/backend.sqlite');
});

test('Existing-LXC password authentication requires only its secret name', () => {
    const profiles = repository();
    const filePath = profiles.scaffold(
        'dev',
        'local',
        'existing-lxc',
        'docker',
    );
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.backend.target.sshAuthentication = 'password';
    fs.writeFileSync(filePath, JSON.stringify(profile));

    expect(() => profiles.load('dev')).toThrow(/DEPLOYMENT_SSH_PASSWORD/);
    profile.requiredSecrets = profile.requiredSecrets.filter(
        (name: string) => name !== 'DEPLOYMENT_SSH_PRIVATE_KEY',
    );
    profile.requiredSecrets.push('DEPLOYMENT_SSH_PASSWORD');
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(profiles.load('dev').requiredSecrets)
        .toContain('DEPLOYMENT_SSH_PASSWORD');
});

test('profile scaffold supports external PostgreSQL while SQLite stays default', () => {
    const profiles = repository();
    profiles.scaffold(
        'staging',
        'local',
        undefined,
        undefined,
        'postgres',
    );
    const postgres = profiles.load('staging');

    expect(postgres.schemaVersion).toBe(2);
    expect(
        postgres.backend.enabled && postgres.backend.database.type,
    ).toBe('postgres');
    expect(postgres.requiredSecrets).toContain('DATABASE_URL');
    expect(
        postgres.backend.enabled &&
        postgres.backend.database.type === 'postgres' &&
        postgres.backend.database.backupStrategy,
    ).toBe('external');
});

test('version-one SQLite profiles normalize to the version-two contract', () => {
    const profiles = repository();
    const filePath = profiles.scaffold('legacy');
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.schemaVersion = 1;
    profile.backend.sqlitePath = profile.backend.database.path;
    profile.backend.databaseBackupRetention =
        profile.backend.database.backupRetention;
    delete profile.backend.database;
    fs.writeFileSync(filePath, JSON.stringify(profile));

    const normalized = profiles.load('legacy');
    expect(normalized.schemaVersion).toBe(2);
    expect(
        normalized.backend.enabled && normalized.backend.database,
    ).toEqual({
        type: 'sqlite',
        path: '/var/lib/web-app/backend.sqlite',
        backupRetention: 10,
    });
});

test('staging and production profiles reject insecure Proxmox TLS', () => {
    const profiles = repository();
    const filePath = profiles.scaffold(
        'staging',
        'local',
        'proxmox-lxc',
        'docker',
    );
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.backend.target.allowInsecureTls = true;
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(() => profiles.load('staging')).toThrow(/verified Proxmox TLS/);
});

test('production LXC profiles require a non-placeholder host key', () => {
    const profiles = repository();
    const filePath = profiles.scaffold(
        'prod',
        'local',
        'existing-lxc',
        'docker',
    );

    expect(() => profiles.load('prod')).toThrow(/real SSH host-key/);
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.backend.target.sshHostKeyFingerprint =
        'SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(profiles.load('prod').environment).toBe('prod');
});

test('deployment profiles reject backup retention below one', () => {
    const profiles = repository();
    const filePath = profiles.scaffold('dev');
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.backend.database.backupRetention = 0;
    fs.writeFileSync(filePath, JSON.stringify(profile));

    expect(() => profiles.load('dev')).toThrow(/must be >= 1/);
});

test('Auth deployment requires aligned runtime flags and its secret contract', () => {
    const profiles = repository();
    const filePath = profiles.scaffold('dev');
    const profile = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    profile.backend.activeModules.push('auth');
    profile.frontend.runtime.authEnabled = true;
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(() => profiles.load('dev')).toThrow(/BETTER_AUTH_SECRET/);

    profile.requiredSecrets.push('BETTER_AUTH_SECRET');
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(profiles.load('dev').frontend.enabled).toBe(true);

    profile.frontend.runtime.registrationEnabled = true;
    fs.writeFileSync(filePath, JSON.stringify(profile));
    expect(() => profiles.load('dev')).toThrow(/backend registration/);
});

test('Proxmox provision creates and starts a missing LXC through REST', async () => {
    const calls: string[] = [];
    const api: ProxmoxApi = {
        async get<T>(requestPath: string): Promise<T> {
            calls.push(`GET ${requestPath}`);
            return (
                requestPath === '/nodes'
                    ? [{ node: 'pve' }]
                    : requestPath.endsWith('/storage')
                      ? [{ storage: 'local-lvm' }]
                      : requestPath.endsWith('/content')
                        ? [{ volid: 'local:vztmpl/debian.tar.zst' }]
                        : requestPath.endsWith('/network')
                          ? [{ iface: 'vmbr0' }]
                          : requestPath.endsWith('/lxc')
                    ? []
                    : requestPath.includes('/tasks/')
                      ? { status: 'stopped', exitstatus: 'OK' }
                      : { status: 'stopped' }
            ) as T;
        },
        async post<T>(requestPath: string): Promise<T> {
            calls.push(`POST ${requestPath}`);
            return 'UPID:test' as T;
        },
        async put<T>(requestPath: string): Promise<T> {
            calls.push(`PUT ${requestPath}`);
            return null as T;
        },
    };
    const target: ProxmoxLxcTarget = {
        driver: 'proxmox-lxc',
        installationId: 'web-app',
        apiUrl: 'https://pve.test:8006',
        node: 'pve',
        vmid: 200,
        hostname: 'backend',
        storage: 'local-lvm',
        template: 'local:vztmpl/debian.tar.zst',
        bridge: 'vmbr0',
        address: 'dhcp',
        gateway: '192.168.1.1',
        nameserver: '1.1.1.1',
        firewall: true,
        startOnBoot: true,
        stopContainer: true,
        sshHost: 'backend.test',
        sshPort: 22,
        sshUser: 'root',
        sshAuthentication: 'private-key',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
        sshPublicKey: 'ssh-ed25519 test',
        cores: 2,
        memoryMb: 1024,
        swapMb: 512,
        diskGb: 8,
    };
    await new ProxmoxLxcDeploymentDriver(
        target,
        undefined,
        {},
        process.cwd(),
        api,
    ).provision();
    expect(calls).toContain('POST /nodes/pve/lxc');
    expect(calls).toContain('POST /nodes/pve/lxc/200/status/start');
});

test('Proxmox task failures stop provisioning with a controlled error', async () => {
    const api: ProxmoxApi = {
        async get<T>(requestPath: string): Promise<T> {
            return (
                requestPath === '/nodes'
                    ? [{ node: 'pve' }]
                    : requestPath.endsWith('/storage')
                      ? [{ storage: 'local-lvm' }]
                      : requestPath.endsWith('/content')
                        ? [{ volid: 'local:vztmpl/debian.tar.zst' }]
                        : requestPath.endsWith('/network')
                          ? [{ iface: 'vmbr0' }]
                          : requestPath.endsWith('/lxc')
                    ? []
                    : { status: 'stopped', exitstatus: 'permission denied' }
            ) as T;
        },
        async post<T>(): Promise<T> {
            return 'UPID:failed' as T;
        },
        async put<T>(): Promise<T> {
            return null as T;
        },
    };
    const target: ProxmoxLxcTarget = {
        driver: 'proxmox-lxc',
        installationId: 'web-app',
        apiUrl: 'https://pve.test:8006',
        node: 'pve',
        vmid: 200,
        hostname: 'backend',
        storage: 'local-lvm',
        template: 'local:vztmpl/debian.tar.zst',
        bridge: 'vmbr0',
        address: 'dhcp',
        gateway: '192.168.1.1',
        nameserver: '1.1.1.1',
        firewall: true,
        startOnBoot: true,
        stopContainer: true,
        sshHost: 'backend.test',
        sshPort: 22,
        sshUser: 'root',
        sshAuthentication: 'private-key',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
        sshPublicKey: 'ssh-ed25519 test',
        cores: 2,
        memoryMb: 1024,
        swapMb: 512,
        diskGb: 8,
    };
    await expect(
        new ProxmoxLxcDeploymentDriver(
            target,
            undefined,
            {},
            process.cwd(),
            api,
        ).provision(),
    ).rejects.toThrow(/permission denied/);
});

test('Docker driver builds only the selected component image', () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return '';
        },
    } as ProcessRunner;
    const target: DockerTarget = {
        driver: 'docker',
        image: 'web-app-backend:test',
        hostPort: 3000,
    };
    new DockerDeploymentDriver('/project', runner).build('backend', target);
    expect(calls).toEqual([{
        command: 'docker',
        arguments_: [
            'build',
            '--file',
            'deployment/docker/backend.Dockerfile',
            '--tag',
            'web-app-backend:test',
            '.',
        ],
    }]);
});

test('real backend release matches the service contract and strict allowlist', () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const release = new ReleaseBuilder(projectRoot).build('backend');
    roots.push(path.dirname(release.archive));
    const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'release-extracted-'));
    roots.push(extracted);
    new ProcessRunner().run('tar', [
        '-xzf',
        release.archive,
        '-C',
        extracted,
    ]);
    const expected = new LxcRuntimeContract().release(
        'backend',
        '24.19.0',
        '>=11 <12',
    );
    const manifest = JSON.parse(fs.readFileSync(
        path.join(extracted, LxcRuntimeContract.manifest),
        'utf8',
    ));

    expect(manifest).toEqual(expected);
    new LxcRuntimeContract().validate(extracted, expected);
    expect(fs.readFileSync(
        path.join(extracted, LxcRuntimeContract.backendLauncher),
        'utf8',
    )).toContain('./code/backend/src/index.ts');
    for (const relativePath of [
        'package.json',
        'package-lock.json',
        'run-database-maintenance.mjs',
        'code/backend/package.json',
        'code/backend/src/index.ts',
        'code/backend/script/database-maintenance.ts',
    ]) {
        expect(fs.statSync(path.join(extracted, relativePath)).isFile()).toBe(true);
    }
    const archivedPaths = new ProcessRunner().run(
        'tar',
        ['-tzf', release.archive],
    );
    for (const forbidden of [
        '.credentials.env',
        '.DS_Store',
        'node_modules',
        'data/',
        'code/frontend/',
    ]) {
        expect(archivedPaths).not.toContain(forbidden);
    }
    expect(fs.readFileSync(
        path.join(projectRoot, 'deployment/lxc/bootstrap-existing-lxc.sh'),
        'utf8',
    )).toContain(
        'ExecStart=/usr/local/bin/node --experimental-transform-types ${backend_launcher}',
    );
});

test('backend deployment configuration carries backup policy and release', () => {
    const profile = repository().load();
    const rendered = new DeploymentConfigRenderer().render(
        profile,
        'backend',
        { APP_SECRET: 'test-secret' },
        'release-123',
    );
    const content = fs.readFileSync(rendered, 'utf8');

    expect(content).toContain('DB_BACKUP_RETENTION=10');
    expect(content).toContain('DEPLOYMENT_RELEASE_ID=release-123');
    fs.rmSync(path.dirname(rendered), { recursive: true, force: true });
});

test('frontend runtime configuration uses the validated JSON assignment contract', () => {
    const profile = repository().load();
    const rendered = new DeploymentConfigRenderer().render(
        profile,
        'frontend',
    );
    const content = fs.readFileSync(rendered, 'utf8').trim();
    const prefix = 'window.__APP_CONFIG__ = ';

    expect(content.startsWith(prefix)).toBe(true);
    expect(content.endsWith(';')).toBe(true);
    expect(JSON.parse(content.slice(prefix.length, -1))).toMatchObject({
        authEnabled: false,
        registrationEnabled: false,
    });
    fs.rmSync(path.dirname(rendered), { recursive: true, force: true });
});

test('PostgreSQL deployment configuration uses only the required external URL', () => {
    const profiles = repository();
    profiles.scaffold(
        'prod',
        'local',
        undefined,
        undefined,
        'postgres',
    );
    const profile = profiles.load('prod');
    const rendered = new DeploymentConfigRenderer().render(
        profile,
        'backend',
        {
            APP_SECRET: 'test-secret',
            DATABASE_URL:
                'postgresql://user:secret@database/app?sslmode=verify-full',
        },
        'release-123',
    );
    const content = fs.readFileSync(rendered, 'utf8');

    expect(content).toContain('DB_TYPE=postgres');
    expect(content).toContain('DATABASE_URL=postgresql://');
    expect(content).not.toContain('DB_SQLITE_PATH=');
    expect(() => new DeploymentConfigRenderer().render(
        profile,
        'backend',
        { APP_SECRET: 'test-secret' },
    )).toThrow(/DATABASE_URL/);
    expect(() => new DeploymentConfigRenderer().render(
        profile,
        'backend',
        {
            APP_SECRET: 'test-secret',
            DATABASE_URL:
                'postgresql://user:secret@database/app?sslmode=require',
        },
    )).toThrow(/sslmode=verify-full/);
    fs.rmSync(path.dirname(rendered), { recursive: true, force: true });
});

test('Docker database restore stops, restores, and restarts backend', () => {
    const calls: Array<{ arguments_: readonly string[] }> = [];
    const runner = {
        run(_command: string, arguments_: readonly string[]): string {
            calls.push({ arguments_ });
            return 'restored';
        },
    } as ProcessRunner;
    const profile = repository().load();
    const output = new DockerDeploymentDriver(
        '/project',
        runner,
    ).databaseRestore(profile, 'backup-001.sqlite');

    expect(output).toBe('restored');
    expect(calls.map((call) => call.arguments_.slice(5, 7))).toEqual([
        ['stop', 'backend'],
        ['run', '--rm'],
        ['up', '--detach'],
        ['run', '--rm'],
    ]);
    expect(calls[1].arguments_).toContain('backup-001.sqlite');
    expect(calls[3].arguments_).toContain('retain');
});

test('Docker database commands reject externally managed PostgreSQL', () => {
    const profiles = repository();
    profiles.scaffold(
        'dev',
        'local',
        undefined,
        undefined,
        'postgres',
    );
    const driver = new DockerDeploymentDriver('/project');

    expect(() => driver.databaseList(profiles.load('dev'))).toThrow(
        /externally managed/,
    );
});

test('LXC release activation uses direct SSH and contains health rollback', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return '';
        },
    } as ProcessRunner;
    const api = {
        async get<T>(): Promise<T> {
            return null as T;
        },
        async post<T>(): Promise<T> {
            return null as T;
        },
        async put<T>(): Promise<T> {
            return null as T;
        },
    };
    const target: ProxmoxLxcTarget = {
        driver: 'proxmox-lxc',
        installationId: 'web-app',
        apiUrl: 'https://pve.test:8006',
        node: 'pve',
        vmid: 200,
        hostname: 'backend',
        storage: 'local-lvm',
        template: 'local:vztmpl/debian.tar.zst',
        bridge: 'vmbr0',
        address: 'dhcp',
        gateway: '192.168.1.1',
        nameserver: '1.1.1.1',
        firewall: true,
        startOnBoot: true,
        stopContainer: true,
        sshHost: 'backend.test',
        sshPort: 22,
        sshUser: 'root',
        sshAuthentication: 'private-key',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
        sshPublicKey: 'ssh-ed25519 test',
        cores: 2,
        memoryMb: 1024,
        swapMb: 512,
        diskGb: 8,
    };
    await new ProxmoxLxcDeploymentDriver(
        target,
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..'),
        api,
    ).deploy(
        'backend',
        '/tmp/backend-release.tgz',
        'release-1',
        '/tmp/backend.env',
    );
    expect(calls.map((call) => call.command)).toEqual([
        'ssh',
        'scp',
        'ssh',
    ]);
    expect(calls[1].arguments_).toContain('root@backend.test:/tmp/');
    expect(calls[2].arguments_.at(-1)).toContain('sha256sum -c');
    expect(calls[2].arguments_.at(-1)).toContain(
        'mkdir -p /opt/web-app/backend',
    );
    expect(calls[2].arguments_.at(-1)).toContain('previous');
    expect(calls[2].arguments_.at(-1)).toContain(
        'systemctl stop web-app-backend',
    );
    expect(calls[2].arguments_.at(-1)).toContain('ln -sfnT');
    expect(calls[2].arguments_.at(-1)).toContain(
        'while [ "$attempt" -lt 30 ]',
    );
    expect(calls[2].arguments_.at(-1)).toContain('/api/health');
});

test('LXC database restore keeps stop, restore, restart, and health ordered', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return 'restored';
        },
    } as ProcessRunner;
    const target: ProxmoxLxcTarget = {
        driver: 'proxmox-lxc',
        installationId: 'web-app',
        apiUrl: 'https://pve.test:8006',
        node: 'pve',
        vmid: 200,
        hostname: 'backend',
        storage: 'local-lvm',
        template: 'local:vztmpl/debian.tar.zst',
        bridge: 'vmbr0',
        address: 'dhcp',
        gateway: '192.168.1.1',
        nameserver: '1.1.1.1',
        firewall: true,
        startOnBoot: true,
        stopContainer: true,
        sshHost: 'backend.test',
        sshPort: 22,
        sshUser: 'root',
        sshAuthentication: 'private-key',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
        sshPublicKey: 'ssh-ed25519 test',
        cores: 2,
        memoryMb: 1024,
        swapMb: 512,
        diskGb: 8,
    };
    const api = {
        async get<T>(): Promise<T> {
            return null as T;
        },
        async post<T>(): Promise<T> {
            return null as T;
        },
        async put<T>(): Promise<T> {
            return null as T;
        },
    };
    const driver = new ProxmoxLxcDeploymentDriver(
        target,
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../..'),
        api,
    );

    await driver.databaseRestore('backup-001.sqlite');

    const command = calls.at(-1)?.arguments_.at(-1) ?? '';
    expect(command).toContain('systemctl stop web-app-backend');
    expect(command).toContain('run-database-maintenance.mjs restore');
    expect(command).toContain('install.sh');
    expect(command).toContain('while [ "$attempt" -lt 30 ]');
    expect(command).toContain('systemctl stop web-app-backend || true; exit 1');
    expect(command).toContain('/api/health');
    await expect(driver.databaseRestore('../escape.sqlite')).rejects.toThrow(
        /Invalid database backup identifier/,
    );
});

test('Existing-LXC pins host keys and supports release lifecycle operations', async () => {
    const calls: Array<{
        command: string;
        arguments_: readonly string[];
        environment?: NodeJS.ProcessEnv;
    }> = [];
    const runner = {
        run(
            command: string,
            arguments_: readonly string[],
            options?: { env?: NodeJS.ProcessEnv },
        ): string {
            calls.push({
                command,
                arguments_,
                environment: options?.env,
            });
            const remoteCommand = arguments_.at(-1) ?? '';
            if (remoteCommand.includes('infrastructure.json')) {
                return JSON.stringify({
                    schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
                    nodeVersion: '24.19.0',
                    npmRange: '>=11 <12',
                    backendLauncher: LxcRuntimeContract.backendLauncher,
                    maintenanceLauncher:
                        LxcRuntimeContract.backendMaintenanceLauncher,
                });
            }
            if (remoteCommand === '/usr/local/bin/node --version') {
                return 'v24.19.0';
            }
            if (remoteCommand === '/usr/local/bin/npm --version') {
                return '11.17.0';
            }
            return command === 'ssh' ? 'active' : '';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const driver = new ExistingLxcDeploymentDriver(
        existingTarget(),
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        projectRoot,
    );

    await driver.deploy(
        'backend',
        '/tmp/backend-release.tgz',
        'release-1',
        '/tmp/backend.env',
    );
    expect(await driver.status('backend')).toBe('active');
    await driver.stop('backend');
    await driver.rollback('backend', 'release-1');

    expect(calls.some((call) => call.command === 'ssh-keyscan')).toBe(false);
    const argumentsText = calls.flatMap((call) => call.arguments_).join(' ');
    expect(argumentsText).toContain('StrictHostKeyChecking=yes');
    expect(argumentsText).toContain('KnownHostsCommand=');
    expect(argumentsText).toContain('/opt/sample-app/backend');
    expect(argumentsText).toContain('releases/release-1');
    const activation = calls.find((call) =>
        call.arguments_.at(-1)?.includes('sha256sum -c'),
    )?.arguments_.at(-1) ?? '';
    expect(() => new ProcessRunner().run(
        'sh',
        ['-n', '-c', activation],
    )).not.toThrow();
    expect(activation.indexOf('lxc-release-validator.mjs')).toBeLessThan(
        activation.indexOf('service-control stop backend'),
    );
    expect(activation.indexOf('npm ci')).toBeLessThan(
        activation.indexOf('service-control stop backend'),
    );
    expect(activation).toContain(
        'run-database-maintenance.mjs',
    );
    const rollback = calls.at(-1)?.arguments_.at(-1) ?? '';
    expect(() => new ProcessRunner().run(
        'sh',
        ['-n', '-c', rollback],
    )).not.toThrow();
    expect(rollback.indexOf('lxc-release-validator.mjs')).toBeLessThan(
        rollback.indexOf('ln -sfnT'),
    );
});

test('Existing-LXC runtime mismatch fails before upload or downtime', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            const remoteCommand = arguments_.at(-1) ?? '';
            if (remoteCommand.includes('infrastructure.json')) {
                return JSON.stringify({
                    schemaVersion: 2,
                    nodeVersion: '24.19.0',
                    npmRange: '>=11 <12',
                    backendLauncher: LxcRuntimeContract.backendLauncher,
                    maintenanceLauncher:
                        LxcRuntimeContract.backendMaintenanceLauncher,
                });
            }
            if (remoteCommand === '/usr/local/bin/node --version') {
                return 'v22.23.1';
            }
            if (remoteCommand === '/usr/local/bin/npm --version') {
                return '11.17.0';
            }
            return '';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );

    await expect(new ExistingLxcDeploymentDriver(
        existingTarget(),
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        projectRoot,
    ).deploy(
        'backend',
        '/tmp/backend-release.tgz',
        'release-1',
        '/tmp/backend.env',
    )).rejects.toThrow(
        /required Node\.js 24\.19\.0.*observed Node\.js 22\.23\.1/u,
    );
    expect(calls.some((call) => call.command === 'scp')).toBe(false);
    expect(calls.flatMap((call) => call.arguments_).join(' '))
        .not.toContain('systemctl stop');
});

test('remote service failures remain distinct from SSH transport failures', async () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const statusRunner = {
        run(command: string): string {
            throw new ProcessExecutionError(command, 3, null);
        },
    } as ProcessRunner;
    await expect(new ExistingLxcDeploymentDriver(
        existingTarget('password'),
        statusRunner,
        { DEPLOYMENT_SSH_PASSWORD: 'secret' },
        projectRoot,
    ).status('backend')).rejects.toThrow(/Remote SSH command.*exit code 3/u);

    const transportRunner = {
        run(command: string): string {
            throw new ProcessExecutionError(command, 255, null);
        },
    } as ProcessRunner;
    await expect(new ExistingLxcDeploymentDriver(
        existingTarget('password'),
        transportRunner,
        { DEPLOYMENT_SSH_PASSWORD: 'secret' },
        projectRoot,
    ).status('backend')).rejects.toThrow(/transport or authentication/u);
});

test('process failures preserve exit codes without echoing arguments', () => {
    let observed: unknown;
    try {
        new ProcessRunner().run(process.execPath, [
            '--eval',
            "process.stderr.write('sensitive-output'); process.exit(7);",
        ]);
    } catch (error) {
        observed = error;
    }

    expect(observed).toBeInstanceOf(ProcessExecutionError);
    expect(observed).toMatchObject({
        command: process.execPath,
        exitCode: 7,
        signal: null,
    });
    expect(String(observed)).not.toContain('sensitive-output');
    expect(String(observed)).not.toContain('process.exit');
});

test('release validation rejects symlinks that escape the candidate', () => {
    const candidate = fs.mkdtempSync(path.join(os.tmpdir(), 'release-candidate-'));
    roots.push(candidate);
    const outside = path.join(path.dirname(candidate), 'outside-entrypoint.ts');
    fs.writeFileSync(outside, 'export {};');
    roots.push(outside);
    const contract = new LxcRuntimeContract();
    const expected = contract.release('backend', '24.19.0', '>=11 <12');
    for (const relativePath of expected.requiredFiles) {
        const target = path.join(candidate, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, relativePath);
    }
    fs.writeFileSync(
        path.join(candidate, LxcRuntimeContract.manifest),
        contract.render(expected),
    );
    fs.rmSync(path.join(candidate, LxcRuntimeContract.backendLauncher));
    fs.symlinkSync(outside, path.join(
        candidate,
        LxcRuntimeContract.backendLauncher,
    ));

    expect(() => contract.validate(candidate, expected)).toThrow(
        /forbidden symlink/u,
    );
});

test('release validation rejects missing entrypoints and altered contracts', () => {
    const candidate = fs.mkdtempSync(path.join(os.tmpdir(), 'release-missing-'));
    roots.push(candidate);
    const contract = new LxcRuntimeContract();
    const expected = contract.release('backend', '24.19.0', '>=11 <12');
    for (const relativePath of expected.requiredFiles) {
        const target = path.join(candidate, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, relativePath);
    }
    fs.writeFileSync(
        path.join(candidate, LxcRuntimeContract.manifest),
        contract.render(expected),
    );
    fs.rmSync(path.join(candidate, 'code/backend/src/index.ts'));
    expect(() => contract.validate(candidate, expected)).toThrow(
        /index\.ts.*missing/u,
    );

    fs.writeFileSync(
        path.join(candidate, 'code/backend/src/index.ts'),
        'restored',
    );
    fs.writeFileSync(
        path.join(candidate, LxcRuntimeContract.manifest),
        contract.render({ ...expected, layout: 'legacy-flat-v0' }),
    );
    expect(() => contract.validate(candidate, expected)).toThrow(
        /does not match/u,
    );
});

test('LXC contract catalog rejects a mixed cross-file implementation', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-contract-'));
    roots.push(fixture);
    for (const relativePath of LXC_CONTRACT_FILES) {
        const target = path.join(fixture, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `incoming:${relativePath}\n`);
    }
    const catalog = new LxcContractCatalog();
    catalog.generate(fixture);
    expect(() => catalog.check(fixture)).not.toThrow();

    fs.appendFileSync(
        path.join(fixture, 'script/deployment/release.builder.ts'),
        'local legacy layout\n',
    );
    expect(() => catalog.check(fixture)).toThrow(
        /cross-file contract|contract drift/u,
    );
});

test('Existing-LXC password stays out of arguments and missing secrets fail', async () => {
    const calls: string[][] = [];
    const runner = {
        run(_command: string, arguments_: readonly string[]): string {
            calls.push([...arguments_]);
            return 'active';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    await expect(new ExistingLxcDeploymentDriver(
        existingTarget('password'),
        runner,
        {},
        projectRoot,
    ).status('backend')).rejects.toThrow(/DEPLOYMENT_SSH_PASSWORD/);

    const password = 'must-not-appear-in-arguments';
    expect(await new ExistingLxcDeploymentDriver(
        existingTarget('password'),
        runner,
        { DEPLOYMENT_SSH_PASSWORD: password },
        projectRoot,
    ).status('backend')).toBe('active');
    expect(JSON.stringify(calls)).not.toContain(password);
});

test('Existing-LXC bootstrap is explicit and passes validated parameters', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return '';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );

    await new ExistingLxcDeploymentDriver(
        existingTarget(),
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        projectRoot,
    ).bootstrap('24.19.0');

    expect(calls.some((call) =>
        call.arguments_.at(-1)?.includes(
            'bootstrap-existing-lxc.sh bootstrap sample-app 24.19.0',
        ),
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.some((argument) =>
            argument.includes('root@existing.test'),
        ),
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.at(-1)?.includes('deployment:deploy'),
    )).toBe(false);
    const bootstrapScript = fs.readFileSync(
        path.join(projectRoot, 'deployment/lxc/bootstrap-existing-lxc.sh'),
        'utf8',
    );
    expect(bootstrapScript).toContain('trap cleanup EXIT HUP INT TERM');
    expect(bootstrapScript).toContain('restore_path "$unit_file" backend-unit');
    expect(bootstrapScript).toContain(
        'Unversioned Existing-LXC infrastructure exists',
    );
});

test('Existing-LXC infrastructure upgrade is explicit and versioned', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return '';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );

    await new ExistingLxcDeploymentDriver(
        existingTarget(),
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        projectRoot,
    ).infrastructureUpgrade('24.19.0');

    const text = calls.flatMap((call) => call.arguments_).join(' ');
    expect(text).toContain(
        'bootstrap-existing-lxc.sh upgrade sample-app 24.19.0',
    );
    expect(text).toContain(String(LXC_INFRASTRUCTURE_SCHEMA_VERSION));
    expect(text).toContain('legacy-workspace-contract.json');
    expect(text).not.toContain('deployment:deploy');
});

test('Existing-LXC infrastructure status is read-only and structured', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return arguments_.at(-1)?.includes('infrastructure.json')
                ? JSON.stringify({
                      schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
                      nodeVersion: '24.19.0',
                      npmRange: '>=11 <12',
                  })
                : '';
        },
    } as ProcessRunner;
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );

    const output = await new ExistingLxcDeploymentDriver(
        existingTarget(),
        runner,
        { DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy' },
        projectRoot,
    ).infrastructureStatus();

    expect(JSON.parse(output)).toMatchObject({
        schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
        nodeVersion: '24.19.0',
    });
    expect(calls.some((call) => call.command === 'scp')).toBe(false);
    expect(calls.flatMap((call) => call.arguments_).join(' '))
        .not.toContain('systemctl');
});
