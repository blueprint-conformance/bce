# BCE research workspace

Status: **infrastructure only; no held-out experiment or comparative study has been run**.

This directory separates product tests from publishable empirical evidence. Development fixtures
may be used to debug the harness but never to estimate held-out performance. Before looking at a
held-out corpus, freeze the preregistration, populate and checksum the held-out manifest, obtain two
independent annotations with exact locations, and record exclusions. Analyze every attempted case;
unsupported cases remain a reported outcome rather than disappearing from the denominator story.

The analysis API reports TP/FP/FN/TN, precision, recall, specificity, false violations per supported
opportunity, collateral violations, Wilson 95% intervals, and per-defect-class results. This is not
evidence that BCE improves agents. That claim requires the not-yet-run multi-repository controlled
study described in `study-preregistration.json`.

The cross-harness real-model protocol is frozen separately in
`model-evaluation-preregistration.json`. It requires baseline/BCE arms and at least 30 trials per arm
for each of Codex, Claude, Cursor, and a generic Agent Skills harness. Exact client binaries, model
snapshots, isolated homes, disabled shared caches, a sealed randomized task manifest, failures,
tokens, latency, cost, MCP selection, and policy mutation are all part of the denominator. Run
`npm run research:model-eval-readiness`: it currently refuses because those expensive external inputs
have not been frozen, and a refusal is the correct result before executing any trial. Seal the task
manifest by hashing its compact JSON serialization with `manifestSha256` set to `null`, then store
the result as `sha256:<hex>`. Readiness and analysis recompute that value and refuse post-seal edits.
