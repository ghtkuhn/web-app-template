import fs from 'node:fs';
import path from 'node:path';

/** Provides deterministic recursive TypeScript source discovery. */
export class FileScanner {
    /** Returns whether a directory exists at the exact path. */
    public directoryExists(directory: string): boolean {
        return (
            fs.existsSync(directory) &&
            fs.statSync(directory).isDirectory()
        );
    }

    /** Returns all TypeScript files below a directory in lexical order. */
    public listTypeScriptFiles(directory: string): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }

        const files: string[] = [];
        this.collect(directory, files);
        return files.sort((left, right) => left.localeCompare(right));
    }

    /** Returns every file below a directory in lexical order. */
    public listFiles(directory: string): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }

        const files: string[] = [];
        this.collect(directory, files, false);
        return files.sort((left, right) => left.localeCompare(right));
    }

    /** Returns all files located directly in a directory. */
    public listDirectFiles(directory: string): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs
            .readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.join(directory, entry.name))
            .sort((left, right) => left.localeCompare(right));
    }

    /** Returns all directories located directly below a directory. */
    // fallow-ignore-next-line code-duplication -- File and directory queries deliberately expose symmetric APIs.
    public listDirectDirectories(directory: string): string[] {
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs
            .readdirSync(directory, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(directory, entry.name))
            .sort((left, right) => left.localeCompare(right));
    }

    /** Returns whether a directory has no entries. */
    public isEmptyDirectory(directory: string): boolean {
        return fs.existsSync(directory) && fs.readdirSync(directory).length === 0;
    }

    /** Recursively collects TypeScript files. */
    private collect(
        directory: string,
        files: string[],
        typeScriptOnly = true,
    ): void {
        const entries = fs
            .readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));

        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                this.collect(entryPath, files, typeScriptOnly);
            } else if (
                entry.isFile() &&
                (!typeScriptOnly || entry.name.endsWith('.ts'))
            ) {
                files.push(entryPath);
            }
        }
    }
}
