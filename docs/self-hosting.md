# Self-hosting: the engine gates its own tree

`bce` grades repositories against an authored `EngineeringBlueprint`. This repository is
itself a repository — so it carries its own blueprint
([`.blueprints/engine.blueprint.json`](../.blueprints/engine.blueprint.json)) and CI runs
the engine over the engine on every push and pull request
([`.github/workflows/self-gate.yml`](../.github/workflows/self-gate.yml)).

Self-hosting is not a stunt. It is the cheapest continuous proof that:

1. the engine's authored-artifact path (schema → extraction → evaluate → score → verdict)
   works end-to-end on a real, non-trivial TypeScript repository;
2. the engine's own architecture cannot silently drift — the same fail-closed gate its
   users get is the gate its maintainers live under;
3. dogfooding surfaces real engine gaps (see the `teeth` scopePaths fix below, found the
   first time the engine assessed its own blueprint).

## The architecture this blueprint enforces

Every constraint below was verified against the code **before** being authored — the
blueprint records the real architecture, not an aspiration.

| Claim | Constraint(s) | Mechanism |
| --- | --- | --- |
| Only `src/extractors.ts` may import `ts-morph`. Everything else consumes extracted facts through the seam (below). | `only-extractors-may-import-ts-morph` | `forbiddenDependency` on the AST import graph, `scopePaths` = every src file **except** `extractors.ts` |
| Runtime dependency allowlist is exactly `zod` + `ts-morph`. Any other external package import is a violation. `node:` builtins are allowed globally and narrowed per-file below. | `runtime-dep-allowlist-zod-and-ts-morph` | anchored per-line `forbiddenPattern` over `src/**/*.ts` |
| `src/schema.ts` (the single source of truth for the artifact shape) imports only `zod` plus the local `safe-regex` guard. | `schema-imports-only-zod-and-safe-regex` | per-file `forbiddenPattern` |
| The evaluator is pure: `report.ts` may import only `node:crypto` (deterministic hashing) + local modules; `score.ts` and `teeth.ts` import local modules only. No fs, no network, no process, no child processes. | `evaluator-pure--*` (3 constraints) | per-file `forbiddenPattern` |
| Only `cli.ts` calls `process.exit(` — every other module is an embeddable library module that returns/throws. | `only-cli-may-call-process-exit--*` (19 constraints, one per non-cli src file) | per-file `forbiddenPattern` |

Design notes, recorded honestly:

- **Per-file constraints instead of glob negation.** A `forbiddenPattern` carries one
  `path` glob and the glob language deliberately has no negation ("every file except
  `cli.ts`" is not expressible). The blueprint therefore enumerates per-file constraints.
  The obvious gap — a *new* src file arriving with no per-file constraint — is closed by
  construction: `tests/self-blueprint.test.ts` (run inside the self-gate workflow) fails
  whenever the actual `src/*.ts` set and the blueprint's coverage disagree, including
  `extraction.minFiles`, which is pinned to the exact file count as a fail-closed scan
  floor.
- **What the content patterns can and cannot see.** The import-allowlist patterns are
  anchored single-line matches (`import … from 'x'`, `export … from 'x'`, and the
  multi-line closer `} from 'x'`). They do not see a dynamic `import('x')` expression.
  The `ts-morph` seam constraint does not rely on them — it rides the AST import graph.
- **Purity of the evaluator vs. wall-clock/randomness.** A content constraint forbidding
  `Math.random(`/`Date.now(` in the evaluator would false-fire today: those tokens appear
  in the evaluator's own *documentation comments* (they describe the mock-detection tooth).
  Determinism is instead proven behaviorally by the determinism test suite. Recorded here
  rather than silently narrowed.

## The extractor / facts seam

The blueprint never talks to `ts-morph`. It talks to **facts**:

- `RepositoryFactsExtractor` (`src/graph.ts`) is the seam interface:
  `extract(repoDir, revision) → ArchitectureGraph`. Two implementations ship today —
  the `ast` extractor (ts-morph, full symbol resolution) and the `line-scan` fallback
  (no AST; refuses, loudly, the constraint classes it cannot honor).
- `ArchitectureGraph` is the entire fact surface the evaluator sees: `components`,
  `guardEdges` (imports / provides / egress edges), and `coverage`
  (`scannedFiles`, `patternScan`, `unsupported` — the declared-honest envelope).
- The blueprint's `extraction` block drives the extractor: `profile`, `paths`,
  `minFiles`; every `forbiddenDependency.to` is auto-unioned into the forbidden-import
  scan set, and every `forbiddenPattern.pattern` into the content scan set — a constraint
  can never be silently unscannable.
- Adding a new language or surface means implementing the same interface and emitting the
  same graph shape; `evaluate()`, `score`, `teeth`, and the CLI are unchanged. That is the
  plugin seam this repository's own blueprint exercises end-to-end.

## Lane A / Lane B

Two lanes can gate this tree:

- **Lane B (live now)** — `self-gate.yml` builds the engine **from the commit under
  review** and runs `gate` + `teeth` + the sync test with it. Fail-closed: any non-pass
  verdict, toothless blueprint, or sync drift fails CI.
- **Lane A (live)** — the last **published** engine, installed from the
  public registry at an **exact version pin**, gates the tree. Lane A is independent of
  the code under review, so it cannot be fooled by a defective change to the engine
  itself.

The bootstrap-0 exception ended with the provenance-backed `bce-engine@0.1.0` publication.
Lane A now installs the exact `bce-engine@0.1.5` registry artifact independently, while Lane B continues to grade
the commit under review with its own build.

**The flip:** the `lane-a-pinned-gate` job already exists in
[`self-gate.yml`](../.github/workflows/self-gate.yml) — it reads the exact pin from
[`.engine-pin.json`](../.engine-pin.json), and is **if-guarded on the pin being published AND
`bce-engine@<pin>` actually resolving on npm**. The guard is open: the job installs
`bce-engine@0.1.5` (exact pin, no range) and runs the same `gate` verb. The job is also a required
branch-protection check.

## The Lane-A pin ceremony (forward reference)

The Lane-A flip is a **pin ceremony**, not a version range — and the distinction is the whole point
of the lane. Lane A must be independent of the code under review, so it installs an **exact** version:

- `bce-engine@0.1.5`, never `^0.1.5` or `~0.1.5` or `@latest`. A range would let a later publish
  silently change the gate the tree is graded by, reintroducing the trusting-trust hole Lane A exists
  to close.
- The pin is bumped only by a deliberate, reviewed PR — the same way any load-bearing dependency pin
  moves. Bumping the Lane-A pin is a governed act, recorded in the diff, because it changes the
  independent grader every contributor is measured against.
- The pinned engine is the **published** artifact from the public registry, so a defective change to
  the engine in the PR under review cannot influence the Lane-A verdict: Lane A rebuilds nothing from
  the branch.

The exact steps are written up in [`docs/pin-ceremony.md`](./pin-ceremony.md), and the live exact pin
is recorded in [`.engine-pin.json`](../.engine-pin.json). `v0.1.0` completed bootstrap; subsequent pin
bumps are admitted by the previously published Lane-A engine.

## Admin-override incident policy (attended recovery, not a skip flag)

A required, fail-closed check can occasionally block *its own fix* — the classic case is a change that
reddens the gate whose only correct resolution is that very change (a corrected gate, a fixed
extractor). GitHub's branch protection has an admin-merge escape hatch; bce's policy for using it is
**pre-written, not improvised**:

- An admin-merge that bypasses a red required check is **attended** — a human decides it, in the
  moment, with the red in front of them.
- Every such bypass produces a **mandatory public incident record** in this repository: what was red,
  why the bypass was the correct forward action, and what re-greened the check afterward.

This is an *attended recovery path*, not a skip flag — and the distinction is exact. bce's "no skip
flag" claim is a claim about **the engine**: there is no `--skip` / `--no-verify` / `--force` in `bce`
that turns a red green (the test suite asserts it). It is **not** a claim that GitHub has no
admin-merge button — of course it does. The first flaky red does not falsify the rhetoric, because the
rhetoric never claimed "no escape hatch exists in the platform"; it claimed "no skip flag exists in
bce," and the incident record is what keeps the platform's escape hatch honest and visible when it is
used.

## Reproducing the self-gate locally

```sh
npm ci
npm run build
node dist/cli.js validate --blueprint .blueprints/engine.blueprint.json
node dist/cli.js gate  --repo . --repo-name blueprint-conformance/bce
node dist/cli.js teeth --blueprint .blueprints/engine.blueprint.json --ct-repo . --out teeth-report.json
npx vitest run tests/self-blueprint.test.ts
```

Expected: blueprint VALID, gate score 100 (pass), teeth verdict `toothed` (30/30), tests
green. To watch the gate actually bite, add `import { Project } from 'ts-morph';` to
`src/score.ts` and re-run the gate: it exits 1 with two violations (the seam constraint,
via the AST import edge, and the evaluator-purity pattern) — then revert.

## What self-hosting already found

Assessing the engine's own blueprint surfaced a real engine gap on day one: the
`teeth` reddening mutation for `forbiddenDependency` injected its synthetic edge at a
placeholder path that could never match a `scopePaths`-narrowed constraint, so a
genuinely enforcing, scoped constraint was mislabeled `TRIVIALLY_GREEN`. Fixed in
`src/teeth.ts` (the injected edge now lands at a concrete in-scope path) with a
discriminating regression test in `tests/self-blueprint.test.ts`. That is the point of
Lane B.
