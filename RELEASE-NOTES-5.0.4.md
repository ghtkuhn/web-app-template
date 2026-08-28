# Template 5.0.4

## Fixed

- Existing-LXC deployment failures now identify the exact failed stage instead
  of returning only a generic SSH exit code.
- Bounded stdout and stderr diagnostics are retained for failed remote commands
  after explicit credential redaction.
- Process arguments, stdin, SSH passwords, sudo passwords, and private-key paths
  remain excluded from diagnostics.
- Dependency-installation failures now expose actionable `npm ci` and `npm ls`
  evidence through the normal deployment command.
- Activation and rollback diagnostics distinguish validation, dependency,
  configuration, service, release-switch, health-check, and retention failures.
- Each staged failure reports whether the active release was untouched, may be
  mid-switch, was rolled back, or was already activated before a later failure.
- `credentials:run` now accepts both direct child arguments and the documented
  optional second `--` separator without forwarding it as a profile name.
- Template 5.0.3 applications can update directly to 5.0.4 again. The
  pre-install check no longer compares the incoming LXC catalog with stale
  contract metadata retained by the running updater.

## Added

- `npm run credentials:run -- deployment:diagnose -- <profile> <component>`
  reports a read-only JSON snapshot of the Existing-LXC SSH target,
  infrastructure contract, Node/npm runtime, active release, and service state.
- The LXC contract catalog now binds the process runner, deployment CLI, and
  Existing-LXC adapter to the SSH release contract. These diagnostic additions
  use a supplemental catalog so the primary catalog remains readable by the
  Template 5.0.3 updater.

## Update compatibility

- Unmodified Template 4.x and 5.x applications receive the complete diagnostic
  contract automatically through `template:update`.
- Runtime consistency is checked with the incoming on-disk validator in a
  fresh Node.js process. Future catalog evolution therefore cannot be rejected
  merely because an older updater is still loaded in memory.
- Existing infrastructure schema 3 installations and remote releases remain
  compatible; this patch does not require bootstrap or infrastructure upgrade.
- Applications with local deployment-tooling changes must resolve the complete
  catalog-listed LXC contract coherently.
