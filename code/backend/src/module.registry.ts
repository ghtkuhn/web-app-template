import type { BaseModule } from './base/base.module.ts';
import type {
    ApplicationInfrastructure,
    ModuleDefinition,
    ModuleDefinitions,
    ModuleDependencies,
} from './base/interfaces.ts';
import { moduleDefinitions } from './module.catalog.ts';

/**
 * Creates configured domain modules, injects their public dependencies, and
 * rejects missing or cyclic dependency graphs before transports start.
 */
export class ModuleRegistry {
    private readonly activeModuleNames: readonly string[];
    private readonly definitions: ModuleDefinitions;
    private readonly infrastructure: ApplicationInfrastructure;
    private readonly instances = new Map<string, BaseModule>();
    private readonly resolving = new Set<string>();

    /** Creates a registry with production definitions or explicit test definitions. */
    constructor(
        activeModuleNames: readonly string[],
        infrastructure: ApplicationInfrastructure,
        definitions?: ModuleDefinitions,
    ) {
        this.activeModuleNames = activeModuleNames;
        this.infrastructure = infrastructure;
        this.definitions = definitions ?? moduleDefinitions;
    }

    /** Builds the complete active module graph in dependency order. */
    public create(): Record<string, BaseModule> {
        const activeModules = new Set(this.activeModuleNames);
        const modules: Record<string, BaseModule> = {};

        for (const moduleName of this.activeModuleNames) {
            modules[moduleName] = this.resolveModule(
                moduleName,
                activeModules,
                [],
            );
        }
        return modules;
    }

    /** Resolves one module recursively and reports the exact failing dependency path. */
    private resolveModule(
        moduleName: string,
        activeModules: ReadonlySet<string>,
        path: readonly string[],
    ): BaseModule {
        const existing = this.instances.get(moduleName);
        if (existing) {
            return existing;
        }

        if (this.resolving.has(moduleName)) {
            const cycleStart = path.indexOf(moduleName);
            const cycle = [...path.slice(cycleStart), moduleName];
            throw new Error(`Cyclic module dependency: ${cycle.join(' -> ')}`);
        }

        const definition = this.getDefinition(moduleName);
        this.resolving.add(moduleName);
        const dependencyPath = [...path, moduleName];

        try {
            const dependencies = this.resolveDependencies(
                moduleName,
                definition,
                activeModules,
                dependencyPath,
            );
            const module = definition.create(
                dependencies,
                this.infrastructure,
            );
            this.instances.set(moduleName, module);
            return module;
        } finally {
            this.resolving.delete(moduleName);
        }
    }

    /** Resolves and collects the dependencies injected into one module factory. */
    private resolveDependencies(
        moduleName: string,
        definition: ModuleDefinition,
        activeModules: ReadonlySet<string>,
        path: readonly string[],
    ): ModuleDependencies {
        const dependencies: Record<string, BaseModule> = {};
        for (const dependencyName of definition.dependencies) {
            if (!activeModules.has(dependencyName)) {
                throw new Error(
                    `Module '${moduleName}' requires inactive module '${dependencyName}'.`,
                );
            }
            dependencies[dependencyName] = this.resolveModule(
                dependencyName,
                activeModules,
                path,
            );
        }
        return dependencies;
    }

    /** Returns construction metadata for an active module name. */
    private getDefinition(moduleName: string): ModuleDefinition {
        const definition = this.definitions[moduleName];
        if (!definition) {
            throw new Error(`Unknown active module '${moduleName}'.`);
        }
        if (definition.name && definition.name !== moduleName) {
            throw new Error(
                `Module definition '${definition.name}' is registered as '${moduleName}'.`,
            );
        }
        return definition;
    }
}
