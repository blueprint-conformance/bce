# Show HN — DRAFT

> **DRAFT — posted only by the maintainer at launch.** Links marked
> _placeholder_ resolve after the public flip + 0.1.0 publish. Re-check
> every claim against CI on the launch morning; nothing in this draft may
> outrun the tree.

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

- **Measured, not asserted.** The repo ships a corpus of 34 seeded
  architecture defects; CI runs the engine against it and the recall grade
  is a build leg, not a README claim. If the engine stops catching a defect
  class, the build goes red. (The paper's frozen measurement is over the
  first 25 of those 34 — both numbers are in `corpus/MANIFEST.json`.)
- **Fail-closed and self-hosted.** bce gates its own repository on every
  push with the same verdict users get. A gate that cannot go red is not a
  gate — there is a vacuity check (`bce teeth`) that refuses a blueprint no
  realistic change could redden. Its verdict is three-way rather than a
  boolean: `toothed` (a real extractor-visible mutation reddens the
  constraint), `toothless` (refused), and `evaluator-refutable` — the honest
  middle, refutable in principle but carrying no positive evidence of real
  teeth, kept as its own class so it can never be miscounted as proof.
- **Evidence you don't have to trust me on.** Every gate run emits
  hash-chained evidence records; a zero-dependency script re-verifies a
  chain offline, no bce install needed.

Brownfield adoption is explicitly designed: an advisory mode that scores
without blocking, a shrink-only baseline so existing violations burn down
instead of blocking day one, and a one-way advisory→enforced graduation
recorded in-repo.

It is deliberately narrow: not a linter replacement, not a code-quality
platform, not a spec-driven codegen tool — the comparison page says when to
use those instead (_placeholder link_). It is also not alone: that page
names the nearest neighbours I know of, including a couple that overlap
directly, and says what each does better.

Apache-2.0. Quickstart is offline, RED → fix → GREEN in about a minute
(_placeholder link_). I'd particularly value skepticism about the corpus
methodology — what defect classes are missing, and whether measured recall
on seeded defects is a fair proxy at all.

## Pre-post checklist (morning of)

- [ ] All CI legs green on main HEAD — JOB names, not file names:
      `build-test-prove`, `lane-b-self-gate`, `leakage-gate`,
      `banned-phrases` (plus `lane-a-pinned-gate` once Lane A is live
      post-publish). This list previously read "ci, self-gate, leakage,
      banned-phrase" — filename-shaped, and not one of the four matches a job
      in this repository. See public-flip-checklist.md item 10 for why that
      distinction bites.
- [ ] v0.1.0 published on npm with provenance; install-from-npm smoke-tested
- [ ] All _placeholder_ links replaced and clicked
- [ ] External-witness attestation linked (HARD blocker per launch plan — no post without it)
- [ ] Comparison page landscape re-verify done this month — last pass
      2026-08-27 (docs/launch/landscape-reverify-2026-08-27.md). If launch is
      materially later than ~30 days after that date, run another pass; do
      not let the 60-day automated nudge be the only backstop.
- [ ] Week-1 triage rotation armed (docs/launch/week-1-triage.md)
