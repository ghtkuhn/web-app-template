import { DatabaseManager } from './base.database.ts';
import { BaseModule } from './base.module.ts';

/**
 * HttpServer is a transport-layer implementation that binds
 * the Module Gateway system to an HTTP interface.
 */
export class HttpServer {
    private port: number;
    private modules: Map<string, BaseModule>;

    constructor(config: { port: number; modules: Record<string, BaseModule> }) {
        this.port = config.port;
        this.modules = new Map(Object.entries(config.modules));
    }

    /**
     * Starts the HTTP server and begins listening for requests.
     */
    public async start(): Promise<void> {
        console.log(`🚀 HTTP Server starting on port ${this.port}...`);

        // In a real implementation, this would use 'node:http' or a framework like Fastify/Express
        // and route requests to the corresponding module via BaseModule.dispatch('http', request)

        console.log(`✅ HTTP Server is listening. Modules registered: ${Array.from(this.modules.keys()).join(', ')}`);
    }

    /**
     * Stops the server gracefully.
     */
    public async stop(): Promise<void> {
        console.log('🛑 Stopping HTTP Server...');
    }
}
