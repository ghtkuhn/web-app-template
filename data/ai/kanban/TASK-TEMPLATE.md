# Task: <Title>

**Task ID:** <counter>
**Domain:** <frontend | backend | infra | data | ...>
**Created:** YYYY-MM-DD
**Status:** todo
**Dependencies:** <task IDs or none>

## Goal

<One sentence describing the concrete outcome and why it is needed.>

## Context

<Relevant architecture constraints, existing behavior, dependencies, and affected modules. Remove this section if unnecessary.>

## Scope

### In Scope

- <Required change>
- <Required change>

### Out of Scope

- <Explicitly excluded behavior or area>

## Contract and Schema Impact

- [ ] Update the OpenAPI contract when the task adds or changes a public HTTP endpoint; otherwise mark this item as not applicable.
- [ ] Update the typed database schema and add a matching migration when the task changes persistence; otherwise mark this item as not applicable.
- [ ] Verify migration backup, restore compatibility, and backfill strategy when persistence changes; otherwise mark this item as not applicable.
- [ ] Update affected deployment profiles and runtime configuration when the task changes ports, public URLs, secrets, storage, transports, or health checks; otherwise mark this item as not applicable.

## Done When

- [ ] <Concrete and independently verifiable criterion>
- [ ] <Concrete and independently verifiable criterion>
- [ ] <Concrete and independently verifiable criterion>

## Verification

For an intermediate task in an active implementation sequence, update OpenAPI
and the database schema when required, then run focused linting, typechecking,
and only tests created or changed by this task. Do not rerun pre-existing test
suites.

After completing the final open task in that sequence, run the complete
verification from the project root:

```bash
npm run verify
```

This command includes:

- Workspace linting and the backend architecture linter
- TypeScript typechecks
- Automated tests
- Fallow code-health audit

Expected result for the final task:

- `npm run verify` exits with code `0`.
- The complete existing test suite passes.
- The backend architecture linter reports no violations.
- Fallow completes without an execution error.
- New Fallow findings introduced by this task are resolved.
- Existing inherited findings do not block completion.

## Completion Notes

<Complete this section before moving the task to `done`.>

**Implemented:**

- <Concise summary of the completed changes>

**Verification result:**

- `<command>`: <result>
- Fallow new findings: <none or description>

**Memory:**

- [ ] Durable project facts and learnings were recorded in `data/ai/MEMORY.md` with a `YYYY-MM-DD HH:MM` timestamp.
- [ ] No task-specific or already documented AGENTS.md instructions were duplicated in memory.

**Commit:**

- `<commit hash>`
