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

For `extraction.profile: "typescript-module-graph"`, `minEngineVersion` MUST be at least `0.3.0`,
and `extraction.paths` plus an explicit positive `extraction.minFiles` are REQUIRED.
`extraction.tsconfig` MAY name one repository-relative,
non-glob config file. `guardSymbols`, `forbiddenImports`, `forbiddenEgressHosts`, and
`governedModules` MUST be absent or empty because extraction is policy-independent. Each
`requiredDependency` / `forbiddenDependency` MUST declare non-empty importer `scopePaths` and a
canonical `to` selector: `module:<repo-path-or-glob>`, `package:<npm-root>`, or
`builtin:<node-name>`. A module-profile `requiredDependency` MUST declare
`component: "typescriptModule"`. A module-profile `forbiddenDependency.from` MUST be absent or
`"*"` because `scopePaths` is the sole importer selector. `forbiddenEgress` is not supported by
this profile and MUST be rejected at authoring time rather than evaluated against missing facts. A
module-profile `requiredComponent` MUST declare `component: "typescriptModule"`. Portfolio members
using this profile MUST each pin an engine version of at least `0.3.0`.

For `extraction.profile: "python-module-graph"`, `minEngineVersion` MUST be at least `0.3.0`,
`extraction.paths` plus an explicit positive `extraction.minFiles` are REQUIRED, and
`extraction.pythonRoots` MUST contain at least one repository-relative, non-glob import-root
directory. Every scanned file MUST belong to exactly one root. `extraction.tsconfig` and the
component-profile policy fields named above MUST be absent or empty. C2/C3 MUST carry importer
`scopePaths` and a `to` selector of `module:<repo-path-or-glob>` or
`package:<python-import-root>`; `builtin:` is not supported. C1/C2 component types MUST be
`pythonModule`, C3 `from` MUST be absent or `"*"`, and `forbiddenEgress` MUST be rejected.
Portfolio members using this profile MUST each pin an engine version of at least `0.3.0`.

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
Under a module-graph profile, importer `scopePaths` select `typescriptModule` or `pythonModule`
components and `to` selects a direct `imports` target. Every selected source MUST carry a matching
direct edge. An unresolved import cannot satisfy the requirement.

**forbiddenDependency** — one violation for EACH observed import edge to the forbidden module
(`to`). `from` MAY be a component id, or `*`/absent meaning *any* component. An edge whose
source is an unattributable file pseudo-identity MUST match any named `from` (a forbidden
import is drift regardless of whether the file minted a recognized component). An OPTIONAL
`scopePaths` glob list NARROWS which importer files may fire the constraint (absent/empty →
every importer counts).
Under a module-graph profile, only `imports` edges are graded; `scopePaths` select importer modules
and `to` uses that profile's canonical selector grammar above. A selected source with an unresolved
or computed import produces a fail-closed violation because absence of the forbidden target cannot
be proven.

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

The `typescript-module-graph` profile MUST emit one `typescriptModule` component per scanned TS/JS
file and an `imports` edge for each statically named import, type-only import, re-export,
JavaScript JSDoc `@import`, TypeScript import-equals, unshadowed literal `require` / `require.resolve`, and literal dynamic
import, plus literal TypeScript import types (`import("...")`). Internal targets use `module:`,
declared npm subpaths normalize to their `package:` root, and syntactically valid `node:` imports
plus public Node 22 unprefixed built-ins normalize to `builtin:` without the `node:` prefix from a
source-pinned vocabulary. `coverage.unresolvedImports` MUST
locate observed computed or unresolved import forms used by the fail-closed C2/C3 semantics.
Bare roots not declared by an enclosing repository-owned `package.json` are unresolved rather than
guessed to be packages. Line-scan, invalid source syntax, invalid/escaping tsconfig resolution,
external/package-based tsconfig inheritance, and imports that escape the repository are refusals.
This profile does not claim transitive reachability or cycle analysis.

The `python-module-graph` profile MUST emit one `pythonModule` component per scanned `.py` file and
an `imports` edge for every statically declared import located by the structured parser. Explicit
`pythonRoots` define repository import identities: ordinary modules map to their root-relative
dotted name and `__init__.py` maps to its containing package. Resolved repository targets use
`module:<repo-path>`; canonical external names use `package:<top-level-import-namespace>`.
Dynamic `__import__`, `importlib.import_module`, `exec`, `eval`, and runtime import-state mutation
MUST be located in `coverage.unresolvedImports`, so relevant C2/C3 constraints fail closed.
Invalid syntax, non-UTF-8 source contracts, symlinked or root-escaping source, ambiguous roots or
import identities, over-dotted relative imports, and line-scan requests are refusals. The profile
does not claim PyPI distribution mapping, installed metadata, custom import hooks, `.pyi` semantics,
call or egress graphs, transitive reachability, or cycle analysis.

Determinism is a construction requirement: no wall-clock anywhere in the body; all arrays
sorted before serialization; same tree in → byte-identical graph out.

Statically unanalyzable classes MUST be disclosed in `coverage.unsupported`. Extractors that grade
unknown destinations fail closed and SHOULD also itemize located facts (for example
`unresolvedImports` or `unresolvedEgress`) rather than presenting absence as proof.

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
| `bce propose` | draft-only candidate and deterministic review packet written to quarantine | usage / flag error | provider failure/refusal, invalid plan, stale context, unsafe path, or deterministic review refusal (failed attempt retained) |
| `bce review show` | fresh canonical packet and optional bound decision render | usage / format error | packet schema, canonical-byte, integrity, live-repository, or tool-identity verification fails |
| `bce review verify` | packet and optional decision integrity plus live repository/tool identity verify | usage error | tampered, stale, malformed, or unreproducible packet/decision |
| `bce review decide` | SCM-authenticated decision record written beside the packet; no policy mutation | usage error | GitHub review authentication, binding, state, identity, or freshness fails |
| `bce scan` | graph written | usage error | fail-closed scan floor (files scanned < minimum) |
| `bce run` | verdict `pass` | verdict `fail`; usage error; extractor capability refusal; invalid observations | fail-closed scan floor |
| `bce teeth` | TOOTHED (≥ 1 constraint has extractor-real teeth) or EVALUATOR-REFUTABLE (refutable in principle only — synthetic-evidence mutations, explicitly NOT evidence of real teeth; surfaced as a warning, never a falsification) | usage error | TOOTHLESS (a green run proves nothing) |
| `bce gate` (enforced — default) | every selected blueprint passes (a baselined-only red is a non-blocking pass, §9.3) | any NEW (un-baselined) graded violation; usage/config error | structural or extractor refusal: the repository could not be honestly graded |
| `bce gate` (advisory mode, §9.2) | pass, or a graded violation reported without blocking; the full verdict carries `mode:"advisory"` | usage/config error | structural or extractor refusal: advisory never turns an ungradeable run green |
| `bce baseline` (§9.3) | baseline written; with `--check`, current baseline is clean | usage/malformed baseline; `--check` finds shrink-needed or unaccepted-new debt | `--check` observes a gate refusal, or a write cannot be safely completed |
| `bce graduate` | advisory → enforced recorded + config flipped (or an idempotent no-op) | enforced → advisory without `--rationale`; usage error | — |
| `bce doctor` | repository is ready | repository is gradeable but needs a lifecycle action | repository cannot yet be honestly graded |
| `bce adopt` / `bce onboard` | advisory proposal written; still unratified | malformed input / usage error | unsafe path, overwrite, non-draft blueprint, or mutable/unsupported engine reference refused |
| `bce ratify` / `bce amend` | attended packet-bound policy ceremony recorded | malformed input / usage error | stale/invalid packet, non-approving or unreproducible SCM decision, missing extractor-real teeth, or unsafe policy transition refused |
| `bce upgrade --check` | candidate is compatible | — | mutable/malformed candidate or incompatible engine floor refused |
| `bce verify-bundle` | hashes and verdict reproduce | bundle malformed or integrity/reproduction check fails | — |
| `bce stack snapshot` | StackManifest written | usage error | no supported lockfile parses: nothing written |
| `bce stack diff` | report written; no blocking move | usage error (missing `--from`/`--to`, unknown flag, extra positional argument) | a `backward`, `unknown` or `rewritten` move, a same-version install-script gain, or a hashed change no row explains (report still written); or a refused input — not a strict StackManifest, a symlink, recorded digests that do not re-derive, or an `--out` that resolves to an input (nothing written) |
| `bce portfolio compile` | overlays written | validation / usage error | — |
| `bce portfolio collect` | rollup produced | refusal (missing/extra repo, member floor) or validation error | — |
| *(unknown command)* | — | usage printed, non-zero | — |

Normative shape: **0 = proven green**, **1 = red or user error**, **2 = fail-closed
refusal** (the run could not honestly grade — which MUST be distinguishable from a graded
red). Gate preserves that distinction in both its process exit and machine report; exit `1` and
exit `2` both block an enforced CI check.
**Advisory mode (§9.2) is the sole exception to "1 = red"**: it exits 0 on a red VERDICT by
design (the adoption posture), yet still exits 1 on a config/usage error — the mode ungates the
verdict, never the tool's own honesty.

---

## 14. Schema publication

### 14.1 `$id` base

Every published schema declares
**`$id: https://blueprint-conformance.github.io/bce/schemas/<name>.schema.json`** (JSON
Schema draft-07). These URLs are served by the organization's GitHub Pages site and therefore
**resolve once the repository's public flip activated that site**. Before the flip the `$id`s
were stable identifiers that did not yet dereference — a documented, expected state, not an
error. The publishing workflow (`.github/workflows/publish-schemas.yml`) shipped in the tree
**dormant by design** (disabled with an explicit comment) until the flip, and has been active
since it: this repository describes only machinery that runs.

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

**Known, pinned divergence class**: engine-side *refinements* exceed the mechanical conversion.
This includes §2.1's compile-and-safety check on `forbiddenPattern.pattern` and the
module-graph cross-field rules (minimum engine, supported constraints, canonical targets/scopes,
extractor configuration, Python roots, and portfolio member pins). The published JSON Schema is
the STRUCTURAL floor, and **the engine parser is normative where the two diverge**. Each refinement
family is pinned by an explicit test assertion so it can never silently widen.

---

## 16. Stack manifest (slice 1 — the declared closure as a content-addressed artifact)

`bce stack snapshot` emits a **StackManifest** (`stack-manifest.schema.json`): the DECLARED dependency
closure of a repository at a revision. It is a sibling artifact to the observed graph and the
compliance report — it joins neither in this slice, and no constraint type grades it yet.

**Inputs** (read from the pinned tree, nothing else): `npm-shrinkwrap.json` or `package-lock.json`
with `lockfileVersion` **3 only** — when both exist **`npm-shrinkwrap.json` wins** (npm's own rule)
and the other is a coverage line; `pnpm-lock.yaml` with `lockfileVersion` **'9.0' only** (§16.1,
including which lockfile family wins when several are present); `package.json`; `.nvmrc` /
`.node-version` (first non-comment line); `Dockerfile*` `FROM` lines and `docker-compose*` /
`compose*` `image:` lines (line-anchored, no YAML library), searched to **directory depth 3** with
`node_modules`, `.git`, `dist`, `build`, `coverage` and virtualenv directories excluded — a deeper
file is NOT read and the manifest says so.
**Never**: `node_modules`, the network, `npm ls`, the machine's platform/arch/npm version, the clock.
**Never a symbolic link**: every named source is `lstat`ed and must resolve inside the tree; a
symlinked (or tree-escaping) lockfile, `package.json`, runtime file, Dockerfile or compose file is a
refusal, on the pinned and the working-tree path alike — the manifest is a function of the revision.

**Node identity** is `(kind, name, version, integrity)` — never the `node_modules/…` path. One
identity may sit at several paths with different flags; flags are **merged across every copy**
(`dev`, `optional`, `peer`, `devOptional` hold only when every copy carries them; `installScript`
when any does), so hoisting — which path holds which copy — is recorded in the non-hashed `layout`
list and cannot move the identity. `kind` is `npm`, `oci-image` (`@sha256:<64 hex>` ⇒ `pin:true`; a
malformed digest is never a pin; a bare ref ⇒ `tag:"latest"` with `tagImplicit:true`) or
`node-runtime` (`.nvmrc` > `.node-version` > `engines.node`; only an exact `x.y.z` is a pin).

**`resolved`** (the tarball / git URL) is hashed **only when `integrity` is absent**
(`resolvedWhenUnpinned`): with an integrity the bytes are pinned and a registry-mirror swap is
content-neutral; without one, `resolved` is the only thing naming the bytes.

**Opaque nodes.** A lockfile entry this slice cannot fully model — an `npm:` alias, a `link:`
workspace entry or its target, a `git`/`file:` dependency, a non-ASCII name — is never ingested
under a guessed name and never dropped: it enters `unmodeled[]` as `{kind:"unsupported", key,
reason, spec, entrySha256}` where `entrySha256` covers the entire raw entry. `unmodeled[]` IS
hashed, so a closure that differs only in such an entry never shares a digest with another, while
`coverage.unsupported` still states the fidelity limit. (`key` is the lockfile key, so for these
entries alone a re-hoist can move the digest — the price of not trusting an identity the slice
cannot verify.)

**`stackDigest`** = SHA-256 over the canonical serialization (§11 rules) of the **HASHED VIEW**:
`schemaVersion`, `kind`, `nodes[]` (every field except `layout`), `runtime`, `images[]` (every field
except `evidenceRef`; the hashed images are the SET of image identities, ordered by their own
serialized form AFTER that field is removed — so neither a comment line above a `FROM`, nor moving
a Dockerfile, nor declaring the same ref again in a second Dockerfile or compose service re-keys;
the manifest keeps every declaration with its `evidenceRef`), `unmodeled[]`.
**Quarantined out** and present only in the manifest: `ctRepoRevision` (two revisions with the same
closure share a digest — the join key), `sources[].sha256` (a re-serialized lockfile is the same
closure), `edges` (a function of the node set plus the resolver walk), `rootDeclared` (declared
ranges), `coverage`, `stackId`
(`stack:` + the first 12 hex) and `manifestDigest` (SHA-256 over the manifest minus itself — tamper
detection of the file). **The root package's own `version` is quarantined.** In the hashed view the root node carries no
`version` and its `id` is `root:<name>` (the manifest keeps the real `npm:<name>@<version>` for
display), on every root-identity path — the lockfile root entry, the top-level fallback, the
defaulted identity. A release bump of the repository is not a change of its dependency closure:
two revisions with the same closure share a digest whatever the package calls its version that
day. The root `name` stays hashed (a renamed fork is a different stack subject). A non-root package
that happens to share the root's name is an ordinary node with a hashed version; when it also shares
the root's version, the ROOT's display `id` yields (`+root`, then `+root.2`, `+root.3`, … until no
node owns it), so manifest ids are always unique. **Declared ranges
never move the digest** — root or not: the digest names the RESOLVED closure, ranges live in the
quarantined `edges` and, for the root package, in the quarantined manifest field
`rootDeclared[] {name, spec, group}` — a range-only edit with identical resolved nodes leaves the
running stack identical, so it is visible there (a diff reports it as spec-changed) and never re-keys.

**Fail-closed** (exit **2**, nothing written): no lockfile; only `yarn.lock` (fixed refusal
string); malformed JSON; npm `lockfileVersion` ≠ 3; pnpm `lockfileVersion` ≠ '9.0' or a pnpm
lockfile outside the reader's YAML subset (§16.1); a **hollow** lockfile (npm: no `packages` map, no
root entry, or NOTHING beyond the root; pnpm: no `importers`, `packages` or `snapshots` mapping — a
closure with no node and no unmodeled entry beyond the root is never a green stack; a root plus only
opaque entries IS accepted, because those entries are hashed); a **malformed entry** (not an
object, or a missing / empty / non-string version; for pnpm see §16.1); a dependency map carrying
an EMPTY dependency name (fixed refusal, root or not); any symbolic link among the named sources
(lockfile, `package.json`, runtime file) or NAMED like an image file (`Dockerfile*`, `*.Dockerfile`,
compose). **Symlinks are `lstat`-only**: the image walk never follows one and never stats or lists
its target — what a link points at is host state, not part of the revision — so every other symlink
it meets (to a file, a directory, or nothing) is one coverage line (`symlink '<rel>' is not
followed`) and neither the exit code nor coverage can differ between a pinned tree, a working tree
and another host. Nothing under a symlink is ever read into `images[]`. The walk does not descend
into a **nested git checkout** — another repository's tree (a submodule, a worktree, a clone),
declared in coverage. The verb decides that from what git knows at the revision being read (the
tracked paths and the gitlink entries, `git ls-tree` for a pinned ref, the index for `--no-pin`),
never from the working tree alone: a gitlink is declared in the pinned view (where `git archive`
holds no submodule contents) and in the working-tree view alike, and a stray `.git` beside files
this repository tracks is ignored, so both views agree on digest AND coverage. A library caller
that supplies no git knowledge gets the fallback: a directory below the root carrying a `.git`
entry is skipped on that marker alone. `FROM ${ARG}` bases and
`${VAR}` compose refs are coverage lines, never fabricated nodes. `images[].resolved` is always
`false` in this slice: tag→digest resolution is a separate verb that writes a proposal, never a
manifest field.

### 16.1 pnpm-lock.yaml v9 — a second source, not a second schema

`pnpm-lock.yaml` produces the SAME `StackNode` shape (`sources[].parser: "pnpm-lockfile-v9"`). The
engine carries **no YAML library**: a hand-rolled reader walks exactly the subset pnpm's serializer
emits — indentation-nested block mappings, block sequences of scalars, single-line flow
maps/sequences, plain / single- / double-quoted scalars, block scalars. Anchors, aliases, tags,
the merge key `<<` (quoted or not, with or without an alias), multi-document streams, complex keys,
multi-line flow collections or quoted scalars, inline comments, tab indentation, duplicate keys,
trailing content after a flow or quoted value, flow collections nested deeper than 8 and block
nesting deeper than 64 are a parse error with a line number, and the lockfile is then **refused
whole** — never half-read. The reader never throws on lockfile content.

**Scalar typing** follows the YAML core schema where it decides identity: a PLAIN `null` / `Null` /
`NULL` / `~` or an empty value is **absent** (never the string `"null"`), a plain `true` / `false`
(three spellings each) is a boolean, and a QUOTED scalar is always a string. Numbers stay strings, so
`lockfileVersion: 9.0` and `'9.0'` are the same accepted value and nothing is re-spelled by a float
round-trip; every other value — `9`, `9.1`, `10.0`, a boolean, a list — is a fixed version refusal.
A block scalar (`|`, `>`) is a distinct non-string value: this reader neither folds nor clips, so it
is inert where pnpm really writes one (a multi-line `deprecated:` notice) and a `malformed` refusal in
every identity position (`integrity`, `tarball`, `version`, a dependency reference, `os` / `cpu`).
Inside a block-scalar body a `#`-led line, a line whose content starts with a TAB and a blank line
are ordinary text (a tab is a refusal only where the line is STRUCTURE — indentation counts spaces
only, so a tab-led line with fewer spaces than the body ends the scalar and is refused). Because the
reader neither folds nor clips it cannot say what STRING a block scalar is; what it guarantees is
that two scalars a YAML parser would read differently never hash alike inside an opaque
whole-entry hash. The hash therefore covers the HEADER token exactly as written (`|` vs `>`, `-` /
`+` chomping, an indentation indicator `1`-`9`; `0` is a malformed header) and the body LOSSLESSLY:
each line's indentation relative to the body (the indicator's, else the first non-blank line's —
negative when a line is indented less), its trailing whitespace, every interior blank line, and
what a whitespace-only line carries beyond the body indentation. What is only the file's layout
moves nothing: trailing blank lines (counted only under `+`, where YAML keeps them), a
whitespace-only line no longer than the body indentation (an empty line in YAML), and the depth of
the key itself. Structure is still right-trimmed once (a padded document marker is a marker, a
padded plain scalar is its trimmed text). The body is opaque and never an identity.

**Precedence**: when `package.json` `packageManager` starts with `pnpm@` and a `pnpm-lock.yaml`
exists, it IS the declared closure and any npm lockfile beside it is a recorded ignore (no fallback
to it if the pnpm lockfile is refused). Otherwise `npm-shrinkwrap.json` > `package-lock.json`, and
`pnpm-lock.yaml` is read only when no npm lockfile is present. The rule is anchored: only a
`packageManager` that STARTS with `pnpm@` selects the pnpm lockfile. A symlinked `package.json` is a
refusal, so the precedence rule is never decided from a file outside the revision. When
`packageManager` names a manager (`npm@`, `pnpm@`, `yarn@`) whose own lockfile is absent or
unsupported and ANOTHER family's lockfile is the one read, coverage says so (`package.json
packageManager declares … but the lockfile read is '…'`) — a recorded disagreement, never a refusal:
the lockfile that exists is still the only declared closure in the tree.

**Derivation**: a node per `packages` key `name@version` (or `@scope/name@version` — a v6-style
`/name@version` path key is refused) with a registry (semver) version; `integrity` from
`resolution.integrity`, which must be ONE `sha1-` / `sha256-` / `sha384-` / `sha512-` hash of the
exact padded base64 length of its digest (28 / 44 / 64 / 88 characters) when present — a multi-hash
SRI string (`sha512-… sha1-…`) is refused: pnpm writes the registry's `dist.integrity` verbatim, or
one `sha1-` derived from `dist.shasum`, and no registry output carrying several hashes has been
observed; `platformConditional` from `os`/`cpu` (sorted: list order is presentation). `snapshots` keys
(`name@version(peer@x)(patch_hash=…)`) are peer/patch VARIANTS of one identity: they collapse into
one node and are listed in the non-hashed `layout`. `optional` is read (true only when EVERY variant
carries a real YAML `true` — the quoted string `'true'` is not one). pnpm v9 records no `dev`/`peer` flags, so both are **derived by reachability
from the importers**: `dev` = not reachable through any importer's `dependencies` /
`optionalDependencies`; `peer` = reachable only through `peerDependencies` edges. v9 records no
install-script flag, so `installScript` is always `false` for a pnpm node (stated in coverage:
unknown, not proven absent). The root node's identity comes from `package.json` and is `root:true`,
so its own `version` is quarantined exactly as for npm: a release bump never re-keys the digest. Workspace
importers other than `.` have no locked identity: they are not nodes, and their direct-dependency
edges are attributed to the root. An `npm:` alias resolves to the REAL package identity (the alias
names an edge, never a node). Transitive edges carry `spec: ""` (v9 records resolved versions, not
ranges); importer edges carry the `specifier`, peer edges the `peerDependencies` range. The quarantined
`rootDeclared[]` lists importer `.`'s `specifier`s by group — declared ranges are visible, never hashed.

**Opaque entries, never fabricated nodes and never a silent drop**: what the reader cannot fully
model enters the HASHED top-level `unmodeled[]` as `{kind:"unsupported", key, reason, spec,
entrySha256}` AND is declared in `coverage.unsupported`. `entrySha256` covers the CANONICAL
serialization of the hashed part of the entry (mapping keys sorted, scalars unquoted, typed values
kept apart from their quoted twins), so YAML key order, quoting and flow/block style cannot move the
digest while any change of content does. `key` is the
entry's location in the lockfile (`importers/<importer>/<bucket>/<dep>`, `packages/<key>`,
`patchedDependencies/<name@version>`, `sections/<name>`). A workspace-local package is pinned by
the repository revision the report already carries, which is why a `link:` entry records the target
PATH, not a version. **Declared ranges never move the digest, for opaque entries too**: an
importer-level `link:` or alias entry hashes the dependency NAME (in its `key`) and the RESOLVED
value (the `version:` field — the link target path, the alias target `name@version`); its
`specifier` is quarantined with every other range (`workspace:*` → `workspace:^` and
`npm:string-width@^4.2.0` → `^4.2.1` keep the digest; a new link target or a new resolved alias
target moves it). Snapshot-level `link:` dependencies and `npm:` aliases are hashed the same way
(name + reference). Package-level, patch and section entries hash their whole raw entry. The entries: `link:` workspace dependencies; packages whose version is not a registry
version or whose resolution is `git` / `directory` (`file:`, git-hosted tarball URLs — the commit /
URL is in `spec.resolved`); the NAME of an `npm:` alias; every `patchedDependencies` entry (reason `pnpm-patched`, the patch hash in `spec.integrity`: a
patch changes the installed bytes while the node integrity stays the UNPATCHED tarball, so the
patch hash — not a node field — is what moves the digest); non-ASCII names;
unread top-level sections. A registry package without integrity keeps its node and carries its
tarball URL (`resolvedWhenUnpinned`). Coverage-only (fully modelled otherwise): `catalog:`
specifiers (the resolved version IS the node; the edge spec stays `catalog:` verbatim) and a `libc`
condition.

**Sections read past and NOT hashed**: `settings`, `overrides`, `catalogs`, `time`,
`pnpmfileChecksum`, `packageExtensionsChecksum` and `ignoredOptionalDependencies`. Each of them
steers RESOLUTION (which versions pnpm picks, which optional packages it drops, which hooks rewrite
manifests) or records when a version was published; none of them names installed bytes. Their whole
effect is the resolved closure already written to `packages` / `snapshots`, and that closure is what
is hashed — hashing the inputs as well would move the digest for two lockfiles that install exactly
the same thing. Any OTHER top-level section is unknown to this reader and is hashed whole as an
opaque entry (`pnpm-unread-section`).

**A dependency-free or link-only project is not hollow** (rulings D4-1 and D4-1a, the latter
founder-confirmed 2026-09-20): pnpm writes `importers: {.: {}}` and nothing else for a project with
no dependencies (D4-1), and a workspace whose only dependencies are links to each other is written
with importers alone — a `link:` dependency has no `packages` entry by construction, so its
presence is not evidence of a lost closure; it is already a hashed opaque entry (D4-1a). Such a
lockfile is accepted — root-only closure plus the hashed links, one coverage line — ONLY when no
importer declares a NON-link dependency (`dependencies`, `devDependencies`,
`optionalDependencies`: every entry resolved to `link:` or ranged `workspace:`) and `packages` /
`snapshots` are absent or empty; a single declared registry, `file:` or git dependency with no
`packages` is still a hollow lockfile. The npm family is unchanged (a root-only
`package-lock.json` still names its root entry and stays a refusal).

**A truncated lockfile is never a smaller legitimate one.** D4-1 and D4-1a accept lockfiles that
are importers alone, and a pnpm lockfile cut inside `importers:` looks exactly like one — a real
three-package workspace cut after its second importer is BYTE-IDENTICAL to a real two-package
link-only lockfile. The lockfile alone cannot decide that case; the tree it sits in can. Four
guards, every one a refusal (exit 2, nothing written), none of them a skip:

- **(a) no empty bucket, no bare entry.** pnpm never writes a dependency bucket with nothing in it
  nor a snapshot entry with no value (it writes `{}`): an importer or snapshot bucket that is YAML
  null or an empty mapping, and a snapshot entry that is null, are what a cut right after a key
  leaves behind.
- **(b) a workspace link lands on another importer.** A `link:` resolved from a `workspace:` range
  — or from a plain range under `link-workspace-packages` — names a workspace package, and pnpm
  writes every workspace package as an importer; the target (resolved from the importer's own
  path) must be an importer key, and never the importer itself. A `link:`-PROTOCOL dependency
  (`specifier: link:…`) names a directory by path: pnpm writes no importer for it and it may sit
  outside the tree, so it is exempt.
- **(c) every importer's `package.json` is covered.** For each importer the `package.json` of the
  SAME view the rest of the verb reads (the pinned tree, or the working tree under `--no-pin`) is
  read without following any symbolic link on the way, and every name it declares under
  `dependencies`, `devDependencies` or `optionalDependencies` must be recorded somewhere in that
  importer's entry. The one exemption is what pnpm itself leaves out: a `link:`-protocol
  dependency when the lockfile's `settings.excludeLinksFromLockfile` is `true`. An importer whose
  `package.json` is missing, is not a JSON object, carries a dependency field that is not an
  object, or whose path leaves the tree cannot be checked — a refusal.
- **(d) every workspace package is an importer.** When `pnpm-workspace.yaml` exists, every
  directory its `packages:` globs name (literals, `*`, `**`, `?`, `.`, `!` negation; wildcards
  never match a dot-led name; `node_modules` and `bower_components` never hold a package) that
  holds a `package.json` must be an importer, and so must the root. Another repository's tree under
  a glob (a gitlink, or a `.git` marker by the same rule the image walk uses) is not this
  workspace. A workspace file outside the YAML subset, a `packages` value that is not a list of
  strings, a glob syntax this reader does not evaluate (braces, character classes, extglobs), and
  a lockfile with workspace importers in a tree with NO workspace file cannot be checked — each a
  refusal. With no `packages:` key the workspace is the root alone (pnpm >= 10, measured on
  10.11.1); if the lockfile nonetheless has workspace importers (pnpm <= 9 took every directory),
  every directory holding a `package.json` is named.

Every line prefix — and, for the committed real shapes, every byte prefix — of the real
pnpm-written lockfiles in `fixtures/stack/pnpm-v9-real-shapes` and of the synthetic golden is
refused; only the whole file (or the whole file without its final newline: the same document) is
read.

**What the guards cost, and what they do not reach.** (c) and (d) make a snapshot a claim about
the lockfile AND its tree: a lockfile out of step with its `package.json` files (what `pnpm install
--frozen-lockfile` rejects), a workspace whose importers' `package.json` files are not in the view
(untracked nested checkouts, a partial tree), a manifest kept as `package.yaml` / `package.json5`,
and a declared dependency that a `.pnpmfile.cjs` hook or a removing override keeps out of the
lockfile are all refused, by design. Residual, stated plainly: the format has no terminator and no
checksum, so a cut that falls BETWEEN two dependency lines of the FINAL snapshot entry (or drops
that entry's last bucket whole) leaves a well-formed lockfile in which every package and snapshot
is still present. It is accepted; the manifest lacks the lost edges (its `manifestDigest` differs),
and the `stackDigest` — nodes and their flags, not edges — is the whole file's unless a lost edge
was the only path that made a package non-dev or non-peer. Likewise a pnpm <= 9 workspace with no
`packages:` key, cut back to a root importer that declares no registry dependency, reads as the
root alone.

**Fail-closed**: a HOLLOW lockfile (no or empty `importers`, `packages` or `snapshots`), a lockfile that does not cover its tree (the four guards above) and a lockfile with an entry the reader cannot trust (a dependency naming no
snapshot, a snapshot no package names, a key that is not `name@version`, a package with neither
integrity nor tarball, an integrity that is not a hash, a package carrying the root's own identity,
a patch without a hash, an importer / snapshot / dependency bucket / dependency entry of the wrong
type, an `os` / `cpu` that is not a list of strings) are refused WHOLE: exit 2, nothing written. A
`pnpm-lock.yaml` that is a symbolic link, or whose real path leaves the tree, is never followed.

**Cross-family digests**: `resolvedFrom` is `lockfile` for both families and `sources` is
quarantined, so the lockfile family itself never moves the digest — a closure with no install
scripts and no dev/peer/optional-flag disagreement hashes IDENTICALLY from an npm v3 and a pnpm v9
lockfile (pinned by `tests/stack-pnpm.test.ts` group 7). Equality is **not guaranteed** in general:
`installScript` (npm records it, pnpm v9 does not) and the derived-vs-recorded `dev`/`peer` flags
are hashed node fields and can differ for the same packages. Compare digests across families only
with that in mind; within one family the digest is the join key.

**Schema evolution before 1.0**: the manifest's strict enums (`sources[].parser`,
`unmodeled[].reason`) may WIDEN without a `schemaVersion` bump while the package is pre-1.0. A
consumer built against an older release therefore REJECTS a manifest produced from a newer lockfile
family (an unknown enum value is a validation error, never a silently-accepted guess); upgrade the
consumer to read it.

**Determinism**: same tree ⇒ byte-identical manifest on every OS (`tests/stack-determinism.test.ts`
and `tests/stack-pnpm.test.ts` pin committed goldens, their negative controls, and one test per
rule above). This section is descriptive of the verb that runs; grading a stack (a `stack` block on
the blueprint, version/closure constraint types) is not part of this specification version.

### 16.2 Stack diff (the closure classifier)

`bce stack diff --from <A> --to <B>` classifies every move between two StackManifests. Its inputs are
**manifests, never repositories**. An input is refused (exit **2**, nothing written) when it is not a
strict StackManifest (the message names the first failing path: `… is not a valid StackManifest: at
'<path>': …`), when its path is a symbolic link, or when its recorded `stackDigest` / `stackId` /
`manifestDigest` do not re-derive. `--out` is refused when it resolves to either input. The digest
re-derivation is a consistency check, not an authenticity check: the digests are unkeyed.

**Join key and set matching.** npm rows join on `(kind, name)` — never on the node id
`name@version`. A lockfile routinely holds several copies of one name. Per name, the versions present
on both sides are **retained** and produce no row unless their identity differs. **The root's own
resolution comes first, as a comparison of SETS, before the retained / one-sided split.** Per name,
`rootA` and `rootB` are the sets of versions the root node's edges resolve to on each side (its own
declared dependencies and, in a pnpm workspace, those of its importers — which `rootDeclared[]` does
not list). The edges carry no importer identity and collapse duplicates, so a root-set change is
classified by what **every assignment of importers to versions** implies. With
*D* = dropped-by-root = `rootA − rootB`:

- *D* empty: a version can only have joined the root. Joined **below** a version the root already
  reached: `unknown` (the joining importer may have moved down onto it). Joined above: no root row.
- *D* non-empty and `rootB` non-empty: **every** version in `rootB` below `max(D)` is a certain
  downgrade — one `backward` row `max(D) -> max(rootB)`, exit **2**, even when both versions stay in
  the closure and the two `stackDigest`s are equal. **No** version in `rootB` below **any** version
  in `rootA` — dropped **or retained**, since a retained higher version is one some importer may have
  left — means no assignment is a downgrade — equal-size sets pair from the top as `forward` rows,
  unequal sets write no root row. Otherwise some assignment is a downgrade and some is not — one
  `unknown` row, blocks, exit **2**: *edges carry no importer identity; at least one assignment of
  importers to versions is a downgrade*. (Comparing against *D* alone would pass `{2,9} → {5,9}` as
  `forward` while the assignment `{2 → 9, 9 → 5}` is a downgrade.)
- *D* non-empty and `rootB` empty: the root stopped reaching the name — no root row.
- A root set that contains a non-semver or precedence-equal version: `unknown`.

Versions consumed by a root row leave the pool; everything else set-matches as below. **The accepted
cost, stated plainly:** the legitimate control — one importer drops its dependency while a sibling
stays on an older version — produces the same manifest pair as an importer moving down onto the
sibling's version (same nodes, edges, `rootDeclared` and `stackDigest`), so it blocks too; likewise
an importer moving **up** onto a version below a sibling's retained version (`{2,9} → {5,9}` from
`2 → 5`) is the same pair as the sibling moving **down** (`9 → 5` while the other goes `2 → 9`), so
it blocks too. The rule compares retained versions with each other as well, so with TWO retained
root versions of a name ANY drop of that name blocks — even a pure upgrade above everything:
`{2,5,9} → {5,9,12}` (one importer `2 → 12`, the others untouched) is `unknown`, exit **2**,
because `5` sits below the retained `9`, while its sibling with nothing dropped (`{5,9} → {5,9,12}`,
a new importer joining at `12`) is an `added` copy, exit **0**. In a workspace that keeps one name
at two versions, every bump of a third importer therefore blocks until acknowledged: an accepted
fail-closed cost, never a wrong pass, and the comparison is deliberately not narrowed. The manifest
cannot tell the two apart; importer identity in the manifest is the real
fix and is a follow-on (WO-BSTACK-09, extractor work). **The false-pass half of the same limitation,
stated just as plainly:** an importer moving between two versions the root still reaches from other
importers (`app 9 / lib 9 / svc 2` → `app 9 / lib 2 / svc 2`) changes no root set, no node and no
edge — edges collapse duplicates — so the diff is `identical`, exit **0**, until importer identity
lands (WO-BSTACK-09). It is not made `unknown`: that would block every lockfile-only touch with zero
modeled difference. Instead, an `identical` report whose two manifests differ carries both
`manifestDigest`s as `manifestDigest: {from, to}` (absent on every other report), so a reader can
see that the lockfile changed even though nothing modeled moved. Both values are RE-DERIVED from
the manifest in canonical array order — never the recorded field, never the input's order: for a
manifest `stack snapshot` wrote that is exactly its recorded `manifestDigest`, a forged recorded
digest is never echoed, and a manifest diffed against a re-ordered copy of itself shows no field, so
an `identical` report is as byte-stable under input array order as every other report. For an npm manifest the root's
edges are exactly its declarations, so the sets have one version each and this reduces to a plain
root pair.
The remaining versions present on one side only are sorted by (SemVer 2.0.0 §11
precedence, full version string) and **paired from the top**: highest dropped with highest new, and so
on. Each pair is `forward` or `backward`.
Leftover dropped versions are `removed` copies and leftover new versions are `added` copies; such a
row has `scope: "version"`, `copy: true` and lists the unmoved versions in `retained`, so it cannot
be mistaken for a whole-name add or remove. A patch upgrade of a non-maximum copy beside a retained
maximum is therefore one `forward` row, and a new lower copy beside a retained maximum is an `added`
copy — neither is a downgrade.

| class | condition |
|---|---|
| `added` / `removed` | the name is present on one side only (`scope: "name"`); or one copy of a name that stays present entered / left (`scope: "version"`, `copy: true`). A **removed** name is `removed` whatever its version looks like |
| `forward` / `backward` | a dropped version paired with a new version of the same name, strictly higher / lower. Boolean flags that moved between the two nodes ride on the row as `flagsChanged` and do not block |
| `rewritten` | same name and version, different hashed identity: `integrity`, or any other non-flag hashed field. The compared field set is derived from the node itself, so every hashed field (e.g. `resolvedWhenUnpinned` on a node without integrity) is compared, including one a later manifest revision adds. The row names the `fields` and carries **both** values as `integrity: {from, to}`. **Blocks** (`approvalBlocked`, exit 2) |
| `flags-changed` | same name, version and integrity; only boolean flags moved (`dev`, `optional`, `peer`, `devOptional`, `installScript`). The row lists each as `flagsChanged: [{flag, from, to}]` and explains the digest change. It blocks **only** when `installScript` goes `false` → `true` |
| `spec-changed` | resolved nodes unchanged; a declared range on an edge moved, or the root started / stopped declaring a name or moved it between dependency groups — digest-neutral, informational, never emitted on an edge whose endpoint was rewritten |
| `unknown` | the direction cannot be proven: **any** version of a name that moved — on either side, moved or retained — is not strict `x.y.z[-pre][+build]` (git ref, tag, range, partial such as `22`); two versions of the name are precedence-equal but differ (build metadata), in whatever order they are listed; an **added** node has a non-semver version; an image tag or runtime declaration moved and the two values cannot be ordered; an entering image has neither a digest pin nor a strict-version tag; a hashed item differs and no row of its own sub-view names it; or **any** move (added, removed or changed) of an OPAQUE entry — a hashed `unmodeled[]` entry |

**Images and runtime.** `images[]` entries join on the image name. One entry replaced by one entry:
a different tag is `forward` / `backward` when both tags are strict versions and `unknown` otherwise;
the same tag with a different digest is `rewritten` and carries both digests; the same tag and digest
with another hashed field moved is `rewritten` naming the field. An entering image is `added` only
when a digest pins it or its tag is a strict version; a leaving image is `removed`; several entries
of one name moving at once are `unknown`. The `runtime.node` block: a different declared value is
`forward` / `backward` when both are exact versions, else `unknown`; the same declared value with
another field moved is `rewritten`. The `oci-image` and `node-runtime` **nodes** are projections of
these blocks and are explained by these rows.

**Every hashed sub-view is explained by its own rows.** The hashed view has four parts — `nodes`,
`runtime`, `images`, `unmodeled`. After the rows are built, every hashed item that differs between
the two views must be named by a digest-bearing row **of the same sub-view**. Anything left over is
listed in `unexplained` (`<view>:<key>`), `unexplainedDigestChange` is `true`, the classification is
`unknown-potential-backward` and the exit code is **2**. A node row never explains an image, runtime
or unmodeled change, and a `spec-changed` row explains nothing. The digests in the report are
re-derived from the hashed view; the recorded `stackDigest` field is never read. The root rows above
read `edges[]`, which is quarantined out of `stackDigest`: two manifests with one digest can
therefore get different verdicts. `manifestDigest` covers `edges[]`, and both digests are unkeyed
consistency checks — the extractor is what vouches for the edges that decide a root direction.

**The root.** The root node is compared apart from the closure and joined on its name. Its OWN
version is quarantined out of the digest, so two manifests that differ only in the root version are
an empty diff (exit 0); a different root *name* is a different subject and is `unknown`; a root whose
only moved fields are boolean flags is `flags-changed` (blocking only on an install-script gain, as
for a dependency); any other hashed root field that moved is `rewritten`. A dependency that merely shares the root's name is
joined with dependencies, never with the root. Declared ranges are quarantined too and live only in
`rootDeclared[]` / `edges`: every row carries `rootSpec` — the range(s) the root declares for that
name on each side, read from the manifest's `rootDeclared[]` (from the edges leaving the root when a
manifest carries none) (e.g. `^4.1.11` → `^5.0.0`) — as the evidence that a root-declared move was
asked for, and an edge leaving the root is keyed by the version-free `root:<name>`.

`layout` (hoisting) is not identity and never produces a row; rows carry path counts only. An
unchanged node never produces a row, whatever its version looks like — identical closures are an
empty diff.

**Exit contract.** `unknown` mirrors the policy-change classifier: the report classification is
`unknown-potential-backward`, and there is no approve-anyway input. The report carries two
independent flags and the verb exits **2** when either is set, else **0**:

| flag | set by |
|---|---|
| `approvalBlocked` | any `unknown` row (including the lockfile-family row); any `rewritten` row; a `flags-changed` row whose `installScript` went `false` → `true`; an unexplained hashed change |
| `downgradeAckRequired` | any `backward` row; any `unknown` row; an unexplained hashed change |

`added`, `removed`, `forward`, `spec-changed`, and a `flags-changed` row that gains no install script
do not set either flag. Each row carries its own `approvalBlocked`.

**Lockfile family.** The parser that read each side's lockfile is visible only in the quarantined
`sources[].parser`, so neither digest can see it. Every parser value other than the non-lockfile ones
(`package-json`, `dockerfile`, `compose`, `nvmrc`, `node-version`) is a lockfile *family*, compared as
an opaque string — a family a later extractor adds is compared, not ignored. When the two sides'
family sets differ (including a side that has none), the closures are not comparable: the report
classification is `unknown-potential-backward` (even above a `backward` row), `approvalBlocked` is
`true`, the exit code is **2**, and the **first** row is `unknown` with `view: "sources"`, name
`lockfile-family`, and both family sets as `from` / `to`. The per-node rows are still listed beneath
it. With the same family set on both sides no row is added and no report byte changes.

**Rank and order.** `backward > unknown > rewritten|flags-changed > added|removed > forward >
spec-changed > identical`; the report classification is the highest rank present, and inside one rank
the louder class names it (`rewritten` over `flags-changed`, `removed` over `added`). Rows are sorted
by the explicit total comparator `(lockfile-family row first, rank desc, name, kind, class, from, to,
declaredBy, canonical row bytes)` and the report is serialized by the §11 rules, so the same pair — in any `nodes[]` /
`edges[]` / `images[]` / `unmodeled[]` array order — yields byte-identical report bytes. The report
is a verb output, not a published schema in this specification version.

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
