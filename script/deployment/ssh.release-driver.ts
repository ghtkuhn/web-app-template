import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ComponentName } from './interfaces.ts';
import {
    LXC_INFRASTRUCTURE_SCHEMA_VERSION,
    LxcRuntimeContract,
    type LxcReleaseContractData,
} from './lxc-runtime.contract.ts';
import {
    ProcessExecutionError,
    ProcessRunner,
} from './process.runner.ts';

export class SshTransportError extends Error {
    public readonly exitCode = 255;
}

export class RemoteCommandError extends Error {
    public readonly exitCode: number | null;

    public constructor(exitCode: number | null) {
        super(
            `Remote SSH command failed${exitCode === null ? '' : ` with exit code ${exitCode}`}.`,
        );
        this.name = 'RemoteCommandError';
        this.exitCode = exitCode;
    }
}

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
    private readonly runtimeContract = new LxcRuntimeContract();
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
            if (this.privilegeMode === 'managed') {
                await this.preflightRuntime();
            }
            const installer = path.join(
                this.projectRoot,
                'deployment/lxc',
                `install-${component}.sh`,
            );
            const validator = this.validatorFile();
            const expected = this.releaseContract(component);
            this.transport('scp', this.scpArguments([
                archive,
                `${archive}.sha256`,
                installer,
                validator,
                configuration,
                `${this.destination()}:/tmp/`,
            ]));
            this.transport('ssh', this.sshArguments([
                this.destination(),
                this.activationCommand(component, release, expected),
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
            await this.waitForSsh();
            if (this.privilegeMode === 'managed') {
                await this.preflightRuntime();
            }
            const validator = this.validatorFile();
            this.transport('scp', this.scpArguments([
                validator,
                `${this.destination()}:/tmp/`,
            ]));
            const root = this.componentRoot(component);
            const candidate = release
                ? `${root}/releases/${release}`
                : `${root}/previous`;
            const expected = this.rollbackContracts(component);
            const command = [
                `candidate=$(readlink -f ${candidate})`,
                'test -d "$candidate"',
                `case "$candidate/" in ${root}/releases/*/) true ;; *) exit 65 ;; esac`,
                this.validateCandidate('$candidate', expected),
                component === 'backend'
                    ? 'test -d "$candidate/node_modules" && test ! -L "$candidate/node_modules"'
                    : 'true',
                `current=$(if [ -L ${root}/current ]; then readlink -f ${root}/current; fi)`,
                `ln -sfnT "$candidate" ${root}/current`,
                `if ! ${this.installCommand(root, component)} || ! ${this.healthCommand(component)}; then if [ -n "$current" ]; then ln -sfnT "$current" ${root}/current; ${this.installCommand(root, component)}; fi; exit 1; fi`,
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
                this.installCommand(root, 'backend'),
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
        await this.infrastructure('bootstrap', nodeVersion);
    }

    /** Reports the installed Existing-LXC infrastructure contract. */
    public async infrastructureStatus(): Promise<string> {
        return this.withConnection(async () => {
            await this.waitForSsh();
            const infrastructure = this.remoteInfrastructure();
            return `${JSON.stringify(infrastructure, null, 4)}\n`;
        });
    }

    /** Explicitly upgrades Existing-LXC operating-system integration. */
    public async infrastructureUpgrade(nodeVersion: string): Promise<void> {
        await this.infrastructure('upgrade', nodeVersion);
    }

    private activationCommand(
        component: ComponentName,
        release: string,
        expected: LxcReleaseContractData,
    ): string {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(release)) {
            throw new Error('Deployment release identifier is invalid.');
        }
        const root = this.componentRoot(component);
        const candidate = `${root}/releases/${release}`;
        return [
            `cd /tmp && sha256sum -c ${component}-${release}.tgz.sha256`,
            `mkdir -p ${root}`,
            `install -m 700 /tmp/install-${component}.sh ${root}/install.sh`,
            `previous=$(if [ -L ${root}/current ] && [ -e ${root}/current ]; then readlink -f ${root}/current; fi)`,
            `if [ -n "$previous" ]; then case "$previous/" in ${root}/releases/*/) true ;; *) exit 65 ;; esac; fi`,
            `test ! -e ${candidate}`,
            `mkdir -p ${candidate}`,
            `tar -xzf /tmp/${component}-${release}.tgz -C ${candidate}`,
            this.privilegeMode === 'root'
                ? this.installCommand(root, component, 'prepare')
                : 'true',
            this.validateCandidate(candidate, expected),
            `if [ -n "$previous" ]; then ${this.validateCandidate('$previous', this.rollbackContracts(component))}; fi`,
            component === 'backend'
                ? `cd ${candidate} && /usr/local/bin/npm ci --ignore-scripts --omit=dev --workspace @app/backend`
                : 'true',
            this.configurationCommand(component),
            component === 'backend'
                ? `${this.serviceCommand('stop', component)} || true`
                : 'true',
            `if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/previous; fi`,
            `ln -sfnT ${candidate} ${root}/current`,
            `if ! ${this.installCommand(root, component)} || ! ${this.healthCommand(component)}; then if [ -n "$previous" ]; then ln -sfnT "$previous" ${root}/current; ${this.installCommand(root, component)}; fi; exit 1; fi`,
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

    private installCommand(
        root: string,
        component: ComponentName,
        action: 'prepare' | 'activate' = 'activate',
    ): string {
        const base = `sh ${root}/install.sh ${root} ${this.target.installationId} ${this.privilegeMode} ${this.nodeVersion()} ${action}`;
        return component === 'backend'
            ? `${base} ${LxcRuntimeContract.backendLauncher}`
            : base;
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
            `/usr/local/bin/node --experimental-transform-types /opt/${id}/backend/current/${LxcRuntimeContract.backendMaintenanceLauncher} ${command}`,
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

    private npmRange(): string {
        const value = JSON.parse(fs.readFileSync(
            path.join(this.projectRoot, 'package.json'),
            'utf8',
        )) as { engines?: { npm?: unknown } };
        if (typeof value.engines?.npm !== 'string') {
            throw new Error('package.json engines.npm is required.');
        }
        return value.engines.npm;
    }

    private releaseContract(component: ComponentName): LxcReleaseContractData {
        return this.runtimeContract.release(
            component,
            this.nodeVersion(),
            this.npmRange(),
        );
    }

    private rollbackContracts(
        component: ComponentName,
    ): readonly LxcReleaseContractData[] {
        const current = this.releaseContract(component);
        return component === 'backend'
            ? [
                  current,
                  ...this.runtimeContract.legacyBackendReleases(
                      this.nodeVersion(),
                      this.npmRange(),
                  ),
              ]
            : [current];
    }

    private validatorFile(): string {
        const target = path.join(
            this.temporaryRoot as string,
            'lxc-release-validator.mjs',
        );
        fs.writeFileSync(
            target,
            this.runtimeContract.candidateValidator(),
            { mode: 0o700 },
        );
        return target;
    }

    private validateCandidate(
        candidate: string,
        expected: LxcReleaseContractData | readonly LxcReleaseContractData[],
    ): string {
        return `/usr/local/bin/node /tmp/lxc-release-validator.mjs "${candidate}" ${this.shellQuote(JSON.stringify(expected))}`;
    }

    private async preflightRuntime(): Promise<void> {
        const infrastructure = this.remoteInfrastructure();
        const requiredNode = this.nodeVersion();
        const requiredNpm = this.npmRange();
        if (
            infrastructure.schemaVersion !== LXC_INFRASTRUCTURE_SCHEMA_VERSION ||
            infrastructure.nodeVersion !== requiredNode ||
            infrastructure.npmRange !== requiredNpm ||
            infrastructure.backendLauncher !==
                LxcRuntimeContract.backendLauncher ||
            infrastructure.maintenanceLauncher !==
                LxcRuntimeContract.backendMaintenanceLauncher ||
            infrastructure.deploymentUser !== this.target.sshUser
        ) {
            throw new Error(
                `Existing-LXC infrastructure contract requires schema ${LXC_INFRASTRUCTURE_SCHEMA_VERSION}, deployment user ${this.target.sshUser}, Node.js ${requiredNode}, npm '${requiredNpm}', launcher ${LxcRuntimeContract.backendLauncher}, and maintenance launcher ${LxcRuntimeContract.backendMaintenanceLauncher}; observed metadata is missing, stale, or invalid. Run deployment:infrastructure:upgrade before deploying.`,
            );
        }
        const observedNode = this.transport('ssh', this.sshArguments([
            this.destination(),
            '/usr/local/bin/node --version',
        ])).replace(/^v/u, '');
        const observedNpm = this.transport('ssh', this.sshArguments([
            this.destination(),
            '/usr/local/bin/npm --version',
        ]));
        if (
            observedNode !== requiredNode ||
            !this.matchesNpm(observedNpm, requiredNpm)
        ) {
            throw new Error(
                `Remote runtime mismatch: required Node.js ${requiredNode} and npm '${requiredNpm}'; observed Node.js ${observedNode} and npm ${observedNpm}. Run deployment:infrastructure:upgrade before deploying.`,
            );
        }
    }

    private remoteInfrastructure(): Record<string, unknown> {
        const target = `/etc/${this.target.installationId}/infrastructure.json`;
        const output = this.transport('ssh', this.sshArguments([
            this.destination(),
            `if [ -f ${target} ]; then cat ${target}; else printf '{"schemaVersion":0}'; fi`,
        ]));
        const value = JSON.parse(output) as unknown;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Remote Existing-LXC infrastructure metadata is invalid.');
        }
        return value as Record<string, unknown>;
    }

    private matchesNpm(version: string, range: string): boolean {
        const match = /^>=(\d+) <(\d+)$/u.exec(range);
        const major = /^(\d+)\./u.exec(version)?.[1];
        return Boolean(
            match?.[1] &&
            match[2] &&
            major &&
            Number(major) >= Number(match[1]) &&
            Number(major) < Number(match[2]),
        );
    }

    private async infrastructure(
        mode: 'bootstrap' | 'upgrade',
        nodeVersion: string,
    ): Promise<void> {
        await this.withConnection(async () => {
            await this.waitForSsh();
            const remoteDirectory = this.transport(
                'ssh',
                this.sshArguments([
                    this.destination(),
                    `mktemp -d /tmp/${this.target.installationId}-bootstrap.XXXXXX`,
                ]),
            ).trim();
            if (!new RegExp(
                `^/tmp/${this.target.installationId}-bootstrap\\.[A-Za-z0-9]+$`,
                'u',
            ).test(remoteDirectory)) {
                throw new Error(
                    'Remote Existing-LXC bootstrap staging path is invalid.',
                );
            }
            const script = path.join(
                this.projectRoot,
                'deployment/lxc/bootstrap-existing-lxc.sh',
            );
            const files = [
                this.validatorFile(),
                ...this.legacyMigrationFiles(),
            ];
            try {
                this.transport('scp', this.scpArguments([
                    script,
                    ...files,
                    `${this.destination()}:${remoteDirectory}/`,
                ]));
                this.transport('ssh', this.sshArguments([
                    this.destination(),
                    `sudo -n sh ${remoteDirectory}/bootstrap-existing-lxc.sh ${mode} ${this.target.installationId} ${nodeVersion} ${this.shellQuote(this.npmRange())} ${LXC_INFRASTRUCTURE_SCHEMA_VERSION} ${LxcRuntimeContract.backendLauncher} ${LxcRuntimeContract.backendMaintenanceLauncher} ${this.target.sshUser} ${remoteDirectory}`,
                ]));
            } catch (error) {
                try {
                    this.removeRemoteBootstrapDirectory(remoteDirectory);
                } catch {
                    // Preserve the actionable bootstrap or transport failure.
                }
                throw error;
            }
            this.removeRemoteBootstrapDirectory(remoteDirectory);
        });
    }

    private removeRemoteBootstrapDirectory(remoteDirectory: string): void {
        this.transport('ssh', this.sshArguments([
            this.destination(),
            `rm -rf -- ${remoteDirectory}`,
        ]));
    }

    private legacyMigrationFiles(): string[] {
        const root = this.temporaryRoot as string;
        const nodeVersion = this.nodeVersion();
        const npmRange = this.npmRange();
        const variants = this.runtimeContract.legacyBackendReleases(
            nodeVersion,
            npmRange,
        );
        const files: string[] = [];
        const canonical = path.join(root, 'canonical-backend-contract.json');
        fs.writeFileSync(
            canonical,
            this.runtimeContract.render(this.runtimeContract.release(
                'backend',
                nodeVersion,
                npmRange,
            )),
            'utf8',
        );
        files.push(canonical);
        for (const [index, variant] of variants.entries()) {
            const label = index === 0 ? 'workspace' : 'flat';
            const entrypoint = index === 0
                ? 'code/backend/src/index.ts'
                : 'src/index.ts';
            const launcher = path.join(root, `legacy-${label}-launcher.mjs`);
            const maintenanceLauncher = path.join(
                root,
                `legacy-${label}-maintenance-launcher.mjs`,
            );
            const contract = path.join(root, `legacy-${label}-contract.json`);
            fs.writeFileSync(
                launcher,
                this.runtimeContract.backendLauncher(entrypoint),
                'utf8',
            );
            fs.writeFileSync(
                maintenanceLauncher,
                this.runtimeContract.backendMaintenanceLauncher(
                    index === 0
                        ? 'code/backend/script/database-maintenance.ts'
                        : 'script/database-maintenance.ts',
                ),
                'utf8',
            );
            fs.writeFileSync(
                contract,
                this.runtimeContract.render(variant),
                'utf8',
            );
            files.push(launcher, maintenanceLauncher, contract);
        }
        return files;
    }

    private shellQuote(value: string): string {
        return `'${value.replaceAll("'", "'\\''")}'`;
    }

    private async waitForSsh(user = this.target.sshUser): Promise<void> {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
                this.transport('ssh', this.sshArguments([
                    this.destination(user),
                    'true',
                ]));
                return;
            } catch (error) {
                if (!(error instanceof SshTransportError)) {
                    throw error;
                }
                if (this.target.sshAuthentication === 'password') {
                    throw new Error(
                        `SSH transport or authentication failed for ${this.target.sshHost}.`,
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
            if (
                error instanceof ProcessExecutionError &&
                error.exitCode === 255
            ) {
                const transportError = new SshTransportError(
                    `SSH transport or authentication failed for ${this.target.sshHost}.`,
                );
                transportError.name = 'SshTransportError';
                throw transportError;
            }
            if (command === 'ssh' && error instanceof ProcessExecutionError) {
                throw new RemoteCommandError(error.exitCode);
            }
            throw error;
        }
    }

    private destination(user = this.target.sshUser): string {
        return `${user}@${this.target.sshHost}`;
    }
}
