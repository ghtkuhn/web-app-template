# Template 6.0.1

## Agent guidance

- Recommend scaffolding the required code structure before implementing new
  features.
- Describe unfinished business logic with concise TODOs.
- Forbid success responses from TODO placeholders until the actual code is
  implemented.

## Updating

- Documentation-only patch: no runtime, dependency, CLI, or database changes.
- The normal template update delivers the revised `AGENTS.md`. Project-specific
  instructions continue to belong in `AGENTS-PROJECT.md`.

## Validation

- Focused agent-instruction contract tests, credential safeguards, and
  `git diff --check` are checked for this release.
- No repeated full Verify is required for this documentation-only change.
