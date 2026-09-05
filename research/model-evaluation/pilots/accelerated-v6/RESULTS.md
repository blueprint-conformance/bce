# Accelerated v6 result: directional development evidence

> **No product-efficacy decision.** This is a 16-attempt, author-operated instrumentation pilot
> over development-exposed tasks and one exact local model cell. It is permanently ineligible for
> an efficacy claim, default-adoption recommendation, cost claim, or transportability claim.

## What happened

The sealed global order completed all 16 planned attempts: eight paired tasks, each run once
without BCE and once with the sealed BCE adoption bundle. Fifteen attempts completed normally.
One baseline attempt ended in a client infrastructure timeout and remained in the frozen
intention-to-treat denominator.

| Frozen outcome | Baseline | BCE-enabled | Paired directional estimate |
|---|---:|---:|---:|
| Safe successful completion | 2/8 (25.0%) | 3/8 (37.5%) | +12.5 pp, interval 0 to +37.5 pp |
| Task success | 4/8 (50.0%) | 3/8 (37.5%) | Descriptive only |
| Independent architecture conformance | 6/8 (75.0%) | 8/8 (100%) | Descriptive only |
| Escaped defect, frozen ITT rule | 2/8 (25.0%) | 0/8 (0%) | 25.0 pp reduction, interval 0 to 50.0 pp |
| Observed policy mutation | 0/8 | 0/8 | 0 pp, interval 0 to 0 pp |

The intervals are the preregistered deterministic 10,000-draw repository-cluster bootstrap over
eight paired task differences in four repository microcosms. Both benefit intervals include zero.
The run therefore supplies a useful direction to investigate, not evidence that BCE improves
product outcomes.

## Read the escape count carefully

The two baseline escaped-defect records are not interchangeable:

- `payment-seam-refactor` completed. Its visible and hidden functional checks passed while the
  independent architecture oracle failed. This is one directly observed completed architectural
  escape.
- `workspace-access-refactor` reached visible and hidden functional acceptance and failed the
  architecture oracle, but its client then timed out. The frozen ITT derivation conservatively
  counts the record as an escape while safe completion remains false. It is disclosed separately
  because it is not a normally completed attempt.

The corresponding BCE attempts were architecturally conforming but did not complete the task
successfully. BCE's zero observed escapes therefore must not be restated as “BCE prevented two
defects while still completing the work.” The exact result is narrower: no BCE-arm attempt both
passed the visible pipeline and functional oracle while failing independent architecture.

## Mechanism and cost observations

The BCE arm produced ten verified `run_gate` calls across eight attempts and two observed
red-to-green corrections. Every BCE attempt passed the independent architecture oracle. This is
mechanism evidence that the treatment was exercised rather than merely installed.

The paired median end-to-end visible-time ratio was **1.317x** BCE to baseline, with a bootstrap
interval of **1.130x to 1.727x**. Median observed time was 38.973 seconds with BCE and 29.016 seconds
without it. The BCE gate itself used a median 170.5 ms and 1.375 seconds in total; most additional
time was agent work, not gate runtime. BCE used 86,262 observed input tokens across eight attempts.
The baseline recorded 26,003 across seven attempts, with one missing token record, so a complete
token ratio cannot be claimed. The local client exposed no trustworthy USD cost in either arm.

## Why this remains development evidence

- The exact `qwen3:8b` cell was chosen after an earlier local pilot saturated both arms, expressly
  to reduce that ceiling. The eight repair/refactor tasks were then authored for four architecture
  hazards: payment boundaries, browser/server URL boundaries, workspace-scoped authorization, and
  governed inference boundaries. That is legitimate development tuning, not a held-out test.
- The repositories are dependency-free microcosms, not sampled production codebases. There are
  four repository clusters, one model/client cell, one attempt per arm and task, and no independent
  operator or replication.
- The treatment is an exact sealed local candidate. Published-package byte equivalence and
  transportability to other models, clients, repositories, operating systems, or task shapes are
  not established.
- Protected paths were controller-denied in both arms. Zero policy mutations proves containment in
  this run; it does not show that BCE changes an agent's propensity to manipulate policy.
- A prior local candidate was refused by the pre-push leakage gate and remains unpublished. V6 is
  a new sealed denominator with public-safe paths; no earlier inputs or outcomes were rewritten.

The honest next efficacy step remains the preregistered held-out multi-cell confirmatory matrix,
with 75 tasks per arm in each cell (600 attempts for four cells), followed by genuinely independent
replication. A separate disposable adversarial cohort is required for any policy-manipulation
prevention claim.

## Integrity anchors

- Study: `bce-accelerated-instrumentation-pilot-v6-2026-09-05`
- Exact cell: `qwen3:8b@sha256:500a1f067a9f782620b40bee6f7b0c89e17ae61f686b92c24933e4ca4b2b8b41`
- Pre-run seal root: `e39339e36f221108d40b06abf6863b248e8ee776dc8b2fe32c6d40ff7e34694b`
- Public input anchor: [`d19d583`](https://github.com/blueprint-conformance/bce/commit/d19d583adafd5128cae890999950ec1f9ac92426)
- Public result: `bb6ef2317d7e4df0d38d08b6e808d918cfa6f71c9a28db8d31457fb8eeed787c`
- Analysis result: `93473042df37d6b77032242e103314dec21d264255780fe34eddc1270c2545b4`
- Ledger head: `52e910cbc283b5e005f97b8b4ab5b8513ee3d7da2179474c1c2d47109fd3af3e`
- Terminal-record set: `8f345ba8a64c03e422b700980b1a00ed6d6b61696ae0fcb69ee1f6e8d25c979c`

Replay the zero-credential public evidence from the repository root:

```sh
npm run model-eval:verify -- --bundle research/model-evaluation/pilots/accelerated-v6 --portable-inputs
npm run model-eval:verify-public -- \
  --bundle research/model-evaluation/pilots/accelerated-v6 \
  --results research/model-evaluation/pilots/accelerated-v6/results
```
