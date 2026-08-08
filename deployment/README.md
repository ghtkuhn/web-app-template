# Deployment Profiles

Deployment is controlled by versioned JSON profiles in `deployment/profiles/`.
The default profile is `local`, and both components use Docker unless a
Proxmox LXC driver is selected explicitly.

```bash
npm run deployment:validate
npm run deployment:validate -- --all
npm run deployment:scaffold -- staging
npm run deployment:build -- local backend
npm run deployment:deploy -- local all
npm run deployment:status -- local all
npm run deployment:stop -- local all
npm run deployment:database:list -- local
npm run deployment:database:restore -- local <backup-id>
```

Backend and frontend targets are independent. A profile can therefore use
Docker for one component and Proxmox LXC for the other.

## Secrets

Profiles contain only the names of required secrets. Copy the relevant
`.env.example` files into your local secret-management workflow and export the
values before deployment. Never commit API token secrets, passwords, or private
SSH keys.

Proxmox LXC requires:

- `PROXMOX_API_TOKEN_ID`
- `PROXMOX_API_TOKEN_SECRET`
- `DEPLOYMENT_SSH_PRIVATE_KEY`
- every application secret named in `requiredSecrets`

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

Docker stores SQLite data in the external `backend-data` volume. Proxmox
backend releases use `/var/lib/web-app` for persistent data. Frontend images and
LXC releases receive their public API, WebSocket, and presentation settings at
runtime, so the same static frontend artifact can be used in multiple profiles.

LXC releases are checksummed, installed below
`/opt/web-app/<component>/releases/`, and switched through the `current`
symlink. A failed install or health check restores the previous release.

Before pending SQLite migrations, the backend creates and validates an online
backup under `/var/lib/web-app/backups`. The default retention is ten backups
and can be changed with `databaseBackupRetention` in the backend profile.
Backups are local recovery points, not protection against loss of the Docker
host, volume, or Proxmox storage.

Database restore is always explicit. It stops the backend, validates the chosen
backup, creates a pre-restore safety backup, replaces the database atomically,
and starts and health-checks the current release. A code rollback never restores
the database automatically. Large backfills must be separate idempotent,
restartable jobs rather than startup migrations.

When `auth` is included in `backend.activeModules`, the profile must list
`BETTER_AUTH_SECRET` in `requiredSecrets`; the secret remains Environment-only.
Set `backend.authRegistrationEnabled` explicitly and keep the frontend runtime
flags `authEnabled` and `registrationEnabled` consistent with the backend.
Auth-disabled profiles require no Better Auth secret and remain the default.
