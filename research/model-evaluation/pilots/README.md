# Accelerated instrumentation pilots

These pilots debug the measurement system on development-exposed tasks. They are not a shortened
confirmatory study, cannot be pooled with it, and can never support an efficacy recommendation.
Every exposed attempt remains in its original denominator.

| Pilot | Frozen trials | Outcome | What it established |
|---|---:|---|---|
| [`accelerated-v1`](accelerated-v1/RESULTS.md) | 8/8 retained | All client launches failed | The real sealed-order controller, isolation canaries, external oracles, terminal ledger, verifier, analyzer, and public exporter operated. It exposed an overly broad home-directory read denial that also blocked the installed Codex artifact. |

Fix-forward rule: a controller defect found after exposure creates a new pilot identifier, new
inputs, new public pre-run seal, and new denominator. It never rewrites or retries the earlier
pilot.
