# The Lane-A pin ceremony

Lane A grades this repository with the **last published** `bce-engine` at an **exact version pin**,
installed from the public registry and independent of the code under review (see
[`docs/self-hosting.md`](./self-hosting.md) §"Lane A / Lane B"). The pin lives in
[`.engine-pin.json`](../.engine-pin.json). This document is the standing procedure for moving it.

## Why the pin is exact, never a range

Lane A exists to close a trusting-trust hole: a change that simultaneously breaks the engine and the
engine's ability to notice the break must not be able to self-grade green. That property only holds if
the grader is **fixed** — a published artifact the PR under review cannot influence.

- `bce-engine@0.1.5` — never `^0.1.5`, `~0.1.5`, or `@latest`. A range would let a *later* publish
  silently change the gate every contributor is measured against, reintroducing the exact hole Lane A
  removes.
- The **caret-0.x incident** is the recorded reason ranges are forbidden even when they look harmless:
  on a `0.x` line npm treats `^0.6.0` as equivalent to `~0.6.0`, so `^0.6.0` **excludes** `0.7.0`. A
  caret pin on a pre-1.0 line does not even receive a minor bump — it ships dead-green while looking
  current. An exact pin cannot drift by accident; it only moves when a human moves it, in a diff.

## The pin is a trust anchor — bumping it is gated by the OLD pin

Bumping the Lane-A pin changes the independent grader. So the bump is itself a **governed act, gated by
the engine it is replacing**:

1. Publish the new engine version (e.g. `0.2.0`) via the tag-gated
   [`release.yml`](../.github/workflows/release.yml). Publishing is itself fail-closed: the release
   refuses unless the full suite + corpus/recall + self-gate + leakage-gate + the RED/GREEN dist pair
   are all green **at the tag** (re-run in the workflow, never trusted from a prior run).
2. Open a PR that **only** bumps `.engine-pin.json` `pin` from the old value to the new one.
3. That PR is graded by Lane A running the **OLD** pin (the pin change takes effect only after merge, so
   the required Lane-A check on the PR still installs the predecessor). The new engine must be admitted
   by the engine it is replacing — a monotone trust ratchet: *every release since 0.1.0 was admitted by
   its predecessor.* This is the honest claim, not "every commit ever."
4. Merge only when Lane A (old pin) and every other required check are green. After merge, Lane A
   installs the new pin for all subsequent PRs.

## New constraint vocabulary lands via the version-skew two-step

A new release sometimes introduces a constraint type the *older* pinned engine does not know. bce never
treats an unknown constraint as a silent pass — it surfaces it as an **explicit advisory** (the
`minEngineVersion` / version-skew honesty behavior, asserted by the test suite). So a new vocabulary
lands in two governed steps, never one:

1. The pin-bump PR merges under the **old** engine, which grades any new-vocabulary constraint as an
   explicit advisory (visible, never a silent green).
2. Once the pin is bumped, the **new** engine grades that same constraint as **enforcing**. The
   transition is legible in the diff and in the gate output at each step.

This is the same widen-only ratchet the format itself follows: expressive power is added, never silently
relaxed.

## Bootstrap-0 history (completed)

`.engine-pin.json` originally shipped with `"published": false`. While it was false there was nothing
published to pin, so:

- Lane A is **dormant** — `self-gate.yml`'s Lane-A step is `if`-guarded on the pin being published AND
  the pinned version resolving on npm, so it does not run and does not claim a check that cannot exist.
- Lane B (HEAD gating its own tree) is the only lane — the **bootstrap-0 exception**, recorded in
  [`docs/self-hosting.md`](./self-hosting.md).

The `v0.1.0` release completed this bootstrap. The current pin is the published, registry-resolvable
`bce-engine@0.1.5`, so Lane A runs on every self-gate. Later releases follow the predecessor-gated
ceremony above. The conditional remains solely as a fail-closed generic bootstrap state, not as a
description of the current repository.

## What this ceremony is NOT

It is not a skip flag and not an escape hatch. There is no `--skip` / `--no-verify` / `--force` in
`bce` that turns a red green (the test suite asserts this). The one attended recovery path — an
admin-merge that bypasses a red *required* check that is blocking its own fix — is documented separately
in [`docs/self-hosting.md`](./self-hosting.md) §"Admin-override incident policy" and always produces a
public incident record. Moving the pin is an ordinary governed dependency bump, gated by the predecessor
engine; it is not that recovery path.
