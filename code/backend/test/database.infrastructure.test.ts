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
import { config } from '../src/config.ts';
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

    public async save(object: TestObject): Promise<TestObject> {
        return object;
    }

    public async findById(): Promise<TestObject | null> {
        return null;
    }

    public async findAll(): Promise<TestObject[]> {
        return [];
    }

    public async delete(): Promise<void> {}
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
    const infrastructure = { database };
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
    const originalType = config.database.type;
    const originalPath = config.database.sqlitePath;
    config.database.type = 'sqlite';
    config.database.sqlitePath = path.join(directory, 'test.sqlite');

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
        config.database.type = originalType;
        config.database.sqlitePath = originalPath;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('DatabaseManager rejects unsupported PostgreSQL configuration', async () => {
    const originalType = config.database.type;
    await DatabaseManager.close();
    config.database.type = 'postgres';

    try {
        await assert.rejects(
            DatabaseManager.getInstance(),
            /Unsupported database type 'postgres'/,
        );
    } finally {
        config.database.type = originalType;
        await DatabaseManager.close();
    }
});
