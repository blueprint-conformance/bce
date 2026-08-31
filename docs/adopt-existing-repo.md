# Adopt bce on an existing repository

Turning a conformance gate on a codebase that already drifts is where most such gates die: a first
honest run surfaces dozens of pre-existing violations, "fix all of them first" becomes a blocking
chore nobody schedules, and the gate is never turned on. bce is designed so you can turn it on
**today** — enforcing from this commit forward for anything new, while the debt that predates the gate
burns down as normal work.

There is deliberately **no `--skip` flag**. Adoption is handled by committed, PR-reviewed
configuration files — never by an invisible CI-line override. That is what keeps a green verdict
honest. The two config files are `.bce-mode.json` (advisory mode) and `.blueprints/baseline.json`
(the shrink-only baseline).

## The ladder

Four rungs, each a committed, visible step. You do not have to climb all four in one day — the point
is that every rung is enforcing *something* and none of them hides a red.

```
advisory  ──►  baseline  ──►  graduate  ──►  enforced
(nothing        (only NEW      (one-way,      (everything
 blocks,         drift          recorded       blocks;
 verdict is      blocks;        flip to        the wall
 loud)           debt shown     enforced)      is empty)
                 + counted)
```

### Rung 1 — advisory: turn it on, block nothing yet

Author a blueprint (or have an agent draft one — see [`agent-loop.md`](agent-loop.md)) and drop it in
`.blueprints/`. Then commit an advisory-mode marker so a red verdict is printed loudly but does not
fail the build:

```bash
# .bce-mode.json  — committed, reviewed; NOT a flag on the gate
{ "mode": "advisory" }
```

Now `bce gate` runs in CI, prints the full verdict with an unmissable advisory banner, stamps the
report `mode: "advisory"` — and exits `0` regardless of the verdict. You see exactly how much drift
exists without turning the tree red on anyone. This is the first-look rung: it changes the *whole*
gate's exit code to 0; it never hides or softens the verdict.

### Rung 2 — baseline: block new drift, show the debt

When you are ready to start *failing on new drift* — but not yet ready to fix all the pre-existing
violations — record the current violations into a baseline and switch out of advisory:

```bash
bce baseline                 # writes .blueprints/baseline.json with today's violations
rm .bce-mode.json            # (or graduate — see rung 3) so the gate enforces again
```

With a baseline present the gate stays **fully enforcing** and partitions every run's violations:

- **NEW** (not in the baseline) → **fails the build**, exactly as if no baseline existed.
- **BASELINED** (in the file) → reported, counted, and stamped `graded fail; all N BASELINED —
  non-blocking`. Never hidden, never mistakable for a graded green.

The baseline **only ever shrinks**. A re-run auto-removes violations you have since fixed and refuses
to *add* any that were not already in it. To accept a genuinely new violation you must delete the file
and re-create it — and that deletion is a line in a pull request. There is no in-place "add this one"
affordance, precisely because that affordance would be the bypass. Baselined violations are identified
by a content-addressed `(blueprint, constraint, component)` tuple, so reformatting or moving a line
does not spuriously re-redden — but moving a violation to a different component is correctly a new
identity, and fails.

> Why a baseline is not a `# noqa`-for-the-whole-repo — the full mechanics — is in
> [`faq.md` §"Why is `baseline` not a bypass?"](faq.md#why-is-baseline-not-a-bypass).

### Rung 3 — graduate: the one-way flip to enforced

`bce graduate` records the advisory→enforced transition in-repo and flips the config. It is
**one-way**: going back to advisory requires an explicit `--rationale`, recorded in the tree, so the
posture is always a governed, visible fact rather than a quiet CI edit.

```bash
bce graduate                 # advisory → enforced, recorded
```

### Rung 4 — enforced: the wall is empty

As you fix the baselined debt, the baseline shrinks. The day it is empty you delete it, and the gate
enforces everything again — the same fail-closed gate a greenfield repo gets. The gate's teeth grow
back over time *by construction*.

## The honest brownfield story

On a real codebase a first run might surface, say, 75 pre-existing violations. The dishonest options
are "fix all 75 before turning it on" (so it never gets turned on) or "add a skip flag" (so the gate
means nothing). bce's answer is the ladder: turn it on today in advisory to *see* the 75, baseline
them so *new* drift is caught from this commit forward, and burn the 75 down as normal work with the
tool guaranteeing the wall only comes down. Enforcing from day one for everything new; shrink-only for
the debt that predates the gate.

## What adoption never does

- It never adds a `--skip` / `--no-verify` / `--force` flag. None exists; the test suite asserts, by
  scanning the CLI source and by throwing every skip-shaped flag at a red gate, that none turns it
  green.
- It never lets advisory or a baseline weaken the **grader**. An empty scan, a malformed blueprint, a
  repo with no blueprints — each is a hard fail-closed refusal regardless of mode or baseline. A
  baseline can re-classify a *graded* violation as non-blocking; it can never turn a refusal green.
  Advisory decides only whether a red *blocks the build* — the verdict is always honestly computed and
  printed.

## Recommended next step

- [`agent-loop.md`](agent-loop.md) — wire the gate in as your coding agent's done-check.
- [`faq.md`](faq.md) — the baseline-is-not-a-bypass mechanics, in full.
