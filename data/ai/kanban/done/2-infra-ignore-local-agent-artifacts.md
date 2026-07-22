# Task: Ignore local agent artifacts

**Domain:** infra
**Created:** 2026-07-22
**Status:** done

## Goal

Keep macOS metadata and local agent-analysis state out of Git status and repository commits.

## Context

`.DS_Store`, `.code-graph`, `.smallcode`, and `.memory` are machine-local artifacts that may occur at the repository root or in nested directories.

## Done When

- [x] `.DS_Store` files are ignored at every directory depth.
- [x] `.code-graph`, `.smallcode`, and `.memory` directories are ignored at every directory depth.
- [x] Existing instances of those artifacts no longer appear in `git status`.

## Verification

Verified root and nested instances with `git check-ignore -v`, confirmed their absence from `git status --short`, and ran `npm run lint:backend` successfully.

### Code health (fallow)

Ran `npx fallow audit --format json`. Fallow completed with the unchanged repository-baseline dead-code and complexity findings; this ignore-only task introduced no source-code findings.

### Memory update

- Recorded the repository-wide local-artifact ignore convention in `data/ai/MEMORY.md` with a timestamp.
