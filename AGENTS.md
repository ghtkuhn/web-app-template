# Template Agent Entry

You must read and follow `AGENTS-DEFAULT.md`.

You must communicate tersely. Do not repeat the task or narrate routine work.
Progress updates must be at most one short sentence. Final responses must
contain only the result, verification status, and genuine blockers.

Little Coder must be started with `npm run little-coder -- [arguments]`.
Its backend lint gate must not be bypassed, disabled, or weakened.
Little Coder must repair only the active backend lint cause, run the focused
check before another mutation, and stop after two ineffective attempts.
It must not use casts, widened contracts, permissive assertions, placeholders,
or unrelated refactors to silence a finding.
