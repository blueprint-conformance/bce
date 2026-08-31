# Contributing

Thanks for your interest in **bce, the blueprint conformance engine**. This repository is in a
public release. External contributions are open — issues and pull requests are welcome. This guide is
in force now for the maintainer and the AI agents that operate under the maintainer's account, and is
the guide external contributors will follow at release.

## Developer Certificate of Origin (DCO)

All contributions must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin](https://developercertificate.org/). By signing off you certify that
you have the right to submit the work under the project's license (Apache-2.0). There is deliberately
**no CLA** — the project does not want, and should not have, relicensing leverage over contributors'
work. See [GOVERNANCE.md](GOVERNANCE.md).

Sign-off is a single line at the foot of each commit message, added automatically by `-s`:

```
Signed-off-by: Your Name <your.email@example.com>
```

The name and email must be real and must match the commit author. A pull request whose commits are not
all signed off does not merge.

## One logical change per pull request

Keep each PR to one logical change. A PR that mixes a bug fix, a refactor, and a new feature is three
reviews wearing one hat — split it. Small, single-purpose PRs are reviewed faster and revert cleanly.

## The gate is the done-check (including for your PR)

This repository gates its own tree (see [`docs/self-hosting.md`](docs/self-hosting.md)). Every PR must
be green on all workflows before it merges:

- **`leakage-gate`** — a dependency-free banned-string scan. No internal identifier, host, or
  infrastructure reference may land in the tree.
- **`ci`** — clean install, build, typecheck, the full test suite, the measured-recall corpus run, and
  the offline RED/GREEN discriminating pair.
- **`self-gate`** — the engine, built from your commit, gates its own architecture blueprint.

A green typecheck or test run is necessary but not sufficient: the change is not done until the gate is
green. If a red check is blocking its own fix, see the admin-override incident policy in
[`docs/self-hosting.md`](docs/self-hosting.md) — an attended recovery path with a mandatory public
incident record, never a skip flag.

## Agent-authored PR conventions

A substantial share of this project's engineering is performed by AI agents operated by the maintainer
([GOVERNANCE.md](GOVERNANCE.md) says so plainly). Agent-authored PRs are held to the same bar as any
other, plus two conventions that make the agent's work auditable:

1. **The gate must be green, and the PR body must say so with evidence.** An agent does not report a
   change "done" on a green typecheck alone. The PR body carries the `bce gate` verdict and, where the
   change affects a graded surface, the **evidence ref** (the content-addressed
   `architecture-graph.json@sha256:<hex>` from the report) so a reviewer can re-derive the verdict
   offline. A claim of green with no re-derivable evidence is not accepted.
2. **Fix the code, never silently edit the blueprint or the baseline.** When the gate goes red, the
   default is to change the code so it conforms. Editing a blueprint to clear a red — or appending to
   `.blueprints/baseline.json` — changes the contract or accepts a new violation, and is a deliberate,
   separately-reviewed decision stated as such in the PR, never a quiet workaround folded into an
   unrelated change.

These are the same three rules the [agent-instruction snippets](integrations/README.md) hand to a
coding agent working in *any* bce-gated repo — applied here, to this repo's own contributions.

## Violation-message style guide

bce's own violation output, and any blueprint or constraint message you author, follows an
anti-resentment style: the goal is a message an engineer reads as *actionable*, not as an accusation.

- **Name the fact, then the expectation.** Every violation states `observed` (what the engine saw) and
  `expected` (what the contract required), both concrete. Never a bare "failed" or "invalid."
- **Anchor it.** Where a line applies, carry the `path#L<line>` anchor so the reader jumps straight to
  the offending code.
- **Offer both ways out.** The standing footer is *fix the code* **or**, if the rule itself is wrong,
  *amend the blueprint via a reviewed PR*. The gate never edits your code or your contract for you, and
  the message says so.
- **Group, don't flood.** A constraint that fires N times is summarized as one line ("`<constraint>`:
  N violation(s)") with the individual anchors nested beneath — a wall of identical lines reads as
  noise and breeds the "just baseline it all" reflex the design fights.
- **Plain, not clever.** No emoji-as-signal in the machine surface, no scolding tone. The verdict is a
  measurement; write it like one.

Constraint `intentRef`s follow the same spirit: every blueprint traces to a **stated reason** a human
can evaluate, not a placeholder.

## RFC process (specification changes)

The blueprint format is governed by a widen-only ratchet — a revision may add expressive power but
never silently relaxes what an existing constraint enforces. Changes to the format go through a
numbered **RFC** so the reasoning is public and referenceable; see
[`rfcs/RFC-0001-process.md`](rfcs/RFC-0001-process.md). Code and non-format doc changes do not need an
RFC — a normal PR is enough.

## Development setup

The engine builds and tests inside a pinned Node 22 toolchain:

```sh
npm ci            # clean, lockfile-exact install
npm run build     # tsup + declaration emit → dist/
npm run typecheck # tsc --noEmit over the full tree
npm test          # the full vitest suite
```

Reproduce the self-gate locally with the commands in
[`docs/self-hosting.md`](docs/self-hosting.md).

## Reporting security issues

Do **not** open a public issue for a security report. Use GitHub's private vulnerability reporting; see
[SECURITY.md](SECURITY.md).
