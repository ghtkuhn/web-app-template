# Template 6.0.2 — final GitHub release

## Release source migration

- Future template checks and updates use the private repository at
  https://git.tobitron.com/tobias/web-app-template exclusively.
- This bridge release is published identically on both hosts. Its private tag
  supplies the exact base required for subsequent three-way updates.
- Legacy GitHub metadata left by the old updater is recognized automatically;
  no manual metadata edits are required.

## Required action

1. Install 6.0.2 using your existing GitHub-based updater and resolve any normal
   application conflicts.
2. Obtain a token with read access to the private template repository and store
   it locally as `TEMPLATE_REPOSITORY_TOKEN` in `.credentials.env`.
3. From then on, use `npm run credentials:run -- template:check` and
   `npm run credentials:run -- template:update`. Use the same runner for update
   continuation. CI may inject the token through its secret store.

Existing credential files remain untouched. Tokens are never shipped in the
template. Missing access fails explicitly, without falling back to GitHub.
Authenticated requests reject redirects and untrusted archive destinations;
archive downloads are bounded to 100 MiB and transport errors are sanitized.

## Compatibility

- No application runtime, dependency, database, or infrastructure changes.
- Older applications must pass through this release using the old updater.
  Historical GitHub tags stay available; no further GitHub releases are planned.
- Project-specific code, configuration, credentials, and local data retain the
  existing update-preservation rules.

## Validation

- 47 updater tests cover authentication, legacy metadata, private URLs, bounded
  downloads, and existing merge behavior.
- All required verification stages passed: 144 backend tests, 193 frontend
  tests, nine browser tests, build, and no new Fallow findings.
- The initial sandboxed Verify failed on unavailable server-port/Docker access.
  Backend tests were rerun with the required access, followed by the outstanding
  build, browser, optional PWA, and audit stages; successful earlier stages were
  not repeated.
