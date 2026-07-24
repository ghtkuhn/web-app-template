# General rules

* You must treat instruction wording priority as `must not` > `must` > `should` > `may`.
* You must not modify the contents of this file.
* You must create `data/ai/MEMORY.md` if it does not exist.
* You must read the file contents of `data/ai/MEMORY.md` after ensuring it exists.
* You must summarize `data/ai/MEMORY.md` when it exceeds 25 KiB; `npm run check:memory` and `npm run verify` enforce this limit.
* You must communicate tersely. Do not repeat the task or narrate routine steps.
* You must keep progress updates to at most one short sentence.
* Your final response must contain only the result, verification status, and genuine blockers.


---


# Project structure

* `project.json`: Important project details and credentials.
* `code/backend`: Contains backend source code.
* `code/frontend`: Contains frontend source code.
* `data/sqlite`: Sqlite database storage location.
* `data/ai/kanban/todo`: Contains backlog and ready work tasks.
* `data/ai/kanban/done`: Contains implemented, verified, and closed work tasks.


---


# Kanban Rules

* You must not change or delete the file `data/ai/kanban/TASK-TEMPLATE.md`.
* You must copy the contents of the task template file `data/ai/kanban/TASK-TEMPLATE.md` and use that as a template for new tasks.
* You must break down complex tasks into multiple simple tasks that are easily verifyable. Simple meaning when it has one clear outcome, changes one feature area, and can be verified with one focused check. Complex when it mixes multiple outcomes, touches frontend and backend together, changes database schema plus UI, or requires more than one independent verification.
* You should split a task when it would require editing more than one module, adding both infrastructure and feature behavior, or changing both data shape and user-facing behavior.
* You should split a task when its "Done When" section needs more than three unrelated bullet points.
* You should split a task when failure would make it hard to know which part caused the problem.
* You must not use vague task goals such as "improve backend", "build UI", or "fix app".
* You must write each task so that another agent can complete it without asking what the task means.
* You must not write more than one task per task file.
* You must increment the value of the task counter file with each new task: `data/ai/kanban/TASK-COUNTER.md`.
* Task file names must be in the following format: `<task-counter>-<domain>-<title>.md`
* You must work tasks sequentially.
* You must use `fallow` to verify code health, dead code, and duplication before declaring a task done.
* You must move the task file to `data/ai/kanban/done` after verify.
* You must commit in git after every completed task, if the project is a git repo.


---


# Memory and learning

* You must record memory in the file `data/ai/MEMORY.md` after every completed kanban task.
* You should store only durable project facts, constraints, operations, recurring causes, and learnings with a `YYYY-MM-DD HH:MM` timestamp.


---


# Programming Rules

* You must not write code without a corresponding kanban task file.
* You must stop at the first applicable implementation rung, before writing code:
    1. Does this need to exist? If no, skip it (YAGNI).
    2. If the standard library does it, use the standard library.
    3. If the native platform or framework does it, use that feature.
    4. If an installed dependency does it, use the installed dependency.
    5. Only write the minimum code that works.
* You must not solve issues or implement features with ad hoc heuristics or keyword lists. Prefer real contracts, structured data, parsers, schemas, native platform/framework features, installed dependencies, embeddings, or model-backed validation.
* You must not build island solutions or implementations tailored to one specific test case, fixture, or issue.
* You must derive solutions generically; tests may cover examples, but implementation logic must not special-case them.
* You must not install new dependencies without user consent.
* You must not create, edit, move, rename, or delete files or directories below `code/backend/src/base/`.
* When using Little Coder, you must start it with `npm run little-coder -- [arguments]` so the project mutation guards are loaded.
* Little Coder backend changes must remain within the active lint-gate batch or repair scope.
* You must not bypass a red backend lint gate, weaken its rules, or modify protected architecture controls to make it green.
* You must run backend work in small lintable batches; the gate enforces a layer/module check and a maximum of five successful file mutations.
* Little Coder must repair only the first active backend lint cause and run the focused check before another backend mutation.
* Little Coder must stop and report the blocker after two ineffective repairs of the same cause.
* You must not silence a finding with type casts, widened contracts, permissive assertions, placeholder values, or unrelated refactors.
* You must not invoke `rm`, `rmdir`, `unlink`, or another direct system deletion command.
* You must delete project files and directories only with `npm run rm -- <project-relative-path>`.
* You should run `npm run rm -- <project-relative-path> --dry-run` first when the target contains multiple files or directories.
* Before declaring a task done, run `npx fallow audit --format json` in the project root.
  - Exit codes 0 and 1 mean success (1 = findings found). Only exit code 2 is an actual error.
  - If new findings are introduced by your changes, address them before completing the task.
  - Pre-existing inherited findings do not block the change (`fallow audit` excludes them by default).
  - Use `npm run audit` during normal work. Its console output is bounded for agent context; inspect the complete ignored report at `.fallow/audit.json` only when details are required.
* Run `npx fallow recommend --format json` on first use to detect the stack and propose `.fallowrc.json`. Save it if appropriate.


## Root npm Scripts

* `npm run audit`: Runs the bounded Fallow code-health audit and stores its full ignored report under `.fallow/`.
* `npm run build`: Builds every workspace that defines a build command.
* `npm run check:api`: Verifies that generated frontend OpenAPI types match the backend contract.
* `npm run check:memory`: Rejects a missing or oversized `data/ai/MEMORY.md`.
* `npm run deployment:build`: Builds deployable backend and frontend artifacts for a deployment profile.
* `npm run deployment:database:list`: Lists SQLite migration backups for a deployment profile.
* `npm run deployment:database:restore`: Restores one explicitly selected SQLite backup.
* `npm run deployment:deploy`: Deploys selected components using a validated deployment profile.
* `npm run deployment:rollback`: Reactivates a previous application release without automatically restoring its database.
* `npm run deployment:scaffold`: Creates a new versioned deployment profile.
* `npm run deployment:status`: Reads deployment and health status for selected components.
* `npm run deployment:stop`: Stops selected deployed services without deleting persistent infrastructure.
* `npm run deployment:validate`: Validates one or all deployment profiles against the schema.
* `npm run generate:api`: Regenerates checked-in frontend TypeScript contracts from OpenAPI.
* `npm run lint`: Runs every workspace linter.
* `npm run lint:backend`: Runs the backend architecture and OpenAPI linters.
* `npm run little-coder`: Starts Little Coder with Base protection and the incremental backend architecture lint gate.
* `npm run rm`: Safely removes explicit project-relative files, directories, or symlinks; pass targets after `--` and use `--dry-run` for preview.
* `npm run scaffold:component`: Creates one presentation-local Vue component.
* `npm run scaffold:feature`: Creates a frontend Model, Service, and Composable feature skeleton.
* `npm run scaffold:file`: Creates one architecture-compliant class file in an existing backend module.
* `npm run scaffold:module`: Creates, registers, and activates a minimal backend module.
* `npm run scaffold:route`: Creates and registers one route adapter plus Desktop, Tablet, and Mobile views.
* `npm run template:check`: Reports the installed and latest stable template versions and pending updater state.
* `npm run template:init`: Initializes explicit template metadata for a legacy application.
* `npm run template:update`: Installs or continues a stable template update and supports conflict continuation or abort.
* `npm run test`: Runs all workspace unit, integration, and component tests.
* `npm run typecheck`: Typechecks root tooling and all workspaces.
* `npm run verify`: Runs the complete required validation, lint, typecheck, test, build, browser-smoke, and Fallow pipeline.


## Backend Programming Rules (Strict Layered Architecture)

* Domain modules live in `code/backend/src/module/<name>/`.
* Backend modules must use the singular `module` directory. The plural path `code/backend/src/modules/` is forbidden.
* A module may contain the layers it actually needs: `api`, `controller`, `service`, `store`, `object`, and `dto`.
* The strict dependency flow is **API Handler** → **Controller** → **Service** → **Store** → **Database**.
* Interfaces, type aliases, and constants must be declared in the module-level `interfaces.ts`, `types.ts`, and `constants.ts` files.
* Public module contracts must be exported exclusively through `code/backend/src/module/<name>/index.ts`.
* Module roots may contain only `index.ts`, `interfaces.ts`, `types.ts`, `constants.ts`, and the supported layer directories. Loose implementation files, empty layers, unknown directories, and non-TypeScript artifacts are forbidden.
* Local TypeScript imports and re-exports must include the `.ts` extension.

### Layer Responsibilities and Constraints

1. **API Handlers (`api/`)**
   - Must extend `HttpHandler`, `WebSocketHandler`, `CliHandler`, `NodeHandler`, or another approved `BaseHandler` specialization.
   - Translate transport-specific input into controller calls.
   - Convert parsed payloads to declared request DTOs or validate them with a typed validator before calling a Controller or Service.
   - Must not import Services or Stores directly.
2. **Controllers (`controller/`)**
   - Must extend `BaseController`.
   - Coordinate application behavior through Services and return `HandlerResult<DTO>`.
   - Must remain transport-neutral and must not accept request/response objects or read transport bodies.
   - Must not expose raw exception messages or translate arbitrary exceptions into client errors.
   - Must not import Handlers, Stores, or Domain Objects.
   - Object/DTO mapping belongs in Services.
3. **Services (`service/`)**
   - Must extend `BaseService`.
   - Contain business logic, validation, workflows, and Object/DTO mapping.
   - May use Stores, Domain Objects, and DTOs.
   - Must not import Controllers or Handlers.
4. **Stores (`store/`)**
   - Must extend `BaseStore`.
   - Encapsulate persistence operations and map database data to Domain Objects.
   - Must not import DTOs, Services, Controllers, or Handlers.
   - May use the provided database abstraction but must not import database drivers or create connections.
   - Must use typed Store contracts without `any` and explicitly map database rows to Domain Objects.
5. **Objects (`object/`)**
   - Must extend `BaseObject`.
   - Represent persistent domain state and invariants.
   - Sensitive fields must be explicitly excluded from serialization.
6. **DTOs (`dto/`)**
   - Must extend `BaseDTO` or `EntityDTO`.
   - Define transported application data without depending on Handlers, Controllers, Services, Stores, or database drivers.
   - Must remain passive; executable schemas, validator instances, and business logic belong in Services or owner-bound Service Aux classes.

### Auxiliary Classes

* The `api`, `controller`, `service`, and `store` layers may contain one level of owner-bound auxiliary folders.
* `service/health/` requires `service/health.service.ts`; controller and store folders follow the same naming rule.
* `api/health/` requires at least one direct `api/health.*.handler.ts` owner.
* Every auxiliary file must contain exactly one class extending `BaseApiAux`, `BaseControllerAux`, `BaseServiceAux`, or `BaseStoreAux`.
* Only the matching owner may import its auxiliary classes.
* Auxiliary classes must not import their owner, auxiliary peers, or other files from the same layer.
* Auxiliary implementations must not be re-exported or accessed from another layer or module.
* Further nesting and non-TypeScript files in auxiliary folders are forbidden.

### Inter-Module Communication

* Modules must not import another module's internal files.
* Consumers may import only the public contract exported by `code/backend/src/module/<name>/index.ts`.
* Required module ports are supplied through constructor injection by `ModuleRegistry`.
* Each module owns its durable registry metadata in the static `definition` exposed by its public module class.
* The module class must directly own `name`, `dependencies`, and `create`; spreads and external metadata objects are forbidden.
* Every concrete Handler must be constructed and registered by the module factory or constructor before the factory returns.
* Modules must not expose post-construction infrastructure or Handler setters.
* Each module entry point must publicly re-export its typed module port and expose a typed `ModuleDefinition`; every module must be present in the generated catalog.
* Application infrastructure follows `Application → DatabaseManager → ModuleRegistry → Module Factory → Store`; it must not be modeled as a domain-module dependency.
* In-process communication uses the injected module port and typed `dispatch('node', request)` calls.
* Node requests use a discriminated `operation` field and a `NodeRequestContext` containing the required `caller` and optional `correlationId`.
* Multiple Node operations must be a union of complete request objects; an operation union paired with an independent payload union is forbidden.
* Public module ports use a typed `IBaseModule` or explicit Node `dispatch()` contract and must not extend `BaseModule`.
* Business response data uses DTOs; Node callers must not use `HandlerResult.statusCode` for business decisions.
* Missing active dependencies and direct or indirect dependency cycles must fail during registry construction.

### Composition and Infrastructure

* Active modules are configured in `code/backend/src/config.ts`.
* `code/backend/src/module.registry.ts`, `code/backend/src/index.ts`, and `code/backend/src/cli.ts` form the Composition layer.
* Composition files may import modules only through their public `index.ts`.
* The generated `module.catalog.ts` only aggregates module-owned definitions and must not declare dependencies or factories itself.
* Domain modules must not import Registry or process entry-point files.
* Domain modules must not read `process.env` or define secret fallbacks; validated runtime configuration is owned by `code/backend/src/config.ts`.
* Database drivers and connection creation are allowed only in `code/backend/src/base/base.database.ts`.
* Stores receive the shared database client through constructor injection, use the provided abstraction, and must not import `DatabaseManager` or create their own connections.
* `code/backend/src/database.ts` defines the complete current Kysely database schema used for compile-time typing.
* Every database schema change must update `code/backend/src/database.ts` and include a matching versioned migration.
* Migrations are the executable history of the physical database schema and must run before modules and transports start.
* Pending SQLite migrations must create and validate a persistent pre-migration backup before changing the database.
* Code rollback must never restore the database automatically; database restore is an explicit deployment operation that creates a pre-restore safety backup.
* Large data backfills must be implemented as idempotent, restartable jobs rather than blocking startup migrations.
* The application must not start when a pending migration fails.
* Database row types, Domain Objects, and DTOs must remain separate representations.
* Row-to-Object mappings must explicitly map identity, timestamps, and soft-delete metadata.
* Normal Store finders must exclude soft-deleted rows, and Store deletion must update `is_deleted`, `deleted_at`, and `updated_at` instead of using hard deletion.

### HTTP API Contracts

* `code/backend/openapi/openapi.yaml` is the central OpenAPI 3.1 contract for the public HTTP API.
* Every new or changed HTTP endpoint must update the OpenAPI document and include executable request tests for every documented success and controlled error status.
* Concrete HTTP handlers must declare literal `/api` routes that are covered by the matching OpenAPI method and backend tests.
* Comments and arbitrary route strings do not count as HTTP coverage; tests must execute `fetch()` or the standardized HTTP test helper.
* DTOs and OpenAPI schemas must describe the same public JSON representation without making database row types public.
* Node, CLI, and WebSocket contracts must not be documented as OpenAPI operations.
* OpenAPI linting and HTTP contract tests must pass through the root `npm run verify` command.

### General Backend Constraints

* You must create new domain modules with `npm run scaffold:module -- <kebab-case-name>` instead of assembling their base files manually.
* You must create new architecture class files in existing modules with `npm run scaffold:file -- <module> <type> <name> [--owner <owner>]` instead of assembling their boilerplate manually.
* Free function declarations are forbidden in regular module files.
* Regular module and auxiliary files must not declare more than one class; auxiliary files must declare exactly one.
* Architecture filenames and class names must follow their scaffolded layer conventions.
* Runtime packages imported by backend domain code must be declared in `code/backend/package.json` dependencies.
* Domain modules and backend tests must not use `any`, `as any`, or chained assertions to bypass contracts; negative type tests use `@ts-expect-error`.
* Executable backend and test TypeScript must use Node-compatible erasable syntax; parameter properties, enums, namespaces, import-equals, and export-assignment are forbidden.
* The repository root owns the only `package-lock.json`, shared TypeScript tooling, `tsconfig.base.json`, and the complete `verify` script. Workspaces must not duplicate or shorten these contracts.
* Module files must preserve four-space indentation and include appropriate code comments and JSDoc.
* `npm run verify` must pass before backend work is declared complete.


## Frontend Programming Rules (Strict Presentation Architecture)

* Vue source lives under `code/frontend/web/src/` in `app`, `core`, `presentation`, and `shared`.
* Desktop, tablet, and mobile presentations live in separate `presentation/<name>/` trees and must not import each other.
* Matching views and layouts must exist in all three presentation trees.
* The shared router belongs to `app/router.ts`; route adapters must compose exactly one view from each presentation.
* Mobile applies below `768px`, tablet from `768px` through `1199px`, and desktop from `1200px`.
* `app/presentation.ts` owns viewport breakpoints and device detection. A confident or explicit device result locks the presentation; otherwise it switches live with the viewport.
* Presentation code must not perform network access or import `core/api` directly. Shared application state, APIs, models, and workflows belong in `core`.
* Core follows **Presentation** → **Composable** → **Service** → **ApiClient** → **Backend**.
* `core/config` is the exclusive owner of `import.meta.env` access and exposes validated readonly configuration.
* `core/api/generated/schema.ts` is generated from the backend OpenAPI contract with `npm run generate:api` and must not be edited manually.
* Generated transport types remain inside Services and API infrastructure; Services map them to frontend Models.
* `ApiClient` is the only HTTP transport owner. Presentation code uses Composables and must not call generated clients or `fetch`.
* Composables use the common `idle`, `loading`, `success`, and `error` state model for asynchronous workflows.
* State that must survive a presentation switch must live outside presentation components.
* `shared` contains non-visual assets, styles, and utilities but no shared Vue components.
* Shared design tokens live in `shared/styles`; presentation colors, font sizes, radii, and z-index values must use those tokens.
* Vue scripts must use `<script setup lang="ts">`; presentation styles must be scoped.
* Width-based media queries must not create a second presentation breakpoint system.
* Frontend TypeScript and Vue code must preserve four-space indentation.
* Create routes with `npm run scaffold:route -- <kebab-case-name>` so the adapter, router entry, and all three views are created together.
* Create presentation-local components with `npm run scaffold:component -- <desktop|tablet|mobile> <kebab-case-name>`.
* Create Core feature skeletons with `npm run scaffold:feature -- <kebab-case-name>`.
* The frontend implementation workflow is **Scaffold** → **Core logic** → **all three Presentations** → **tests** → **`npm run verify`**.
* Vitest and Vue Test Utils cover units and components; Playwright covers shared routing and representative mobile, tablet, and desktop browser flows.
* `npm run lint --workspace @app/web` and the root `npm run verify` must pass before frontend work is complete.


## Deployment Rules

* Deployment profiles live in `deployment/profiles/`, contain no secrets, and must pass `npm run deployment:validate -- <profile>`.
* `local` is the default profile. Docker is the default driver for both components in every newly scaffolded profile.
* Create profiles with `npm run deployment:scaffold -- <name>`; select `proxmox-lxc` explicitly per component when required.
* Backend and frontend are independently buildable and deployable with the `backend`, `frontend`, or `all` component argument.
* Docker deployments use separate backend and frontend images. SQLite data must remain in a persistent external volume.
* Proxmox LXC provisioning and lifecycle use the REST API. Release installation uses SSH directly to the LXC and must never require SSH access to the Proxmox host.
* Proxmox API tokens, private SSH keys, application secrets, and passwords must be supplied through Environment variables and must not appear in profiles or logs.
* Production profiles require verified TLS, explicit Origin allowlists, an absolute persistent SQLite path, and non-development secrets.
* Frontend deployment configuration is public runtime configuration and must never contain secrets.
* Deployments follow **validate → build → deploy → health check**. Failed LXC activation must roll back to the previous release.


## Template Update Rules

* Check stable upstream releases with `npm run template:check`.
* `.template/version.json` is the only installed-template version source; `package.json.version` always belongs to the application.
* Initialize legacy applications without metadata exactly once with `npm run template:init -- <installed-version>`.
* Update only from a clean Git worktree with `npm run template:update` or an explicit stable version.
* Resolve updater conflicts only under `.template/conflicts/<version>/`, select `local`, `incoming`, `merged`, or `delete` in `resolutions.json`, and continue with `npm run template:update -- --continue <version>`.
* Abort unresolved staging with `npm run template:update -- --abort <version>`; this must not change project files.
* Template updates must preserve local modules, features, migrations, secrets, runtime data, local deployment profiles, Memory, and Kanban task contents.
* Application-owned package metadata must remain local. Template scripts, engines, workspaces, and dependencies are merged property by property.
* A failed post-update Verify does not roll back the installed template. Inspect `.template/status.json` and its referenced log, migrate the application, and run `npm run verify` again.
* After an update, inspect the uncommitted diff and verification status before creating a deliberate commit.
* Template updates must not commit, push, deploy, restore databases, or mutate external infrastructure automatically.
