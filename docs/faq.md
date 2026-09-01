# FAQ

Short answers to the questions the design keeps getting asked. The one that matters most first.

## Why is `baseline` not a bypass?

`bce baseline` records a repository's **pre-existing** conformance violations into a committed,
PR-reviewed file (`.blueprints/baseline.json`) so that adopting the gate on a codebase that already
drifts does not turn the build red on day one for debt nobody introduced today. The obvious worry is
that this is a `# noqa`-for-the-whole-repo — a way to make the gate green by declaring the failures
acceptable. It is not, and the mechanics are what make that true, not a promise.

**An existing baseline cannot grow in place.** This is the load-bearing command property; repository
review remains part of the security boundary because deleting and recreating the file can expand it:

- The FIRST `bce baseline` (no file yet) records every current violation. This is the only moment the
  accepted set can grow, and it produces a **new file in your diff** — a reviewer sees exactly which
  violations, on which components, under which blueprint, at what severity, are being accepted.
- Every SUBSEQUENT `bce baseline` can only produce a **subset** of the existing file. A violation that
  has since been fixed is **auto-removed** (the wall burns down); a violation that is present now but
  was **not** already baselined is **refused entry** — the re-write will not add it. Re-running the
  command can never grow the accepted set.
- To grow the wall — to accept a violation that is not already in it — you must **delete the file and
  re-create it**. That deletion is a line in a pull request. There is no in-place "add this one to the
  baseline" affordance, precisely because that affordance would be the bypass.

So the accepted set is monotonically non-increasing under normal use, and any increase is a reviewed,
visible act. The gate's teeth grow back over time by construction: as violations are fixed, the
baseline shrinks, and the day it is empty you can delete it and the gate enforces everything again.

**A NEW violation always fails — a baseline never suppresses one.** With a baseline present the gate
stays fully **enforcing**. It partitions each run's violations into two sets:

- **NEW** (not in the baseline) — these **fail the build**, exactly as if no baseline existed. Adding
  a fresh violation to a baselined repo is a red gate. The baseline does not touch it.
- **BASELINED** (in the file) — these are **reported, counted, and stamped non-blocking**. They are
  never hidden: the gate prints them, names their constraint, and labels the blueprint's line
  `graded fail; all N BASELINED — non-blocking`, which can never be mistaken for a graded green.

That is the whole difference between a baseline and a skip flag. A skip flag makes a red *disappear*.
A baseline makes a *pre-existing* red *visible and non-blocking* while keeping every *new* red fatal.
Nothing is ever silently softened — the same rule that governs advisory mode.

**Identity is content-addressed, so a baseline is honest across edits.** A baselined violation is
identified by the tuple `(blueprint, constraint, component)` — hashed — not by a line number or the
prose of its message. Reformatting a file or shifting a line does not "lose" a baselined violation and
spuriously re-redden it. But **moving the violation to a different component, or a different
constraint firing, is a different identity** — correctly treated as NEW. You cannot smuggle a broad
acceptance past the gate by hand-editing the file either: the reader recomputes each entry's hash from
its own fields and refuses a file whose stored identity does not match, fail-closed.

**Why not just fix everything before turning the gate on?** On a real codebase with dozens of
pre-existing violations — a brownfield adoption where a first honest run surfaces, say, 75 of them —
"fix all 75 first" is how a conformance gate becomes shelfware: it is never turned on, because turning
it on is a 75-item blocking chore. The baseline lets you turn the gate on **today** (new drift is
caught from this commit forward) and burn down the 75 as normal work, with the tool guaranteeing the
wall only comes down. That is the honest adoption path: enforcing from day one for everything new,
shrink-only for the debt that predates the gate.

**`baseline` vs advisory mode** — the two adoption levers, and how they differ:

| | it changes | it never | good for |
|---|---|---|---|
| **advisory mode** (`.bce-mode.json`) | the WHOLE gate's exit code → 0 | hides or softens the verdict; the full red is printed every run | a first look, before you are ready to block on anything |
| **baseline** (`.blueprints/baseline.json`) | which violations block → only NEW ones | suppresses a new violation; a pre-existing one is shown + counted, not hidden | adopting on a dirty repo while still failing on anything new |

Advisory ungates the whole verdict but keeps it loud; baseline keeps the gate enforcing and narrows
*what* blocks to *only new drift*. Neither is a `--skip`. You can graduate out of both: advisory →
enforced is a one-way recorded ceremony (`bce graduate`); a baseline shrinks to empty and is deleted.

## Does advisory mode or a baseline weaken the grader?

No. The grader is fail-closed at all times, independent of either lever. An empty scan, a malformed
blueprint, a repository with no blueprints — each is a hard fail regardless of mode or baseline (a
"refusal": the engine could not honestly grade, so it does not pretend to). A baseline can only
re-classify a *graded violation* as non-blocking; it can never turn a refusal green. Advisory only
decides whether a red *blocks the build* — the verdict itself is always honestly computed and printed.

## Is there a `--skip` / `--no-verify` / `--force` flag anywhere?

No, and adding one is a non-conforming change to the specification. Adoption is handled by committed,
PR-reviewed configuration files — never by an invisible CI-line flag. A flag is trivially added under
adoption pressure and leaves no trace in the repo; a committed file makes the posture a governed,
visible fact of the codebase. The engine's own test suite asserts, both by scanning the CLI source and
by throwing every skip-shaped flag at a red gate, that none of them turns it green.
