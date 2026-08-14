// fallow-ignore-file code-duplication -- Declarative schema mirrors the SQLite catalog.
import type { Kysely } from 'kysely';
import type { Database } from '../../database.ts';

/** Creates the Better Auth core PostgreSQL schema managed by the Auth module. */
export async function up(database: Kysely<Database>): Promise<void> {
    await database.schema
        .createTable('auth_user')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('email', 'text', (column) => column.notNull().unique())
        .addColumn('emailVerified', 'boolean', (column) => column.notNull())
        .addColumn('image', 'text')
        .addColumn('createdAt', 'timestamptz', (column) => column.notNull())
        .addColumn('updatedAt', 'timestamptz', (column) => column.notNull())
        .execute();
    await database.schema
        .createTable('auth_session')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('token', 'text', (column) => column.notNull().unique())
        .addColumn('userId', 'text', (column) =>
            column.notNull().references('auth_user.id').onDelete('cascade'),
        )
        .addColumn('expiresAt', 'timestamptz', (column) => column.notNull())
        .addColumn('ipAddress', 'text')
        .addColumn('userAgent', 'text')
        .addColumn('createdAt', 'timestamptz', (column) => column.notNull())
        .addColumn('updatedAt', 'timestamptz', (column) => column.notNull())
        .execute();
    await database.schema
        .createIndex('auth_session_userId_index')
        .ifNotExists()
        .on('auth_session')
        .column('userId')
        .execute();
    await database.schema
        .createTable('auth_account')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('accountId', 'text', (column) => column.notNull())
        .addColumn('providerId', 'text', (column) => column.notNull())
        .addColumn('userId', 'text', (column) =>
            column.notNull().references('auth_user.id').onDelete('cascade'),
        )
        .addColumn('accessToken', 'text')
        .addColumn('refreshToken', 'text')
        .addColumn('idToken', 'text')
        .addColumn('accessTokenExpiresAt', 'timestamptz')
        .addColumn('refreshTokenExpiresAt', 'timestamptz')
        .addColumn('scope', 'text')
        .addColumn('password', 'text')
        .addColumn('createdAt', 'timestamptz', (column) => column.notNull())
        .addColumn('updatedAt', 'timestamptz', (column) => column.notNull())
        .execute();
    await database.schema
        .createIndex('auth_account_userId_index')
        .ifNotExists()
        .on('auth_account')
        .column('userId')
        .execute();
    await database.schema
        .createTable('auth_verification')
        .ifNotExists()
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('identifier', 'text', (column) => column.notNull())
        .addColumn('value', 'text', (column) => column.notNull())
        .addColumn('expiresAt', 'timestamptz', (column) => column.notNull())
        .addColumn('createdAt', 'timestamptz', (column) => column.notNull())
        .addColumn('updatedAt', 'timestamptz', (column) => column.notNull())
        .execute();
    await database.schema
        .createIndex('auth_verification_identifier_index')
        .ifNotExists()
        .on('auth_verification')
        .column('identifier')
        .execute();
}
