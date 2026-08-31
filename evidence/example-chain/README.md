# evidence/example-chain — a real, committed evidence chain

Three `EvidenceRecord`s produced by **actual `bce run --emit` invocations** of the
HEAD engine over this repository's own self-blueprint
(`.blueprints/engine.blueprint.json`), chained genesis → 001 → 002 → 003 via
`--prev-hash`. Nothing here is hand-written: every byte of the three records came
out of the CLI. The full format contract is `docs/evidence-format.md`.

## How this chain was produced (exact commands)

All three runs graded the repository pinned at revision
`7ce50b4da45db8ca28f9a195e80a863e56735b19` (the commit that was `HEAD` at
generation time — visible in each record's `ctRepoRevision`).

```bash
npm run build

# record 001 — genesis run (no --prev-hash → previousHash is the 64-zero sentinel)
node dist/cli.js run --blueprint .blueprints/engine.blueprint.json --ct-repo . \
  --out /tmp/report-1.json --emit \
  --emit-evidence-out evidence/example-chain/record-001.json --emit-wo-out /tmp/wo-1.json

# record 002 — chained onto record 001's hash
node dist/cli.js run --blueprint .blueprints/engine.blueprint.json --ct-repo . \
  --out /tmp/report-2.json --emit --prev-hash <hash of record-001> \
  --emit-evidence-out evidence/example-chain/record-002.json --emit-wo-out /tmp/wo-2.json

# record 003 — chained onto record 002's hash
node dist/cli.js run --blueprint .blueprints/engine.blueprint.json --ct-repo . \
  --out /tmp/report-3.json --emit --prev-hash <hash of record-002> \
  --emit-evidence-out evidence/example-chain/record-003.json --emit-wo-out /tmp/wo-3.json
```

The three runs share one revision and one report, so the record BODIES differ
only in `previousHash` — which is exactly why their hashes (and ids) all differ.
That is the chaining property in its purest visible form.

## Verify it yourself (node alone, zero dependencies)

```bash
node tools/verify-chain.mjs evidence/example-chain
```

Recorded transcript, intact chain (exit 0):

```text
OK    record-001.json  bce-engine-architecture@0.1.0 @ 7ce50b4da45d  score 100 (pass)  00000000… -> 5f43bd16…
OK    record-002.json  bce-engine-architecture@0.1.0 @ 7ce50b4da45d  score 100 (pass)  5f43bd16… -> d713c2c3…
OK    record-003.json  bce-engine-architecture@0.1.0 @ 7ce50b4da45d  score 100 (pass)  d713c2c3… -> 00acb720…
verify-chain: CHAIN INTACT — 3 record(s), genesis -> 00acb720b19f4ae6…
```

Recorded transcript, tampered copy — `record-002.json` edited to
`score: 42, verdict: "fail"` with the stored hash left in place (exit 1):

```text
OK    record-001.json  bce-engine-architecture@0.1.0 @ 7ce50b4da45d  score 100 (pass)  00000000… -> 5f43bd16…
FAIL  record-002.json
      hash does not re-derive: stored d713c2c3793d7ce7…, derived 3da74bba2ed2d5a9… (a hashed field was edited)
verify-chain: CHAIN BROKEN
```

Recorded transcript, excised copy — `record-002.json` silently deleted (exit 1):

```text
OK    record-001.json  bce-engine-architecture@0.1.0 @ 7ce50b4da45d  score 100 (pass)  00000000… -> 5f43bd16…
FAIL  record-003.json
      previousHash d713c2c3793d7ce7… does not match the prior record's hash 5f43bd16dade5a64…
verify-chain: CHAIN BROKEN
```

Both refusals are regression-locked by `tests/verify-chain-tool.test.ts`.

## Notes

- This directory must contain ONLY record JSONs (plus this README): the verifier
  treats every `*.json` file in the directory, sorted by filename, as the claimed
  chain order, and fail-closes on any non-record JSON.
- The chain is a **historical artifact**: it is bound to the revision it graded.
  Re-running the commands at a later commit produces a different, equally valid
  chain (different `ctRepoRevision` → different report → different hashes). Do
  not "refresh" these files in place — grow the chain by appending, or start a
  new chain, per `docs/evidence-format.md`.
