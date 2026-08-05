# Backend Architecture

This backend uses strict, linter-enforced layers. The architecture is designed
to keep transport handling, application workflows, business logic, persistence,
and public contracts independently testable.

## Source Layout

```text
code/backend/src/
    base/                   Shared infrastructure and base classes
    migration/              Ordered database migrations
    module/
        <name>/
            index.ts        Public module gateway and definition
            interfaces.ts   Interfaces and public module port
            types.ts        Type aliases and Node request unions
            constants.ts    Passive constants
            api/            Transport handlers
            controller/     Transport-neutral use-case coordination
            service/        Business logic and DTO/Object mapping
            store/          Persistence and row/Object mapping
            object/         Persistent Domain Objects
            dto/            Transported application data
            test/           Direct module-local Node tests
    cli.ts                  CLI composition entry point
    config.ts               Validated environment configuration
    database.ts             Current typed database schema
    index.ts                Backend application entry point
    module.catalog.ts       Generated module-definition catalog
    module.registry.ts      Dependency and infrastructure composition
```

Only the following directories are allowed directly inside a module:

- `api`
- `controller`
- `dto`
- `object`
- `service`
- `store`
- `test`

Module contracts and metadata are files, not directories. They must be named
`index.ts`, `interfaces.ts`, `types.ts`, and `constants.ts` and live directly
inside the module root.

## Dependency Direction

The allowed application flow is:

```text
API Handler → Controller → Service → Store → Database
                              ↓
                      Domain Object / DTO
```

Dependencies must not point back toward a higher layer:

- Handlers call Controllers, never Services or Stores.
- Controllers call Services and use DTOs.
- Services may use Stores, Domain Objects, and DTOs.
- Stores may use Domain Objects and the injected database abstraction.
- DTOs and Domain Objects must not depend on higher application layers.

## Module Entry Point

Every module requires `module/<name>/index.ts`. It must:

- export a `<Name>Module` extending `BaseModule`;
- implement a `<Name>ModulePort` declared in `interfaces.ts`;
- publicly re-export that port from `index.ts`;
- expose a static `definition` satisfying `NamedModuleDefinition`;
- compose its private Handler → Controller → Service → Store chain;
- remain free of business logic.

The port interface stays in the module-level `interfaces.ts` file:

```ts
export interface ExampleModulePort {
    dispatch(
        type: 'node',
        input: ExampleNodeRequest,
    ): Promise<HandlerResult<ExampleResponseDTO>>;
}
```

The module class may import that interface so it can implement the contract:

```ts
import type { ExampleModulePort } from './interfaces.ts';
```

That import is private to `index.ts`; it does not make the port available to
consumers. The same `index.ts` must therefore also contain this separate,
top-level public re-export:

```ts
export type { ExampleModulePort } from './interfaces.ts';
```

Do not move or redeclare the interface in `index.ts`. Other modules import the
port only through the public module entry:

```ts
import type { ExampleModulePort } from '../example/index.ts';
```

The generated `module.catalog.ts` imports modules only through their public
`index.ts` files. Other modules must also import only from those public entry
points. Direct cross-module imports into internal layers are forbidden.

Use:

```bash
npm run scaffold:module -- <kebab-case-name>
```

to create and register a new module.

## Tests

Executable modules own direct tests under
`src/module/<name>/test/*.test.ts`. A module becomes executable when it owns a
concrete Handler, Controller, Service, or Store. Contract-only, DTO-only, and
Object-only modules do not require a test directory.

Module tests may import their own private implementation, Base infrastructure,
Node built-ins, and declared dependencies. They must import another module only
through that module's public `index.ts`. Production files must never import or
re-export tests. Test directories must be non-empty, contain only direct
`*.test.ts` files, and have no nested directories.

Use:

```bash
npm run scaffold:test -- <existing-module>
```

to create the baseline public module-definition test. Additional module tests
may be added manually. Then run `npm run generate:test-catalog` and commit the
updated `code/backend/test.catalog.ts`.

Global Base, Composition, Registry, scaffold, OpenAPI, and transport-integration
tests remain under `code/backend/test/`. `npm test` first checks catalog drift
and then the central runner executes exactly the cataloged files. Never bypass
the catalog with a competing test command.

## Layer Contracts

### API Handlers

Handlers live in `api/` and extend the matching `HttpHandler`,
`WebSocketHandler`, `CliHandler`, or `NodeHandler`.

They:

- parse and validate transport-specific input;
- convert `request.json()` data into declared request DTOs or pass it through
  a typed validator before calling application code;
- call exactly the module Controller boundary;
- return a typed `HandlerResult<DTO>`.

HTTP route literals must begin with `/api` and must be represented in the
OpenAPI contract.

### Controllers

Controllers live in `controller/` and extend `BaseController`.

They:

- accept DTOs or other transport-neutral application inputs;
- coordinate Services;
- return `HandlerResult<DTO>`;
- do not receive HTTP request/response objects;
- do not expose raw exception messages;
- do not translate every exception into a client error.

### Services

Services live in `service/` and extend `BaseService`.

They own:

- business validation and workflows;
- Domain Object construction and validation;
- Object-to-DTO and DTO-to-Object mapping;
- orchestration of typed Store operations.

Services must not bypass layer contracts with casts such as `as unknown as`.

### Stores

Stores live in `store/` and extend `BaseStore`.

They:

- receive the application-owned Kysely client through constructor injection;
- implement typed persistence contracts without `any`;
- explicitly map database rows to Domain Objects;
- implement complete save semantics rather than update-only aliases;
- never create database connections or import database drivers.

### Domain Objects

Domain Objects live in `object/` and extend `BaseObject`. They represent
persistent state, identity, timestamps, soft deletion, and domain invariants.

Objects containing passwords, hashes, secrets, or tokens must explicitly
exclude those fields from serialization.

### DTOs

DTOs live in `dto/` and extend `BaseDTO` or `EntityDTO`. They define public or
inter-layer transported data and must not expose database rows or sensitive
Domain Object fields. DTOs remain passive: validator instances, executable
schemas, and business rules belong in Services or owner-bound Service Aux
classes.

## Auxiliary Classes

The `api`, `controller`, `service`, and `store` layers may have one owner-bound
auxiliary directory:

```text
service/
    health.service.ts
    health/
        status.service-aux.ts
```

An auxiliary class extends the matching `BaseApiAux`, `BaseControllerAux`,
`BaseServiceAux`, or `BaseStoreAux`. Only its owner may import it. Auxiliaries
must not import their owner, another auxiliary, or another file from the same
layer, and they must never be re-exported.

Use:

```bash
npm run scaffold:file -- <module> <type> <name> [--owner <owner>]
```

to create layer and auxiliary files.

## In-Process Module Communication

Modules communicate through injected public ports:

```text
Consumer Module
    → injected ModulePort
    → dispatch("node", typed request)
    → NodeHandler
    → Controller
    → Service
```

Node requests use a discriminated `operation` and a `NodeRequestContext` with a
required `caller` and optional `correlationId`. Module dependencies are declared
in the module's static definition and resolved by `ModuleRegistry`. Missing
active dependencies and dependency cycles fail during registry construction.

Every operation is one complete union member:

```ts
type ExampleNodeRequest =
    | { operation: 'create'; context: NodeRequestContext; input: CreateDTO }
    | { operation: 'read'; context: NodeRequestContext; id: string };
```

Do not combine an operation union with an unrelated payload union. Public ports
use `IBaseModule<Input, Output>` or an explicit typed Node `dispatch()` contract;
they never extend the concrete `BaseModule` class.

The public module class directly owns `public static readonly definition` with
`name`, `dependencies`, and `create`. The factory and constructor must construct
and register every concrete Handler before returning. Modules expose no
post-construction setters for infrastructure or handlers, and the definition
must not be assembled in `constants.ts`.

## Configuration and Secrets

Only `src/config.ts` may read `process.env`. Domain modules receive validated
values through composition and must not define secret fallbacks or read the
environment directly. Runtime dependencies imported by backend code must be
declared in `code/backend/package.json`.

## Database and Migrations

`src/database.ts` is the complete current Kysely schema. Every persistent Domain
Object table includes its identity, timestamp, and soft-delete metadata.

Every schema change requires both:

1. an update to `src/database.ts`; and
2. one ordered migration under `src/migration/`.

Stores use the injected database client. Driver imports and connection creation
belong exclusively to `src/base/base.database.ts`.

Every row-to-Object mapping explicitly maps `id`, `created_at`, `updated_at`,
`is_deleted`, and `deleted_at`. Normal finders exclude soft-deleted rows.
`delete()` updates `is_deleted`, `deleted_at`, and `updated_at`; it never performs
a hard `deleteFrom()` for Domain Object tables.

## HTTP and OpenAPI

The public HTTP contract lives at `openapi/openapi.yaml`. Every concrete HTTP
handler requires a matching path, method, DTO-compatible schema, and backend
test coverage. Coverage means an executable `fetch()` (or the standardized HTTP
test helper) with the same method and route plus assertions for every documented
success and controlled error status. Comments and string references do not
count. Store coverage likewise constructs the Store and executes a persistence
method. Node, CLI, and WebSocket operations are not OpenAPI operations.

Request JSON is untrusted at runtime. A TypeScript assertion does not validate
it:

```ts
// Incorrect: this only changes the compiler's view.
const requestDTO = await request.json() as CreateRequestDTO;

// Correct: construct a concrete DTO or call a typed validator returning it.
const requestDTO = new CreateRequestDTO(await request.json());
```

Handler success contracts name concrete Response DTOs. Do not widen them to
`BaseDTO`, `object`, anonymous payloads, or ad hoc unions.

HTTP tests create one deterministic scenario per documented result and assert
one exact status:

```ts
// Incorrect: several incompatible outcomes are accepted.
assert.ok(response.status === 200 || response.status === 500);

// Correct: this scenario has one documented result.
assert.equal(response.status, 200);
```

An asserted `500` must be explicitly documented by the matching OpenAPI
operation. Unexpected server errors never count as acceptable business output.

## TypeScript and Workspace Ownership

Domain modules and backend tests must not use `any`, `as any`, or chained type
assertions to bypass contracts. Compile-time negative tests use
`@ts-expect-error`. Executable backend TypeScript uses Node-compatible erasable
syntax only: parameter properties, enums, namespaces, import-equals, and
export-assignment are forbidden.

The repository root owns the only `package-lock.json`, shared TypeScript
tooling, `tsconfig.base.json`, and the complete `npm run verify` pipeline.
Workspace packages must not add nested lockfiles, duplicate TypeScript, or
define a shortened `verify` script.

## Verification

Architecture diagnostics are read-only and separate the problem from its
remediation:

```text
ERROR [RULE_ID] path/file.ts:line:column
Reason: Why the current source violates the architecture.
Fix: The concrete architecture-preserving repair.
```

Positions are one-based and identify the relevant AST evidence when the finding
originates in TypeScript. Filesystem-only findings use `1:1`. Machine consumers
run `node code/backend/script/linter.ts --format json` and validate
`schemaVersion: 1`; they must not parse the human output or write diagnostic
comments into source files.

Run the complete repository verification before declaring backend work done:

```bash
npm run verify
```

For a focused architecture check:

```bash
npm run lint:architecture --workspace @app/backend
```

Architecture findings include stable rule IDs. Fix the reported structure or
dependency violation instead of suppressing or working around the rule.
Little Coder works on only the first active cause. It runs a focused TypeScript
or test check before the next mutation and then reruns the architecture linter.
If the same cause remains after two attempts, it stops for an external review.
