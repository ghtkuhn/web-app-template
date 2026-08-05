import type { ModuleToolWriter } from './interfaces.ts';
import { ModuleInspector } from './module.inspector.ts';
import { ModuleVerifier } from './module.verifier.ts';
import { ModuleManifestManager } from './module-manifest.manager.ts';

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
            return this.execute(
                arguments_[0],
                arguments_[1] ?? '',
                arguments_[2],
            );
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
        if (this.isValidCommand(arguments_)) {
            return null;
        }
        this.stderr.write(this.help());
        return 1;
    }

    /** Dispatches one validated command. */
    private execute(
        command: string,
        moduleName: string,
        provider?: string,
    ): number {
        if (command === 'status') {
            return this.status(moduleName);
        }
        if (command === 'verify') {
            return this.verify(moduleName);
        }
        if (command === 'sync') {
            return this.sync(moduleName);
        }
        if (command === 'dependency' && provider) {
            return this.dependency(moduleName, provider);
        }
        return this.check();
    }

    /** Validates supported command arity. */
    private isValidCommand(arguments_: readonly string[]): boolean {
        return (
            (arguments_.length === 2 &&
                ['status', 'verify', 'sync'].includes(arguments_[0])) ||
            (arguments_.length === 1 && arguments_[0] === 'check') ||
            (arguments_.length === 3 && arguments_[0] === 'dependency')
        );
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

    /** Synchronizes one module's generated definition fields. */
    private sync(moduleName: string): number {
        const changed = new ModuleManifestManager(this.projectRoot).sync(moduleName);
        this.stdout.write(
            changed
                ? `Synchronized module '${moduleName}'.\n`
                : `Module '${moduleName}' is already synchronized.\n`,
        );
        return 0;
    }

    /** Reports generated module drift without changing files. */
    private check(): number {
        const stale = new ModuleManifestManager(this.projectRoot).check();
        if (stale.length === 0) {
            this.stdout.write('Generated module mechanics are current.\n');
            return 0;
        }
        this.stderr.write(
            `Generated module drift: ${stale.join(', ')}. Run module:sync.\n`,
        );
        return 1;
    }

    /** Adds one declarative module dependency and synchronizes its definition. */
    private dependency(consumer: string, provider: string): number {
        const changed = new ModuleManifestManager(this.projectRoot)
            .addDependency(consumer, provider);
        this.stdout.write(
            changed
                ? `Added dependency '${provider}' to '${consumer}'.\n`
                : `Dependency '${provider}' is already declared by '${consumer}'.\n`,
        );
        return 0;
    }

    /** Documents both public command forms. */
    private help(): string {
        return [
            'Usage:',
            '  npm run module:status -- <module>',
            '  npm run verify:module -- <module>',
            '  npm run module:sync -- <module>',
            '  npm run module:dependency -- <consumer> <provider>',
            '  npm run check:modules',
            '',
        ].join('\n');
    }
}
