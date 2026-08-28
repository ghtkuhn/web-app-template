# Deployment Profiles

Deployment is controlled by versioned JSON profiles in `deployment/profiles/`.
The default profile is `local`, and both components use Docker unless a
Proxmox LXC driver is selected explicitly.

```bash
npm run deployment:validate
npm run deployment:validate -- --all
npm run deployment:scaffold -- staging
npm run deployment:scaffold -- staging --database postgres
npm run deployment:scaffold -- staging --backend-driver existing-lxc
npm run deployment:build -- local backend
npm run credentials:run -- deployment:bootstrap -- staging backend
npm run credentials:run -- deployment:deploy -- local all
npm run credentials:run -- deployment:status -- local all
npm run credentials:run -- deployment:stop -- local all
npm run credentials:run -- deployment:database:list -- local
npm run credentials:run -- deployment:database:restore -- local <backup-id>
```

Backend and frontend targets are independent. A profile can therefore select
`docker`, `proxmox-lxc`, or `existing-lxc` separately for each component.

## Secrets

Profiles contain only the names of required secrets. Run `npm run
credentials:init`, populate the ignored root `/.credentials.env`, and invoke
deployment scripts through `npm run credentials:run -- ...`. The file remains
local, mode `0600`, and is never included in releases, images, or updater
payloads. Never put secret values in profiles, documentation, logs, fixtures,
Memory, Kanban, or command arguments.

Proxmox LXC requires:

- `PROXMOX_API_TOKEN_ID`
- `PROXMOX_API_TOKEN_SECRET`
- `DEPLOYMENT_SSH_PRIVATE_KEY`
- every application secret named in `requiredSecrets`

Existing LXC requires either `DEPLOYMENT_SSH_PRIVATE_KEY` or, only when the
profile explicitly selects password authentication,
`DEPLOYMENT_SSH_PASSWORD`. Private-key authentication is the default. Both LXC
drivers pin `sshHostKeyFingerprint` with `StrictHostKeyChecking=yes`; they do
not use `ssh-keyscan` or interactive trust.

Existing-LXC bootstrap and infrastructure upgrades first try passwordless
sudo. If the configured user requires a sudo password, set the separate
`DEPLOYMENT_SUDO_PASSWORD` in `/.credentials.env`. It is command-specific and
therefore does not belong in profile `requiredSecrets`.

PostgreSQL profiles additionally require `DATABASE_URL`. The URL is supplied
only through the deployment environment and must never be stored in the JSON
profile. Production URLs use the `postgresql:` protocol with
`sslmode=verify-full`.

The Proxmox token needs permission to inspect nodes, storages, templates,
containers, and tasks and to create, configure, start, and stop the configured
container IDs. Provisioning uses the Proxmox REST API. The release is copied and
activated through SSH directly to the LXC.

## Proxmox LXC Requirements

The Proxmox driver works with the regular Proxmox VE REST API and does not
require a paid subscription. The selected Proxmox installation must provide:

- an API endpoint reachable over HTTPS, normally on TCP port `8006`;
- a reachable, online node;
- storage that supports LXC root filesystems;
- an available Debian LXC template on accessible template storage;
- an existing Linux bridge and, where applicable, an SDN zone;
- a free, deliberately reserved container ID for each component;
- an IP configuration with gateway and DNS that can reach package and Node.js
  download servers;
- direct TCP/22 access from the deployment machine to the resulting LXC.

The template must support unprivileged LXC, systemd, `apt`, and OpenSSH. The
container needs enough disk, memory, CPU, and outbound network access to install
Node.js and application dependencies. Backend and frontend may use different
nodes, storages, bridges, container IDs, and addresses.

TLS verification is the default. `allowInsecureTls` is limited to `local` and
`dev` profiles and should be used only for a controlled self-signed environment.
Staging and production require a trusted certificate chain.

### API Identity and Permissions

Use a dedicated Proxmox API user and API token rather than a personal account
or root credentials. Keep the token scope limited to the exact resources in the
deployment profile. A typical least-privilege setup needs capabilities
equivalent to:

- audit/read access for nodes, tasks, storages, templates, networks, and the
  selected container;
- VM allocation and configuration rights for the reserved container ID;
- datastore allocation rights on the selected root filesystem storage;
- SDN or bridge-use permission for the selected network when required by the
  Proxmox version and network configuration;
- lifecycle rights to create, configure, start, stop, and query that container.

Built-in roles commonly used to compose these capabilities include
`PVEAuditor`, `PVEVMAdmin`, `PVEDatastoreAdmin`, and `PVESDNUser`, but an
administrator may provide narrower custom roles. Do not grant global
administrator access merely to make deployment pass. When token privilege
separation is enabled, ensure that the token itself has the required ACLs; user
permissions alone may not be inherited by the token.

The REST identity and the LXC SSH identity serve different purposes:

- the API token provisions and controls the container through Proxmox;
- an SSH public key is injected into the LXC during creation;
- `DEPLOYMENT_SSH_PRIVATE_KEY` points to the matching local private key;
- releases are installed by SSH directly into the LXC;
- SSH access to the Proxmox host is neither required nor used by deployment.

## Existing LXC Requirements

The `existing-lxc` driver manages releases in a container that already exists;
it never creates the LXC through Proxmox. The target must be Debian 13 on
x86_64, reachable directly over SSH, and configured with the exact host-key
fingerprint stored in the profile.

All local tooling, Docker build stages, and LXC installations use the single
runtime pinned in `.nvmrc`: Node.js 24.19.0 with npm 11. Deployment artifacts
must not contain a locally built `node_modules` directory. Dependency lifecycle
scripts are disabled; `better-sqlite3` 13 uses its bundled Node-API binary, and
trusted repository setup remains available explicitly through `npm run prepare`.

Bootstrap is an explicit one-time operation:

```bash
npm run credentials:run -- deployment:bootstrap -- <profile> <backend|frontend|all>
```

It connects as the non-root `deployment.sshUser` configured in `project.json`
and runs the bootstrap script through sudo. Passwordless sudo is detected
automatically; otherwise `DEPLOYMENT_SUDO_PASSWORD` is passed only through the
SSH process stdin to `sudo -S`. A regular sudo-enabled account is therefore
sufficient, and root SSH access is neither used nor required. Bootstrap
installs the Node version from `.nvmrc` and configures that same account as the
systemd application owner with Nginx, persistent directories, and narrowly
scoped sudo helpers. Existing-LXC profiles therefore do not own an independent
SSH user setting.
`deployment:deploy` never invokes bootstrap and does not otherwise
provision or mutate the operating system.

Existing-LXC infrastructure is versioned independently from application
releases. Inspect and explicitly upgrade it with:

```bash
npm run credentials:run -- deployment:infrastructure:status -- <profile> <backend|frontend|all>
npm run credentials:run -- deployment:infrastructure:upgrade -- <profile> <backend|frontend|all>
```

Deploy refuses a backend upload when the remote infrastructure schema, exact
Node.js version, or npm major does not match the repository contract. Upgrade
preserves releases, the active `current` symlink, configuration, and persistent
data. A recognized legacy backend release receives a compatibility launcher;
unknown or ambiguous layouts stop the upgrade without changing systemd.

### Guidance for AI Agents

Before changing external infrastructure, an AI agent must:

1. Validate the profile and confirm that every referenced node, storage,
   template, bridge, address, and container ID belongs to the intended target.
2. Check that the container ID is unused or already belongs to this application.
   Never repurpose an unrelated existing container merely because its ID matches.
3. Verify API access with read-only requests before attempting provisioning.
4. Verify that the deployment machine can reach both the Proxmox API and the
   planned LXC SSH address.
5. Keep API secrets, private keys, passwords, and rendered environment files in
   ignored local files or environment variables. Never print them in commands,
   logs, documentation, commits, or task notes.
6. Use the public SSH key in the profile and never place private key material in
   JSON.
7. Run `deployment:validate`, deploy only the requested component, check status
   and health, and stop test resources when the test is complete.

Provisioning is intentionally non-destructive: the supplied commands do not
delete LXC containers, Docker volumes, or persistent databases. An AI agent must
not add or execute deletion, recreation, or storage-wipe operations without
explicit user authorization and a read-only verification of the exact target.

## Runtime Model

Profile schema version 2 models the backend database explicitly. Existing
version-1 SQLite profiles remain readable and are normalized in memory; new and
scaffolded profiles use version 2. SQLite remains the default unless
`--database postgres` is selected.

Docker stores SQLite data in the external `backend-data` volume. LXC backend
releases use `/var/lib/<installationId>` for persistent SQLite data. PostgreSQL
is always externally managed: neither the Docker nor Proxmox driver provisions,
updates, stops, or deletes a PostgreSQL server. Both drivers only pass the
secret connection URL to the backend. Frontend images and LXC releases receive
their public API, WebSocket, and presentation settings at runtime, so the same
static frontend artifact can be used in multiple profiles.

LXC releases are checksummed, installed below
`/opt/<installationId>/<component>/releases/`, and switched through the
`current` symlink. Configuration lives below `/etc/<installationId>`. A failed
install or health check restores the previous release.

Backend archives retain the npm-workspace layout and contain the root manifest,
root lockfile, backend workspace manifest, backend source, maintenance script,
versioned release contract, and stable `start-backend.mjs` launcher. The remote
candidate and fallback release are validated before configuration, service
state, migrations, or symlinks can change. Dependencies are installed into the
candidate before downtime starts; symlinks inside release archives are
forbidden.

Before pending SQLite migrations, the backend creates and validates an online
backup under `/var/lib/<installationId>/backups`. The default retention is ten backups
and can be changed with `databaseBackupRetention` in the backend profile.
Backups are local recovery points, not protection against loss of the Docker
host, volume, or Proxmox storage.

Database restore is always explicit. It stops the backend, validates the chosen
backup, creates a pre-restore safety backup, replaces the database atomically,
and starts and health-checks the current release. A code rollback never restores
the database automatically. Large backfills must be separate idempotent,
restartable jobs rather than startup migrations.

The built-in database list and restore commands apply only to SQLite.
PostgreSQL profiles declare `backupStrategy: "external"`; the operator or
database provider owns backups, retention, point-in-time recovery, restore
testing, and disaster recovery. Application deployment never claims that an
external PostgreSQL backup exists and never runs `pg_dump` or `pg_restore`.

The repository's complete `npm run verify` command requires a running Docker
daemon. It starts a uniquely named disposable PostgreSQL 17 container from a
pinned image digest, verifies connections, migrations, schema types, and Auth,
and stops the container in success and failure paths. The test never uses or
modifies the PostgreSQL server configured by a deployment profile.

When `auth` is included in `backend.activeModules`, the profile must list
`BETTER_AUTH_SECRET` in `requiredSecrets`; the secret remains Environment-only.
Set `backend.authRegistrationEnabled` explicitly and keep the frontend runtime
flags `authEnabled` and `registrationEnabled` consistent with the backend.
Auth-disabled profiles require no Better Auth secret and remain the default.
