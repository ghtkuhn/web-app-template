import fs from 'node:fs';
import path from 'node:path';

/** Provides deterministic recursive TypeScript source discovery. */
export class FileScanner {
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
