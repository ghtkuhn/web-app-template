# Template 4.0.1

## Fixed

- Root, backend, and frontend package manifests now adopt the same Node.js
  24.19.0 and npm 11 contract during template updates without discarding local
  dependencies or scripts.
- Existing-LXC backend artifacts, systemd, installation, activation, and
  rollback now share one versioned runtime-layout contract.
- Backend candidates and rollback targets are validated before service downtime
  or symlink changes; missing files, altered contracts, and symlinks are
  rejected.
- Existing-LXC deployment checks the remote infrastructure schema and runtime
  before uploading a backend release.
- Remote command failures retain their exit code and are no longer mislabeled
  as SSH password failures.

## Existing-LXC upgrade required

Existing Template 4.0.0 containers must be upgraded explicitly before their
next backend deployment:

```bash
npm run credentials:run -- deployment:infrastructure:status -- <profile> backend
npm run credentials:run -- deployment:infrastructure:upgrade -- <profile> backend
```

The upgrade preserves the active release, configuration, and persistent data.
It installs infrastructure schema 2 and adds a compatibility launcher to a
recognized legacy release. Deployment remains blocked for unknown layouts or
runtime mismatches.

See `TEMPLATE-UPDATES.md` for the one-time package-manifest conflict procedure
when the update itself is still being executed by the Template 4.0.0 updater.
