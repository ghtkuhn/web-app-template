import type { ComponentName, ExistingLxcTarget } from './interfaces.ts';
import { ProcessRunner } from './process.runner.ts';
import {
    DeploymentProjectConfigRepository,
} from './project-config.repository.ts';
import { SshReleaseDriver } from './ssh.release-driver.ts';

/** Operates releases inside a pre-existing, explicitly bootstrapped LXC. */
export class ExistingLxcDeploymentDriver {
    private readonly releases: SshReleaseDriver;

    public constructor(
        target: ExistingLxcTarget,
        processes = new ProcessRunner(),
        environment: NodeJS.ProcessEnv = process.env,
        projectRoot = process.cwd(),
    ) {
        const { sshUser } = new DeploymentProjectConfigRepository(
            projectRoot,
        ).load();
        this.releases = new SshReleaseDriver(
            { ...target, sshUser },
            'managed',
            processes,
            environment,
            projectRoot,
        );
    }

    public deploy(
        component: ComponentName,
        archive: string,
        release: string,
        configuration: string,
    ): Promise<void> {
        return this.releases.deploy(component, archive, release, configuration);
    }

    public stop(component: ComponentName): Promise<void> {
        return this.releases.stop(component);
    }

    public rollback(component: ComponentName, release?: string): Promise<void> {
        return this.releases.rollback(component, release);
    }

    public status(component: ComponentName): Promise<string> {
        return this.releases.status(component);
    }

    public databaseList(): Promise<string> {
        return this.releases.databaseList();
    }

    public databaseRestore(backupId: string): Promise<string> {
        return this.releases.databaseRestore(backupId);
    }

    public bootstrap(nodeVersion: string): Promise<void> {
        return this.releases.bootstrap(nodeVersion);
    }

    public infrastructureStatus(): Promise<string> {
        return this.releases.infrastructureStatus();
    }

    public infrastructureUpgrade(nodeVersion: string): Promise<void> {
        return this.releases.infrastructureUpgrade(nodeVersion);
    }
}
