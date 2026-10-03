# Experimental compiler readiness slice

BCE now routes `forbiddenDependency` through a pure policy-and-evidence compiler inside the existing
`evaluate()` path. The CLI, gate and MCP continue to consume the existing evaluator and report formats.
This is one migrated constraint family, not a completed compiler platform or a new normative schema.
Application source is never rewritten.

## Use the experimental API

After `npm run build`, the package exports `compileBlueprint`, `verifyCompilerProof`,
`COMPILER_IR_VERSION` and the typed IR contracts. Supply an already acquired blueprint and architecture
graph. `compileBlueprint(blueprint, graph)` resolves the blueprint's declared extraction profile;
an explicit contradictory profile refuses. Acquisition remains the existing extractor's responsibility.

```ts
import { compileBlueprint, verifyCompilerProof } from 'bce-engine';

const result = compileBlueprint(blueprint, graph);
if (result.status === 'compiled') {
  console.log(result.verdict.verdict);
  console.log(verifyCompilerProof(result));
}
```

The experimental API validates current authored inputs. `status: 'compiled'` means the pipeline ran;
it does not mean the verdict passed. Deferred constraint families and unavailable capabilities yield
`verdict: 'refused'`. Unknown versions and malformed source produce `status: 'refused'` before passes.
No provider acquisition, filesystem access, network, subprocess, environment read, clock or randomness
occurs in compiler passes. SHA-256 hashing uses `node:crypto`.

The existing `evaluate()` API retains its historical tolerant supplied-object contract. Its internal
compatibility frontend uses the same lowering and predicate evaluator while preserving legacy profile
selection, skipped families, violation strings, ordering, score, optional omissions and graph hashes.
It does not inherit the stricter experimental frontend's new authoring refusals.

## Contracts and ownership

All new IRs use `experimental-1`. They are implementation contracts pending wider compatibility proof,
not published JSON schemas or a ratified policy language.

| Contract | Current owner and retained information |
|---|---|
| `PolicySourceAST` | Snapshot of the complete authored object, constraint JSON pointers, and optional exact JSON text; supplied text must parse to the same object |
| `PolicyIR` | Original constraint arms, derived evidence plane, dependency selectors and recorded normalization defaults; deferred semantics remain explicit |
| `FactIR` | Separate static graph, encoded observation nodes, optional full supplied observation envelope, and optional declared-stack manifest/facts/refusals |
| `EvaluationPlanIR` | Bounded `NoEdge` predicates, explicit profile mode, required capabilities, source maps and refusals |
| `VerdictIR` | Constraint outcomes, violation versus located uncertainty, source-linked diagnostics and refusals |
| `ProofIR` | Layer digests, deterministic pass receipts and diagnostic links; verification replays the same compiler over retained inputs |

Object adapters cannot reconstruct original JSON whitespace. `sourceText`, when supplied, retains
those exact bytes. Snapshot objects are recursively frozen without freezing caller-owned inputs.
The experimental frontend accepts finite plain JSON artifacts and rejects cycles, exotic objects,
accessors and unsafe `__proto__` keys; these cannot receive misleading canonical integrity claims.
Supplemental observation and declared-stack envelopes are retained without revalidation or evaluation;
they do not establish runtime efficacy, publisher identity or independent origin authenticity.

The fixed typed pipeline validates supported pass versions, unique identities, present schemas,
dependency existence, cycles and execution order before running. Each receipt hashes its immutable
input snapshot before execution and its output afterward. Predicate capability checks happen during
lowering; pass descriptor capability lists are empty because the pure transformations themselves do
not acquire evidence. There is no extensible provider loader or cache in this slice.

## Constraint inventory

The [current schema](../src/schema.ts) owns authored constraint types and evidence-plane classification.
The [current evaluator](../src/report.ts) and [prepared stack dispatcher](../src/stack/stack-evaluation.ts)
retain every unmigrated semantic. The new compiler records them as deferred and refuses a whole-policy
pass when they are present.

| Family | Evidence plane | Production semantic owner | Representative existing test |
|---|---|---|---|
| `forbiddenDependency` | staticAst | `compiler/dependency.ts`, consumed by `evaluate()` | `forbidden-dependency-scope.test.ts`, module graph tests |
| `requiredDependency` | staticAst | `report.ts` | `typescript-module-graph.test.ts`, `python-module-graph.test.ts` |
| `requiredComponent` | staticAst | `report.ts` | `gate-honesty.test.ts` |
| `forbiddenPath` | staticAst | `report.ts` | `determinism-property.test.ts` |
| `forbiddenFile` | staticAst | `report.ts`; missing scanned-file set remains skipped | `forbidden-file.test.ts` |
| `forbiddenEgress` | staticAst | `report.ts`, detector remains acquisition | `forbidden-egress.test.ts` |
| `requiredEvidence` | staticAst | Declared, not implemented by `report.ts` | `gate-honesty.test.ts` |
| `minimumMetric` | staticAst | Declared, not implemented by `report.ts` | `gate-honesty.test.ts` |
| `customPolicy` | staticAst | Declared, not implemented by `report.ts` | `gate-honesty.test.ts` |
| `behavioralInvariant` | behaviorObservation | `report.ts`; acquisition/binding in `observations.ts` | `observations-merge.test.ts` |
| `forbiddenPattern` | staticAst | `report.ts`; missing pattern scan remains skipped | `forbidden-pattern.test.ts` |
| `pinnedVersion` | declaredStack | `stack/stack-evaluation.ts` | declared-stack tests |
| `stackClosureMatch` | declaredStack | `stack/stack-evaluation.ts` | declared-stack tests |
| `forbiddenStackPackage` | declaredStack | `stack/stack-evaluation.ts` | declared-stack tests |
| `requirePinnedImages` | declaredStack | `stack/stack-evaluation.ts` | declared-stack tests |
| `allowedNodeVersions` | declaredStack | `stack/stack-evaluation.ts` | declared-stack tests |

All five current profiles remain acquisition-owned: `next-route-handler`, `plugin-surface`,
`typescript-module-graph`, `python-import-surface` and `python-module-graph`. This migration preserves
their existing `forbiddenDependency` semantics; it does not expand provider capabilities.

Other boundary owners remain unchanged: `schema.ts` validates policy; `extractor-registry.ts` selects
providers; `portfolio-compile.ts` creates overlays; `report.ts` aggregates and renders existing reports;
`evidence-bundle.ts` and `emit.ts` own existing artifact hashes and evidence chains; `gate.ts` owns gate
posture and exits. No new compiler stage acquires or ratifies policy.

## Discriminating behavior and compatibility

Module profiles require at least one source component in the authored scope, match direct `imports`
edges and preserve every relevant unresolved import. A known forbidden import is `fail`; unresolved
imports alone are `indeterminate` internally and retain the existing public report's exact fail-closed
violation and `fail` verdict. Framework/import-surface profiles preserve matching of every edge kind,
the `file:` catch-all, and optional scope narrowing by the evidence path.

The strict experimental adapter refuses module graphs claiming line-scan extraction and refuses an
empty zero-files scan rather than treating unobserved absence as a pass. Callers may narrow reported
capabilities using `options.capabilities`; a missing required capability refuses before evaluation.
It also honors the authored minimum engine version and minimum scanned-file count. The pure reader
version is checked against the package version by a sync test; no filesystem lookup occurs in passes.
The graph's existing coverage limits remain visible. These capabilities describe supplied evidence
shape and supported provider class, not independently authenticated acquisition.

Existing blueprint, graph, report, bundle and rendering versions are unchanged. New proof artifacts
are separate. `verifyCompilerProof` rejects tampered layers, receipts, diagnostic pointers and malformed
payloads by deterministic replay. It proves internal integrity against this implementation, not a
second implementation, an independent witness, complete acquisition or authenticated provenance.

The [compiler tests](../tests/compiler-vertical-slice.test.ts) exercise real extraction for conformant,
forbidden and unresolved imports; capability and version refusals; source/profile contradictions;
lossless sidecars; immutable snapshots; deterministic replay; corrupted links; and pass-DAG negatives.
The full existing suite, vectors, self-gate and extractor-real teeth remain required compatibility checks.

The current self-blueprint predates `src/compiler/` and its scoped purity patterns do not cover that
directory. The slice therefore includes a separate import-closure/purity regression test and requires
independent source review. A future blueprint amendment requires its normal separate review; a green
self-gate alone does not establish those new files' per-file purity coverage.

Deferred work includes remaining constraint migrations, generic algebra composition, public IR schema
ratification, independent verifier implementation, cross-platform reproduction, incremental caches,
provider sandboxing and external adoption evidence. None is claimed complete by this slice.
