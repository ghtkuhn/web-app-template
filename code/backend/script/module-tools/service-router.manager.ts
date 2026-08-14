import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import { ModuleName } from '../scaffold-module/module-name.ts';

type AstNode = {
    type?: string;
    abstract?: boolean;
    declaration?: AstNode | null;
    id?: { name?: string };
    superClass?: AstNode | null;
    key?: AstNode | null;
    name?: string;
    body?: { body?: AstNode[] };
    params?: AstNode[];
    typeAnnotation?: AstNode | null;
};

interface ServiceOperation {
    readonly className: string;
    readonly operationName: string;
    readonly fileName: string;
    readonly inputIsVoid: boolean;
}

/** Generates complete Service routers from concrete owner-bound Operations. */
export class ServiceRouterManager {
    private readonly projectRoot: string;
    private readonly modulesRoot: string;

    /** Creates one manager for a repository's backend module tree. */
    constructor(projectRoot: string) {
        this.projectRoot = path.resolve(projectRoot);
        this.modulesRoot = path.join(
            this.projectRoot,
            'code/backend/src/module',
        );
    }

    /** Synchronizes every operation-owned Service in one module. */
    public syncModule(rawModuleName: string): boolean {
        let changed = false;
        for (const [servicePath, expected] of this.expectedSources(rawModuleName)) {
            const current = fs.existsSync(servicePath)
                ? fs.readFileSync(servicePath, 'utf8')
                : '';
            if (current !== expected) {
                fs.writeFileSync(servicePath, expected, 'utf8');
                changed = true;
            }
        }
        return changed;
    }

    /** Returns whether one module contains generated Service drift. */
    public hasDrift(rawModuleName: string): boolean {
        return [...this.expectedSources(rawModuleName)].some(
            ([servicePath, expected]) =>
                !fs.existsSync(servicePath) ||
                fs.readFileSync(servicePath, 'utf8') !== expected,
        );
    }

    /** Returns the canonical generated source for every concrete owner. */
    public expectedSources(rawModuleName: string): ReadonlyMap<string, string> {
        const moduleName = new ModuleName(rawModuleName);
        const serviceRoot = path.join(
            this.modulesRoot,
            moduleName.value,
            'service',
        );
        const sources = new Map<string, string>();
        if (!fs.existsSync(serviceRoot)) {
            return sources;
        }
        for (const entry of fs.readdirSync(serviceRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) {
                continue;
            }
            const owner = new ModuleName(entry.name);
            const operations = this.operations(path.join(serviceRoot, entry.name));
            if (operations.length === 0) {
                continue;
            }
            sources.set(
                path.join(serviceRoot, `${owner.value}.service.ts`),
                this.render(owner, operations),
            );
        }
        return sources;
    }

    /** Returns concrete Operation classes owned by one direct Service file. */
    public operationClassNames(
        rawModuleName: string,
        servicePath: string,
    ): readonly string[] {
        const moduleName = new ModuleName(rawModuleName);
        const basename = path.basename(servicePath);
        if (!basename.endsWith('.service.ts')) {
            return [];
        }
        const ownerName = basename.slice(0, -'.service.ts'.length);
        const owner = new ModuleName(ownerName);
        const ownerDirectory = path.join(
            this.modulesRoot,
            moduleName.value,
            'service',
            owner.value,
        );
        return fs.existsSync(ownerDirectory)
            ? this.operations(ownerDirectory).map(
                  (operation) => operation.className,
              )
            : [];
    }

    /** Returns generated public method names owned by one direct Service. */
    public operationMethodNames(
        rawModuleName: string,
        servicePath: string,
    ): readonly string[] {
        const moduleName = new ModuleName(rawModuleName);
        const basename = path.basename(servicePath);
        if (!basename.endsWith('.service.ts')) {
            return [];
        }
        const ownerName = basename.slice(0, -'.service.ts'.length);
        const ownerDirectory = path.join(
            this.modulesRoot,
            moduleName.value,
            'service',
            new ModuleName(ownerName).value,
        );
        return fs.existsSync(ownerDirectory)
            ? this.operations(ownerDirectory).map((operation) =>
                  this.camel(operation.operationName),
              )
            : [];
    }

    /** Reads concrete operation contracts from one owner directory. */
    private operations(directory: string): ServiceOperation[] {
        return fs.readdirSync(directory, { withFileTypes: true })
            .filter(
                (entry) =>
                    entry.isFile() && entry.name.endsWith('.operation.ts'),
            )
            .map((entry) => this.operation(directory, entry.name))
            .filter((operation): operation is ServiceOperation => operation !== null)
            .sort((left, right) =>
                left.operationName.localeCompare(right.operationName),
            );
    }

    /** Parses one concrete exported Operation or ignores an abstract draft. */
    private operation(
        directory: string,
        fileName: string,
    ): ServiceOperation | null {
        const operationName = new ModuleName(
            fileName.slice(0, -'.operation.ts'.length),
        );
        const filePath = path.join(directory, fileName);
        const program = (parse(fs.readFileSync(filePath, 'utf8'), {
            sourceType: 'module',
            plugins: ['typescript'],
        }) as unknown as { program: { body: AstNode[] } }).program;
        const declaration = program.body
            .filter((statement) => statement.type === 'ExportNamedDeclaration')
            .map((statement) => statement.declaration)
            .find((candidate) => candidate?.type === 'ClassDeclaration');
        if (!declaration) {
            throw new Error(`Operation '${this.relative(filePath)}' must export one class.`);
        }
        if (declaration.abstract) {
            return null;
        }
        const className = declaration.id?.name;
        if (!className) {
            throw new Error(`Operation '${this.relative(filePath)}' requires a named class.`);
        }
        const execute = declaration.body?.body?.find(
            (member) =>
                member.type === 'ClassMethod' &&
                this.nodeName(member.key ?? null) === 'execute',
        );
        if (!execute || execute.params?.length !== 1) {
            throw new Error(
                `Concrete Operation '${this.relative(filePath)}' requires execute(input).`,
            );
        }
        return {
            className,
            operationName: operationName.value,
            fileName,
            inputIsVoid:
                execute.params[0].typeAnnotation?.typeAnnotation?.type ===
                'TSVoidKeyword',
        };
    }

    /** Renders a complete deterministic Router for one Service owner. */
    private render(
        owner: ModuleName,
        operations: readonly ServiceOperation[],
    ): string {
        const operationImports = operations.map(
            (operation) =>
                `import { ${operation.className} } from './${owner.value}/${operation.fileName}';`,
        );
        const fields = operations.map(
            (operation) =>
                `    private readonly ${this.camel(operation.operationName)}Operation: ${operation.className};`,
        );
        const assignments = operations.flatMap((operation) => [
            `        this.${this.camel(operation.operationName)}Operation =`,
            `            new ${operation.className}(dependencies);`,
        ]);
        const methods = operations.flatMap((operation) => {
            const fieldName = `${this.camel(operation.operationName)}Operation`;
            const methodName = this.camel(operation.operationName);
            const returnType = `ReturnType<${operation.className}['execute']>`;
            if (operation.inputIsVoid) {
                return [
                    `    /** Routes the ${operation.operationName} application operation. */`,
                    `    public ${methodName}(): ${returnType} {`,
                    `        return this.${fieldName}.execute(undefined);`,
                    '    }',
                ];
            }
            return [
                `    /** Routes the ${operation.operationName} application operation. */`,
                `    public ${methodName}(`,
                `        input: Parameters<${operation.className}['execute']>[0],`,
                `    ): ${returnType} {`,
                `        return this.${fieldName}.execute(input);`,
                '    }',
            ];
        });
        return [
            `import { BaseService } from '../../../base/base.service.ts';`,
            ...operationImports,
            `import type { ${owner.pascalCase}ServiceDependencies } from '../interfaces.ts';`,
            '',
            `/** Generated Router for ${owner.value} Service Operations. */`,
            `export class ${owner.pascalCase}Service extends BaseService {`,
            ...fields,
            '',
            '    /** Creates every owner-bound Operation with shared dependencies. */',
            `    public constructor(dependencies: ${owner.pascalCase}ServiceDependencies) {`,
            '        super();',
            ...assignments,
            '    }',
            '',
            ...this.withBlankLines(methods),
            '}',
            '',
        ].join('\n');
    }

    /** Separates generated methods without trailing whitespace. */
    private withBlankLines(lines: readonly string[]): string[] {
        const separated: string[] = [];
        for (const line of lines) {
            if (
                line.startsWith('    /**') &&
                separated.length > 0 &&
                separated.at(-1) === '    }'
            ) {
                separated.push('');
            }
            separated.push(line);
        }
        return separated;
    }

    /** Converts kebab-case to a lower camel-case identifier. */
    private camel(value: string): string {
        const pascal = new ModuleName(value).pascalCase;
        return `${pascal[0].toLowerCase()}${pascal.slice(1)}`;
    }

    /** Returns an identifier name from a small Babel node subset. */
    private nodeName(node: AstNode | null): string | null {
        return node?.type === 'Identifier' ? node.name ?? null : null;
    }

    /** Returns one stable project-relative path. */
    private relative(filePath: string): string {
        return path.relative(this.projectRoot, filePath).split(path.sep).join('/');
    }
}
