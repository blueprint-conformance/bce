# Solo-steward ratification

A repository with one human can operate the full BCE policy lifecycle. Its decision is explicitly
**self-ratified**. This is authenticated stewardship, not independent review or independent replication.
The default remains an approving GitHub review by a non-author with current maintain/admin permission.

These additions describe the source checkout after the self-adoption change. The immutable npm
`bce-engine@0.3.0` release predates them; build this checkout to execute the commands below.

## Authorize the steward before the ceremony

Commit `.bce-governance.json` through the repository's normal protected PR process:

```json
{
  "schemaVersion": "1",
  "mode": "solo-steward",
  "steward": { "githubUserId": 12345 }
}
```

Use the numeric identity returned by GitHub, not a guessed ID. Numeric identity remains stable
when a login is renamed; the forge resolves current permission from the authenticated login. The solo ceremony reads this file from
the PR's **exact base commit** through GitHub. A candidate branch cannot authorize itself. The
steward must be the PR author, a GitHub `User`, and currently have maintain/admin permission. Team
repositories keep the default non-author review path; adding a second human does not automatically
change the committed policy.

## Prepare an authored blueprint locally

An authored contract can enter the same review flow without an LLM call:

```sh
node dist/cli.js review prepare --repo . \
  --blueprint .blueprints/example.blueprint.json \
  --new --proposal-id example-initial
```

For an already-approved contract, use `--base .blueprints/example.blueprint.json` instead of `--new`,
and supply a strictly higher `--candidate-version 0.2.0`. The proposal ID identifies the ceremony;
it can differ from the durable blueprint ID so later amendments get fresh immutable directories.
Preparation requires readable repository-local intent references and preserves the authored policy
losslessly, apart from the selected version and draft status. It refuses unrepresentable fields.
Authored packets carry the cited intent sources, extracted graph, and source proof; unrelated
repository files are bound by the worktree digest without copying their contents into the packet.

The packet, candidate, rendered review, and any later decision live under `.bce/proposals/<proposal-id>/`.
Preparation changes no governed policy. Commit the inputs before preparation: source changes outside
that quarantine make a decision or landing stale. The packet records the exact source commit and
trusted PR base. It must report `approval eligible` before any approval can be recorded.

Real source mutation manifests can be passed with `--mutation-manifest <path>`; their `blueprintRef`
must name the candidate version. Otherwise preparation discovers an exact-reference
`.blueprints/*.teeth-mutations.json` manifest. Every source mutant is executed in a temporary copy.
The packet binds observed mutant graphs for offline replay, which is not an authentication of those
observations. Landing re-executes the manifest against live source and requires an identical proof.
An evaluator-only packet without this proof remains blocked. No waiver or approval flag bypasses it.

## Record the concrete human decision

Review the packet and submit a GitHub **COMMENT** review on its exact PR head, with these bindings
and a substantive rationale. GitHub does not allow authors to approve their own pull requests.

```text
BCE-Review-Packet: sha256:<packetDigest>
BCE-Candidate: sha256:<candidateDigest>
BCE-Decision: approve
BCE-Approval-Role: <packet requirement role>
BCE-Approval-Stage: <packet requirement stage>
BCE-Review-Mode: self-ratified

I accept this exact policy as its solo steward. <Concrete reason for the decision.>
```

A deterministic weakening additionally requires `BCE-Accept-Weakening: true`. The normal team path
continues to require `APPROVED`, a non-author reviewer, and no self-ratification header. Both paths
reject bots, stale commits, stale bases, revoked permission, superseded reviews, and missing bindings.

Run `review decide --decision approve`, then `ratify` (or `amend` for existing approved policy),
using the same `--packet`, `--github-repo owner/repo`, `--github-pull N`, `--github-review ID`, and
`--review-mode self-ratified`. Landing also takes the candidate `--blueprint` (for amend, use the
installed `--blueprint` plus candidate `--replacement`) and saved `--decision` path.
Credentials come from `BCE_GITHUB_TOKEN` or `GITHUB_TOKEN`; never put them in committed files.
The GitHub assertion is fetched again immediately before landing. Commit the generated policy
transition through the normal required checks. No branch-protection bypass is part of this ceremony.

## Lifecycle truth and diagnosis

Ratification writes approved blueprint status, a new version, authenticated policy history, the
resulting blueprint digest, and an adoption record. Amendment advances the adopted reference too.
The record explicitly identifies `self-ratified` or `non-author-reviewed`.

`graduate` updates enforcement mode, graduation history, and adoption state under one policy lock.
Ratified adoption becomes `ratified-advisory` or `ratified-enforced`. Enforcement before ratification
is allowed and recorded as `enforced-unratified`; it never invents approval. A repeated graduation is
a no-op only if the existing mode record is coherent. Incomplete recovery retains the lock and blocks
the gate until attended repair.

`doctor` refuses contradictory mode, state, blueprint reference/status, review mode, history, or
bound output bytes. Missing lifecycle history remains a warning. It executes discovered source
mutation manifests instead of calling their constraints evaluator-only, and recognizes the exact
published pin read and installed by BCE's Lane-A workflow. A pin file alone does not prove CI uses it.
