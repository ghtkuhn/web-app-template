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
        const abortController = new AbortController();
        const deadlineTimer = setTimeout(() => {
            abortController.abort(this.createTransportError(408));
        }, this.requestTimeoutMs);
        deadlineTimer.unref();
        const abortRequest = (): void => {
            if (!abortController.signal.aborted) {
                abortController.abort();
            }
        };
        const abortOnResponseClose = (): void => {
            if (!response.writableEnded) {
                abortRequest();
            }
        };
        request.once('aborted', abortRequest);
        response.once('close', abortOnResponseClose);
        try {
            await this.processRequest(
                request,
                response,
                abortController.signal,
            );
        } catch (error: unknown) {
            await this.writeTransportFailure(request, response, error);
        } finally {
            clearTimeout(deadlineTimer);
            request.off('aborted', abortRequest);
            response.off('close', abortOnResponseClose);
        }
    }

    /** Applies transport policy, resolves a module, and delegates one request. */
    private async processRequest(
        request: IncomingMessage,
        response: ServerResponse,
        signal: AbortSignal,
    ): Promise<void> {
        if (!this.applyOriginPolicy(request, response)) {
            await this.writeResult(
                response,
                { success: false, error: 'Forbidden', statusCode: 403 },
                request.method,
                signal,
            );
            return;
        }
        if (request.method === 'OPTIONS') {
            response.statusCode = 204;
            await this.endResponse(response, undefined, signal);
            return;
        }
        const route = this.resolveRoute(request);
        if (!route) {
            await this.writeResult(
                response,
                { success: false, error: 'Not found', statusCode: 404 },
                request.method,
                signal,
            );
            return;
        }
        const webRequest = await this.createWebRequest(
            request,
            route.url,
            signal,
        );
        const result = await this.awaitWithSignal(
            route.module.dispatch('http', webRequest),
            signal,
        );
        await this.writeResult(response, result, request.method, signal);
    }

    /** Resolves only the module segment while preserving the complete public URL. */
    private resolveRoute(
        request: IncomingMessage,
    ): { url: URL; module: BaseModule } | null {
        const url = this.createRequestUrl(request);
        const module = this.modules.get(this.getModuleName(url));
        return module ? { url, module } : null;
    }

    /** Builds the absolute Fetch URL from one native request. */
    private createRequestUrl(request: IncomingMessage): URL {
        const host = request.headers.host ?? `localhost:${this.port}`;
        return new URL(request.url ?? '/', `http://${host}`);
    }

    /** Extracts the module owner from the literal public API route contract. */
    private getModuleName(url: URL): string {
        return /^\/api\/([^/]+)(?:\/|$)/u.exec(url.pathname)?.[1] ?? '';
    }

    /** Writes one safe transport error unless the socket already owns a response. */
    private async writeTransportFailure(
        request: IncomingMessage,
        response: ServerResponse,
        error: unknown,
    ): Promise<void> {
        if (response.headersSent || response.destroyed) {
            return;
        }
        const statusCode = this.getTransportStatus(error);
        await this.writeResult(
            response,
            {
                success: false,
                error: this.getTransportMessage(statusCode),
                statusCode,
            },
            request.method,
        );
    }

    /** Maps one controlled transport status to its stable public message. */
    private getTransportMessage(statusCode: number): string {
        if (statusCode === 408) {
            return 'Request timed out';
        }
        if (statusCode === 413) {
            return 'Request body too large';
        }
        return 'Invalid request';
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
        signal: AbortSignal,
    ): Promise<Request> {
        const method = request.method ?? 'GET';
        const body =
            method === 'GET' || method === 'HEAD'
                ? undefined
                : await this.readBody(request, signal);

        return new Request(url, {
            method,
            headers: new Headers(request.headers as Record<string, string>),
            body: body?.length ? new Uint8Array(body) : undefined,
            signal,
        });
    }

    /**
     * Buffers the incoming body while enforcing the configured byte limit.
     */
    private async readBody(
        request: IncomingMessage,
        signal: AbortSignal,
    ): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;

            const cleanup = (): void => {
                request.off('data', onData);
                request.off('end', onEnd);
                request.off('aborted', onAborted);
                request.off('error', onError);
                signal.removeEventListener('abort', onSignalAbort);
            };
            const settle = (
                complete: () => void,
            ): void => {
                cleanup();
                complete();
            };
            const onData = (chunk: Buffer): void => {
                totalBytes += chunk.length;
                if (totalBytes > this.maxBodyBytes) {
                    settle(() => reject(this.createTransportError(413)));
                    request.resume();
                    return;
                }
                chunks.push(chunk);
            };
            const onEnd = (): void => {
                settle(() => resolve(Buffer.concat(chunks)));
            };
            const onAborted = (): void => {
                settle(() => reject(new Error('Request aborted')));
            };
            const onError = (error: Error): void => {
                settle(() => reject(error));
            };
            const onSignalAbort = (): void => {
                settle(() => reject(signal.reason));
                request.resume();
            };

            request.on('data', onData);
            request.once('end', onEnd);
            request.once('aborted', onAborted);
            request.once('error', onError);
            signal.addEventListener('abort', onSignalAbort, { once: true });
            if (signal.aborted) {
                onSignalAbort();
            }
        });
    }

    /** Rejects pending work as soon as its request signal reaches a terminal state. */
    private async awaitWithSignal<T>(
        work: Promise<T>,
        signal: AbortSignal,
    ): Promise<T> {
        if (signal.aborted) {
            throw signal.reason;
        }
        return new Promise<T>((resolve, reject) => {
            const onAbort = (): void => {
                reject(signal.reason);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            work.then(resolve, reject).finally(() => {
                signal.removeEventListener('abort', onAbort);
            });
        });
    }

    /** Creates one status-bearing error for controlled transport failures. */
    private createTransportError(statusCode: 408 | 413): Error {
        const error = new Error(
            statusCode === 408
                ? 'Request timed out'
                : 'Request body too large',
        ) as Error & { statusCode: number };
        error.statusCode = statusCode;
        return error;
    }

    /**
     * Maps known transport failures to safe client-facing HTTP status codes.
     */
    private getTransportStatus(error: unknown): number {
        if (
            typeof error === 'object' &&
            error !== null &&
            'statusCode' in error &&
            (error.statusCode === 408 || error.statusCode === 413)
        ) {
            return error.statusCode;
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
        signal?: AbortSignal,
    ): Promise<void> {
        if (result instanceof Response) {
            await this.writeFetchResponse(response, result, method, signal);
            return;
        }
        const statusCode = result.statusCode ?? (result.success ? 200 : 500);
        response.statusCode = statusCode;
        response.setHeader('X-Content-Type-Options', 'nosniff');

        if (statusCode === 204 || method === 'HEAD') {
            await this.endResponse(response, undefined, signal);
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
        await this.endResponse(response, JSON.stringify(payload), signal);
    }

    /** Writes a delegated Fetch response without replacing protocol semantics. */
    private async writeFetchResponse(
        response: ServerResponse,
        result: Response,
        method?: string,
        signal?: AbortSignal,
    ): Promise<void> {
        response.statusCode = result.status;
        this.copyFetchHeaders(response, result.headers);
        response.setHeader('X-Content-Type-Options', 'nosniff');
        if (this.hasNoResponseBody(result, method)) {
            await this.endResponse(response, undefined, signal);
            return;
        }
        const reader = result.body?.getReader();
        if (!reader) {
            await this.endResponse(response, undefined, signal);
            return;
        }
        await this.writeResponseBody(response, reader, signal);
    }

    /** Streams a Fetch body while retaining cancellation ownership at the transport boundary. */
    private async writeResponseBody(
        response: ServerResponse,
        reader: ReadableStreamDefaultReader<Uint8Array>,
        signal?: AbortSignal,
    ): Promise<void> {
        const cancelReader = (): void => {
            void reader.cancel().catch(() => undefined);
        };
        signal?.addEventListener('abort', cancelReader, { once: true });

        try {
            await this.copyResponseChunks(response, reader, signal);
        } catch (error: unknown) {
            this.destroyFailedResponse(response, error, signal);
        } finally {
            this.closeAbortedResponse(response, signal);
            signal?.removeEventListener('abort', cancelReader);
            reader.releaseLock();
        }
    }

    /** Closes an unfinished response after deadline or disconnect cancellation. */
    private closeAbortedResponse(
        response: ServerResponse,
        signal?: AbortSignal,
    ): void {
        if (signal?.aborted && !response.destroyed) {
            response.destroy();
        }
    }

    /** Copies available Fetch chunks until either stream reaches a terminal state. */
    private async copyResponseChunks(
        response: ServerResponse,
        reader: ReadableStreamDefaultReader<Uint8Array>,
        signal?: AbortSignal,
    ): Promise<void> {
        while (this.canWriteResponse(response, signal)) {
            const chunk = await reader.read();
            if (chunk.done) {
                break;
            }
            await this.writeResponseChunk(response, chunk.value, signal);
        }
        await this.endResponseIfOpen(response, signal);
    }

    /** Determines whether the connection can accept another source chunk. */
    private canWriteResponse(response: ServerResponse, signal?: AbortSignal): boolean {
        if (signal?.aborted) {
            return false;
        }
        return !response.destroyed;
    }

    /** Ends a response only while the connection is still writable. */
    // fallow-ignore-next-line complexity -- Abort, destruction, and completion are independent socket states.
    private async endResponseIfOpen(
        response: ServerResponse,
        signal?: AbortSignal,
    ): Promise<void> {
        if (signal?.aborted) {
            return;
        }
        if (response.destroyed) {
            return;
        }
        if (response.writableEnded) {
            return;
        }
        await this.endResponse(response, undefined, signal);
    }

    /** Ends one response and waits for flush, disconnect, failure, or cancellation. */
    private async endResponse(
        response: ServerResponse,
        body?: string,
        signal?: AbortSignal,
    ): Promise<void> {
        if (response.destroyed || response.writableEnded) {
            return;
        }
        await new Promise<void>((resolve, reject) => {
            const cleanup = (): void => {
                response.off('close', onClose);
                response.off('error', onError);
                signal?.removeEventListener('abort', onAbort);
            };
            const complete = (): void => {
                cleanup();
                resolve();
            };
            const onClose = (): void => {
                complete();
            };
            const onError = (error: Error): void => {
                cleanup();
                reject(error);
            };
            const onAbort = (): void => {
                if (!response.destroyed) {
                    response.destroy();
                }
                complete();
            };
            response.once('close', onClose);
            response.once('error', onError);
            signal?.addEventListener('abort', onAbort, { once: true });
            response.end(body, complete);
            if (signal?.aborted) {
                onAbort();
            }
        });
    }

    /** Writes one chunk and waits for the writable socket when its buffer is full. */
    private async writeResponseChunk(
        response: ServerResponse,
        chunk: Uint8Array,
        signal?: AbortSignal,
    ): Promise<void> {
        if (!response.write(chunk)) {
            await this.waitForDrain(response, signal);
        }
    }

    /** Destroys a partially written response only when cancellation did not cause the failure. */
    // fallow-ignore-next-line complexity -- Cancellation and socket destruction require independent failure guards.
    private destroyFailedResponse(
        response: ServerResponse,
        error: unknown,
        signal?: AbortSignal,
    ): void {
        if (signal?.aborted) {
            return;
        }
        if (response.destroyed) {
            return;
        }
        response.destroy(error instanceof Error ? error : undefined);
    }

    /** Waits for writable capacity or stops promptly when the client disconnects. */
    private async waitForDrain(
        response: ServerResponse,
        signal?: AbortSignal,
    ): Promise<void> {
        if (signal?.aborted || response.destroyed) {
            return;
        }
        await new Promise<void>((resolve) => {
            const complete = (): void => {
                response.off('drain', complete);
                response.off('close', complete);
                response.off('error', complete);
                signal?.removeEventListener('abort', complete);
                resolve();
            };
            response.once('drain', complete);
            response.once('close', complete);
            response.once('error', complete);
            signal?.addEventListener('abort', complete, { once: true });
            if (signal?.aborted || response.destroyed) {
                complete();
            }
        });
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
