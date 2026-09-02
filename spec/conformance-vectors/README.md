# Conformance vectors

This directory is a **data artifact**: a set of `(blueprint, source tree) → expected verdict` vectors
that an implementation of the blueprint-conformance format can measure itself against. The data is the
contract; a **reference self-runner** ([`../../scripts/run-conformance-vectors.ts`](../../scripts/run-conformance-vectors.ts))
executes every vector against *this* engine on every push. There is deliberately **no neutral
certification runner and no conformance level at `v1alpha1`** — see "The claim, and the non-claim"
below.

## What a vector is

[`vectors.json`](vectors.json) holds a list of vectors. Each one pairs a **checked-in blueprint** with
a **checked-in source tree** and states the verdict and process exit code the reference engine must
produce over that pair:

| field | meaning |
|---|---|
| `id` | stable vector id |
| `intent` | one sentence: what this vector proves |
| `blueprintRef` / `blueprintFile` | the contract (`<id>@<version>`) and its path in this repo |
| `extractionProfile` | the profile the blueprint drives (`plugin-surface`, `next-route-handler`) |
| `tree` | the source tree the engine scans, a path in this repo |
| `extractor` | the extractor to run (`ast`) |
| `expectedVerdict` | `pass` or `fail` |
| `expectedExitCode` | `0` (proven green) or `1` (graded red) — see [`../../docs/exit-codes.md`](../../docs/exit-codes.md) |
| `constraintType` / `expectedSeverity` (red vectors) | the constraint class the red exercises, and the severity floor it must be caught at |

A **red** vector is a tree that plants a real architectural defect the engine must catch. A **green**
vector is a conformant tree that must pass with score 100 and no violations. Together they prove the
gate discriminates — a gate that cannot go red is not a gate.

## Coverage

The vectors are a curated, representative **subset** of the seeded-defect corpus
([`../../corpus/CORPUS-MAP.md`](../../corpus/CORPUS-MAP.md)), chosen to cover the enforced
constraint-type spread plus one clean control per blueprint:

- **red vectors** — one per enforced constraint type: `forbiddenDependency`, `requiredDependency`,
  `forbiddenEgress`, `forbiddenPath`, `forbiddenFile`, `forbiddenPattern`, `requiredComponent`,
  `behavioralInvariant`.
- **green vectors** — one conformant control per shipped blueprint.

The full corpus (all 34 seeded defects + the 13-fixture clean control set) is the recall denominator
and is exercised exhaustively by `tests/recall-e2e-proof.test.ts`. These vectors are the *portable,
human-and-machine-legible extract* of that same ground truth.

The three constraint types that are declared-but-not-yet-enforced by the grader
(`requiredEvidence`, `minimumMetric`, `customPolicy`) are deliberately **not** represented as red
vectors — the engine reports them INDETERMINATE, not toothed, and a vector claiming a red for them
would be dishonest. When they become enforced, red vectors for them are added here under an RFC (see
[`../../rfcs/RFC-0001-process.md`](../../rfcs/RFC-0001-process.md)).

## External implementation intake

[`vector-set.json`](vector-set.json) freezes the SHA-256 of `vectors.json` and records zero accepted
external implementations today. A separately maintained implementation may submit a report conforming
to [`implementation-report.schema.json`](implementation-report.schema.json) through the repository's
external-implementation issue form. `node scripts/verify-external-implementation-report.mjs
REPORT.json` checks the frozen digest, complete vector coverage, exact verdicts and exits, unique
IDs, and rejects this repository as its own “external” implementation. Passing that mechanical check
is review input, not automatic certification; maintainer independence and linked public execution
still require adjudication.

## The claim, and the non-claim

> **Claim:** running the reference engine over each vector's `(blueprint, tree)` pair in this
> repository yields the stated `expectedVerdict` and `expectedExitCode`. This is not asserted on trust
> — it is **re-executed on every push**, twice over: the self-runner
> (`scripts/run-conformance-vectors.ts`, its own named `ci` step and
> `tests/conformance-vectors.test.ts`) drives the real CLI over every vector and checks real process
> exit codes; and the full corpus these vectors are drawn from is re-run by the "Measured-recall
> corpus run" step.

> **Non-claim:** these vectors are **not** a certification suite and confer **no conformance level**,
> and the self-runner is **not** a neutral certification runner — it proves only that *this* engine
> honors its own vectors. Numbered conformance levels (L0/L1/L2), a neutral runner, and
> self-certification listings are milestone-gated on the existence of at least one external
> implementation of the format — see [`../../GOVERNANCE.md`](../../GOVERNANCE.md). At `v1alpha1` this
> directory is exactly what it says: input→expected-verdict data, with stated intent, plus the
> executable recipe for running one engine (this one) against it.

## Run every vector (the self-runner)

From a checkout with dev dependencies installed:

```bash
npm ci
npx tsx scripts/run-conformance-vectors.ts          # per-vector PASS/FAIL + summary, exit 1 on any failure
npx tsx scripts/run-conformance-vectors.ts --json   # the same assessments as JSON
```

For each vector the runner spawns the real CLI:

```
bce run --blueprint <blueprintFile> --ct-repo <tree> --extractor <extractor> --no-pin \
        [--observations <tree>/observations.json]
```

and checks: (1) the **real process exit code** equals `expectedExitCode`; (2) the emitted
report's `verdict` equals `expectedVerdict`; (3) a green vector scored 100 with zero violations;
(4) a red vector's report names the vector's `constraintId` at or above `expectedSeverity` — a
coincidental red on some *other* constraint does not count as a catch.

Two execution-contract details an external implementation should mirror:

- **`--no-pin`** — each vector's `tree` is a checked-in fixture directory scanned in place, not a
  git revision of its own.
- **`observations.json`** — a tree carrying `observations.json` at its root is a *runtime-evidence*
  pair: the recorded probe artifact is part of the vector's input, because `behavioralInvariant`
  constraints are graded from observations, not static AST. Static-only engines cannot pass the
  `behavioralInvariant` red vector and should say so rather than skip it silently.

## Reproduce a vector

Pick any vector and run the reference engine over its pair (from a built checkout):

```bash
npm ci && npm run build

# a GREEN vector: conformant tree passes (exit 0)
BPD="$(mktemp -d)"; cp fixtures/luna-chat-extension.blueprint.json "$BPD/"
node dist/cli.js gate --repo fixtures/extension-surface/conformant \
  --blueprint-dir "$BPD" --extractor ast          # score 100 (pass), exit 0

# a RED vector: drifted tree fails, naming the violation (exit 1)
node dist/cli.js gate --repo fixtures/extension-surface/drift-forbidden-import \
  --blueprint-dir "$BPD" --extractor ast --all     # FAILED, exit 1
```

Every vector's `blueprintFile` and `tree` are real paths in this repository. One caveat: the
`gate` verb grades **static** constraints only — the `behavioralInvariant` vectors
(`vec-red-bhv-constant-function`, `vec-green-served-behavior`) reproduce via `bce run` with the
tree's recorded observations, which is exactly what the self-runner does:

```bash
node dist/cli.js run --blueprint fixtures/served-behavior.blueprint.json \
  --ct-repo fixtures/behavior-surface/drift-constant-output --extractor ast --no-pin \
  --observations fixtures/behavior-surface/drift-constant-output/observations.json   # FAILED, exit 1
```
