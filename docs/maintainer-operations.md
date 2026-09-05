# Maintainer operations — one human, one visible queue

BCE currently has one human maintainer. The operating model must therefore protect the project
without pretending a second reviewer, support team, or always-on rotation exists. Required CI is the
merge authority. Public intake and response state stay visible on GitHub.

```text
external issue or PR
        |
        v
status:needs-triage  -- public maintainer response -->  accepted / needs-author / blocked / declined
        |                                                        |
        +-- no response after 168 hours --> daily audit RED       +-- rationale stays in the thread
```

The queue never auto-closes an item and the audit has read-only permissions. A red audit cannot
manufacture capacity; it makes an overdue response visible so the maintainer can answer honestly.

## Start in the right intake lane

| You have | Use | Smallest useful evidence |
|---|---|---|
| wrong verdict, crash, install failure, or docs defect | [bug or wrong verdict](https://github.com/blueprint-conformance/bce/issues/new?template=bug.yml) | exact BCE identity, safe minimal reproduction, command, exit code, observed/expected result |
| architecture boundary or adoption improvement | [capability proposal](https://github.com/blueprint-conformance/bce/issues/new?template=feature.yml) | one invariant, conforming/drifted pair, deterministic evidence, smallest credible proof |
| an uncoached adoption attempt | [independent adoption](https://github.com/blueprint-conformance/bce/issues/new?template=independent-adoption.yml) | success, failure, or abandonment with timings and relationship disclosure |
| a separately maintained implementation | [external implementation](https://github.com/blueprint-conformance/bce/issues/new?template=external-implementation.yml) | exact revision and machine-readable conformance report |
| an independent RED → fix → GREEN run | [witness attestation](https://github.com/blueprint-conformance/bce/issues/new?template=witness-attestation.yml) | exact source, commands, outcome, environment, and independence disclosure |
| a vulnerability | [private vulnerability report](https://github.com/blueprint-conformance/bce/security/advisories/new) | minimal private description first; never a public issue |

Blank issues remain enabled because a form must not become an accessibility or category gate. The
maintainer may ask the author to move only the missing facts into the thread; filing again is not
required.

## What the seven-day measure counts

The standing target applies to issues and pull requests opened by someone outside the configured
maintainer set after the policy activation time. A public issue comment or submitted pull-request
review by a configured human maintainer counts as the first response. Automatic labels, bot comments,
CI output, and the contributor's own follow-ups do not count.

The policy binds maintainers by GitHub's immutable numeric actor ID rather than a mutable login.
An authenticated maintainer can resolve their own ID with `gh api user --jq .id`; changing the
configured set is a visible governance change.

The read-only [`maintainer-operations` workflow](https://github.com/blueprint-conformance/bce/blob/main/.github/workflows/maintainer-operations.yml) runs
daily and after relevant issue/comment/review events. It reports four states:

- `on time` — the first response arrived within 168 hours;
- `within window` — no response yet, but the deadline has not passed;
- `overdue` — no qualifying response by the deadline; the audit exits `1`;
- `late` — a response eventually arrived after the deadline; the audit warns, while timestamps in
  the public thread and workflow history preserve the miss.

This is an observable response target, not a resolution promise or paid-support SLA. Security intake
has its own private handling target in [`SECURITY.md`](../SECURITY.md).

## Queue states

`status:needs-triage` is applied by the issue forms. After responding, the maintainer replaces it with
one state:

- `status:accepted` — the outcome fits BCE and is ready for work or review;
- `status:needs-author` — one bounded fact or revision is needed;
- `status:blocked` — accepted, but a named dependency or decision prevents progress;
- `status:declined` — closed with a public scope or tradeoff rationale.

The canonical names, descriptions, and colors live in [`.github/labels.json`](https://github.com/blueprint-conformance/bce/blob/main/.github/labels.json).
Every label referenced by an issue form or Dependabot is checked against that file in required CI;
the operational workflow additionally compares it to live GitHub labels. Extra community labels are
allowed, but a declared intake label cannot silently disappear.

## Pull requests

The pull-request template asks for the outcome, change class, exact verification, public claim delta,
limits, and DCO declaration. It does not ask the solo maintainer to obtain their own approval. A
policy, release, security, schema, blueprint, baseline, mode, or ownership change must be named as
such; required CI still cannot turn same-author work into independent review.

When a distinct second human accepts sustained code-owner and release responsibility, activate the
review ratchet described in [`governance-enforcement.md`](governance-enforcement.md). Until then, an
imaginary approver is not a guardrail.

## Reproduce the machinery

From a repository checkout:

```bash
node scripts/verify-contributor-operations.mjs
GH_TOKEN=<read-only-token> GITHUB_REPOSITORY=blueprint-conformance/bce \
  node scripts/verify-contributor-operations.mjs --live
GH_TOKEN=<read-only-token> GITHUB_REPOSITORY=blueprint-conformance/bce \
  node scripts/triage-slo.mjs
```

The first command is offline and runs in required CI. The latter two read current GitHub state and
never label, comment, close, assign, approve, or merge anything.
