import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import WebSocket, {
    type RawData,
    WebSocketServer as NativeWebSocketServer,
} from 'ws';
import type { BaseModule } from './base.module.ts';
import type {
    HandlerResult,
    WebSocketRequestMessage,
    WebSocketResponseMessage,
    WebSocketServerConfig,
} from './interfaces.ts';

/** Binds module gateways to a JSON WebSocket request-response transport. */
export class WebSocketServer {
    private readonly configuredPort: number;
    private readonly modules: Map<string, BaseModule>;
    private readonly maxMessageBytes: number;
    private readonly heartbeatIntervalMs: number;
    private readonly allowedOrigins: ReadonlySet<string>;
    private server: NativeWebSocketServer | null = null;
    private heartbeat: NodeJS.Timeout | null = null;
    private readonly responsiveClients = new WeakSet<WebSocket>();

    /**
     * Creates a stopped WebSocket server.
     *
     * @param config Port, module gateways, message limits, heartbeat, and origins.
     */
    constructor(config: WebSocketServerConfig) {
        this.configuredPort = config.port;
        this.modules = new Map(Object.entries(config.modules));
        this.maxMessageBytes = config.maxMessageBytes ?? 1_048_576;
        this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 30_000;
        this.allowedOrigins = new Set(config.allowedOrigins ?? []);
    }

    /** Returns the active port, including an OS-assigned port after binding to `0`. */
    public get port(): number {
        const address = this.server?.address();
        return address && typeof address !== 'string'
            ? (address as AddressInfo).port
            : this.configuredPort;
    }

    /** Starts accepting WebSocket connections and installs heartbeat monitoring. */
    public async start(): Promise<void> {
        if (this.server) {
            throw new Error('WebSocket server is already running.');
        }

        const server = new NativeWebSocketServer({
            port: this.configuredPort,
            maxPayload: this.maxMessageBytes,
            verifyClient: ({ origin }, callback) => {
                callback(
                    !origin || this.allowedOrigins.has(origin),
                    403,
                    'Forbidden',
                );
            },
        });
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
        });

        server.on('connection', (socket) => this.registerClient(socket));
        this.startHeartbeat(server);
    }

    /** Closes clients and waits until the listening socket is released. */
    public async stop(): Promise<void> {
        const server = this.server;
        if (!server) {
            return;
        }

        this.server = null;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
            this.heartbeat = null;
        }
        for (const client of server.clients) {
            client.terminate();
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }

    /** Registers message, heartbeat, and error handling for one connection. */
    private registerClient(socket: WebSocket): void {
        const connectionId = randomUUID();
        this.responsiveClients.add(socket);
        socket.on('pong', () => this.responsiveClients.add(socket));
        socket.on('error', () => undefined);
        socket.on('message', (data) => {
            void this.handleMessage(socket, connectionId, data);
        });
    }

    /** Parses and dispatches one WebSocket request envelope. */
    private async handleMessage(
        socket: WebSocket,
        connectionId: string,
        rawData: RawData,
    ): Promise<void> {
        let message: WebSocketRequestMessage | null = null;
        try {
            message = this.parseMessage(rawData);
            if (!message) {
                this.send(socket, {
                    id: null,
                    success: false,
                    error: 'Invalid WebSocket message',
                });
                return;
            }

            const module = this.modules.get(message.module);
            if (!module) {
                this.send(socket, {
                    id: message.id,
                    success: false,
                    error: `Unknown module '${message.module}'.`,
                });
                return;
            }

            const result = await module.dispatch('websocket', {
                event: message.event,
                data: message.data,
                connectionId,
            });
            this.sendResult(socket, message.id, result);
        } catch {
            this.send(socket, {
                id: message?.id ?? null,
                success: false,
                error: 'Invalid WebSocket message',
            });
        }
    }

    /** Parses JSON and validates the required request-envelope properties. */
    private parseMessage(rawData: RawData): WebSocketRequestMessage | null {
        const value: unknown = JSON.parse(rawData.toString());
        if (typeof value !== 'object' || value === null) {
            return null;
        }
        if (!('id' in value) || typeof value.id !== 'string') {
            return null;
        }
        if (!('module' in value) || typeof value.module !== 'string') {
            return null;
        }
        if (!('event' in value) || typeof value.event !== 'string') {
            return null;
        }
        return {
            id: value.id,
            module: value.module,
            event: value.event,
            data: 'data' in value ? value.data : undefined,
        };
    }

    /** Converts a handler result into its correlated response envelope. */
    private sendResult(
        socket: WebSocket,
        id: string,
        result: HandlerResult,
    ): void {
        if (result.success) {
            this.send(socket, { id, success: true, data: result.data });
            return;
        }
        this.send(socket, {
            id,
            success: false,
            error: result.error ?? 'WebSocket request failed',
        });
    }

    /** Sends a response only while the client connection remains writable. */
    private send(socket: WebSocket, message: WebSocketResponseMessage): void {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        }
    }

    /** Terminates clients that fail to answer one complete ping interval. */
    private startHeartbeat(server: NativeWebSocketServer): void {
        this.heartbeat = setInterval(() => {
            for (const client of server.clients) {
                if (!this.responsiveClients.has(client)) {
                    client.terminate();
                    continue;
                }
                this.responsiveClients.delete(client);
                client.ping();
            }
        }, this.heartbeatIntervalMs);
        this.heartbeat.unref();
    }
}
