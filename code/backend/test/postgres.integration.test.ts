import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { DatabaseManager } from '../src/base/base.database.ts';
import { MigrationManager } from '../src/base/base.migration.ts';
import { config } from '../src/config.ts';
import { AuthService } from '../src/module/auth/service/auth.service.ts';
import { AuthRuntimeService } from '../src/module/auth/service/auth-runtime.service.ts';

const POSTGRES_IMAGE =
    'postgres@sha256:d4bb0a8c1b7bb2e29f976d099e7bfb9a5d8858cffe9e46b35cd302cd1f1f8168';
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

    /** Returns a connection URL with a replacement password for failure tests. */
    public connectionStringWithPassword(password: string): string {
        if (!this.connectionStringValue) {
            throw new Error('PostgreSQL test server has not started.');
        }
        const url = new URL(this.connectionStringValue);
        url.password = password;
        return url.toString();
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

// fallow-ignore-next-line complexity -- One lifecycle test owns and reliably cleans up its disposable PostgreSQL container.
test('PostgreSQL runtime, migrations, and Better Auth work end to end', async () => {
    const server = new PostgresTestServer();
    const connectionString = await server.start();
    const originalDatabase = config.database;
    config.database = {
        type: 'postgres',
        connectionString,
        poolMax: 4,
        idleTimeoutMs: 1000,
        connectionTimeoutMs: 1000,
        releaseId: 'postgres-integration',
    };
    try {
        const [database, concurrentDatabase] = await Promise.all([
            DatabaseManager.getInstance(),
            DatabaseManager.getInstance(),
        ]);
        assert.equal(database, concurrentDatabase);
        assert.equal(
            (await sql<{ value: number }>`select 1 as value`.execute(database))
                .rows[0]?.value,
            1,
        );

        const [firstMigration, concurrentMigration] = await Promise.all([
            MigrationManager.migrate(database),
            MigrationManager.migrate(database),
        ]);
        assert.equal(firstMigration.backupCreated, false);
        assert.equal(concurrentMigration.backupCreated, false);
        assert.equal(
            (await MigrationManager.migrate(database)).backupCreated,
            false,
        );
        const migrations = await sql<{ name: string }>`
            select name
            from kysely_migration
            order by name
        `.execute(database);
        assert.deepEqual(
            migrations.rows.map((migration) => migration.name),
            ['001-initialize.migration', '002-better-auth.migration'],
        );
        const storedChecksum = await sql<{ checksum: string }>`
            select checksum
            from template_migration_checksum
            where dialect = 'postgres'
                and migration_name = '001-initialize.migration'
        `.execute(database);
        await sql`
            update template_migration_checksum
            set checksum = ${'0'.repeat(64)}
            where dialect = 'postgres'
                and migration_name = '001-initialize.migration'
        `.execute(database);
        await assert.rejects(
            MigrationManager.migrate(database),
            /does not match its recorded SHA-256 checksum/,
        );
        await sql`
            update template_migration_checksum
            set checksum = ${storedChecksum.rows[0]?.checksum ?? ''}
            where dialect = 'postgres'
                and migration_name = '001-initialize.migration'
        `.execute(database);
        const physicalColumns = await sql<{
            column_name: string;
            data_type: string;
        }>`
            select column_name, data_type
            from information_schema.columns
            where table_schema = 'public'
                and table_name = 'auth_user'
                and column_name in ('emailVerified', 'createdAt')
            order by column_name
        `.execute(database);
        assert.deepEqual(physicalColumns.rows, [
            {
                column_name: 'createdAt',
                data_type: 'timestamp with time zone',
            },
            { column_name: 'emailVerified', data_type: 'boolean' },
        ]);

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

        await DatabaseManager.close();
        const recreated = await DatabaseManager.getInstance();
        assert.notEqual(recreated, database);
        assert.equal(
            (await sql<{ value: number }>`select 1 as value`.execute(recreated))
                .rows[0]?.value,
            1,
        );

        await DatabaseManager.close();
        const invalidPassword = 'integration-password-must-not-leak';
        config.database = {
            ...config.database,
            connectionString:
                server.connectionStringWithPassword(invalidPassword),
        };
        const failingDatabase = await DatabaseManager.getInstance();
        let connectionFailure: unknown;
        try {
            await sql`select 1`.execute(failingDatabase);
        } catch (error: unknown) {
            connectionFailure = error;
        }
        assert.ok(connectionFailure instanceof Error);
        assert.doesNotMatch(connectionFailure.message, /integration-password/u);
        assert.doesNotMatch(connectionFailure.message, /postgresql:\/\//u);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
        server.stop();
    }
});
