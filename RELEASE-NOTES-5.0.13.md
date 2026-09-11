# Template 5.0.13

## Changed

- Updated locally pinned Fallow from 3.15.0 to 3.25.0 and Better Auth from
  1.6.26 to 1.7.4 in both workspaces.
- Added on-demand code navigation using local Fallow:
  - `npm run code:inspect -- <file-path>` returns file dependencies, consumers,
    and evidence as JSON.
  - `npm run code:trace -- <file-path>:<export>` shows a best-effort caller/callee
    chain limited to two hops.
- Documented both commands in `AGENTS.md` and shortened testing, verification,
  and task instructions using consistent normative wording. Risk-based test
  selection and reuse of valid verification results remain in place.

## Fixed

- The OpenAPI generator initializes its temporary in-memory auth schema before
  creating Better Auth, supporting the new startup schema validation without
  disabling it. Updated the generated OpenAPI contract and frontend API types.

## Update notes

- No template database migration or deployment infrastructure upgrade is added.
  Applications with custom Better Auth integrations should review the upstream
  [1.7 release notes](https://github.com/better-auth/better-auth/releases/tag/v1.7.0).
- Code navigation uses repository-relative paths and is not a verification gate.
  Missing graph edges do not prove absence of impact.
- The normal updater preserves application-owned changes; resolve any local
  OpenAPI-generator or dependency conflicts before completing the update.

## Validation

- All required verification stages passed using the original run and targeted
  recovery checks: the initial Verify failed on a test type error, which was
  fixed; the PostgreSQL test passed after Docker was started. The original
  failed run remains recorded as failed.
- Backend and frontend tests, build, all nine browser tests, and Fallow passed.
  Fallow reported zero findings. Follow-up instruction/workflow checks passed
  all 17 tests; `git diff --check` passed.
- npm's separate dependency security audit still reports eight vulnerabilities
  in other dependencies (three moderate, five high); this release does not
  claim to resolve them.
