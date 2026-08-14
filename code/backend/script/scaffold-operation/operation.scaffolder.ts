import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import {
    ScaffoldExecutionError,
    ScaffoldInputError,
} from '../scaffold-module/errors.ts';
import { ModuleName } from '../scaffold-module/module-name.ts';
import type {
    OperationScaffolderConfig,
    OperationScaffoldRequest,
    OperationScaffoldResult,
} from './interfaces.ts';

type AstNode = {
    type?: string;
    declaration?: AstNode | null;
    id?: { name?: string };
};

type TypeReference = {
    readonly name: string;
    readonly sourcePath: string;
};

/** Creates one typed, owner-bound Service Operation draft transactionally. */
export class OperationScaffolder {
    private readonly projectRoot: string;
    private readonly backendRoot: string;
    private readonly modulesRoot: string;
    private readonly verification: OperationScaffolderConfig['verification'];

    /** Creates a scaffolder rooted at one repository. */
    constructor(config: OperationScaffolderConfig) {
        this.projectRoot = path.resolve(config.projectRoot);
        this.backendRoot = path.join(this.projectRoot, 'code/backend');
        this.modulesRoot = path.join(this.backendRoot, 'src/module');
        this.verification = config.verification;
    }

    /** Validates, writes, verifies, and reports one Operation draft. */
    public scaffold(request: OperationScaffoldRequest): OperationScaffoldResult {
        const moduleName = new ModuleName(request.moduleName);
        const serviceName = new ModuleName(request.serviceName);
        const operationName = new ModuleName(request.operationName);
        const moduleRoot = path.join(this.modulesRoot, moduleName.value);
        this.requireFile(path.join(moduleRoot, 'index.ts'), `Module '${moduleName.value}' does not exist.`);
        this.requireFile(
            path.join(moduleRoot, 'service', `${serviceName.value}.service.ts`),
            `Service owner '${serviceName.value}' does not exist in module '${moduleName.value}'.`,
        );

        const targetDirectory = path.join(
            moduleRoot,
            'service',
            serviceName.value,
        );
        const targetPath = path.join(
            targetDirectory,
            `${operationName.value}.operation.ts`,
        );
        if (fs.existsSync(targetPath)) {
            throw new ScaffoldInputError(
                `Target '${this.relative(targetPath)}' already exists.`,
            );
        }

        const input = this.resolveType(moduleRoot, request.inputType);
        const output = this.resolveType(moduleRoot, request.outputType);
        const interfacesPath = path.join(moduleRoot, 'interfaces.ts');
        this.requireFile(interfacesPath, `Module '${moduleName.value}' requires interfaces.ts.`);
        const originalInterfaces = fs.readFileSync(interfacesPath, 'utf8');
        const dependenciesName = `${serviceName.pascalCase}ServiceDependencies`;
        const nextInterfaces = this.withDependencyContract(
            originalInterfaces,
            dependenciesName,
        );
        const source = this.render(
            targetPath,
            operationName,
            dependenciesName,
            interfacesPath,
            input,
            output,
        );
        const createdDirectory = !fs.existsSync(targetDirectory);

        try {
            if (createdDirectory) {
                fs.mkdirSync(targetDirectory);
            }
            if (nextInterfaces !== originalInterfaces) {
                fs.writeFileSync(interfacesPath, nextInterfaces, 'utf8');
            }
            fs.writeFileSync(targetPath, source, 'utf8');
            this.verification.verify(this.backendRoot);
        } catch (error: unknown) {
            if (fs.existsSync(targetPath)) {
                fs.unlinkSync(targetPath);
            }
            if (nextInterfaces !== originalInterfaces) {
                fs.writeFileSync(interfacesPath, originalInterfaces, 'utf8');
            }
            if (
                createdDirectory &&
                fs.existsSync(targetDirectory) &&
                fs.readdirSync(targetDirectory).length === 0
            ) {
                fs.rmdirSync(targetDirectory);
            }
            throw new ScaffoldExecutionError(
                error instanceof Error
                    ? error.message
                    : 'Unable to scaffold Service Operation.',
            );
        }

        return {
            className: `${operationName.pascalCase}Operation`,
            file: this.relative(targetPath),
        };
    }

    /** Resolves one named module-local declaration or the `void` sentinel. */
    private resolveType(moduleRoot: string, typeName: string): TypeReference | null {
        if (typeName === 'void') {
            return null;
        }
        if (!/^[A-Z][A-Za-z0-9]*$/.test(typeName)) {
            throw new ScaffoldInputError(
                `Type '${typeName}' must be a named PascalCase module contract or void.`,
            );
        }
        const matches = this.sourceFiles(moduleRoot)
            .filter((filePath) => this.exportsType(filePath, typeName))
            .map((sourcePath) => ({ name: typeName, sourcePath }));
        if (matches.length !== 1) {
            throw new ScaffoldInputError(
                matches.length === 0
                    ? `Type '${typeName}' is not exported by a module-local source file.`
                    : `Type '${typeName}' is exported by multiple module-local source files.`,
            );
        }
        return matches[0];
    }

    /** Returns direct declarations exported by one TypeScript module. */
    private exportsType(filePath: string, typeName: string): boolean {
        const source = fs.readFileSync(filePath, 'utf8');
        let program: { body: AstNode[] };
        try {
            program = (parse(source, {
                sourceType: 'module',
                plugins: ['typescript'],
            }) as unknown as { program: { body: AstNode[] } }).program;
        } catch (error: unknown) {
            throw new ScaffoldExecutionError(
                `Unable to parse '${this.relative(filePath)}': ${error instanceof Error ? error.message : 'unknown parser failure'}`,
            );
        }
        return program.body.some((statement) => {
            if (statement.type !== 'ExportNamedDeclaration') {
                return false;
            }
            const declaration = statement.declaration;
            return Boolean(
                declaration &&
                    [
                        'ClassDeclaration',
                        'TSInterfaceDeclaration',
                        'TSTypeAliasDeclaration',
                    ].includes(declaration.type ?? '') &&
                    declaration.id?.name === typeName,
            );
        });
    }

    /** Adds the owner dependency contract without rewriting existing content. */
    private withDependencyContract(source: string, contractName: string): string {
        let program: { body: AstNode[] };
        try {
            program = (parse(source, {
                sourceType: 'module',
                plugins: ['typescript'],
            }) as unknown as { program: { body: AstNode[] } }).program;
        } catch (error: unknown) {
            throw new ScaffoldExecutionError(
                `Unable to parse module interfaces.ts: ${error instanceof Error ? error.message : 'unknown parser failure'}`,
            );
        }
        const exists = program.body.some(
            (statement) =>
                statement.type === 'ExportNamedDeclaration' &&
                statement.declaration?.type === 'TSInterfaceDeclaration' &&
                statement.declaration.id?.name === contractName,
        );
        if (exists) {
            return source;
        }
        const separator = source.endsWith('\n') ? '\n' : '\n\n';
        return `${source}${separator}/** Dependencies shared by the ${contractName.replace('Dependencies', '')} router and its Operations. */\nexport interface ${contractName} {}\n`;
    }

    /** Renders one abstract draft with deterministic type-only imports. */
    private render(
        targetPath: string,
        operationName: ModuleName,
        dependenciesName: string,
        interfacesPath: string,
        input: TypeReference | null,
        output: TypeReference | null,
    ): string {
        const basePath = path.join(
            this.backendRoot,
            'src/base/base.service.operation.ts',
        );
        const imports = new Map<string, Set<string>>();
        this.addImport(imports, interfacesPath, dependenciesName);
        if (input) {
            this.addImport(imports, input.sourcePath, input.name);
        }
        if (output) {
            this.addImport(imports, output.sourcePath, output.name);
        }
        const typeImports = [...imports.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([sourcePath, names]) =>
                `import type { ${[...names].sort().join(', ')} } from '${this.importPath(targetPath, sourcePath)}';`,
            );
        return [
            `import { BaseServiceOperation } from '${this.importPath(targetPath, basePath)}';`,
            ...typeImports,
            '',
            `/** Implements the ${operationName.value} application operation. */`,
            `export abstract class ${operationName.pascalCase}Operation extends BaseServiceOperation<`,
            `    ${input?.name ?? 'void'},`,
            `    ${output?.name ?? 'void'},`,
            `    ${dependenciesName}`,
            '> {}',
            '',
        ].join('\n');
    }

    /** Adds one symbol to a path-grouped import map. */
    private addImport(
        imports: Map<string, Set<string>>,
        sourcePath: string,
        name: string,
    ): void {
        const names = imports.get(sourcePath) ?? new Set<string>();
        names.add(name);
        imports.set(sourcePath, names);
    }

    /** Lists module-local production TypeScript files deterministically. */
    private sourceFiles(moduleRoot: string): string[] {
        const files: string[] = [];
        const visit = (directory: string): void => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (entry.name === 'test') {
                    continue;
                }
                const entryPath = path.join(directory, entry.name);
                if (entry.isDirectory()) {
                    visit(entryPath);
                } else if (
                    entry.isFile() &&
                    entry.name.endsWith('.ts') &&
                    entry.name !== 'index.ts'
                ) {
                    files.push(entryPath);
                }
            }
        };
        visit(moduleRoot);
        return files.sort((left, right) => left.localeCompare(right));
    }

    /** Requires one regular source file. */
    private requireFile(filePath: string, message: string): void {
        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            throw new ScaffoldInputError(message);
        }
    }

    /** Returns a `.ts`-suffixed relative import path. */
    private importPath(targetPath: string, sourcePath: string): string {
        const relative = path
            .relative(path.dirname(targetPath), sourcePath)
            .split(path.sep)
            .join('/');
        return relative.startsWith('.') ? relative : `./${relative}`;
    }

    /** Returns one portable project-relative path. */
    private relative(filePath: string): string {
        return path.relative(this.projectRoot, filePath).split(path.sep).join('/');
    }
}
