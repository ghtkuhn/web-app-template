import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseManager } from '../src/base/base.database.ts';
import { config } from '../src/config.ts';
import { BackendApplication } from '../src/index.ts';

test('backend stop closes application-owned database infrastructure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-app-'));
    const originalHttp = config.server.enabled;
    const originalWebSocket = config.websocket.enabled;
    const originalPath = config.database.sqlitePath;
    const originalType = config.database.type;
    config.server.enabled = false;
    config.websocket.enabled = false;
    config.database.type = 'sqlite';
    config.database.sqlitePath = path.join(directory, 'application.sqlite');

    try {
        const application = new BackendApplication();
        await application.start();
        const first = await DatabaseManager.getInstance();
        await application.stop();
        const recreated = await DatabaseManager.getInstance();
        assert.notEqual(recreated, first);
    } finally {
        await DatabaseManager.close();
        config.server.enabled = originalHttp;
        config.websocket.enabled = originalWebSocket;
        config.database.sqlitePath = originalPath;
        config.database.type = originalType;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backend startup failure releases partially initialized infrastructure', async () => {
    const originalHttp = config.server.enabled;
    const originalWebSocket = config.websocket.enabled;
    const originalType = config.database.type;
    const originalExitCode = process.exitCode;
    config.server.enabled = false;
    config.websocket.enabled = false;
    config.database.type = 'postgres';
    process.exitCode = undefined;

    try {
        await new BackendApplication().start();
        assert.equal(process.exitCode, 1);
        await assert.rejects(
            DatabaseManager.getInstance(),
            /Unsupported database type 'postgres'/,
        );
    } finally {
        await DatabaseManager.close();
        config.server.enabled = originalHttp;
        config.websocket.enabled = originalWebSocket;
        config.database.type = originalType;
        process.exitCode = originalExitCode;
    }
});
