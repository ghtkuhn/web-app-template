import type { BaseModule } from './base.module.ts';
import type { Kysely } from 'kysely';
import type { Database } from '../database.ts';

/** Transport gateways supported by every module. */
export type TransportType = 'http' | 'websocket' | 'cli' | 'node';

/** Writes serialized CLI output to a stream-like destination. */
export interface OutputWriter {
    /** Writes one serialized output chunk. */
    write(chunk: string): unknown;
}

/** Shared identity, lifecycle metadata, validation, and serialization contract. */
export interface IBaseObject {
    /** Stable domain-object identifier. */
    id: string;
    /** Time at which the object was created. */
    createdAt: Date;
    /** Time at which the object was last changed. */
    updatedAt: Date;
    /** Whether the object is logically deleted. */
    isDeleted: boolean;
    /** Time at which the object was logically deleted, when applicable. */
    deletedAt?: Date;
    /** Validates domain invariants and throws when they are violated. */
    validate(): void;
    /** Produces a controlled serialization that excludes sensitive fields. */
    toJSON(): unknown;
    /** Marks the object as logically deleted and updates lifecycle metadata. */
    softDelete(): void;
}

/** Marker contract for application data transported across backend boundaries. */
export interface IBaseDTO {}

/** Contract for a DTO carrying the public identity of a domain object. */
export interface IEntityDTO<T extends IBaseObject> extends IBaseDTO {
    /** Public identity copied from the mapped domain object. */
    id: string;
    /** Copies explicitly exposed domain values into this DTO. */
    fromObject(object: T): this;
    /** Produces partial values for Service-controlled domain mapping. */
    toObject(): Partial<T>;
}

/** Typed persistence operations implemented by every Store. */
export interface IBaseStore<T extends IBaseObject> {
    /** Creates or fully updates one mapped domain object. */
    save(object: T): Promise<T>;
    /** Finds one mapped domain object by its identifier. */
    findById(id: string): Promise<T | null>;
    /** Returns all mapped objects visible through this Store. */
    findAll(): Promise<T[]>;
    /** Deletes or soft-deletes one persisted object by identifier. */
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

/** Common domain-object workflows exposed by the generic Service base. */
export interface IBaseService<T extends IBaseObject> {
    /** Validates and persists one object. */
    createOrUpdate(object: T): Promise<T>;
    /** Returns one object or rejects when it does not exist. */
    getById(id: string): Promise<T>;
    /** Returns all objects visible through the Service's Store. */
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
    /** Module-local command name. */
    command: string;
    /** Positional command arguments. */
    arguments: string[];
    /** Parsed long-form command options. */
    options: Record<string, string | boolean>;
}

/** Configuration accepted by the CLI transport. */
export interface CliRunnerConfig {
    /** Domain modules addressable by their configuration names. */
    modules: Record<string, BaseModule>;
    /** Optional standard-output replacement, primarily for composition and tests. */
    stdout?: OutputWriter;
    /** Optional standard-error replacement, primarily for composition and tests. */
    stderr?: OutputWriter;
}

/** Structured input passed from the WebSocket server to a module handler. */
export interface WebSocketHandlerInput {
    /** Module-local WebSocket event name. */
    event: string;
    /** Untrusted event payload to validate and map. */
    data: unknown;
    /** Stable identifier assigned to the client connection. */
    connectionId: string;
}

/** Incoming WebSocket request envelope. */
export interface WebSocketRequestMessage {
    /** Caller-generated request identifier used for response correlation. */
    id: string;
    /** Public module name selected by the transport. */
    module: string;
    /** Module-local event name. */
    event: string;
    /** Optional untrusted event payload. */
    data?: unknown;
}

/** Outgoing WebSocket response envelope. */
export interface WebSocketResponseMessage {
    /** Correlated request identifier, or `null` for an invalid envelope. */
    id: string | null;
    /** Whether the module operation completed successfully. */
    success: boolean;
    /** Successful response data. */
    data?: unknown;
    /** Safe client-facing failure description. */
    error?: string;
}

/** Configuration accepted by the WebSocket transport. */
export interface WebSocketServerConfig {
    /** TCP port to bind. Use `0` to request an operating-system port. */
    port: number;
    /** Domain modules addressable through WebSocket request envelopes. */
    modules: Record<string, BaseModule>;
    /** Maximum accepted WebSocket message size in bytes. */
    maxMessageBytes?: number;
    /** Interval in milliseconds between client liveness probes. */
    heartbeatIntervalMs?: number;
    /** Browser origins allowed to establish WebSocket connections. */
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
    /** Stable names of module ports required before this module can be created. */
    dependencies: readonly string[];
    /** Creates one module from resolved ports and process-wide infrastructure. */
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
    /** Looks up construction metadata by stable module configuration name. */
    readonly [moduleName: string]: ModuleDefinition;
}

/** Transport-neutral result returned by every module handler. */
export interface HandlerResult<T = unknown> {
    /** Whether processing completed successfully. */
    success: boolean;
    /** Typed data returned after successful processing. */
    data?: T;
    /** Safe caller-facing failure description. */
    error?: string;
    /** Optional transport compatibility status; Node callers must not branch on it. */
    statusCode?: number;
}

/** HTTP dispatch output supporting normal envelopes and delegated Fetch responses. */
export type HttpDispatchResult = HandlerResult | Response;

/** Base contract for a transport-specific module entry point. */
export interface IHandler<
    TInput = unknown,
    TOutput = unknown,
    TResult = HandlerResult<TOutput>,
> {
    /** Processes one input and returns a normalized result without throwing. */
    handle(input: TInput): Promise<TResult>;
}

/** Contract implemented by HTTP handlers receiving Fetch API requests. */
export interface IHttpHandler extends IHandler<Request> {}

/** Contract implemented by handlers receiving structured WebSocket events. */
export interface IWebSocketHandler extends IHandler<WebSocketHandlerInput> {}

/** Contract implemented by handlers receiving parsed CLI commands. */
export interface ICliHandler extends IHandler<CliHandlerInput> {}

/** Contract implemented by typed in-process module handlers. */
export interface INodeHandler<
    TInput = unknown,
    TOutput = unknown,
> extends IHandler<TInput, TOutput> {}

/** Public gateway contract shared by domain modules. */
export interface IBaseModule<TNodeInput = unknown, TNodeOutput = unknown> {
    /** Dispatches a typed in-process request through the module's Node handler. */
    dispatch(
        type: 'node',
        input: TNodeInput,
    ): Promise<HandlerResult<TNodeOutput>>;
    /** Dispatches input through an external transport handler. */
    dispatch(
        type: 'http',
        input: Request,
    ): Promise<HttpDispatchResult>;
    /** Dispatches input through a non-HTTP external transport handler. */
    dispatch(
        type: Exclude<TransportType, 'node' | 'http'>,
        input: unknown,
    ): Promise<HandlerResult>;
    /** Registers the private handler used by one transport during composition. */
    registerHandler<TInput, TOutput, TResult = HandlerResult<TOutput>>(
        type: TransportType,
        handler: IHandler<TInput, TOutput, TResult>,
    ): void;
}

/** Marker contract for transport-neutral Controllers returning handler results. */
export interface IBaseController {}
