import fs from 'node:fs';
import path from 'node:path';

/** Discovers global and module-local backend tests deterministically. */
export class BackendTestDiscovery {
    private readonly backendRoot: string;

    /** Creates a test discovery rooted at one backend workspace. */
    constructor(backendRoot: string) {
        this.backendRoot = path.resolve(backendRoot);
    }

    /** Returns every supported test path relative to the backend root. */
    public discover(): string[] {
        const files = [
            ...this.collect(path.join(this.backendRoot, 'test'), true),
            ...this.moduleTests(),
        ];
        return [...new Set(files)]
            .map((file) => this.relative(file))
            .sort((left, right) => left.localeCompare(right));
    }

    /** Returns direct tests from every module-local test directory. */
    private moduleTests(): string[] {
        const moduleRoot = path.join(this.backendRoot, 'src/module');
        if (!fs.existsSync(moduleRoot)) {
            return [];
        }
        return fs
            .readdirSync(moduleRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .flatMap((entry) =>
                this.collect(
                    path.join(moduleRoot, entry.name, 'test'),
                    false,
                ),
            );
    }

    /** Collects supported test files, optionally descending recursively. */
    private collect(directory: string, recursive: boolean): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }
        const files: string[] = [];
        for (const entry of fs
            .readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            files.push(...this.collectEntry(directory, entry, recursive));
        }
        return files;
    }

    /** Converts one directory entry into zero or more discovered tests. */
    private collectEntry(
        directory: string,
        entry: fs.Dirent,
        recursive: boolean,
    ): string[] {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            return this.collectDirectory(entryPath, recursive);
        }
        return this.collectFile(entryPath, entry);
    }

    /** Recurses into an allowed global-test subdirectory. */
    private collectDirectory(
        directory: string,
        recursive: boolean,
    ): string[] {
        return recursive ? this.collect(directory, true) : [];
    }

    /** Returns one entry only when it is a supported test file. */
    private collectFile(filePath: string, entry: fs.Dirent): string[] {
        return entry.isFile() && entry.name.endsWith('.test.ts')
            ? [filePath]
            : [];
    }

    /** Normalizes one backend-relative path for generated output. */
    private relative(filePath: string): string {
        return path
            .relative(this.backendRoot, filePath)
            .split(path.sep)
            .join('/');
    }
}
