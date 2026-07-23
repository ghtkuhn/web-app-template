import {
    FileMigrationProvider,
    Migrator,
    type Kysely,
} from 'kysely';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../database.ts';
import { config } from '../config.ts';
import { DatabaseBackupManager } from './base.database-backup.ts';
import { DatabaseManager } from './base.database.ts';

export interface MigrationOutcome {
    readonly backupCreated: boolean;
}

/** Applies pending database migrations before application modules start. */
export class MigrationManager {
    private static migrationPromise: Promise<MigrationOutcome> | null = null;

    /** Backs up the database and applies all pending versioned migrations. */
    public static async migrate(
        database: Kysely<Database>,
        backups = new DatabaseBackupManager(),
    ): Promise<MigrationOutcome> {
        if (!this.migrationPromise) {
            this.migrationPromise = this.execute(database, backups);
        }
        try {
            return await this.migrationPromise;
        } finally {
            this.migrationPromise = null;
        }
    }

    private static async execute(
        database: Kysely<Database>,
        backups: DatabaseBackupManager,
    ): Promise<MigrationOutcome> {
        const migrationFolder = path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../migration',
        );
        await fs.mkdir(migrationFolder, { recursive: true });
        const migrator = new Migrator({
            db: database,
            provider: new FileMigrationProvider({
                fs,
                path,
                migrationFolder,
            }),
        });
        const migrations = await migrator.getMigrations();
        const pending = migrations.filter((migration) => !migration.executedAt);
        if (pending.length === 0) {
            return { backupCreated: false };
        }
        const executed = migrations.filter((migration) => migration.executedAt);
        await backups.create(
            config.database.releaseId,
            executed.at(-1)?.name ?? 'none',
            pending.at(-1)?.name ?? 'none',
        );
        const result = await migrator.migrateToLatest();
        const failure = result.results?.find(
            (migration) => migration.status === 'Error',
        );
        if (result.error || failure) {
            throw result.error ?? new Error(
                `Migration '${failure?.migrationName}' failed.`,
            );
        }
        DatabaseManager.assertIntegrity();
        return { backupCreated: true };
    }
}
