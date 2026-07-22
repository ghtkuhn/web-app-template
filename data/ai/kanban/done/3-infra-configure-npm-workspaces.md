# Task: Configure npm workspaces

**Domain:** infra
**Created:** 2026-07-22
**Status:** done

## Goal

Turn the repository into an npm-workspace monorepo with one installation, one lockfile, and one root verification workflow.

## Context

The root, backend, and web packages previously behaved as partly independent npm projects while sharing root-level tooling and configuration.

## Done When

- [x] The root package declares backend and web workspaces and owns the only npm lockfile.
- [x] Backend and web expose consistent package-local lint, typecheck, and test scripts as applicable.
- [x] A root `npm run verify` orchestrates all workspace checks successfully.

## Verification

Ran `npm install --ignore-scripts`, confirmed both packages with `npm ls --workspaces --depth=0`, confirmed that only the root `package-lock.json` exists, and ran `npm run verify` successfully.

### Code health (fallow)

Ran `npx fallow audit --format json`. Fallow continues to report the repository-baseline dead-code and linter-complexity findings, but reports no unresolved imports or unlisted dependencies after workspace dependency ownership was corrected.

### Memory update

- Recorded the workspace layout, lockfile ownership, dependency ownership, and root verification command in `data/ai/MEMORY.md` with a timestamp.
