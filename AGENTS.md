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
* During an active implementation sequence, you must run only tests created or changed by the current task. You must not run pre-existing test suites again until the final open task in that sequence is complete.
* After the final open task is complete, you must run the complete existing test suite and root `npm run verify` once before declaring the sequence complete.
* Completion Notes must map every Done-When criterion to at least one concrete test name or verification command.
* You must close a task with `npm run task:close -- <id>` after its required focused checks; close the final task only after complete verification.
* You must run `npm run check:kanban` before completing an implementation sequence.
* You must commit in git after every completed task, if the project is a git repo.


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
* A failed post-update Verify does not roll back the installed template. Inspect `.template/status.json` and its referenced log, migrate the application, and run `npm run verify` again.
* After an update, inspect the uncommitted diff and verification status before creating a deliberate commit.
* Template updates must not commit, push, deploy, restore databases, or mutate external infrastructure automatically.
