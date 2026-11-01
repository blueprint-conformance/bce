# Adoption lifecycle

The shortest safe path from “new repository” to a self-correcting BCE gate is:

1. `bce doctor --repo .` diagnoses prerequisites without writing.
2. Have the current coding agent use `bce author` to draft one supported rule from stated intent.
   [`bce propose`](ai-first-review.md) is an optional provider-backed alternative with bounded
   disclosure and a deterministic review packet in quarantine. Use
   [`bce onboard`](onboarding.md) for complete CI,
   agent-context, and MCP wiring. The lower-level `bce adopt` command remains available for
   policy-only adoption with an exact published `bce-engine@X.Y.Z` pin.
   Adoption is advisory and proposal-only; generated CI has read-only permissions.
3. Fix scope and teeth findings. `bce teeth ... --require-extractor-real` marks a blueprint ready
   only when every constraint has extractor-real teeth. Any evaluator-only remainder needs a
   committed, exact-reference reviewed waiver; trivial or indeterminate constraints still refuse.
4. A human steward reviews the exact packet in a pull request. `bce review decide` resolves identity,
   current maintain/admin permission, rationale, time, commit, and review state from GitHub; `bce
   ratify` re-authenticates that decision, digest-checks the inputs, bumps the version, and appends
   policy history and coherent adoption state. A one-human repository may explicitly configure
   [solo-steward ratification](solo-steward-ratification.md) on the trusted base; its GitHub COMMENT
   review is labelled self-ratified. Local self-attestation flags are not accepted. The resulting landing commit needs
   the repository's normal required checks and configured human-review policy before merge.
5. Use `bce gate` on every pull request. Agents use MCP `doctor_repository`, `run_gate`,
   `assess_teeth`, and `check_baseline` to diagnose and repair code. MCP cannot ratify or amend.
6. Existing debt may be captured once through a reviewed baseline. Thereafter `bce baseline --check`
   reports new debt and emits a shrink-only patch; it never silently grows the wall.
7. Graduate advisory to enforced only through the existing attended graduation proof. Configure and
   externally verify branch protection; committed configuration alone is not proof of enforcement.
8. Amend approved policy with a higher draft version, exact semantic baseline, review packet,
   authenticated approving decision, extractor-real teeth proof, and append-only history. Relaxation
   is visible in the packet and has no approve-anyway flag.
9. Before changing an engine pin, run `bce upgrade --check --candidate-engine X.Y.Z --repo .`.
   The command is read-only and refuses ranges, malformed blueprints, zero discovery, and floor misses.

Exit semantics are uniform: 0 means the requested check passed, 1 means a gradeable violation or
maintenance action exists, and 2 means BCE refused to claim a result. Never reinterpret refusal as
success, and never fix a code violation by silently weakening policy.

## Local attempt and repeat-use collection

Maintainers can record actual adoption attempts without losing unfinished, failed, or abandoned
work from the denominator. This is an **opt-in source-checkout workflow**, not an installed npm
command, telemetry service, or independent-witness acceptance mechanism. In a BCE checkout, run
`npm ci` and `npm run build`; the collector uses that built engine and the repository's research
schemas. Nothing is sent over the network by the collector.

Start a record when a real attempt starts. Prepare a local JSON input with these fields, using a
pseudonymous participant ID and the facts disclosed by that participant:

```json
{
  "attemptId": "unique-attempt-id",
  "participantId": "participant-pseudonym",
  "relationship": {
    "disclosed": "Describe the actual relationship to the project",
    "authorControlledMachine": true,
    "authorOperatedRun": true
  },
  "source": { "kind": "git-commit", "identity": "<exact 40-character BCE source commit>" },
  "environment": {
    "os": "<participant OS>", "architecture": "<participant architecture>",
    "node": "<actual participant Node version, vMAJOR.MINOR.PATCH>", "installSource": "source"
  },
  "consent": { "storeLocally": true, "publishRecord": false }
}
```

Replace the placeholders and relationship flags with the actual disclosed facts; this example is
not a participant record. `npm-exact` and `github-action-commit` are also supported install-source
values from the existing [adoption-record schema](../research/adoption-record.schema.json).
Local attempts record the participant's actual stable Node version at the engine's Node 22-or-newer
floor, including Node 24. This local runtime disclosure is not independent-witness eligibility:
the [witness kit](launch/witness-kit.md) and canonical adoption-record schema still require Node 22.
Do not replace an observed Node 24 version with Node 22 to make a record eligible.
Local storage requires explicit consent. Publication is deliberately false: review and publication
consent belong to the separate existing adoption-record process.

```bash
node scripts/adoption-attempts.mjs start \
  --store /path/to/collector/.bce/adoption-attempts --input /private/path/start.json
```

The command creates an exclusive attempt directory and a timestamped `started` event. All later
events append to its hash chain; existing events are never overwritten. There is no delete,
reclassify-as-independent, or automatic acceptance command. An attempt with no finish event is
reported as `unfinished`. Starting another attempt does not erase the first one.

To record a gate use, first produce a real gate document on the participant repository:

```bash
node /path/to/bce/dist/cli.js gate --repo /path/to/participant-repo \
  --report-json /private/path/gate.json
```

Prepare a use input pointing to the actual gate and blueprint files:

```json
{
  "gateFile": "/private/path/gate.json",
  "blueprintFile": "/path/to/participant-repo/.blueprints/app.blueprint.json",
  "repositoryId": "repository-pseudonym",
  "constraintId": "actual-constraint-id"
}
```

```bash
node scripts/adoption-attempts.mjs use --store /path/to/collector/.bce/adoption-attempts \
  --attempt unique-attempt-id --input /private/path/use.json
```

The collector reads and hashes the actual file bytes, validates the report against BCE's published
report schema, checks the blueprint/report identity and requested rule, and stores private copies
under `artifacts/<sha256>.json`. Each use links the report revision, rule, blueprint, and gate
artifact. Non-Git/`unpinned` reports are refused for use collection; the attempt still remains in the
denominator and may finish as failed or abandoned. Refusal gate artifacts with a selected exact
revision may be retained, but do not count as gradeable use.

Finish with a JSON input such as `{"outcome":"failure","reason":"Describe the actual stopping point"}`;
supported outcomes are `success`, `failure`, and `abandoned`. A claimed success requires at least
one gradeable gate artifact, but is still the participant's claim, not proof of the complete
independent-adoption journey. A finished attempt cannot be reopened: start another attempt for
later use by the same participant and repository pseudonyms.

```bash
node scripts/adoption-attempts.mjs finish --store /path/to/collector/.bce/adoption-attempts \
  --attempt unique-attempt-id --input /private/path/finish.json
node scripts/adoption-attempts.mjs summary --store /path/to/collector/.bce/adoption-attempts
```

The summary keeps `localClaims` separate from `canonicalProgram`. Its denominator covers consented
attempts explicitly started in this ledger, not all users or unrecorded attempts. It includes every recorded
attempt, including unfinished, failed, and abandoned attempts. Claimed repeat use requires another
gradeable gate artifact on a **different Git revision** for the same participant/repository pair.
Different rules or report files at the same revision do not inflate repeat-use counts. The summary
links each counted revision to its event, rule, gate, and blueprint. Author-operated observations
remain explicitly disclosed and never add independent witnesses.

Before reporting canonical counts, the collector runs the existing
[`validate-adoption-program.mjs`](../scripts/validate-adoption-program.mjs). It never changes
`research/adoption-records`, `research/adoption-program.json`, `ATTESTATIONS.md`, or
`release-state.json`. Independent eligibility, inspectable public evidence, publication consent,
and adjudication remain governed by the existing adoption-record schema and validator.

The limits are deliberate: hashes prove byte integrity and internal consistency, **not** origin,
actual execution, participant independence, or whether supplied facts were fabricated. A Git SHA
in a gate report does not prove a clean worktree; a matching blueprint ID/version does not prove
that the gate executed those exact blueprint bytes. Manual history rewriting or whole-attempt
deletion cannot be detected by this local collector. Review evidence before making public claims.
Use no contact details in IDs and keep the private ledger out of version control; stored reports
and blueprints can contain private repository information.

The tool uses exclusive files with private permissions, refuses linked/nonregular artifact files
and linked store directories, and limits each artifact to 4 MiB, each event to 64 KiB, and a summary
to 10,000 events. A malformed, missing, changed, or out-of-order event/artifact refuses the summary;
it does not quietly disappear from the denominator. Success exits 0; invalid input or evidence
exits 2. The event schema is [adoption-attempt.schema.json](../research/adoption-attempt.schema.json).
