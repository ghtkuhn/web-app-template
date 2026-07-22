# Task: Normalize TypeScript paths

**Domain:** infra
**Created:** 2026-07-22
**Status:** done

## Goal

Make executable project paths match the `code/backend` directory layout and consistently reference TypeScript source files.

## Context

The backend source and architecture linter use `.ts` files, while several scripts, imports, and linter messages still reference `.js` files or depend on the current working directory.

## Done When

- [x] Root and backend lint scripts execute the TypeScript architecture linter from either package directory.
- [x] Backend source imports and linter file rules consistently use `.ts` extensions.
- [x] The architecture linter resolves project paths independently of the current working directory and reports violations with a non-zero exit code.

## Verification

Verified `npm run lint:backend` from the project root and from `code/backend`. A temporary `interfaces.ts` fixture was accepted, while a misplaced exported constant in an `object/*.ts` fixture produced a lint failure; both fixtures were removed afterward. TypeScript import-extension errors are resolved; the full typecheck remains blocked by pre-existing missing backend dependencies and a pre-existing DTO cast error.

### Code health (fallow)

Ran from project root:

```bash
npx fallow audit --format json
```

Fallow executed successfully and reported the untracked repository baseline as introduced findings because only `.gitignore` and `.gitattributes` exist in `HEAD`. The reported dead-code and complexity findings predate this path-normalization task; no unresolved imports were reported.

### Memory update

- Recorded the durable path and TypeScript-extension convention in `data/ai/MEMORY.md` with a timestamp.
