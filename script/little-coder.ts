import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LittleCoderLauncher } from './little-coder/little-coder.launcher.ts';

/** Starts Little Coder with project policy and a clean npm environment. */
class LittleCoderCli {
    /** Launches the interactive child process and mirrors its exit state. */
    public run(arguments_: readonly string[]): void {
        const launch = new LittleCoderLauncher(this.projectRoot()).createLaunch(
            arguments_,
            process.env,
        );
        const child = spawn(
            launch.command,
            [...launch.arguments],
            launch.options,
        );
        child.on('error', (error) => {
            process.stderr.write(
                `Unable to start Little Coder: ${error.message}\n`,
            );
            process.exitCode = 2;
        });
        child.on('exit', (code, signal) => {
            if (signal) {
                process.kill(process.pid, signal);
                return;
            }
            process.exitCode = code ?? 2;
        });
    }

    /** Resolves the repository root from this checked-in launcher. */
    private projectRoot(): string {
        return path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '..',
        );
    }
}

new LittleCoderCli().run(process.argv.slice(2));
