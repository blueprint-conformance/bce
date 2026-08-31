# Blueprint Conformance — Engine Specification

**apiVersion**: `blueprint-conformance/v1alpha1`
**Status**: draft (v1alpha1 — pre-1.0; see §10 for the versioning policy that governs change)

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**,
**SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be
interpreted as described in BCP 14 (RFC 2119 / RFC 8174) when, and only when, they appear in
all capitals.

This specification is **implementation-neutral**: it defines the artifacts, semantics, and
contracts a conforming Blueprint Conformance engine implements. `bce-engine` (this repository)
is the reference implementation; nothing here depends on TypeScript, Node.js, or any specific
extractor technology except where explicitly marked as a property of the reference
implementation.

---

## 1. Overview and terminology

| Term | Meaning |
|---|---|
| **Blueprint** | An authored, versioned, human-reviewed declaration of a subsystem's INTENDED architecture: components, relationships, and machine-checkable **constraints**. |
| **Observed graph** | A machine-extracted graph of a repository's ACTUAL architecture (components + real dependency/call edges), with a mandatory coverage honesty envelope. |
| **Conformance run** | The deterministic evaluation of a blueprint against an observed graph, producing a scored, evidenced **compliance report**. |
| **Gate** | The CI-facing mode: discover blueprints in a repository, evaluate those a change touches, and fail the build on any non-pass verdict. |
| **Evidence record** | One immutable, hash-chained link in the append-only ledger of conformance runs. |
| **Enforcing constraint** | A constraint type the engine grades against evidence and can redden. |
| **Reserved constraint** | A constraint type that is part of the taxonomy but not yet graded: it MUST be recorded as *skipped*, and MUST NOT be treated as satisfied. |

The engine is a **conformance engine, not a compiler**: it never modifies the repository it
grades. Its outputs are reports, evidence, and *proposed* remediation objects (§12).

---

## 2. Artifact model and identity

1. Every authored artifact MUST declare `apiVersion: "blueprint-conformance/v1alpha1"` and a
   `kind` of either `EngineeringBlueprint` (per-repository) or `PortfolioBlueprint`
   (fleet-level). An artifact with an unrecognized `kind` MUST be rejected (fail-closed),
   never silently ignored.
2. Authored artifact files use the suffix **`.blueprint.json`**. The default discovery
   directory for gate mode is **`.blueprints/`** at the repository root; discovery is
   recursive, MUST exclude `node_modules` and `.git`, and MUST produce a deterministic
   (sorted) ordering.
3. The normative structural contracts are the published JSON Schemas (§14):
   - `engineering-blueprint.schema.json`
   - `portfolio-blueprint.schema.json`
   - `compliance-report.schema.json`
   - `evidence-record.schema.json`
   - `architecture-graph.schema.json`
   - `remediation-work-order.schema.json`

### 2.1 Authored-artifact structural floor (EngineeringBlueprint)

An `EngineeringBlueprint`:

- MUST reject unknown top-level keys (a typo in the source-of-truth artifact is a hard
  validation error, never a silent no-op).
- MUST carry `metadata.id` (non-empty), `metadata.version` (semver `x.y.z`), and
  `metadata.status` ∈ `draft | proposed | approved | deprecated | retired`.
- MUST carry `intentRefs` with **at least one** entry — every blueprint traces to at least one
  business intent.
- MUST carry `constraints` with **at least one** entry — a blueprint that declares zero
  constraints enforces nothing and MUST be rejected at authoring/validation time.
- MAY carry an `extraction` block selecting the extraction profile and scan surface; absent,
  the engine's documented historical default profile applies.
- MAY carry `minEngineVersion` (semver `x.y.z`) — the minimum engine version the blueprint
  requires (§8.1).

A `forbiddenPattern` constraint MUST declare a non-empty `pattern` that (a) compiles as a
regular expression and (b) passes the engine's unsafe-pattern guard (length cap +
catastrophic-backtracking shape rejection). An invalid or unsafe pattern is a **hard
validation error at authoring time** — never an evaluate-time skip, and never a live
denial-of-service sink. *(This refinement is enforced by the engine but is beyond the
mechanical expressiveness of the published JSON Schema — see §14.2.)*

### 2.2 PortfolioBlueprint

A `PortfolioBlueprint` additionally:

- MUST declare `governance` (fleet version, skew grace days, minimum-member floor),
  `members` (≥ 1), and `fleetConstraints` (≥ 1, same element type as per-blueprint
  constraints).
- MUST declare `extraction` explicitly — a fleet artifact MUST NOT silently inherit one
  subsystem's scan defaults across N repositories.
- MUST declare `coverage.unsupported` with at least one entry — portfolio membership requires
  a DECLARED honest envelope; an artifact claiming blanket coverage MUST be rejected at
  authoring time.

---

## 3. Constraint taxonomy — 11 types

The taxonomy has **eleven** constraint types: **eight enforcing** and **three reserved
(explicit-skip)**. The enum is **widen-only** (§10): it only ever gains members.

| # | Type | Class | Evidence class | Graded against |
|---|---|---|---|---|
| 1 | `requiredComponent` | ENFORCING | staticAst | observed component set |
| 2 | `requiredDependency` | ENFORCING | staticAst | observed components + edges |
| 3 | `forbiddenDependency` | ENFORCING | staticAst | observed import edges |
| 4 | `forbiddenPath` | ENFORCING | staticAst | extracted component paths |
| 5 | `forbiddenFile` | ENFORCING | staticAst | raw scanned-file set |
| 6 | `forbiddenEgress` | ENFORCING | staticAst | observed egress (network-call) edges |
| 7 | `forbiddenPattern` | ENFORCING | staticAst | per-line content-pattern scan |
| 8 | `behavioralInvariant` | ENFORCING | behaviorObservation | served-runtime observations |
| 9 | `requiredEvidence` | RESERVED | — | *(explicit skip)* |
| 10 | `minimumMetric` | RESERVED | — | *(explicit skip)* |
| 11 | `customPolicy` | RESERVED | — | *(explicit skip)* |

### 3.1 Enforcing semantics (normative)

**requiredComponent** — at least one observed component of the named type (`component`) MUST
exist in the scanned surface. Zero → one violation.

**requiredDependency** — every observed component of the constraint's target type MUST have at
least one outgoing satisfying edge of the constraint's edge type. Target-type/edge-type
resolution is profile-aware (the constraint names WHICH component class it governs, so one
engine serves multiple surface shapes). **Fail-closed on zero targets**: a requiredDependency
that finds NO component of its target type is a violation, never a vacuous pass — a
"must register through the governed path" constraint with nothing to check is a drift signal.

**forbiddenDependency** — one violation for EACH observed import edge to the forbidden module
(`to`). `from` MAY be a component id, or `*`/absent meaning *any* component. An edge whose
source is an unattributable file pseudo-identity MUST match any named `from` (a forbidden
import is drift regardless of whether the file minted a recognized component). An OPTIONAL
`scopePaths` glob list NARROWS which importer files may fire the constraint (absent/empty →
every importer counts).

**forbiddenPath** — one violation for each *extracted component* whose path matches the
constraint's `path` glob.

**forbiddenFile** — one violation for each file in the *raw scanned-file set* matching the
`path` glob. Distinct from `forbiddenPath` by design: it catches a file regardless of export
shape (a file that mints zero components is invisible to `forbiddenPath` but present here).
**Conditional skip**: against a graph whose coverage carries no scanned-file list, the
constraint MUST be recorded as skipped (§7.3) — never a silent pass.

**forbiddenEgress** — grades observed *network-egress edges* (raw HTTP-client calls whose
target host resolved statically), which carry no import edge and are invisible to
`forbiddenDependency`. Two mutually exclusive modes, selected by which fields the constraint
declares:

- **ALLOWLIST** (`governedHosts` non-empty): an egress edge whose host is NOT an exact match
  or proper subdomain of a governed host is a violation (catches drift to an *unanticipated*
  host).
- **BLOCKLIST** (`governedHosts` absent/empty): an egress edge whose host equals or is a
  subdomain of any entry in `to` ∪ `forbiddenEgressHosts` is a violation.

The extractor is a pure detector (it records every resolved egress edge); the constraint is
the policy. An implementation whose extractor cannot resolve call-target hosts (e.g. a plain
line scanner) MUST refuse to grade a `forbiddenEgress` blueprint LOUDLY (§7.5) rather than
silently score zero egress edges as a pass.

**forbiddenPattern** — evaluates the constraint's `pattern` regex PER LINE over the raw
scanned-file set, one violation per (file, line) hit. An OPTIONAL sibling `path` glob narrows
which files' hits redden. **Conditional skip**: against a graph whose coverage carries no
pattern scan — or one whose scan never included THIS pattern — the constraint MUST be recorded
as skipped (§7.3), never a silent pass.

**behavioralInvariant** — the runtime *substance* constraint: the DEPLOYED artifact, driven
with ≥ 2 distinct stimuli that the intent says should produce different observable output,
must actually produce different output AND satisfy each stimulus's property oracle. Facts come
from a runtime observation set (identified by the constraint's `behaviorRef`), encoded as
observation nodes carrying an output hash and an oracle-satisfied flag per stimulus.
Violations (all fail-closed):

- no `behaviorRef` declared → violation (nothing to grade can never pass);
- fewer than 2 observations for the ref → violation (cannot prove input-conditioned
  variation);
- all observations share one output hash → violation (the constant-function / mock
  signature);
- any observation's oracle flag is false → one violation per failed observation.

### 3.2 Reserved types (explicit skip)

`requiredEvidence`, `minimumMetric`, and `customPolicy` are **reserved**: valid to author,
not yet graded. An engine encountering them MUST record them as *skipped* and surface the
skip in the report summary. They MUST NOT count as satisfied, MUST NOT count as enforcing for
the empty-evaluation floor (§6.3), and MUST NOT be silently dropped.

### 3.3 Malformed enforcing constraints

An enforcing-type constraint whose required argument field is absent (e.g. a
`forbiddenDependency` with no `to`, a `requiredComponent` with no `component`, a
`forbiddenPath`/`forbiddenFile` with no `path`) MUST be treated as skipped at evaluation time
(counting toward the empty-evaluation floor, §6.3) and SHOULD be refused at authoring time.
It MUST NOT be treated as satisfied.

---

## 4. The observed graph

The persisted observed graph (`architecture-graph.schema.json`) MUST carry:

- `ctRepoRevision` — the revision provenance of the scanned tree (§5.3);
- `components` — extracted component nodes `{id, type, path, line}`;
- `guardEdges` — real observed edges `{from, to, type, evidenceRef}` where `evidenceRef`
  anchors the observation to `path#L<line>`;
- `coverage` — the **mandatory honesty envelope**: which extractor ran, how many files were
  scanned, and an `unsupported` list naming what the extractor could NOT see. An extractor
  MUST declare its fidelity limits; claiming blanket coverage is non-conforming.

Determinism is a construction requirement: no wall-clock anywhere in the body; all arrays
sorted before serialization; same tree in → byte-identical graph out.

Statically unanalyzable facts (a computed URL, a dynamic import) MUST be surfaced in
`coverage.unsupported` — honestly un-analyzable, never silently passed.

---

## 5. Modes

### 5.1 `run` — the authoritative grader

`run` validates the blueprint **strictly** (any schema violation is a hard failure), scans the
target at a **pinned revision** (materializing a clean tree from the revision, not the working
tree, in the reference implementation's default mode), evaluates, and writes the report.
`run` is the only mode that grades `behavioralInvariant` constraints, by ingesting a runtime
observation set (`--observations` in the reference CLI) produced by a separate runtime probe.
Observation facts gate the verdict but MUST NOT fold into the graph's content-addressed
evidence hash (they are runtime facts, not tree facts).

### 5.2 `gate` — the pinned CI gate

`gate` discovers every blueprint under the discovery directory, selects those whose scope
intersects the change's file list (absent list → full sweep), evaluates each against the
repository tree in place, and fails on any non-pass verdict. Gate mode differs from `run` in
exactly three tolerances, each of which MUST be explicit and surfaced (§9):

1. **Version-skew tolerant parse** (§8.2) — unknown constraint *types* are dropped with an
   advisory instead of whole-file parse rejection.
2. **Run-only skip** — `behaviorObservation`-class constraints (e.g. `behavioralInvariant`)
   are not gradeable statically; each MUST be skipped with an explicit advisory naming the
   constraint, never silently passed and never failed for evidence the mode structurally
   cannot have. A blueprint whose constraints are ALL run-only produces an explicit-skip pass
   whose summary and coverage name every skipped constraint ("NOT a graded pass").
3. **Revision honesty** — gate mode scans the working tree; its report MUST carry the tree's
   real head revision when resolvable, else an explicit `unpinned` marker. The revision does
   not encode uncommitted changes; this limit is documented, not hidden.

### 5.3 Selection

A blueprint is selected for a changed-file list when any changed path matches any of the
blueprint's scan globs (its extraction paths, else its scope paths). A blueprint declaring no
path scoping MUST be selected conservatively (run it).

---

## 6. Scoring and verdict

### 6.1 Score

Each violation carries the severity of its constraint. Severity weights are fixed:

| severity | weight |
|---|---|
| `critical` | 40 |
| `high` | 20 |
| `medium` | 10 |
| `low` | 5 |
| `info` | 0 |

**`score = max(0, 100 − Σ weight(violation))`** — an integer in `[0, 100]`.

### 6.2 Verdict — zero-violations-pass

**`verdict = pass` if and only if the violation set is EMPTY.** The score does not decide the
verdict: an info-only violation set scores 100 yet fails. A report in that state SHOULD say so
explicitly in its summary (score 100 must never be read as a pass).

### 6.3 The empty-evaluation floor

If **zero enforcing constraints actually ran** — every constraint was reserved-skipped,
conditionally skipped (§7.3), or malformed-skipped (§3.3) — the engine MUST emit a synthetic
`critical` violation (constraint id `__no-enforcing-constraints__`) so the verdict is `fail`.
A green verdict MUST mean *something was proven*, never *nothing was checked*.

---

## 7. Fail-closed semantics (enumerated)

The engine fails closed at every layer where evidence is missing, partial, or unparseable:

1. **Malformed blueprint** — a blueprint that fails validation is a run failure / a gate
   failure (a score-0 `fail` report naming the parse error), never a silent skip.
2. **Scan floor** — the scan MUST resolve at least the blueprint's minimum file count
   (`extraction.minFiles`, defaulting to the resolved-path count of the profile). An
   empty/partial scan can never score 100: below the floor is a hard refusal (`run`/`scan`)
   or a score-0 `fail` report (`gate`).
3. **Missing evidence surface → honest skip** — a `forbiddenFile` against a graph without a
   scanned-file list, or a `forbiddenPattern` against a graph without a matching pattern
   scan, MUST be recorded as skipped. Skips do not count as enforcing, so a blueprint whose
   only constraints are skipped falls to the §6.3 floor.
4. **Behavioral evidence floor** — in the authoritative mode, a `behavioralInvariant` with no
   observation set, or fewer than 2 observations, is a violation (§3.1).
5. **Extractor capability refusal** — an extractor structurally unable to honor a
   constraint's semantics (host resolution for `forbiddenEgress`; symbol resolution for
   governed-module crediting) MUST be refused LOUDLY with guidance (an error in `run`; a
   score-0 `fail` report in `gate`) — never a silent false pass, and never a silent false
   reject of a conformant change.
6. **Unresolvable engine self-version** — an engine that cannot prove its own version MUST
   compare as BELOW every authored `minEngineVersion` pin (§8.1): an engine that cannot
   identify itself must never silently grade a blueprint that demands a minimum.
7. **Unrecognized artifact kind** — rejected, never a no-op (§2.1).

---

## 8. Version-skew honesty

Two skew directions, two mechanisms, both explicit:

### 8.1 Blueprint requires a NEWER engine — `minEngineVersion`

A blueprint MAY pin the minimum engine version it needs. The gate MUST read the pin off the
RAW artifact **before** full schema parsing (the whole point is a future blueprint this engine
may not even parse) and, when its own version is below the pin, emit a CLEAR score-0 `fail`
report saying *upgrade the pinned engine* — never a raw validation stack trace. A
present-but-malformed pin does not bypass validation (fail-closed).

### 8.2 Blueprint authored for a NEWER engine — tolerant gate parse

`gate` runs a PINNED engine against blueprints that may carry constraint types this engine
does not know. The tolerant parse is deliberately NARROW:

1. Strict parse first — a fully valid artifact takes the exact strict path.
2. On failure, drop ONLY constraint entries whose `type` is a string outside this engine's
   enum, then re-validate the remainder STRICTLY. Any other malformation still fails
   (tolerance never widens past the unknown-type drop).
3. Every dropped constraint MUST surface as an explicit advisory naming its id, its type, and
   the upgrade path — counted, never silent.
4. If ALL constraints are unknown, that is a **hard parse failure**: this engine can grade
   nothing in the blueprint, and a green gate must mean something was proven.

`run` MUST keep the strict parse — the authoritative grader gets no tolerance.

---

## 9. Mode doctrine — advisory vs enforcing

"Advisory" carries two distinct, non-blurring senses in this spec: an **output class** (§9.1 — a
single line in a report is enforcing or advisory) and an **adoption mode** (§9.2 — a whole gate
invocation is enforcing or advisory). Both obey the same governing rule: nothing is ever silently
softened.

### 9.1 Advisory vs enforcing OUTPUTS

Every engine output is one of two classes, and the classes MUST NOT blur:

- **ENFORCING**: verdicts, violations, scores, fail-closed refusal reports, exit codes.
  These gate builds.
- **ADVISORY**: warnings (e.g. a repo-identity mismatch between the gate invocation and a
  blueprint's declared repositories), skip notices (run-only, unknown-type, reserved-type),
  and skip counters. Advisories MUST be surfaced (in the report summary, the coverage
  envelope, and/or the gate's warning stream) and MUST NOT, by themselves, fail a run.

The rule for every tolerance in this specification: **a skip is always explicit** — surfaced,
counted, and attributable. Silent skips are non-conforming in both directions (silently
passing AND silently failing).

### 9.2 Advisory vs enforced MODE — the adoption posture (config-file, never a flag)

A repository adopting the gate on an existing (dirty) codebase needs to run the gate BEFORE it can
pass it. The doctrine answer is an **adoption MODE**, not a skip flag — and the distinction is
load-bearing:

- **The mode is a COMMITTED config file, never a CLI flag.** The reference CLI reads
  `.bce-mode.json` (`{"mode": "enforced" | "advisory"}`, an optional `rationaleRef`) from the repo
  root. There is no `--advisory`/`--skip`/`--no-verify`-class flag on `gate`, and introducing one is
  non-conforming. A flag is invisible in the repo and trivially added to a CI line under adoption
  pressure; a committed, PR-reviewed file makes the posture a visible, governed fact of the repo.
- **ENFORCED is the default and the product.** An ABSENT config resolves to `enforced` — and MUST be
  **byte-identical** to a pre-mode engine (no `mode` field on any report, no banner), so mode is a
  strictly widen-only addition (§10). A non-pass verdict fails the build (the §13 exit contract,
  unchanged).
- **ADVISORY computes the identical verdict and prints it in full**, stamps a machine-readable
  `mode: "advisory"` on every report, emits an **unmissable banner** declaring the violations do not
  block, and exits **0** regardless of verdict. Advisory changes ONLY the exit code — never the
  score, never the violation set, never what is printed. It is therefore **not a skip flag and not a
  suppression**: nothing is hidden; the full red is surfaced every run. Mistaking advisory for
  enforced is impossible by construction — the banner, the report `mode` field, and the exit code all
  agree.
- **A malformed config fails closed** — an unparseable or unknown-valued `.bce-mode.json` is a LOUD
  error, never a silent default to either posture (§7 fail-closed discipline).

**Graduation is ONE-WAY and RECORDED** (the widen-only ratchet applied to adoption posture):

- advisory → enforced (a TIGHTENING) is free: a graduation ceremony (`bce graduate` in the reference
  CLI) appends an entry to an in-repo rationale record (`.blueprints/GRADUATION.md`) and flips the
  config to `enforced`.
- enforced → advisory (a RELAX) is REFUSED unless the same rationale record is written — with a
  human-supplied reason. A gate MAY tighten silently; it MUST NOT relax silently (§10.3). Every
  transition, both directions, is recorded, so the posture's history is always auditable in-repo.

Neither the mode nor the graduation ceremony is a bypass of the grader: the grader is fail-closed at
all times (§6.3 zero-blueprints/empty-scan FAIL, §7 refusals), independent of mode. Advisory decides
only whether a red verdict blocks the build — the verdict itself is always honestly computed.

The `baseline` verb (§9.3) is the complementary adoption lever: advisory ungates the WHOLE
verdict's exit while surfacing everything; baseline keeps the gate enforcing but shrink-only against a
recorded pre-existing set. Neither suppresses a NEW violation — advisory prints it (and the score
still shrinks), baseline still fails on it.

### 9.3 Baseline — the shrink-only pre-existing-violation lever (config-file, never a flag)

A repository adopting the gate on a codebase that already drifts needs a way to enforce from day one
without a red build for debt that predates the gate. The doctrine answer is a **baseline**: a
committed, PR-reviewed record of the accepted pre-existing violation set — and, like advisory mode,
it is a **file, never a flag**. The reference CLI reads/writes `.blueprints/baseline.json`.

- **ABSENT baseline → enforce everything.** No file resolves to "nothing is accepted" — every
  violation is NEW — and MUST be **byte-identical** to a pre-baseline engine (widen-only, §10).
- **A baseline keeps the gate ENFORCING.** With a baseline present, each run's violations partition
  into two sets: **NEW** (identity not in the baseline) — which **fail the build**, exactly as
  without a baseline; and **BASELINED** (identity in the file) — which are **surfaced, counted, and
  stamped non-blocking**. A baselined violation is never hidden (a skip is always explicit, §9.1):
  the graded verdict and score are the real fail, and the gate labels the blueprint non-blocking so
  it can never be mistaken for a graded green. A baseline never suppresses a NEW violation.
- **Violation identity is content-addressed.** A violation's baseline identity is the tuple
  `(blueprintRef, constraintId, component)` — hashed — NOT its line number or message prose. A
  reformatting/line shift does not lose a baselined violation; a violation that moves to a different
  component, or a different constraint firing, is a NEW identity (correctly un-baselined). A written
  baseline entry carries the human-legible tuple so the committed file is reviewable, and a reader
  recomputes each entry's hash from its own fields — a hand-edited file whose stored identity does
  not match its fields is a fail-closed error (no smuggled broader identity).

**The baseline is SHRINK-ONLY** (the widen-only ratchet, §10.3, applied to the burndown wall):

- The FIRST write (no file yet) records every current violation — the only path that can GROW the
  accepted set, and it is PR-visible (a new file appears in the diff).
- Every SUBSEQUENT write produces a **subset** of the existing file: an entry whose violation still
  exists is kept; one whose violation has since disappeared is **auto-removed** (the wall burns
  down); a current violation NOT already baselined is **refused entry** (a re-write never grows).
- To GROW the wall you MUST delete the file and re-create it — a PR-visible act. There is deliberately
  no in-place "add to baseline" affordance; that affordance would be the bypass.

**A baseline never turns a fail-closed refusal green.** A refusal (empty scan below the floor, a
malformed blueprint, a minEngineVersion miss — §7) has no violation identity to accept, so it is not
a "pre-existing accepted violation": it always blocks, independent of the baseline. The baseline
overlays only the *graded-violation* reds; the grader stays fail-closed at all times.

Baseline and advisory COMPOSE cleanly and independently: a refusal always blocks → a baseline narrows
the graded-violation reds to only NEW ones → advisory (if set) then ungates the exit entirely. Every
layer is legible in the output; none silently softens another.

---

## 10. Widen-only versioning policy

The engine's compatibility contract, in force for every change:

1. **Enums only gain members.** The constraint-type enum (and every published enum) only ever
   adds values. Existing authored artifacts — which cannot already contain a new value — are
   unaffected by construction.
2. **New fields are optional, with omit-not-empty discipline.** An additive field MUST be
   optional and MUST be omitted (not emitted empty) when unset, so every pre-existing
   serialized artifact — and every downstream content hash — stays **byte-identical**.
3. **Gates tighten, never silently relax.** A guard, floor, or refusal MAY become stricter;
   it MUST NOT be weakened or given a bypass flag. Tolerances (like §8.2) are added narrowly,
   explicitly, and with every skip surfaced.
4. **Behavior-preserving defaults.** When a new capability needs configuration, the absent
   configuration MUST resolve to the prior behavior (a blueprint without the new block
   validates and scores byte-identically).
5. **Version identity.** The engine version is semver. Within `v1alpha1`, breaking changes to
   any published schema are not permitted; a breaking change requires a new apiVersion.

---

## 11. The report contract

A compliance report (`compliance-report.schema.json`) MUST carry: `schemaVersion`,
`blueprintRef` (`<id>@<version>`), `ctRepoRevision`, `score`, `verdict`, `violations`,
`evidenceRef`, `summary`, and `coverage` (extractor, files scanned, unsupported list). It MAY
carry an additive `repo` identity stamp (omit-not-empty).

**Determinism**: same (blueprint, graph) in → **byte-identical** report out. To make that
checkable:

- Canonical serialization is deterministic JSON: object keys sorted recursively, two-space
  indentation, a single trailing newline.
- Violations are sorted by (constraintId, component).
- The report's `evidenceRef` is a content-addressed pointer to the exact observed graph
  bytes it was evaluated against (`architecture-graph.json@sha256:<hex>`), computed over the
  graph's canonical serialization. Fail-closed reports that never scanned use the explicit
  marker `n/a`.

Each violation carries: `constraintId`, `severity`, `component`, `evidenceType`,
`evidenceRef` (anchor `path#L<line>` where applicable), `observed`, and `expected` — the
observed fact and the expectation it violated, both stated concretely.

The published report schema describes the CURRENT engine version's canonical output.
Consumers aggregating reports across engine versions SHOULD read tolerantly (ignore unknown
fields), per §10.2.

---

## 12. Evidence and remediation contract

### 12.1 The evidence hash-chain

Each conformance run MAY emit one **evidence record** (`evidence-record.schema.json`) chained
over prior runs:

- `previousHash` — the SHA-256 `hash` of the prior record, or the genesis sentinel (64 zero
  hex characters) for the first record in a chain.
- `hash` — the SHA-256 of THIS record's canonical body (all fields except `id` and `hash`
  itself, `previousHash` included), over the canonical serialization of §11.
- `id` — content-derived: `evidence:<blueprintRef>:<first 16 hex of hash>`.
- `traceId` — the chain key (the blueprint id; one chain per subsystem).

**No wall-clock anywhere in the body**: the record's identity is its content hash, so the same
report + same previousHash always yields the same record.

**Chain verification**: a chain is intact iff, walking from genesis, each record's
`previousHash` equals the prior record's `hash` AND each record's `hash` re-derives from its
body. Verification MUST report the index of the first broken link. An empty chain is vacuously
intact.

### 12.2 Remediation work orders (propose-not-apply)

A run MAY auto-generate one structured remediation object per violation
(`remediation-work-order.schema.json`). Every auto-generated object MUST start in state
`PROPOSED` and MUST advance only through the governed transition matrix:

| from | permitted to |
|---|---|
| `PROPOSED` | `ACKNOWLEDGED`, `REJECTED` |
| `ACKNOWLEDGED` | `APPROVED`, `REJECTED` |
| `APPROVED` | `RESOLVED`, `REJECTED` |
| `RESOLVED` | *(terminal)* |
| `REJECTED` | *(terminal)* |

Nothing auto-advances past `PROPOSED`: a violation becomes a governed proposal, never an
auto-applied change. Object ids are deterministic (derived from constraint, component, and
evidence anchor), so identical runs yield identical proposals.

---

## 13. Exit-code contract (reference CLI)

| command | 0 | 1 | 2 |
|---|---|---|---|
| `bce validate` | blueprint valid | not found / bad JSON / schema-invalid | — |
| `bce author` | draft written + self-validated | usage / flag error | author sanity: authored scope matches 0 files (draft left on disk for editing) |
| `bce scan` | graph written | usage error | fail-closed scan floor (files scanned < minimum) |
| `bce run` | verdict `pass` | verdict `fail`; usage error; extractor capability refusal; invalid observations | fail-closed scan floor |
| `bce teeth` | TOOTHED (≥ 1 constraint has extractor-real teeth) or EVALUATOR-REFUTABLE (refutable in principle only — synthetic-evidence mutations, explicitly NOT evidence of real teeth; surfaced as a warning, never a falsification) | usage error | TOOTHLESS (a green run proves nothing) |
| `bce gate` (enforced — default) | every selected blueprint passes (a baselined-only red is a non-blocking pass, §9.3) | any NEW (un-baselined) violation; any fail-closed refusal; usage error; malformed `.bce-mode.json` / `.blueprints/baseline.json` | — |
| `bce gate` (advisory mode, §9.2) | ALWAYS 0 — the full verdict is printed with a banner + report `mode:"advisory"`, but a red does not block | malformed `.bce-mode.json` / `.blueprints/baseline.json`; usage error (config errors still fail; the VERDICT never blocks) | — |
| `bce baseline` (§9.3) | baseline written (fresh creation, or a shrink write — kept ∩ current, vanished auto-removed) | usage error; malformed existing baseline | — |
| `bce graduate` | advisory → enforced recorded + config flipped (or an idempotent no-op) | enforced → advisory without `--rationale`; usage error | — |
| `bce portfolio compile` | overlays written | validation / usage error | — |
| `bce portfolio collect` | rollup produced | refusal (missing/extra repo, member floor) or validation error | — |
| *(unknown command)* | — | usage printed, non-zero | — |

Normative shape: **0 = proven green**, **1 = red or user error**, **2 = fail-closed
refusal** (the run could not honestly grade — which MUST be distinguishable from a graded
red). Gate mode folds fail-closed refusals into score-0 `fail` reports (exit 1) so a single
CI signal gates the build; the refusal cause MUST remain legible in the report summary.
**Advisory mode (§9.2) is the sole exception to "1 = red"**: it exits 0 on a red VERDICT by
design (the adoption posture), yet still exits 1 on a config/usage error — the mode ungates the
verdict, never the tool's own honesty.

---

## 14. Schema publication

### 14.1 `$id` base

Every published schema declares
**`$id: https://blueprint-conformance.github.io/bce/schemas/<name>.schema.json`** (JSON
Schema draft-07). These URLs are served by the organization's GitHub Pages site and therefore
**resolve only after the repository's public flip activates that site**. Until then the `$id`s
are stable identifiers that do not yet dereference — a documented, expected state, not an
error. The publishing workflow (`.github/workflows/publish-schemas.yml`) exists in the tree
but is **dormant by design** (disabled with an explicit comment) until the flip: this
repository describes only machinery that runs.

### 14.2 Generation and parity

The schemas under `spec/schemas/` are **generated, never hand-edited**
(`npm run generate:schemas`, from `scripts/generate-schemas.ts`):

- The authored kinds (`EngineeringBlueprint`, `PortfolioBlueprint`) are mechanically derived
  from the engine's source-of-truth validation schemas.
- The emitted kinds (report, evidence record, graph, work order) are authored field-for-field
  against the engine's output types and proven against REAL engine output.

A CI-red parity test (`tests/schema-parity.test.ts`) enforces: byte-identical regeneration
(drift = red), validator agreement between the engine validator and the published schema on
an accept/reject matrix, and validation of real engine output against the published schemas.

**Known, pinned divergence**: engine-side *refinements* (e.g. §2.1's compile-and-safety check
on `forbiddenPattern.pattern`) exceed the mechanical conversion — the published JSON Schema is
the STRUCTURAL floor, and **the engine validator is normative where the two diverge**. The
divergence is pinned by an explicit test assertion so it can never silently widen.

---

## 15. Conformance

An independent implementation conforms to this specification iff:

1. it validates authored artifacts per §2 (structural floor + the §2.1 refinements);
2. it implements the 11-type taxonomy per §3 — all eight enforcing semantics, explicit skips
   for the three reserved types, and the malformed-constraint rule;
3. its reports satisfy §6 (weights, formula, zero-violations-pass, empty-evaluation floor)
   and §11 (determinism, canonical serialization, content-addressed evidence);
4. it fails closed per §7 and surfaces every tolerance per §8–§9;
5. its evidence chains verify per §12 and its remediation objects honor propose-not-apply;
6. it distinguishes graded-red from fail-closed-refusal in its exit surface per §13;
7. it evolves under the widen-only policy of §10.

### Example (minimal authored artifact)

```json
{
  "apiVersion": "blueprint-conformance/v1alpha1",
  "kind": "EngineeringBlueprint",
  "metadata": { "id": "example-surface", "version": "0.1.0", "status": "draft" },
  "intentRefs": ["intent/keep-provider-traffic-governed"],
  "scope": { "repositories": ["example-org/example-repo"], "paths": ["src/**/*.ts"] },
  "architecture": { "components": [], "relationships": [] },
  "constraints": [
    {
      "id": "no-direct-provider-egress",
      "type": "forbiddenEgress",
      "severity": "critical",
      "from": "*",
      "governedHosts": ["api-gateway.internal"]
    }
  ],
  "evidenceRequirements": [],
  "approvals": [],
  "extraction": {
    "profile": "plugin-surface",
    "paths": ["src/**/*.ts"],
    "minFiles": 1
  }
}
```
