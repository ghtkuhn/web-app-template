import type { ComponentName, ProxmoxLxcTarget } from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';
import { ProxmoxApiClient } from './proxmox.api-client.ts';
import { SshReleaseDriver } from './ssh.release-driver.ts';

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

/** Provisions Proxmox LXC infrastructure and delegates releases to SSH. */
export class ProxmoxLxcDeploymentDriver {
    private readonly api: ProxmoxApi;
    private readonly target: ProxmoxLxcTarget;
    private readonly releases: SshReleaseDriver;

    public constructor(
        target: ProxmoxLxcTarget,
        processes = new ProcessRunner(),
        environment: NodeJS.ProcessEnv = process.env,
        projectRoot = process.cwd(),
        api?: ProxmoxApi,
    ) {
        this.target = target;
        this.api = api ?? new ProxmoxApiClient(target, environment);
        this.releases = new SshReleaseDriver(
            target,
            'root',
            processes,
            environment,
            projectRoot,
        );
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
                    net0: `name=eth0,bridge=${this.target.bridge},ip=${this.target.address},gw=${this.target.gateway},firewall=${this.target.firewall ? 1 : 0}`,
                },
            );
            await this.waitForTask(task);
        }
        const status = await this.containerStatus();
        if (status !== 'running') {
            await this.waitForTask(await this.api.post<string>(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/start`,
            ));
        }
    }

    public deploy(
        component: ComponentName,
        archive: string,
        release: string,
        configuration: string,
    ): Promise<void> {
        return this.releases.deploy(component, archive, release, configuration);
    }

    public async stop(component: ComponentName): Promise<void> {
        await this.releases.stop(component);
        if (this.target.stopContainer) {
            await this.waitForTask(await this.api.post<string>(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/shutdown`,
            ));
        }
    }

    public rollback(component: ComponentName, release?: string): Promise<void> {
        return this.releases.rollback(component, release);
    }

    public status(): Promise<string> {
        return this.containerStatus();
    }

    public async start(): Promise<void> {
        if (await this.containerStatus() !== 'running') {
            await this.waitForTask(await this.api.post<string>(
                `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/start`,
            ));
        }
    }

    public databaseList(): Promise<string> {
        return this.releases.databaseList();
    }

    public databaseRestore(backupId: string): Promise<string> {
        return this.releases.databaseRestore(backupId);
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

    private async containerStatus(): Promise<string> {
        return (await this.api.get<{ status: string }>(
            `/nodes/${this.target.node}/lxc/${this.target.vmid}/status/current`,
        )).status;
    }

    private async waitForTask(upid: string): Promise<void> {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const task = await this.api.get<{
                status: string;
                exitstatus?: string;
            }>(`/nodes/${this.target.node}/tasks/${encodeURIComponent(upid)}/status`);
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
