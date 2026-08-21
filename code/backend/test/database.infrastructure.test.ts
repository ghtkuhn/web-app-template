import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Kysely } from 'kysely';
import { DatabaseManager } from '../src/base/base.database.ts';
import { BaseModule } from '../src/base/base.module.ts';
import { BaseObject } from '../src/base/base.object.ts';
import { BaseStore } from '../src/base/base.store.ts';
import { config, DatabaseConfigLoader } from '../src/config.ts';
import type { Database } from '../src/database.ts';
import type {
    ApplicationInfrastructure,
    ModuleDefinitions,
} from '../src/base/interfaces.ts';
import { ModuleRegistry } from '../src/module.registry.ts';

/** Minimal object used to exercise the generic store contract. */
class TestObject extends BaseObject {}

/** Concrete test store exposing the protected injected client for verification. */
class TestStore extends BaseStore<TestObject> {
    /** Returns the application-owned database received by BaseStore. */
    public database(): Kysely<Database> {
        return this.db;
    }

}

/** Module proving that a factory can pass infrastructure into a store. */
class StoreBackedModule extends BaseModule {
    public readonly store: TestStore;

    /** Creates its private store from application infrastructure. */
    constructor(infrastructure: ApplicationInfrastructure) {
        super();
        this.store = new TestStore(infrastructure.database);
    }
}

test('BaseStore requires and retains the injected database client', () => {
    const database = {} as Kysely<Database>;
    const store = new TestStore(database);

    assert.equal(store.database(), database);
    if (false) {
        // @ts-expect-error Concrete stores require an application database.
        void new TestStore();
    }
});

test('module factories pass registry infrastructure into private stores', () => {
    const database = {} as Kysely<Database>;
    const infrastructure = { database, databaseType: 'sqlite' as const };
    const definitions: ModuleDefinitions = {
        stored: {
            dependencies: [],
            create: (_dependencies, suppliedInfrastructure) =>
                new StoreBackedModule(suppliedInfrastructure),
        },
    };

    const modules = new ModuleRegistry(
        ['stored'],
        infrastructure,
        definitions,
    ).create();
    const module = modules.stored as StoreBackedModule;

    assert.equal(module.store.database(), database);
});

test('DatabaseManager shares, closes, and recreates its SQLite client', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-db-'));
    const originalDatabase = config.database;
    config.database = {
        type: 'sqlite',
        sqlitePath: path.join(directory, 'test.sqlite'),
        backupRetention: 10,
        releaseId: 'test',
    };

    try {
        const [first, concurrent] = await Promise.all([
            DatabaseManager.getInstance(),
            DatabaseManager.getInstance(),
        ]);
        assert.equal(first, concurrent);

        await DatabaseManager.close();
        const recreated = await DatabaseManager.getInstance();
        assert.notEqual(recreated, first);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('DatabaseManager shares, closes, and recreates its PostgreSQL client', async () => {
    const originalDatabase = config.database;
    await DatabaseManager.close();
    config.database = {
        type: 'postgres',
        connectionString: 'postgresql://user:secret@127.0.0.1:1/database',
        poolMax: 2,
        idleTimeoutMs: 10,
        connectionTimeoutMs: 10,
        releaseId: 'test',
    };

    try {
        const [first, concurrent] = await Promise.all([
            DatabaseManager.getInstance(),
            DatabaseManager.getInstance(),
        ]);
        assert.equal(first, concurrent);
        await DatabaseManager.close();
        const recreated = await DatabaseManager.getInstance();
        assert.notEqual(recreated, first);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
    }
});

test('database configuration validates PostgreSQL URL, TLS, and pool values', () => {
    assert.throws(
        () => DatabaseConfigLoader.load({ DB_TYPE: 'mysql' }),
        /DB_TYPE must be 'sqlite' or 'postgres'/,
    );
    assert.throws(
        () => DatabaseConfigLoader.load({ DB_TYPE: 'postgres' }),
        /DATABASE_URL must be an absolute PostgreSQL connection URL/,
    );
    assert.throws(
        () => DatabaseConfigLoader.load({
            DB_TYPE: 'postgres',
            NODE_ENV: 'production',
            DATABASE_URL: 'postgresql://user:secret@db/app?sslmode=require',
        }),
        /sslmode=verify-full/,
    );
    const postgres = DatabaseConfigLoader.load({
        DB_TYPE: 'postgres',
        NODE_ENV: 'production',
        DATABASE_URL:
            'postgresql://user:secret@db/app?sslmode=verify-full',
        DB_POSTGRES_POOL_MAX: '4',
        DB_POSTGRES_IDLE_TIMEOUT_MS: '5000',
        DB_POSTGRES_CONNECTION_TIMEOUT_MS: '2500',
    });
    assert.equal(postgres.type, 'postgres');
    assert.equal(postgres.poolMax, 4);
    assert.equal(postgres.idleTimeoutMs, 5000);
    assert.equal(postgres.connectionTimeoutMs, 2500);
});
