import path from 'node:path';

/** Architecture layers that may own one level of auxiliary classes. */
const AUXILIARY_LAYERS = ['api', 'controller', 'service', 'store'] as const;

/** Resolved ownership metadata for one auxiliary source file. */
export interface AuxiliaryPath {
    layer: (typeof AUXILIARY_LAYERS)[number];
    owner: string;
}

/** Resolves source dependencies and classifies project architecture paths. */
export class PathResolver {
    private readonly projectRoot: string;
    private readonly backendSourceRoot: string;
    private readonly modulesRoot: string;

    /** Creates a resolver for one project root. */
    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.backendSourceRoot = path.join(
            this.projectRoot,
            'code/backend/src',
        );
        this.modulesRoot = path.join(this.backendSourceRoot, 'module');
    }

    /** Returns a portable project-relative path for diagnostics. */
    public relative(filePath: string): string {
        return path
            .relative(this.projectRoot, filePath)
            .split(path.sep)
            .join('/');
    }

    /** Returns the forbidden plural module directory beside src/module/. */
    public pluralModuleRoot(): string {
        return path.join(this.backendSourceRoot, 'modules');
    }

    /** Resolves a relative source dependency; package dependencies return null. */
    public resolveDependency(
        sourceFile: string,
        dependency: string,
    ): string | null {
        if (!dependency.startsWith('.')) {
            return null;
        }
        return path.resolve(path.dirname(sourceFile), dependency);
    }

    /** Returns the module name containing a file, if any. */
    public moduleName(filePath: string): string | null {
        const relative = path.relative(this.modulesRoot, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return null;
        }
        const [moduleName] = relative.split(path.sep);
        return moduleName || null;
    }

    /** Returns true for any path owned by a module-local test directory. */
    public isModuleTestPath(filePath: string): boolean {
        const segments = this.moduleSegments(filePath);
        return Boolean(segments && segments[1] === 'test');
    }

    /** Returns true for a direct module-local TypeScript test file. */
    public isModuleTestFile(filePath: string): boolean {
        const segments = this.moduleSegments(filePath);
        return Boolean(
            segments &&
                segments.length === 3 &&
                segments[1] === 'test' &&
                segments[2].endsWith('.test.ts'),
        );
    }

    /** Returns the architecture layer containing a module file. */
    public layer(filePath: string): string {
        const segments = this.moduleSegments(filePath);
        return segments && segments.length >= 3 ? segments[1] : '';
    }

    /** Returns auxiliary ownership for a valid one-level auxiliary path. */
    public auxiliaryPath(filePath: string): AuxiliaryPath | null {
        const segments = this.moduleSegments(filePath);
        if (
            !segments ||
            segments.length !== 4 ||
            !AUXILIARY_LAYERS.includes(
                segments[1] as (typeof AUXILIARY_LAYERS)[number],
            )
        ) {
            return null;
        }
        return {
            layer: segments[1] as AuxiliaryPath['layer'],
            owner: segments[2],
        };
    }

    /** Returns the path depth below the containing module. */
    public modulePathDepth(filePath: string): number | null {
        const segments = this.moduleSegments(filePath);
        return segments ? segments.length - 1 : null;
    }

    /** Returns true when a layer supports owned auxiliary folders. */
    public supportsAuxiliaryLayer(layer: string): boolean {
        return AUXILIARY_LAYERS.includes(
            layer as (typeof AUXILIARY_LAYERS)[number],
        );
    }

    /** Returns true when a source file is a direct owner of an auxiliary path. */
    public isAuxiliaryOwner(
        sourceFile: string,
        auxiliary: AuxiliaryPath,
    ): boolean {
        const segments = this.moduleSegments(sourceFile);
        if (
            !segments ||
            segments.length !== 3 ||
            segments[1] !== auxiliary.layer
        ) {
            return false;
        }

        const basename = segments[2];
        if (auxiliary.layer === 'api') {
            return (
                basename.startsWith(`${auxiliary.owner}.`) &&
                basename.endsWith('.handler.ts')
            );
        }
        return basename === `${auxiliary.owner}.${auxiliary.layer}.ts`;
    }

    /** Returns true when a resolved path targets a module's public entry point. */
    public isPublicModuleEntry(filePath: string): boolean {
        return (
            this.moduleName(filePath) !== null &&
            path.basename(filePath) === 'index.ts' &&
            path.dirname(path.dirname(filePath)) === this.modulesRoot
        );
    }

    /** Returns true for registry and process entry points forbidden to domains. */
    public isCompositionFile(filePath: string): boolean {
        const normalized = path.resolve(filePath);
        return [
            path.join(this.backendSourceRoot, 'module.catalog.ts'),
            path.join(this.backendSourceRoot, 'module.registry.ts'),
            path.join(this.backendSourceRoot, 'index.ts'),
            path.join(this.backendSourceRoot, 'cli.ts'),
        ].includes(normalized);
    }

    /** Returns the backend source root. */
    public sourceRoot(): string {
        return this.backendSourceRoot;
    }

    /** Returns the backend workspace package manifest. */
    public packageManifest(): string {
        return path.join(this.projectRoot, 'code/backend/package.json');
    }

    /** Returns the root package manifest. */
    public rootPackageManifest(): string {
        return path.join(this.projectRoot, 'package.json');
    }

    /** Returns the shared TypeScript compiler configuration. */
    public compilerConfig(): string {
        return path.join(this.projectRoot, 'tsconfig.base.json');
    }

    /** Returns the backend workspace root. */
    public backendRoot(): string {
        return path.join(this.projectRoot, 'code/backend');
    }

    /** Returns the frontend workspace root. */
    public frontendRoot(): string {
        return path.join(this.projectRoot, 'code/frontend/web');
    }

    /** Returns the checked-in OpenAPI document. */
    public openApiDocument(): string {
        return path.join(this.projectRoot, 'code/backend/openapi/openapi.yaml');
    }

    /** Returns the backend test root. */
    public testRoot(): string {
        return path.join(this.projectRoot, 'code/backend/test');
    }

    /** Returns the checked-in backend test catalog. */
    public testCatalog(): string {
        return path.join(this.backendRoot(), 'test.catalog.ts');
    }

    /** Returns the generated module catalog. */
    public moduleCatalog(): string {
        return path.join(this.backendSourceRoot, 'module.catalog.ts');
    }

    /** Returns the domain-module root. */
    public moduleRoot(): string {
        return this.modulesRoot;
    }

    /** Returns normalized path segments relative to the module root. */
    private moduleSegments(filePath: string): string[] | null {
        const relative = path.relative(this.modulesRoot, filePath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return null;
        }
        return relative.split(path.sep);
    }
}
