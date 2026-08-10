import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { BaseHandler } from '../src/base/base.handler.ts';
import { BaseModule } from '../src/base/base.module.ts';
import { HttpServer } from '../src/base/http.server.ts';
import { DelegatedHttpHandler } from '../src/base/delegated.http.handler.ts';
import type { HandlerResult } from '../src/base/interfaces.ts';
import { HealthModule } from '../src/module/health/index.ts';

class TestHandler extends BaseHandler<Request> {
    public request: Request | null = null;
    private readonly result: HandlerResult;

    constructor(result: HandlerResult = { success: true, data: { ok: true } }) {
        super();
        this.result = result;
    }

    protected async processRequest(input: Request): Promise<HandlerResult> {
        this.request = input;
        return this.result;
    }
}

class TestModule extends BaseModule {
    constructor(handler?: TestHandler) {
        super();
        if (handler) this.registerHandler('http', handler);
    }
}

class ThrowingHandler extends BaseHandler {
    protected async processRequest(): Promise<HandlerResult> {
        throw new Error('secret failure details');
    }
}

class FetchProtocolHandler extends DelegatedHttpHandler {
    protected async processRequest(): Promise<Response> {
        const headers = new Headers({
            'content-type': 'application/octet-stream',
            'set-auth-token': 'signed-session',
        });
        headers.append('set-cookie', 'first=1; Path=/');
        headers.append('set-cookie', 'second=2; Path=/');
        return new Response(new Uint8Array([1, 2, 3]), {
            status: 202,
            headers,
        });
    }
}

class StreamingFetchProtocolHandler extends DelegatedHttpHandler {
    public requestWasAborted = false;
    public readerWasCancelled = false;
    private readonly secondChunkDelayMs: number | null;

    constructor(secondChunkDelayMs: number | null) {
        super();
        this.secondChunkDelayMs = secondChunkDelayMs;
    }

    protected async processRequest(input: Request): Promise<Response> {
        input.signal.addEventListener('abort', () => {
            this.requestWasAborted = true;
        });
        const encoder = new TextEncoder();
        const handler = this;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stream = new ReadableStream<Uint8Array>({
            start(controller): void {
                controller.enqueue(encoder.encode('first'));
                if (handler.secondChunkDelayMs !== null) {
                    timer = setTimeout(() => {
                        controller.enqueue(encoder.encode('second'));
                        controller.close();
                    }, handler.secondChunkDelayMs);
                }
            },
            cancel(): void {
                handler.readerWasCancelled = true;
                if (timer) {
                    clearTimeout(timer);
                }
            },
        });
        return new Response(stream);
    }
}

class DelegatedModule extends BaseModule {
    constructor() {
        super();
        this.registerHandler('http', new FetchProtocolHandler());
    }
}

class StreamingDelegatedModule extends BaseModule {
    constructor(handler: StreamingFetchProtocolHandler) {
        super();
        this.registerHandler('http', handler);
    }
}

async function withServer(
    modules: Record<string, BaseModule>,
    run: (server: HttpServer) => Promise<void>,
    maxBodyBytes?: number,
    allowedOrigins?: readonly string[],
): Promise<void> {
    const server = new HttpServer({
        port: 0,
        modules,
        maxBodyBytes,
        allowedOrigins,
    });
    await server.start();
    try {
        await run(server);
    } finally {
        await server.stop();
    }
}

async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (condition()) {
            return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.fail('Timed out waiting for the expected transport state.');
}

test('health module proves the complete HTTP path', async () => {
    await withServer({ health: new HealthModule() }, async (server) => {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/health`,
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            data: { status: 'ok' },
        });
    });
});

test('unknown and unsupported modules return transport errors', async () => {
    await withServer({ empty: new TestModule() }, async (server) => {
        const unavailableHealth = await fetch(
            `http://127.0.0.1:${server.port}/api/health`,
        );
        assert.equal(unavailableHealth.status, 404);
        assert.equal(
            (await fetch(`http://127.0.0.1:${server.port}/api/empty`)).status,
            405,
        );
    });
});

test('request details reach the handler and explicit status is preserved', async () => {
    const handler = new TestHandler({
        success: true,
        data: { created: true },
        statusCode: 201,
    });
    await withServer({ test: new TestModule(handler) }, async (server) => {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/test/item?q=yes`,
            {
                method: 'POST',
                headers: { 'content-type': 'text/plain', 'x-test': 'value' },
                body: 'payload',
            },
        );
        assert.equal(response.status, 201);
        assert.equal(handler.request?.method, 'POST');
        assert.equal(handler.request?.headers.get('x-test'), 'value');
        assert.equal(
            new URL(handler.request?.url ?? '').searchParams.get('q'),
            'yes',
        );
        assert.equal(await handler.request?.text(), 'payload');
    });
});

test('delegated Fetch responses preserve status, headers, cookies, and bytes', async () => {
    await withServer({ protocol: new DelegatedModule() }, async (server) => {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/protocol`,
            { headers: { Origin: 'https://example.test' } },
        );
        assert.equal(response.status, 202);
        assert.equal(response.headers.get('set-auth-token'), 'signed-session');
        assert.equal(
            response.headers.get('access-control-expose-headers'),
            'set-auth-token',
        );
        assert.equal(response.headers.getSetCookie().length, 2);
        assert.deepEqual(
            [...new Uint8Array(await response.arrayBuffer())],
            [1, 2, 3],
        );
    }, undefined, ['https://example.test']);
});

test('delegated Fetch responses deliver the first stream chunk before completion', async () => {
    const handler = new StreamingFetchProtocolHandler(300);
    await withServer(
        { stream: new StreamingDelegatedModule(handler) },
        async (server) => {
            const startedAt = performance.now();
            const response = await fetch(
                `http://127.0.0.1:${server.port}/api/stream`,
            );
            const reader = response.body?.getReader();
            assert.ok(reader);
            const first = await reader.read();
            assert.equal(new TextDecoder().decode(first.value), 'first');
            assert.ok(performance.now() - startedAt < 200);
            const second = await reader.read();
            assert.equal(new TextDecoder().decode(second.value), 'second');
        },
    );
});

test('client disconnect aborts delegated requests and cancels their readers', async () => {
    const handler = new StreamingFetchProtocolHandler(null);
    await withServer(
        { stream: new StreamingDelegatedModule(handler) },
        async (server) => {
            const controller = new AbortController();
            const response = await fetch(
                `http://127.0.0.1:${server.port}/api/stream`,
                { signal: controller.signal },
            );
            const reader = response.body?.getReader();
            assert.ok(reader);
            assert.equal(
                new TextDecoder().decode((await reader.read()).value),
                'first',
            );
            controller.abort();
            await assert.rejects(reader.read());
            await waitFor(
                () => handler.requestWasAborted && handler.readerWasCancelled,
            );
        },
    );
});

test('204 responses contain no body', async () => {
    const handler = new TestHandler({ success: true, statusCode: 204 });
    await withServer({ test: new TestModule(handler) }, async (server) => {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/test`,
        );
        assert.equal(response.status, 204);
        assert.equal(await response.text(), '');
    });
});

test('HEAD responses contain no body', async () => {
    await withServer(
        { test: new TestModule(new TestHandler()) },
        async (server) => {
            const response = await fetch(
                `http://127.0.0.1:${server.port}/api/test`,
                { method: 'HEAD' },
            );
            assert.equal(response.status, 200);
            assert.equal(await response.text(), '');
        },
    );
});

test('handler failures return 500 without internal details', async () => {
    const module = new TestModule();
    module.registerHandler('http', new ThrowingHandler());
    await withServer({ test: module }, async (server) => {
        const response = await fetch(
            `http://127.0.0.1:${server.port}/api/test`,
        );
        assert.equal(response.status, 500);
        const body = await response.text();
        assert.doesNotMatch(body, /at ThrowingHandler/);
        assert.doesNotMatch(body, /secret failure details/);
        assert.match(body, /Internal Server Error/);
    });
});

test('oversized request bodies are rejected', async () => {
    await withServer(
        { test: new TestModule(new TestHandler()) },
        async (server) => {
            const response = await fetch(
                `http://127.0.0.1:${server.port}/api/test`,
                {
                    method: 'POST',
                    body: 'too large',
                },
            );
            assert.equal(response.status, 413);
        },
        3,
    );
});

test('origin policy permits configured origins and rejects others', async () => {
    await withServer(
        { health: new HealthModule() },
        async (server) => {
            const allowed = await fetch(
                `http://127.0.0.1:${server.port}/api/health`,
                { headers: { Origin: 'https://frontend.test' } },
            );
            assert.equal(allowed.status, 200);
            assert.equal(
                allowed.headers.get('access-control-allow-origin'),
                'https://frontend.test',
            );

            const preflight = await fetch(
                `http://127.0.0.1:${server.port}/api/health`,
                {
                    method: 'OPTIONS',
                    headers: { Origin: 'https://frontend.test' },
                },
            );
            assert.equal(preflight.status, 204);

            const rejected = await fetch(
                `http://127.0.0.1:${server.port}/api/health`,
                { headers: { Origin: 'https://other.test' } },
            );
            assert.equal(rejected.status, 403);
        },
        undefined,
        ['https://frontend.test'],
    );
});

test('start and stop have defined repeat behavior', async () => {
    const server = new HttpServer({ port: 0, modules: {} });
    await server.start();
    await assert.rejects(server.start(), /already running/);
    const releasedPort = server.port;
    await server.stop();
    await server.stop();

    const probe = createServer();
    await new Promise<void>((resolve) =>
        probe.listen(releasedPort, '127.0.0.1', resolve),
    );
    await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
    );

    await server.start();
    assert.ok(server.port > 0);
    await server.stop();
});
