# Accelerated instrumentation pilot v3 result

Pilot v3 retained all eight frozen primary attempts and completed the full apparatus path. Both arms
achieved 4/4 hidden functional success, 4/4 independent architecture conformance, zero escaped
architecture defects, and zero policy mutations. The controller-run BCE gate accepted all four
BCE-arm outputs.

| Measure | Baseline | BCE-enabled |
|---|---:|---:|
| Frozen primary attempts retained | 4/4 | 4/4 |
| Client status `completed` | 4/4 | 4/4 |
| Hidden functional success | 4/4 | 4/4 |
| Independent architecture conformance | 4/4 | 4/4 |
| Escaped architecture defect | 0/4 | 0/4 |
| Policy mutation | 0/4 | 0/4 |
| Median visible wall time | 21,340.5 ms | 22,895.5 ms |
| Observed agent BCE skill reads | n/a | 0/4 |
| Observed agent MCP calls | n/a | 0 |
| Observed agent BCE gate calls | n/a | 1 |

This validates the execution machinery, not BCE efficacy. The four development-exposed tasks were
too easy to separate the arms: every task passed in both. The observed paired wall-time ratio was
1.048 (BCE/baseline), but four pairs across two generated repositories cannot establish a stable
latency effect, and the client exposed no trustworthy dollar cost. BCE treatment engagement was
also weak: no skill read or MCP call was observed, and only one model-initiated BCE gate call was
seen. The mandatory controller-run BCE gate is an outcome surface, not evidence that the agent used
BCE while solving.

Safe successful completion remains 0/4 in both arms solely because the client provides requested
model configuration rather than provider-returned identity; the protocol deliberately refuses to
award identity credit. No product recommendation or causal uplift estimate is eligible from this
pilot.

- Seal root: `80212eec037763245804a8722f32f1d34ad1cff49bb7ec8475cb5e3def2e9d73`
- Public result digest: `75fc025b00a7b75c65637149bfba3f988ceb825f20f03603a69701b62302b87f`
- Public terminal denominator: 8/8
- Restricted transcript commitments: 8; transcript bytes published: no
- Product decision: `ineligible-instrumentation-pilot-no-efficacy-decision`

The honest next step is the still-unready confirmatory study: held-out tasks with enough architecture
hazard to avoid ceiling effects, exact provider-returned model identities, trustworthy cost capture,
the frozen 240-trial matrix, and later independent replication. V3 may inform that apparatus design
but is permanently excluded from its efficacy denominator.
