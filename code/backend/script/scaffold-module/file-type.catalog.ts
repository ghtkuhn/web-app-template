import { ScaffoldInputError } from './errors.ts';

/** Supported architecture file identifiers accepted by the CLI. */
export type ArchitectureFileType =
    | 'controller'
    | 'service'
    | 'store'
    | 'object'
    | 'dto'
    | 'entity-dto'
    | 'http-handler'
    | 'websocket-handler'
    | 'cli-handler'
    | 'node-handler'
    | 'api-aux'
    | 'controller-aux'
    | 'store-aux';

/** Complete generation contract for one architecture file type. */
export interface FileTypeDefinition {
    type: ArchitectureFileType;
    layer: string;
    filenameSuffix: string;
    classSuffix: string;
    baseClass: string;
    baseFilename: string;
    baseTypeArguments: string;
    abstract: boolean;
    auxiliary: boolean;
}

/** Resolves CLI file-type names to immutable architecture contracts. */
export class FileTypeCatalog {
    private readonly definitions: readonly FileTypeDefinition[] = [
        this.definition(
            'controller',
            'controller',
            'controller',
            'Controller',
            'BaseController',
            'base.controller.ts',
        ),
        this.definition(
            'service',
            'service',
            'service',
            'Service',
            'BaseService',
            'base.service.ts',
            '',
            true,
        ),
        this.definition(
            'store',
            'store',
            'store',
            'Store',
            'BaseStore',
            'base.store.ts',
            '<never>',
            true,
        ),
        this.definition(
            'object',
            'object',
            'object',
            'Object',
            'BaseObject',
            'base.object.ts',
        ),
        this.definition(
            'dto',
            'dto',
            'dto',
            'DTO',
            'BaseDTO',
            'base.dto.ts',
        ),
        this.definition(
            'entity-dto',
            'dto',
            'dto',
            'DTO',
            'EntityDTO',
            'base.dto.ts',
            '<never>',
        ),
        this.definition(
            'http-handler',
            'api',
            'http.handler',
            'HttpHandler',
            'HttpHandler',
            'http.handler.ts',
            '',
            true,
        ),
        this.definition(
            'websocket-handler',
            'api',
            'websocket.handler',
            'WebSocketHandler',
            'WebSocketHandler',
            'websocket.handler.ts',
            '',
            true,
        ),
        this.definition(
            'cli-handler',
            'api',
            'cli.handler',
            'CliHandler',
            'CliHandler',
            'cli.handler.ts',
            '',
            true,
        ),
        this.definition(
            'node-handler',
            'api',
            'node.handler',
            'NodeHandler',
            'NodeHandler',
            'node.handler.ts',
            '<never, never>',
            true,
        ),
        this.definition(
            'api-aux',
            'api',
            'api-aux',
            'ApiAux',
            'BaseApiAux',
            'base.api.aux.ts',
            '',
            false,
            true,
        ),
        this.definition(
            'controller-aux',
            'controller',
            'controller-aux',
            'ControllerAux',
            'BaseControllerAux',
            'base.controller.aux.ts',
            '',
            false,
            true,
        ),
        this.definition(
            'store-aux',
            'store',
            'store-aux',
            'StoreAux',
            'BaseStoreAux',
            'base.store.aux.ts',
            '',
            false,
            true,
        ),
    ];

    /** Returns the contract for one supported CLI file type. */
    public get(type: string): FileTypeDefinition {
        if (type === 'service-aux') {
            throw new ScaffoldInputError(
                'Service Aux scaffolding is obsolete. Use npm run scaffold:operation instead.',
            );
        }
        const definition = this.definitions.find(
            (candidate) => candidate.type === type,
        );
        if (!definition) {
            throw new ScaffoldInputError(
                `Unknown file type '${type}'. Use --help to list supported types.`,
            );
        }
        return definition;
    }

    /** Returns all supported names in stable help-output order. */
    public types(): readonly ArchitectureFileType[] {
        return this.definitions.map((definition) => definition.type);
    }

    /** Creates one immutable definition with concise defaults. */
    private definition(
        type: ArchitectureFileType,
        layer: string,
        filenameSuffix: string,
        classSuffix: string,
        baseClass: string,
        baseFilename: string,
        baseTypeArguments = '',
        abstract = false,
        auxiliary = false,
    ): FileTypeDefinition {
        return {
            type,
            layer,
            filenameSuffix,
            classSuffix,
            baseClass,
            baseFilename,
            baseTypeArguments,
            abstract,
            auxiliary,
        };
    }
}
