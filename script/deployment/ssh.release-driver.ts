import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ComponentName } from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';

export interface SshReleaseTarget {
    readonly installationId: string;
    readonly sshAuthentication: 'private-key' | 'password';
    readonly sshHost: string;
    readonly sshPort: number;
    readonly sshUser: string;
    readonly sshHostKeyFingerprint: string;
}

type PrivilegeMode = 'managed' | 'root';

/** Owns the shared checksummed, host-key-pinned SSH release protocol. */
export class SshReleaseDriver {
    private readonly target: SshReleaseTarget;
    private readonly privilegeMode: PrivilegeMode;
    private readonly processes: ProcessRunner;
    private readonly environment: NodeJS.ProcessEnv;
    private readonly projectRoot: string;
    private temporaryRoot: string | undefined;
    private transportEnvironment: NodeJS.ProcessEnv | undefined;
    private hostKeyCommand: string | undefined;

    public constructor(
        target: SshReleaseTarget,
        privilegeMode: PrivilegeMode,
        processes = new ProcessRunner(),
        environment: NodeJS.ProcessEnv = process.env,
        projectRoot = process.cwd(),
    ) {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(
            target.installationId,
        )) {
            throw new Error('LXC installationId must be kebab-case.');
        }
        this.target = target;
        this.privilegeMode = privilegeMode;
        this.processes = processes;
        this.environment = environment;
        this.projectRoot = projectRoot;
    }

    public async deploy(
        component: ComponentName,
        archive: string,
        release: string,
        configuration: string,
    ): Promise<void> {
        await this.withConnection(async () => {
            await this.waitForSsh();
            const installer = path.join(
                this.projectRoot,
                'deployment/lxc',
                `install-${component}.sh`,
            );
            this.transport('scp', this.scpArguments([
                archive,
                `${archive}.sha256`,
                installer,
                configuration,
                `${this.destination()}:/tmp/`,
            ]));
            this.transport('ssh', this.sshArguments([
                this.destination(),
                this.activationCommand(component, release),
            ]));
        });
    }

    public async stop(component: ComponentName): Promise<void> {
        await this.withConnection(async () => {
            this.transport('ssh', this.sshArguments([
                this.destination(),
                this.serviceCommand('stop', component),
            ]));
        });
    }

    public async rollback(
        component: ComponentName,
        release?: string,
    ): Promise<void> {
        await this.withConnection(async () => {
            const root = this.componentRoot(component);
            const candidate = release
                ? `${root}/releases/${release}`
                : `${root}/previous`;
            const command = [
                `candidate=$(readlink -f ${candidate})`,
                'test -d "$candidate"',
                `current=$(if [ -L ${root}/current ]; then readlink -f ${root}/current; fi)`,
                `ln -sfnT "$candidate" ${root}/current`,
                `if ! sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()} || ! ${this.healthCommand(component)}; then if [ -n "$current" ]; then ln -sfnT "$current" ${root}/current; sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()}; fi; exit 1; fi`,
            ].join(' && ');
            this.transport('ssh', this.sshArguments([
                this.destination(),
                command,
            ]));
        });
    }

    public async status(component: ComponentName): Promise<string> {
        return this.withConnection(async () => this.transport(
            'ssh',
            this.sshArguments([
                this.destination(),
                this.serviceCommand('status', component),
            ]),
        ));
    }

    public async databaseList(): Promise<string> {
        return this.withConnection(async () => {
            await this.waitForSsh();
            return this.transport('ssh', this.sshArguments([
                this.destination(),
                this.databaseMaintenanceCommand('list'),
            ]));
        });
    }

    public async databaseRestore(backupId: string): Promise<string> {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.sqlite$/u.test(backupId)) {
            throw new Error(`Invalid database backup identifier '${backupId}'.`);
        }
        return this.withConnection(async () => {
            await this.waitForSsh();
            const root = this.componentRoot('backend');
            const command = [
                `${this.serviceCommand('stop', 'backend')} || true`,
                `${this.databaseMaintenanceCommand('restore')} ${backupId}`,
                `sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()}`,
                `if ! ${this.healthCommand('backend')}; then ${this.serviceCommand('stop', 'backend')} || true; exit 1; fi`,
                this.databaseMaintenanceCommand('retain'),
            ].join(' && ');
            return this.transport('ssh', this.sshArguments([
                this.destination(),
                command,
            ]));
        });
    }

    /** Explicitly bootstraps a Debian 13/x86_64 container; deploy never calls it. */
    public async bootstrap(nodeVersion: string): Promise<void> {
        if (!/^\d+\.\d+\.\d+$/u.test(nodeVersion)) {
            throw new Error('Bootstrap Node version is invalid.');
        }
        await this.withConnection(async () => {
            await this.waitForSsh();
            const script = path.join(
                this.projectRoot,
                'deployment/lxc/bootstrap-existing-lxc.sh',
            );
            this.transport('scp', this.scpArguments([
                script,
                `${this.destination('root')}:/tmp/bootstrap-existing-lxc.sh`,
            ]));
            this.transport('ssh', this.sshArguments([
                this.destination('root'),
                `test "$(id -u)" -eq 0 && sh /tmp/bootstrap-existing-lxc.sh ${this.target.installationId} ${nodeVersion}`,
            ]));
        });
    }

    private activationCommand(
        component: ComponentName,
        release: string,
    ): string {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(release)) {
            throw new Error('Deployment release identifier is invalid.');
        }
        const root = this.componentRoot(component);
        return [
            `cd /tmp && sha256sum -c ${component}-${release}.tgz.sha256`,
            this.configurationCommand(component),
            `mkdir -p ${root}`,
            `install -m 700 /tmp/install-${component}.sh ${root}/install.sh`,
            `previous=$(if [ -L ${root}/current ] && [ -e ${root}/current ]; then readlink -f ${root}/current; fi)`,
            component === 'backend'
                ? `${this.serviceCommand('stop', component)} || true`
                : 'true',
            `mkdir -p ${root}/releases/${release}`,
            `tar -xzf /tmp/${component}-${release}.tgz -C ${root}/releases/${release}`,
            `if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/previous; fi`,
            `ln -sfnT ${root}/releases/${release} ${root}/current`,
            `if ! sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()} || ! ${this.healthCommand(component)}; then if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/current; sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()}; fi; exit 1; fi`,
            component === 'backend'
                ? this.sqliteMaintenanceIfConfigured('retain')
                : 'true',
        ].join(' && ');
    }

    private configurationCommand(component: ComponentName): string {
        const source = component === 'backend'
            ? '/tmp/backend.env'
            : '/tmp/runtime-config.js';
        if (this.privilegeMode === 'managed') {
            return `sudo -n /usr/local/sbin/${this.target.installationId}-install-config ${component} ${source}`;
        }
        const mode = component === 'backend' ? '600' : '644';
        const destination = component === 'backend'
            ? `/etc/${this.target.installationId}/backend.env`
            : `/etc/${this.target.installationId}/runtime-config.js`;
        return `mkdir -p /etc/${this.target.installationId} && install -m ${mode} ${source} ${destination}`;
    }

    private serviceCommand(
        action: 'activate' | 'status' | 'stop',
        component: ComponentName,
    ): string {
        if (this.privilegeMode === 'managed') {
            return `sudo -n /usr/local/sbin/${this.target.installationId}-service-control ${action} ${component}`;
        }
        const service = component === 'backend'
            ? `${this.target.installationId}-backend`
            : 'nginx';
        const systemctl = action === 'activate'
            ? 'enable --now'
            : action === 'status'
              ? 'is-active'
              : 'stop';
        return `systemctl ${systemctl} ${service}`;
    }

    private healthCommand(component: ComponentName): string {
        const request = component === 'backend'
            ? 'curl -fsS http://127.0.0.1:3000/api/health'
            : 'curl -fsS http://127.0.0.1/healthz && curl -fsS http://127.0.0.1/runtime-config.js';
        return `healthy=0; attempt=0; while [ "$attempt" -lt 30 ]; do if ${request}; then healthy=1; break; fi; attempt=$((attempt + 1)); sleep 1; done; test "$healthy" -eq 1`;
    }

    private databaseMaintenanceCommand(
        command: 'list' | 'retain' | 'restore',
    ): string {
        const id = this.target.installationId;
        return [
            `DB_SQLITE_PATH="$(sed -n 's/^DB_SQLITE_PATH=//p' /etc/${id}/backend.env)"`,
            `DB_BACKUP_RETENTION="$(sed -n 's/^DB_BACKUP_RETENTION=//p' /etc/${id}/backend.env)"`,
            'export DB_SQLITE_PATH DB_BACKUP_RETENTION',
            `/usr/local/bin/node --experimental-transform-types /opt/${id}/backend/current/script/database-maintenance.ts ${command}`,
        ].join('; ');
    }

    private sqliteMaintenanceIfConfigured(command: 'retain'): string {
        return `if grep -qx "DB_TYPE=sqlite" /etc/${this.target.installationId}/backend.env; then ${this.databaseMaintenanceCommand(command)}; fi`;
    }

    private componentRoot(component: ComponentName): string {
        return `/opt/${this.target.installationId}/${component}`;
    }

    private nodeVersion(): string {
        const value = fs.readFileSync(
            path.join(this.projectRoot, '.nvmrc'),
            'utf8',
        ).trim();
        if (!/^\d+\.\d+\.\d+$/u.test(value)) {
            throw new Error('.nvmrc must contain an exact Node version.');
        }
        return value;
    }

    private async waitForSsh(): Promise<void> {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
                this.transport('ssh', this.sshArguments([
                    this.destination(),
                    'true',
                ]));
                return;
            } catch {
                if (this.target.sshAuthentication === 'password') {
                    throw new Error(
                        `SSH password authentication failed for ${this.target.sshHost}.`,
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, 2_000));
            }
        }
        throw new Error(`Timed out waiting for SSH at ${this.target.sshHost}.`);
    }

    private async withConnection<T>(operation: () => Promise<T>): Promise<T> {
        try {
            this.prepareConnection();
            return await operation();
        } finally {
            if (this.temporaryRoot) {
                fs.rmSync(this.temporaryRoot, { recursive: true, force: true });
            }
            this.temporaryRoot = undefined;
            this.hostKeyCommand = undefined;
            this.transportEnvironment = undefined;
        }
    }

    private prepareConnection(): void {
        this.temporaryRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), 'web-app-ssh-'),
        );
        fs.chmodSync(this.temporaryRoot, 0o700);
        this.prepareHostKeyCommand();
        if (this.target.sshAuthentication === 'private-key') {
            if (!this.environment.DEPLOYMENT_SSH_PRIVATE_KEY) {
                throw new Error('DEPLOYMENT_SSH_PRIVATE_KEY is required.');
            }
            return;
        }
        if (!this.environment.DEPLOYMENT_SSH_PASSWORD) {
            throw new Error('DEPLOYMENT_SSH_PASSWORD is required.');
        }
        const askpass = path.join(this.temporaryRoot, 'askpass.mjs');
        fs.writeFileSync(askpass, [
            `#!${process.execPath}`,
            "const value = process.env.DEPLOYMENT_SSH_PASSWORD;",
            'if (!value) process.exit(1);',
            'process.stdout.write(value);',
            '',
        ].join('\n'), { mode: 0o700 });
        this.transportEnvironment = {
            ...this.environment,
            DISPLAY: this.environment.DISPLAY ?? ':0',
            SSH_ASKPASS: askpass,
            SSH_ASKPASS_REQUIRE: 'force',
        };
    }

    private prepareHostKeyCommand(): void {
        const command = path.join(this.temporaryRoot as string, 'host-key.sh');
        fs.writeFileSync(command, [
            '#!/bin/sh',
            'set -eu',
            `expected='${this.target.sshHostKeyFingerprint}'`,
            'case "$1" in',
            '    "$expected") printf "%s %s %s\\n" "$4" "$2" "$3" ;;',
            '    SHA256:*) exit 74 ;;',
            '    *) exit 0 ;;',
            'esac',
            '',
        ].join('\n'), { mode: 0o700 });
        this.hostKeyCommand = command;
    }

    private authenticationArguments(command: 'scp' | 'ssh'): string[] {
        const privateKey = this.target.sshAuthentication === 'private-key'
            ? [
                  '-i',
                  this.environment.DEPLOYMENT_SSH_PRIVATE_KEY ?? '',
                  '-o',
                  'BatchMode=yes',
                  '-o',
                  'IdentitiesOnly=yes',
                  '-o',
                  'PasswordAuthentication=no',
              ]
            : [
                  '-o',
                  'BatchMode=no',
                  '-o',
                  'NumberOfPasswordPrompts=1',
                  '-o',
                  'PreferredAuthentications=password',
                  '-o',
                  'PubkeyAuthentication=no',
                  '-o',
                  'KbdInteractiveAuthentication=no',
                  ...(command === 'ssh' ? ['-o', 'StdinNull=yes'] : []),
              ];
        return [
            command === 'scp' ? '-P' : '-p',
            String(this.target.sshPort),
            ...privateKey,
            '-o',
            'StrictHostKeyChecking=yes',
            '-o',
            'UserKnownHostsFile=/dev/null',
            '-o',
            'GlobalKnownHostsFile=/dev/null',
            '-o',
            'CheckHostIP=no',
            '-o',
            `KnownHostsCommand=${this.hostKeyCommand ?? ''} %f %t %K %H`,
            '-o',
            'ConnectTimeout=5',
        ];
    }

    private sshArguments(arguments_: readonly string[]): string[] {
        return [...this.authenticationArguments('ssh'), ...arguments_];
    }

    private scpArguments(arguments_: readonly string[]): string[] {
        return [...this.authenticationArguments('scp'), ...arguments_];
    }

    private transport(
        command: 'scp' | 'ssh',
        arguments_: readonly string[],
    ): string {
        try {
            return this.processes.run(command, arguments_, {
                env: this.transportEnvironment,
            });
        } catch (error) {
            if (this.target.sshAuthentication === 'password') {
                throw new Error(
                    `SSH password transport failed for ${this.target.sshHost}.`,
                );
            }
            throw error;
        }
    }

    private destination(user = this.target.sshUser): string {
        return `${user}@${this.target.sshHost}`;
    }
}
