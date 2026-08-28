# Template 5.0.2

## Fixed

- Existing-LXC bootstrap and infrastructure upgrades now work with a regular
  non-root sudo user; passwordless sudo is no longer a prerequisite.
- `deployment.sshUser` remains the only Existing-LXC SSH identity, and direct
  root SSH remains forbidden.
- Missing or invalid sudo credentials stop before bootstrap files are uploaded
  or infrastructure is changed.

## Security

- The optional `DEPLOYMENT_SUDO_PASSWORD` is read only from the process
  environment populated by `credentials:run`.
- The sudo password reaches the remote `sudo -S` process exclusively through
  SSH stdin. It never appears in command arguments, profiles, logs, or errors.
- SSH and sudo passwords remain separate credentials. Password-based SSH keeps
  using `SSH_ASKPASS` while stdin is reserved for the targeted sudo call.
- Normal releases continue to use only the narrowly scoped passwordless helpers
  installed during bootstrap.

## Update action

Users whose deployment account requires a sudo password must add this name to
their existing ignored `/.credentials.env`:

```dotenv
DEPLOYMENT_SUDO_PASSWORD=
```

Existing credential files are never modified by the template updater. No
Existing-LXC infrastructure upgrade is required solely for this patch because
the remote infrastructure contract remains at schema version 3.
