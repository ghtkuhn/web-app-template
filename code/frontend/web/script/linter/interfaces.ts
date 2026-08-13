export type LintSeverity = 'error' | 'fatal';

export interface LintIssue {
    ruleId: string;
    severity: LintSeverity;
    file: string;
    message: string;
}

export interface SourceDependency {
    source: string;
    kind: 'import' | 'export' | 'dynamic-import';
}

export interface StyleBlock {
    content: string;
    scoped: boolean;
    declarations: StyleDeclaration[];
    atRules: StyleAtRule[];
    imports: string[];
}

export interface StyleDeclaration {
    property: string;
    value: string;
}

export interface StyleAtRule {
    name: string;
    parameters: string;
}

export interface SourceAnalysis {
    filePath: string;
    source: string;
    dependencies: SourceDependency[];
    calls: string[];
    members: string[];
    isVue: boolean;
    hasScript: boolean;
    hasNormalScript: boolean;
    hasScriptSetup: boolean;
    scriptLanguage: string | null;
    styles: StyleBlock[];
}

export interface LintResult {
    issues: LintIssue[];
    filesChecked: number;
}

export interface LintWriter {
    write(chunk: string): unknown;
}
