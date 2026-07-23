import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
    ComponentName,
    ComponentSelection,
    DeploymentProfile,
    DeploymentTarget,
} from './interfaces.ts';
import { DeploymentProfileRepository } from './profile.repository.ts';
import { DockerDeploymentDriver } from './docker.driver.ts';
import { ProxmoxLxcDeploymentDriver } from './proxmox.driver.ts';
import { ReleaseBuilder } from './release.builder.ts';
import { DeploymentConfigRenderer } from './config.renderer.ts';

/** Coordinates profile validation and the selected deployment drivers. */
export class DeploymentCli {
    private readonly root = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../..',
    );
    private readonly profiles = new DeploymentProfileRepository(this.root);
    private readonly docker = new DockerDeploymentDriver(this.root);
    private readonly releases = new ReleaseBuilder(this.root);
    private readonly configurations = new DeploymentConfigRenderer();

    public async run(arguments_: readonly string[]): Promise<number> {
        try {
            const [command = 'validate', ...rest] = arguments_;
            if (command === 'scaffold') {
                return this.scaffold(rest);
            }
            if (command === 'validate' && rest.includes('--all')) {
                const profiles = this.profiles.loadAll();
                process.stdout.write(
                    `${profiles.length} deployment profile(s) are valid.\n`,
                );
                return 0;
            }
            const profileName = this.positional(rest, 0) ?? 'local';
            const selection = command.startsWith('database:')
                ? 'backend'
                : this.selection(this.positional(rest, 1));
            const profile = this.profiles.load(profileName);
            if (command === 'deploy') {
                this.assertSecrets(profile);
            }
            if (command === 'validate') {
                process.stdout.write(`Deployment profile '${profile.name}' is valid.\n`);
            } else if (command === 'build') {
                await this.each(profile, selection, async (component, target) => {
                    if (target.driver === 'docker') {
                        this.docker.build(component, target);
                    } else {
                        this.releases.build(component);
                    }
                });
            } else if (command === 'deploy') {
                await this.deploy(profile, selection);
            } else if (command === 'status') {
                await this.status(profile, selection);
            } else if (command === 'stop') {
                await this.stop(profile, selection);
            } else if (command === 'rollback') {
                await this.rollback(
                    profile,
                    selection,
                    this.positional(rest, 2),
                );
            } else if (command === 'database:list') {
                await this.databaseList(profile, selection);
            } else if (command === 'database:restore') {
                await this.databaseRestore(
                    profile,
                    selection,
                    this.positional(rest, 1),
                );
            } else {
                throw new Error(`Unknown deployment command '${command}'.`);
            }
            return 0;
        } catch (error) {
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 1;
        }
    }

    private async rollback(
        profile: DeploymentProfile,
        selection: ComponentSelection,
        release?: string,
    ): Promise<void> {
        if (selection === 'all') {
            throw new Error('Rollback requires backend or frontend.');
        }
        const component = profile[selection];
        if (!component.enabled) {
            throw new Error(`${selection} is disabled.`);
        }
        if (component.target.driver !== 'proxmox-lxc') {
            throw new Error('Explicit rollback is available for Proxmox LXC.');
        }
        new ProxmoxLxcDeploymentDriver(component.target).rollback(
            selection,
            release,
        );
    }

    private scaffold(arguments_: readonly string[]): number {
        const name = this.positional(arguments_, 0);
        if (!name) {
            throw new Error('A deployment profile name is required.');
        }
        const source = this.option(arguments_, '--from') ?? 'local';
        const backend = this.option(arguments_, '--backend-driver');
        const frontend = this.option(arguments_, '--frontend-driver');
        const target = this.profiles.scaffold(
            name,
            source,
            backend,
            frontend,
        );
        process.stdout.write(`Created ${path.relative(this.root, target)}.\n`);
        return 0;
    }

    private async deploy(
        profile: DeploymentProfile,
        selection: ComponentSelection,
    ): Promise<void> {
        const dockerComponents: ComponentName[] = [];
        const deploymentRelease = new Date()
            .toISOString()
            .replace(/[-:.TZ]/g, '');
        await this.each(profile, selection, async (component, target) => {
            if (target.driver === 'docker') {
                this.docker.build(component, target);
                dockerComponents.push(component);
                return;
            }
            const driver = new ProxmoxLxcDeploymentDriver(target);
            await driver.provision();
            const release = this.releases.build(component);
            const configuration = this.configurations.render(
                profile,
                component,
                process.env,
                release.release,
            );
            try {
                await driver.deploy(
                    component,
                    release.archive,
                    release.release,
                    configuration,
                );
            } finally {
                fs.rmSync(path.dirname(configuration), {
                    recursive: true,
                    force: true,
                });
                fs.rmSync(path.dirname(release.archive), {
                    recursive: true,
                    force: true,
                });
            }
        });
        if (dockerComponents.length > 0) {
            this.docker.deploy(
                profile,
                dockerComponents,
                deploymentRelease,
            );
        }
    }

    private async databaseList(
        profile: DeploymentProfile,
        selection: ComponentSelection,
    ): Promise<void> {
        const backend = this.databaseBackend(profile, selection);
        const output = backend.target.driver === 'docker'
            ? this.docker.databaseList(profile)
            : await this.proxmoxDatabase(backend.target, 'list');
        process.stdout.write(`${output}${output ? '\n' : ''}`);
    }

    private async databaseRestore(
        profile: DeploymentProfile,
        selection: ComponentSelection,
        backupId?: string,
    ): Promise<void> {
        if (!backupId || backupId === 'latest') {
            throw new Error('An explicit database backup identifier is required.');
        }
        const backend = this.databaseBackend(profile, selection);
        const output = backend.target.driver === 'docker'
            ? this.docker.databaseRestore(profile, backupId)
            : await this.proxmoxDatabase(
                  backend.target,
                  'restore',
                  backupId,
              );
        process.stdout.write(`${output}${output ? '\n' : ''}`);
    }

    private databaseBackend(
        profile: DeploymentProfile,
        selection: ComponentSelection,
    ): Extract<DeploymentProfile['backend'], { enabled: true }> {
        if (selection === 'frontend') {
            throw new Error('Database commands apply only to the backend.');
        }
        if (!profile.backend.enabled) {
            throw new Error('Backend is disabled.');
        }
        return profile.backend;
    }

    private async proxmoxDatabase(
        target: Extract<DeploymentTarget, { driver: 'proxmox-lxc' }>,
        command: 'list' | 'restore',
        backupId?: string,
    ): Promise<string> {
        const driver = new ProxmoxLxcDeploymentDriver(target);
        await driver.start();
        return command === 'list'
            ? driver.databaseList()
            : driver.databaseRestore(backupId ?? '');
    }

    private async status(
        profile: DeploymentProfile,
        selection: ComponentSelection,
    ): Promise<void> {
        const dockerComponents: ComponentName[] = [];
        await this.each(profile, selection, async (component, target) => {
            if (target.driver === 'docker') {
                dockerComponents.push(component);
                return;
            }
            const status = await new ProxmoxLxcDeploymentDriver(target).status();
            process.stdout.write(`${component}: ${status}\n`);
        });
        if (dockerComponents.length > 0) {
            process.stdout.write(
                `${this.docker.status(profile, dockerComponents)}\n`,
            );
        }
    }

    private async stop(
        profile: DeploymentProfile,
        selection: ComponentSelection,
    ): Promise<void> {
        const dockerComponents: ComponentName[] = [];
        await this.each(profile, selection, async (component, target) => {
            if (target.driver === 'docker') {
                dockerComponents.push(component);
            } else {
                await new ProxmoxLxcDeploymentDriver(target).stop(component);
            }
        });
        if (dockerComponents.length > 0) {
            this.docker.stop(profile, dockerComponents);
        }
    }

    private async each(
        profile: DeploymentProfile,
        selection: ComponentSelection,
        operation: (
            component: ComponentName,
            target: DeploymentTarget,
        ) => Promise<void>,
    ): Promise<void> {
        for (const component of ['backend', 'frontend'] as const) {
            const selected = profile[component];
            if (
                selected.enabled &&
                (selection === 'all' || selection === component)
            ) {
                await operation(component, selected.target);
            }
        }
    }

    private assertSecrets(profile: DeploymentProfile): void {
        const missing = profile.requiredSecrets.filter(
            (name) => !process.env[name],
        );
        if (missing.length > 0) {
            throw new Error(`Missing deployment secrets: ${missing.join(', ')}.`);
        }
    }

    private selection(value: string | undefined): ComponentSelection {
        const selection = value ?? 'all';
        if (!['backend', 'frontend', 'all'].includes(selection)) {
            throw new Error(`Unknown component '${selection}'.`);
        }
        return selection as ComponentSelection;
    }

    private positional(
        arguments_: readonly string[],
        index: number,
    ): string | undefined {
        return arguments_.filter((value, position) =>
            position === 0 || !arguments_[position - 1].startsWith('--'),
        ).filter((value) => !value.startsWith('--'))[index];
    }

    private option(
        arguments_: readonly string[],
        name: string,
    ): string | undefined {
        const index = arguments_.indexOf(name);
        return index >= 0 ? arguments_[index + 1] : undefined;
    }
}

process.exitCode = await new DeploymentCli().run(process.argv.slice(2));
