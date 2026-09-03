# Accelerated instrumentation pilots

These pilots debug the measurement system on development-exposed tasks. They are not a shortened
confirmatory study, cannot be pooled with it, and can never support an efficacy recommendation.
Every exposed attempt remains in its original denominator.

| Pilot | Frozen trials | Outcome | What it established |
|---|---:|---|---|
| [`accelerated-v1`](accelerated-v1/RESULTS.md) | 8/8 retained | All client launches failed | The real sealed-order controller, isolation canaries, external oracles, terminal ledger, verifier, analyzer, and public exporter operated. It exposed an overly broad home-directory read denial that also blocked the installed Codex artifact. |
| `accelerated-v2` | 8 inputs generated; unsealed | Not run | Fix-forward candidate: freezes and stages native Codex plus standalone Node, uses read-default-deny isolation, positively probes the generated BCE MCP path without model exposure, and installs BCE from a sealed offline dependency closure. |

Fix-forward rule: a controller defect found after exposure creates a new pilot identifier, new
inputs, new public pre-run seal, and new denominator. It never rewrites or retries the earlier
pilot.

V1 wording note: the retained evidence proves that each client invocation exited before any model
response or task change was observed. It cannot prove whether an upstream provider performed zero
inference, so the narrower observable statement is the governing interpretation.
