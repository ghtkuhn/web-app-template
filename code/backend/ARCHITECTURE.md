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
- implement and export a `<Name>ModulePort`;
- expose a static `definition` satisfying `NamedModuleDefinition`;
- compose its private Handler → Controller → Service → Store chain;
- remain free of business logic.

The generated `module.catalog.ts` imports modules only through their public
`index.ts` files. Other modules must also import only from those public entry
points. Direct cross-module imports into internal layers are forbidden.

Use:

```bash
npm run scaffold:module -- <kebab-case-name>
```

to create and register a new module.

## Layer Contracts

### API Handlers

Handlers live in `api/` and extend the matching `HttpHandler`,
`WebSocketHandler`, `CliHandler`, or `NodeHandler`.

They:

- parse and validate transport-specific input;
- convert that input into DTOs or typed requests;
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
Domain Object fields.

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

## HTTP and OpenAPI

The public HTTP contract lives at `openapi/openapi.yaml`. Every concrete HTTP
handler requires a matching path, method, DTO-compatible schema, and backend
test coverage. Node, CLI, and WebSocket operations are not OpenAPI operations.

## Verification

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
