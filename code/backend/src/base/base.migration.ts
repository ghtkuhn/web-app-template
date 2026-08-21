import {
    FileMigrationProvider,
    Migrator,
    type Kysely,
    type MigrationInfo,
    type MigrationResult,
    type MigrationResultSet,
} from 'kysely';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from '../database.ts';
import { config } from '../config.ts';
import { DatabaseBackupManager } from './base.database-backup.ts';
import { DatabaseManager } from './base.database.ts';
import { MigrationChecksumManager } from './base.migration-checksum.ts';
import { MigrationCatalog } from './migration.catalog.ts';

/** Result metadata returned after checking and applying pending migrations. */
export interface MigrationOutcome {
    /** Whether the run created a pre-migration SQLite backup. */
    readonly backupCreated: boolean;
}

/** Applies pending database migrations before application modules start. */
export class MigrationManager {
    private static migrationPromise: Promise<MigrationOutcome> | null = null;

    /**
     * Applies all pending versioned migrations.
     *
     * Creates one SQLite backup when required and relies on the configured
     * external backup policy for PostgreSQL. Concurrent requests are serialized.
     *
     * @param database Application-owned database abstraction to migrate.
     * @param backups Optional SQLite backup manager used before migration.
     * @returns Whether a pre-migration backup was created.
     */
    public static async migrate(
        database: Kysely<Database>,
        backups?: DatabaseBackupManager,
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
        backups?: DatabaseBackupManager,
    ): Promise<MigrationOutcome> {
        const migrationFolder = this.migrationFolder();
        const migrator = await this.createMigrator(database, migrationFolder);
        const migrations = await migrator.getMigrations();
        const checksums = new MigrationChecksumManager(
            database,
            config.database.type,
            new MigrationCatalog(path.dirname(migrationFolder)).sources(
                config.database.type,
            ),
        );
        await checksums.verify(migrations);
        const pending = migrations.filter((migration) => !migration.executedAt);
        if (pending.length === 0) {
            return { backupCreated: false };
        }
        const backupCreated = await this.createBackupIfRequired(
            migrations,
            pending,
            backups,
        );
        this.assertMigrationResult(await migrator.migrateToLatest());
        await checksums.register(pending);
        this.assertSqliteIntegrityIfRequired();
        return { backupCreated };
    }

    private static async createMigrator(
        database: Kysely<Database>,
        migrationFolder: string,
    ): Promise<Migrator> {
        await fs.mkdir(migrationFolder, { recursive: true });
        return new Migrator({
            db: database,
            provider: new FileMigrationProvider({
                fs,
                path,
                migrationFolder,
            }),
        });
    }

    private static migrationFolder(): string {
        return path.resolve(
            path.dirname(fileURLToPath(import.meta.url)),
            '../migration',
            config.database.type,
        );
    }

    private static async createBackupIfRequired(
        migrations: readonly MigrationInfo[],
        pending: readonly MigrationInfo[],
        backups?: DatabaseBackupManager,
    ): Promise<boolean> {
        if (config.database.type !== 'sqlite') {
            return false;
        }
        const executed = migrations.filter((migration) => migration.executedAt);
        await this.resolveBackupManager(backups).create(
            config.database.releaseId,
            this.lastMigrationName(executed),
            this.lastMigrationName(pending),
        );
        return true;
    }

    private static resolveBackupManager(
        backups?: DatabaseBackupManager,
    ): DatabaseBackupManager {
        return backups === undefined
            ? new DatabaseBackupManager()
            : backups;
    }

    private static lastMigrationName(
        migrations: readonly MigrationInfo[],
    ): string {
        return migrations.length === 0
            ? 'none'
            : migrations[migrations.length - 1].name;
    }

    private static assertMigrationResult(result: MigrationResultSet): void {
        if (result.error) {
            throw result.error;
        }
        const failure = this.findMigrationFailure(result.results);
        if (failure) {
            throw new Error(
                `Migration '${failure.migrationName}' failed.`,
            );
        }
    }

    private static findMigrationFailure(
        results: readonly MigrationResult[] | undefined,
    ): MigrationResult | undefined {
        if (!results) {
            return undefined;
        }
        return results.find((migration) => migration.status === 'Error');
    }

    private static assertSqliteIntegrityIfRequired(): void {
        if (config.database.type === 'sqlite') {
            DatabaseManager.assertIntegrity();
        }
    }
}
