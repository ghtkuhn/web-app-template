import type {
    LintIssue,
    LintIssueDraft,
    SourceAnalysis,
    SourceSpan,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import { RuleCatalog } from './rule.catalog.ts';

const FILE_START: SourceSpan = {
    start: { line: 1, column: 1 },
    end: { line: 1, column: 1 },
};

const EVIDENCE_BY_RULE: Readonly<
    Record<
        string,
        keyof SourceAnalysis['evidenceLocations']
    >
> = {
    HANDLER_DTO_CAST_BYPASS: 'dtoCasts',
    HANDLER_CONCRETE_DTO_CONTRACT: 'handlerResults',
    HANDLER_DTO_OUTPUT: 'handlerResults',
    DOMAIN_ARCHITECTURE_CAST: 'typeAssertions',
    DOMAIN_ANY_TYPE: 'typeAssertions',
    TEST_TYPE_ESCAPE: 'typeAssertions',
    HTTP_ASSERTION_EXACT: 'httpAssertions',
    HTTP_UNEXPECTED_SERVER_ERROR: 'httpAssertions',
    TEST_PERMISSIVE_ASSERTION: 'httpAssertions',
    AUX_IMPORT_DIRECTION: 'imports',
    AUX_IMPORT_OWNER: 'imports',
    AUX_REEXPORT: 'imports',
    COMPOSITION_PUBLIC_ENTRY: 'imports',
    CROSS_MODULE_PUBLIC_ENTRY: 'imports',
    DOMAIN_COMPOSITION_IMPORT: 'imports',
    LAYER_IMPORT_DIRECTION: 'imports',
    UNDECLARED_WORKSPACE_DEPENDENCY: 'imports',
    MODULE_POST_CONSTRUCTION_WIRING: 'methodCalls',
};

/** Converts internal rule findings into the public structured contract. */
export class DiagnosticFactory {
    private readonly analyses = new Map<string, SourceAnalysis>();
    private readonly catalog = new RuleCatalog();

    /** Creates a factory with analyzed source evidence. */
    public constructor(
        paths: PathResolver,
        analyses: readonly SourceAnalysis[],
    ) {
        for (const analysis of analyses) {
            this.analyses.set(
                paths.relative(analysis.filePath),
                analysis,
            );
        }
    }

    /** Separates reason and fix while attaching the best source span. */
    public create(draft: LintIssueDraft): LintIssue {
        const [reason, embeddedFix] = this.splitMessage(draft.message);
        return {
            ruleId: draft.ruleId,
            severity: draft.severity,
            file: draft.file,
            reason,
            fix: this.catalog.fix(draft.ruleId, embeddedFix),
            location:
                draft.location ??
                this.evidenceLocation(draft) ??
                FILE_START,
        };
    }

    /** Splits legacy rule wording during the structured migration. */
    private splitMessage(message: string): [string, string | null] {
        const marker = message.indexOf(' Fix: ');
        return marker < 0
            ? [message, null]
            : [
                  message.slice(0, marker),
                  message.slice(marker + ' Fix: '.length),
              ];
    }

    /** Selects AST evidence for rules that identify executable syntax. */
    private evidenceLocation(draft: LintIssueDraft): SourceSpan | null {
        const analysis = this.analyses.get(draft.file);
        if (!analysis) {
            return null;
        }
        const evidenceKind = EVIDENCE_BY_RULE[draft.ruleId];
        if (evidenceKind) {
            return analysis.evidenceLocations[evidenceKind][0] ?? null;
        }
        return (
            analysis.evidenceLocations.declarations[0] ??
            analysis.evidenceLocations.imports[0] ??
            FILE_START
        );
    }
}
