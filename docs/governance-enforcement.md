# Governance enforcement

BCE distinguishes a code repair from a policy change. Changes to blueprints, baselines,
adoption mode, engine pins, CI, schemas, release metadata, or ownership are policy changes.
Creating or growing a baseline, changing enforced mode to advisory, deleting a constraint,
lowering severity, or deleting a governance workflow is a policy relaxation.

`classifyPolicyChanges()` provides the deterministic classifier used by automation. It is
conservative: a known relaxation is labelled explicitly; an ambiguous protected-file edit still
requires owner review. Ratification and amendment are attended CLI ceremonies and are not exposed
through the MCP server. Both require a fresh deterministic review packet and an approving decision
derived from a live GitHub pull-request review and a current `maintain`/`admin` permission lookup.
Relaxation requires an explicit digest-bound weakening acknowledgement in that review; there is no
approve-anyway flag. The packet also classifies the protected-file diff from the PR base and blocks
when the base cannot be established.

Repository files cannot turn on GitHub branch protection themselves. A team with at least two
available reviewers should apply and verify these settings on the default branch:

- require a pull request and at least one approval;
- require review from CODEOWNERS and dismiss stale approvals;
- require `test`, `self-gate`, `leakage-gate`, and `launch-readiness-gate` checks;
- prevent bypass and force-push for maintainers;
- restrict direct deletion and require conversation resolution.

Until those settings are externally verified, CODEOWNERS and workflows are enforcement intent,
not proof that the hosting platform enforces review. Evidence bundles must state that distinction.

Current state (verified through GitHub's API on 2026-09-03): `main` requires the repository's seven CI
checks, requires the branch to be current, enforces the checks for admins, requires conversation
resolution, and prevents force-push and deletion. Required approving reviews,
CODEOWNER review, and release-environment reviewers are disabled because the project has one human
maintainer. This is the operable solo-safe state: automation cannot be bypassed, but the repository
does not pretend a second human exists or configure a guard that prevents all releases.

Independent review remains unestablished. The fix-forward activation condition is a distinct human
who accepts code-owner and release-review responsibility. At that point, add CODEOWNERS and enable
one non-author approval plus release-environment review together, then record an exercised review.
