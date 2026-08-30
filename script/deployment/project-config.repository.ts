import fs from 'node:fs';
import path from 'node:path';
import {
    DEPLOYMENT_DRIVERS,
    type DeploymentDriver,
} from './interfaces.ts';

export interface DeploymentProjectConfiguration {
    readonly platform: DeploymentDriver;
    readonly sshUser: string;
}

/** Loads non-secret deployment defaults and ownership from project config. */
export class DeploymentProjectConfigRepository {
    private readonly filePath: string;

    public constructor(projectRoot: string) {
        this.filePath = path.join(projectRoot, 'project.json');
    }

    public load(): DeploymentProjectConfiguration {
        let status: fs.Stats;
        try {
            status = fs.lstatSync(this.filePath);
        } catch (error) {
            if (
                error instanceof Error &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                throw new Error(
                    'project.json must exist and define deployment.platform and deployment.sshUser.',
                );
            }
            throw error;
        }
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error('project.json must be a regular non-symlink file.');
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        } catch {
            throw new Error('project.json must contain valid JSON.');
        }
        if (!this.object(parsed) || !this.object(parsed.deployment)) {
            throw new Error(
                'project.json must define deployment.platform and deployment.sshUser.',
            );
        }
        const platform = parsed.deployment.platform;
        if (!this.deploymentDriver(platform)) {
            throw new Error(
                `project.json deployment.platform must be one of: ${DEPLOYMENT_DRIVERS.join(', ')}. 'local' is an environment and profile name, not a deployment driver.`,
            );
        }
        const sshUser = parsed.deployment.sshUser;
        if (
            typeof sshUser !== 'string' ||
            !/^[a-z_][a-z0-9_-]*$/u.test(sshUser) ||
            sshUser === 'root'
        ) {
            throw new Error(
                'project.json deployment.sshUser must be a non-root POSIX user name.',
            );
        }
        return { platform, sshUser };
    }

    private deploymentDriver(value: unknown): value is DeploymentDriver {
        return DEPLOYMENT_DRIVERS.some((driver) => driver === value);
    }

    private object(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }
}
