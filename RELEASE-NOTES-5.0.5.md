# Template 5.0.5

## Fixed

- Existing-LXC backend releases now start the exported `BackendApplication`
  explicitly from `start-backend.mjs`. The previous launcher only imported a
  main-guarded module, so the process could exit successfully without opening
  the HTTP server.
- Deployment health retries are now one grouped shell expression. Successful
  health checks no longer enter the rollback branch because of shell operator
  precedence.
- Failed health checks still roll back after the bounded retry window.
- Deployment, explicit rollback, and database-restore activation all share the
  corrected health-check semantics.
- Health checks suppress response bodies and report concise component and
  attempt diagnostics while retaining curl failure evidence.

## Verification

- The release contract test now checks the complete generated backend launcher.
- An executable shell regression test proves that a later successful retry
  keeps the new release and that exhausted retries select rollback.
- The generated LXC checksum catalog includes the corrected launcher and SSH
  release driver.

## Update compatibility

- Unmodified Template 4.x and 5.x applications can update directly to 5.0.5.
- Existing infrastructure schema 3 installations require no bootstrap or
  infrastructure upgrade.
- Deploy a new backend release after updating so the corrected launcher is
  installed in the release archive.
