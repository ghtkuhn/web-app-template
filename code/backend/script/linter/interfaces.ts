/** Severity determines whether a finding is an architecture or linter failure. */
export type LintSeverity = 'error' | 'fatal';

/** Stable architecture finding returned by the linter core. */
export interface LintIssue {
    ruleId: string;
    severity: LintSeverity;
    file: string;
    message: string;
}

/** Complete deterministic result returned by one linter run. */
export interface LintResult {
    issues: LintIssue[];
    filesChecked: number;
}

/** Import or re-export dependency discovered in a source file. */
export interface SourceDependency {
    source: string;
    kind: 'import' | 'export' | 'require' | 'dynamic-import';
    typeOnly: boolean;
}

/** Architecture-relevant facts extracted for one class declaration. */
export interface ClassAnalysis {
    name: string | null;
    baseName: string | null;
    implementedNames: string[];
    methodNames: string[];
    propertyNames: string[];
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
    methodCalls: string[];
    constructorCalls: Array<{
        className: string | null;
        firstArgumentName: string | null;
    }>;
    parameterNames: string[];
    returnTypeNames: string[];
    anyTypeCount: number;
    catchCount: number;
    objectReturnCount: number;
    environmentAccessCount: number;
    requestBodyAccessCount: number;
    unknownCastCount: number;
    throwMessageAccessCount: number;
    validationCallOffsets: number[];
    persistenceCallOffsets: number[];
}

/** Minimal output stream used by the CLI adapter and its tests. */
export interface LintWriter {
    write(chunk: string): unknown;
}

/** Configuration accepted by the reusable linter core. */
export interface BackendLinterConfig {
    projectRoot: string;
}
