import {
    Kysely,
    PostgresDialect,
    SqliteDialect as SqliteDriver,
} from 'kysely';
import type { Database } from '../database.ts';
import { config } from '../config.ts';
import path from 'path';
import fs from 'node:fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import type BetterSqlite3Type from 'better-sqlite3';
import { Pool } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3') as typeof BetterSqlite3Type;
// Project root is four levels above src/base: base -> src -> backend -> code -> root.
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/**
 * DatabaseManager handles the lifecycle of the database connection.
 * It ensures a single application-owned Kysely instance is injected into all stores.
 */
export class DatabaseManager {
    private static instance: Kysely<Database> | null = null;
    private static nativeDatabase: BetterSqlite3Type.Database | null = null;
    private static closePromise: Promise<void> | null = null;

    /**
     * Returns the process-wide Kysely instance.
     *
     * If no instance exists, creates the configured SQLite or PostgreSQL client.
     * Concurrent callers receive the same application-owned client.
     *
     * @returns The initialized shared database abstraction.
     */
    public static async getInstance(): Promise<Kysely<Database>> {
        if (this.closePromise) {
            await this.closePromise;
        }
        if (this.instance) {
            return this.instance;
        }

        console.log('🗄️ Initializing Database Connection...');

        if (config.database.type === 'sqlite') {
            const dbPath = path.resolve(
                PROJECT_ROOT,
                config.database.sqlitePath,
            );
            fs.mkdirSync(path.dirname(dbPath), { recursive: true });
            const nativeDatabase = new BetterSqlite3(dbPath);
            this.instance = new Kysely<Database>({
                dialect: new SqliteDriver({ database: nativeDatabase }),
            });
            this.nativeDatabase = nativeDatabase;
        } else {
            const pool = new Pool({
                connectionString: config.database.connectionString,
                max: config.database.poolMax,
                idleTimeoutMillis: config.database.idleTimeoutMs,
                connectionTimeoutMillis:
                    config.database.connectionTimeoutMs,
            });
            this.instance = new Kysely<Database>({
                dialect: new PostgresDialect({ pool }),
            });
        }

        return this.instance;
    }

    /**
     * Closes the shared database connection gracefully and idempotently.
     */
    public static async close(): Promise<void> {
        if (this.closePromise) {
            return this.closePromise;
        }
        if (!this.instance) {
            return;
        }

        const database = this.instance;
        this.instance = null;
        this.nativeDatabase = null;
        this.closePromise = database.destroy().then(() => {
            console.log('🗄️ Database Connection Closed.');
        });
        try {
            await this.closePromise;
        } finally {
            this.closePromise = null;
        }
    }

    /** Returns the absolute configured SQLite database path. */
    public static getSqlitePath(): string {
        if (config.database.type !== 'sqlite') {
            throw new Error('SQLite file access requires DB_TYPE=sqlite.');
        }
        return path.resolve(PROJECT_ROOT, config.database.sqlitePath);
    }

    /**
     * Creates a transactionally consistent SQLite backup.
     *
     * @param destination Filesystem destination for the new backup.
     */
    public static async backup(destination: string): Promise<void> {
        if (!this.nativeDatabase) {
            throw new Error(
                'SQLite backup requires an initialized SQLite connection.',
            );
        }
        await this.nativeDatabase.backup(destination);
    }

    /**
     * Runs SQLite's full integrity check on the active connection.
     *
     * @throws Error when no active connection exists or integrity verification fails.
     */
    public static assertIntegrity(): void {
        if (!this.nativeDatabase) {
            throw new Error(
                'SQLite integrity checks require an initialized SQLite connection.',
            );
        }
        const result = this.nativeDatabase
            .pragma('integrity_check', { simple: true });
        if (result !== 'ok') {
            throw new Error(`SQLite integrity check failed: ${String(result)}`);
        }
    }

    /**
     * Verifies an on-disk SQLite database without changing it.
     *
     * @param filePath SQLite file to open read-only.
     * @throws Error when SQLite reports an integrity failure.
     */
    public static assertFileIntegrity(filePath: string): void {
        const database = new BetterSqlite3(filePath, { readonly: true });
        try {
            const result = database.pragma(
                'integrity_check',
                { simple: true },
            );
            if (result !== 'ok') {
                throw new Error(
                    `SQLite file integrity check failed: ${String(result)}`,
                );
            }
        } finally {
            database.close();
        }
    }
}
