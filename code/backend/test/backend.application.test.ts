import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DatabaseManager } from '../src/base/base.database.ts';
import {
    config,
    HttpTransportConfigLoader,
} from '../src/config.ts';
import { BackendApplication } from '../src/index.ts';

test('HTTP transport configuration validates limits and preserves defaults', () => {
    assert.deepEqual(HttpTransportConfigLoader.load({}), {
        enabled: true,
        port: 3000,
        nodeEnv: 'development',
        maxBodyBytes: 1_048_576,
        requestTimeoutMs: 30_000,
        headersTimeoutMs: 10_000,
    });
    assert.deepEqual(
        HttpTransportConfigLoader.load({
            HTTP_ENABLED: 'false',
            PORT: '4100',
            NODE_ENV: 'test',
            HTTP_MAX_BODY_BYTES: '2048',
            HTTP_REQUEST_TIMEOUT_MS: '45000',
            HTTP_HEADERS_TIMEOUT_MS: '12000',
        }),
        {
            enabled: false,
            port: 4100,
            nodeEnv: 'test',
            maxBodyBytes: 2048,
            requestTimeoutMs: 45_000,
            headersTimeoutMs: 12_000,
        },
    );

    for (const [name, value] of [
        ['HTTP_MAX_BODY_BYTES', '0'],
        ['HTTP_REQUEST_TIMEOUT_MS', '-1'],
        ['HTTP_HEADERS_TIMEOUT_MS', 'invalid'],
    ] as const) {
        assert.throws(
            () => HttpTransportConfigLoader.load({ [name]: value }),
            new RegExp(`${name} must be a positive integer`),
        );
    }
});

test('backend stop closes application-owned database infrastructure', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-app-'));
    const originalHttp = config.server.enabled;
    const originalWebSocket = config.websocket.enabled;
    const originalDatabase = config.database;
    config.server.enabled = false;
    config.websocket.enabled = false;
    config.database = {
        type: 'sqlite',
        sqlitePath: path.join(directory, 'application.sqlite'),
        backupRetention: 10,
        releaseId: 'test',
    };

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
        config.database = originalDatabase;
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('backend startup failure releases partially initialized infrastructure', async (context) => {
    const originalHttp = config.server.enabled;
    const originalWebSocket = config.websocket.enabled;
    const originalDatabase = config.database;
    const originalExitCode = process.exitCode;
    const loggedErrors: unknown[][] = [];
    context.mock.method(console, 'error', (...arguments_: unknown[]) => {
        loggedErrors.push(arguments_);
    });
    config.server.enabled = false;
    config.websocket.enabled = false;
    config.database = {
        type: 'postgres',
        connectionString: 'postgresql://user:secret@127.0.0.1:1/database',
        poolMax: 1,
        idleTimeoutMs: 10,
        connectionTimeoutMs: 10,
        releaseId: 'test',
    };
    process.exitCode = undefined;

    try {
        const initialized = await DatabaseManager.getInstance();
        await new BackendApplication().start();
        assert.equal(process.exitCode, 1);
        assert.equal(loggedErrors.length, 1);
        assert.equal(loggedErrors[0]?.[0], '🚨 Critical failure during bootstrap:');
        const recreated = await DatabaseManager.getInstance();
        assert.notEqual(recreated, initialized);
    } finally {
        await DatabaseManager.close();
        config.server.enabled = originalHttp;
        config.websocket.enabled = originalWebSocket;
        config.database = originalDatabase;
        process.exitCode = originalExitCode;
    }
});
