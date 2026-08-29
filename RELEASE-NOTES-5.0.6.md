# Template 5.0.6

## Fixed

- The root `prepare` step now restores mode `0755` on the versioned
  `.githooks/pre-commit` hook before configuring the checkout.
- Applications that retained the hook as a non-executable file recover the
  credential pre-commit safeguard during the updater's normal `npm install`.
- Hook setup rejects symlinks and non-file paths instead of following them.

## Update compatibility

- Template 5.0.5 applications can update directly without conflicts when the
  Git-hook setup script is unmodified.
- Existing custom `core.hooksPath` values remain untouched; root Verify still
  enforces credential safety in those projects.
- No deployment or infrastructure migration is required.
