# Accelerated instrumentation pilot v2 result

Pilot v2 retained all eight frozen primary attempts. All eight Codex client sessions completed, but
none changed the task workspace, so the visible pipelines and hidden functional oracles failed in
both arms. The independent architecture oracle passed all eight unchanged trees and no policy
mutation was observed.

This is an apparatus failure, not product-efficacy evidence. Operator inspection of the restricted,
digest-committed transcripts found that Codex's inner `workspace-write` sandbox could not initialize
inside the controller's already active macOS sandbox (`sandbox_apply: Operation not permitted`). The
model could respond, but its file and command tools were unavailable. The public artifacts establish
the empty change inventories and failed task checks; the restricted transcript bytes are not
published.

| Measure | Baseline | BCE-enabled |
|---|---:|---:|
| Frozen primary attempts retained | 4/4 | 4/4 |
| Client status `completed` | 4/4 | 4/4 |
| Hidden functional success | 0/4 | 0/4 |
| Independent architecture conformance | 4/4 | 4/4 |
| Escaped architecture defect | 0/4 | 0/4 |
| Policy mutation | 0/4 | 0/4 |
| Observed BCE skill reads | n/a | 0/4 |
| Observed BCE MCP/gate calls | n/a | 0 |

The apparent 1.078 median BCE/baseline wall-time ratio is not interpretable as product friction:
neither arm could use tools, there are only four development-exposed pairs, and cost was unavailable.
Safe successful completion is also 0/4 in both arms because the task checks failed and the client
provided requested model configuration rather than provider-returned identity.

- Seal root: `f880a2e3742ae3bfd6f25e174fddd9e5d244747f4f7aa3d7dc807da3710db913`
- Public result digest: `e66be3c2ddfba870922933866e7e20bbf37a805a1a2c385f502dad5b28fff022`
- Public terminal denominator: 8/8
- Restricted transcript commitments: 8; transcript bytes published: no
- Product decision: `ineligible-instrumentation-pilot-no-efficacy-decision`

The only valid next step is fix-forward under a new pilot identifier and public pre-run seal, with
the outer controller profile remaining the confinement boundary and nested client sandboxing
disabled. V2 is never retried, pooled, or rewritten.
