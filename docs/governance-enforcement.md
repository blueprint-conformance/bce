# Governance enforcement

BCE distinguishes a code repair from a policy change. Changes to blueprints, baselines,
adoption mode, engine pins, CI, schemas, release metadata, or ownership are policy changes.
Creating or growing a baseline, changing enforced mode to advisory, deleting a constraint,
lowering severity, or deleting a governance workflow is a policy relaxation.

`classifyPolicyChanges()` provides the deterministic classifier used by automation. It is
conservative: a known relaxation is labelled explicitly; an ambiguous protected-file edit still
requires owner review. Ratification and amendment are attended CLI ceremonies and are not exposed
through the MCP server. A weakening amendment additionally requires `--accept-weakening`.

Repository files cannot turn on GitHub branch protection themselves. Before calling a branch
governed, an administrator must apply and verify these settings on the default branch:

- require a pull request and at least one approval;
- require review from CODEOWNERS and dismiss stale approvals;
- require `test`, `self-gate`, `leakage-gate`, and `launch-readiness-gate` checks;
- prevent bypass and force-push for maintainers;
- restrict direct deletion and require conversation resolution.

Until those settings are externally verified, CODEOWNERS and workflows are enforcement intent,
not proof that the hosting platform enforces review. Evidence bundles must state that distinction.

