import type {
    ComponentName,
    ProxmoxLxcTarget,
} from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';
import { ProxmoxApiClient } from './proxmox.api-client.ts';

export interface ProxmoxApi {
    get<T>(path: string): Promise<T>;
    post<T>(
        path: string,
        body?: Record<string, string | number | boolean>,
    ): Promise<T>;
    put<T>(
        path: string,
        body?: Record<string, string | number | boolean>,
    ): Promise<T>;
}

/** Provisions LXC through REST and activates releases over direct LXC SSH. */
export class ProxmoxLxcDeploymentDriver {
    private readonly api: ProxmoxApi;
    private readonly target: ProxmoxLxcTarget;
    private readonly processes: ProcessRunner;
    private readonly projectRoot: string;
    private readonly environment: NodeJS.ProcessEnv;

    public constructor(
        target: ProxmoxLxcTarget,
        processes = new ProcessRunner(),
        environment: NodeJS.ProcessEnv = process.env,
        projectRoot = process.cwd(),
        api?: ProxmoxApi,
    ) {
        this.target = target;
        this.processes = processes;
        this.projectRoot = projectRoot;
        this.environment = environment;
        this.api = api ?? new ProxmoxApiClient(target, environment);
    }

    public async provision(): Promise<void> {
        await this.assertInfrastructure();
        const containers = await this.api.get<Array<{ vmid: number }>>(
            `/nodes/${this.target.node}/lxc`,
        );
        if (!containers.some((container) => container.vmid === this.target.vmid)) {
            const task = await this.api.post<string>(
                `/nodes/${this.target.node}/lxc`,
                {
                    vmid: this.target.vmid,
                    hostname: this.target.hostname,
                    ostemplate: this.target.template,
                    storage: this.target.storage,
                    rootfs: `${this.target.storage}:${this.target.diskGb}`,
                    cores: this.target.cores,
                    memory: this.target.memoryMb,
                    swap: this.target.swapMb,
                    nameserver: this.target.nameserver,
                    onboot: this.target.startOnBoot ? 1 : 0,
                    unprivileged: 1,
                    'ssh-public-keys': this.target.sshPublicKey,
                    net0:
                        `name=eth0,bridge=${this.target.bridge},ip=${this.target.address},gw=${this.target.gateway},firewall=${this.target.firewall ? 1 : 0}`,
                },
            );
            await this.waitForTask(task);
        } else {
            await this.api.put(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/config`,
                {
                    hostname: this.target.hostname,
                    cores: this.target.cores,
                    memory: this.target.memoryMb,
                    swap: this.target.swapMb,
                    nameserver: this.target.nameserver,
                    onboot: this.target.startOnBoot ? 1 : 0,
                    net0:
                        `name=eth0,bridge=${this.target.bridge},ip=${this.target.address},gw=${this.target.gateway},firewall=${this.target.firewall ? 1 : 0}`,
                },
            );
        }
        const status = await this.api.get<{ status: string }>(
            `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/current`,
        );
        if (status.status !== 'running') {
            const task = await this.api.post<string>(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/start`,
            );
            await this.waitForTask(task);
        }
    }

    public async deploy(
        component: ComponentName,
        archive: string,
        release: string,
        configuration: string,
    ): Promise<void> {
        await this.waitForSsh();
        const installer = `${this.projectRoot}/deployment/lxc/install-${component}.sh`;
        this.processes.run('scp', this.sshArguments([
            archive,
            `${archive}.sha256`,
            installer,
            configuration,
            `${this.target.sshUser}@${this.target.sshHost}:/tmp/`,
        ]));
        const root = `/opt/web-app/${component}`;
        const remoteArchive = `/tmp/${component}-${release}.tgz`;
        const healthUrl = component === 'backend'
            ? 'http://127.0.0.1:3000/api/health'
            : 'http://127.0.0.1/healthz';
        const command = [
            `cd /tmp && sha256sum -c ${component}-${release}.tgz.sha256`,
            'mkdir -p /etc/web-app',
            component === 'backend'
                ? 'install -m 600 /tmp/backend.env /etc/web-app/backend.env'
                : 'install -m 644 /tmp/runtime-config.js /etc/web-app/runtime-config.js',
            `mkdir -p ${root}`,
            `install -m 700 /tmp/install-${component}.sh ${root}/install.sh`,
            `previous=$(if [ -L ${root}/current ] && [ -e ${root}/current ]; then readlink -f ${root}/current; fi)`,
            component === 'backend'
                ? 'systemctl stop web-app-backend || true'
                : 'true',
            `mkdir -p ${root}/releases/${release}`,
            `tar -xzf ${remoteArchive} -C ${root}/releases/${release}`,
            `if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/previous; fi`,
            `ln -sfnT ${root}/releases/${release} ${root}/current`,
            `if ! sh ${root}/install.sh ${root}; then if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/current; sh ${root}/install.sh ${root}; fi; exit 1; fi`,
            `healthy=0; attempt=0; while [ "$attempt" -lt 30 ]; do if curl -fsS ${healthUrl}; then healthy=1; break; fi; attempt=$((attempt + 1)); sleep 1; done; if [ "$healthy" -ne 1 ]; then if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/current; sh ${root}/install.sh ${root}; fi; exit 1; fi`,
            component === 'backend'
                ? this.sqliteMaintenanceIfConfigured('retain')
                : 'true',
        ].join(' && ');
        this.processes.run('ssh', this.sshArguments([
            `${this.target.sshUser}@${this.target.sshHost}`,
            command,
        ]));
    }

    public async stop(component: ComponentName): Promise<void> {
        this.processes.run('ssh', this.sshArguments([
            `${this.target.sshUser}@${this.target.sshHost}`,
            `systemctl stop web-app-${component}`,
        ]));
        if (this.target.stopContainer) {
            const task = await this.api.post<string>(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/shutdown`,
            );
            await this.waitForTask(task);
        }
    }

    public rollback(component: ComponentName, release?: string): void {
        const root = `/opt/web-app/${component}`;
        const target = release
            ? `${root}/releases/${release}`
            : `${root}/previous`;
        const command = [
            `test -d "$(readlink -f ${target})"`,
            `ln -sfn "$(readlink -f ${target})" ${root}/current`,
            `sh ${root}/install.sh ${root}`,
        ].join(' && ');
        this.processes.run('ssh', this.sshArguments([
            `${this.target.sshUser}@${this.target.sshHost}`,
            command,
        ]));
    }

    public async status(): Promise<string> {
        const status = await this.api.get<{ status: string }>(
            `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/current`,
        );
        return status.status;
    }

    /** Starts an existing LXC without rewriting its configuration. */
    public async start(): Promise<void> {
        const status = await this.status();
        if (status === 'running') {
            return;
        }
        const task = await this.api.post<string>(
            `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/start`,
        );
        await this.waitForTask(task);
    }

    /** Lists SQLite backups stored persistently inside the LXC. */
    public async databaseList(): Promise<string> {
        await this.waitForSsh();
        return this.processes.run('ssh', this.sshArguments([
            `${this.target.sshUser}@${this.target.sshHost}`,
            this.databaseMaintenanceCommand('list'),
        ]));
    }

    /** Restores one explicit SQLite backup and validates application health. */
    public async databaseRestore(backupId: string): Promise<string> {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/.test(backupId)) {
            throw new Error(`Invalid database backup identifier '${backupId}'.`);
        }
        await this.waitForSsh();
        const root = '/opt/web-app/backend';
        const command = [
            'systemctl stop web-app-backend || true',
            `${this.databaseMaintenanceCommand('restore')} ${backupId}`,
            `sh ${root}/install.sh ${root}`,
            'healthy=0; attempt=0; while [ "$attempt" -lt 30 ]; do if curl -fsS http://127.0.0.1:3000/api/health; then healthy=1; break; fi; attempt=$((attempt + 1)); sleep 1; done; if [ "$healthy" -ne 1 ]; then systemctl stop web-app-backend || true; exit 1; fi',
            this.databaseMaintenanceCommand('retain'),
        ].join(' && ');
        return this.processes.run('ssh', this.sshArguments([
            `${this.target.sshUser}@${this.target.sshHost}`,
            command,
        ]));
    }

    private async assertInfrastructure(): Promise<void> {
        const nodes = await this.api.get<Array<{ node: string }>>('/nodes');
        if (!nodes.some((item) => item.node === this.target.node)) {
            throw new Error(`Unknown Proxmox node '${this.target.node}'.`);
        }
        const storages = await this.api.get<Array<{ storage: string }>>(
            `/nodes/${this.target.node}/storage`,
        );
        if (!storages.some((item) => item.storage === this.target.storage)) {
            throw new Error(`Unknown Proxmox storage '${this.target.storage}'.`);
        }
        const templateStorage = this.target.template.split(':', 1)[0];
        const templates = await this.api.get<Array<{ volid: string }>>(
            `/nodes/${this.target.node}/storage/${templateStorage}/content`,
        );
        if (!templates.some((item) => item.volid === this.target.template)) {
            throw new Error(`Unknown Proxmox template '${this.target.template}'.`);
        }
        const networks = await this.api.get<Array<{ iface: string }>>(
            `/nodes/${this.target.node}/network`,
        );
        if (!networks.some((item) => item.iface === this.target.bridge)) {
            throw new Error(`Unknown Proxmox bridge '${this.target.bridge}'.`);
        }
    }

    private sshArguments(arguments_: readonly string[]): string[] {
        const keyPath = this.environment.DEPLOYMENT_SSH_PRIVATE_KEY;
        if (!keyPath) {
            throw new Error('DEPLOYMENT_SSH_PRIVATE_KEY is required.');
        }
        return [
            '-i',
            keyPath,
            '-o',
            'BatchMode=yes',
            '-o',
            'StrictHostKeyChecking=accept-new',
            '-o',
            'ConnectTimeout=5',
            ...arguments_,
        ];
    }

    private databaseMaintenanceCommand(
        command: 'list' | 'retain' | 'restore',
    ): string {
        return [
            'DB_SQLITE_PATH="$(sed -n \'s/^DB_SQLITE_PATH=//p\' /etc/web-app/backend.env)"',
            'DB_BACKUP_RETENTION="$(sed -n \'s/^DB_BACKUP_RETENTION=//p\' /etc/web-app/backend.env)"',
            'export DB_SQLITE_PATH DB_BACKUP_RETENTION',
            `/usr/local/bin/node --experimental-transform-types /opt/web-app/backend/current/script/database-maintenance.ts ${command}`,
        ].join('; ');
    }

    private sqliteMaintenanceIfConfigured(command: 'retain'): string {
        return [
            'if grep -qx "DB_TYPE=sqlite" /etc/web-app/backend.env',
            `then ${this.databaseMaintenanceCommand(command)}`,
            'fi',
        ].join('; ');
    }

    private async waitForSsh(): Promise<void> {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
                this.processes.run('ssh', this.sshArguments([
                    `${this.target.sshUser}@${this.target.sshHost}`,
                    'true',
                ]));
                return;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 2_000));
            }
        }
        throw new Error(
            `Timed out waiting for SSH at ${this.target.sshHost}.`,
        );
    }

    private async waitForTask(upid: string): Promise<void> {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const task = await this.api.get<{
                status: string;
                exitstatus?: string;
            }>(
                `/nodes/${this.target.node}/tasks/${encodeURIComponent(upid)}/status`,
            );
            if (task.status === 'stopped') {
                if (task.exitstatus !== 'OK') {
                    throw new Error(
                        `Proxmox task failed: ${task.exitstatus ?? 'unknown'}.`,
                    );
                }
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        throw new Error('Timed out waiting for Proxmox task.');
    }
}
