# Accelerated instrumentation pilots

These pilots debug the measurement system on development-exposed tasks. They are not a shortened
confirmatory study, cannot be pooled with it, and can never support an efficacy recommendation.
Every exposed attempt remains in its original denominator.

| Pilot | Frozen trials | Outcome | What it established |
|---|---:|---|---|
| [`accelerated-v1`](accelerated-v1/RESULTS.md) | 8/8 retained | All client launches failed | The real sealed-order controller, isolation canaries, external oracles, terminal ledger, verifier, analyzer, and public exporter operated. It exposed an overly broad home-directory read denial that also blocked the installed Codex artifact. |
| [`accelerated-v2`](accelerated-v2/RESULTS.md) | 8/8 retained | Client sessions completed; 0/8 task success | The staged native client launched, but its inner `workspace-write` sandbox could not initialize inside the outer macOS sandbox. No task changed and no BCE mechanism use was observed. This is apparatus-failure evidence, not an arm comparison. |
| [`accelerated-v3`](accelerated-v3/RESULTS.md) | 8/8 retained | 4/4 task success in both arms | The full tool-capable apparatus completed, but easy development tasks saturated both arms and agent BCE engagement was weak. This validates machinery, not efficacy. |
| [`accelerated-v4`](accelerated-v4/RESULTS.md) | 6/24 prefix retained; 18 unexecuted | Safety-halted after six infrastructure errors; no analysis produced | The active model name and digest matched, but the runner incorrectly compared unequal `/api/tags` artifact and `/api/ps` active-size values. Restricted diagnostics also showed the client/model tool loop was not qualified. This is apparatus-failure evidence, not an arm comparison. |
| [`accelerated-v6`](accelerated-v6/RESULTS.md) | 16/16 retained | Directional signal: safe success 2/8 vs 3/8; ITT escapes 2/8 vs 0/8 | The public-safe, exact qualified local cell exercised BCE with ten verified gate calls and two red-to-green corrections. BCE conformed on 8/8 tasks, at a 1.317x paired median visible-time ratio. One baseline escape was a completed architectural defect and one was conservatively counted after an infrastructure timeout. This is claim-ineligible development evidence, not efficacy. |

Fix-forward rule: a controller defect found after exposure creates a new pilot identifier, new
inputs, new public pre-run seal, and new denominator. It never rewrites or retries the earlier
pilot.

An intervening local v5 candidate completed but was refused by the pre-push leakage gate. Its
sealed inputs and outcomes remain unpublished and immutable. V6 fixed forward with a new pilot ID,
new public-safe inputs, a separately qualified model cell, new tasks, and a new denominator.

V1 wording note: the retained evidence proves that each client invocation exited before any model
response or task change was observed. It cannot prove whether an upstream provider performed zero
inference, so the narrower observable statement is the governing interpretation.
