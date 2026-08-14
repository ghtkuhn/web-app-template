import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../src/database.ts';
import { up as migrateAuth } from '../src/migration/postgres/002-better-auth.migration.ts';
import { AuthService } from '../src/module/auth/service/auth.service.ts';
import { AuthRuntimeService } from '../src/module/auth/service/auth-runtime.service.ts';

const POSTGRES_IMAGE = 'postgres:17-alpine';
const POSTGRES_PASSWORD = 'template-postgres-integration-password';
const BASE_URL = 'http://localhost:3000';
const ORIGIN = 'http://localhost:8080';
const AUTH_SECRET = 'integration-secret-with-more-than-thirty-two-characters';

/** Owns one isolated PostgreSQL Docker container for an integration test. */
class PostgresTestServer {
    private readonly containerName = `web-app-postgres-${randomUUID()}`;
    private connectionStringValue = '';
    private running = false;

    /** Starts PostgreSQL and waits until it accepts real client queries. */
    public async start(): Promise<string> {
        this.assertDockerAvailable();
        try {
            execFileSync('docker', [
                'run',
                '--detach',
                '--rm',
                '--name',
                this.containerName,
                '--env',
                `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
                '--env',
                'POSTGRES_USER=template',
                '--env',
                'POSTGRES_DB=template',
                '--publish',
                '127.0.0.1::5432',
                POSTGRES_IMAGE,
            ], { stdio: 'ignore' });
            this.running = true;
            const port = this.readPort();
            this.connectionStringValue =
                `postgresql://template:${POSTGRES_PASSWORD}` +
                `@127.0.0.1:${port}/template`;
            await this.waitUntilReady();
            return this.connectionStringValue;
        } catch (error: unknown) {
            this.stop();
            throw error;
        }
    }

    /** Stops the disposable container; Docker removes it automatically. */
    public stop(): void {
        if (!this.running) {
            return;
        }
        try {
            execFileSync('docker', ['stop', this.containerName], {
                stdio: 'ignore',
            });
        } finally {
            this.running = false;
        }
    }

    private assertDockerAvailable(): void {
        try {
            execFileSync('docker', ['info'], { stdio: 'ignore' });
        } catch {
            throw new Error(
                'PostgreSQL integration requires a running Docker daemon.',
            );
        }
    }

    private readPort(): string {
        const output = execFileSync(
            'docker',
            ['port', this.containerName, '5432/tcp'],
            { encoding: 'utf8' },
        ).trim();
        const port = output.match(/:(\d+)$/u)?.[1];
        if (!port) {
            throw new Error('Docker did not publish the PostgreSQL test port.');
        }
        return port;
    }

    private async waitUntilReady(): Promise<void> {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            if (await this.acceptsConnections()) {
                return;
            }
            await delay(250);
        }
        throw new Error('PostgreSQL test server was not ready within 15 seconds.');
    }

    private async acceptsConnections(): Promise<boolean> {
        const pool = new Pool({
            connectionString: this.connectionStringValue,
            connectionTimeoutMillis: 500,
        });
        try {
            await pool.query('select 1');
            return true;
        } catch {
            return false;
        } finally {
            await pool.end();
        }
    }
}

/** Creates one Better Auth protocol request with the trusted test origin. */
function authRequest(path: string, init: RequestInit = {}): Request {
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

test('Better Auth supports PostgreSQL registration, Bearer sessions, and logout', async () => {
    const server = new PostgresTestServer();
    const connectionString = await server.start();
    const database = new Kysely<Database>({
        dialect: new PostgresDialect({
            pool: new Pool({ connectionString }),
        }),
    });
    try {
        await migrateAuth(database);
        const disabled = new AuthRuntimeService({
            database,
            databaseType: 'postgres',
            options: {
                secret: AUTH_SECRET,
                baseUrl: BASE_URL,
                registrationEnabled: false,
                trustedOrigins: [ORIGIN],
            },
        }).createAuthRuntime();
        const rejected = await disabled.handler(
            authRequest('sign-up/email', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'Disabled User',
                    email: 'disabled@example.com',
                    password: 'safe-password-123',
                }),
            }),
        );
        assert.equal(rejected.status, 400);

        const runtime = new AuthRuntimeService({
            database,
            databaseType: 'postgres',
            options: {
                secret: AUTH_SECRET,
                baseUrl: BASE_URL,
                registrationEnabled: true,
                trustedOrigins: [ORIGIN],
            },
        }).createAuthRuntime();
        const service = new AuthService({ runtime });
        const registration = await runtime.handler(
            authRequest('sign-up/email', {
                method: 'POST',
                body: JSON.stringify({
                    name: 'PostgreSQL User',
                    email: 'postgres@example.com',
                    password: 'safe-password-123',
                }),
            }),
        );
        const bearerToken = registration.headers.get('set-auth-token');

        assert.equal(registration.status, 200);
        assert.ok(bearerToken);
        const session = await service.getSession({ bearerToken });
        assert.equal(session?.user.email, 'postgres@example.com');
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
        server.stop();
    }
});
