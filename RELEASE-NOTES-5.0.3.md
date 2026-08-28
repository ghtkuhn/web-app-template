# Template 5.0.3

## Fixed

- LXC release validation now accepts npm-generated symlinks such as
  `node_modules/.bin/uuid` and workspace links when their resolved targets stay
  inside the release.
- Broken links, links outside `node_modules`, and dependency links escaping the
  release remain blocked.
- Existing installed releases and rollback candidates are no longer rejected
  merely because `npm ci` created legitimate links.
- Backend deployment verifies the installed production dependency tree with
  `npm ls --omit=dev --all` before stopping the service or activating a release.
- Rollback performs the same dependency-tree verification before changing the
  active symlink.

## Update compatibility

- Unmodified Template 4.x and 5.x applications receive the validator, SSH
  activation logic, and generated LXC contract catalog automatically.
- Existing workspace and legacy flat backend release layouts remain supported.
- No remote infrastructure upgrade is required solely for this fix;
  infrastructure schema 3 remains current.
- Locally modified LXC runtime files must be resolved as one coherent incoming
  contract rather than mixed with older validator or activation files.
