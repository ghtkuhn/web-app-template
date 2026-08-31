# Template 5.0.8

## Fixed

- The frontend box-spacing linter now accepts CSS platform environment values
  such as `env(safe-area-inset-bottom, 0px)` for margin, padding, gap, and
  scroll-spacing properties.
- CSS environment values work directly, through shared custom properties, and
  inside supported math functions such as `max()`.
- An `env()` fallback must still satisfy the existing px, percent, or unitless
  zero spacing contract. Malformed environment references remain rejected.
- The rem-only `font-size` contract remains unchanged and does not accept
  `env()` values.

## Update compatibility

- Unmodified Template 5.x applications receive the fix through the normal
  template update without an application or infrastructure migration.
- Applications with local changes to the frontend style linter must merge the
  incoming environment-value validation and updated tutorial guidance.
