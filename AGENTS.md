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
- Before choosing an icon, run `npm run icons -- <search-term>`; it searches the bundled catalog and prints class names, code points, and official visual-reference URLs. Use `npm run icons -- --all` only when a complete list is necessary.

## Frontend CSS Unit Rules

- Use `rem` exclusively for `font-size`; unitless `0` and CSS reset keywords are the only exceptions.
- Do not use numeric `font` shorthand. Set `font-size` separately so its unit remains verifiable.
- Use only `px`, `%`, or unitless `0` for margin, padding, gap, and scroll-spacing values. Applicable semantic keywords such as `margin: auto` and CSS reset keywords remain allowed.
- Custom properties, fallbacks, and CSS math functions must resolve exclusively to units allowed by the consuming property.
- Other layout properties may use any valid CSS unit; do not apply the font-size restriction to widths, heights, grid tracks, or similar layout values.
