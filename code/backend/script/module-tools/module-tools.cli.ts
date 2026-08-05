import type { ModuleToolWriter } from './interfaces.ts';
import { ModuleInspector } from './module.inspector.ts';
import { ModuleVerifier } from './module.verifier.ts';

/** CLI for compact module status and verification commands. */
export class ModuleToolsCli {
    private readonly projectRoot: string;
    private readonly stdout: ModuleToolWriter;
    private readonly stderr: ModuleToolWriter;

    /** Creates a CLI with replaceable streams. */
    constructor(
        projectRoot: string,
        stdout: ModuleToolWriter = process.stdout,
        stderr: ModuleToolWriter = process.stderr,
    ) {
        this.projectRoot = projectRoot;
        this.stdout = stdout;
        this.stderr = stderr;
    }

    /** Runs status or verify and returns a stable exit code. */
    public run(arguments_: readonly string[]): number {
        const validation = this.validate(arguments_);
        if (validation !== null) {
            return validation;
        }
        try {
            return this.execute(arguments_[0], arguments_[1]);
        } catch (error: unknown) {
            this.stderr.write(
                `${error instanceof Error ? error.message : 'Unknown module-tool failure'}\n`,
            );
            return 1;
        }
    }

    /** Handles help and rejects unsupported command shapes. */
    private validate(arguments_: readonly string[]): number | null {
        if (arguments_.length === 1 && arguments_[0] === '--help') {
            this.stdout.write(this.help());
            return 0;
        }
        if (
            arguments_.length === 2 &&
            ['status', 'verify'].includes(arguments_[0])
        ) {
            return null;
        }
        this.stderr.write(this.help());
        return 1;
    }

    /** Dispatches one validated command. */
    private execute(command: string, moduleName: string): number {
        return command === 'status'
            ? this.status(moduleName)
            : this.verify(moduleName);
    }

    /** Prints one compact module status. */
    private status(moduleName: string): number {
        const status = new ModuleInspector(this.projectRoot).inspect(moduleName);
        this.stdout.write(
            `Module ${status.moduleName}: ${status.state}. ${status.message}\n`,
        );
        return status.state === 'blocked' ? 1 : 0;
    }

    /** Runs and summarizes focused verification. */
    private verify(moduleName: string): number {
        const exitCode = new ModuleVerifier(this.projectRoot).verify(moduleName);
        if (exitCode === 0) {
            this.stdout.write(`Module '${moduleName}' verification passed.\n`);
        }
        return exitCode;
    }

    /** Documents both public command forms. */
    private help(): string {
        return [
            'Usage:',
            '  npm run module:status -- <module>',
            '  npm run verify:module -- <module>',
            '',
        ].join('\n');
    }
}
