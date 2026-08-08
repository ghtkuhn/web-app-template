/**
 * Global Database Schema definition for Kysely.
 * This interface defines the structure of all tables in the database.
 * When adding new modules, add their table definitions here.
 */
import type { ColumnType } from 'kysely';

type AuthDate = ColumnType<Date, Date | string, Date | string>;

/** Better Auth-owned user persistence. */
export interface AuthUserTable {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    createdAt: AuthDate;
    updatedAt: AuthDate;
}

/** Better Auth-owned database session. */
export interface AuthSessionTable {
    id: string;
    token: string;
    userId: string;
    expiresAt: AuthDate;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: AuthDate;
    updatedAt: AuthDate;
}

/** Better Auth-owned credential or external-provider account. */
export interface AuthAccountTable {
    id: string;
    accountId: string;
    providerId: string;
    userId: string;
    accessToken: string | null;
    refreshToken: string | null;
    idToken: string | null;
    accessTokenExpiresAt: AuthDate | null;
    refreshTokenExpiresAt: AuthDate | null;
    scope: string | null;
    password: string | null;
    createdAt: AuthDate;
    updatedAt: AuthDate;
}

/** Better Auth-owned short-lived verification record. */
export interface AuthVerificationTable {
    id: string;
    identifier: string;
    value: string;
    expiresAt: AuthDate;
    createdAt: AuthDate;
    updatedAt: AuthDate;
}

/** Complete compile-time schema, including explicitly external tables. */
export interface Database {
    auth_user: AuthUserTable;
    auth_session: AuthSessionTable;
    auth_account: AuthAccountTable;
    auth_verification: AuthVerificationTable;
}

/** Literal ownership registry used by architecture and migration checks. */
// fallow-ignore-next-line unused-export -- Architecture registry consumed by the linter.
export const EXTERNAL_TABLE_OWNERS = {
    auth_user: 'better-auth',
    auth_session: 'better-auth',
    auth_account: 'better-auth',
    auth_verification: 'better-auth',
} as const;
