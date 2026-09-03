import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
    DeploymentCli,
} from '../../../../script/deployment/deployment.cli.ts';
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
    LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION,
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
import {
    renderLxcHealthCheck,
} from '../../../../script/deployment/ssh.release-driver.ts';
import {
    DeploymentProjectConfigRepository,
} from '../../../../script/deployment/project-config.repository.ts';

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
        sshUser: 'legacy-profile-user',
        sshHostKeyFingerprint: HOST_KEY_FINGERPRINT,
    };
}

function deploymentProjectRoot(platform: unknown = 'docker'): string {
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
    fs.writeFileSync(
        path.join(root, 'project.json'),
        JSON.stringify({
            deployment: { platform, sshUser: 'app' },
        }),
    );
    return root;
}

function repository(platform: unknown = 'docker'): DeploymentProfileRepository {
    return new DeploymentProfileRepository(deploymentProjectRoot(platform));
}

afterEach(() => {
    vi.restoreAllMocks();
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

test('profile scaffold uses the project platform without changing existing profiles', () => {
    const profiles = repository('existing-lxc');
    const local = profiles.load();
    expect(local.backend.enabled && local.backend.target.driver).toBe('docker');
    expect(local.frontend.enabled && local.frontend.target.driver).toBe('docker');

    profiles.scaffold('dev');
    const scaffolded = profiles.load('dev');
    expect(scaffolded.backend.enabled && scaffolded.backend.target.driver)
        .toBe('existing-lxc');
    expect(scaffolded.frontend.enabled && scaffolded.frontend.target.driver)
        .toBe('existing-lxc');
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

test('explicit scaffold drivers override the project platform per component', () => {
    const profiles = repository('existing-lxc');
    profiles.scaffold('dev', 'local', 'proxmox-lxc');
    const profile = profiles.load('dev');
    expect(profile.backend.enabled && profile.backend.target.driver)
        .toBe('proxmox-lxc');
    expect(profile.frontend.enabled && profile.frontend.target.driver)
        .toBe('existing-lxc');
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
    expect(profile.requiredSecrets).not.toContain('DEPLOYMENT_SUDO_PASSWORD');
    expect(
        profile.backend.enabled && profile.backend.target.driver ===
            'existing-lxc' && 'sshUser' in profile.backend.target,
    ).toBe(false);
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
    )).toBe([
        "import { BackendApplication } from './code/backend/src/index.ts';",
        'await new BackendApplication().start();',
        '',
    ].join('\n'));
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
        '! ( healthy=0; attempt=1; while [ "$attempt" -le 30 ]',
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
    expect(command).toContain('( healthy=0; attempt=1;');
    expect(command).toContain('while [ "$attempt" -le 30 ]');
    expect(command).toContain('systemctl stop web-app-backend || true; exit 1');
    expect(command).toContain('/api/health');
    await expect(driver.databaseRestore('../escape.sqlite')).rejects.toThrow(
        /Invalid database backup identifier/,
    );
});

test('LXC health checks preserve success and failure through shell negation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lxc-health-check-'));
    roots.push(root);
    const bin = path.join(root, 'bin');
    const attempts = path.join(root, 'attempts');
    fs.mkdirSync(bin);
    const curl = path.join(bin, 'curl');
    fs.writeFileSync(curl, [
        '#!/bin/sh',
        'attempt=$(cat "$HEALTH_ATTEMPTS" 2>/dev/null || printf 0)',
        'attempt=$((attempt + 1))',
        'printf "%s" "$attempt" > "$HEALTH_ATTEMPTS"',
        'test "$attempt" -ge "$HEALTH_SUCCESS_AT"',
        '',
    ].join('\n'));
    fs.chmodSync(curl, 0o755);
    const sleep = path.join(bin, 'sleep');
    fs.writeFileSync(sleep, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(sleep, 0o755);
    const environment = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        HEALTH_ATTEMPTS: attempts,
        HEALTH_SUCCESS_AT: '2',
    };
    const healthCheck = renderLxcHealthCheck('backend', 3);
    const success = new ProcessRunner().run('sh', [
        '-c',
        `if ! true || ! ${healthCheck}; then printf rollback; else printf keep; fi`,
    ], { env: environment });

    expect(success).toBe('keep');
    expect(fs.readFileSync(attempts, 'utf8')).toBe('2');

    fs.rmSync(attempts);
    environment.HEALTH_SUCCESS_AT = '4';
    const failure = new ProcessRunner().run('sh', [
        '-c',
        `if ! true || ! ${healthCheck}; then printf rollback; else printf keep; fi`,
    ], { env: environment });

    expect(failure).toBe('rollback');
    expect(fs.readFileSync(attempts, 'utf8')).toBe('3');
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
                    deploymentUser: 'app',
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
    expect(argumentsText).toContain('app@existing.test');
    expect(argumentsText).not.toContain('legacy-profile-user@existing.test');
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
    expect(activation.indexOf('npm ls --omit=dev --all')).toBeLessThan(
        activation.indexOf('service-control stop backend'),
    );
    expect(activation).toContain("stage='dependency-installation'");
    expect(activation).toContain(
        'Deployment stage %s failed with exit code %s.',
    );
    let stagedFailure: unknown;
    const artifactStage = "stage='artifact-checksum'";
    try {
        new ProcessRunner().run('sh', [
            '-c',
            `${activation.slice(0, activation.indexOf(artifactStage))}${
                artifactStage
            } && false`,
        ], { failureOutput: { redact: [] } });
    } catch (error) {
        stagedFailure = error;
    }
    expect(String(stagedFailure)).toContain(
        'Deployment stage artifact-checksum failed with exit code 1.',
    );
    expect(String(stagedFailure)).toContain(
        'Release state: active release was not switched.',
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
    expect(rollback.indexOf('npm ls --omit=dev --all')).toBeLessThan(
        rollback.indexOf('ln -sfnT'),
    );
    expect(rollback).toContain("stage='activation-healthcheck'");
});

test('Existing-LXC diagnosis is read-only and reports runtime state', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            const remoteCommand = arguments_.at(-1) ?? '';
            if (remoteCommand.includes('infrastructure.json')) {
                return JSON.stringify({
                    schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
                    deploymentUser: 'app',
                    nodeVersion: '24.19.0',
                    npmRange: '>=11 <12',
                    backendLauncher: LxcRuntimeContract.backendLauncher,
                    maintenanceLauncher:
                        LxcRuntimeContract.backendMaintenanceLauncher,
                });
            }
            if (remoteCommand.includes('/usr/local/bin/node --version')) {
                return 'v24.19.0';
            }
            if (remoteCommand.includes('/usr/local/bin/npm --version')) {
                return '11.17.0';
            }
            if (remoteCommand.includes("printf 'release=%s")) {
                return 'release=release-42\nservice=active';
            }
            return '';
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
    ).diagnose('backend');
    const diagnostic = JSON.parse(output);

    expect(diagnostic).toMatchObject({
        schemaVersion: 1,
        driver: 'existing-lxc',
        ssh: 'ok',
        target: {
            component: 'backend',
            sshUser: 'app',
        },
        infrastructure: { matches: true },
        runtime: { matches: true },
        release: 'release-42',
        service: 'active',
    });
    expect(calls.every((call) => call.command === 'ssh')).toBe(true);
    const argumentsText = calls.flatMap((call) => call.arguments_).join(' ');
    expect(argumentsText).not.toContain('scp');
    expect(argumentsText).not.toContain('sudo');
    expect(argumentsText).not.toContain('rm ');
    const manifest = JSON.parse(fs.readFileSync(
        path.join(projectRoot, 'package.json'),
        'utf8',
    ));
    expect(manifest.scripts['deployment:diagnose'])
        .toBe('node script/deployment/deployment.cli.ts diagnose');
});

test('Existing-LXC runtime mismatch fails before upload or downtime', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            const remoteCommand = arguments_.at(-1) ?? '';
            if (remoteCommand.includes('infrastructure.json')) {
                return JSON.stringify({
                    schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
                    deploymentUser: 'app',
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

test('remote activation failures retain phase and package diagnostics', async () => {
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            const remoteCommand = arguments_.at(-1) ?? '';
            if (remoteCommand.includes('infrastructure.json')) {
                return JSON.stringify({
                    schemaVersion: LXC_INFRASTRUCTURE_SCHEMA_VERSION,
                    deploymentUser: 'app',
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
            if (remoteCommand.includes('sha256sum -c')) {
                throw new ProcessExecutionError(command, 1, null, [
                    'stderr:',
                    'npm error Missing: kysely from @app/backend@1.0.0',
                    'Deployment stage dependency-installation failed with exit code 1.',
                ].join('\n'));
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
        /activate backend release 'release-1'.*kysely.*dependency-installation/su,
    );
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

test('process input reaches stdin without entering output or errors', () => {
    const secret = 'stdin-only-secret';
    const output = new ProcessRunner().run(process.execPath, [
        '--eval',
        "const fs = require('node:fs'); process.stdout.write(fs.readFileSync(0, 'utf8') ? 'received' : 'missing');",
    ], { input: `${secret}\n` });

    expect(output).toBe('received');
    expect(output).not.toContain(secret);

    let observed: unknown;
    try {
        new ProcessRunner().run(process.execPath, [
            '--eval',
            "require('node:fs').readFileSync(0, 'utf8'); process.exit(7);",
        ], { input: `${secret}\n` });
    } catch (error) {
        observed = error;
    }
    expect(observed).toBeInstanceOf(ProcessExecutionError);
    expect(String(observed)).not.toContain(secret);
});

test('requested process diagnostics are bounded and redact explicit values', () => {
    const secret = 'never-print-this';
    let observed: unknown;
    try {
        new ProcessRunner().run(process.execPath, [
            '--eval',
            `process.stdout.write('${secret}'); process.stderr.write('Missing dependency: kysely'); process.exit(7);`,
        ], {
            failureOutput: {
                redact: [secret],
                maxCharacters: 1_000,
            },
        });
    } catch (error) {
        observed = error;
    }

    expect(observed).toBeInstanceOf(ProcessExecutionError);
    expect(observed).toMatchObject({
        diagnostic: expect.stringContaining('Missing dependency: kysely'),
    });
    expect(String(observed)).toContain('[REDACTED]');
    expect(String(observed)).not.toContain(secret);
    expect(String(observed)).not.toContain('process.stderr.write');
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

test('release validation accepts contained npm links and rejects escapes', () => {
    const candidate = fs.mkdtempSync(path.join(os.tmpdir(), 'release-npm-'));
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
    const uuidExecutable = path.join(
        candidate,
        'node_modules/uuid/dist/bin/uuid',
    );
    const uuidLink = path.join(candidate, 'node_modules/.bin/uuid');
    fs.mkdirSync(path.dirname(uuidExecutable), { recursive: true });
    fs.mkdirSync(path.dirname(uuidLink), { recursive: true });
    fs.writeFileSync(uuidExecutable, 'uuid');
    fs.symlinkSync('../uuid/dist/bin/uuid', uuidLink);
    fs.mkdirSync(path.join(candidate, 'node_modules/@app'), {
        recursive: true,
    });
    fs.symlinkSync(
        '../../code/backend',
        path.join(candidate, 'node_modules/@app/backend'),
    );
    const validator = path.join(candidate, 'validator.mjs');
    fs.writeFileSync(validator, contract.candidateValidator());

    expect(() => contract.validate(candidate, expected)).not.toThrow();
    expect(() => new ProcessRunner().run(process.execPath, [
        validator,
        candidate,
        JSON.stringify(expected),
    ])).not.toThrow();

    fs.unlinkSync(uuidLink);
    const outside = path.join(path.dirname(candidate), 'outside-package');
    fs.writeFileSync(outside, 'outside');
    roots.push(outside);
    fs.symlinkSync(outside, uuidLink);
    expect(() => contract.validate(candidate, expected)).toThrow(
        /forbidden symlink/u,
    );
    expect(() => new ProcessRunner().run(process.execPath, [
        validator,
        candidate,
        JSON.stringify(expected),
    ])).toThrow(ProcessExecutionError);
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

test('release validation migrates exact schema 2 contracts to schema 3', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-schema-'));
    roots.push(fixture);
    const contract = new LxcRuntimeContract();
    const currentContracts = [
        contract.release('backend', '24.19.0', '>=11 <12'),
        ...contract.legacyBackendReleases('24.19.0', '>=11 <12'),
    ];
    const previousContracts = [
        contract.release(
            'backend',
            '24.19.0',
            '>=11 <12',
            LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION,
        ),
        ...contract.legacyBackendReleases(
            '24.19.0',
            '>=11 <12',
            LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION,
        ),
    ];
    const validator = path.join(fixture, 'validator.mjs');
    fs.writeFileSync(validator, contract.candidateValidator());

    for (const [index, previous] of previousContracts.entries()) {
        const candidate = path.join(fixture, `candidate-${index}`);
        fs.mkdirSync(candidate);
        for (const relativePath of previous.requiredFiles) {
            const target = path.join(candidate, relativePath);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, relativePath);
        }
        const manifest = path.join(candidate, LxcRuntimeContract.manifest);
        fs.writeFileSync(manifest, contract.render(previous), { mode: 0o660 });
        fs.chmodSync(manifest, 0o660);

        new ProcessRunner().run(process.execPath, [
            validator,
            candidate,
            JSON.stringify([...currentContracts, ...previousContracts]),
            JSON.stringify([...currentContracts, ...currentContracts]),
        ]);

        expect(JSON.parse(fs.readFileSync(manifest, 'utf8')))
            .toEqual(currentContracts[index]);
        expect(fs.statSync(manifest).mode & 0o777).toBe(0o660);
        expect(() => contract.validate(candidate, currentContracts[index]))
            .not.toThrow();
    }
});

test('release validation leaves an altered schema 2 contract untouched', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-schema-'));
    roots.push(fixture);
    const candidate = path.join(fixture, 'candidate');
    fs.mkdirSync(candidate);
    const contract = new LxcRuntimeContract();
    const current = contract.release('backend', '24.19.0', '>=11 <12');
    const previous = contract.release(
        'backend',
        '24.19.0',
        '>=11 <12',
        LXC_PREVIOUS_INFRASTRUCTURE_SCHEMA_VERSION,
    );
    for (const relativePath of previous.requiredFiles) {
        const target = path.join(candidate, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, relativePath);
    }
    const altered = { ...previous, npmRange: '>=10 <11' };
    const manifest = path.join(candidate, LxcRuntimeContract.manifest);
    const original = contract.render(altered);
    fs.writeFileSync(manifest, original);
    const validator = path.join(fixture, 'validator.mjs');
    fs.writeFileSync(validator, contract.candidateValidator());

    expect(() => new ProcessRunner().run(process.execPath, [
        validator,
        candidate,
        JSON.stringify([current, previous]),
        JSON.stringify([current, current]),
    ])).toThrow(ProcessExecutionError);
    expect(fs.readFileSync(manifest, 'utf8')).toBe(original);
    expect(fs.existsSync(`${manifest}.new`)).toBe(false);
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

test('primary LXC catalog remains valid for the Template 5.0.3 updater', () => {
    const repositoryRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const legacyFiles = [
        'script/deployment/lxc-runtime.contract.ts',
        'script/deployment/release.builder.ts',
        'script/deployment/ssh.release-driver.ts',
        'deployment/lxc/bootstrap-existing-lxc.sh',
        'deployment/lxc/install-backend.sh',
        'deployment/lxc/install-frontend.sh',
    ];
    const catalog = JSON.parse(fs.readFileSync(
        path.join(repositoryRoot, LxcContractCatalog.relativePath),
        'utf8',
    )) as { files: Record<string, string> };

    expect(Object.keys(catalog.files).sort()).toEqual([...legacyFiles].sort());
    for (const relativePath of legacyFiles) {
        expect(catalog.files[relativePath]).toBe(
            createHash('sha256')
                .update(fs.readFileSync(path.join(repositoryRoot, relativePath)))
                .digest('hex'),
        );
    }
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
    const calls: Array<{
        command: string;
        arguments_: readonly string[];
        input?: string;
    }> = [];
    const runner = {
        run(
            command: string,
            arguments_: readonly string[],
            options?: { input?: string },
        ): string {
            calls.push({ command, arguments_, input: options?.input });
            return arguments_.at(-1)?.startsWith('mktemp -d ')
                ? '/tmp/sample-app-bootstrap.ABC123'
                : '';
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
            argument.includes('app@existing.test'),
        ),
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.some((argument) =>
            argument.includes('root@existing.test'),
        ),
    )).toBe(false);
    expect(calls.some((call) =>
        call.arguments_.at(-1)?.includes(
            'sudo -n -- sh /tmp/sample-app-bootstrap.ABC123/bootstrap-existing-lxc.sh',
        ),
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.at(-1)?.endsWith(
            ' app /tmp/sample-app-bootstrap.ABC123',
        ),
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.at(-1) ===
            'rm -rf -- /tmp/sample-app-bootstrap.ABC123',
    )).toBe(true);
    expect(calls.some((call) =>
        call.arguments_.at(-1)?.includes('deployment:deploy'),
    )).toBe(false);
    expect(calls.every((call) => call.input === undefined)).toBe(true);
    const bootstrapScript = fs.readFileSync(
        path.join(projectRoot, 'deployment/lxc/bootstrap-existing-lxc.sh'),
        'utf8',
    );
    expect(bootstrapScript).toContain('trap cleanup EXIT HUP INT TERM');
    expect(bootstrapScript).toContain('restore_path "$unit_file" backend-unit');
    expect(bootstrapScript).toContain(
        'Unversioned Existing-LXC infrastructure exists',
    );
    expect(bootstrapScript).toContain('deployment-user must not be root');
    expect(bootstrapScript).toContain('accepted-backend-contracts.json');
    expect(bootstrapScript).toContain('replacement-backend-contracts.json');
});

test.each(['private-key', 'password'] as const)(
    'Existing-LXC bootstrap supplies protected sudo stdin with %s SSH',
    async (sshAuthentication) => {
        const sudoPassword = 'sudo-secret-value';
        const calls: Array<{
            command: string;
            arguments_: readonly string[];
            input?: string;
        }> = [];
        const runner = {
            run(
                command: string,
                arguments_: readonly string[],
                options?: { input?: string },
            ): string {
                calls.push({
                    command,
                    arguments_: [...arguments_],
                    input: options?.input,
                });
                const remoteCommand = arguments_.at(-1) ?? '';
                if (remoteCommand === 'sudo -n true') {
                    throw new ProcessExecutionError(command, 1, null);
                }
                return remoteCommand.startsWith('mktemp -d ')
                    ? '/tmp/sample-app-bootstrap.ABC123'
                    : '';
            },
        } as ProcessRunner;
        const projectRoot = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../..',
        );
        const environment = sshAuthentication === 'private-key'
            ? {
                  DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy',
                  DEPLOYMENT_SUDO_PASSWORD: sudoPassword,
              }
            : {
                  DEPLOYMENT_SSH_PASSWORD: 'ssh-secret-value',
                  DEPLOYMENT_SUDO_PASSWORD: sudoPassword,
              };

        await new ExistingLxcDeploymentDriver(
            existingTarget(sshAuthentication),
            runner,
            environment,
            projectRoot,
        ).bootstrap('24.19.0');

        const sudoCalls = calls.filter((call) =>
            call.arguments_.at(-1)?.startsWith("sudo -S -p ''"),
        );
        expect(sudoCalls).toHaveLength(2);
        expect(sudoCalls.map((call) => call.input)).toEqual([
            `${sudoPassword}\n`,
            `${sudoPassword}\n`,
        ]);
        expect(sudoCalls.every((call) =>
            !call.arguments_.includes('StdinNull=yes'),
        )).toBe(true);
        expect(JSON.stringify(calls.map((call) => call.arguments_)))
            .not.toContain(sudoPassword);
        expect(calls.some((call) =>
            call.arguments_.some((argument) =>
                argument.includes('root@existing.test'),
            ),
        )).toBe(false);
    },
);

test('Existing-LXC rejects missing or invalid sudo credentials before upload', async () => {
    const projectRoot = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../..',
    );
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_: [...arguments_] });
            const remoteCommand = arguments_.at(-1) ?? '';
            if (
                remoteCommand === 'sudo -n true' ||
                remoteCommand === "sudo -S -p '' -v"
            ) {
                throw new ProcessExecutionError(command, 1, null);
            }
            return '';
        },
    } as ProcessRunner;
    const driver = (sudoPassword?: string) =>
        new ExistingLxcDeploymentDriver(
            existingTarget(),
            runner,
            {
                DEPLOYMENT_SSH_PRIVATE_KEY: '/keys/deploy',
                ...(sudoPassword === undefined
                    ? {}
                    : { DEPLOYMENT_SUDO_PASSWORD: sudoPassword }),
            },
            projectRoot,
        );

    await expect(driver().bootstrap('24.19.0')).rejects.toThrow(
        /DEPLOYMENT_SUDO_PASSWORD is required/u,
    );
    await expect(driver('wrong-password').bootstrap('24.19.0'))
        .rejects.toThrow(/sudo authentication or authorization failed/u);
    await expect(driver('line-one\nline-two').bootstrap('24.19.0'))
        .rejects.toThrow(/single-line/u);

    expect(calls.some((call) => call.command === 'scp')).toBe(false);
    expect(calls.some((call) =>
        call.arguments_.at(-1)?.startsWith('mktemp -d '),
    )).toBe(false);
});

test('deployment platform and Existing-LXC user are validated from project.json', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deployment-project-'));
    roots.push(root);
    const writeConfiguration = (
        platform: unknown,
        sshUser: unknown = 'deploy',
    ): void => {
        fs.writeFileSync(
            path.join(root, 'project.json'),
            JSON.stringify({ deployment: { platform, sshUser } }),
        );
    };

    for (const platform of ['docker', 'existing-lxc', 'proxmox-lxc']) {
        writeConfiguration(platform);
        expect(new DeploymentProjectConfigRepository(root).load()).toEqual({
            platform,
            sshUser: 'deploy',
        });
    }
    for (const invalid of ['local', 'lxc', '', 42]) {
        writeConfiguration(invalid);
        expect(() => new DeploymentProjectConfigRepository(root).load())
            .toThrow(/deployment\.platform must be one of/u);
    }
    for (const invalid of ['root', 'Bad User', '', 42]) {
        writeConfiguration('docker', invalid);
        expect(() => new DeploymentProjectConfigRepository(root).load())
            .toThrow(/non-root POSIX user name/u);
    }

    fs.unlinkSync(path.join(root, 'project.json'));
    expect(() => new DeploymentProjectConfigRepository(root).load())
        .toThrow(/must exist.*deployment\.platform.*deployment\.sshUser/u);
});

test('deployment CLI rejects an invalid project platform before profile work', async () => {
    const root = deploymentProjectRoot('lxc');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(
        () => true,
    );

    await expect(new DeploymentCli(root).run(['validate', '--all']))
        .resolves.toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(
        /deployment\.platform must be one of/u,
    ));
});

test('Existing-LXC infrastructure upgrade is explicit and versioned', async () => {
    const calls: Array<{ command: string; arguments_: readonly string[] }> = [];
    const runner = {
        run(command: string, arguments_: readonly string[]): string {
            calls.push({ command, arguments_ });
            return arguments_.at(-1)?.startsWith('mktemp -d ')
                ? '/tmp/sample-app-bootstrap.ABC123'
                : '';
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
    expect(text).toContain('accepted-backend-contracts.json');
    expect(text).toContain('replacement-backend-contracts.json');
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
