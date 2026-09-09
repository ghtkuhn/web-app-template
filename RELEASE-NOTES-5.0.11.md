# Template 5.0.11

## Changed

- Central Verification Rules now apply with or without Kanban. One full Verify
  per connected implementation series supplies shared evidence for implementation,
  review, and release; its included test suite is not a separate completion gate.
- Agents reuse recorded results across task boundaries, handovers, commits,
  and releases. Small corrections require only affected tests and checks.
- Failed verification is recovered by rerunning failed or affected stages and
  completing stages that have not run. Successful unaffected results remain valid;
  the original failed run must still be documented as failed.
- Full reruns require a concrete reason: broad effects, dependency/runtime
  contract changes, or coverage that cannot be reliably scoped.
- Task and updater guidance now follows the shared policy. A successful automatic
  post-update Verify already counts; documentation-only changes need focused
  contract checks and a clean diff check.

## Compatibility and validation

- Existing task files remain untouched. npm scripts, exit codes, and updater
  execution behavior are unchanged. No runtime or infrastructure migration is needed.
- The changed instruction contracts and workflow suite passed all 17 focused
  tests before release preparation; `git diff --check` passed. Only release notes
  and the template version were added afterward. No full Verify was repeated.
