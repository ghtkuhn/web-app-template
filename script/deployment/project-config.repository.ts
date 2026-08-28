import fs from 'node:fs';
import path from 'node:path';

export interface DeploymentProjectConfiguration {
    readonly sshUser: string;
}

/** Loads non-secret deployment ownership from the tracked project config. */
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
                    'project.json must exist and define deployment.sshUser.',
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
                'project.json must define deployment.sshUser.',
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
        return { sshUser };
    }

    private object(value: unknown): value is Record<string, unknown> {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }
}
