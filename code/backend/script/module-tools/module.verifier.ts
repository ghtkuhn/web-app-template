import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import type {
    ModuleCommandResult,
    ModuleCommandRunner,
} from './interfaces.ts';
import { ModuleInspector } from './module.inspector.ts';

/** Native synchronous command runner. */
class NativeModuleCommandRunner implements ModuleCommandRunner {
    /** Executes one command with inherited output. */
    public run(
        command: string,
        arguments_: readonly string[],
        cwd: string,
    ): ModuleCommandResult {
        return spawnSync(command, [...arguments_], {
            cwd,
            stdio: 'inherit',
        });
    }
}

/** Runs the smallest reliable verification sequence for one module. */
export class ModuleVerifier {
    private readonly projectRoot: string;
    private readonly runner: ModuleCommandRunner;

    /** Creates a focused verifier with an injectable process boundary. */
    constructor(
        projectRoot: string,
        runner: ModuleCommandRunner = new NativeModuleCommandRunner(),
    ) {
        this.projectRoot = path.resolve(projectRoot);
        this.runner = runner;
    }

    /** Verifies one existing module and returns a stable exit code. */
    public verify(moduleName: string): number {
        const status = new ModuleInspector(this.projectRoot).inspect(moduleName);
        if (status.state === 'blocked') {
            throw new Error(status.message);
        }
        return this.runCommands(this.commands(moduleName));
    }

    /** Builds the deterministic focused command sequence. */
    private commands(moduleName: string): Array<readonly [string, readonly string[]]> {
        const commands: Array<readonly [string, readonly string[]]> = [
            ['npm', ['run', 'typecheck']],
            ['npm', ['run', 'lint:architecture']],
            ['npm', ['run', 'lint:openapi']],
        ];
        const tests = this.moduleTests(moduleName);
        if (tests.length > 0) {
            commands.push([process.execPath, ['--test', ...tests]]);
        }
        return commands;
    }

    /** Runs focused commands until one fails. */
    private runCommands(
        commands: readonly (readonly [string, readonly string[]])[],
    ): number {
        const backendRoot = path.join(this.projectRoot, 'code/backend');
        for (const [command, arguments_] of commands) {
            const result = this.runner.run(command, arguments_, backendRoot);
            if (result.error) {
                throw result.error;
            }
            if (result.status !== 0) {
                return result.status ?? 2;
            }
        }
        return 0;
    }

    /** Returns direct local test paths relative to the backend workspace. */
    private moduleTests(moduleName: string): string[] {
        const relativeDirectory = `src/module/${moduleName}/test`;
        const directory = path.join(
            this.projectRoot,
            'code/backend',
            relativeDirectory,
        );
        try {
            return fs
                .readdirSync(directory)
                .filter((file: string) => file.endsWith('.test.ts'))
                .sort()
                .map((file: string) => `${relativeDirectory}/${file}`);
        } catch {
            return [];
        }
    }
}
