import type {
    DiagnosticLocation,
    LintIssue as SharedLintIssue,
    LintIssueDraft as SharedLintIssueDraft,
    LintJsonResult as SharedLintJsonResult,
    LintResult as SharedLintResult,
    LintSeverity,
    LintWriter,
    SourcePosition,
    SourceSpan,
} from '../../../../script/lint-diagnostics/interfaces.ts';
import type { BackendRuleId } from './rule.catalog.ts';

export type {
    DiagnosticLocation,
    LintSeverity,
    LintWriter,
    SourcePosition,
    SourceSpan,
};

/** Stable structured architecture finding returned by the linter core. */
export type LintIssue = SharedLintIssue<BackendRuleId>;

/** Dynamic source evidence normalized by the diagnostic factory. */
export type LintIssueDraft = SharedLintIssueDraft<BackendRuleId>;

/** Complete deterministic result returned by one linter run. */
export type LintResult = SharedLintResult<BackendRuleId>;

/** Versioned JSON payload emitted by the architecture CLI. */
export type LintJsonResult = SharedLintJsonResult<BackendRuleId>;

/** Import or re-export dependency discovered in a source file. */
export interface SourceDependency {
    source: string;
    kind: 'import' | 'export' | 'require' | 'dynamic-import';
    typeOnly: boolean;
    location: SourceSpan;
}

/** Architecture-relevant facts extracted for one class declaration. */
export interface ClassAnalysis {
    name: string | null;
    baseName: string | null;
    isAbstract: boolean;
    implementedNames: string[];
    methodNames: string[];
    propertyNames: string[];
    staticExecutablePropertyCount: number;
    baseTypeNames: Array<string | null>;
    location: SourceSpan;
}

/** One analyzed class method with architecture-relevant persistence calls. */
export interface ClassMethodAnalysis {
    className: string | null;
    name: string | null;
    calledMethods: string[];
    stringArguments: string[];
    setProperties: string[];
    accessibility: 'public' | 'protected' | 'private' | null;
    parameterTypeNames: Array<string | null>;
    returnTypeName: string | null;
    statementCount: number;
}

/** One handler registration discovered in a module gateway. */
export interface HandlerRegistration {
    transport: string | null;
    handlerClass: string | null;
}

/** One executable HTTP request discovered in backend test code. */
export interface HttpTestOperation {
    method: string;
    path: string;
    responseName?: string;
    offset?: number;
}

/** One status assertion tied to the response variable of an HTTP request. */
export interface HttpStatusAssertion {
    responseName: string;
    statuses: number[];
    exact: boolean;
    offset: number;
    location: SourceSpan;
}

/** One explicit row-to-object constructor mapping. */
export interface ObjectMapping {
    objectClass: string;
    sourceName: string;
    sourceProperties: string[];
    targetProperties: string[];
}

/** Relevant top-level declarations and dependencies extracted from one file. */
export interface SourceAnalysis {
    filePath: string;
    source: string;
    dependencies: SourceDependency[];
    interfaceCount: number;
    typeCount: number;
    constantCount: number;
    executableConstantCount: number;
    functionCount: number;
    classBaseNames: Array<string | null>;
    classes: ClassAnalysis[];
    classMethods: ClassMethodAnalysis[];
    interfaceBaseNames: string[];
    typeAliasOperationKinds: Array<{
        aliasName: string | null;
        unionMemberCount: number;
        operationLiteralCount: number;
        operationUnionInsideMember: boolean;
        payloadUnionInsideMember: boolean;
    }>;
    ownedModuleDefinitionCount: number;
    ownedModuleDefinitionHasSpread: boolean;
    ownedModuleDefinitionProperties: string[];
    methodCalls: string[];
    methodCallEvidence: Array<{ name: string; location: SourceSpan }>;
    constructorCalls: Array<{
        className: string | null;
        firstArgumentName: string | null;
        location: SourceSpan;
    }>;
    parameterNames: string[];
    returnTypeNames: string[];
    handlerResultPayloadNames: Array<string | null>;
    anyTypeCount: number;
    catchCount: number;
    objectReturnCount: number;
    environmentAccessCount: number;
    requestBodyAccessCount: number;
    unknownCastCount: number;
    anyAssertionCount: number;
    doubleAssertionCount: number;
    nonErasableSyntaxCount: number;
    throwMessageAccessCount: number;
    handlerRegistrations: HandlerRegistration[];
    httpTestOperations: HttpTestOperation[];
    httpHandlerOperations: HttpTestOperation[];
    assertedHttpStatuses: number[];
    httpStatusAssertions: HttpStatusAssertion[];
    dtoCastFromJsonCount: number;
    permissiveAssertionCount: number;
    testCallCount: number;
    jsonResultVariables: string[];
    dtoResultVariables: string[];
    controllerPayloadVariables: string[];
    objectMappings: ObjectMapping[];
    validationCallOffsets: number[];
    persistenceCallOffsets: number[];
    controlFlowCount: number;
    evidenceLocations: {
        declarations: SourceSpan[];
        imports: SourceSpan[];
        handlerResults: SourceSpan[];
        dtoCasts: SourceSpan[];
        typeAssertions: SourceSpan[];
        methodCalls: SourceSpan[];
        httpAssertions: SourceSpan[];
    };
}

/** Configuration accepted by the reusable linter core. */
export interface BackendLinterConfig {
    projectRoot: string;
}
