import fs from 'node:fs';
import { parse } from '@babel/parser';
import type {
    ClassAnalysis,
    SourceAnalysis,
    SourceDependency,
} from './interfaces.ts';

type AstNode = {
    type?: string;
    source?: { value?: unknown };
    declaration?: AstNode | null;
    declarations?: Array<{ id?: { type?: string } }>;
    superClass?: AstNode | null;
    implements?: AstNode[];
    body?: { body?: AstNode[] };
    params?: AstNode[];
    returnType?: AstNode;
    typeAnnotation?: AstNode;
    expression?: AstNode;
    argument?: AstNode;
    id?: AstNode;
    key?: AstNode;
    importKind?: string;
    exportKind?: string;
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
        this.collectFacts(ast.program.body, analysis);
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
                typeOnly: false,
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
                dependencies.push({
                    source,
                    kind: 'require',
                    typeOnly: false,
                });
            } else if (source && astNode.callee?.type === 'Import') {
                dependencies.push({
                    source,
                    kind: 'dynamic-import',
                    typeOnly: false,
                });
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
            classes: [],
            methodCalls: [],
            constructorCalls: [],
            parameterNames: [],
            returnTypeNames: [],
            anyTypeCount: 0,
            catchCount: 0,
            objectReturnCount: 0,
            environmentAccessCount: 0,
            requestBodyAccessCount: 0,
            unknownCastCount: 0,
            throwMessageAccessCount: 0,
            validationCallOffsets: [],
            persistenceCallOffsets: [],
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
                {
                    const classAnalysis = this.classAnalysis(node);
                    analysis.classBaseNames.push(classAnalysis.baseName);
                    analysis.classes.push(classAnalysis);
                }
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
            dependencies.push({
                source: node.source.value,
                kind,
                typeOnly:
                    node.importKind === 'type' ||
                    node.exportKind === 'type',
            });
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

    /** Extracts method signatures and security-relevant syntax recursively. */
    // fallow-ignore-next-line complexity -- Exhaustively dispatches tested Babel node variants.
    private collectFacts(node: unknown, analysis: SourceAnalysis): void {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                this.collectFacts(child, analysis);
            }
            return;
        }

        const astNode = node as AstNode;
        if (astNode.type === 'TSAnyKeyword') {
            analysis.anyTypeCount += 1;
        }
        if (astNode.type === 'CatchClause') {
            analysis.catchCount += 1;
        }
        if (
            astNode.type === 'ReturnStatement' &&
            astNode.argument?.type === 'ObjectExpression'
        ) {
            analysis.objectReturnCount += 1;
        }
        if (
            astNode.type === 'MemberExpression' &&
            this.expressionName(astNode.object ?? null) === 'process' &&
            this.expressionName(astNode.property ?? null) === 'env'
        ) {
            analysis.environmentAccessCount += 1;
        }
        if (
            astNode.type === 'MemberExpression' &&
            this.expressionName(astNode.property ?? null) === 'body'
        ) {
            analysis.requestBodyAccessCount += 1;
        }
        if (
            astNode.type === 'MemberExpression' &&
            this.expressionName(astNode.property ?? null) === 'message' &&
            astNode.object?.type === 'Identifier'
        ) {
            analysis.throwMessageAccessCount += 1;
        }
        if (
            astNode.type === 'TSAsExpression' &&
            astNode.typeAnnotation?.type === 'TSUnknownKeyword'
        ) {
            analysis.unknownCastCount += 1;
        }
        if (astNode.type === 'NewExpression') {
            analysis.constructorCalls.push({
                className: this.expressionName(astNode.callee ?? null),
                firstArgumentName: this.expressionName(
                    astNode.arguments?.[0] ?? null,
                ),
            });
        }
        if (
            ['ClassMethod', 'ClassPrivateMethod', 'TSDeclareMethod'].includes(
                astNode.type ?? '',
            )
        ) {
            for (const parameter of astNode.params ?? []) {
                const parameterName = this.expressionName(parameter);
                if (parameterName) {
                    analysis.parameterNames.push(parameterName);
                }
            }
            const returnTypeName = this.typeName(astNode.returnType ?? null);
            if (returnTypeName) {
                analysis.returnTypeNames.push(returnTypeName);
            }
        }
        if (astNode.type === 'CallExpression') {
            const methodName =
                astNode.callee?.type === 'MemberExpression'
                    ? this.expressionName(astNode.callee.property ?? null)
                    : null;
            const offset =
                typeof (astNode as { start?: unknown }).start === 'number'
                    ? ((astNode as { start: number }).start)
                    : 0;
            if (methodName === 'validate') {
                analysis.validationCallOffsets.push(offset);
            }
            if (
                methodName &&
                ['save', 'create', 'insert', 'createUser'].includes(methodName)
            ) {
                analysis.persistenceCallOffsets.push(offset);
            }
        }

        for (const [key, value] of Object.entries(astNode)) {
            if (['loc', 'start', 'end'].includes(key)) {
                continue;
            }
            this.collectFacts(value, analysis);
        }
    }

    /** Describes one top-level class without interpreting its implementation. */
    // fallow-ignore-next-line complexity -- Declarative extraction covers independent class-member kinds.
    private classAnalysis(node: AstNode): ClassAnalysis {
        const members = node.body?.body ?? [];
        return {
            name: this.expressionName(node.id ?? null),
            baseName: this.expressionName(node.superClass ?? null),
            implementedNames: (node.implements ?? [])
                .map((item) =>
                    this.expressionName(
                        (item.expression as AstNode | undefined) ?? item,
                    ),
                )
                .filter((name): name is string => Boolean(name)),
            methodNames: this.memberNames(members, [
                'ClassMethod',
                'ClassPrivateMethod',
                'TSDeclareMethod',
            ]),
            propertyNames: this.memberNames(members, [
                'ClassProperty',
                'ClassPrivateProperty',
            ]),
        };
    }

    /** Extracts named class members for an explicit set of Babel node kinds. */
    private memberNames(members: AstNode[], types: string[]): string[] {
        return members
            .filter((member) => types.includes(member.type ?? ''))
            .map((member) => this.expressionName(member.key ?? null))
            .filter((name): name is string => Boolean(name));
    }

    /** Returns the primary identifier used by a TypeScript type annotation. */
    // fallow-ignore-next-line complexity -- Small recursive TypeScript-node normalizer.
    private typeName(node: AstNode | null): string | null {
        if (!node) {
            return null;
        }
        if (node.type === 'TSTypeAnnotation') {
            return this.typeName(node.typeAnnotation ?? null);
        }
        if (node.type === 'TSTypeReference') {
            return this.expressionName(
                (node.typeName as AstNode | undefined) ?? null,
            );
        }
        return node.type ?? null;
    }
}
