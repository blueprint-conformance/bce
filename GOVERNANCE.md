# Governance

This document describes how **bce, the blueprint conformance engine** is
actually run. It is deliberately honest: no foundation, no board, and no
certification body stand behind this project today, and nothing here should
imply otherwise.

## Stewardship

bce is created and stewarded by **Odin Labs**. The steward owns the
repository, the npm package (`bce-engine`), the published specification
namespace (`blueprint-conformance/v1alpha1`), and the project marks (see
[TRADEMARKS.md](TRADEMARKS.md)).

## Maintainer reality

- **Solo maintainer.** The project currently has one human maintainer, backed by Odin Labs. Required
  CI checks protect `main`, admins cannot bypass those checks, and force-push/deletion are disabled.
  Human approval and release-review requirements remain off because no second person is available;
  enabling them would deadlock the project rather than create independent review. A solo maintainer
  cannot truthfully provide independent review of their own change.
- **AI-driven maintenance, named plainly.** A substantial share of the
  project's day-to-day engineering — issue triage drafts, test authoring,
  refactors, release mechanics — is performed by AI agents operated by the
  maintainer. Every change still lands through required CI; independent review is
  not claimed until a distinct authorized human actually reviews a change. The maintainer is accountable for
  everything that merges. If AI involvement in this project matters to you,
  you now know exactly what it is.
- **No SLA.** This is an open-source project, not a support contract.
  See the triage commitment below for what you *can* expect.

## Commercial model (disclosed up front)

The engine and the specification are Apache-2.0 and will remain so — the
public commitment is **no license flip, ever**. Around that open core,
Odin Labs may offer paid, clearly-separated commercial services:
certification and training programs, hosted or managed offerings, and
consulting. These are built *on* the open project, not carved *out* of it:
the open-core boundary does not visibly shrink, and nothing required to use,
implement, or verify the format is paywalled. Odin Labs asserts trademark
rights in the project marks and may seek registration for marks covering its
commercial naming; see TRADEMARKS.md.

Contributions are accepted under the **Developer Certificate of Origin
(DCO)** — sign-off on your commits, no CLA. There is deliberately no CLA
because the project does not want, and should not have, relicensing
leverage over contributors' work.

## Decision process

- **Code and releases:** the maintainer decides. Discussion happens in
  issues and pull requests; the maintainer merges, releases, and takes
  responsibility for the outcome.
- **Specification changes:** the blueprint format is governed by a
  widen-only ratchet — a revision may add expressive power but never
  silently relaxes what an existing constraint enforces. Spec changes go
  through a numbered **RFC process** (an RFC issue/document per change) so
  the reasoning is public and referenceable. While the community is small
  this is lightweight; as external implementations appear, the RFC process
  is the seam where shared control grows.
- **Breaking changes:** versioned, never silent. The `v1alpha1` apiVersion
  string means what it says — the format is published but not yet stable.

## Path to shared maintainership

Shared maintainership is a stated goal, with a concrete trigger, not a vague
aspiration:

> A contributor with a **sustained track record** — meaningful merged
> contributions (code, spec, or conformance vectors) and constructive review
> participation over a period of roughly three months — will be offered
> co-maintainership, including commit and release rights.

When a second maintainer joins, this document gets rewritten to describe the
actual shared model (lazy consensus, area ownership, or similar) rather than
inventing one now. Milestone-gated items — conformance levels,
self-certification listings, a neutral conformance runner, media-type
registration — activate when at least one external implementation of the
format exists, and are expected to move under more neutral governance at
that point.

## What you can expect (triage commitment)

- **Week-1 triage:** every new issue and pull request gets a substantive
  first response — a label, a repro attempt, a review, or an honest "this
  is out of scope" — within **7 days**.
- Security reports get priority handling; see SECURITY.md.
- Abandonment risk is real for any solo-maintained project. The mitigations
  are the fast triage bar above, the shared-maintainership trigger, and the
  fact that everything needed to fork or reimplement — code, spec, schemas,
  conformance vectors — is Apache-2.0 and in this repository.

## Review-enforcement activation

The repository deliberately does not require a human approval or release reviewer while it has one
human maintainer. Six required CI checks, admin enforcement, and force-push/deletion prevention stay
live and provide solo-safe protection. When a distinct second human accepts responsibility and can
exercise it, add CODEOWNERS, require their approval, and protect the release environment in the same
reviewed change. A nominal account or same-author approval is not independent review. The live state
and activation requirements are documented in
[`docs/governance-enforcement.md`](docs/governance-enforcement.md).

## Changes to this document

Governance changes are made by the maintainer, in the open, via pull
request to this file.
