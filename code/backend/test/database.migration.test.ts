import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { sql } from 'kysely';
import { DatabaseBackupManager } from '../src/base/base.database-backup.ts';
import { DatabaseManager } from '../src/base/base.database.ts';
import { MigrationManager } from '../src/base/base.migration.ts';
import { config } from '../src/config.ts';

/** Backup manager used to prove that migration execution is gated. */
class FailingBackupManager extends DatabaseBackupManager {
    /** Rejects every attempted backup. */
    public override async create(): Promise<never> {
        throw new Error('backup failed');
    }
}

test('pending migrations create one valid backup and do not repeat', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-'));
    const originalDatabase = config.database;
    config.database = {
        type: 'sqlite',
        sqlitePath: path.join(directory, 'backend.sqlite'),
        backupRetention: 10,
        releaseId: 'test-release',
    };

    try {
        const database = await DatabaseManager.getInstance();
        const [first, concurrent] = await Promise.all([
            MigrationManager.migrate(database),
            MigrationManager.migrate(database),
        ]);
        assert.equal(first.backupCreated, true);
        assert.equal(concurrent.backupCreated, true);
        assert.equal(new DatabaseBackupManager().list().length, 1);
        DatabaseManager.assertIntegrity();

        const second = await MigrationManager.migrate(database);
        assert.equal(second.backupCreated, false);
        assert.equal(new DatabaseBackupManager().list().length, 1);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('restore validates the backup and atomically replaces SQLite data', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));
    const sqlitePath = path.join(directory, 'backend.sqlite');
    const originalDatabase = config.database;
    config.database = {
        type: 'sqlite',
        sqlitePath,
        backupRetention: 10,
        releaseId: 'test',
    };

    try {
        const database = await DatabaseManager.getInstance();
        await sql`create table restore_test (value text not null)`.execute(
            database,
        );
        await sql`insert into restore_test values ('before')`.execute(database);
        const backups = new DatabaseBackupManager();
        const backup = await backups.create('restore-test', '001', '002');
        await sql`insert into restore_test values ('after')`.execute(database);
        await DatabaseManager.close();
        fs.writeFileSync(`${sqlitePath}-wal`, 'stale');
        fs.writeFileSync(`${sqlitePath}-shm`, 'stale');

        backups.restore(backup.id);
        assert.equal(fs.existsSync(`${sqlitePath}-wal`), false);
        assert.equal(fs.existsSync(`${sqlitePath}-shm`), false);
        const restored = await DatabaseManager.getInstance();
        const rows = await sql<{ value: string }>`
            select value from restore_test order by value
        `.execute(restored);
        assert.deepEqual(rows.rows, [{ value: 'before' }]);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backup failure prevents pending migrations from executing', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-failure-'));
    const originalDatabase = config.database;
    config.database = {
        type: 'sqlite',
        sqlitePath: path.join(directory, 'backend.sqlite'),
        backupRetention: 10,
        releaseId: 'test',
    };
    const failingBackups = new FailingBackupManager();

    try {
        const database = await DatabaseManager.getInstance();
        await assert.rejects(
            MigrationManager.migrate(database, failingBackups),
            /backup failed/,
        );
        const applied = await sql<{ count: number }>`
            select count(*) as count
            from sqlite_master
            where type = 'table' and name = 'kysely_migration'
        `.execute(database);
        assert.equal(applied.rows[0]?.count, 0);
    } finally {
        await DatabaseManager.close();
        config.database = originalDatabase;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backup retention keeps only the requested newest files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
    const databasePath = path.join(directory, 'backend.sqlite');
    const backupRoot = path.join(directory, 'backups');
    fs.mkdirSync(backupRoot);
    for (const id of ['001.sqlite', '002.sqlite', '003.sqlite']) {
        fs.writeFileSync(path.join(backupRoot, id), id);
    }
    const backups = new DatabaseBackupManager(databasePath);

    backups.retain(2);

    assert.deepEqual(
        backups.list().map((backup) => backup.id),
        ['003.sqlite', '002.sqlite'],
    );
    fs.rmSync(directory, { recursive: true, force: true });
});

test('restore rejects implicit, missing, corrupt, and linked backups', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-backup-'));
    const databasePath = path.join(directory, 'backend.sqlite');
    const backupRoot = path.join(directory, 'backups');
    fs.mkdirSync(backupRoot);
    const backups = new DatabaseBackupManager(databasePath);

    assert.throws(() => backups.restore('latest'), /Invalid/);
    assert.throws(() => backups.restore('missing.sqlite'), /does not exist/);
    fs.writeFileSync(path.join(backupRoot, 'corrupt.sqlite'), 'not sqlite');
    assert.throws(() => backups.restore('corrupt.sqlite'));
    fs.symlinkSync(
        path.join(backupRoot, 'corrupt.sqlite'),
        path.join(backupRoot, 'linked.sqlite'),
    );
    assert.throws(() => backups.restore('linked.sqlite'), /regular file/);
    fs.rmSync(directory, { recursive: true, force: true });
});
