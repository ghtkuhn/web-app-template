import fs from 'node:fs';
import type { ScaffoldStorage } from './interfaces.ts';

/** Applies the narrow, validated file mutations used by the scaffolder. */
export class NativeScaffoldStorage implements ScaffoldStorage {
    /** Creates one previously validated module directory. */
    public createDirectory(directory: string): void {
        fs.mkdirSync(directory);
    }

    /** Writes one complete UTF-8 source file. */
    public writeFile(filePath: string, source: string): void {
        fs.writeFileSync(filePath, source, 'utf8');
    }

    /** Removes one validated generated module directory. */
    public removeDirectory(directory: string): void {
        fs.rmSync(directory, { recursive: true, force: true });
    }

    /** Removes one newly created directory only while it remains empty. */
    public removeEmptyDirectory(directory: string): void {
        fs.rmdirSync(directory);
    }

    /** Removes one validated generated file. */
    public removeFile(filePath: string): void {
        fs.rmSync(filePath, { force: true });
    }
}
