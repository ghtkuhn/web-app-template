import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MigrationPairWriter } from '../script/scaffold-resource/migration-pair.writer.ts';

/** Creates one isolated backend workspace for migration output tests. */
function backendFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-pair-'));
    const backendRoot = path.join(root, 'code/backend');
    fs.mkdirSync(backendRoot, { recursive: true });
    return backendRoot;
}

test('migration pair writer creates matching dialect files', () => {
    const backendRoot = backendFixture();
    try {
        const result = new MigrationPairWriter(backendRoot).write({
            name: '003-create-widget',
            sqliteSource: 'export class SqliteMigration {}\n',
            postgresSource: 'export class PostgresMigration {}\n',
        });
        assert.equal(
            result.sqliteFile,
            'src/migration/sqlite/003-create-widget.migration.ts',
        );
        assert.equal(
            result.postgresFile,
            'src/migration/postgres/003-create-widget.migration.ts',
        );
        assert.equal(
            fs.readFileSync(path.join(backendRoot, result.sqliteFile), 'utf8'),
            'export class SqliteMigration {}\n',
        );
        assert.equal(
            fs.readFileSync(path.join(backendRoot, result.postgresFile), 'utf8'),
            'export class PostgresMigration {}\n',
        );
    } finally {
        fs.rmSync(path.dirname(path.dirname(backendRoot)), {
            recursive: true,
            force: true,
        });
    }
});

test('migration pair writer rejects collisions before mutation', () => {
    const backendRoot = backendFixture();
    try {
        const sqliteDirectory = path.join(
            backendRoot,
            'src/migration/sqlite',
        );
        fs.mkdirSync(sqliteDirectory, { recursive: true });
        fs.writeFileSync(
            path.join(sqliteDirectory, '003-create-widget.migration.ts'),
            'existing',
            'utf8',
        );
        assert.throws(() =>
            new MigrationPairWriter(backendRoot).write({
                name: '003-create-widget',
                sqliteSource: 'sqlite',
                postgresSource: 'postgres',
            }),
        );
        assert.equal(
            fs.existsSync(path.join(backendRoot, 'src/migration/postgres')),
            false,
        );
    } finally {
        fs.rmSync(path.dirname(path.dirname(backendRoot)), {
            recursive: true,
            force: true,
        });
    }
});

test('migration pair writer rolls back both outputs after a partial failure', () => {
    const backendRoot = backendFixture();
    let writes = 0;
    try {
        const writer = new MigrationPairWriter(
            backendRoot,
            (filePath, source) => {
                writes += 1;
                fs.writeFileSync(filePath, source, 'utf8');
                if (writes === 2) {
                    throw new Error('simulated failure');
                }
            },
        );
        assert.throws(
            () => writer.write({
                name: '003-create-widget',
                sqliteSource: 'sqlite',
                postgresSource: 'postgres',
            }),
            /simulated failure/u,
        );
        assert.equal(
            fs.existsSync(path.join(backendRoot, 'src/migration')),
            true,
        );
        assert.equal(
            fs.existsSync(path.join(backendRoot, 'src/migration/sqlite')),
            false,
        );
        assert.equal(
            fs.existsSync(path.join(backendRoot, 'src/migration/postgres')),
            false,
        );
    } finally {
        fs.rmSync(path.dirname(path.dirname(backendRoot)), {
            recursive: true,
            force: true,
        });
    }
});
