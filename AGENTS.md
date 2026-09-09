# General rules

* You must treat instruction wording priority as `must not` > `must` > `should` > `may`.
* You must not follow any of the rules in this file, if you are the maintainer of the web-app-template or if the user explicitly allows you to do something that would violate a rule in this file.
* You must create file `AGENTS-PROJECT.md` if it does not exist.
* You must create file `data/ai/MEMORY.md` if it does not exist.
* You must follow the rules written in this file, if you are developing an application.
* You must read the file contents of `AGENTS-PROJECT.md`.
* You must accept that rules written in `AGENTS-PROJECT.md` always take priority over any rule written in this file.
* You must not modify the contents of this file.
* You must communicate tersely. Do not repeat the task or narrate routine steps.


---


# Project structure

* `project.json`: Contains project details and AI agent settings (for you).
* `code/backend`: Contains backend source code.
* `code/frontend`: Contains frontend source code.
* `data/sqlite`: Sqlite database storage location.
* `data/ai/kanban/todo`: Contains local backlog and ready work tasks; Markdown files remain untracked.
* `data/ai/kanban/done`: Contains local implemented, verified, and closed work tasks; Markdown files remain untracked.
* `.credentials.env`: The only supported local credential file; it must remain ignored, untracked, and mode `0600`.


---


# Credential Rules

* You must put local credentials only in `/.credentials.env` and initialize it with `npm run credentials:init`.
* You must not store credential values in `project.json`, `data/ai/MEMORY.md` or Kanban tasks.
* You must run scripts that need local credentials through `npm run credentials:run -- <npm-script> [args]`.
* You must never read, print, log, interpolate, or forward the contents of `/.credentials.env` except through `credentials:run`'s child-process Environment.
* You must run `npm run credentials:check` before staging or committing changes.


---


# Kanban Rules

* You must follow these kanban related rules only when `template-config.use-kanban` in `project.json` equals `true`.
* You must not change or delete the file `data/ai/kanban/TASK-TEMPLATE.md`.
* You must initialize missing workflow state with `npm run workflow:init`.
* You must create tasks with `npm run task:new -- <domain> <slug>`; the command reserves the next ID atomically from the task counter.
* You must not use vague task goals such as "improve backend", "build UI", or "fix app".
* You must not write more than one task per task file.
* Task file names must be in the following format: `<task-counter>-<domain>-<title>.md`
* You must work tasks sequentially.
* You must follow [Verification Rules](#verification-rules) throughout implementation, review, and task closure.
* Completion Notes must map every Done-When criterion to at least one concrete test name or verification command.
* Open tasks must contain concrete Goal, Scope, Done When, and Verification sections. Completion Notes may remain pending until closure; never invent completed results while planning.
* Use `[[TODO: description]]` for unfinished draft content. Replace planning markers before `check:kanban`, and completion markers before `task:close`. Ordinary HTML, TypeScript generics, and CLI argument examples are allowed.
* You must close a task with `npm run task:close -- <id>` after its required focused checks; close the final task only when the Verification Rules are satisfied by recorded results.
* You must run `npm run check:kanban` before completing an implementation sequence.
* You must commit in git after every completed task, if the project is a git repo.


---


# Testing Rules

* These rules apply whether or not Kanban is enabled, including general test instructions in existing tasks; explicit user requirements remain binding. There is no coverage quota or minimum test count.
* Before adding a test, identify the realistic failure it detects and its impact. Consider permissions, tenant isolation, data integrity, transactions, migrations, auth/network failures, updates, deployment, and rollback as risk examples, not mandatory test categories.
* Inspect existing protection first and extend existing tests where useful. Do not duplicate the same behavior across layers without additional failure-detection value.
* Choose the smallest test level that reliably detects the failure. Mocked unit tests alone do not establish integration behavior.
* Do not add tests merely for trivial delegation, getters, file existence, or properties already reliably checked by TypeScript or linters. A concrete runtime or delivery contract can justify testing such a property.
* Prefer a regression test for a bug fix that detects the original failure. If automation is not useful or feasible, explain a concrete alternative check.
* In the existing Verification section or handover, briefly identify the failure risk and chosen protection. “No new test” is valid with a reason and existing test or check evidence. Completion Notes do not require newly written tests.


---


# Verification Rules

* These rules apply whether or not Kanban is enabled. Apply them to general verification instructions in existing tasks without rewriting those tasks; explicit user requests for additional checks remain binding.
* During implementation, run focused tests and checks relevant to the change, including existing regression tests when affected.
* For a connected implementation series, run root `npm run verify` once after implementation and, where possible, code review are complete. It already includes the full test suite; do not run that suite separately as another completion gate. Documentation-only changes require only affected contract checks and `git diff --check`.
* Reuse recorded results across implementation, review, and release. Task boundaries, agent changes, context loss, commits, pushes, release creation, and Completion Notes edits alone must not trigger another full Verify.
* After small corrections, rerun only affected tests and checks. Repeat the full Verify only for broad effects, dependency/runtime contract changes, or coverage that cannot be reliably scoped; state the concrete reason before repeating it.
* If Verify fails, diagnose and repair the failed stage, rerun it and any other stages affected by the repair, then execute remaining stages that have not run. Reuse successful unaffected stages. Keep the original run recorded as failed and document the supplemental results; do not claim the original command passed. Completion requires every required stage to have valid passing evidence for the resulting state.
* In Completion Notes or the handover, record commands, results, the tested commit or described worktree state, existing log paths when available, and subsequent changes with their focused rechecks. Reuse evidence only when it can be tied to the relevant state; resolve missing or conflicting evidence with targeted inspection/checks. Do not create a separate verification report or cache.
* A successful automatic post-update Verify counts as the series' full run. Apply the same failure recovery and evidence rules when it fails.


---


# Memory and learning

* You must read the file contents of `data/ai/MEMORY.md`.
* You must compact and summarise `data/ai/MEMORY.md` when it exceeds 25 KiB.
* You must record durable project learning in `data/ai/MEMORY.md` after completing the last open kanban task or if the user asks you to memorise something.
* Memory may contain only current project invariants, constraints, operations, recurring causes, and gotchas with a `YYYY-MM-DD HH:MM` timestamp.
* You must remove routine test or release results and explicitly replace assertions that have been disproved or superseded.


---


# Programming Rules

* You must not write code without a corresponding kanban task file when `template-config.use-kanban` in `project.json` equals `true`.
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
* You must not delete, modify or move files outside the project root directly without user consent.
* You should use Bootstrap components and classes whenever possible in the frontend, instead of writing custom code.

## Root npm Scripts

### Complete Verification

* `npm run runtime:check`: Checks the pinned Node.js and npm contract.
* `npm run verify`: Runs the complete required quality pipeline.
* `npm run audit`: Checks for newly introduced code-health findings with the locally pinned Fallow.

### Focused Quality Checks

* `npm run lint`: Checks architecture, styles, and OpenAPI across all workspaces.
* `npm run typecheck`: Typechecks root tooling and all workspaces.
* `npm run test`: Runs workspace unit, integration, and component tests.
* `npm run build`: Builds every workspace that defines a build script.
* `npm run verify:module -- <module>`: Runs backend-wide type and lint checks plus the module's direct tests.

### Generated Contracts

* `npm run check:api`: Checks backend OpenAPI and generated frontend types.
* `npm run generate:api`: Updates backend OpenAPI and generated frontend types.
* `npm run check:modules`: Checks generated module mechanics for drift.
* `npm run module:sync -- <module>`: Updates one module's generated mechanics.
* `npm run check:migrations`: Checks migration order, dialect pairs, catalog, and checksums.
* `npm run generate:migrations`: Updates the migration checksum catalog.
* `npm run check:test-catalog`: Checks the backend test catalog for drift.
* `npm run generate:test-catalog`: Updates the backend test catalog.


---


# Template Update Rules

* Check stable upstream releases with `npm run template:check`.
* `AGENTS.md` is template-owned and replaced by every update; project-specific additions belong exclusively in `AGENTS-PROJECT.md`.
* `AGENTS-PROJECT.md` is project-owned and must never be overwritten or removed by template updates.
* The first update to the canonical-agent migration release may expose one legacy `AGENTS.md` conflict; resolve it with `incoming`. Later updates replace the basis automatically.
* `.template/version.json` is the only installed-template version source; `package.json.version` always belongs to the application.
* Initialize legacy applications without metadata exactly once with `npm run template:init -- <installed-version>`.
* Update only from a clean Git worktree with `npm run template:update` or an explicit stable version.
* Resolve updater conflicts only under `.template/conflicts/<version>/`, select `local`, `incoming`, `merged`, or `delete` in `resolutions.json`, and continue with `npm run template:update -- --continue <version>`.
* Abort unresolved staging with `npm run template:update -- --abort <version>`; this must not change project files.
* Template updates must preserve local modules, features, migrations, secrets, runtime data, local deployment profiles, Memory, and Kanban task contents.
* Template updates must preserve every existing `project.json` value and local key while recursively adding only settings newly introduced by the template.
* Application-owned package metadata must remain local. Template scripts, engines, workspaces, and dependencies are merged property by property.
* A failed post-update Verify does not roll back the installed template. Inspect `.template/status.json` and its referenced log, repair the application as needed, and apply [Verification Rules](#verification-rules) to recovery and follow-up checks. A successful automatic run already counts; do not repeat it merely for review or commit.
* After an update, inspect the uncommitted diff and verification status before creating a deliberate commit.
* Template updates must not commit, push, deploy, restore databases, or mutate external infrastructure automatically.
