// fallow-ignore-file unused-file
import type { Kysely } from 'kysely';
import type { Database } from '../../database.ts';

/**
 * Establishes the initial PostgreSQL application schema version.
 *
 * The template has no domain tables until modules add their first migrations.
 */
export async function up(_database: Kysely<Database>): Promise<void> {
    await Promise.resolve();
}
