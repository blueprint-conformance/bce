# Accelerated dogfooding

We do not substitute a busy afternoon for 30 elapsed days. We do compress the feedback loop by
running the entire cold-consumer journey repeatedly, in new temporary repositories, and retaining
every outcome in a commit-bound record.

```sh
npm run dogfood:soak -- --trials 20 --out evidence/dogfood/accelerated-soak.json
npm run dogfood:soak:check
```

Each trial installs the packed candidate, exercises the demo, authors and onboards a policy, observes
RED, verifies advisory behavior, fixes the repository to GREEN, verifies the evidence bundle, calls
all MCP tools, and installs the same candidate through an immutable Git snapshot. The runner does not
stop on the first failure. It records the exit code, duration, output digests, success markers, and a
sanitized diagnostic tail for failed attempts.

The evidence class is deliberately `author-operated-accelerated-soak`. It supports a claim about
repeated journey reliability on the recorded platform and commit. It does not support claims about
30-day stability, independent adoption, production use, or private-estate tenant behavior.

## Three-ring vision

1. **Honest Mirror:** this public repository performs and publishes the complete lifecycle it asks
   adopters to use. The accelerated soak is the first machine-derived reliability record.
2. **Continuous Proof Crucible:** PR, nightly, and release runs retain failures, exercise policy
   changes and recovery, and measure scoped outcomes rather than merely counting gate executions.
3. **Private consuming estate:** private repositories consume the exact public artifact. Only sanitized
   aggregate outcomes cross the boundary, and they count as public BCE dogfood only when bound to the
   public package version, package integrity, and source commit. Private doctrine, topology, tenant
   identifiers, and raw telemetry never cross it.

An independent operator remains a separate evidence class. Repetition by the authors cannot turn
itself into an independent witness.
