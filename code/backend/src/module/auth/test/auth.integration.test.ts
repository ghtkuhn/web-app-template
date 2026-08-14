import assert from 'node:assert/strict';
import { test } from 'node:test';
import BetterSqlite3 from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { up } from '../../../migration/sqlite/002-better-auth.migration.ts';
import type { Database } from '../../../database.ts';
import { AuthService } from '../service/auth.service.ts';
import { AuthRuntimeService } from '../service/auth-runtime.service.ts';

const SECRET = 'integration-secret-with-more-than-thirty-two-characters';
const BASE_URL = 'http://localhost:3000';
const ORIGIN = 'http://localhost:8080';

/** Creates an isolated migrated Auth persistence fixture. */
async function createDatabase(): Promise<Kysely<Database>> {
    const database = new Kysely<Database>({
        dialect: new SqliteDialect({
            database: new BetterSqlite3(':memory:'),
        }),
    });
    await up(database);
    return database;
}

/** Creates one protocol request with the trusted test origin. */
function authRequest(
    path: string,
    init: RequestInit = {},
): Request {
    const headers = new Headers(init.headers);
    headers.set('origin', ORIGIN);
    if (init.body) {
        headers.set('content-type', 'application/json');
    }
    return new Request(`${BASE_URL}/api/auth/${path}`, {
        ...init,
        headers,
    });
}

test('Auth registration remains disabled unless explicitly enabled', async () => {
    const database = await createDatabase();
    try {
        const runtime = new AuthRuntimeService({
            database,
            databaseType: 'sqlite',
            options: {
                secret: SECRET,
                baseUrl: BASE_URL,
                registrationEnabled: false,
                trustedOrigins: [ORIGIN],
            },
        }).createAuthRuntime();
        const response = await runtime.handler(
            authRequest('sign-up/email', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Disabled User',
                    email: 'disabled@example.com',
                    password: 'safe-password-123',
                }),
            }),
        );

        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            message: 'Email and password sign up is not enabled',
            code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
        });
    } finally {
        await database.destroy();
    }
});

test('Auth supports signed Bearer sessions and explicit logout', async () => {
    const database = await createDatabase();
    try {
        const runtime = new AuthRuntimeService({
            database,
            databaseType: 'sqlite',
            options: {
                secret: SECRET,
                baseUrl: BASE_URL,
                registrationEnabled: true,
                trustedOrigins: [ORIGIN],
            },
        }).createAuthRuntime();
        const service = new AuthService({
            runtime,
        });
        const registration = await runtime.handler(
            authRequest('sign-up/email', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Example User',
                    email: 'user@example.com',
                    password: 'safe-password-123',
                }),
            }),
        );
        const bearerToken = registration.headers.get('set-auth-token');

        assert.equal(registration.status, 200);
        assert.ok(bearerToken);
        const session = await service.getSession({ bearerToken });
        assert.equal(session?.user.email, 'user@example.com');
        assert.equal('token' in session, false);

        const logout = await runtime.handler(
            authRequest('sign-out', {
                method: 'POST',
                headers: { Authorization: `Bearer ${bearerToken}` },
            }),
        );
        assert.equal(logout.status, 200);
        assert.equal(await service.getSession({ bearerToken }), null);
    } finally {
        await database.destroy();
    }
});
