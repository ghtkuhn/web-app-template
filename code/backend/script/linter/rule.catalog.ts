import { DiagnosticCatalog } from '../../../../script/lint-diagnostics/diagnostic.catalog.ts';
import type {
    ArchitectureConcept,
    RuleDefinition,
} from '../../../../script/lint-diagnostics/interfaces.ts';

const CONCEPTS = {
    'module-layout': {
        context: 'A backend module lives under code/backend/src/module/<name>/. Its root contains only index.ts, interfaces.ts, types.ts, constants.ts, module.manifest.json, and the supported api, controller, service, store, object, dto, and test directories. Implementation classes belong in their layer; unsupported nesting and empty layer directories are invalid.',
    },
    'layer-flow': {
        context: 'Backend dependencies flow in one direction: API Handler -> Controller -> generated Service router -> owner-bound Operation -> Store -> Database. DTOs carry transport data and Domain Objects represent persistent domain state. Lower layers never depend on higher transport or coordination layers.',
    },
    'module-boundary': {
        context: 'Each module exposes its public port and typed ModuleDefinition only through module/<name>/index.ts. Other modules import that entry, receive declared ports through ModuleRegistry constructor injection, and never reach into another module\'s internal layer files.',
    },
    'transport-contract': {
        context: 'Handlers translate transport input into declared request DTOs and return HandlerResult<ConcreteResponseDTO>. Controllers remain transport-neutral. DTOs are passive, Domain Objects stay internal, and arbitrary exceptions or unvalidated request data do not cross these boundaries.',
    },
    'service-operation': {
        context: 'Main Service classes are generated routers. Each public method constructs exactly one owner-bound BaseServiceOperation and delegates directly to execute(). Validation, workflows, Store access, Domain Object construction, and DTO mapping belong inside the Operation.',
    },
    persistence: {
        context: 'Stores receive the shared typed Kysely client and expose domain-named, fully scoped queries. Filtering, ordering, pagination, counts, soft-delete handling, and row-to-Object mapping happen in the database or Store. Only base.database.ts owns drivers and connections.',
    },
    composition: {
        context: 'Composition is owned by application entry points, DatabaseManager, ModuleRegistry, the generated module catalog, and module factories. Module definitions directly own name, dependencies, and create; all handlers are wired before a factory returns.',
    },
    security: {
        context: 'Runtime configuration is validated in code/backend/src/config.ts. Domain modules do not read process.env or define secret defaults. Sensitive Domain Object fields are explicitly excluded from serialization.',
    },
    'http-contract': {
        context: 'openapi/openapi.yaml is the public HTTP contract. Every literal /api route and documented success or controlled error status requires an executable request test with one deterministic exact status assertion.',
    },
    'test-contract': {
        context: 'Concrete modules have direct executable test/*.test.ts files cataloged by the central runner. Tests may inspect their own module internals, but foreign modules are accessed only through public index.ts entries. Production never imports tests.',
    },
    migration: {
        context: 'Schema history consists of matching ordered SQLite and PostgreSQL migrations. Every logical version has one implementation per dialect and a checked-in SHA-256 catalog; applied migrations remain immutable.',
    },
    workspace: {
        context: 'The repository root owns the workspace lockfile, shared TypeScript toolchain, and complete verification pipeline. Workspaces declare their runtime dependencies but do not duplicate root-owned compiler packages or verification contracts.',
    },
    typescript: {
        context: 'Executable backend TypeScript uses Node-compatible erasable syntax and explicit contracts. Local imports include .ts, regular module files contain one architecture class, and type assertions or any cannot bypass layer contracts.',
    },
    'tooling-failure': {
        context: 'The linter must parse its inputs and load its contracts before it can review application code. A fatal diagnostic means the architecture result is incomplete and must not be treated as a successful review.',
    },
} as const satisfies Record<string, ArchitectureConcept>;

type ConceptId = keyof typeof CONCEPTS;
type Definition = RuleDefinition<ConceptId>;

const MEANINGS: Readonly<Record<ConceptId, string>> = {
    'module-layout': 'The physical structure no longer identifies architectural ownership, so scaffolds, generators, and reviewers cannot reason about the module reliably.',
    'layer-flow': 'Transport, application, domain, and persistence concerns become coupled and the permitted dependency direction can no longer be proven.',
    'module-boundary': 'Consumers become coupled to implementation details and can bypass declared dependencies, injection, or stable public contracts.',
    'transport-contract': 'Runtime input, public JSON, and application contracts can diverge or expose internal and sensitive details.',
    'service-operation': 'Generated routing and application behavior can drift, obscuring the single owner of the workflow and making regeneration unsafe.',
    persistence: 'Data scope, consistency, deletion semantics, or mapping can behave incorrectly across tenants and application instances.',
    composition: 'Startup can become order-dependent, module-specific, or incomplete instead of being validated from module-owned definitions.',
    security: 'Unvalidated configuration or sensitive state can reach domain behavior, logs, or public responses.',
    'http-contract': 'Clients and generated types can no longer rely on the published endpoint behavior.',
    'test-contract': 'Required evidence may be skipped by the runner or production code may become coupled to test-only internals.',
    migration: 'Supported dialects can represent different schemas or applied database history can no longer be verified safely.',
    workspace: 'Builds and typechecks can depend on accidental hoisting or incompatible local toolchain contracts.',
    typescript: 'The code may compile under a false type contract or fail when Node executes it directly.',
    'tooling-failure': 'No trustworthy architecture conclusion can be drawn for the affected input or linter run.',
};

function define(
    title: string,
    concept: ConceptId,
    why: string,
    fix: string,
    verify?: string,
): Definition {
    const defaultVerify = concept === 'http-contract'
        ? 'npm run check:api'
        : concept === 'migration'
            ? 'npm run check:migrations'
            : concept === 'test-contract'
                ? 'npm run test --workspace @app/backend'
                : 'npm run lint:backend';
    return {
        title,
        concept,
        why,
        meaning: MEANINGS[concept],
        fixSteps: [fix],
        verify: [verify ?? defaultVerify],
    };
}

const RULES = {
    ANONYMOUS_RESPONSE_CONTRACT: define('Response contracts must use a named DTO', 'transport-contract', 'Anonymous object shapes do not provide one stable public transport contract.', 'Declare a concrete Response DTO and use it as the HandlerResult payload.'),
    AUX_CLASS_COUNT: define('An auxiliary file must declare exactly one class', 'layer-flow', 'Owner-bound auxiliaries have one file, one class, and one unambiguous owner.', 'Keep exactly one BaseApiAux or BaseStoreAux class in the file.'),
    AUX_FILE_TYPE: define('Auxiliary folders may contain only TypeScript files', 'module-layout', 'Auxiliary folders are private implementation namespaces, not general asset directories.', 'Move or remove the non-TypeScript file from the auxiliary folder.'),
    AUX_IMPORT_DIRECTION: define('An auxiliary imports a forbidden same-layer dependency', 'layer-flow', 'An auxiliary is a leaf implementation owned exclusively by its direct parent.', 'Remove imports of the owner, auxiliary peers, and other files from the same layer.'),
    AUX_IMPORT_OWNER: define('Only the matching owner may import an auxiliary', 'layer-flow', 'Auxiliaries are private implementation details of one direct owner file.', 'Move the behavior behind the matching owner and remove the foreign auxiliary import.'),
    AUX_LAYER_UNSUPPORTED: define('This layer does not support auxiliary folders', 'module-layout', 'Only API transport details and private Store projections may use auxiliaries.', 'Move application behavior into an Operation or directly into a supported layer class.'),
    AUX_OWNER_MISSING: define('The auxiliary folder has no matching owner file', 'module-layout', 'An auxiliary folder is valid only when its direct owner exists in the parent layer.', 'Create the matching owner through the scaffold or remove the orphan auxiliary folder.'),
    AUX_PATH_DEPTH: define('Auxiliary folders may not be nested', 'module-layout', 'One level of owner-bound nesting is the maximum supported ownership model.', 'Flatten the auxiliary into its owner folder and remove deeper nesting.'),
    AUX_REEXPORT: define('Auxiliary implementations must not be re-exported', 'layer-flow', 'Only the owner may know or expose behavior backed by its private auxiliary.', 'Remove the re-export and access the behavior through the matching owner.'),
    CATALOG_AGGREGATION_ONLY: define('The generated module catalog may only aggregate definitions', 'composition', 'Dependencies and factories belong to module-owned definitions, not generated aggregation.', 'Move metadata into module definitions and regenerate module.catalog.ts.'),
    COMPOSITION_GENERICITY: define('Composition must not contain module-specific branching', 'composition', 'Composition operates on typed ModuleDefinitions instead of hard-coded module names.', 'Express the behavior through module-owned metadata and generic registry logic.'),
    COMPOSITION_PUBLIC_ENTRY: define('Composition must import modules through public entries', 'module-boundary', 'Composition also consumes the stable public module contract.', 'Import the module from its index.ts public entry.'),
    CONSTANT_EXECUTABLE_VALUE: define('Module constants must remain passive values', 'layer-flow', 'Executable schemas, validators, and factories contain behavior and require an application owner.', 'Move executable behavior into the owning Operation and leave only passive values in constants.ts.'),
    CONTROLLER_DTO_CONTRACT: define('Controllers must return concrete DTO contracts', 'transport-contract', 'A Controller coordinates one typed application result without anonymous or base payloads.', 'Return HandlerResult<ConcreteResponseDTO> from the Controller.'),
    CONTROLLER_ERROR_TRANSLATION: define('Controllers must not translate arbitrary exceptions', 'transport-contract', 'Controlled business outcomes are explicit; unknown exceptions belong to centralized error handling.', 'Handle declared outcomes explicitly and let unknown errors propagate.'),
    CONTROLLER_MAPPING: define('Object-to-DTO mapping belongs in an Operation', 'layer-flow', 'Controllers coordinate Services and do not construct transport projections from Domain Objects.', 'Move the mapping into the owner-bound Operation.'),
    CONTROLLER_TRANSPORT_INPUT: define('Controllers must remain transport-neutral', 'transport-contract', 'Request, response, socket, and body objects belong exclusively to Handlers.', 'Translate transport input in the Handler and pass a request DTO.'),
    CROSS_MODULE_PUBLIC_ENTRY: define('Cross-module imports must use the public entry', 'module-boundary', 'A module may depend only on the public port exported by another module index.ts.', 'Import from the foreign index.ts and inject the declared port.'),
    DATABASE_CONNECTION_CREATION: define('Database connections have one infrastructure owner', 'persistence', 'Only base.database.ts may instantiate database connections.', 'Receive the shared database client through constructor injection.'),
    DATABASE_DRIVER_OWNERSHIP: define('Database drivers have one infrastructure owner', 'persistence', 'Domain modules depend on the database abstraction, not a concrete driver.', 'Remove the driver import; only base.database.ts imports drivers.'),
    DATABASE_OBJECT_METADATA: define('The database schema must include object lifecycle metadata', 'persistence', 'Persistent object tables require typed identity, timestamps, and soft-delete columns.', 'Update database.ts and add paired migrations for missing metadata.'),
    DECLARATION_CONSTANT_LOCATION: define('Module constants belong in constants.ts', 'module-layout', 'Centralized constants keep ownership and import direction reviewable.', 'Move the constant into the module-level constants.ts file.'),
    DECLARATION_INTERFACE_LOCATION: define('Module interfaces belong in interfaces.ts', 'module-layout', 'Centralized interfaces define the module contract without loose declarations.', 'Move the interface into the module-level interfaces.ts file.'),
    DECLARATION_TYPE_LOCATION: define('Module type aliases belong in types.ts', 'module-layout', 'Centralized aliases keep contracts discoverable and out of implementations.', 'Move the type alias into the module-level types.ts file.'),
    DOMAIN_ANY_TYPE: define('Domain code must not use any', 'typescript', 'any disables the contracts used by TypeScript and architecture rules.', 'Replace any with a concrete type, generic constraint, or validated unknown.'),
    DOMAIN_ARCHITECTURE_CAST: define('Type assertions must not bypass architecture contracts', 'typescript', 'A cast changes compiler belief without validating runtime data or ownership.', 'Construct or validate the concrete value and remove the assertion.'),
    DOMAIN_COMPOSITION_IMPORT: define('Domain modules must not import composition internals', 'composition', 'Registry and entry points own application wiring and cannot become domain dependencies.', 'Inject the required public port or infrastructure dependency.'),
    DOMAIN_ENV_ACCESS: define('Domain modules must not read process.env', 'security', 'Environment access is validated once by config.ts and injected as typed configuration.', 'Add the setting to validated configuration and inject it.'),
    DOMAIN_OBJECT_TRANSPORT: define('Domain Objects must not cross transport boundaries', 'transport-contract', 'Persistent state and public JSON have different privacy and compatibility contracts.', 'Map the Domain Object to a concrete DTO inside the Operation.'),
    DTO_EXECUTABLE_LOGIC: define('DTOs must remain passive data', 'transport-contract', 'Validation, schemas, workflows, and business helpers belong in Operations.', 'Move executable logic into the owner-bound Operation.'),
    HANDLER_CONCRETE_DTO_CONTRACT: define('Handler success contracts require one concrete response DTO', 'transport-contract', 'A HandlerResult must identify the exact business response shape.', 'Use HandlerResult<ConcreteResponseDTO>, not BaseDTO, object, or a union.'),
    HANDLER_DTO_CAST_BYPASS: define('A request JSON cast is not validation', 'transport-contract', 'Untrusted request data must be constructed as or validated into a request DTO.', 'Construct a request DTO or call a typed validator; never cast request JSON.'),
    HANDLER_DTO_INPUT: define('Handler business input must be a request DTO', 'transport-contract', 'The Handler owns conversion from transport data to application input.', 'Pass the concrete request DTO returned by construction or validation.'),
    HANDLER_DTO_OUTPUT: define('Handler business output must be a response DTO', 'transport-contract', 'The public response needs one declared serializable representation.', 'Declare and return the concrete Response DTO carried by HandlerResult.'),
    HANDLER_UNVALIDATED_INPUT: define('Handler input must be validated before delegation', 'transport-contract', 'Controllers and Operations receive typed application input, never raw JSON.', 'Construct a request DTO or use a typed validator before delegation.'),
    HTTP_ASSERTION_EXACT: define('HTTP status assertions must be exact', 'http-contract', 'One deterministic scenario must prove one documented response status.', 'Assert one exact status with equal() or strictEqual().'),
    HTTP_OPENAPI_COVERAGE: define('The HTTP route is missing from OpenAPI', 'http-contract', 'Every concrete literal /api route and method must exist in OpenAPI.', 'Add the route and method to openapi.yaml or remove the handler.'),
    HTTP_STATUS_CONTRACT: define('Documented HTTP statuses need executable coverage', 'http-contract', 'Every documented success and controlled error needs an exact request test.', 'Add one deterministic request test for each reported status.'),
    HTTP_TEST_EXECUTABLE_COVERAGE: define('HTTP handlers require executable request tests', 'http-contract', 'Comments and route strings do not prove actual server behavior.', 'Exercise the route with fetch() or the standard HTTP helper.'),
    HTTP_UNEXPECTED_SERVER_ERROR: define('The test accepts an undocumented server error', 'http-contract', 'A 500 is valid only when it is an intentional documented outcome.', 'Make the scenario deterministic and assert the documented business status.'),
    LAYER_BASE_CLASS: define('The architecture class extends the wrong base class', 'layer-flow', 'Each layer base establishes capabilities and dependency limits.', 'Extend the base class prescribed by the file layer.'),
    LAYER_CLASS_COUNT: define('A regular architecture file must declare exactly one class', 'module-layout', 'One class per file keeps filename, owner, layer, and scaffold aligned.', 'Split additional classes into architecture-compliant files.'),
    LAYER_CLASS_NAME: define('The class name does not match its architecture file', 'module-layout', 'Generators derive ownership from deterministic file and class names.', 'Rename the class to the exact name prescribed by its filename.'),
    LAYER_FILE_NAME: define('The filename does not match its architecture layer', 'module-layout', 'Layer suffixes identify responsibility and enable deterministic discovery.', 'Rename the file using the scaffolded layer convention.'),
    LAYER_IMPORT_DIRECTION: define('A dependency points against the allowed layer flow', 'layer-flow', 'A lower layer cannot import transport or coordination layers above it.', 'Move behavior to its owner or depend on an allowed lower-level contract.'),
    LAYER_RETURN_CONTRACT: define('The layer returns an unsupported contract', 'transport-contract', 'Handler and Controller boundaries return declared HandlerResult DTO contracts.', 'Return the concrete HandlerResult<DTO> prescribed for the layer.'),
    LINTER_FAILURE: define('The backend architecture linter could not complete', 'tooling-failure', 'An unexpected failure prevents a trustworthy architecture result.', 'Repair the reported tooling failure before changing backend source.'),
    LOCAL_IMPORT_EXTENSION: define('Local TypeScript imports require the .ts extension', 'typescript', 'Node ESM resolution uses explicit TypeScript source extensions.', 'Append .ts to the local import or re-export specifier.'),
    MIGRATION_DIALECT_PARITY: define('SQLite and PostgreSQL migrations are not paired', 'migration', 'Every logical schema version must exist for both dialects.', 'Add the matching migration to the missing dialect and regenerate checksums.'),
    MIGRATION_DIALECT_STRUCTURE: define('Migration files violate the dialect structure', 'migration', 'Migrations are discovered only as numbered kebab-case files directly under each dialect.', 'Move and rename the migration, then regenerate checksums.'),
    MODULE_CLASS_COUNT: define('A module file contains too many classes', 'module-layout', 'One class per file preserves unambiguous architecture ownership.', 'Split the classes into scaffolded architecture files.'),
    MODULE_DEFINITION_OWNERSHIP: define('The module definition must be owned by the module class', 'composition', 'name, dependencies, and create are direct static definition properties.', 'Declare the complete static definition directly without spreads.'),
    MODULE_DIRECTORY_EMPTY: define('Empty architecture layer directories are forbidden', 'module-layout', 'A layer directory declares that the module owns that responsibility.', 'Remove the directory or add its implementation through a scaffold.'),
    MODULE_DIRECTORY_NAME: define('Module directory names must be kebab-case', 'module-layout', 'The directory name is the stable identity used by generators.', 'Rename it to lowercase kebab-case and synchronize metadata.'),
    MODULE_DIRECTORY_UNKNOWN: define('The module root contains an unsupported directory', 'module-layout', 'Only declared architecture layers may exist below a module root.', 'Move contents into a supported layer or remove the directory.'),
    MODULE_ENTRY_CONTRACT: define('The public module entry is incomplete', 'module-boundary', 'The entry exposes the public port and a complete typed static definition.', 'Add every missing entry requirement listed under Found.'),
    MODULE_ENTRY_MISSING: define('The module has no public index.ts entry', 'module-boundary', 'Every module needs one public gateway for its port and definition.', 'Create the scaffold-equivalent public index.ts contract.'),
    MODULE_FACTORY_COMPLETENESS: define('The module factory does not register every handler', 'composition', 'Every Handler is constructed and registered before the factory returns.', 'Construct and register each concrete Handler in the factory.'),
    MODULE_FREE_FUNCTION: define('Free functions are forbidden in regular module files', 'module-layout', 'Executable behavior must have a class and layer owner.', 'Move the function into the owning architecture class.'),
    MODULE_INFRASTRUCTURE_CONTRACT: define('Infrastructure is modeled as a module dependency', 'composition', 'Database and application infrastructure are supplied by composition.', 'Remove the domain dependency and inject infrastructure in the factory.'),
    MODULE_NON_SOURCE_FILE: define('The module root contains an unsupported non-source file', 'module-layout', 'Roots contain only declared TypeScript contracts and module.manifest.json.', 'Move the artifact outside the module root or remove it.'),
    MODULE_PORT_CONCRETE_BASE: define('Public module ports must not extend BaseModule', 'module-boundary', 'Consumers depend on IBaseModule or an explicit dispatch contract.', 'Extend IBaseModule or declare the required typed dispatch contract.'),
    MODULE_POST_CONSTRUCTION_WIRING: define('Post-construction wiring is forbidden', 'composition', 'A module is complete when its factory returns.', 'Supply dependencies and register handlers during construction.'),
    MODULE_REGISTRATION_MISSING: define('The module is missing from the generated catalog', 'composition', 'Every definition must be aggregated for validation and activation.', 'Run npm run module:sync -- {{module}} and commit the catalog.'),
    MODULE_ROOT_FILE: define('The module root file is not allowed', 'module-layout', 'Only declared public and passive contracts may live at module root.', 'Move implementation code into its owning layer.'),
    MODULE_ROOT_PLACEMENT: define('Implementation code is loose in the module root', 'module-layout', 'A root implementation has no layer ownership.', 'Move the class into the matching architecture layer.'),
    MODULE_TEST_COVERAGE: define('A concrete module requires an executable local test', 'test-contract', 'Concrete behavior requires direct module-local evidence.', 'Run npm run scaffold:test -- {{module}} and regenerate the catalog.'),
    MODULE_TEST_CROSS_IMPORT: define('Tests must use foreign modules through public entries', 'test-contract', 'A test may inspect only its own module internals.', 'Replace the foreign internal import with its index.ts contract.'),
    MODULE_TEST_DIRECTORY_EMPTY: define('Module test directories must not be empty', 'test-contract', 'A test directory declares executable module coverage.', 'Add a direct *.test.ts file or remove the directory.'),
    MODULE_TEST_PRODUCTION_IMPORT: define('Production code must not import tests', 'test-contract', 'Tests are private evidence owned by the runner.', 'Remove the test dependency from production code.'),
    MODULE_TEST_REEXPORT: define('Tests must not be re-exported', 'test-contract', 'Test implementations are not public module contracts.', 'Replace the re-export with a test-local import.'),
    MODULE_TEST_STRUCTURE: define('Module tests must be direct lowercase *.test.ts files', 'test-contract', 'The central catalog discovers only the supported flat structure.', 'Move and rename tests directly under the module test directory.'),
    NODE_ERASABLE_TYPES_ONLY: define('Executable TypeScript must use erasable syntax', 'typescript', 'Node executes these TypeScript files without a transform step.', 'Replace enums, namespaces, parameter properties, import-equals, or export-assignment.'),
    NODE_REQUEST_DISCRIMINATION: define('Node requests require complete discriminated union members', 'module-boundary', 'Each operation literal pairs with its own payload and context.', 'Define a union of complete request objects discriminated by operation.'),
    OBJECT_VALIDATION_BEFORE_PERSIST: define('Domain Objects must be validated before persistence', 'persistence', 'Stores persist constructed Domain Objects with established invariants.', 'Construct or validate the Domain Object before the Store mutation.'),
    OPENAPI_PARSE_ERROR: define('The OpenAPI contract could not be parsed', 'http-contract', 'HTTP coverage requires a valid OpenAPI document.', 'Repair the reported OpenAPI syntax or schema error.'),
    OPERATION_BASE_CLASS: define('Operations require the typed BaseServiceOperation contract', 'service-operation', 'Its generics bind input, output, and owner dependencies.', 'Extend BaseServiceOperation<Input, Output, OwnerServiceDependencies>.'),
    OPERATION_CLASS_NAME: define('The Operation class name must match its file', 'service-operation', 'Generated routing derives the class from its filename.', 'Rename the class to <PascalCase>Operation.'),
    OPERATION_EXECUTE_CONTRACT: define('A concrete Operation exposes one typed execute method', 'service-operation', 'execute(input) is the single public use-case boundary.', 'Expose exactly one typed public execute(input) and keep helpers private.'),
    OPERATION_FILE_NAME: define('Operation files require kebab-case .operation.ts names', 'service-operation', 'The filename binds the Operation to generated routing.', 'Rename it to <kebab-case>.operation.ts under its Service owner.'),
    OPERATION_GENERIC_UPSERT: define('Operations must not call generic upsert methods', 'service-operation', 'Generic upserts can overwrite immutable tenant or actor scope.', 'Use a purpose-specific Store mutation with explicit immutable scope.'),
    OPERATION_GLOBAL_STORE_READ: define('Operations must not perform global Store reads', 'service-operation', 'Reads require tenant, actor, order, limit, and offset scope.', 'Replace findAll() with a domain-named fully scoped Store query.'),
    OPERATION_INPUT_CONTRACT: define('Operation input must be one named contract or void', 'service-operation', 'A named input binds all fields to one use case.', 'Replace primitive or loose parameters with one module contract or void.'),
    OPERATION_IN_MEMORY_QUERY: define('Operations must not query persisted data in memory', 'service-operation', 'Filtering, ordering, counts, limit, and offset belong in SQL.', 'Move the complete query into a typed Store method.'),
    OPERATION_PEER_IMPORT: define('Operations must not import peer Operations', 'service-operation', 'Each Operation is an independently owned use case.', 'Extract a lower-level contract or call another module through its port.'),
    OPERATION_PUBLIC_METHOD: define('execute is the only public Operation method', 'service-operation', 'Private helpers support one public use-case boundary.', 'Make every implementation helper private.'),
    OPERATION_ROUTING_MISSING: define('The generated Service does not route to this Operation', 'service-operation', 'Every Operation is reachable through one generated Service method.', 'Run npm run module:sync -- {{module}}.'),
    PACKAGE_MANIFEST_PARSE_ERROR: define('A workspace package manifest could not be parsed', 'workspace', 'Dependencies cannot be checked against invalid package.json.', 'Repair the reported package.json syntax or object shape.'),
    RAW_ERROR_RESPONSE: define('Raw exception messages must not become client responses', 'transport-contract', 'Exception text can expose implementation and infrastructure details.', 'Return a controlled error DTO and keep internal details server-side.'),
    ROOT_COMPILER_CONFIG_CONTRACT: define('Compiler configuration must remain root-owned', 'workspace', 'All workspaces inherit one TypeScript runtime contract.', 'Restore root inheritance and remove conflicting local ownership.'),
    SECRET_FALLBACK: define('Secrets must not have source-code fallbacks', 'security', 'A secret is required validated input, never an embedded convenience.', 'Remove the fallback and require the environment variable in config.ts.'),
    SENSITIVE_OBJECT_SERIALIZATION: define('Sensitive fields require explicit serialization exclusion', 'security', 'Persistent objects declare which fields never leave the domain.', 'Exclude every reported field and map only approved DTO fields.'),
    SERVICE_AUX_FORBIDDEN: define('Service auxiliaries are obsolete', 'service-operation', 'Application workflows require an explicit typed Operation owner.', 'Run npm run scaffold:operation -- {{module}} {{owner}} <operation> --input <type|void> --output <type|void>, implement execute(), run npm run module:sync -- {{module}}, and remove the auxiliary.'),
    SERVICE_OPERATION_MISSING: define('Service behavior has no owner-bound Operation', 'service-operation', 'Every public Service method delegates to one Operation.', 'Create the Operation and regenerate the Service.'),
    SERVICE_ROUTER_BUSINESS_LOGIC: define('Generated Service routers must not contain business logic', 'service-operation', 'Routers only construct Operations and call execute().', 'Move validation, branches, mapping, and Store access into the Operation.'),
    SERVICE_ROUTER_DRIFT: define('The generated Service router is stale', 'service-operation', 'Routing must exactly match owner-bound Operations.', 'Run npm run module:sync -- {{module}}; do not hand-edit the Service.'),
    SERVICE_ROUTER_REQUIRED: define('Operation-owned Services must extend BaseService', 'service-operation', 'The generated base establishes dependency and routing semantics.', 'Regenerate the Service with npm run module:sync -- {{module}}.'),
    SOURCE_PARSE_ERROR: define('A backend source file could not be parsed', 'tooling-failure', 'Architecture evidence requires syntactically valid TypeScript.', 'Repair the reported syntax error and rerun the linter.'),
    STORE_ACTIVE_READ_FILTER: define('Normal Store reads must exclude soft-deleted rows', 'persistence', 'Soft-deleted records are not active domain state.', 'Add the typed is_deleted filter to the database query.'),
    STORE_ANY_TYPE: define('Store contracts and mappings must not use any', 'persistence', 'Persistence inputs, rows, and mappings require complete types.', 'Use the concrete database row, Store input, or Domain Object type.'),
    STORE_GENERIC_METHOD: define('Store methods must be domain-named and fully scoped', 'persistence', 'Generic CRUD names hide scope, consistency, and intent.', 'Rename and narrow the method around one scoped domain operation.'),
    STORE_OBJECT_METADATA_MAPPING: define('Row-to-Object mappings must include lifecycle metadata', 'persistence', 'Identity, timestamps, and soft-delete state are persistent state.', 'Map every required metadata field explicitly.'),
    STORE_QUERY_OBJECT_MAPPING: define('Store queries must map rows to Domain Objects', 'persistence', 'Database rows and Domain Objects are separate representations.', 'Construct the declared Domain Object instead of returning raw rows.'),
    STORE_SOFT_DELETE_CONTRACT: define('Store deletion must be a soft-delete update', 'persistence', 'Durable records retain history while active reads exclude them.', 'Update is_deleted, deleted_at, and updated_at instead of hard deleting.'),
    STORE_TEST_EXECUTABLE_COVERAGE: define('Concrete Stores require executable module tests', 'test-contract', 'Persistence behavior and mapping require direct evidence.', 'Add a direct Store behavior test in the module test directory.'),
    TEST_CATALOG_DRIFT: define('The backend test catalog is stale', 'test-contract', 'The checked-in catalog must match all discovered tests.', 'Run npm run generate:test-catalog and commit the update.'),
    TEST_PERMISSIVE_ASSERTION: define('Tests must not accept multiple business outcomes', 'test-contract', 'Alternatives and ranges hide nondeterministic behavior.', 'Split outcomes into scenarios with one exact assertion each.'),
    TEST_TYPE_ESCAPE: define('Tests must not bypass contracts with unsafe types', 'typescript', 'Tests are contract evidence and require production type safety.', 'Use concrete fixtures and @ts-expect-error only for negative type tests.', 'npm run test --workspace @app/backend'),
    TOOLCHAIN_DEPENDENCY_OWNERSHIP: define('Shared compiler dependencies belong at repository root', 'workspace', 'The root pins the TypeScript toolchain for every workspace.', 'Remove the duplicate workspace toolchain dependency.'),
    UNDECLARED_WORKSPACE_DEPENDENCY: define('A runtime import is missing from the workspace manifest', 'workspace', 'Each workspace declares every external runtime package it imports.', 'Add the package to the owning workspace dependencies.'),
    WORKSPACE_LOCKFILE_OWNERSHIP: define('The root owns the only package-lock.json', 'workspace', 'One lockfile defines one reproducible workspace graph.', 'Remove the nested lockfile and regenerate only the root lockfile.'),
    WORKSPACE_VERIFY_OWNERSHIP: define('The complete verify pipeline belongs at repository root', 'workspace', 'Workspaces provide focused scripts while root owns the project gate.', 'Remove the conflicting workspace verify and use npm run verify.', 'npm run verify'),
} as const satisfies Record<string, Definition>;

export type BackendRuleId = keyof typeof RULES;

/** Owns complete self-contained teaching material for backend rules. */
export class RuleCatalog extends DiagnosticCatalog<BackendRuleId, ConceptId> {
    public constructor() {
        super(CONCEPTS, RULES);
    }
}
