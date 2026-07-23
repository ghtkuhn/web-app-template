import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import WebSocket, { type RawData } from 'ws';
import type { WebSocketResponseMessage } from '../src/base/interfaces.ts';
import { WebSocketServer } from '../src/base/websocket.server.ts';
import { HealthModule } from '../src/module/health/index.ts';

async function connect(server: WebSocketServer): Promise<WebSocket> {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await once(socket, 'open');
    return socket;
}

async function exchange(
    socket: WebSocket,
    message: unknown,
): Promise<WebSocketResponseMessage> {
    const responsePromise = once(socket, 'message');
    socket.send(
        typeof message === 'string' ? message : JSON.stringify(message),
    );
    const [data] = (await responsePromise) as [RawData];
    return JSON.parse(data.toString()) as WebSocketResponseMessage;
}

test('WebSocket health request returns a correlated response', async () => {
    const server = new WebSocketServer({
        port: 0,
        modules: { health: new HealthModule() },
        heartbeatIntervalMs: 100,
    });
    await server.start();
    const socket = await connect(server);

    try {
        const response = await exchange(socket, {
            id: 'request-1',
            module: 'health',
            event: 'status',
        });
        assert.deepEqual(response, {
            id: 'request-1',
            success: true,
            data: { status: 'ok' },
        });
    } finally {
        socket.terminate();
        await server.stop();
    }
});

test('WebSocket server rejects invalid messages and unknown modules', async () => {
    const server = new WebSocketServer({ port: 0, modules: {} });
    await server.start();
    const socket = await connect(server);

    try {
        assert.deepEqual(await exchange(socket, 'not-json'), {
            id: null,
            success: false,
            error: 'Invalid WebSocket message',
        });
        assert.deepEqual(
            await exchange(socket, {
                id: 'request-2',
                module: 'missing',
                event: 'status',
            }),
            {
                id: 'request-2',
                success: false,
                error: "Unknown module 'missing'.",
            },
        );
    } finally {
        socket.terminate();
        await server.stop();
    }
});

test('WebSocket start and stop have defined repeat behavior', async () => {
    const server = new WebSocketServer({ port: 0, modules: {} });
    await server.start();
    await assert.rejects(server.start(), /already running/);
    await server.stop();
    await server.stop();
    await server.start();
    assert.ok(server.port > 0);
    await server.stop();
});
