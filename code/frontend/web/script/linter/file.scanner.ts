import fs from 'node:fs';
import path from 'node:path';

/** Recursively discovers frontend source files in deterministic order. */
export class FileScanner {
    /** Lists TypeScript, Vue, and CSS files below one source root. */
    public list(sourceRoot: string): string[] {
        const files: string[] = [];
        this.collect(sourceRoot, files);
        return files.sort((left, right) => left.localeCompare(right));
    }

    private collect(directory: string, files: string[]): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                this.collect(entryPath, files);
            } else if (
                entry.isFile() &&
                ['.ts', '.vue', '.css'].includes(path.extname(entry.name))
            ) {
                files.push(entryPath);
            }
        }
    }
}
