# CORPUS-MAP — the shipped corpus (v3) and its mapping to the frozen paper corpus

This document explains what the seeded-defect corpus shipped in this repository **is**, how it
relates to the corpus cited by the accompanying research paper, and exactly which claim the
mapping supports.

## What ships here (corpus v3)

The corpus has three parts, all in this repository and all exercised in CI:

| Part | Where | Role |
|---|---|---|
| Seeded-defect registry | `src/corpus.ts` (`SEEDED_CORPUS`) | 34 planted architecture defects — the recall denominator |
| Fixture trees | `fixtures/` (extension, egress, route, behavior surfaces) | Real source trees the engine scans; each seeded defect is planted in exactly one |
| Machine-readable index | `corpus/MANIFEST.json` | defect ids ↔ fixtures ↔ constraint types ↔ expected verdicts, plus the clean control set |

`corpus/MANIFEST.json` is drift-gated: `tests/corpus-manifest.test.ts` fails CI if the manifest
and the live registry/blueprints ever disagree, so the index can be consumed as ground truth.

## Relationship to the paper corpus

The research paper's recall measurements were produced against a **byte-frozen** corpus that is
preserved, unmodified, in the public `bce-paper-artifacts` repository, archived with a
citable DOI (https://doi.org/DOI_PENDING_DO_NOT_SHIP). That frozen corpus was authored inside a
private engineering estate and therefore carries internal identifiers that cannot be published;
see `EXCLUSIONS.md` there for what was withheld and why.

**suite-v2** is the *genericized reproduction* of that corpus — defect-map rows 1–25 below.
The shipped corpus is **v3**: suite-v2 plus nine append-only defects (rows 26–34) that
postdate the paper and therefore have **no frozen counterpart**; the paper mapping in this
section is about rows 1–25 only.

**Identical — the stable join keys (suite-v2 rows 1–25):**

- defect `id`s (all 25 suite-v2 ids),
- `constraintId`s and their constraint **types**,
- `expectedSeverity` floors and expected fixture **verdicts**,
- fixture directory names and the planted defect *shapes* (the code constructs the engine must
  catch — decoy registrations, options-bag egress, template-literal imports, missing guards, …),
- the measurement protocol itself (`caughtDefect`, `measureRecall`, `gateVerdict` and their
  thresholds).

**Different — the genericization:**

- package, namespace, profile, and host identifiers were renamed to the public identity
  (neutral `example-org`/`example.com`-style names),
- prose descriptions and code comments were re-phrased; internal provenance annotations
  (incident ids, internal design-document references, estate telemetry) were removed,
- files that never belonged to the open engine were excluded at the transplant boundary.

## The claim (and the claim we deliberately do not make)

> **Claim:** the measured-recall *protocol* reproduces on your machine: running the engine in
> this repository over the corpus in this repository yields **recall 1.0 (34/34) with zero
> cried-wolf false positives over 45 reports** (32 distinct seeded fixture runs + 13 clean
> control runs), and the gate passes at its default thresholds.

> **Non-claim:** we do **not** claim the files here are byte-identical to the paper's cited
> artifact. They are not, by construction — publishing required genericization. The byte-frozen
> originals remain in `bce-paper-artifacts`; a verdict-parity re-run (same defect ids, same
> verdicts, public engine vs. frozen corpus) is maintained there alongside the originals.

## Reproduce it

```bash
npm ci
npx vitest run tests/recall-e2e-proof.test.ts tests/corpus.test.ts tests/corpus-manifest.test.ts
```

`tests/recall-e2e-proof.test.ts` is the protocol, executable: it runs the REAL extractor +
evaluator over every fixture (nothing mocked), asserts every seeded defect is caught at/above its
severity floor, asserts every clean fixture scores zero violations, and includes the two
**honest-fail** cases — a single stripped catch yields a named miss with recall < 1, and a
whole lost tooth drops recall below the floor and FAILS the gate (the gate is not a
rubber-stamp).

## Defect map

Set legend: **P** = original baseline (the 9 defects of the pre-suite-v2 corpus, in registry
order). **The paper's cited recall measurement is over rows 1–25 (N=25), not these 9** — see
`counts.paperFrozenCorpus` in [`MANIFEST.json`](MANIFEST.json). The earlier wording here said the
paper's measurements "were built on" the 9, which contradicted this file's own line 27
("suite-v2 is the genericized reproduction of that corpus — defect-map rows 1–25") and, read
beside the paper's N=25, made the corpus look inflated 2.8×. The paper is correct; this legend
was not, **E** = expansion (append-only growth, same protocol — suite-v2 took the
corpus to N=25; corpus v3 to N=34; see [`TAXONOMY.md`](TAXONOMY.md) for the v3 coverage audit).

| # | Defect id | Set | Blueprint | Constraint type | Severity | Fixture |
|---|---|---|---|---|---|---|
| 1 | `ext-direct-openai-import` | P | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-forbidden-import` |
| 2 | `ext-reexport-openai` | P | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-reexport` |
| 3 | `ext-dynamic-import-openai` | P | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-dynamic-import` |
| 4 | `ext-ungoverned-registration` | P | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-no-register` |
| 5 | `ext-shadowed-harness-decoy` | P | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-shadow-harness` |
| 6 | `ext-decoy-registration` | P | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-decoy-register` |
| 7 | `ext-ungoverned-egress-provider` | P | `egress-reader@0.1.0` | forbiddenEgress | critical | `fixtures/egress-surface/drift-egress-provider-houseidiom` |
| 8 | `ext-ungoverned-egress-optbag` | P | `egress-reader@0.1.0` | forbiddenEgress | critical | `fixtures/egress-surface/drift-egress-optbag` |
| 9 | `ext-ungoverned-egress-undici-client` | P | `egress-reader@0.1.0` | forbiddenEgress | critical | `fixtures/egress-surface/drift-egress-undici-client` |
| 10 | `rg-missing-tenant-guard` | E | `route-guard@0.1.0` | requiredDependency | critical | `fixtures/route-surface/drift-missing-guard` |
| 11 | `rg-unguarded-new-route` | E | `route-guard@0.1.0` | requiredDependency | critical | `fixtures/route-surface/drift-unguarded-new-route` |
| 12 | `rg-decoy-guard-object` | E | `route-guard@0.1.0` | requiredDependency | critical | `fixtures/route-surface/drift-decoy-guard` |
| 13 | `rg-legacy-route-path` | E | `route-guard@0.1.0` | forbiddenPath | high | `fixtures/route-surface/drift-legacy-route` |
| 14 | `rg-shadow-provisioner-file` | E | `route-guard@0.1.0` | forbiddenFile | high | `fixtures/route-surface/drift-shadow-provisioner` |
| 15 | `rg-mocked-metric-pattern` | E | `route-guard@0.1.0` | forbiddenPattern | high | `fixtures/route-surface/drift-mock-metric` |
| 16 | `ext-unrecognizable-factory` | E | `luna-chat-extension@0.1.0` | requiredComponent | high | `fixtures/extension-surface/drift-unrecognized-factory` |
| 17 | `ext-unrecognizable-forbidden-import` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-unrecognized-factory` |
| 18 | `ext-unrecognizable-zero-targets` | E | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-unrecognized-factory` |
| 19 | `bhv-constant-function` | E | `served-behavior@0.1.0` | behavioralInvariant | critical | `fixtures/behavior-surface/drift-constant-output` |
| 20 | `bhv-oracle-violation` | E | `served-behavior@0.1.0` | behavioralInvariant | critical | `fixtures/behavior-surface/drift-oracle-violation` |
| 21 | `ext-require-openai` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-require` |
| 22 | `ext-require-template-openai` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-require-template` |
| 23 | `ext-dynamic-template-openai` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-dynamic-template` |
| 24 | `ext-stray-register` | E | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-stray-register` |
| 25 | `ext-ungoverned-registry-import` | E | `luna-chat-extension@0.1.0` | requiredDependency | critical | `fixtures/extension-surface/drift-ungoverned-import` |
| 26 | `py-direct-openai-import` | E | `python-service@0.1.0` | forbiddenDependency | critical | `fixtures/python-surface/drift-forbidden-import` |
| 27 | `py-committed-secrets-module` | E | `python-service@0.1.0` | forbiddenFile | high | `fixtures/python-surface/drift-secrets-file` |
| 28 | `py-hardcoded-provider-key` | E | `python-service@0.1.0` | forbiddenPattern | high | `fixtures/python-surface/drift-hardcoded-key` |
| 29 | `ext-import-equals-openai` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-import-equals` |
| 30 | `ext-subpath-openai-import` | E | `luna-chat-extension@0.1.0` | forbiddenDependency | critical | `fixtures/extension-surface/drift-subpath-import` |
| 31 | `ext-ungoverned-egress-new-url` | E | `egress-reader@0.1.0` | forbiddenEgress | critical | `fixtures/egress-surface/drift-egress-new-url` |
| 32 | `ext-ungoverned-egress-globalthis` | E | `egress-reader@0.1.0` | forbiddenEgress | critical | `fixtures/egress-surface/drift-egress-globalthis` |
| 33 | `py-aliased-openai-import` | E | `python-service@0.1.0` | forbiddenDependency | critical | `fixtures/python-surface/drift-aliased-import` |
| 34 | `py-paren-from-import` | E | `python-service@0.1.0` | forbiddenDependency | critical | `fixtures/python-surface/drift-paren-from-import` |

Rows 16–18 are the deliberate **tri-seed**: one fixture (`drift-unrecognized-factory`) plants one
defect with three seeded consequences; the recall run executes each distinct fixture once (32
runs), which is why the false-positive denominator is 45, not 47.

The 13-fixture **clean control set** (zero seeded defects; any violation on them is a
cried-wolf false positive) is enumerated in `corpus/MANIFEST.json` under `cleanFixtures` and
asserted violation-free, itemized per fixture, in `tests/recall-e2e-proof.test.ts`.
