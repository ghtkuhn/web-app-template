import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { StoreMigrationInspector } from '../script/store-migration-status/store-migration.inspector.ts';

test('Store migration status reports generic methods without changing files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'store-status-'));
    const store = path.join(root, 'src/module/example/store/example.store.ts');
    const operation = path.join(
        root,
        'src/module/example/service/example/list.operation.ts',
    );
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.mkdirSync(path.dirname(operation), { recursive: true });
    fs.writeFileSync(
        store,
        "// findById() is documentation only.\n" +
            "const example = 'save()';\n" +
            'class Store { findAll() { return []; } }\n',
    );
    fs.writeFileSync(
        operation,
        "// this.store.delete() is documentation only.\n" +
            'class Operation { execute() { return this.store.findAll(); } }\n',
    );
    const originalStore = fs.readFileSync(store, 'utf8');

    try {
        assert.deepEqual(new StoreMigrationInspector(root).inspect(), [
            {
                file: 'src/module/example/service/example/list.operation.ts',
                kind: 'operation-call',
                line: 2,
                method: 'findAll',
            },
            {
                file: 'src/module/example/store/example.store.ts',
                kind: 'store-method',
                line: 3,
                method: 'findAll',
            },
        ]);
        assert.equal(fs.readFileSync(store, 'utf8'), originalStore);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
