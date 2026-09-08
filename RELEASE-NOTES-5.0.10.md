# Template 5.0.10

## Fixed

- Kanban validation reports failures across all tasks in one run, including
  metadata, criteria, dependencies, counter drift, and draft placeholders.
  Placeholder diagnostics identify the file, line, column, and exact marker.
- Open tasks may leave Completion Notes pending or absent. Actual evidence
  remains mandatory when closing a task and for tasks already in `done`.
- HTML tags, TypeScript generics, Markdown autolinks, and CLI argument examples
  no longer fail a blanket angle-bracket check.
- New task drafts use explicit `[[TODO: description]]` markers. Goal, Scope,
  Done When, and Verification must be filled before the board passes validation.
- The task template explains when completion evidence must be recorded instead
  of requiring a completed implementation summary during planning.

## Update compatibility

- Existing task files are preserved by template updates. Schema-v1 tasks retain
  their legacy treatment.
- Known legacy template markers and `<TBD ...>` / `<TODO ...>` markers remain
  recognized. In open tasks they are permitted inside Completion Notes only.
- Arbitrary angle-bracket text is no longer treated as a placeholder. Use
  `[[TODO: description]]` for custom draft markers. A stand-alone placeholder
  such as `<config-test-name>` is still rejected as completion evidence.
- No application runtime or deployment infrastructure migration is required.
