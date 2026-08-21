import fs from 'node:fs';
import path from 'node:path';
import { MigrationCatalog } from '../../src/base/migration.catalog.ts';
import type { DatabaseType } from '../../src/base/interfaces.ts';

const DIALECTS: readonly DatabaseType[] = ['sqlite', 'postgres'];

/** Validates ordered dialect pairs and their checked-in source fingerprints. */
export class MigrationCatalogChecker {
    private readonly backendRoot: string;
    private readonly catalogPath: string;
    private readonly sourceCatalog: MigrationCatalog;

    public constructor(backendRoot: string) {
        this.backendRoot = path.resolve(backendRoot);
        this.catalogPath = path.join(this.backendRoot, 'migration.catalog.json');
        this.sourceCatalog = new MigrationCatalog(
            path.join(this.backendRoot, 'src/migration'),
        );
    }

    /** Replaces only the deterministic generated checksum catalog. */
    public generate(): void {
        fs.writeFileSync(this.catalogPath, this.render());
    }

    /** Checks parity, sequence, and checksums without changing files. */
    public check(): number {
        const rendered = this.render();
        if (!fs.existsSync(this.catalogPath) ||
            fs.readFileSync(this.catalogPath, 'utf8') !== rendered) {
            throw new Error(
                'Migration catalog or SHA-256 checksums are stale; run npm run generate:migrations.',
            );
        }
        return this.sourceCatalog.sources('sqlite').length;
    }

    private render(): string {
        const result = Object.fromEntries(
            DIALECTS.map((dialect) => [
                dialect,
                this.sourceCatalog.sources(dialect),
            ]),
        );
        const sqliteNames = result.sqlite.map((source) => source.fileName);
        const postgresNames = result.postgres.map((source) => source.fileName);
        if (JSON.stringify(sqliteNames) !== JSON.stringify(postgresNames)) {
            throw new Error(
                'SQLite and PostgreSQL migration pairs are incomplete.',
            );
        }
        for (const [index, fileName] of sqliteNames.entries()) {
            const expected = String(index + 1).padStart(3, '0');
            if (!fileName.startsWith(`${expected}-`)) {
                throw new Error(
                    `Migration sequence must be contiguous at '${fileName}'.`,
                );
            }
        }
        return `${JSON.stringify(result, null, 2)}\n`;
    }
}
