/** Severity determines whether a finding is a contract or tooling failure. */
export type LintSeverity = 'error' | 'fatal';

/** One-based coordinate in a source file. */
export interface SourcePosition {
    readonly line: number;
    readonly column: number;
}

/** One-based, end-exclusive source range. */
export interface SourceSpan {
    readonly start: SourcePosition;
    readonly end: SourcePosition;
}

/** A secondary source location that helps explain the primary finding. */
export interface DiagnosticLocation {
    readonly file: string;
    readonly location: SourceSpan | null;
    readonly label: string;
}

/** Static teaching material associated with an architecture concept. */
export interface ArchitectureConcept {
    readonly context: string;
}

/** Static, authoritative metadata for one linter rule. */
export interface RuleDefinition<ConceptId extends string> {
    readonly title: string;
    readonly why: string;
    readonly meaning: string;
    readonly concept: ConceptId;
    readonly fixSteps: readonly string[];
    readonly verify: readonly string[];
}

/** Dynamic evidence produced by a rule implementation. */
export interface LintIssueDraft<RuleId extends string> {
    readonly ruleId: RuleId;
    readonly severity: LintSeverity;
    readonly file: string;
    readonly observed: string;
    readonly location?: SourceSpan | null;
    readonly relatedLocations?: readonly DiagnosticLocation[];
    readonly data?: Readonly<Record<string, string>>;
}

/** Self-contained architecture review returned to humans and tools. */
export interface LintIssue<RuleId extends string = string> {
    readonly ruleId: RuleId;
    readonly severity: LintSeverity;
    readonly title: string;
    readonly file: string;
    readonly location: SourceSpan | null;
    readonly relatedLocations: readonly DiagnosticLocation[];
    readonly observed: string;
    readonly why: string;
    readonly meaning: string;
    readonly context: string;
    readonly fixSteps: readonly string[];
    readonly verify: readonly string[];
}

/** Complete deterministic result returned by one linter run. */
export interface LintResult<RuleId extends string = string> {
    readonly issues: readonly LintIssue<RuleId>[];
    readonly filesChecked: number;
}

/** Versioned machine-readable result shared by both architecture linters. */
export interface LintJsonResult<RuleId extends string = string> {
    readonly schemaVersion: 2;
    readonly filesChecked: number;
    readonly issues: readonly LintIssue<RuleId>[];
}

/** Minimal output stream used by CLI adapters and tests. */
export interface LintWriter {
    write(chunk: string): unknown;
}
