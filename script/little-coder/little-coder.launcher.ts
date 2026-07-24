import path from 'node:path';
import type { SpawnOptions } from 'node:child_process';

/** Complete launch request for the Little Coder child process. */
export interface LittleCoderLaunch {
    readonly command: string;
    readonly arguments: readonly string[];
    readonly options: SpawnOptions;
}

/** Builds a clean, project-guarded Little Coder child-process request. */
export class LittleCoderLauncher {
    private readonly projectRoot: string;

    /** Creates a launcher bound to the repository root. */
    public constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /** Builds the executable, arguments, and sanitized process options. */
    public createLaunch(
        arguments_: readonly string[],
        environment: NodeJS.ProcessEnv,
    ): LittleCoderLaunch {
        return {
            command: 'little-coder',
            arguments: [
                '--extension',
                path.join(
                    this.projectRoot,
                    'little-coder/extensions/backend-base-guard/index.ts',
                ),
                ...arguments_,
            ],
            options: {
                cwd: this.projectRoot,
                env: this.sanitizeEnvironment(environment),
                stdio: 'inherit',
            },
        };
    }

    /** Removes npm's accidental interpretation of Little Coder session flags. */
    private sanitizeEnvironment(
        environment: NodeJS.ProcessEnv,
    ): NodeJS.ProcessEnv {
        const sanitized = { ...environment };
        delete sanitized.npm_config_session;
        delete sanitized.NPM_CONFIG_SESSION;
        return sanitized;
    }
}
