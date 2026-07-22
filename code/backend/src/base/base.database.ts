import { Kysely, SqliteDialect as SqliteDriver } from 'kysely';
import { Database } from '../database.ts';
import { config } from '../config.ts';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const BetterSqlite3 = require('better-sqlite3');
// Project root is 3 levels up from src/base: base -> src -> backend -> project-root
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/**
 * DatabaseManager handles the lifecycle of the database connection.
 * It ensures a single Kysely instance is used across all stores (Singleton).
 */
export class DatabaseManager {
    private static instance: Kysely<Database> | null = null;

    /**
     * Returns the initialized Kysely instance.
     * If not yet initialized, it creates one using SQLite as default.
     */
    public static async getInstance(): Promise<Kysely<Database>> {
        if (this.instance) {
            return this.instance;
        }

        console.log('🗄️ Initializing Database Connection...');

        const dbPath = path.resolve(PROJECT_ROOT, config.database.sqlitePath);

        // In a real scenario, we would check process.env.DB_TYPE here for Postgres support
        const dialect = new SqliteDriver({
            database: new BetterSqlite3(dbPath)
        });

        this.instance = new Kysely<Database>({
            dialect: dialect as any,
        });

        return this.instance;
    }

    /**
     * Closes the database connection gracefully.
     */
    public static async close(): Promise<void> {
        if (this.instance) {
            await this.instance.destroy();
            this.instance = null;
            console.log('🗄️ Database Connection Closed.');
        }
    }
}
