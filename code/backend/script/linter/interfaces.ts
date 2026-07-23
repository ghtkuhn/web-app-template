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
}

/** Relevant top-level declarations and dependencies extracted from one file. */
export interface SourceAnalysis {
    filePath: string;
    source: string;
    dependencies: SourceDependency[];
    interfaceCount: number;
    typeCount: number;
    constantCount: number;
    functionCount: number;
    classBaseNames: Array<string | null>;
    methodCalls: string[];
}

/** Minimal output stream used by the CLI adapter and its tests. */
export interface LintWriter {
    write(chunk: string): unknown;
}

/** Configuration accepted by the reusable linter core. */
export interface BackendLinterConfig {
    projectRoot: string;
}
