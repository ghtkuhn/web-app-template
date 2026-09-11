import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { commandHelp } from '../commands/catalog.ts';

export interface TestProcessResult { readonly status: number | null; readonly error?: Error; }
export type TestExecutor = (command: string, args: readonly string[], cwd: string) => TestProcessResult;

/** Selects tests explicitly; invalid selection never falls back to the full suite. */
export class TestRunner {
    private readonly root: string;
    private readonly execute: TestExecutor;
    private readonly write: (text: string) => void;
    constructor(
        root: string,
        execute: TestExecutor = (command, args, cwd) =>
            spawnSync(command, [...args], { cwd, stdio: 'inherit' }),
        write: (text: string) => void = (text) => { process.stdout.write(text); },
    ) { this.root = root; this.execute = execute; this.write = write; }

    public async run(args: readonly string[]): Promise<number> {
        if (args.length === 1 && args[0] === '--help') {
            this.write(commandHelp(['test']));
            return 0;
        }
        if (args.length === 0) return this.start('npm', ['test', '--workspaces', '--if-present'], this.root);
        if (args.length !== 2 || !['--module', '--file'].includes(args[0]) || args[1].startsWith('-')) {
            throw new Error(`Expected one test selector.\n${commandHelp(['test'])}`);
        }
        if (args[0] === '--module') return this.module(args[1]);
        return this.file(args[1]);
    }

    private async module(name: string): Promise<number> {
        if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(name)) throw new Error(`Invalid module '${name}'.`);
        const prefix = `code/backend/src/module/${name}`;
        this.regular(`${prefix}/index.ts`);
        const directory = path.join(this.root, prefix, 'test');
        let entries: string[] = [];
        try {
            this.regular(`${prefix}/test`, true);
            entries = fs.readdirSync(directory).filter((file) => file.endsWith('.test.ts')).sort();
        } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
        const selected = entries.map((file) => `${prefix}/test/${file}`);
        for (const file of selected) this.regular(file);
        if (selected.length === 0) {
            this.write(`No direct module tests exist for '${name}'; no tests were run.\n`);
            return 0;
        }
        const catalog = await this.catalog();
        for (const file of selected) this.inCatalog(file, catalog);
        return this.backend(selected);
    }

    private async file(relative: string): Promise<number> {
        this.regular(relative);
        if (relative.startsWith('code/backend/') && relative.endsWith('.test.ts')) {
            this.inCatalog(relative, await this.catalog());
            return this.backend([relative]);
        }
        if (/^code\/frontend\/web\/test\/.+\.test\.ts$/u.test(relative)) {
            // Vitest positional filters are substring matches. Reject ambiguous selections.
            const frontend = path.join(this.root, 'code/frontend/web');
            const file = relative.slice('code/frontend/web/'.length);
            const matches = fs.readdirSync(path.join(frontend, 'test'), { recursive: true })
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => `test/${entry.replaceAll(path.sep, '/')}`)
                .filter((entry) => entry.endsWith('.test.ts') && entry.includes(file));
            if (matches.length !== 1 || matches[0] !== file) throw new Error(`Ambiguous Vitest file selector '${relative}'.`);
            return this.start('npm', ['test', '--', '--run', file], frontend);
        }
        throw new Error(`Not a supported unit/integration test file: '${relative}'. Browser/PWA tests use their separate workspace scripts.`);
    }

    private async catalog(): Promise<readonly string[]> {
        const file = this.regular('code/backend/test.catalog.ts');
        const { BACKEND_TEST_FILES } = await import(pathToFileURL(file).href);
        if (!Array.isArray(BACKEND_TEST_FILES) || !BACKEND_TEST_FILES.every((item) => typeof item === 'string')) {
            throw new Error('Invalid backend test catalog.');
        }
        return BACKEND_TEST_FILES;
    }

    private inCatalog(file: string, catalog: readonly string[]): void {
        if (!catalog.includes(file.slice('code/backend/'.length))) {
            throw new Error(`Test '${file}' is not in the backend catalog. Run npm run generate:test-catalog.`);
        }
    }

    private backend(files: readonly string[]): number {
        const backend = path.join(this.root, 'code/backend');
        const check = this.start('npm', ['run', 'check:test-catalog'], backend);
        if (check !== 0) return check;
        return this.start(process.execPath, ['--test', '--test-concurrency=1',
            ...files.map((file) => file.slice('code/backend/'.length))], backend);
    }

    /** Reject traversal, noncanonical paths, symlinks in any path segment, and special files. */
    private regular(relative: string, directory = false): string {
        if (path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some((part) => !part || part === '.' || part === '..')) {
            throw new Error(`Expected a repository-relative path, received '${relative}'.`);
        }
        let current = this.root;
        const parts = relative.split('/');
        for (const [index, part] of parts.entries()) {
            current = path.join(current, part);
            const status = fs.lstatSync(current);
            if (status.isSymbolicLink() || (index < parts.length - 1 || directory ? !status.isDirectory() : !status.isFile())) {
                throw new Error(`Test selection requires regular, symlink-free paths: '${relative}'.`);
            }
        }
        return current;
    }

    private start(command: string, args: readonly string[], cwd: string): number {
        const result = this.execute(command, args, cwd);
        if (result.error) throw result.error;
        return result.status ?? 2;
    }
}
