import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Result returned by an injected backend test process. */
interface BackendTestProcessResult {
    readonly error?: Error;
    readonly status: number | null;
}

/** Starts a validated list of backend tests through Node's native runner. */
export class BackendTestRunner {
    private readonly backendRoot: string;
    private readonly testFiles: readonly string[];
    private readonly execute: (
        command: string,
        arguments_: readonly string[],
        cwd: string,
    ) => BackendTestProcessResult;

    /** Creates a central runner with an injectable process boundary. */
    constructor(
        backendRoot: string,
        testFiles: readonly string[],
        execute = BackendTestRunner.execute,
    ) {
        this.backendRoot = path.resolve(backendRoot);
        this.testFiles = testFiles;
        this.execute = execute;
    }

    /** Validates the catalog and returns the Node test-process exit code. */
    public run(): number {
        const files = this.validatedFiles();
        const result = this.execute(
            process.execPath,
            ['--test', ...files],
            this.backendRoot,
        );
        if (result.error) {
            throw result.error;
        }
        return result.status ?? 2;
    }

    /** Validates every catalog entry and preserves its catalog order. */
    private validatedFiles(): string[] {
        if (new Set(this.testFiles).size !== this.testFiles.length) {
            throw new Error('Backend test catalog contains duplicate entries.');
        }
        return this.testFiles.map((file) => this.validateFile(file));
    }

    /** Validates one normalized, existing backend test file. */
    private validateFile(file: string): string {
        if (this.isUnsafePath(file)) {
            throw new Error(`Unsafe backend test catalog entry '${file}'.`);
        }
        const absolutePath = path.resolve(this.backendRoot, file);
        if (!this.isExistingFile(absolutePath)) {
            throw new Error(`Missing backend test catalog entry '${file}'.`);
        }
        return file;
    }

    /** Returns whether an entry can escape or violate the test contract. */
    private isUnsafePath(file: string): boolean {
        return (
            path.isAbsolute(file) ||
            file.split('/').includes('..') ||
            !file.endsWith('.test.ts')
        );
    }

    /** Returns whether a resolved entry is a regular backend-owned file. */
    private isExistingFile(absolutePath: string): boolean {
        return (
            absolutePath.startsWith(`${this.backendRoot}${path.sep}`) &&
            fs.existsSync(absolutePath) &&
            fs.statSync(absolutePath).isFile()
        );
    }

    /** Executes Node with inherited output for the production CLI. */
    private static execute(
        command: string,
        arguments_: readonly string[],
        cwd: string,
    ): BackendTestProcessResult {
        return spawnSync(command, [...arguments_], {
            cwd,
            stdio: 'inherit',
        });
    }
}
