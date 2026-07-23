import type { BaseModule } from './base.module.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../database.ts';

/** Transport gateways supported by every module. */
export type TransportType = 'http' | 'websocket' | 'cli' | 'node';

/** Writes serialized CLI output to a stream-like destination. */
export interface OutputWriter {
    write(chunk: string): unknown;
}

export interface IBaseObject {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    isDeleted: boolean;
    deletedAt?: Date;
    validate(): void;
    toJSON(): unknown;
    softDelete(): void;
}

export interface IBaseDTO {}

export interface IEntityDTO<T extends IBaseObject> extends IBaseDTO {
    id: string;
    fromObject(object: T): this;
    toObject(): Partial<T>;
}

export interface IBaseStore<T extends IBaseObject> {
    save(object: T): Promise<T>;
    findById(id: string): Promise<T | null>;
    findAll(): Promise<T[]>;
    delete(id: string): Promise<void>;
}

/** Marker contract for private API-layer auxiliary classes. */
export interface IBaseApiAux {}

/** Marker contract for private controller-layer auxiliary classes. */
export interface IBaseControllerAux {}

/** Marker contract for private service-layer auxiliary classes. */
export interface IBaseServiceAux {}

/** Marker contract for private store-layer auxiliary classes. */
export interface IBaseStoreAux {}

export interface IBaseService<T extends IBaseObject> {
    createOrUpdate(object: T): Promise<T>;
    getById(id: string): Promise<T>;
    getAll(): Promise<T[]>;
}

/** Configuration accepted by the native HTTP transport. */
export interface HttpServerConfig {
    /** TCP port to bind. Use `0` to let the operating system select a free port. */
    port: number;
    /** Domain modules addressable through `/api/<module>`. */
    modules: Record<string, BaseModule>;
    /** Maximum buffered request-body size in bytes. Defaults to one MiB. */
    maxBodyBytes?: number;
    /** Maximum time in milliseconds allowed for an entire request. */
    requestTimeoutMs?: number;
    /** Maximum time in milliseconds allowed for receiving request headers. */
    headersTimeoutMs?: number;
    /** Browser origins allowed to use this transport. */
    allowedOrigins?: readonly string[];
}

/** Structured input passed from the CLI runner to a module handler. */
export interface CliHandlerInput {
    command: string;
    arguments: string[];
    options: Record<string, string | boolean>;
}

/** Configuration accepted by the CLI transport. */
export interface CliRunnerConfig {
    modules: Record<string, BaseModule>;
    stdout?: OutputWriter;
    stderr?: OutputWriter;
}

/** Structured input passed from the WebSocket server to a module handler. */
export interface WebSocketHandlerInput {
    event: string;
    data: unknown;
    connectionId: string;
}

/** Incoming WebSocket request envelope. */
export interface WebSocketRequestMessage {
    id: string;
    module: string;
    event: string;
    data?: unknown;
}

/** Outgoing WebSocket response envelope. */
export interface WebSocketResponseMessage {
    id: string | null;
    success: boolean;
    data?: unknown;
    error?: string;
}

/** Configuration accepted by the WebSocket transport. */
export interface WebSocketServerConfig {
    port: number;
    modules: Record<string, BaseModule>;
    maxMessageBytes?: number;
    heartbeatIntervalMs?: number;
    allowedOrigins?: readonly string[];
}

/** Metadata propagated with an in-process module request. */
export interface NodeRequestContext {
    /** Stable name of the module initiating the request. */
    caller: string;
    /** Optional identifier used to correlate work across module boundaries. */
    correlationId?: string;
}

/** Instantiated module dependencies supplied to a module factory. */
export interface ModuleDependencies {
    readonly [moduleName: string]: BaseModule;
}

/** Process-wide infrastructure supplied to every module factory. */
export interface ApplicationInfrastructure {
    /** Shared database client owned by the application lifecycle. */
    readonly database: Kysely<Database>;
}

/** Declarative construction metadata for one module. */
export interface ModuleDefinition {
    /** Optional self-identity used by module-owned production definitions. */
    readonly name?: string;
    dependencies: readonly string[];
    create(
        dependencies: ModuleDependencies,
        infrastructure: ApplicationInfrastructure,
    ): BaseModule;
}

/** Public, self-identifying construction metadata owned by a domain module. */
export interface NamedModuleDefinition extends ModuleDefinition {
    /** Stable configuration name used by the module registry. */
    readonly name: string;
}

/** Module definitions addressable by their stable configuration names. */
export interface ModuleDefinitions {
    readonly [moduleName: string]: ModuleDefinition;
}

/** Transport-neutral result returned by every module handler. */
export interface HandlerResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    statusCode?: number;
}

/** Base contract for a transport-specific module entry point. */
export interface IHandler<TInput = unknown, TOutput = unknown> {
    handle(input: TInput): Promise<HandlerResult<TOutput>>;
}

export interface IHttpHandler extends IHandler<Request> {}
export interface IWebSocketHandler extends IHandler<WebSocketHandlerInput> {}
export interface ICliHandler extends IHandler<CliHandlerInput> {}
export interface INodeHandler<
    TInput = unknown,
    TOutput = unknown,
> extends IHandler<TInput, TOutput> {}

export interface IBaseModule<TNodeInput = unknown, TNodeOutput = unknown> {
    dispatch(
        type: 'node',
        input: TNodeInput,
    ): Promise<HandlerResult<TNodeOutput>>;
    dispatch(
        type: Exclude<TransportType, 'node'>,
        input: unknown,
    ): Promise<HandlerResult>;
    registerHandler<TInput, TOutput>(
        type: TransportType,
        handler: IHandler<TInput, TOutput>,
    ): void;
}

export interface IBaseController {
    // Controllers return HandlerResult objects and never write transport responses.
}
