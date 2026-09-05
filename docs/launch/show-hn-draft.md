# Show HN — DRAFT

> **DRAFT — not posted.** The repository and `bce-engine@0.2.0` are public, but this text remains
> operator-owned launch material. Re-check every claim and link against main on the posting morning;
> nothing in this draft may outrun the tree.

## Title options

1. `Show HN: Bce – a fail-closed architecture conformance gate for AI-written code`
2. `Show HN: Blueprints with teeth – measured architecture conformance for agent codebases`
3. `Show HN: Bce – my CI fails if AI-written code drifts from the architecture blueprint`

(Prefer 1; 3 is the most concrete if HN titles get edited for claims.)

## Body

I kept hitting the same failure with agent-written code: each diff looks
fine, tests pass, and three weeks later the architecture has quietly
drifted — a service imports a provider SDK directly, a boundary is crossed,
an egress rule is violated. Review didn't catch it because no single diff
was wrong.

bce ("blueprint conformance engine") is my attempt at making the
architecture a merge contract instead of a wiki page. You author a
blueprint — components, boundaries, dependency/egress/behavior rules — as a
versioned JSON artifact with published schemas. In CI, bce extracts facts
from the tree (TS/JS today; the graph model is language-neutral), grades
conformance deterministically, and fails the merge if the score gates red.

Three things I tried to do differently:

- **Measured, not asserted.** The repo ships an author-designed development corpus of 34 seeded
  architecture defects; CI runs the engine against it and the recall grade
  is a build leg. If the engine stops catching a packaged defect class, the build goes red. This is
  regression evidence, not a held-out or independently annotated performance estimate.
- **Fail-closed and self-hosted.** bce gates its own repository on every
  push with the same verdict users get. A gate that cannot go red is not a
  gate — there is a vacuity check (`bce teeth`) that refuses a blueprint no
  realistic change could redden. Its verdict is three-way rather than a
  boolean: `toothed` (a real extractor-visible mutation reddens the
  constraint), `toothless` (refused), and `evaluator-refutable` — the honest
  middle, refutable in principle but carrying no positive evidence of real
  teeth, kept as its own class so it can never be miscounted as proof.
- **Evidence you can re-check.** `bce run --emit` can produce hash-chained integrity records; a
  zero-dependency script re-verifies a chain offline, no bce install needed. Ordinary gate runs do
  not emit records, and a local hash chain is not authenticated producer identity.

Brownfield adoption is explicitly designed: an advisory mode that scores
without blocking, a shrink-only baseline so existing violations burn down
instead of blocking day one, and a one-way advisory→enforced graduation
recorded in-repo.

It is deliberately narrow: not a linter replacement, not a code-quality
platform, not a spec-driven codegen tool — the [comparison page](https://blueprint-conformance.github.io/bce/guides/comparison/) says when to
use those instead. It is also not alone: that page
names the nearest neighbours I know of, including a couple that overlap
directly, and says what each does better.

Apache-2.0. The [quickstart](https://blueprint-conformance.github.io/bce/guides/quickstart/)
is offline after installation, RED → fix → GREEN in about a minute. I'd particularly value skepticism about the corpus
methodology — what defect classes are missing, and whether measured recall
on seeded defects is a fair proxy at all.

## Pre-post checklist (morning of)

- [ ] All required CI contexts green on main HEAD — JOB names, not file names:
      `build-test-prove`, `lane-b-self-gate`, `lane-a-pinned-gate`, `leakage-gate`,
      `banned-phrases`, `launch promises (inert while private, blocking once public)`, and
      `model-evaluation-controller-macos`. This list previously read "ci, self-gate, leakage,
      banned-phrase" — filename-shaped, and not one of the four matched a job
      in this repository. See public-flip-checklist.md item 10 for why that
      distinction bites.
- [x] v0.2.0 published on npm with provenance; install-from-npm smoke-tested; immutable evidence
      recovery disclosed in `docs/release-v0.2.0.md`
- [x] All draft links replaced and checked
- [ ] External-witness attestation linked (HARD blocker per launch plan — no post without it)
- [ ] Comparison page landscape re-verify done this month — last pass
      2026-08-27 (docs/launch/landscape-reverify-2026-08-27.md). If launch is
      materially later than ~30 days after that date, run another pass; do
      not let the 60-day automated nudge be the only backstop.
- [ ] Week-1 triage rotation armed (docs/launch/week-1-triage.md)
