import { DatabaseManager } from './base/base.database.ts';
import { HttpServer } from './base/http.server.ts';
import { WebSocketServer } from './base/websocket.server.ts';
import { config } from './config.ts';
import { ModuleRegistry } from './module.registry.ts';
import { pathToFileURL } from 'node:url';
import { MigrationManager } from './base/base.migration.ts';

/**
 * Owns the backend application's startup and shutdown lifecycle.
 */
export class BackendApplication {
    private server: HttpServer | null = null;
    private webSocketServer: WebSocketServer | null = null;
    private shutdownPromise: Promise<void> | null = null;

    /**
     * Initializes infrastructure, registers domain modules, and starts transports.
     */
    public async start(): Promise<void> {
        try {
            console.log('🛠️ Bootstrapping Backend Application...');

            const database = await DatabaseManager.getInstance();
            await MigrationManager.migrate(database);

            const modules = new ModuleRegistry(config.modules.active, {
                database,
                databaseType: config.database.type,
            }).create();
            console.log('📦 Registered Modules:', Object.keys(modules));

            if (config.server.enabled) {
                this.server = new HttpServer({
                    port: config.server.port,
                    modules,
                    allowedOrigins: config.security.allowedOrigins,
                });
                await this.server.start();
                console.log(
                    `🌐 HTTP Server listening on port ${this.server.port}`,
                );
            }

            if (config.websocket.enabled) {
                this.webSocketServer = new WebSocketServer({
                    port: config.websocket.port,
                    modules,
                    maxMessageBytes: config.websocket.maxMessageBytes,
                    heartbeatIntervalMs: config.websocket.heartbeatIntervalMs,
                    allowedOrigins: config.security.allowedOrigins,
                });
                await this.webSocketServer.start();
                console.log(
                    `🔌 WebSocket Server listening on port ${this.webSocketServer.port}`,
                );
            }

            if (config.server.enabled || config.websocket.enabled) {
                this.registerSignalHandlers();
            }
        } catch (error: unknown) {
            console.error('🚨 Critical failure during bootstrap:', error);
            await this.shutdownAfterFailedStart();
            process.exitCode = 1;
        }
    }

    /**
     * Registers one-shot handlers for graceful operating-system shutdown signals.
     */
    private registerSignalHandlers(): void {
        for (const signal of ['SIGINT', 'SIGTERM'] as const) {
            process.once(signal, () => {
                void this.shutdown()
                    .then(() => process.exit(0))
                    .catch((error: unknown) => {
                        console.error('🚨 Shutdown failed:', error);
                        process.exit(1);
                    });
            });
        }
    }

    /**
     * Stops transports and infrastructure exactly once, even for concurrent signals.
     */
    private shutdown(): Promise<void> {
        this.shutdownPromise ??= this.performShutdown();
        return this.shutdownPromise;
    }

    /** Stops transports and application-owned infrastructure exactly once. */
    public stop(): Promise<void> {
        return this.shutdown();
    }

    /**
     * Performs the ordered resource cleanup for a running application.
     */
    private async performShutdown(): Promise<void> {
        console.log('\nShutting down...');
        await this.webSocketServer?.stop();
        this.webSocketServer = null;
        await this.server?.stop();
        this.server = null;
        await DatabaseManager.close();
    }

    /**
     * Best-effort cleanup for partially initialized startup attempts.
     */
    private async shutdownAfterFailedStart(): Promise<void> {
        try {
            await this.shutdown();
        } catch (shutdownError: unknown) {
            console.error(
                '🚨 Cleanup after failed bootstrap failed:',
                shutdownError,
            );
        }
    }
}

if (
    process.argv[1] &&
    import.meta.url === pathToFileURL(process.argv[1]).href
) {
    void new BackendApplication().start();
}
