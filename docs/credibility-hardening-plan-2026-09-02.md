# BCE credibility hardening plan — 2026-09-02

This plan converts the independent gap report dated 2026-09-02 into an execution and evidence
ledger. It does not turn work that only an independent person can perform into maintainer-operated
evidence. Repository changes, repository-owner settings, and external-human outcomes are tracked as
different deliverables throughout.

## Operating rules

1. Fix forward. Published artifacts are never rewritten, deleted, or silently relabelled.
2. Security only ratchets upward. A setting is changed only after repository code is compatible with
   the stricter setting, and the live setting is re-read after mutation.
3. Claims follow evidence. If a definition of done depends on a person or implementation outside the
   maintainer's control, the public status remains unestablished until that evidence exists.
4. Every automated gate gets a negative control. A green check is evidence only after the check has
   demonstrated that it can reject the regression it names.
5. Release changes land in dependency order: source and tests, repository controls, a new immutable
   release, then consumer verification. Existing `v0.1.5` evidence remains historical evidence.
6. No launch, benchmark, interoperability, or independence claim is inferred from downloads, CI,
   maintainer-operated repositories, model-operated runs, or self-conformance.

## Current-state baseline

The following was re-read from GitHub/npm and the `main` tree on 2026-09-02 before implementation:

- `v0.1.5` exists, but the GitHub release reports `immutable: false`.
- private vulnerability reporting is disabled, while `SECURITY.md` names it as the only channel.
- Actions are unrestricted and `sha_pinning_required` is false; every third-party Action reference
  in the tree is a mutable major tag.
- secret scanning, push protection, and Dependabot security updates are disabled.
- `main` requires six CI checks but zero approving reviews; the `release` environment has no
  protection rules.
- `bce-engine@0.1.5` resolves, but its runtime dependencies are semver ranges.
- `ATTESTATIONS.md` records zero independent witnesses.

This baseline is expected to go stale as work lands. Completion is determined from the evidence
commands below, never from this paragraph.

## Workstream 1 — immutable releases and immutable generated Actions (P0)

**Outcome.** New releases become immutable at the repository boundary, and every workflow generated
or recommended by BCE identifies executable Action code by a full commit SHA. Human-readable release
tags may remain in prose, but never in an executable `uses:` line.

**Implementation.** Enable GitHub immutable releases; SHA-pin BCE and third-party Actions in the
onboarding generator, root examples, composite Action, and repository workflows; retain the release
tag beside a pin as an audit comment; add a dependency-free policy gate that rejects mutable
third-party `uses:` values; remove the false claim that historical `v0.1.5` is immutable unless the
live API proves it became immutable after the repository setting changed.

**Acceptance evidence.** The immutable-releases API returns enabled; the release API reports the
new release immutable; the policy gate's negative control rejects a tag pin; generated workflows
contain only 40-character SHAs; a non-destructive tag-protection verifier confirms that a released
tag is covered by immutability. Deliberately moving a public release tag is not an acceptable test.

**Dependencies.** Complete before restricting allowed Actions or enabling mandatory SHA pinning.

## Workstream 2 — real private security reporting (P0)

**Outcome.** A reporter has two documented private paths: GitHub private vulnerability reporting and
a monitored fallback mailbox.

**Implementation.** Enable private vulnerability reporting through the repository API; amend
`SECURITY.md` with the fallback mailbox, expected acknowledgement, encryption option if one is
actually operated, and explicit instruction not to include secrets in ordinary email; add a claim
check that prevents the document from calling a disabled feature the only channel.

**Acceptance evidence.** The live API returns `enabled: true`; the Security tab exposes “Report a
vulnerability” to a non-maintainer; a message to the fallback address receives or is manually
acknowledged through the monitored incident queue. The final two checks require a non-maintainer and
mailbox operator; they cannot be simulated by CI.

## Workstream 3 — independent adoption programme (P0)

**Outcome.** At least three uncoached installations occur in repositories the maintainer does not
control, with failures and abandonments preserved.

**Implementation.** Freeze an intake schema before recruitment; version a minimal witness kit;
record repository ownership, coaching/contact boundaries, start/end timestamps, time-to-first-RED,
help requests, failures, abandonment, and consent; validate attestations mechanically without
awarding independence automatically; publish the recruitment path.

**Acceptance evidence.** Three accepted records from distinct, unaffiliated repository owners, each
linked to public or independently inspectable run evidence and adjudicated against the predeclared
criteria. `ATTESTATIONS.md` remains zero until those records exist.

**External dependency.** Maintainers can build and recruit through the programme, but cannot create
the qualifying outcome themselves.

## Workstream 4 — non-author review and release approval (P0)

**Outcome.** Policy and releases cannot be changed solely by their author.

**Implementation.** Define the sensitive path set in `CODEOWNERS`; document the non-author rule and
emergency forward-fix procedure; add a second trusted human only after explicit acceptance; then
require one approval, dismiss stale approvals, require Code Owner review, prevent author approval,
and require an attended reviewer on the `release` environment.

**Acceptance evidence.** GitHub reports at least two trusted maintainers; a test PR authored by one
cannot merge without the other's approval; stale approval is dismissed after a sensitive change;
a release job waits for an eligible non-author reviewer. Until then, public language is “protected
by required CI,” not “independently reviewed.”

**External dependency.** Selecting and onboarding a trusted second maintainer is a human governance
decision. Enabling a rule that deadlocks the solo repository is not completion.

## Workstream 5 — statistically meaningful AI evaluation (P1)

**Outcome.** The evaluation estimates reliability and comparative effect instead of documenting one
event per arm.

**Implementation.** Finalize and freeze a preregistration with fixed model snapshots, isolated clean
configuration, randomized task order, at least 30 trials per arm, explicit exclusion/abandonment
rules, and analysis code. Capture tool-selection, task completion, policy mutation, tokens, cost,
latency, failure class, and confidence intervals. Keep raw attempt-level records append-only.

**Acceptance evidence.** A preregistration digest predates runs; every planned trial has a raw record
or declared failure; analysis reproduces from raw data; confidence intervals and denominators are
published; no causal/uplift claim exceeds the design.

## Workstream 6 — real-model coverage per named harness (P1)

**Outcome.** Each explicitly supported harness has separately reported behavioral evidence.

**Implementation.** Define capability-based harness support; run the same frozen task/evaluator for
Codex, Claude, Cursor, and generic Agent Skills clients at named client/model versions; isolate user
configuration; record skill discovery, MCP selection, completion, and failure. Replace “any agent”
artwork and prose with capability-specific wording until all named rows pass.

**Acceptance evidence.** Per-harness trial records and summary rows exist with no aggregation that
hides a failing client. A deterministic layout proof is labelled configuration compatibility, not
model behavior.

**External dependency.** Requires legitimate access to each named client and its model/API service.

## Workstream 7 — supply-chain policy ratchet (P1)

**Outcome.** The repository executes only explicitly allowed, commit-pinned Actions and continuously
checks that posture.

**Implementation.** Pin every third-party Action to a reviewed SHA with a version comment; add
Dependabot configuration for npm and GitHub Actions; add a dependency-free workflow-policy checker
and negative controls; restrict Actions to GitHub-owned plus selected verified Actions; require SHA
pinning; enable secret scanning, push protection, validity checks where available, and Dependabot
security updates.

**Acceptance evidence.** Tree policy checker passes and rejects representative mutable/unknown
Actions; live Actions permissions report selected allowlisting and SHA pinning; live repository
security fields report enabled; Dependabot configuration validates and security updates are enabled.

## Workstream 8 — reproducible grading dependency identity (P1)

**Outcome.** An exact BCE version resolves the same runtime parser stack, and evidence identifies the
environment needed to reproduce a report.

**Implementation.** Pin runtime dependency versions exactly (or bundle them after measuring bundle
trade-offs); record package-lock SHA-256, Node and npm versions, OS, architecture, extractor provider
and provider version in evidence; version the evidence schema compatibly; add independent clean
install comparison using the registry tarball and lock material published for the release.

**Acceptance evidence.** Two clean installs on separate supported runners resolve identical runtime
dependency graphs and produce identical normalized report hashes for the same fixture; evidence
records carry every declared identity field; schema and verifier negative controls reject malformed
identity data.

## Workstream 9 — release reruns deterministic AI adoption proof (P1)

**Outcome.** A release cannot publish while the deterministic Agent Skills/MCP adoption proof is red.

**Implementation.** Add `npm run test:ai-adoption` to the pre-publish gate, keep paid/model-driven
evaluation opt-in and explicitly outside the release guarantee, and add a release-policy self-test
that removes the step in a fixture copy and requires rejection.

**Acceptance evidence.** Release dry-run logs show the deterministic proof executed at the candidate
commit; the negative control rejects a release workflow missing the command.

## Workstream 10 — held-out detection and scale evaluation (P1)

**Outcome.** Detection quality and performance are measured on independently annotated, held-out,
real repository cases rather than only maintainer-authored fixtures.

**Implementation.** Freeze sampling and annotation protocols; require two annotators and adjudicate
disagreements; keep the held-out labels inaccessible to engine development; report precision,
recall, false-positive, refusal, unsupported-analysis, and per-language/per-constraint rates; add
large-monorepo and adversarial-syntax performance tracks with defined resource limits.

**Acceptance evidence.** Dataset provenance, annotation agreement, exclusions, attempt-level output,
analysis scripts, confidence intervals, and performance distributions are reproducible. Python is
reported separately and remains line-oriented until a structured provider ships.

**External dependency.** Independent annotation must come from people who did not author the engine
or the evaluated fixtures.

## Workstream 11 — MCP compatibility and measurable SLO (P2)

**Outcome.** Supported MCP protocol/client versions are verified beyond BCE's hand-written happy
path, with a measurable startup/discovery objective.

**Implementation.** Decide from measurement whether to adopt the official TypeScript SDK or retain
the thin protocol shell; run the upstream Inspector/conformance surface; add version negotiation,
startup, cancellation, malformed JSON-RPC, notifications, oversized input/result, EOF, backpressure,
and client-matrix tests; document supported protocol versions and an observed startup/discovery SLO.

**Acceptance evidence.** Inspector/conformance output and named stable/current Codex client results
are archived; every failure path is asserted by exit/protocol outcome; latency percentiles include
runner and sample size. Replace “frictionless always” with measured language.

## Workstream 12 — release-era documentation truth and claim gate (P2)

**Outcome.** Public documents agree with registry, schema, release, and integration reality.

**Implementation.** Correct `ROADMAP.md`, `STATUS.md`, self-hosting text, GitLab status, listing status,
and every executable example; add a cross-document claim manifest and checker for version, release,
Action SHA, schema availability, integration status, witness count, and governance wording; give the
checker negative controls.

**Acceptance evidence.** The claim checker passes the tree and rejects a stale-version, false-
immutability, false-independence, and dormant-marker probe. Every “runs” statement resolves to a
tested file, URL, artifact, or live setting.

## Workstream 13 — distribution and discovery (P2)

**Outcome.** Supported listings are actually submitted and clean-account installation funnels are
measured without treating downloads as users.

**Implementation.** Select only marketplaces the project can support; submit their reviewed listing
materials; record submission and review state; test install/discovery from a clean account; define
funnel events from listing view through first RED and subsequent GREEN, with privacy and retention
rules. Mark unsubmitted surfaces as drafts.

**Acceptance evidence.** Public listing URLs and review outcomes exist; clean-account recordings/logs
show install and first success; funnel denominators and abandonment are reported. Repository work can
prepare artifacts but cannot claim submission before the marketplace accepts them.

## Workstream 14 — external specification implementation (P2)

**Outcome.** A separately maintained engine consumes the schemas and passes the public vectors.

**Implementation.** Stabilize a language-neutral conformance runner contract, publish versioned
vectors and expected exits, document how external implementers submit independently reproduced
results, and preserve implementation identity. Keep `v1alpha1` until the milestone is real.

**Acceptance evidence.** Source and release of an implementation outside this repository and outside
project-maintainer control; clean runner output against the versioned vector set; independently
reproducible result and maintainer identity. A second BCE-owned implementation does not qualify.

## Workstream 15 — portability and signed evidence identity (P3)

**Outcome.** Supported operating environments are explicit and tested, and CI provenance can bind an
evidence bundle to a producer without conflating identity with hash integrity.

**Implementation.** Add a bounded OS/Node matrix (Ubuntu/macOS/Windows and supported Node lines),
shell/path tests, proxy and enterprise-registry fixtures, offline/restricted-network tests with clear
expected refusals, and performance budgets. Add opt-in keyless signing for release evidence using
OIDC with least privileges and verification instructions; retain unsigned local evidence support.

**Acceptance evidence.** Matrix jobs and restriction tests pass at named versions; unsupported
combinations fail with documented errors; a release evidence bundle verifies both its hash chain and
keyless signature/issuer constraints; documentation states that hashes prove integrity while
signatures can add producer identity.

## Dependency order and release boundaries

The implementation order is deliberately stricter than priority labels:

1. Workstreams 1 and 2: remove actively misleading security conditions.
2. Workstreams 7 and 9: harden the execution and release boundary before another release.
3. Workstreams 8 and 12: make the next artifact reproducible and all claims internally coherent.
4. Workstream 11 and the repository-owned portions of 15: expand compatibility evidence.
5. Workstreams 3 and 4: recruit real humans and activate controls only when they do not deadlock the
   project.
6. Workstreams 5, 6, and 10: execute preregistered evaluation, preserving all failed attempts.
7. Workstreams 13 and 14: complete third-party distribution and interoperability outcomes.

A new release is warranted after streams 1, 2, 7, 8, 9, and 12 are green. Streams that require
independent people remain openly incomplete; they do not delay security corrections, and the new
release must not imply they are complete.

## Completion ledger

For each workstream, the close-out record must contain: implementation commit, relevant test command
and output, negative-control output, live-setting/API evidence where applicable, external evidence
links where applicable, remaining limitations, and the exact public claim that the evidence permits.
An unchecked box, absent external record, or setting observed only indirectly means “not complete.”
