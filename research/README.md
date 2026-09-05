# BCE research workspace

Status: **evaluation infrastructure plus completed development-only pilots; no claim-bearing
held-out efficacy study has been run**.

This directory separates product tests from publishable empirical evidence. Development fixtures
may be used to debug the harness but never to estimate held-out performance. Before looking at a
held-out corpus, freeze the preregistration, populate and checksum the held-out manifest, obtain two
independent annotations with exact locations, and record exclusions. Analyze every attempted case;
unsupported cases remain a reported outcome rather than disappearing from the denominator story.

The analysis API reports TP/FP/FN/TN, precision, recall, specificity, false violations per supported
opportunity, collateral violations, Wilson 95% intervals, and per-defect-class results. This is not
evidence that BCE improves agents. That claim requires the not-yet-run multi-repository controlled
study described in `study-preregistration.json`.

The canonical controlled-study contract is `model-evaluation/protocol.v2.json` plus its closed task
manifest, treatment-delta, protected-path, terminal-record, and seal schemas. It defines 600 paired
attempts across one primary and three transportability client/model cells. Its real repositories,
tasks, client artifacts, provider-returned model identities, and public Sigstore preseal are
deliberately unset. `npm run research:model-eval-readiness` therefore refuses; that is the correct
state before claim-bearing inputs exist.

Accelerated v6 is directional instrumentation evidence, not product-efficacy evidence. It retained
16/16 paired attempts across four generated repositories in one exact local qwen3:8b client/model
cell. The public export binds the frozen inputs, model/client identity, terminal ledger, machine
oracles, and aggregate result; `npm run evidence:verify` replays those bindings. Because the author
selected the tasks and wrote the oracles, the result cannot establish generalization, default
adoption, cost benefit, transportability, or independent replication. See
`model-evaluation/pilots/accelerated-v6/RESULTS.md`.

`model-evaluation/pilots/accelerated-v1/` is a separate eight-attempt, development-exposed
instrumentation pilot. It exists to exercise the real ordered controller, OS isolation, independent
oracles, crash recovery, append-only terminal ledger, offline analysis, and safe public export. Its
schema permanently makes any efficacy decision ineligible. A green pilot proves the measurement
machinery operated; it cannot show that BCE improves success, defects, cost, latency, or resistance
to policy manipulation. V1 retained 8/8 failed client launches and exposed that the sandbox also
blocked the installed Codex artifact. See `model-evaluation/pilots/accelerated-v1/RESULTS.md`; the
failure is not retried or erased.
