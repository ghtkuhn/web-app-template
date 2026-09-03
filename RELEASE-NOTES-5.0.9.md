# Template 5.0.9

## Fixed

- Existing-LXC infrastructure upgrades from schema 2 to schema 3 now accept an
  intact active release carrying the exact schema-2 release contract.
- The upgrader validates the complete release before changing its contract,
  atomically replaces the manifest with the corresponding schema-3 contract,
  and validates the resulting release again.
- Canonical workspace releases and both supported legacy backend layouts are
  covered. Altered, unknown, incomplete, or unsafe release trees remain
  rejected without changing their manifest.
- Releases without a manifest retain the existing strictly validated legacy
  migration path.

## Update compatibility

- Applications on Template 5.0.8 can update normally to 5.0.9.
- Existing-LXC installations already on infrastructure schema 3 require no
  infrastructure change for this patch.
- If `deployment:infrastructure:upgrade` previously failed because the active
  release still carried an infrastructure schema-2 manifest, update the
  application template and rerun the explicit upgrade command. The active
  release remains selected throughout the contract migration.
