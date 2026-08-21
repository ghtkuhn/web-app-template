import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseType } from './interfaces.ts';

export interface MigrationSource {
    readonly checksum: string;
    readonly dialect: DatabaseType;
    readonly fileName: string;
    readonly name: string;
}

/** Reads and fingerprints the executable dialect-specific migration sources. */
export class MigrationCatalog {
    private readonly migrationRoot: string;

    public constructor(migrationRoot: string) {
        this.migrationRoot = path.resolve(migrationRoot);
    }

    /** Returns one ordered source catalog for a database dialect. */
    public sources(dialect: DatabaseType): MigrationSource[] {
        const directory = path.join(this.migrationRoot, dialect);
        if (!fs.existsSync(directory)) {
            return [];
        }
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter((entry) =>
                entry.isFile() && entry.name.endsWith('.migration.ts'),
            )
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => {
                const source = fs.readFileSync(path.join(directory, entry.name));
                return {
                    checksum: createHash('sha256').update(source).digest('hex'),
                    dialect,
                    fileName: entry.name,
                    name: entry.name.slice(0, -'.ts'.length),
                };
            });
    }
}
