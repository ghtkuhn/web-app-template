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
    MODULE_TEST_COVERAGE:
        'Add a direct module test/*.test.ts file with an executable node:test test() and regenerate the test catalog.',
    MODULE_TEST_CROSS_IMPORT:
        'Import another module only through its public index.ts entry point.',
    MODULE_TEST_DIRECTORY_EMPTY:
        'Add an executable direct *.test.ts file or remove the empty test directory.',
    MODULE_TEST_PRODUCTION_IMPORT:
        'Remove the test dependency from production code; tests are private and runner-owned.',
    MODULE_TEST_REEXPORT:
        'Replace the re-export with a test-local import.',
    MODULE_TEST_STRUCTURE:
        'Keep lowercase *.test.ts files directly inside the module test directory without nesting.',
    TEST_CATALOG_DRIFT:
        'Run npm run generate:test-catalog and commit the deterministic catalog update.',
    SERVICE_ROUTER_REQUIRED:
        'Extend BaseService and regenerate the complete router with npm run module:sync.',
    SERVICE_ROUTER_DRIFT:
        'Run npm run module:sync for the containing module; do not edit the generated Service manually.',
    SERVICE_ROUTER_BUSINESS_LOGIC:
        'Move the complete behavior into one owner-bound Operation and leave only direct execute delegation.',
    SERVICE_OPERATION_MISSING:
        'Create one concrete Operation for each public Service method and run module:sync.',
    OPERATION_FILE_NAME:
        'Rename the file to <kebab-case>.operation.ts under its Service owner directory.',
    OPERATION_CLASS_NAME:
        'Name the class after its file as <PascalCase>Operation.',
    OPERATION_BASE_CLASS:
        'Extend BaseServiceOperation<Input, Output, OwnerServiceDependencies>.',
    OPERATION_EXECUTE_CONTRACT:
        'Expose exactly one typed public execute(input) method; keep all helpers private.',
    OPERATION_PUBLIC_METHOD:
        'Keep execute as the only public method and make implementation helpers private.',
    OPERATION_INPUT_CONTRACT:
        'Use one named module input contract or void instead of loose or primitive parameters.',
    OPERATION_PEER_IMPORT:
        'Remove the peer import and keep the Operation self-contained.',
    OPERATION_ROUTING_MISSING:
        'Run npm run module:sync for the containing module.',
    SERVICE_AUX_FORBIDDEN:
        'Replace the Service Aux with a *.operation.ts class extending BaseServiceOperation.',
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
