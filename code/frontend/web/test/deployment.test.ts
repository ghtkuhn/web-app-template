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
import { DeploymentConfigRenderer } from '../../../../script/deployment/config.renderer.ts';
import type {
    DockerTarget,
    ProxmoxLxcTarget,
} from '../../../../script/deployment/interfaces.ts';
import type { ProcessRunner } from '../../../../script/deployment/process.runner.ts';

const roots: string[] = [];

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
        sshUser: 'root',
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
        sshUser: 'root',
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
        sshUser: 'root',
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
        '/project',
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
        sshUser: 'root',
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
        '/project',
        api,
    );

    await driver.databaseRestore('backup-001.sqlite');

    const command = calls.at(-1)?.arguments_.at(-1) ?? '';
    expect(command).toContain('systemctl stop web-app-backend');
    expect(command).toContain('database-maintenance.ts restore');
    expect(command).toContain('install.sh');
    expect(command).toContain('while [ "$attempt" -lt 30 ]');
    expect(command).toContain('systemctl stop web-app-backend || true; exit 1');
    expect(command).toContain('/api/health');
    await expect(driver.databaseRestore('../escape.sqlite')).rejects.toThrow(
        /Invalid database backup identifier/,
    );
});
