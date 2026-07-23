import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Creates and removes an isolated backend source tree for linter tests. */
export class FixtureProject {
    public readonly root: string;

    /** Creates an empty temporary project root. */
    constructor() {
        this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-linter-'));
    }

    /** Creates a fixture directory relative to the project root. */
    public mkdir(relativePath: string): string {
        const directoryPath = path.join(this.root, relativePath);
        fs.mkdirSync(directoryPath, { recursive: true });
        return directoryPath;
    }

    /** Writes a UTF-8 fixture file relative to the project root. */
    public write(relativePath: string, source: string): string {
        const filePath = path.join(this.root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
        return filePath;
    }

    /** Removes the complete fixture tree. */
    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}
