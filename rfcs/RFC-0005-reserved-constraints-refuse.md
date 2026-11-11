# RFC-0005: Reserved and malformed constraints refuse instead of passing

Status: draft
Author(s): bce maintainers, prepared with an AI coding agent

Tracking issue: [#157](https://github.com/blueprint-conformance/bce/issues/157)

## Summary

A blueprint that contains a reserved constraint (`requiredEvidence`, `minimumMetric`,
`customPolicy`) or a malformed enforcing constraint (SPEC §3.3) passes today with score 100 and gate
exit 0, provided at least one other constraint runs and passes. The skipped clause never counts as
satisfied, but the verdict still says `pass`, and the only trace is a line in the report summary.
This RFC makes a report that skipped such a constraint **indeterminate**: a structural refusal, exit
2, the same outcome bce already gives unknown and run-only constraints in a static gate. A green gate
would then mean every authored clause was checked, not only some of them.

## Motivation

- **The verdict is wider than what was checked.** SPEC §3.2 says reserved types "MUST NOT count as
  satisfied" and "MUST NOT count as enforcing for the empty-evaluation floor (§6.3)". It does not
  stop the *verdict* from passing when another constraint ran. A `critical` `customPolicy` authored
  with `bce author --constraint customPolicy:<ref>` is therefore never enforced, and the gate stays
  green.
- **The gate is already inconsistent about this.** An unknown constraint type (newer than the
  engine) and a run-only constraint in a static gate both become refusals (`src/gate.ts`). A
  reserved type in the same position is graded silently.
- **The public claim reads wider than the behaviour.** STATUS.md says "unsupported critical analysis,
  unknown constraint … cannot pass", and the summary itself says "skipped, not passed". Readers take
  both to cover this case.
- **Malformed shapes have the same gap.** SPEC §3.3 treats an enforcing type without its argument
  (`forbiddenFile` without `path`, `forbiddenDependency` without `to`, `requiredComponent` without
  `component`) as skipped and says it SHOULD be refused at authoring. `evaluate` still passes it when
  another constraint runs.

## Design

1. **Evaluation.** When `evaluate` records a reserved-skipped or a §3.3 malformed-skipped constraint,
   the report becomes `verdict: "indeterminate"`, with one refusal per skipped constraint:

   ```text
   constraint <id> (<type>) is reserved / malformed and cannot be graded by engine <version>;
   remove it until the type is implemented
   ```

   Conditional skips (§7.3, a constraint that does not apply to the scanned scope) are **not**
   affected.
2. **Gate.** `runGate` adds the same entry to `refusals`, so `outcome` is `refusal` and the exit code
   is 2, exactly as for unknown and run-only constraints. Under the existing doctrine, a baseline never
   suppresses a refusal.
3. **Advisory mode.** No change. A refusal is structural and stays exit 2 in every mode, as unknown
   and run-only refusals already do. To keep a placeholder for a future type, drop the clause from the
   blueprint and track it in an issue.
4. **Authoring.** `bce author` and `bce validate` warn on reserved types, and refuse §3.3 malformed
   shapes (the SPEC's existing SHOULD).
5. **SPEC.** §3.2 gains: "A report that records a reserved-skipped constraint MUST be indeterminate."
   §3.3 gains the same sentence for malformed-skipped constraints. §6.3 is unchanged.

## Widen-only check

This narrows what *passes* and adds no case where something that failed now passes. Every blueprint
that fails or refuses today still does. Blueprints that passed only because a reserved or malformed
clause was ignored now refuse, which is a tightening. It never silently relaxes an existing
constraint's enforcement.

## Alternatives considered

- **Refuse only at `high`/`critical` severity.** This keeps low-severity reserved clauses as quiet
  notes. Rejected for now: severity changes the score weight, not whether a clause was checked, and
  "green means every clause was checked" is simpler to explain. It could be revisited if adopters rely
  on low-severity markers.
- **Schema-reject reserved types until they are graded.** This is the strictest option. Rejected
  because it would make existing, valid blueprints unparseable, and under the version-skew rules that
  is a worse failure than a named refusal.
- **Keep §3.2 and reword STATUS.** This is honest and costs nothing in the engine, but the gate would
  stay green for clauses it never checked, which is the outcome bce exists to prevent.

## Compatibility

- Engine: a minor release. No new constraint vocabulary, so `minEngineVersion` floors are unaffected.
  Blueprints that carry reserved or malformed constraints change from `pass` to a refusal (exit 2) in
  every mode. The remedy is to remove the clause or fix its arguments.
- Lane A: the pin ceremony grades the activation PR with the old engine, so this repository's own
  blueprints must carry no reserved or malformed clause before the release. A pre-release audit is part
  of the implementing PR.
- Consumers: release notes and a migration note in `docs/adopt-existing-repo.md` list the three
  reserved types and the malformed shapes,.

## Open questions for the maintainer

- Should `bce doctor` report reserved or malformed clauses as not-ready? Recommendation: yes.
