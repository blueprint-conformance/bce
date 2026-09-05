## Summary

What user-visible or architectural outcome does this change produce?

## Change class

- [ ] Code, tests, or documentation within existing policy
- [ ] Governed policy/release/security/ownership change (explain the authority and compatibility below)
- [ ] Normative specification change with a linked RFC

## Verification

List the exact commands and RED/GREEN or refusal behavior you exercised. The protected GitHub checks
are the merge authority; do not claim independent review when the author and maintainer are the same
person.

- `npm run typecheck`:
- relevant focused tests:
- `node dist/cli.js gate --repo . --repo-name blueprint-conformance/bce`:
- required PR checks:

## Public claims and limits

Which README, documentation, package, schema, evidence, or status-ledger claim changed? State what
this work still does not establish. Write “none” when neither side changes.

## Contribution declaration

- [ ] This is one logical change.
- [ ] Every commit carries a DCO sign-off (`git commit -s`).
- [ ] I did not weaken a blueprint, grow a baseline, or downgrade enforcement to clear a red check
      without declaring that policy change above.
