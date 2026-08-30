# Template 5.0.7

## Added

- `deployment.platform` is now the validated default driver for newly
  scaffolded deployment profiles. Supported values are `docker`,
  `existing-lxc`, and `proxmox-lxc`.
- Explicit backend and frontend driver options retain priority, and existing
  profiles remain authoritative for every deployment operation.

## Fixed

- Explicitly allowed browser origins now receive
  `Access-Control-Allow-Credentials: true` on normal and preflight responses,
  enabling credentialed Better Auth requests without weakening the exact
  origin allowlist.
- Better Auth transport rejections are normalized into stable `network` or
  `abort` API errors inside `AuthService` instead of escaping into Vue router
  guards and interrupting application rendering.
- Failed session restoration clears stale Bearer credentials, and sign-out now
  clears local credentials even when its network request rejects.
- The normal API client and Auth Service share one transport-error normalizer,
  including a safe fallback that does not expose unknown rejected values.

## Update compatibility

- Unmodified Template 5.x applications receive the fix through the normal
  template update without application or infrastructure migration.
- Applications with a local catch-all workaround in `auth.composable.ts`
  should remove it after accepting the incoming Auth Service changes. The
  composable remains responsible only for UI state transitions.
- The CORS policy still requires an exact origin in `allowedOrigins`; wildcard,
  rejected, and originless requests do not receive credential permission
  headers.
- Applications updating from 5.0.6 receive the new `docker` project default
  automatically without changing existing profiles. Locally defined project
  values remain application-owned; experimental `local` or `lxc` values must
  be replaced with an exact supported driver before deployment validation.
