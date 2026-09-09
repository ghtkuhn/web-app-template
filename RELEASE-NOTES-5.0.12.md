# Template 5.0.12

## Changed

- New tests are selected by concrete failure risk, not coverage quotas or minimum
  counts. Agents reuse existing protection and choose the smallest test level
  that reliably detects the failure.
- The backend linter no longer requires tests per executable module, Store,
  HTTP route, or documented response status. OpenAPI consistency, test structure,
  import boundaries, and quality checks for existing assertions remain enforced.
- Agent instructions, the task template, and update guidance explicitly allow
  “No new test” with a reason and existing test or check evidence.
- Removed analysis used exclusively to enforce blanket test requirements.

## Compatibility and validation

- Existing application tests are preserved. Test discovery, npm scripts, and
  verification-evidence reuse are unchanged. No runtime migration is needed.
- `scaffold:test` remains optional; its baseline is not evidence of business-risk
  protection.
- Focused checks passed: 41 backend linter tests and 17 instruction/workflow
  tests. The full root Verify passed once, including browser tests and Fallow
  with zero findings; `git diff --check` passed.
- Only the template version and these release notes were added after that
  verification. No full Verify was repeated for release preparation.
