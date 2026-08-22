import fs from 'node:fs';
import { parse } from '@babel/parser';
import type {
    ClassAnalysis,
    ClassMethodAnalysis,
    SourceAnalysis,
    SourceDependency,
    SourceSpan,
} from './interfaces.ts';
import { PassiveConstantAnalyzer } from './passive-constant.analyzer.ts';

type AstNode = {
    type?: string;
    source?: { value?: unknown };
    declaration?: AstNode | null;
    declarations?: Array<{
        id?: { type?: string };
        init?: AstNode | null;
    }>;
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
    properties?: AstNode[];
    init?: AstNode | null;
    left?: AstNode;
    right?: AstNode;
    static?: boolean;
    abstract?: boolean;
    accessibility?: 'public' | 'protected' | 'private';
    superTypeParameters?: { params?: AstNode[] };
    superTypeArguments?: { params?: AstNode[] };
    quasis?: Array<{ value?: { raw?: string } }>;
    loc?: {
        start?: { line?: number; column?: number };
        end?: { line?: number; column?: number };
    };
    [key: string]: unknown;
};

/** Extracts architecture-relevant facts from TypeScript source files. */
export class SourceAnalyzer {
    private readonly passiveConstants = new PassiveConstantAnalyzer();

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
                location: this.span(astNode),
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
                    location: this.span(astNode),
                });
            } else if (source && astNode.callee?.type === 'Import') {
                dependencies.push({
                    source,
                    kind: 'dynamic-import',
                    typeOnly: false,
                    location: this.span(astNode),
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
            executableConstantCount: 0,
            functionCount: 0,
            classBaseNames: [],
            classes: [],
            classMethods: [],
            interfaceBaseNames: [],
            typeAliasOperationKinds: [],
            ownedModuleDefinitionCount: 0,
            ownedModuleDefinitionHasSpread: false,
            ownedModuleDefinitionProperties: [],
            methodCalls: [],
            methodCallEvidence: [],
            constructorCalls: [],
            parameterNames: [],
            returnTypeNames: [],
            handlerResultPayloadNames: [],
            anyTypeCount: 0,
            catchCount: 0,
            objectReturnCount: 0,
            environmentAccessCount: 0,
            requestBodyAccessCount: 0,
            unknownCastCount: 0,
            anyAssertionCount: 0,
            doubleAssertionCount: 0,
            nonErasableSyntaxCount: 0,
            throwMessageAccessCount: 0,
            handlerRegistrations: [],
            httpTestOperations: [],
            httpHandlerOperations: [],
            assertedHttpStatuses: [],
            httpStatusAssertions: [],
            dtoCastFromJsonCount: 0,
            permissiveAssertionCount: 0,
            testCallCount: 0,
            jsonResultVariables: [],
            dtoResultVariables: [],
            controllerPayloadVariables: [],
            objectMappings: [],
            validationCallOffsets: [],
            persistenceCallOffsets: [],
            controlFlowCount: 0,
            evidenceLocations: {
                declarations: [],
                imports: [],
                handlerResults: [],
                dtoCasts: [],
                typeAssertions: [],
                methodCalls: [],
                httpAssertions: [],
            },
        };
    }

    /** Processes only declarations that are direct children of the program. */
    private processTopLevel(node: AstNode, analysis: SourceAnalysis): void {
        analysis.evidenceLocations.declarations.push(this.span(node));
        if (node.type === 'ImportDeclaration') {
            this.addDependency(node, 'import', analysis.dependencies);
            analysis.evidenceLocations.imports.push(this.span(node));
            return;
        }

        if (
            node.type === 'ExportNamedDeclaration' ||
            node.type === 'ExportDefaultDeclaration' ||
            node.type === 'ExportAllDeclaration'
        ) {
            this.addDependency(node, 'export', analysis.dependencies);
            if (node.source) {
                analysis.evidenceLocations.imports.push(this.span(node));
            }
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
                    analysis.executableConstantCount +=
                        node.declarations?.filter(
                            (declaration) =>
                                !this.passiveConstants.isPassive(
                                    declaration.init ?? null,
                                ),
                        ).length ?? 0;
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
                location: this.span(node),
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
        if (
            astNode.type === 'CallExpression' &&
            astNode.callee?.type === 'Identifier' &&
            astNode.callee.name === 'test'
        ) {
            analysis.testCallCount += 1;
        }
        if (
            astNode.type === 'TSTypeReference' &&
            this.expressionName(
                (astNode.typeName as AstNode | undefined) ?? null,
            ) === 'HandlerResult'
        ) {
            const parameter = (
                (astNode.typeParameters ??
                    astNode.typeArguments) as
                    | { params?: AstNode[] }
                    | undefined
            )?.params?.[0];
            analysis.handlerResultPayloadNames.push(
                parameter ? this.typeName(parameter) : null,
            );
            analysis.evidenceLocations.handlerResults.push(
                this.span(astNode),
            );
        }
        if (astNode.type === 'TSInterfaceDeclaration') {
            for (const base of (astNode.extends as AstNode[] | undefined) ?? []) {
                const name = this.expressionName(
                    (base.expression as AstNode | undefined) ?? base,
                );
                if (name) {
                    analysis.interfaceBaseNames.push(name);
                }
            }
        }
        if (astNode.type === 'TSTypeAliasDeclaration') {
            this.collectTypeAlias(astNode, analysis);
        }
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
            analysis.evidenceLocations.typeAssertions.push(
                this.span(astNode),
            );
        }
        if (
            astNode.type === 'TSAsExpression' &&
            astNode.typeAnnotation?.type === 'TSAnyKeyword'
        ) {
            analysis.anyAssertionCount += 1;
            analysis.evidenceLocations.typeAssertions.push(
                this.span(astNode),
            );
        }
        if (
            astNode.type === 'TSAsExpression' &&
            astNode.expression?.type === 'TSAsExpression'
        ) {
            analysis.doubleAssertionCount += 1;
            analysis.evidenceLocations.typeAssertions.push(
                this.span(astNode),
            );
        }
        if (
            astNode.type === 'TSAsExpression' &&
            this.typeName(astNode.typeAnnotation ?? null)?.endsWith('DTO') &&
            (
                this.isJsonRequest(astNode.expression ?? null) ||
                (
                    astNode.expression?.type === 'Identifier' &&
                    analysis.jsonResultVariables.includes(
                        astNode.expression.name ?? '',
                    )
                )
            )
        ) {
            analysis.dtoCastFromJsonCount += 1;
            analysis.evidenceLocations.dtoCasts.push(this.span(astNode));
        }
        if (
            [
                'TSParameterProperty',
                'TSEnumDeclaration',
                'TSModuleDeclaration',
                'TSImportEqualsDeclaration',
                'TSExportAssignment',
            ].includes(astNode.type ?? '')
        ) {
            analysis.nonErasableSyntaxCount += 1;
        }
        if (
            [
                'IfStatement',
                'SwitchStatement',
                'ForStatement',
                'ForInStatement',
                'ForOfStatement',
                'WhileStatement',
                'DoWhileStatement',
                'TryStatement',
                'ConditionalExpression',
            ].includes(astNode.type ?? '')
        ) {
            analysis.controlFlowCount += 1;
        }
        this.collectVariableFlow(astNode, analysis);
        this.collectHandlerRegistration(astNode, analysis);
        this.collectHttpTestEvidence(astNode, analysis);
        this.collectHttpHandlerEvidence(astNode, analysis);
        if (astNode.type === 'NewExpression') {
            analysis.constructorCalls.push({
                className: this.expressionName(astNode.callee ?? null),
                firstArgumentName: this.expressionName(
                    astNode.arguments?.[0] ?? null,
                ),
                location: this.span(astNode),
            });
            this.collectObjectMapping(astNode, analysis);
        }
        if (
            ['ClassMethod', 'ClassPrivateMethod', 'TSDeclareMethod'].includes(
                astNode.type ?? '',
            )
        ) {
            analysis.classMethods.push(
                this.classMethodAnalysis(astNode, analysis.classes),
            );
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
        if (
            astNode.type === 'ClassProperty' &&
            Boolean(astNode.static) &&
            this.expressionName(astNode.key ?? null) === 'definition'
        ) {
            analysis.ownedModuleDefinitionCount += 1;
            const value = astNode.value as AstNode | undefined;
            const object =
                value?.type === 'TSSatisfiesExpression'
                    ? value.expression
                    : value;
            if (object?.type === 'ObjectExpression') {
                analysis.ownedModuleDefinitionHasSpread =
                    (object.properties ?? []).some(
                        (property) => property.type === 'SpreadElement',
                    );
                analysis.ownedModuleDefinitionProperties.push(
                    ...(object.properties ?? [])
                        .filter((property) =>
                            ['ObjectProperty', 'ObjectMethod'].includes(
                                property.type ?? '',
                            ),
                        )
                        .map((property) =>
                            this.expressionName(property.key ?? null),
                        )
                        .filter((name): name is string => Boolean(name)),
                );
            }
        }
        if (astNode.type === 'CallExpression') {
            analysis.evidenceLocations.methodCalls.push(this.span(astNode));
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
            if (methodName) {
                analysis.methodCallEvidence.push({
                    name: methodName,
                    location: this.span(astNode.callee ?? astNode),
                });
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

    /** Describes one class method and its Kysely-style call chain. */
    // fallow-ignore-next-line complexity -- Collects orthogonal method facts in one AST pass.
    private classMethodAnalysis(
        node: AstNode,
        classes: ClassAnalysis[],
    ): ClassMethodAnalysis {
        const calledMethods: string[] = [];
        this.collectMethodCalls(node.body ?? null, calledMethods);
        const stringArguments: string[] = [];
        const setProperties: string[] = [];
        this.collectCallArguments(node.body ?? null, stringArguments, setProperties);
        return {
            className: classes.at(-1)?.name ?? null,
            name: this.expressionName(node.key ?? null),
            calledMethods,
            stringArguments,
            setProperties,
            accessibility: node.accessibility ?? null,
            parameterTypeNames: (node.params ?? []).map((parameter) =>
                this.typeName(parameter.typeAnnotation ?? null),
            ),
            returnTypeName: this.typeName(node.returnType ?? null),
            statementCount: node.body?.body?.length ?? 0,
        };
    }

    /** Collects literal query arguments and update-object property names. */
    // fallow-ignore-next-line complexity -- Recursively handles the finite Babel call-node shapes.
    private collectCallArguments(
        node: unknown,
        stringArguments: string[],
        setProperties: string[],
    ): void {
        if (!node || typeof node !== 'object') {
            return;
        }
        if (Array.isArray(node)) {
            for (const child of node) {
                this.collectCallArguments(child, stringArguments, setProperties);
            }
            return;
        }
        const astNode = node as AstNode;
        if (astNode.type === 'CallExpression') {
            for (const argument of astNode.arguments ?? []) {
                if (
                    argument.type === 'StringLiteral' &&
                    typeof argument.value === 'string'
                ) {
                    stringArguments.push(argument.value);
                }
            }
            if (
                astNode.callee?.type === 'MemberExpression' &&
                this.expressionName(astNode.callee.property ?? null) === 'set'
            ) {
                const object = astNode.arguments?.[0];
                if (object?.type === 'ObjectExpression') {
                    setProperties.push(
                        ...(object.properties ?? [])
                            .map((property) =>
                                this.expressionName(property.key ?? null),
                            )
                            .filter((name): name is string => Boolean(name)),
                    );
                }
            }
        }
        for (const [key, value] of Object.entries(astNode)) {
            if (!['loc', 'start', 'end'].includes(key)) {
                this.collectCallArguments(value, stringArguments, setProperties);
            }
        }
    }

    /** Records whether a Node request is a properly discriminated union. */
    // fallow-ignore-next-line complexity -- Traverses nested type-literal union members structurally.
    private collectTypeAlias(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        const annotation = node.typeAnnotation as AstNode | undefined;
        const members =
            annotation?.type === 'TSUnionType'
                ? ((annotation.types as AstNode[] | undefined) ?? [])
                : annotation
                  ? [annotation]
                  : [];
        let operationLiteralCount = 0;
        let operationUnionInsideMember = false;
        let payloadUnionInsideMember = false;
        for (const member of members) {
            if (member.type !== 'TSTypeLiteral') {
                continue;
            }
            for (const property of (member.members as AstNode[] | undefined) ?? []) {
                if (property.type !== 'TSPropertySignature') {
                    continue;
                }
                const key = this.expressionName(property.key ?? null);
                const value = (property.typeAnnotation as AstNode | undefined)
                    ?.typeAnnotation as AstNode | undefined;
                if (key === 'operation') {
                    if (value?.type === 'TSLiteralType') {
                        operationLiteralCount += 1;
                    }
                    if (value?.type === 'TSUnionType') {
                        operationUnionInsideMember = true;
                    }
                }
                if (
                    !['operation', 'context'].includes(key ?? '') &&
                    value?.type === 'TSUnionType'
                ) {
                    payloadUnionInsideMember = true;
                }
            }
        }
        if ((this.expressionName(node.id ?? null) ?? '').endsWith('NodeRequest')) {
            analysis.typeAliasOperationKinds.push({
                aliasName: this.expressionName(node.id ?? null),
                unionMemberCount: members.length,
                operationLiteralCount,
                operationUnionInsideMember,
                payloadUnionInsideMember,
            });
        }
    }

    /** Describes one top-level class without interpreting its implementation. */
    // fallow-ignore-next-line complexity -- Declarative extraction covers independent class-member kinds.
    private classAnalysis(node: AstNode): ClassAnalysis {
        const members = node.body?.body ?? [];
        return {
            name: this.expressionName(node.id ?? null),
            baseName: this.expressionName(node.superClass ?? null),
            isAbstract: Boolean(node.abstract),
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
            staticExecutablePropertyCount: members.filter(
                (member) =>
                    Boolean(member.static) &&
                    ['CallExpression', 'NewExpression'].includes(
                        (member.value as AstNode | undefined)?.type ?? '',
                    ),
            ).length,
            baseTypeNames:
                (
                    node.superTypeParameters ?? node.superTypeArguments
                )?.params?.map((parameter) => this.typeName(parameter)) ?? [],
            location: this.span(node),
        };
    }

    /** Records JSON variables, DTO construction, and controller arguments. */
    // fallow-ignore-next-line complexity -- Tracks three related variable-flow stages.
    private collectVariableFlow(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        if (node.type === 'VariableDeclarator') {
            const name = this.expressionName(node.id ?? null);
            const initializer = this.unwrapAwait(node.init ?? null);
            if (
                name &&
                initializer?.type === 'CallExpression' &&
                initializer.callee?.type === 'MemberExpression' &&
                this.expressionName(initializer.callee.property ?? null) ===
                    'json'
            ) {
                analysis.jsonResultVariables.push(name);
            }
            if (
                name &&
                initializer?.type === 'NewExpression' &&
                this.expressionName(initializer.callee ?? null)?.endsWith(
                    'DTO',
                )
            ) {
                analysis.dtoResultVariables.push(name);
            }
            if (name) {
                const fetchCall = this.fetchCall(node.init ?? null);
                const requestPath = fetchCall
                    ? this.httpPath(fetchCall.arguments?.[0] ?? null)
                    : null;
                if (fetchCall && requestPath) {
                    analysis.httpTestOperations.push({
                        method: this.fetchMethod(
                            fetchCall.arguments?.[1] ?? null,
                        ),
                        path: requestPath,
                        responseName: name,
                        offset:
                            typeof node.start === 'number' ? node.start : 0,
                    });
                }
            }
        }
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'MemberExpression' &&
            /(?:controller|service)/iu.test(
                this.expressionName(node.callee.object ?? null) ?? '',
            )
        ) {
            const argumentName = this.expressionName(
                node.arguments?.[0] ?? null,
            );
            if (argumentName) {
                analysis.controllerPayloadVariables.push(argumentName);
            }
        }
    }

    /** Records transport-to-handler registration performed by a module. */
    // fallow-ignore-next-line complexity -- Validates the complete registerHandler call shape.
    private collectHandlerRegistration(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        if (
            node.type !== 'CallExpression' ||
            node.callee?.type !== 'MemberExpression' ||
            this.expressionName(node.callee.property ?? null) !==
                'registerHandler'
        ) {
            return;
        }
        const transport = node.arguments?.[0];
        const handler = node.arguments?.[1];
        analysis.handlerRegistrations.push({
            transport:
                transport?.type === 'StringLiteral' &&
                typeof transport.value === 'string'
                    ? transport.value
                    : null,
            handlerClass:
                handler?.type === 'NewExpression'
                    ? this.expressionName(handler.callee ?? null)
                    : null,
        });
    }

    /** Records executable fetch operations and response-status assertions. */
    // fallow-ignore-next-line complexity -- Extracts two independent executable test facts.
    private collectHttpTestEvidence(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === 'fetch'
        ) {
            const requestPath = this.httpPath(node.arguments?.[0] ?? null);
            const requestMethod = this.fetchMethod(
                node.arguments?.[1] ?? null,
            );
            if (
                requestPath &&
                !this.hasHttpOperation(
                    analysis,
                    requestPath,
                    requestMethod,
                )
            ) {
                analysis.httpTestOperations.push({
                    method: requestMethod,
                    path: requestPath,
                });
            }
        }
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'MemberExpression' &&
            ['equal', 'strictEqual'].includes(
                this.expressionName(node.callee.property ?? null) ?? '',
            )
        ) {
            const [actual, expected] = node.arguments ?? [];
            if (
                actual?.type === 'MemberExpression' &&
                this.expressionName(actual.property ?? null) === 'status' &&
                expected?.type === 'NumericLiteral' &&
                typeof expected.value === 'number'
            ) {
                analysis.assertedHttpStatuses.push(expected.value);
                analysis.evidenceLocations.httpAssertions.push(
                    this.span(node),
                );
                const responseName = this.expressionName(
                    actual.object ?? null,
                );
                if (responseName) {
                    analysis.httpStatusAssertions.push({
                        responseName,
                        statuses: [expected.value],
                        exact: true,
                        offset:
                            typeof node.start === 'number' ? node.start : 0,
                        location: this.span(node),
                    });
                }
            }
        }
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'MemberExpression' &&
            this.expressionName(node.callee.property ?? null) === 'ok'
        ) {
            const comparisons = this.statusComparisons(
                node.arguments?.[0] ?? null,
            );
            if (comparisons.length > 0) {
                analysis.permissiveAssertionCount += 1;
                analysis.evidenceLocations.httpAssertions.push(
                    this.span(node),
                );
                for (const comparison of comparisons) {
                    analysis.httpStatusAssertions.push({
                        responseName: comparison.responseName,
                        statuses: [comparison.status],
                        exact: false,
                        offset:
                            typeof node.start === 'number' ? node.start : 0,
                        location: this.span(node),
                    });
                }
            }
        }
    }

    /** Tests whether one request was already recorded by its binding. */
    private hasHttpOperation(
        analysis: SourceAnalysis,
        requestPath: string,
        requestMethod: string,
    ): boolean {
        for (const operation of analysis.httpTestOperations) {
            if (
                operation.path === requestPath &&
                operation.method === requestMethod
            ) {
                return true;
            }
        }
        return false;
    }

    /** Returns a fetch call through optional await and type wrappers. */
    // fallow-ignore-next-line complexity -- Normalizes the finite Babel wrapper variants around fetch.
    private fetchCall(node: AstNode | null): AstNode | null {
        let current = node;
        while (
            current &&
            ['AwaitExpression', 'TSAsExpression', 'TSTypeAssertion'].includes(
                current.type ?? '',
            )
        ) {
            current =
                (current.argument as AstNode | undefined) ??
                (current.expression as AstNode | undefined) ??
                null;
        }
        return current?.type === 'CallExpression' &&
            current.callee?.type === 'Identifier' &&
            current.callee.name === 'fetch'
            ? current
            : null;
    }

    /** Detects request.json() through an optional await wrapper. */
    // fallow-ignore-next-line complexity -- Matches the finite Babel member/call shape without source heuristics.
    private isJsonRequest(node: AstNode | null): boolean {
        const current =
            node?.type === 'AwaitExpression'
                ? ((node.argument as AstNode | undefined) ?? null)
                : node;
        return Boolean(
            current?.type === 'CallExpression' &&
                current.callee?.type === 'MemberExpression' &&
                this.expressionName(current.callee.property ?? null) ===
                    'json',
        );
    }

    /** Extracts status comparisons used inside a permissive assertion. */
    // fallow-ignore-next-line complexity -- Recursively extracts both sides of logical status alternatives.
    private statusComparisons(
        node: AstNode | null,
    ): Array<{ responseName: string; status: number }> {
        if (!node) {
            return [];
        }
        if (node.type === 'LogicalExpression') {
            return [
                ...this.statusComparisons(node.left ?? null),
                ...this.statusComparisons(node.right ?? null),
            ];
        }
        if (
            node.type !== 'BinaryExpression' ||
            !['===', '=='].includes(
                typeof node.operator === 'string' ? node.operator : '',
            )
        ) {
            return [];
        }
        const member =
            node.left?.type === 'MemberExpression' ? node.left : node.right;
        const literal =
            node.left?.type === 'NumericLiteral' ? node.left : node.right;
        const responseName =
            member?.type === 'MemberExpression' &&
            this.expressionName(member.property ?? null) === 'status'
                ? this.expressionName(member.object ?? null)
                : null;
        return responseName &&
            literal?.type === 'NumericLiteral' &&
            typeof literal.value === 'number'
            ? [{ responseName, status: literal.value }]
            : [];
    }

    /** Records literal request-method and pathname guards in HTTP handlers. */
    // fallow-ignore-next-line complexity -- Correlates method and pathname guard expressions.
    private collectHttpHandlerEvidence(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        if (node.type !== 'IfStatement') {
            return;
        }
        const test = node.test as AstNode | undefined;
        const method = test ? this.comparedLiteral(test, 'method') : null;
        const route = test ? this.comparedLiteral(test, 'pathname') : null;
        if (route?.startsWith('/api/')) {
            analysis.httpHandlerOperations.push({
                method: (method ?? 'GET').toUpperCase(),
                path: route,
            });
        }
    }

    /** Finds a string literal compared to one member property in a condition. */
    // fallow-ignore-next-line complexity -- Recursively searches logical and binary conditions.
    private comparedLiteral(node: AstNode, propertyName: string): string | null {
        if (
            node.type === 'BinaryExpression' ||
            node.type === 'LogicalExpression'
        ) {
            if (node.type === 'BinaryExpression') {
                const sides = [node.left, node.right];
                const member = sides.find(
                    (side) =>
                        side?.type === 'MemberExpression' &&
                        this.expressionName(side.property ?? null) ===
                            propertyName,
                );
                const literal = sides.find(
                    (side) =>
                        side?.type === 'StringLiteral' &&
                        typeof side.value === 'string',
                );
                if (member && typeof literal?.value === 'string') {
                    return literal.value;
                }
            }
            return (
                (node.left && this.comparedLiteral(node.left, propertyName)) ||
                (node.right && this.comparedLiteral(node.right, propertyName)) ||
                null
            );
        }
        if (node.type === 'UnaryExpression' && node.argument) {
            return this.comparedLiteral(node.argument, propertyName);
        }
        return null;
    }

    /** Records explicit object-literal mappings from one row variable. */
    // fallow-ignore-next-line complexity -- Extracts source and target properties from Babel object nodes.
    private collectObjectMapping(
        node: AstNode,
        analysis: SourceAnalysis,
    ): void {
        const className = this.expressionName(node.callee ?? null);
        const object = node.arguments?.[0];
        if (
            !className?.endsWith('Object') ||
            object?.type !== 'ObjectExpression'
        ) {
            return;
        }
        const entries = (object.properties ?? []).filter(
            (property) => property.type === 'ObjectProperty',
        );
        const sourceNames = entries
            .map((property) => {
                const value = property.value as AstNode | undefined;
                return value?.type === 'MemberExpression'
                    ? this.expressionName(value.object ?? null)
                    : null;
            })
            .filter((name): name is string => Boolean(name));
        const sourceName = sourceNames[0];
        if (!sourceName) {
            return;
        }
        analysis.objectMappings.push({
            objectClass: className,
            sourceName,
            sourceProperties: entries
                .map((property) => {
                    const value = property.value as AstNode | undefined;
                    return value?.type === 'MemberExpression'
                        ? this.expressionName(
                              value.property ?? null,
                          )
                        : null;
                })
                .filter((name): name is string => Boolean(name)),
            targetProperties: entries
                .map((property) =>
                    this.expressionName(property.key ?? null),
                )
                .filter((name): name is string => Boolean(name)),
        });
    }

    /** Removes one await wrapper from an initializer. */
    private unwrapAwait(node: AstNode | null): AstNode | null {
        return node?.type === 'AwaitExpression'
            ? node.argument ?? null
            : node;
    }

    /** Extracts an API path from a fetch string or template literal. */
    // fallow-ignore-next-line complexity -- Supports the finite URL literal shapes used by tests.
    private httpPath(node: AstNode | null): string | null {
        if (
            node?.type === 'StringLiteral' &&
            typeof node.value === 'string'
        ) {
            return this.pathFromUrl(node.value);
        }
        if (node?.type === 'TemplateLiteral') {
            const text = (node.quasis ?? [])
                .map((quasi) => quasi.value?.raw ?? '')
                .join('{}');
            return this.pathFromUrl(text);
        }
        return null;
    }

    /** Returns a normalized literal API path from a URL fragment. */
    private pathFromUrl(value: string): string | null {
        const match = value.match(/(\/api\/[A-Za-z0-9_./{}:-]+)/u);
        return match?.[1] ?? null;
    }

    /** Reads the literal fetch method from an options object. */
    // fallow-ignore-next-line complexity -- Reads the optional fetch initialization object defensively.
    private fetchMethod(node: AstNode | null): string {
        if (node?.type !== 'ObjectExpression') {
            return 'GET';
        }
        const method = (node.properties ?? []).find(
            (property) =>
                property.type === 'ObjectProperty' &&
                this.expressionName(property.key ?? null) === 'method',
        )?.value as AstNode | undefined;
        return method?.type === 'StringLiteral' &&
            typeof method.value === 'string'
            ? method.value.toUpperCase()
            : 'GET';
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

    /** Converts a Babel location into the public one-based span contract. */
    private span(node: AstNode): SourceSpan {
        const startLine = node.loc?.start?.line ?? 1;
        const startColumn = (node.loc?.start?.column ?? 0) + 1;
        const endLine = node.loc?.end?.line ?? startLine;
        const endColumn = (node.loc?.end?.column ?? startColumn - 1) + 1;
        return {
            start: { line: startLine, column: startColumn },
            end: { line: endLine, column: endColumn },
        };
    }
}
