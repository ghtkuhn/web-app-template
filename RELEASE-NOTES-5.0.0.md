# Template 5.0.0

## Breaking changes

- Bootstrap 5.3 replaces Pico as the frontend CSS framework.
- The global style entry is now `src/shared/styles/main.scss`; the former
  `main.css` entry and every Pico variable are removed.
- Views use explicit Bootstrap classes for navigation, forms, cards, alerts,
  buttons, and links. Locally customized Pico markup must be migrated during
  the template update.

## Added

- Bootstrap 5.3.8 Sass is compiled by Vite with application-owned light and
  dark design values.
- Complete Bootstrap JavaScript and Popper are bundled once by `main.ts`.
- `data-bs-theme` follows the operating-system color scheme and updates live.
- The frontend linter parses SCSS and teaches Bootstrap import ownership,
  offline dependency use, and removal of legacy Pico contracts.
- Existing-LXC bootstrap connects with the non-root `deployment.sshUser` from
  `project.json` and elevates only through non-interactive `sudo`; root SSH is
  no longer required. A unique legacy profile user is migrated automatically.

## Preserved

- Desktop, tablet, and mobile remain independent presentation trees.
- Application design tokens remain the stable interface for scoped styles.
- Tabler Icons remain bundled locally as the only icon catalog.

## Update action

When updating a customized application, move local rules from `main.css` into
the incoming `main.scss`, retain the Bootstrap Sass configuration, and then
resolve removal of the old file. Merge locally changed Vue views with the
incoming Bootstrap component classes. Do not retain `@picocss/pico`,
`--pico-*`, or the old `secondary` button class.

After resolving update conflicts, run:

```bash
npm run lint --workspace @app/web
npm run typecheck --workspace @app/web
npm run build --workspace @app/web
npm run verify
```
