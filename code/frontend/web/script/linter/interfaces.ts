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
} from '../../../../../script/lint-diagnostics/interfaces.ts';
import type { FrontendRuleId } from './rule.catalog.ts';

export type {
    DiagnosticLocation,
    LintSeverity,
    LintWriter,
    SourcePosition,
    SourceSpan,
};

export type LintIssue = SharedLintIssue<FrontendRuleId>;
export type LintIssueDraft = SharedLintIssueDraft<FrontendRuleId>;
export type LintResult = SharedLintResult<FrontendRuleId>;
export type LintJsonResult = SharedLintJsonResult<FrontendRuleId>;

export interface SourceDependency {
    source: string;
    kind: 'import' | 'export' | 'dynamic-import';
    location: SourceSpan;
}

export interface LocatedName {
    name: string;
    location: SourceSpan;
}

export interface StyleBlock {
    content: string;
    scoped: boolean;
    declarations: StyleDeclaration[];
    atRules: StyleAtRule[];
    imports: string[];
    importEvidence: Array<{ source: string; location: SourceSpan }>;
    location: SourceSpan;
}

export interface StyleDeclaration {
    property: string;
    value: string;
    location: SourceSpan;
}

export interface StyleAtRule {
    name: string;
    parameters: string;
    location: SourceSpan;
}

export interface SourceAnalysis {
    filePath: string;
    source: string;
    dependencies: SourceDependency[];
    calls: string[];
    members: string[];
    callEvidence: LocatedName[];
    memberEvidence: LocatedName[];
    isVue: boolean;
    hasScript: boolean;
    hasNormalScript: boolean;
    hasScriptSetup: boolean;
    scriptLanguage: string | null;
    scriptLocation: SourceSpan | null;
    scriptSetupLocation: SourceSpan | null;
    styles: StyleBlock[];
}
