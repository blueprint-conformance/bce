# Witness attestations

> **Count: 0.**
>
> No independent witness has run [`docs/launch/witness-kit.md`](docs/launch/witness-kit.md) yet.
> That number is the honest state of this file and it will stay 0 until someone the authors do
> not control has run the loop on a machine the authors do not control and filed what they saw.

## Why this file exists at zero

A gate that cannot go red is not a gate — and a project that says so should not then ask you to
take its own green verdicts on faith. The RED → fix → GREEN loop is re-runnable by anyone in
about a minute, offline, with no keys and no accounts. Until an outsider has actually done it,
the claim "the teeth are real" rests entirely on the authors' own word.

Publishing this file empty is the point. An absent ledger lets a reader assume attestations
exist somewhere; a ledger that says **0** cannot be misread.

## What is and is not established today

**Established** — the mechanism is exercised continuously by machinery anyone can inspect:

| proof | where |
|---|---|
| the kit's five commands still produce exactly what the doc says | `witness-kit-freshness.yml` (replays the doc on every relevant change, with a negative self-test that plants a drift and requires refusal) |
| the engine's RED/GREEN pair discriminates on real exit codes | `release.yml` gate leg, re-executed at every tag |
| measured recall against a seeded-defect corpus | `ci.yml` corpus/recall gate |
| the engine gates its own repository | `self-gate.yml` (Lane B) |
| the generated Action executes in a separate public consumer repository | [`blueprint-conformance/bce-action-witness`](https://github.com/blueprint-conformance/bce-action-witness): [clean GREEN](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33497921200), [planted-drift report](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33497995578), [corrected GREEN](https://github.com/blueprint-conformance/bce-action-witness/actions/runs/33498058816) |

**Not established** — none of the above is independent. Every one of those runs on
infrastructure the authors control, from code the authors wrote. That is exactly the gap a
witness closes, and it is why CI passing is not a substitute for this file having a row in it.
The external consumer is deliberately listed as mechanism evidence, not as an attestation: its
repository and execution were created by the project author.

## How to add a row

Run [`docs/launch/witness-kit.md`](docs/launch/witness-kit.md), then open a
[witness attestation issue](../../issues/new?template=witness-attestation.yml). A maintainer
adds the row below and updates the count above.

For the larger onboarding journey—installation, blueprint authoring, generated Action, and a
planted violation in a repository you control—see the
[independent-beta request](https://github.com/blueprint-conformance/bce/issues/9).

**A failed or mismatched run counts and will be recorded.** If the commands did not do what the
doc says, that is a defect here, not a mistake by you — and a recorded contradiction is worth
more to a careful reader than a wall of confirmations.

## The ledger

| date | witness | relationship | commit / archive | OS · node | verdict | link |
|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | |
