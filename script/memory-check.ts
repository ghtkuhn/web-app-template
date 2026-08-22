import { MemorySizeChecker } from './memory-check/memory-size.checker.ts';

/** Command-line entry point for the repository Memory size gate. */
class MemoryCheckCli {
    /** Runs the check and returns a stable process exit code. */
    public run(projectRoot: string): number {
        try {
            const bytes = new MemorySizeChecker().check(projectRoot);
            if (bytes === null) {
                process.stdout.write(
                    'Memory is not initialized; size check skipped.\n',
                );
                return 0;
            }
            process.stdout.write(
                `Memory size valid (${bytes}/25600 bytes).\n`,
            );
            return 0;
        } catch (error: unknown) {
            process.stderr.write(
                `${error instanceof Error ? error.message : String(error)}\n`,
            );
            return 1;
        }
    }
}

process.exitCode = new MemoryCheckCli().run(process.cwd());
