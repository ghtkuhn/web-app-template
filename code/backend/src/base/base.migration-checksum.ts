import { createHash } from 'node:crypto';
import { sql, type Kysely, type MigrationInfo } from 'kysely';
import type { Database } from '../database.ts';
import type { DatabaseType } from './interfaces.ts';
import type { MigrationSource } from './migration.catalog.ts';

interface StoredMigrationChecksum {
    readonly checksum: string;
    readonly migration_name: string;
}

const BASELINE_MARKER = '__baseline__';

/** Verifies immutable migration history and registers successful migrations. */
export class MigrationChecksumManager {
    private readonly database: Kysely<Database>;
    private readonly dialect: DatabaseType;
    private readonly sources: ReadonlyMap<string, MigrationSource>;

    public constructor(
        database: Kysely<Database>,
        dialect: DatabaseType,
        sources: readonly MigrationSource[],
    ) {
        this.database = database;
        this.dialect = dialect;
        this.sources = new Map(sources.map((source) => [source.name, source]));
    }

    /** Baselines legacy databases once, then rejects every applied mismatch. */
    // fallow-ignore-next-line complexity -- Separates baseline creation from complete applied-history verification.
    public async verify(applied: readonly MigrationInfo[]): Promise<void> {
        await this.ensureTable();
        const stored = await this.stored();
        if (!stored.has(BASELINE_MARKER)) {
            await this.createBaseline(applied);
            return;
        }
        for (const migration of applied.filter((entry) => entry.executedAt)) {
            const source = this.source(migration.name);
            const checksum = stored.get(migration.name);
            if (!checksum || checksum !== source.checksum) {
                throw new Error(
                    `Applied ${this.dialect} migration '${migration.name}' ` +
                    'does not match its recorded SHA-256 checksum.',
                );
            }
        }
    }

    /** Records only migrations confirmed successful by Kysely. */
    public async register(
        migrations: readonly MigrationInfo[],
    ): Promise<void> {
        await this.database.transaction().execute(async (transaction) => {
            for (const migration of migrations) {
                const source = this.source(migration.name);
                await sql`
                    insert into template_migration_checksum (
                        dialect,
                        migration_name,
                        checksum,
                        baseline,
                        applied_at
                    ) values (
                        ${this.dialect},
                        ${migration.name},
                        ${source.checksum},
                        ${0},
                        ${new Date().toISOString()}
                    )
                `.execute(transaction);
            }
        });
    }

    private async ensureTable(): Promise<void> {
        await this.database.schema
            .createTable('template_migration_checksum')
            .ifNotExists()
            .addColumn('dialect', 'varchar(16)', (column) => column.notNull())
            .addColumn(
                'migration_name',
                'varchar(255)',
                (column) => column.notNull(),
            )
            .addColumn('checksum', 'varchar(64)', (column) => column.notNull())
            .addColumn(
                'baseline',
                'integer',
                (column) => column.notNull(),
            )
            .addColumn(
                'applied_at',
                'varchar(40)',
                (column) => column.notNull(),
            )
            .addPrimaryKeyConstraint(
                'template_migration_checksum_pk',
                ['dialect', 'migration_name'],
            )
            .execute();
    }

    private async stored(): Promise<Map<string, string>> {
        const result = await sql<StoredMigrationChecksum>`
            select migration_name, checksum
            from template_migration_checksum
            where dialect = ${this.dialect}
        `.execute(this.database);
        return new Map(result.rows.map((row) => [
            row.migration_name,
            row.checksum,
        ]));
    }

    private async createBaseline(
        migrations: readonly MigrationInfo[],
    ): Promise<void> {
        const executed = migrations.filter((migration) => migration.executedAt);
        await this.database.transaction().execute(async (transaction) => {
            for (const migration of executed) {
                const source = this.source(migration.name);
                await sql`
                    insert into template_migration_checksum (
                        dialect,
                        migration_name,
                        checksum,
                        baseline,
                        applied_at
                    ) values (
                        ${this.dialect},
                        ${migration.name},
                        ${source.checksum},
                        ${1},
                        ${new Date().toISOString()}
                    )
                `.execute(transaction);
            }
            await sql`
                insert into template_migration_checksum (
                    dialect,
                    migration_name,
                    checksum,
                    baseline,
                    applied_at
                ) values (
                    ${this.dialect},
                    ${BASELINE_MARKER},
                    ${this.baselineChecksum(executed)},
                    ${1},
                    ${new Date().toISOString()}
                )
            `.execute(transaction);
        });
    }

    private baselineChecksum(migrations: readonly MigrationInfo[]): string {
        const value = migrations
            .map((migration) => this.source(migration.name).checksum)
            .join(':');
        return createHash('sha256').update(value).digest('hex');
    }

    private source(name: string): MigrationSource {
        const source = this.sources.get(name);
        if (!source) {
            throw new Error(
                `Applied ${this.dialect} migration '${name}' has no source file.`,
            );
        }
        return source;
    }
}
