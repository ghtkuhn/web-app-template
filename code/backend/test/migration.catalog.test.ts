import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MigrationCatalogChecker } from '../script/migration-check/migration.catalog.checker.ts';

test('migration catalog detects source changes, missing pairs, and gaps', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-catalog-'));
    const sqlite = path.join(root, 'src/migration/sqlite');
    const postgres = path.join(root, 'src/migration/postgres');
    fs.mkdirSync(sqlite, { recursive: true });
    fs.mkdirSync(postgres, { recursive: true });
    for (const directory of [sqlite, postgres]) {
        fs.writeFileSync(
            path.join(directory, '001-initialize.migration.ts'),
            `export const dialect = '${path.basename(directory)}';\n`,
        );
    }
    const checker = new MigrationCatalogChecker(root);

    try {
        checker.generate();
        assert.equal(checker.check(), 1);
        fs.appendFileSync(
            path.join(sqlite, '001-initialize.migration.ts'),
            '// changed\n',
        );
        assert.throws(() => checker.check(), /checksums are stale/);
        fs.writeFileSync(
            path.join(sqlite, '002-next.migration.ts'),
            'export const value = 2;\n',
        );
        assert.throws(() => checker.check(), /pairs are incomplete/);
        fs.renameSync(
            path.join(sqlite, '002-next.migration.ts'),
            path.join(sqlite, '003-next.migration.ts'),
        );
        fs.writeFileSync(
            path.join(postgres, '003-next.migration.ts'),
            'export const value = 3;\n',
        );
        assert.throws(() => checker.check(), /must be contiguous/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
