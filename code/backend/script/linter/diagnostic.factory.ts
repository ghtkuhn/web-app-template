import type {
    LintIssue,
    LintIssueDraft,
    SourceAnalysis,
    SourceSpan,
} from './interfaces.ts';
import { PathResolver } from './path.resolver.ts';
import {
    RuleCatalog,
    type BackendRuleId,
} from './rule.catalog.ts';

const EVIDENCE_BY_RULE: Readonly<
    Partial<Record<
        BackendRuleId,
        keyof SourceAnalysis['evidenceLocations']
    >>
> = {
    ANONYMOUS_RESPONSE_CONTRACT: 'handlerResults',
    CONSTANT_EXECUTABLE_VALUE: 'declarations',
    CONTROLLER_TRANSPORT_INPUT: 'declarations',
    DECLARATION_CONSTANT_LOCATION: 'declarations',
    DECLARATION_INTERFACE_LOCATION: 'declarations',
    DECLARATION_TYPE_LOCATION: 'declarations',
    DOMAIN_ENV_ACCESS: 'declarations',
    DOMAIN_OBJECT_TRANSPORT: 'handlerResults',
    HANDLER_DTO_CAST_BYPASS: 'dtoCasts',
    HANDLER_CONCRETE_DTO_CONTRACT: 'handlerResults',
    HANDLER_DTO_OUTPUT: 'handlerResults',
    DOMAIN_ARCHITECTURE_CAST: 'typeAssertions',
    DOMAIN_ANY_TYPE: 'typeAssertions',
    HANDLER_DTO_INPUT: 'declarations',
    HANDLER_UNVALIDATED_INPUT: 'declarations',
    MODULE_FREE_FUNCTION: 'declarations',
    NODE_ERASABLE_TYPES_ONLY: 'declarations',
    OBJECT_VALIDATION_BEFORE_PERSIST: 'methodCalls',
    RAW_ERROR_RESPONSE: 'declarations',
    SECRET_FALLBACK: 'declarations',
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
    DATABASE_DRIVER_OWNERSHIP: 'imports',
};

const METHOD_NAMES_BY_RULE: Readonly<
    Partial<Record<BackendRuleId, readonly string[]>>
> = {
    CONTROLLER_MAPPING: ['fromObject', 'toObject'],
    OPERATION_GENERIC_UPSERT: ['upsert'],
    OPERATION_GLOBAL_STORE_READ: ['findAll'],
    OPERATION_IN_MEMORY_QUERY: ['filter', 'slice'],
};

const CLASS_EVIDENCE_RULES = new Set<BackendRuleId>([
    'AUX_CLASS_COUNT',
    'CONTROLLER_DTO_CONTRACT',
    'CONTROLLER_ERROR_TRANSLATION',
    'DATABASE_CONNECTION_CREATION',
    'DTO_EXECUTABLE_LOGIC',
    'LAYER_BASE_CLASS',
    'LAYER_CLASS_COUNT',
    'LAYER_CLASS_NAME',
    'LAYER_RETURN_CONTRACT',
    'MODULE_CLASS_COUNT',
    'MODULE_DEFINITION_OWNERSHIP',
    'MODULE_FACTORY_COMPLETENESS',
    'MODULE_INFRASTRUCTURE_CONTRACT',
    'MODULE_PORT_CONCRETE_BASE',
    'NODE_REQUEST_DISCRIMINATION',
    'OPERATION_BASE_CLASS',
    'OPERATION_CLASS_NAME',
    'OPERATION_EXECUTE_CONTRACT',
    'OPERATION_INPUT_CONTRACT',
    'OPERATION_PUBLIC_METHOD',
    'SENSITIVE_OBJECT_SERIALIZATION',
    'SERVICE_OPERATION_MISSING',
    'SERVICE_ROUTER_BUSINESS_LOGIC',
    'SERVICE_ROUTER_DRIFT',
    'SERVICE_ROUTER_REQUIRED',
    'STORE_ACTIVE_READ_FILTER',
    'STORE_ANY_TYPE',
    'STORE_GENERIC_METHOD',
    'STORE_OBJECT_METADATA_MAPPING',
    'STORE_QUERY_OBJECT_MAPPING',
    'STORE_SOFT_DELETE_CONTRACT',
]);

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

    /** Expands dynamic evidence and attaches the best available source span. */
    public create(draft: LintIssueDraft): LintIssue {
        const moduleName = draft.file.match(
            /code\/backend\/src\/module\/([^/]+)/u,
        )?.[1];
        return this.catalog.create({
            ...draft,
            data: {
                ...(moduleName ? { module: moduleName } : {}),
                ...draft.data,
            },
            location:
                draft.location ??
                this.evidenceLocation(draft),
        });
    }

    /** Selects AST evidence for rules that identify executable syntax. */
    private evidenceLocation(draft: LintIssueDraft): SourceSpan | null {
        const analysis = this.analyses.get(draft.file);
        if (!analysis) {
            return null;
        }
        if (CLASS_EVIDENCE_RULES.has(draft.ruleId)) {
            return analysis.classes[0]?.location ?? null;
        }
        const methodNames = METHOD_NAMES_BY_RULE[draft.ruleId];
        if (methodNames) {
            return analysis.methodCallEvidence.find((entry) =>
                methodNames.includes(entry.name),
            )?.location ?? null;
        }
        const evidenceKind = EVIDENCE_BY_RULE[draft.ruleId];
        if (evidenceKind) {
            return analysis.evidenceLocations[evidenceKind][0] ?? null;
        }
        return (
            null
        );
    }
}
