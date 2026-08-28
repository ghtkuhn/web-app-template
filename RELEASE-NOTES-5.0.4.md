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

## Added

- `npm run credentials:run -- deployment:diagnose -- <profile> <component>`
  reports a read-only JSON snapshot of the Existing-LXC SSH target,
  infrastructure contract, Node/npm runtime, active release, and service state.
- The LXC contract catalog now binds the process runner, deployment CLI, and
  Existing-LXC adapter to the SSH release contract.

## Update compatibility

- Unmodified Template 4.x and 5.x applications receive the complete diagnostic
  contract automatically through `template:update`.
- Existing infrastructure schema 3 installations and remote releases remain
  compatible; this patch does not require bootstrap or infrastructure upgrade.
- Applications with local deployment-tooling changes must resolve the complete
  catalog-listed LXC contract coherently.
