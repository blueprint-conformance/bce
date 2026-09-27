# RFC-0002: Declared-stack contracts and forward repair obligations

Status: draft for public RFC discussion; local enforcement implementation accepted; reconciliation deferred
Author(s): BCE maintainer, with AI-assisted drafting

This document follows [RFC-0001](RFC-0001-process.md). On 2026-09-20 the human
maintainer explicitly accepted the enforcement contract and directed local implementation:
“Accept the enforcement contract; implement locally.” The accepted source proposal was
commit `a97d32c65897b85a11d5d9a3424c7b15ef41d768`; the implementation foundation is
`fc76183f5cdfa4f51ebc99a780af1808a8ca0285`.

Acceptance covers the five declared-stack rules, explicit source selection, refusal on
insufficient evidence, ordinary-gate integration and versioned offline replay. Repair,
reconciliation and cross-repository work are **deferred**. The reconciliation sections
below remain proposals and create no implemented command or mutation authority.

This is a local maintainer decision record, not a claim that the RFC was reviewed
publicly, merged or released. This draft PR begins that separate public discussion;
the RFC status must record its public decision before any follow-on implementation PR.
The local development engine uses the proposed `0.5.0` identity so real minimum-engine
checks apply; this is not evidence of a published 0.5.0 package. Public distribution,
pinning and self-adoption remain subject to the required release sequence.

## Summary

Make the ordinary conformance gate enforce selected declared package, image and Node contracts alongside code, replay its facts offline, and produce bounded forward repair obligations. The enforcement portion is accepted for local implementation; reconciliation remains deferred and no public release is claimed.

## Motivation

One ordinary gate checks code plus selected declared npm/pnpm packages, image references and Node declarations; repository repairs turn red to green with unchanged policy. Its complete fact artifact can reproduce the evaluation offline. Missing or insufficient evidence refuses. Reconciliation emits a proposed repair without modifying the repository, policy, baseline, dependencies or installed engine.

Two equality rules alone are powerful but do not meet the adoption journey's explicit forbidden-transitive-package and universal-image-pinning cases. Recommend five small rule types, sharing one provider and evaluator. Runtime allowlists use exact versions; defer semantic ranges, importer-specific selectors, installed-state claims, vulnerability checks, registry resolution and automatic application. There is no new semver-range dependency.

## Design

### Authored source block

Proposed additive optional top-level `stack` object, strict recursively. Example JSON fragment to merge into an otherwise valid EngineeringBlueprint:

```json
{
  "minEngineVersion": "0.5.0",
  "stack": {
    "source": "npm-lockfile-v3",
    "lockfile": "package-lock.json",
    "packageManifest": "package.json",
    "imageFiles": ["Dockerfile", "compose.yaml"],
    "runtimeFiles": [".nvmrc"]
  }
}
```

`source` enum is `npm-lockfile-v3 | pnpm-lockfile-v9`. The initial feature requires an npm/pnpm repository-root package manifest and lockfile, including for image/runtime-only rules; arbitrary non-Node repositories are out of scope. Exactly one lockfile; v1 permits only repository-root `package-lock.json` / `npm-shrinkwrap.json` for npm, `pnpm-lock.yaml` for pnpm, and `package.json` for packageManifest. This avoids pretending current provider supports arbitrary workspace roots. `imageFiles` contains unique sorted exact relative paths, no globs; extension/parser compatibility validated. `runtimeFiles` contains a unique sorted subset of `.nvmrc`, `.node-version`, `package.json`; package.json means engines.node. Empty imageFiles is legal only without image constraints. Empty runtimeFiles is legal only without runtime constraints. Arrays explicitly required, including `[]`; absence does not activate discovery.

All configured files must exist, be regular files, remain inside real repository root and have no symlink components. Invalid/missing inputs refuse, even when another candidate exists. Multiple package-manager root locks or inconsistent packageManager declarations refuse; do not silently use snapshot's existing precedence. Do not change snapshot's established behavior. Extend the existing extractor with a strict selection mode, reusing parsers and canonical manifest functions; avoid a parallel parser. Record precisely consumed files and hashes. For runtime selection, refuse conflicting relevant declarations rather than treating `.nvmrc` precedence as proof of consistency. Other present runtime declarations participate in conflict detection and are recorded; source omission cannot hide contradictory facts.

Image policy quantifies over selected files, never every repository image. The current automatic discovery is bounded to depth 3 and compose scanning is line-based: preserve that limitation explicitly. Selected image files need supported, fully interpretable relevant image declarations; unresolved ARG/variables, ambiguous compose syntax or stage classification refuse relevant image grading. A compose build-only service is not a resolved image; never invent one. With current parser limits, conservative refusal may make compose unsuitable for the initial consumer fixture; a supported Dockerfile is enough to prove the vertical journey. Do not suppress known coverage limits to obtain green.

Changed-file selection is conservative: union existing code selector with every configured stack path, blueprint/config changes, alternative root locks, all runtime candidate paths and relevant package-manager config. Deletions/renames retain old paths from change input. New unselected image files do not expand this explicit contract; report selected scope prominently. Unknown/truncated change lists select the blueprint. All gate modes share selection.

## Rule JSON and semantics

Existing id/severity fields remain. Proposed new fields are legal only on their rule arms; reject extraneous combinations. Every arm has evidence class `declaredStack`; none falls through to staticAst.

```json
[
  {"id":"stack-package-pin","type":"pinnedVersion","severity":"high","stackTarget":{"kind":"npm","name":"is-number"},"expectedVersion":"7.0.0"},
  {"id":"stack-image-pin","type":"pinnedVersion","severity":"high","stackTarget":{"kind":"oci-image","name":"node"},"expectedVersion":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
  {"id":"stack-runtime-pin","type":"pinnedVersion","severity":"high","stackTarget":{"kind":"node-runtime","name":"node"},"expectedVersion":"22.22.2"},
  {"id":"stack-closure","type":"stackClosureMatch","severity":"high","expectedStackDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"},
  {"id":"no-legacy-package","type":"forbiddenStackPackage","severity":"high","packageName":"legacy-package"},
  {"id":"images-immutable","type":"requirePinnedImages","severity":"high"},
  {"id":"supported-node","type":"allowedNodeVersions","severity":"high","versions":["22.22.2","24.8.0"]}
]
```

Digests above are illustrative, not trusted release facts. Names compare exactly to existing extractor names; no registry alias inference. npm pin selects every modeled non-root npm identity of that name, including transitive, dev, optional, peer and platform-conditional entries. At least one match required; a known absent selected package is a violation. Every occurrence must have exact expected version. npm expectedVersion is a literal exact semver x.y.z with optional standard prerelease/build suffix, no prefix v, range, alias, URL or tag. Comparison is literal string equality (build metadata remains distinct); invalid authored values refuse validation. Any opaque npm entry makes this all-occurrence pin ungradeable, even alongside conforming modeled matches. An exact npm version is not a tarball-integrity rule; label this distinction. An unresolved selected image declaration that might match a named pin refuses that pin as well as universal image rules; known mismatches remain diagnostic violations. OCI pin compares digest, not mutable tag, for every selected declaration whose parsed image name matches; require at least one match. Runtime pin requires literal exact normalized x.y.z, not `22`, `lts/*`, ranges or an executing process version. These rules never use machine Node version.

`stackClosureMatch` compares canonical `stackDigest`, including hashed opaque entries; it does not assert topology/importer identity, source-byte equality, or installed closure. Opaque entries are permitted for this rule because their raw identity hashes are part of the comparison, but unread/invalid source material refuses. Coverage warnings remain visible. Source-only whitespace changes may alter manifestDigest while closure rule stays green.

`forbiddenStackPackage` requires zero matching non-root npm names. Positive modeled matches establish violations; inability to prove absence due to relevant opaque entries refuses. Initial implementation may conservatively refuse every npm opaque entry for this rule; do not infer alias target safety. `requirePinnedImages` requires at least one selected image and every selected image to have a syntactically valid sha256 digest. A complete scan with zero external images violates the rule's explicit existence requirement; an incomplete scan refuses. `allowedNodeVersions` is a nonempty sorted unique exact-version set; resolved declaration must equal an entry. Ranges/aliases are ungradeable, not ordinary mismatches. Both runtime rules may coexist; validation can reject contradictory authored exact policies rather than silently succeeding one arm.

## Gradeability and outputs

Input failure / insufficient relevant evidence => refusal2; complete known mismatch => violation1 in enforced mode; all constraints gradeable and conforming => pass0. Global invocation exit2 dominates any simultaneously proven violation. Retain proven violations alongside refusals for diagnosis, but never label whole evaluation conformant. Baseline cannot consume refusals and advisory cannot soften them. Ordinary graded violations retain existing baseline/advisory semantics, explained below.

Map source/extraction limitations to facts explicitly: package unread/unsupported lockfile invalidates package rules and closure; relevant unresolved image invalidates image rules and closure when identity cannot be represented; runtime conflict invalidates runtime and closure. An irrelevant image warning need not invalidate a package-only policy, but must be displayed. Unknown coverage codes default to refusing affected stack evaluation until classified. Use a typed internal gradeability result; do not rely on permissive substring guessing of human warning text.

Use existing Violation shape: component `npm:legacy-package`, `oci-image:node`, or `node-runtime:node`; evidenceType `declaredStack`; observed and expected strings; truthful evidenceRef e.g. `package-lock.json#/packages/node_modules~1legacy-package` (JSON Pointer) or `Dockerfile#L1`. Never fabricate line numbers. Deduplicate identical identity violations deterministically; retain occurrence/source anchors in stack details. Stable violation identity should follow existing baseline machinery, reviewed against source identity changes.

## Concrete report and evidence envelope

Preserve schemaVersion1 report/bundle bytes and scoring exactly for non-stack policies. Recommend new schemaVersion2 report and bundle ONLY when a declaredStack constraint is present. This is intentional protocol versioning: current evidence verifier hard-checks version1 and replays only graph facts, so a silent v1 extension risks false compatibility. Do not alter a legacy report merely because a snapshot happened elsewhere.

V2 report reuses existing blueprintRef, ctRepoRevision, repo, score, violations, evidenceRef, summary and optional mode. Its verdict adds `indeterminate`. Replace legacy mandatory AST coverage with explicit providers; stack-only report has no invented graph or AST success. The complete illustrative bundle below defines the proposed envelope. Report coverage contains a provider array, with no mandatory AST provider. `stack` is the four-field digest/claim object shown there, or null only if acquisition failed before a complete artifact existed. Refusals contain `{constraintId,evidenceClass,code,reason,sources:string[]}`, sorted by constraintId/code/sources. Score is null exactly when verdict is indeterminate; otherwise the existing numeric severity weighting applies. Proven violations survive alongside refusals. Invalid authored blueprints remain invocation errors, not invented reports.

A complete artifact may produce a refusing report and still be bundled for replay. If acquisition fails before a complete manifest/provider-facts pair exists, emit an indeterminate report with stack null and no portable bundle; never fill a manifest with invented empty facts. Mixed reports include the existing staticAst coverage under its own provider entry; existing behaviorObservation semantics remain. Portfolio/Markdown/JUnit/SARIF must handle null explicitly, never coerce it to 0 or 100.

V2 bundles contain blueprint, stackManifest, stackFacts and report. Mixed bundles additionally contain graph and hashes.graph; stack-only bundles omit both and use extractionProfile null. V2 toolchain replaces the old singular extractor with providers: staticAst entries reuse its exact extractor fields; declaredStack uses `{evidenceClass:"declaredStack",provider:"selected-stack-v1",version:<engine-version>}`. Existing engine, dependencyLock and runtime fields remain. This is a v2-only change; no v1 identity changes. Every artifact receives its own canonical SHA256, including stackFacts. The bundle hash covers the entire canonical envelope with only hashes.bundle omitted. Report evidenceRef names the provider-facts digest, avoiding circular bundle/report identity. Report stack digest fields bind the manifest; stackFacts binds the same manifestDigest and sourceConfigDigest.

StackManifest remains strict schema1 without new fields. Hash the full canonical manifest including manifestDigest, and independently recompute manifestDigest, stackDigest and stackId using existing functions. Exact provider facts, source inventory and replay checks follow below. All new objects are strict; no implicit extra fields.

Offline verifier parses blueprint, enforces engine minimum/capability, verifies every artifact hash and complete bundle hash, validates manifest invariants/source binding, re-evaluates using the SAME shared evidence dispatcher, and byte-compares reproduced report. Hash bundle body with bundle hash omitted, same canonical serializer. Missing/substituted manifest, mismatched sources/revision/config, unused injected graph or incompatible coverage must refuse. An attacker who changes both facts and report and rehashes the entire unsigned bundle can create a different internally consistent artifact; integrity cannot establish provenance. Do not promise rejection of every coherent forgery. Independent re-extraction from trusted source is an additional provenance check, not bundled replay.

Evidence records and review lineage include optional stackDigest AND manifestDigest only when derived from the evaluated artifact; omit both otherwise. Full manifest must travel in portable evidence; digest-only rows do not replay facts. Review binds candidate/source identities as today; stack data never supplies approval authority.

## Compatibility and baseline decisions

Old engine strict parsing rejects top-level stack; new constraints also require minEngineVersion0.5.0 (version provisional until release owner chooses). Regression must exercise old published engine and tolerant parsing: new policy cannot become green after unknown constraints are skipped. New engine + old blueprint yields byte-identical old report and v1 evidence; new + stack blueprint yields v2. No schema-only release that accepts inert constraints. Installed blueprint and baseline stay unchanged throughout implementation.

Use existing baseline treatment for established, gradeable violations: an explicitly reviewed committed baseline can mark them pre-existing. Do NOT silently special-case stack violations to bypass established baseline semantics. The acceptance journey uses unchanged empty baseline so actual package/image/runtime violations fail1. Refusal cannot be baselined, ever. Capturing a fresh baseline is a protected relaxation; reconcile cannot generate/install it. Changing pinnedVersion or closure digest is generally incomparable/unknown-potential-relaxation, not automatic tightening. Removing a constraint or sources relaxes; changing source identity is unknown. Adding a constraint tightens only with well-formed unchanged source scope. Narrowing exact Node allowlist tightens, widening relaxes; runtime parser/rule changes remain protected code review.

## Proposal-only reconciliation

Do not depend on nonexistent `stack resolve`. Initial proposed invocation is `stack reconcile --base <bundle-v2> --head <bundle-v2> --target <bundle-v2> --blueprint <blueprint> --out <quarantine-json>`. Each input is a complete v2 evidence bundle carrying manifest and typed stackFacts, not a bare manifest. Verify each bundle with the unchanged supplied blueprint; head may have a gradeable failing report, while base and target must be gradeable and conformant. All manifests must pass complete identity and source-binding validation; the blueprint is the unchanged reviewed policy. Verify the current repository's source hashes/revision against head. Base explains the observed drift and must satisfy the same policy; it is never a file-restoration instruction. Target is an explicitly supplied desired declaration state, not a registry resolution result or authority to mutate anything.

Require target to be fully gradeable and conformant under unchanged policy. Compute head→target through the existing stack-diff implementation; only `forward` or `identical` permits a proposal. Unknown/backward refuses even if the desired policy passes. A useful target may therefore not exist for an exact pin or closure rule after an unwanted upgrade: report that honestly and point to separately reviewed forward dependency repair or policy review, never restore older source files or weaken the classifier. Base→head classification is explanatory only; it cannot authorize a backward head→target repair. For identical closure with changed declarations, bind and compare full manifests and source hashes; identical stackDigest is not evidence that files or topology are identical.

Proposed envelope: `{schemaVersion:"1",kind:"StackReconcileProposal",blueprintDigest,baseManifestDigest,headManifestDigest,targetManifestDigest,baseBundleDigest,headBundleDigest,targetBundleDigest,sourceConfigDigest,direction,obligations,limitations,proposalDigest}`. Here direction is exactly `forward | identical` for head→target; canonical proposalDigest excludes itself. No timestamps or machine-dependent absolute paths. Each obligation has this shape:

```json
{
  "kind":"satisfy-forward-stack-target",
  "constraintIds":["images-immutable"],
  "sources":[{"path":"Dockerfile","expectedHeadSha256":"<hex>","targetSha256":"<hex>"}],
  "targetManifestDigest":"<hex>",
  "facts":[{"kind":"oci-image","name":"node","expectedDigest":"sha256:<64 hex>"}],
  "patchStatus":"not-produced"
}
```

Fact arms are explicit discriminated requirements: npm `{kind:"npm",name,expectedVersions:string[]}`, OCI as above, Node `{kind:"node-runtime",name:"node",expectedVersion}`, and closure `{kind:"stack-closure",expectedStackDigest}`. Facts describe the supplied target, not a package-manager command or a claim that an arbitrary file edit yields that target. Require unambiguous fact→source mapping; otherwise refuse to manufacture an actionable obligation. A digest in the target does not prove image availability or origin authenticity.

The target's sources are declared hash commitments until their desired bytes are supplied. A valid manifest can support an internally consistent target obligation but cannot prove that an exact patch exists. Therefore initial output always says `patchStatus:"not-produced"`; it does not include invented bytes, a diff, shell commands, or an apply operation. Any future exact-patch mode must accept contained desired-source files, check their hashes, re-extract the target with the same strict source configuration and compare the complete produced manifest before claiming a patch. That extension requires an accepted design; do not infer it from this proposal envelope. Source additions/deletions or unsupported mappings refuse initial obligation generation rather than inventing missing hashes.

No writes except explicit quarantine output. Reject output/input aliases, hardlinks and symlink paths; no npm/pnpm/network/process mutation, baseline change, policy rewrite, ratification or automatic application. If no provable conformant forward target exists, refuse with precise reasons and review guidance. Fix-forward-only holds independently of whether the old base was once conformant.

## Implementation work orders after acceptance

1. Schema/capability + selected-source provider: generated schemas, strict cross-field validation, minimum-engine/tolerant-parse vectors, source and coverage typing; new types refuse until full integration. No partial shipped acceptance.
2. Shared evaluation + gate selection: five rule arms, pure evaluation, mixed/stack-only facts, report2 and refusal aggregation, baseline/mode/portfolio/renderers; CLI/MCP/teeth all call same preparation seam.
3. Replay + lineage + teeth: bundle2, record binding, verifier1 compatibility, synthetic evaluator mutations and real lockfile/Dockerfile/runtime source mutations clearly distinguished. Quarantine forward-target obligations with freshness/alias tests, explicit backward/unknown refusal and no exact-patch claim.
4. Packed consumer/CI: genuine install, initial three independent violations, repairs with fixed policy, source deletion/opaque/variable/runtime conflict refusal, lockfile-only gate selection, offline replay in separate temp consumer, intentional manifest substitution/tamper, old-engine fail-closed. Generated CI check must exercise ordinary gate. Release/pin/self-adoption are subsequent owner-controlled acts.

## Owner decisions to record in RFC acceptance

Accept explicit selected-file image scope (not whole-repository coverage); five rule types with exact-version runtime sets rather than ranges; all-occurrence package pin; package exact version does not assert integrity; closure digest does not assert topology; strict source ambiguity refusal; existing baseline/advisory semantics; schema2 stack report/bundle with null indeterminate score; conservative proposal-only forward-target obligations. Accept or revise release ordering explicitly: local development is allowed after accepted RFC on proved foundation, but public0.5/pin/self-adoption follows required0.4 foundation release sequence. No statement here ratifies these decisions.

## Portable provider facts and source-binding algorithm

`stackFacts` is a proposed strict artifact with exactly: schemaVersion `"1"`, kind
`"DeclaredStackFacts"`, provider `"selected-stack-v1"`, ctRepoRevision,
manifestDigest, sourceConfigDigest, inventory, domains and limitations. It is not
an addition to StackManifest v1. Domains is an object with exactly packages,
images, runtime, closure; each value is `complete | incomplete | not-selected`.
A domain is complete only after its selected source scan completed. Runtime and
images are not-selected exactly when their authored arrays are empty. Packages
and closure cannot be not-selected because a lockfile and package manifest are
mandatory. A closure rule requires image/runtime arrays to describe its intended
scope explicitly; empty arrays exclude those domains, not discover them implicitly.
The resulting digest is a selected closure, not a claim about all repository files.

Inventory is a unique path-sorted array. Each row is exactly `{path,role,present,
sha256,parser}`. Role is `selected | conflict-check`. Present files have SHA256;
absent files have null SHA256. Parser is the corresponding manifest parser, or
`package-manager-config` for `.npmrc` and `pnpm-workspace.yaml`. These two config
files are detection-only: a present nonempty config whose effect cannot be fully
characterized by the existing provider refuses package/closure grading. The
initial strict mode conservatively refuses any nonempty one; it never silently
applies configuration or executes hooks. Empty means zero non-whitespace bytes.

The finite inventory is exactly the union of authored paths and these root paths:
`package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `package.json`,
`.nvmrc`, `.node-version`, `.npmrc`, `pnpm-workspace.yaml`. No glob or recursive
ambient scan. Authored entries have role selected, even if also a conflict-check
candidate. There are no other allowed additional files. Known root locks use
their corresponding parser; `.nvmrc` uses nvmrc and `.node-version` node-version.
Selected image paths must be Dockerfile/Dockerfile.* basenames or compose.yaml,
compose.yml, docker-compose.yaml, docker-compose.yml; parser follows that class.
Paths use canonical relative POSIX segments, no empty/dot/parent segments, backslash,
absolute paths or NUL. This proposal excludes arbitrary alternate image filenames.

Runtime conflict checks read all present runtime candidates including package.json
engines.node even when not selected. If any relevant declaration is non-exact or
exact declarations disagree, runtime and closure become incomplete whenever runtime
is selected. Without selected runtime, those declarations are recorded as detected
but contribute no runtime node/value to the manifest and do not grade runtime.
PackageManager must match the selected lock family; missing declaration is allowed,
unsupported or inconsistent declaration refuses. More than one present root lock
refuses packages and closure; an alternative is never silently preferred. Symlink,
nonregular or escaping candidate inputs refuse acquisition, including conflict checks.

For a completed scan, manifest.sources is exactly the selected present file set:
lockfile, packageManifest, imageFiles and runtimeFiles (deduplicated). It excludes
conflict-check-only files. Those hashes remain bound in stackFacts. Unreadable is never absent: permission/read errors abort acquisition. A selected package.json has one row/hash even when it supplies package metadata and runtime; uses follow from the authored configuration, not duplicated rows. Manifest
coverage.filesScanned equals that selected set's size; report's declaredStack
filesScanned equals the same count, not the number of absence probes. Images may
only have evidenceRef paths in selected imageFiles. Runtime resolvedFrom must refer
to a selected runtime source; package nodes/rootDeclared/edges come from the selected
lock family. Package-json supplies metadata and declaration consistency, never a
second dependency resolver. Distinct exact runtime spellings normalize only a single
leading `v`; no range evaluation is introduced. Snapshot's existing auto-discovery
contract remains unchanged; strict selection is a new mode of the shared provider.

Limitations is a deterministic array of exactly `{code,domains,sources,message,
manifestWarningIndexes}`. Codes are `opaque-package-entry`, `unresolved-image`,
`runtime-conflict`, `non-exact-runtime`, `ambiguous-package-manager`,
`unsupported-package-manager-config`, `unsupported-source-syntax`,
`unclassified-coverage`. Domains is a sorted nonempty subset of the four domain
names; sources contains sorted inventory paths. Warning indexes index the unchanged
manifest.coverage.unsupported array. Each warning index occurs exactly once, and
message is exactly that warning for entries carrying one index. Entries with no
index are permitted for additional strict selection checks. Grouping multiple
warnings in one entry is forbidden initially. Unknown codes, unmatched warnings,
missing domains or duplicate indexes refuse all stack evaluation; they never grant
completeness. Producer branches emit typed codes at the point the limitation is
observed. An absent peer explicitly marked optional by `peerDependenciesMeta` is a
known npm installation choice, not lost closure coverage: the automatic snapshot
may retain its diagnostic note, while strict selected facts do not emit a
limitation for that absence. Missing required peers, dependencies and optional
dependencies remain coverage limitations. Human warning substring matching is
prohibited.

The verifier checks code/domain rules independently: opaque-package-entry requires constraint-level package uncertainty but leaves the packages domain complete when every entry was enumerated and hashed; it does not invalidate closure when its full raw entry hash is in unmodeled;
unresolved-image affects images and closure; runtime-conflict/non-exact-runtime
affects runtime and closure if selected; ambiguous-package-manager and unsupported
config affect packages and closure; unsupported syntax and unclassified coverage
affect all selected domains. Packages complete means complete enumeration including
explicit opaque entries, not knowledge of their names. Any opaque entry makes
package pin/forbidden-name rules ungradeable, conservatively, even if a matching
modeled entry proves a diagnostic violation. A closure rule may still compare
opaque-entry identities. Unknown limitation text/code is never evidence of safety.
Domains marked incomplete must agree with these rules; an unexplained incomplete
value refuses, never upgrades itself to complete.

Offline verification performs these steps in order:

1. Strict-parse blueprint and envelope; enforce the declared engine floor and actual
   implemented capability. Recompute every artifact and envelope hash.
2. Recompute all three manifest identities. Check graph, manifest, facts and report
   revisions agree where present. Check facts' manifestDigest and canonical hash of
   the blueprint's exact stack object. Reject injected unused graph or source rows.
3. Reconstruct the finite required inventory from policy. Validate its exact paths,
   roles, parsers, present/hash pairing, required selected presence, selected source
   equality with manifest.sources, and absence/presence conflict rules above.
4. Validate typed limitations, warning-index coverage and derived gradeability. Domain completeness records enumeration; per-constraint gradeability additionally accounts for opaque identities, exact runtime requirements and unresolved selectors.
   Cross-check all manifest image anchors, runtime origin, opaque entries and source
   parsers against that inventory. Require opaque entries to have their typed
   limitation; an opaque-free manifest cannot claim that limitation. Apply package
   manager/runtime conflict facts conservatively. Report provider coverage must
   match this validated record, not a caller-supplied green assertion.
5. Run the shared evidence dispatcher and report serializer, then compare the entire
   reproduced report canonically. V2 evidence requirements must include required
   declaredStack/onMissing:block when any stack constraint exists; mixed policies
   retain required evidence for their other constraint classes. Missing required
   evidence refuses before ordinary scoring.

These checks establish **internal consistency only**. Neither inventory absence,
source hashes, typed limitations, nor extracted facts prove what was in a real
repository. Re-extraction from independently trusted source bytes at the stated
revision, with the same strict configuration, is necessary to validate all those
observations. In particular, hashing a config cannot prove the provider obeyed it.
Coherently altered unsigned facts plus fresh hashes may pass internal replay. This
is not provenance, signature verification, image availability or package authenticity.

## Complete illustrative stack-only bundle

The following is one complete proposed structural example, with no omitted required
fields or empty placeholder artifacts. Hashes/revision are **illustrative values**,
not measured evidence; this JSON is shape-valid by the proposed contract but is
intentionally not a hash-verification vector. It cannot be presented as a passing
real bundle. The manifest models an empty dependency closure for a real root package;
forbidden-name absence is gradeable because there are no opaque entries. Absent
runtime and image selections do not invent AST extraction or runtime observation.

```json
{
  "schemaVersion": "2",
  "kind": "BceEvidenceBundle",
  "claim": "self-contained-integrity-not-origin-authenticity",
  "engine": {
    "name": "bce-engine",
    "version": "0.5.0"
  },
  "environment": {
    "node": "22.22.2",
    "npm": "10.9.4",
    "platform": "linux",
    "arch": "x64"
  },
  "toolchain": {
    "engine": {
      "name": "bce-engine",
      "version": "0.5.0"
    },
    "dependencyLock": {
      "file": "npm-shrinkwrap.json",
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    "runtime": {
      "node": "22.22.2",
      "npm": "10.9.4",
      "platform": "linux",
      "arch": "x64"
    },
    "providers": [
      {
        "evidenceClass": "declaredStack",
        "provider": "selected-stack-v1",
        "version": "0.5.0"
      }
    ]
  },
  "invocation": {
    "command": "bce run",
    "extractionProfile": null
  },
  "artifacts": {
    "blueprint": {
      "apiVersion": "blueprint-conformance/v1alpha1",
      "kind": "EngineeringBlueprint",
      "metadata": {
        "id": "no-legacy",
        "version": "0.1.0",
        "status": "draft"
      },
      "intentRefs": [
        "policy/no-legacy"
      ],
      "scope": {
        "repositories": [
          "example/app"
        ]
      },
      "architecture": {
        "components": [],
        "relationships": []
      },
      "constraints": [
        {
          "id": "no-legacy",
          "type": "forbiddenStackPackage",
          "severity": "high",
          "packageName": "legacy-package"
        }
      ],
      "evidenceRequirements": [
        {
          "type": "declaredStack",
          "required": true,
          "onMissing": "block"
        }
      ],
      "approvals": [],
      "minEngineVersion": "0.5.0",
      "stack": {
        "source": "npm-lockfile-v3",
        "lockfile": "package-lock.json",
        "packageManifest": "package.json",
        "imageFiles": [],
        "runtimeFiles": []
      }
    },
    "stackManifest": {
      "schemaVersion": "1",
      "kind": "StackManifest",
      "ctRepoRevision": "1111111111111111111111111111111111111111",
      "sources": [
        {
          "path": "package-lock.json",
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "parser": "npm-lockfile-v3"
        },
        {
          "path": "package.json",
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "parser": "package-json"
        }
      ],
      "nodes": [
        {
          "id": "npm:example-app@1.0.0",
          "kind": "npm",
          "name": "example-app",
          "version": "1.0.0",
          "integrity": null,
          "resolvedFrom": "lockfile",
          "dev": false,
          "optional": false,
          "peer": false,
          "platformConditional": null,
          "root": true,
          "devOptional": false,
          "installScript": false,
          "resolvedWhenUnpinned": null,
          "layout": [
            ""
          ]
        }
      ],
      "edges": [],
      "runtime": {
        "node": {
          "declared": null,
          "resolvedFrom": null,
          "pin": false
        }
      },
      "images": [],
      "rootDeclared": [],
      "unmodeled": [],
      "coverage": {
        "unsupported": [],
        "filesScanned": 2
      },
      "stackDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "stackId": "stack:cccccccccccc",
      "manifestDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
    },
    "stackFacts": {
      "schemaVersion": "1",
      "kind": "DeclaredStackFacts",
      "provider": "selected-stack-v1",
      "ctRepoRevision": "1111111111111111111111111111111111111111",
      "manifestDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "sourceConfigDigest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      "inventory": [
        {
          "path": ".node-version",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "node-version"
        },
        {
          "path": ".npmrc",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "package-manager-config"
        },
        {
          "path": ".nvmrc",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "nvmrc"
        },
        {
          "path": "npm-shrinkwrap.json",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "npm-lockfile-v3"
        },
        {
          "path": "package-lock.json",
          "role": "selected",
          "present": true,
          "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "parser": "npm-lockfile-v3"
        },
        {
          "path": "package.json",
          "role": "selected",
          "present": true,
          "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "parser": "package-json"
        },
        {
          "path": "pnpm-lock.yaml",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "pnpm-lockfile-v9"
        },
        {
          "path": "pnpm-workspace.yaml",
          "role": "conflict-check",
          "present": false,
          "sha256": null,
          "parser": "package-manager-config"
        }
      ],
      "domains": {
        "packages": "complete",
        "images": "not-selected",
        "runtime": "not-selected",
        "closure": "complete"
      },
      "limitations": []
    },
    "report": {
      "schemaVersion": "2",
      "blueprintRef": "no-legacy@0.1.0",
      "ctRepoRevision": "1111111111111111111111111111111111111111",
      "repo": "example/app",
      "score": 100,
      "verdict": "pass",
      "violations": [],
      "evidenceRef": "declared-stack-facts.json@sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      "summary": "1 constraint(s) evaluated; 0 violation(s); score 100",
      "coverage": {
        "providers": [
          {
            "evidenceClass": "declaredStack",
            "filesScanned": 2,
            "unsupported": []
          }
        ]
      },
      "stack": {
        "stackDigest": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "manifestDigest": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "sourceConfigDigest": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "claim": "selected-declarations-not-installed-state"
      },
      "refusals": []
    }
  },
  "hashes": {
    "blueprint": "1111111111111111111111111111111111111111111111111111111111111111",
    "stackManifest": "2222222222222222222222222222222222222222222222222222222222222222",
    "stackFacts": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "report": "3333333333333333333333333333333333333333333333333333333333333333",
    "bundle": "4444444444444444444444444444444444444444444444444444444444444444"
  }
}
```

## Acceptance and compatibility matrix

These are required implementation vectors, not claims that this draft implements them.

| Case | Required result |
|---|---|
| New engine, legacy blueprint, same graph/invocation | Byte-identical v1 report/bundle, scoring, violation identity and evidence chain; no stack key added |
| Published old engine, new stack policy | Refusal/nonzero, never green; strict and tolerant parsing both exercised; minimum-engine check cannot be bypassed by skipped constraints |
| Stack object with no stack constraint | Reject new authored configuration as inert; never change a legacy report merely because a snapshot exists |
| Stack constraint without stack source/required evidence/floor | Authoring refusal; no schema-only acceptance before executable implementation |
| Stack-only complete evidence | V2 report and bundle, no graph or AST coverage; exact manifest and facts included |
| Mixed staticAst and declaredStack | Both providers required and evaluated once through shared dispatcher; failure/missingness in either cannot disappear through selection |
| Proven violation plus any refusal | Keep violations; verdict indeterminate, score null, exit2 even in advisory or with baseline |
| Gradeable violation with committed baseline | Existing matching/fingerprint semantics; baseline changes separately reviewed; no automatic stack exemption |
| Gradeable violation in advisory | Existing advisory exit behavior, measured fail remains visible; no claim of enforced conformance |
| Portfolio member with null score | Portfolio exit2; aggregate numeric score null, retain other member results; never average away missingness |
| Markdown/JUnit/SARIF with refusal | Explicit indeterminate/error with refusal code; no numeric fabricated score or passing test; SARIF invocation executionSuccessful false |
| Unselected image file appears | Does not expand selected image scope; report continues naming the selected files |
| Lockfile-only deletion/rename/change | Select applicable blueprint in every gate mode; deleted/old name retained; missing selected source refuses |
| Unknown/truncated changed-file list | Conservatively select blueprint |
| New exact pin or closure digest | Incomparable/unknown-potential-relaxation unless proven equivalent; never label an arbitrary replacement tightening |
| Remove constraint/source or widen Node set | Protected relaxation; no silent ratification |
| Narrow Node set with same source scope | Tightening, subject to ordinary review and satisfiability validation |
| Add known constraint with unchanged well-formed sources | Additive tightening; changes to source identity remain unknown |
| Stack bundle tamper/substitution without coherent rehash | Integrity/replay refusal; coherent unsigned replacement still does not establish origin |
| Runtime machine version differs | No effect on declaration grading; recorded execution toolchain remains honest |

Baseline violation fingerprints retain the existing SHA256 tuple of blueprintRef,
constraintId and component, separated by NUL. Observed, expected and evidenceRef
are explicitly excluded, so changed observed versions at the same component may
still match an existing baseline; this inherited behavior is not a fresh approval.
Occurrence line numbers do not create or erase baseline identity. Multiple identical identity violations are deduplicated; their truthful
source anchors remain available in the manifest/provider evidence. Exact tuple tests
must accompany implementation. Source identity changes still require policy review.

All public entry points must consume the same prepared evidence: run, gate (all
modes), MCP wrappers, teeth, portfolio, replay and renderers. No stack implementation
may hide behind a snapshot-only command while an ordinary gate skips its constraints.
Synthetic evaluator teeth and separately materialized source mutations are different
claims and must be reported separately. The packed consumer journey must start with
independent package/image/runtime violations, then fix declarations with unchanged
policy and empty baseline; refuse missing/opaque/variable/conflicting input; replay
in a separate offline consumer. Six portability legs must run the built consumer proof.

## Reconciliation vectors and limits

A genuinely possible positive case uses `allowedNodeVersions:["22.22.2","24.8.0"]`
with `.nvmrc` as the sole selected runtime declaration, no conflicting engines/node-
version declaration, unchanged modeled npm closure, no image changes and no opaque
entries. Base declares22.22.2, head23.0.0, target24.8.0. Base and target satisfy the
same allowlist; head is a complete known violation. Existing exact-runtime comparison
orders head→target forward. No image resolution, historical restoration or invented
patch is needed. The proposal asks for target24.8.0 using target source hashes; it
still does not assert those bytes exist or run an installer.

| Vector | Required result |
|---|---|
| Positive allowlist case above, fresh head, valid bundles | Deterministic forward obligation for `.nvmrc`, patchStatus not-produced |
| Same policy/head, target22.22.2 historical base | Backward refusal even though target conforms |
| Mutable image tag becomes digest with unordered identity | Respect existing unknown classification; refuse, never assume pinning is forward |
| Unsupported/nonsemver runtime or changing opaque package identity | Unknown or gradeability refusal; never synthesize ordering |
| Current `.nvmrc` hash differs from head inventory | Stale-head refusal before any output |
| Target bytes not supplied, otherwise valid commitments | Obligation may be emitted, explicitly no patch/no realizability or provenance claim |
| Ambiguous fact-to-source mapping, missing required target source, source addition/deletion | Refuse actionable proposal generation |
| Target conforms but head→target classification is added/removed/flags-changed/rewritten | Refuse in initial scope; only exactly forward or identical is eligible |
| Identical stackDigest but changed source bytes/topology | Compare complete manifests and bound sources; no claim of byte identity |
| Output aliases any input via path/symlink/hardlink | Refuse without overwriting inputs |
| Base/head/target facts lack inventory, gradeability or report binding | Refuse; manifest-only input cannot support this interface |

Freshness compares the entire current finite inventory (including absences and
conflict-check files), source bytes and revision against head. Neither a clean Git
label nor the revision alone establishes freshness. Re-extract current head with the
strict provider and compare complete manifest and facts. The proposal output is the
only write and must be outside every selected source/input; inputs remain immutable.
A target bundle is a desired-state commitment, not authority to change policy.

Existing stack-diff has an unresolved wording conflict: root-priority pairing can
classify a semver root move forward while an unchanged retained nonsemver copy exists;
general ambiguity wording suggests an unconditional refusal. This RFC preserves
current implementation and does not resolve that contradiction by implication.
Reconciliation's initial domain additionally refuses any retained nonsemver package
identity involved in a root/nonroot pairing ambiguity, even when existing diff says
forward. Owner decision is whether a later, separately reviewed clarification should
codify root priority or impose broader ambiguity refusal. Neither outcome is approved
here, and no diff behavior changes are included in this draft.

## Widen-only check

The five new rule arms and source object add expressiveness. Legacy blueprints retain
all enforcement and serialized v1 behavior. New policies require an explicit engine
floor and fail closed on older engines, including tolerant parsing. A released schema
must not accept new constraints until every ordinary gate path enforces them. The
new evidence protocol is versioned, not silently stuffed into v1. Baseline, review,
policy comparison and authority checks are preserved. Implementation and normative
specification changes must land together after acceptance, as RFC-0001 requires.

## Alternatives considered

- Snapshot digest alone: cannot express forbidden transitive packages or exact Node
  choices; digest-only evidence cannot replay rules and does not assert topology.
- Every repository image automatically: current discovery/parser coverage cannot
  support that promise; explicit reviewed selected files make the claim bounded.
- Semver ranges and registry resolution: add interpretation/network authority and
  moving inputs; exact versions and supplied targets are sufficient for this slice.
- Manifest v1 warning substring heuristics: unsafe portability seam; typed facts in a
  new bundle version permit explicit refusal without altering strict manifest v1.
- Automatic patches or restoring base: neither supplied hashes nor historic green
  evidence justify a safe edit or backward change. Obligations remain proposal-only.
- Silent report v1 extension: older consumers/verifiers could claim compatibility
  while dropping the new facts; v2 requires explicit consumer support.

## Compatibility and owner decision record

The human maintainer accepted enforcement on 2026-09-20 with the explicit instruction
quoted above. Accepted: selected-file scope; five rule types; all-occurrence package
pins; exact Node sets; source-conflict refusal; unchanged baseline/advisory treatment
with refusal precedence; v2 reports/bundles and null indeterminate scores; companion
typed facts and ordinary public entry-point integration.

Deferred: forward repair obligations, reconcile commands, importer-specific scope,
root/nonroot ambiguity changes and cross-repository orchestration. No policy/baseline
ratification, release, merge or publication is implied. The local development version
is 0.5.0, matching the accepted provisional minimum; actual release publication remains
a separate owner-governed act. Existing code-only policies retain their established
minimums and v1 output behavior.
