import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Creates and removes an isolated backend source tree for linter tests. */
export class FixtureProject {
    public readonly root: string;

    /** Creates an empty temporary project root. */
    constructor() {
        this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-linter-'));
        this.writeRaw(
            'code/backend/package.json',
            '{"dependencies":{},"devDependencies":{}}',
        );
        this.writeRaw(
            'code/backend/openapi/openapi.yaml',
            'openapi: 3.1.0\ninfo:\n    title: Fixture\n    version: 1.0.0\npaths: {}\n',
        );
    }

    /** Creates a fixture directory relative to the project root. */
    public mkdir(relativePath: string): string {
        const directoryPath = path.join(this.root, relativePath);
        fs.mkdirSync(directoryPath, { recursive: true });
        return directoryPath;
    }

    /** Writes a UTF-8 fixture file relative to the project root. */
    public write(relativePath: string, source: string): string {
        this.ensureModuleContract(relativePath);
        return this.writeRaw(relativePath, source);
    }

    /** Creates a valid module shell around focused source fixtures. */
    // fallow-ignore-next-line complexity -- Test-only fixture normalization covers optional module state.
    private ensureModuleContract(relativePath: string): void {
        const match = relativePath.match(
            /^code\/backend\/src\/module\/([^/]+)\/.+/u,
        );
        if (!match) {
            return;
        }
        const moduleName = match[1];
        const pascalName = moduleName
            .split('-')
            .map((part) => part[0].toUpperCase() + part.slice(1))
            .join('');
        const entryPath =
            `code/backend/src/module/${moduleName}/index.ts`;
        if (!fs.existsSync(path.join(this.root, entryPath))) {
            this.writeRaw(
                entryPath,
                `export class ${pascalName}Module extends BaseModule implements ${pascalName}ModulePort {
    public static readonly definition = {} satisfies NamedModuleDefinition;
}
export type { ${pascalName}ModulePort } from './interfaces.ts';`,
            );
            this.writeRaw(
                `code/backend/src/module/${moduleName}/interfaces.ts`,
                `export interface ${pascalName}ModulePort {}`,
            );
        }
        const catalogPath = 'code/backend/src/module.catalog.ts';
        const catalog = fs.existsSync(path.join(this.root, catalogPath))
            ? fs.readFileSync(path.join(this.root, catalogPath), 'utf8')
            : '';
        const moduleImport = `./module/${moduleName}/index.ts`;
        if (!catalog.includes(moduleImport)) {
            if (catalog && !catalog.includes('// fixture-generated')) {
                return;
            }
            const imports = [
                ...catalog.matchAll(
                    /^import \{ ([A-Za-z0-9]+Module) \} from '([^']+)';$/gmu,
                ),
            ].map((entry) => ({
                className: entry[1],
                source: entry[2],
            }));
            imports.push({
                className: `${pascalName}Module`,
                source: moduleImport,
            });
            this.writeRaw(
                catalogPath,
                `// fixture-generated\n${imports
                    .map(
                        (entry) =>
                            `import { ${entry.className} } from '${entry.source}';`,
                    )
                    .join('\n')}\nexport const moduleDefinitions = [${imports
                    .map((entry) => `${entry.className}.definition`)
                    .join(', ')}];\n`,
            );
        }
    }

    /** Writes without triggering fixture architecture initialization. */
    private writeRaw(relativePath: string, source: string): string {
        const filePath = path.join(this.root, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, source, 'utf8');
        return filePath;
    }

    /** Removes the complete fixture tree. */
    public dispose(): void {
        fs.rmSync(this.root, { recursive: true, force: true });
    }
}
