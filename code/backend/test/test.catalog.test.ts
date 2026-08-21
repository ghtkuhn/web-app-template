import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TestCatalogManager } from '../script/test-catalog/test-catalog.manager.ts';
import { BackendTestRunner } from '../script/test-runner/backend-test.runner.ts';

/** Creates and removes an isolated backend test-catalog fixture. */
class TestCatalogFixture {
    public readonly backendRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'backend-test-catalog-'),
    );

    /** Writes one fixture file relative to the backend root. */
    public write(relativePath: string, source = ''): void {
        const target = path.join(this.backendRoot, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, source, 'utf8');
    }

    /** Reads one fixture file relative to the backend root. */
    public read(relativePath: string): string {
        return fs.readFileSync(path.join(this.backendRoot, relativePath), 'utf8');
    }

    /** Removes the complete fixture. */
    public dispose(): void {
        fs.rmSync(this.backendRoot, { recursive: true, force: true });
    }
}

test('test catalog generation is deterministic and drift checking is read-only', () => {
    const fixture = new TestCatalogFixture();
    try {
        fixture.write('test/zeta.test.ts');
        fixture.write('test/nested/alpha.test.ts');
        fixture.write('src/module/health/test/health.module.test.ts');
        const manager = new TestCatalogManager(fixture.backendRoot);

        assert.equal(manager.generate(), 3);
        const generated = fixture.read('test.catalog.ts');
        assert.ok(generated.indexOf('alpha.test.ts') < generated.indexOf('zeta.test.ts'));
        assert.equal(manager.check(), 3);

        fixture.write('test/new.test.ts');
        assert.throws(() => manager.check(), /catalog is stale/u);
        assert.equal(fixture.read('test.catalog.ts'), generated);
    } finally {
        fixture.dispose();
    }
});

test('central runner executes validated catalog entries exactly once', () => {
    const fixture = new TestCatalogFixture();
    try {
        fixture.write('test/one.test.ts');
        fixture.write('src/module/health/test/two.test.ts');
        let invocation: readonly string[] = [];
        const runner = new BackendTestRunner(
            fixture.backendRoot,
            ['test/one.test.ts', 'src/module/health/test/two.test.ts'],
            (_command, arguments_) => {
                invocation = arguments_;
                return { status: 0 };
            },
        );

        assert.equal(runner.run(), 0);
        assert.deepEqual(invocation, [
            '--test',
            '--test-concurrency=1',
            'test/one.test.ts',
            'src/module/health/test/two.test.ts',
        ]);
    } finally {
        fixture.dispose();
    }
});

test('central runner rejects duplicates, traversal, and missing files', () => {
    const fixture = new TestCatalogFixture();
    try {
        fixture.write('test/one.test.ts');
        assert.throws(
            () =>
                new BackendTestRunner(fixture.backendRoot, [
                    'test/one.test.ts',
                    'test/one.test.ts',
                ]).run(),
            /duplicate/u,
        );
        assert.throws(
            () =>
                new BackendTestRunner(fixture.backendRoot, [
                    '../escape.test.ts',
                ]).run(),
            /Unsafe/u,
        );
        assert.throws(
            () =>
                new BackendTestRunner(fixture.backendRoot, [
                    'test/missing.test.ts',
                ]).run(),
            /Missing/u,
        );
    } finally {
        fixture.dispose();
    }
});
