import type { ScaffoldWriter } from '../scaffold-module/interfaces.ts';
import { TestCatalogManager } from './test-catalog.manager.ts';

/** Non-interactive CLI for backend test-catalog generation and checking. */
export class TestCatalogCli {
    private readonly manager: TestCatalogManager;
    private readonly stdout: ScaffoldWriter;
    private readonly stderr: ScaffoldWriter;

    /** Creates one CLI with injectable streams for deterministic tests. */
    constructor(
        backendRoot: string,
        stdout: ScaffoldWriter = process.stdout,
        stderr: ScaffoldWriter = process.stderr,
    ) {
        this.manager = new TestCatalogManager(backendRoot);
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Runs `generate` or `check` and returns a stable exit code. */
    public run(arguments_: readonly string[]): number {
        try {
            if (arguments_.length !== 1) {
                throw new Error(this.help());
            }
            return this.runCommand(arguments_[0]);
        } catch (error: unknown) {
            this.stderr.write(
                `${error instanceof Error ? error.message : 'Unknown test-catalog failure'}\n`,
            );
            return 1;
        }
    }

    /** Executes one supported catalog command. */
    private runCommand(command: string): number {
        if (command === 'generate') {
            const count = this.manager.generate();
            this.stdout.write(`Generated backend test catalog (${count} files).\n`);
            return 0;
        }
        if (command === 'check') {
            const count = this.manager.check();
            this.stdout.write(`Backend test catalog is current (${count} files).\n`);
            return 0;
        }
        throw new Error(this.help());
    }

    /** Returns concise command documentation. */
    private help(): string {
        return 'Usage: node script/test-catalog.ts <generate|check>';
    }
}
