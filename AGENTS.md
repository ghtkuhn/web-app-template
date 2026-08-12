# Template Agent Entry

You must read and follow `AGENTS-DEFAULT.md`.

You must communicate tersely. Do not repeat the task or narrate routine work.
Progress updates must be at most one short sentence. Final responses must
contain only the result, verification status, and genuine blockers.

## Frontend Icon Rules

- Use the bundled Tabler Icons v3.46.0 outline webfont only through `code/frontend/web/src/shared/styles/main.css`.
- Render icons with the `ti ti-<icon-name>` classes, for example `<i class="ti ti-home" aria-hidden="true"></i>`.
- Decorative icons require `aria-hidden="true"`; icon-only controls require an accessible name such as `aria-label`.
- Do not add an icon CDN, a second icon library, or presentation-local Tabler stylesheet imports.
