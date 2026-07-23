import { ModuleName } from './module-name.ts';

/** Produces the complete deterministic module catalog source. */
export class CatalogRenderer {
    /** Renders imports and definitions for every registered module. */
    public render(moduleNames: readonly ModuleName[]): string {
        const sorted = [...moduleNames].sort((left, right) =>
            left.value.localeCompare(right.value),
        );
        const imports = sorted
            .map(
                (moduleName) =>
                    `import { ${moduleName.pascalCase}Module } from './module/${moduleName.value}/index.ts';`,
            )
            .join('\n');
        const definitions = sorted
            .map(
                (moduleName) =>
                    `    [${moduleName.pascalCase}Module.definition.name]: ${moduleName.pascalCase}Module.definition,`,
            )
            .join('\n');

        return `import type { ModuleDefinitions } from './base/interfaces.ts';\n${imports ? `${imports}\n` : ''}\n/** Registered module factories keyed by their stable configuration names. */\nexport const moduleDefinitions: ModuleDefinitions = {\n${definitions}\n};\n`;
    }
}
