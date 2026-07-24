const FIXES: Readonly<Record<string, string>> = {
    HANDLER_DTO_CAST_BYPASS:
        'Construct a concrete request DTO or call a typed validator returning it; never cast request JSON.',
    HANDLER_CONCRETE_DTO_CONTRACT:
        'Use HandlerResult<ConcreteResponseDTO> with one concrete business response contract.',
    HANDLER_DTO_INPUT:
        'Pass the concrete request DTO returned by construction or typed validation.',
    HANDLER_DTO_OUTPUT:
        'Declare the concrete business Response DTO carried by HandlerResult.',
    HANDLER_UNVALIDATED_INPUT:
        'Construct a request DTO or use a typed validator before calling the Controller.',
    HTTP_ASSERTION_EXACT:
        'Prepare one deterministic scenario per documented result and assert one exact status.',
    HTTP_STATUS_CONTRACT:
        'Add one deterministic request test with an exact assertion for every missing documented status.',
    HTTP_UNEXPECTED_SERVER_ERROR:
        'Assert the documented business status; document 500 only when it is an intentional API contract.',
    TEST_PERMISSIVE_ASSERTION:
        'Replace alternative or ranged outcomes with separate deterministic tests and exact assertions.',
    MODULE_ENTRY_CONTRACT:
        'Apply every reported module-entry Fix statement exactly at the public module entry point.',
};

/** Owns stable remediation guidance for backend architecture rules. */
export class RuleCatalog {
    /** Resolves embedded dynamic guidance or the stable rule fallback. */
    public fix(ruleId: string, embeddedFix: string | null): string {
        return (
            embeddedFix ??
            FIXES[ruleId] ??
            'Read code/backend/ARCHITECTURE.md and correct the reported contract without weakening or bypassing the rule.'
        );
    }
}
