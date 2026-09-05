# The agent estate: what happens when the PR author is not a person

Self-hosting shows the engine gating its own tree — a small repository, gated by its authors,
where the thing under test and the thing doing the testing are the same codebase. It answers
"does the gate run?" It does not answer the question this document is about:

**What does a conformance gate do when almost every pull request is written by an agent?**

That question has an answer here because the engine is a required merge gate on a production
estate whose pull requests are, overwhelmingly, not written by people. This document reports what
that estate measures, and — at least as carefully — what the measurement does not license anyone
to claim.

## Read this part first

The estate is a **private** repository operated by this project's authors.

You cannot re-derive these numbers. Nobody outside the authors can. This is self-measurement, in
exactly the sense [the Evidence and limits section of the README](../README.md#evidence-and-limits) already warns
about: proof produced by machinery its authors control, from code its authors wrote. It is not
independent confirmation and no amount of care in this document converts it into any.

Three things follow, and they are the reason this document exists in the shape it does:

1. The numbers live in a committed record, [`evidence/fleet/fleet-record.json`](../evidence/fleet/fleet-record.json),
   which carries its own provenance and its own limits. The prose cites the record; it does not
   restate it from memory.
2. [`scripts/gen-fleet-evidence.mjs --check`](../scripts/gen-fleet-evidence.mjs) runs offline in CI
   and fails if any number on this page or the README disagrees with that record — and fails just
   as hard on a number in the prose that the record does not contain. A public contributor cannot
   verify the measurement, but they can verify the page does not drift from what it cites.
3. This record is **deliberately not filed in [ATTESTATIONS.md](../ATTESTATIONS.md)**. That ledger
   counts independent witnesses and it reads 0. The authors are not witnesses to their own estate,
   and a ledger that counted them would measure nothing at all. It stays at 0 until someone else
   files.

## What was measured

Measured on 2026-08-27, over the window beginning the day the gate first landed on the estate's
default branch:

| | |
|---|---|
| Pull requests merged while the gate was a required check | **1946** |
| Of those, authored by an agent rather than a person | **1921** |
| Authored by a person | **25** |
| Agent-authored share | **98.7%** |
| Blueprints authored across the estate | **75** |
| Repositories running the gate | **5** |
| Engine version the gate installs | **0.17.0**, exact — never a moving tag |

### Public/private implementation identity

The private estate's `0.17.0` pin is **not** the public npm package's current `0.2.0` identity, and
this repository contains no public source-to-artifact attestation connecting the two. Consequently,
the fleet record is evidence about the private estate's gate operation, not implementation evidence
for public `bce-engine@0.2.0`. It must not be used to claim that the public package handled those
merges. A future private run may count as public BCE dogfood only when its sanitized record binds the
exact public package version, package integrity, and public source commit. Private policy and raw
tenant telemetry remain private; engine identity and aggregate outcomes may be published.

The gate is a required check. It carries no workflow-level path filter and it runs on the merge
group as well as the pull request, for a reason worth stating plainly: a required check that does
not report is not a lenient gate, it is a **wedge**. Every pull request blocks forever on a verdict
that will never arrive. The gate self-scopes instead — a change touching nothing under any
blueprint's scope passes trivially and says so.

## What the numbers do not say

**A merge is not a defect caught.** 1946 is a count of merges that happened while the gate was
required. Most of them touched no blueprint's scope and passed trivially. Reporting the merge count
as though it were a catch count would be the most tempting misreading available here, so: it is not
one, and this project does not make that claim.

**Gate presence was sampled, not exhausted.** Of the 40 most recent merges examined *as sampled on
2026-08-27* — an earlier date than the merge counts above, because the refresh script re-derives
those and not this — 37 carried a conformance check-run on the merge commit. The other 3 are reported rather than explained away: in
a merge queue the checks execute against the merge-group commit, and this sample reads the final
merge commit, so absence here is not evidence of a skip. It is also not evidence of a run. The gap
is left visible because closing it in prose would be asserting something the measurement cannot
support.

**Scale is not virtue.** A high merge count under a gate proves the gate did not become intolerable
at volume. That is a real property and a modest one. It says nothing about whether the constraints
are the *right* constraints — that is what the seeded-defect corpus and the TOOTHED/TRIVIALLY_GREEN
classification are for, and those are measured separately.

## Why this is the interesting case anyway

Reviewing a colleague's pull request and reviewing an agent's are different problems, and the
difference is not competence. A person who violates an architectural rule usually knows the rule
exists and can be told once. An agent produces code that compiles, passes the tests, and satisfies
the prompt — and has no standing reason to preserve a boundary nobody encoded. It will reintroduce
the same violation next week, in a different file, having been told twice.

At one or two pull requests a day, a person absorbs that with review attention. At the volume above,
review attention is not the mechanism any more — nobody reads 1712 diffs for a rule that lives in a
document. Either the boundary is executable or it is decorative, and the gap between those two
states is invisible right up until the moment someone looks.

That is the whole argument for a conformance gate, and it is why an agent-authored estate is where
the argument is least theoretical. The engine did not become useful here because the code got
harder. It became useful because the reviewer stopped scaling.

---

Refreshing this record requires read access to the private estate and is a steward action:
`node scripts/gen-fleet-evidence.mjs --refresh`. Verifying the page against the record is offline
and open to anyone: `node scripts/gen-fleet-evidence.mjs --check`.
