import fs from 'node:fs';
import { parse } from '@babel/parser';
import type { SourceAnalysis, SourceDependency } from './interfaces.ts';

type AstNode = {
    type?: string;
    source?: { value?: unknown };
    declaration?: AstNode | null;
    declarations?: Array<{ id?: { type?: string } }>;
    superClass?: AstNode | null;
    name?: string;
    object?: AstNode;
    property?: AstNode;
    computed?: boolean;
    callee?: AstNode;
    arguments?: AstNode[];
    value?: unknown;
    [key: string]: unknown;
};

/** Extracts architecture-relevant facts from TypeScript source files. */
export class SourceAnalyzer {
    /** Parses one file and returns its top-level declarations and dependencies. */
    public analyze(filePath: string): SourceAnalysis {
        const source = fs.readFileSync(filePath, 'utf8');
        const ast = parse(source, {
            sourceType: 'module',
            plugins: ['typescript'],
        }) as unknown as { program: { body: AstNode[] } };
        const analysis = this.emptyAnalysis(filePath, source);

        for (const statement of ast.program.body) {
            this.processTopLevel(statement, analysis);
            this.collectRuntimeDependencies(statement, analysis.dependencies);
            this.collectMethodCalls(statement, analysis.methodCalls);
        }
        return analysis;
    }

    /** Recursively records CommonJS and dynamic-import dependencies. */
    private collectRuntimeDependencies(
        node: unknown,
        dependencies: SourceDependency[],
    ): void {
        if (!node || typeof node !== 'object') {
            return;
        }

        const astNode = node as AstNode;
        if (
            astNode.type === 'ImportExpression' &&
            typeof astNode.source?.value === 'string'
        ) {
            dependencies.push({
                source: astNode.source.value,
                kind: 'dynamic-import',
            });
        }
        if (astNode.type === 'CallExpression') {
            const firstArgument = astNode.arguments?.[0];
            const source =
                firstArgument?.type === 'StringLiteral' &&
                typeof firstArgument.value === 'string'
                    ? firstArgument.value
                    : null;
            if (
                source &&
                astNode.callee?.type === 'Identifier' &&
                astNode.callee.name === 'require'
            ) {
                dependencies.push({ source, kind: 'require' });
            } else if (source && astNode.callee?.type === 'Import') {
                dependencies.push({ source, kind: 'dynamic-import' });
            }
        }

        for (const [key, value] of Object.entries(astNode)) {
            if (['loc', 'start', 'end'].includes(key)) {
                continue;
            }
            if (Array.isArray(value)) {
                for (const child of value) {
                    this.collectRuntimeDependencies(child, dependencies);
                }
            } else {
                this.collectRuntimeDependencies(value, dependencies);
            }
        }
    }

    /** Creates an empty mutable analysis accumulator. */
    private emptyAnalysis(filePath: string, source: string): SourceAnalysis {
        return {
            filePath,
            source,
            dependencies: [],
            interfaceCount: 0,
            typeCount: 0,
            constantCount: 0,
            functionCount: 0,
            classBaseNames: [],
            methodCalls: [],
        };
    }

    /** Processes only declarations that are direct children of the program. */
    private processTopLevel(node: AstNode, analysis: SourceAnalysis): void {
        if (node.type === 'ImportDeclaration') {
            this.addDependency(node, 'import', analysis.dependencies);
            return;
        }

        if (
            node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportDefaultDeclaration' ||
            node.type === 'ExportAllDeclaration'
        ) {
            this.addDependency(node, 'export', analysis.dependencies);
            if (node.declaration) {
                this.processDeclaration(node.declaration, analysis);
            }
            return;
        }

        this.processDeclaration(node, analysis);
    }

    /** Counts one unwrapped top-level declaration. */
    private processDeclaration(node: AstNode, analysis: SourceAnalysis): void {
        switch (node.type) {
            case 'TSInterfaceDeclaration':
                analysis.interfaceCount += 1;
                break;
            case 'TSTypeAliasDeclaration':
                analysis.typeCount += 1;
                break;
            case 'VariableDeclaration':
                if ((node as { kind?: string }).kind === 'const') {
                    analysis.constantCount += node.declarations?.length ?? 0;
                }
                break;
            case 'FunctionDeclaration':
                analysis.functionCount += 1;
                break;
            case 'ClassDeclaration':
                analysis.classBaseNames.push(
                    this.expressionName(node.superClass ?? null),
                );
                break;
        }
    }

    /** Adds an import or re-export dependency when it has a string source. */
    private addDependency(
        node: AstNode,
        kind: SourceDependency['kind'],
        dependencies: SourceDependency[],
    ): void {
        if (typeof node.source?.value === 'string') {
            dependencies.push({ source: node.source.value, kind });
        }
    }

    /** Returns a stable class-base expression name. */
    private expressionName(node: AstNode | null): string | null {
        if (!node) {
            return null;
        }
        if (node.type === 'Identifier') {
            return node.name ?? null;
        }
        if (node.type === 'MemberExpression') {
            const object = this.expressionName(node.object ?? null);
            const property = this.expressionName(node.property ?? null);
            return object && property ? `${object}.${property}` : 'ComplexBase';
        }
        return 'ComplexBase';
    }

    /** Recursively records method calls without changing declaration scope. */
    private collectMethodCalls(node: unknown, methodCalls: string[]): void {
        if (!node || typeof node !== 'object') {
            return;
        }

        const astNode = node as AstNode;
        if (
            astNode.type === 'CallExpression' &&
            astNode.callee?.type === 'MemberExpression'
        ) {
            const methodName = this.expressionName(
                astNode.callee.property ?? null,
            );
            if (methodName) {
                methodCalls.push(methodName);
            }
        }

        for (const [key, value] of Object.entries(astNode)) {
            if (key === 'loc' || key === 'start' || key === 'end') {
                continue;
            }
            if (Array.isArray(value)) {
                for (const child of value) {
                    this.collectMethodCalls(child, methodCalls);
                }
            } else {
                this.collectMethodCalls(value, methodCalls);
            }
        }
    }
}
