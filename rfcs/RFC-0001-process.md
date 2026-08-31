# RFC-0001: The RFC process

> **Status: stub.** This is the seed of the RFC process itself. It is intentionally lightweight while
> the project is small and solo-maintained; it is written self-contained so it can grow into the real
> shared-governance seam the moment a second maintainer or an external implementation appears. The full
> process lands with — or shortly after — the initial public release.

## Why an RFC process exists

The blueprint format is governed by a **widen-only ratchet**: a revision may add expressive power but
never silently relaxes what an existing constraint enforces (see [GOVERNANCE.md](../GOVERNANCE.md) and
`spec/SPEC.md` §10). That ratchet is only trustworthy if changes to the format are made in the open,
with the reasoning written down and referenceable. The RFC process is that record.

## What needs an RFC

An RFC is required for any change to the **specification / blueprint format**:

- a new constraint type, or a change to the enforcing semantics of an existing one;
- a change to the artifact model, the report contract, or the exit-code contract;
- a change to the scoring or verdict rules;
- promotion of a reserved / declared-but-not-enforced constraint type to enforced;
- any change to the widen-only versioning policy itself.

An RFC is **not** required for: engine bug fixes that bring behavior in line with the existing spec,
documentation changes, new conformance vectors, new extractors that emit the existing graph shape, or
internal refactors. Those go through a normal pull request.

## The process (lightweight, current)

1. **Open an RFC.** Add `rfcs/RFC-NNNN-<slug>.md` (next free number) in a pull request, using the
   outline below. One RFC per logical change.
2. **Discuss in the open.** Design discussion happens on the RFC pull request and any linked issue.
3. **Decision.** While the project is solo-maintained, the maintainer decides and records the outcome
   (accepted / rejected / deferred) in the RFC's status, with a one-line rationale. As external
   implementations appear, this step becomes the seam where shared control grows (see
   [GOVERNANCE.md](../GOVERNANCE.md) §"Path to shared maintainership").
4. **Implement behind the RFC.** An accepted RFC is implemented in a follow-on PR that references it;
   the spec change and the engine change land together and stay consistent (the schema-parity test
   enforces that they cannot silently drift).

## RFC outline

Each RFC document carries, at minimum:

```
# RFC-NNNN: <title>

Status: draft | accepted | rejected | deferred
Author(s): <name>

## Summary
One paragraph: what changes and why.

## Motivation
The problem this solves. What is impossible or dishonest today.

## Design
The concrete change to the format / contract, with examples.

## Widen-only check
Explicit statement of why this only ADDS expressive power and cannot silently relax
an existing constraint's enforcement. (An RFC that would narrow enforcement is
rejected on this ground alone.)

## Alternatives considered
What else was weighed, and why this shape won.

## Compatibility
Version impact; how existing blueprints and consumers are affected; migration if any.
```

## This document

RFC-0001 governs the RFC process. Changes to the process are themselves made via a PR to this file,
in the open.
