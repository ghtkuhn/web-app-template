import {
    createServer,
    IncomingMessage,
    Server,
    ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { BaseModule } from './base.module.ts';
import type {
    HandlerResult,
    HttpDispatchResult,
    HttpServerConfig,
} from './interfaces.ts';

/**
 * Binds the module gateway to a native Node HTTP transport.
 *
 * The server owns transport concerns only: socket lifecycle, module selection,
 * conversion to Fetch API requests, response serialization, and transport-level
 * errors. Endpoint interpretation remains inside each module's HTTP handler.
 */
export class HttpServer {
    private readonly configuredPort: number;
    private readonly modules: Map<string, BaseModule>;
    private readonly maxBodyBytes: number;
    private readonly requestTimeoutMs: number;
    private readonly headersTimeoutMs: number;
    private readonly allowedOrigins: ReadonlySet<string>;
    private server: Server | null = null;

    /**
     * Creates a stopped HTTP server using the provided module registry.
     *
     * @param config Port, module gateways, transport limits, and origin policy.
     */
    constructor(config: HttpServerConfig) {
        this.configuredPort = config.port;
        this.modules = new Map(Object.entries(config.modules));
        this.maxBodyBytes = config.maxBodyBytes ?? 1_048_576;
        this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
        this.headersTimeoutMs = config.headersTimeoutMs ?? 10_000;
        this.allowedOrigins = new Set(config.allowedOrigins ?? []);
    }

    /**
     * Returns the active TCP port, including an OS-assigned port after binding to `0`.
     */
    public get port(): number {
        const address = this.server?.address();
        return address && typeof address !== 'string'
            ? (address as AddressInfo).port
            : this.configuredPort;
    }

    /**
     * Creates the native server and waits until its listening socket is ready.
     *
     * @throws Error when the server is already running or the socket cannot bind.
     */
    public async start(): Promise<void> {
        if (this.server) {
            throw new Error('HTTP server is already running.');
        }

        const server = createServer((request, response) => {
            void this.handleRequest(request, response);
        });
        server.requestTimeout = this.requestTimeoutMs;
        server.headersTimeout = this.headersTimeoutMs;
        // Assign before listening so concurrent start calls cannot create two servers.
        this.server = server;

        await new Promise<void>((resolve, reject) => {
            const onError = (error: Error) => {
                server.off('listening', onListening);
                this.server = null;
                reject(error);
            };
            const onListening = () => {
                server.off('error', onError);
                resolve();
            };

            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(this.configuredPort);
        });
    }

    /**
     * Stops accepting connections and waits until the listening socket is closed.
     * Calling this method while stopped is safe.
     */
    public async stop(): Promise<void> {
        const server = this.server;
        if (!server) {
            return;
        }

        this.server = null;
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeIdleConnections();
        });
    }

    /**
     * Resolves the target module, dispatches a Fetch API request, and writes its result.
     */
    private async handleRequest(
        request: IncomingMessage,
        response: ServerResponse,
    ): Promise<void> {
        try {
            if (!this.applyOriginPolicy(request, response)) {
                await this.writeResult(
                    response,
                    { success: false, error: 'Forbidden', statusCode: 403 },
                    request.method,
                );
                return;
            }
            if (request.method === 'OPTIONS') {
                response.statusCode = 204;
                response.end();
                return;
            }
            const host = request.headers.host ?? `localhost:${this.port}`;
            const url = new URL(request.url ?? '/', `http://${host}`);
            const segments = url.pathname.split('/').filter(Boolean);

            if (segments[0] !== 'api' || !segments[1]) {
                await this.writeResult(
                    response,
                    { success: false, error: 'Not found', statusCode: 404 },
                    request.method,
                );
                return;
            }

            // The transport selects only the module; the handler owns the remaining path.
            const module = this.modules.get(segments[1]);
            if (!module) {
                await this.writeResult(
                    response,
                    { success: false, error: 'Not found', statusCode: 404 },
                    request.method,
                );
                return;
            }

            const webRequest = await this.createWebRequest(request, url);
            const result = await module.dispatch('http', webRequest);
            await this.writeResult(response, result, request.method);
        } catch (error: unknown) {
            // Do not attempt a second response after a socket-level failure or disconnect.
            if (response.headersSent || response.destroyed) {
                return;
            }

            const statusCode = this.getTransportStatus(error);
            const message =
                statusCode === 413
                    ? 'Request body too large'
                    : 'Invalid request';
            await this.writeResult(
                response,
                { success: false, error: message, statusCode },
                request.method,
            );
        }
    }

    /** Applies strict browser-origin and preflight response headers. */
    private applyOriginPolicy(
        request: IncomingMessage,
        response: ServerResponse,
    ): boolean {
        const origin = request.headers.origin;
        if (!origin) {
            return true;
        }
        if (!this.allowedOrigins.has(origin)) {
            return false;
        }
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        response.setHeader('Access-Control-Expose-Headers', 'set-auth-token');
        response.setHeader('Vary', 'Origin');
        return true;
    }

    /**
     * Converts a Node request into the transport contract consumed by HTTP handlers.
     */
    private async createWebRequest(
        request: IncomingMessage,
        url: URL,
    ): Promise<Request> {
        const method = request.method ?? 'GET';
        const body =
            method === 'GET' || method === 'HEAD'
                ? undefined
                : await this.readBody(request);

        return new Request(url, {
            method,
            headers: new Headers(request.headers as Record<string, string>),
            body: body?.length ? new Uint8Array(body) : undefined,
        });
    }

    /**
     * Buffers the incoming body while enforcing the configured byte limit.
     */
    private async readBody(request: IncomingMessage): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;

            request.on('data', (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > this.maxBodyBytes) {
                    const error = new Error(
                        'Request body too large',
                    ) as Error & { statusCode: number };
                    error.statusCode = 413;
                    reject(error);
                    // Drain the remaining stream so the connection can be reused safely.
                    request.resume();
                    return;
                }
                chunks.push(chunk);
            });
            request.once('end', () => resolve(Buffer.concat(chunks)));
            request.once('aborted', () => reject(new Error('Request aborted')));
            request.once('error', reject);
        });
    }

    /**
     * Maps known transport failures to safe client-facing HTTP status codes.
     */
    private getTransportStatus(error: unknown): number {
        if (
            typeof error === 'object' &&
            error !== null &&
            'statusCode' in error &&
            error.statusCode === 413
        ) {
            return 413;
        }
        return 400;
    }

    /**
     * Serializes a transport-neutral handler result into the public JSON envelope.
     */
    private async writeResult(
        response: ServerResponse,
        result: HttpDispatchResult,
        method?: string,
    ): Promise<void> {
        if (result instanceof Response) {
            await this.writeFetchResponse(response, result, method);
            return;
        }
        const statusCode = result.statusCode ?? (result.success ? 200 : 500);
        response.statusCode = statusCode;
        response.setHeader('X-Content-Type-Options', 'nosniff');

        if (statusCode === 204 || method === 'HEAD') {
            response.end();
            return;
        }

        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        let payload: { success: boolean; data?: unknown; error?: string };
        if (result.success) {
            payload = { success: true, data: result.data };
        } else {
            payload = {
                success: false,
                error: result.error ?? 'Internal Server Error',
            };
        }
        response.end(JSON.stringify(payload));
    }

    /** Writes a delegated Fetch response without replacing protocol semantics. */
    private async writeFetchResponse(
        response: ServerResponse,
        result: Response,
        method?: string,
    ): Promise<void> {
        response.statusCode = result.status;
        this.copyFetchHeaders(response, result.headers);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (this.hasNoResponseBody(result, method)) {
            response.end();
            return;
        }
        response.end(Buffer.from(await result.arrayBuffer()));
    }

    /** Copies Fetch headers while preserving multiple Set-Cookie values. */
    private copyFetchHeaders(
        response: ServerResponse,
        headers: Headers,
    ): void {
        for (const [name, value] of headers) {
            if (name.toLowerCase() !== 'set-cookie') {
                response.setHeader(name, value);
            }
        }
        const cookies = headers.getSetCookie();
        if (cookies.length > 0) {
            response.setHeader('Set-Cookie', cookies);
        }
    }

    /** Determines whether HTTP semantics prohibit a response body. */
    private hasNoResponseBody(result: Response, method?: string): boolean {
        return result.status === 204 || method === 'HEAD' || !result.body;
    }
}
