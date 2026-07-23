import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/** Executes the real CLI entry point with an isolated SQLite database. */
class CliApplicationFixture {
    private readonly directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'backend-cli-'),
    );
    private readonly backendRoot = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '..',
    );

    /** Runs one CLI command in a separate process. */
    public run(arguments_: readonly string[]) {
        return spawnSync(
            process.execPath,
            ['src/cli.ts', ...arguments_],
            {
                cwd: this.backendRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    DB_TYPE: 'sqlite',
                    DB_SQLITE_PATH: path.join(
                        this.directory,
                        'cli.sqlite',
                    ),
                },
            },
        );
    }

    /** Removes the isolated database directory. */
    public dispose(): void {
        fs.rmSync(this.directory, { recursive: true, force: true });
    }
}

test('CLI initializes and closes database infrastructure on success', () => {
    const fixture = new CliApplicationFixture();
    try {
        const result = fixture.run(['health', 'status']);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Initializing Database Connection/);
        assert.match(result.stdout, /"status": "ok"/);
        assert.match(result.stdout, /Database Connection Closed/);
    } finally {
        fixture.dispose();
    }
});

test('CLI closes database infrastructure after a rejected command', () => {
    const fixture = new CliApplicationFixture();
    try {
        const result = fixture.run(['missing', 'command']);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Unknown module/);
        assert.match(result.stdout, /Database Connection Closed/);
    } finally {
        fixture.dispose();
    }
});
