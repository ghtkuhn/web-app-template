# Template 6.0.0

## Summary

A smaller command interface for AI-assisted application development: 40 root
npm scripts instead of 58, eight everyday commands in `AGENTS.md`, and focused
offline help. This major release changes the CLI, not the application architecture.
The template remains single-app.

## Breaking changes

- Removed all root `deployment:*` and `scaffold:*` aliases without a transition
  period. Use the common entry points instead:

  ```bash
  npm run scaffold -- module billing
  npm run deployment -- status production backend
  npm run credentials:run -- deployment deploy production backend
  ```

- Operational deployment commands require an explicit profile and component;
  missing arguments no longer select `local` or `all`. Database commands require
  a profile and target only its backend; restore also requires a concrete backup
  ID. Rollback without a release ID still selects the previous release.
- Root `test` accepts only the documented selectors. Workspace-specific runner
  flags remain available through their workspace commands.

## Added and improved

- Central help provides syntax, examples, and side effects without loading
  configuration or credentials, starting checks, or contacting external services:

  ```bash
  npm run help
  npm run help -- scaffold operation
  npm run help -- deployment rollback
  npm run help -- test
  ```

- Focused tests use the existing root command:

  ```bash
  npm test
  npm run test -- --module health
  npm run test -- --file code/frontend/web/test/core.test.ts
  ```

  No arguments still run the full workspace suites. Invalid selectors never
  fall back to all tests. Backend selection respects the test catalog and runs
  serially; symlink and out-of-workspace paths are rejected.
- `verify:module` retains backend-wide type/lint checks and shares the focused
  module-test selection. Test scaffolding runs only the created test after lint
  and typecheck, preserving catalog updates and transactional rollback.
- Deployment argument validation now precedes configuration and external access.
  Help works even without a usable deployment configuration.
- Repair messages and generator guidance use current command names and concrete
  module arguments where known. Agent instructions expose only everyday commands.

## Updating

- Existing 5.x applications use the normal template updater. No database
  migration or infrastructure schema upgrade is introduced.
- Translate `npm run deployment:<action> -- ...` to
  `npm run deployment -- <action> ...`, and `npm run scaffold:<type> -- ...` to
  `npm run scaffold -- <type> ...`. Supply explicit deployment targets.
- Local tasks, Memory, and application scripts are not rewritten. Translate old
  task instructions when executing them. Unchanged old template aliases are
  removed by the package merger; locally modified entries and collisions with
  new script names require normal conflict resolution.
- Existing-LXC deploy does not bootstrap or upgrade infrastructure. Proxmox
  retains its driver-specific provisioning behavior. Secret, host-key, release,
  and rollback safeguards remain in place.

## Validation

- One full root Verify passed for the implementation: 144 backend tests,
  189 frontend tests, nine browser tests, build, and zero Fallow findings.
- Five existing OpenAPI warnings remain; they do not fail verification.
- Release preparation changes only version metadata and documentation; existing
  verification evidence is reused. Credential safeguards, focused instruction
  checks, and `git diff --check` are checked before commit.
