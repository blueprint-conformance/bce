# RFC-0003: Workspace-aware stack change review

Status: draft (proposed; pending public PR discussion)
Author(s): bce maintainers, prepared with an AI coding agent

## Summary

Add an explicit schema-2 StackManifest for pnpm v9 lockfiles, emitted by
`bce stack snapshot --workspace-aware`. Preserve importer paths and grouped direct
resolutions so the existing `stack diff` command can distinguish dependency drops,
importer disappearance, and actual downgrades. The default schema-1 path, published
schema-1 schema, selected-stack-v1 enforcement, and closure hash remain unchanged.
This is a reviewable implementation proposal, not an accepted format or release claim.

## Motivation

SPEC §16.2 and the stack-diff source defer importer identity as WO-BSTACK-09.
No separate work-order artifact exists in this checkout. Schema 1 collapses all pnpm
importer edges onto the root. If app has x@5 and lib has x@1, app dropping x and app
moving to x@1 yield the same root resolution set. Conversely, a downgrade between
versions that other importers retain can leave the entire collapsed edge set unchanged.
These are two consequences of missing information, not SemVer ordering defects.

## Design

Schema 2 extends the structural schema-1 body with required `importers`, sorted by
repository-relative POSIX `path` (`.` denotes the root). Every importer, including an
empty one, appears once. Each entry contains `dependencies`, a canonical array of
`{name, group, spec, to}` records. `group` is dependencies, devDependencies, or
optionalDependencies; `to` identifies a non-root npm node. Canonical serialization
sorts dependency records by their full stable serialization. Paths prohibit absolute
paths, backslashes, empty/dot/dot-dot segments and drive-prefix colons. Duplicate
importers or dependency name/group pairs and unresolved/ambiguous target ids refuse.
Projecting these records onto root edges must reproduce the schema-1 root edge set.
The separately published structural schema is `workspace-stack-manifest.schema.json`;
target resolution, uniqueness, canonical-path segments and edge consistency remain
engine-enforced cross-field requirements.

The extractor emits this version only when explicitly requested and the pnpm reader
and existing same-tree completeness checks pass. The opt-in additionally verifies
that every non-root importer lies within `pnpm-workspace.yaml` package boundaries.
A missing importer while its workspace package remains in the tree refuses extraction.
An importer and its package disappearing together is a legitimate removal. The
reader still treats links and npm aliases as opaque where schema 1 does; their opaque
hash changes still block. This proposal adds registry-resolution ownership, not local
package byte identity or general workspace graph enforcement.

For two schema-2 inputs, direct resolutions join by `(importer path, dependency name)`.
Groups are compared as declaration metadata, so moving production to development
cannot conceal a version downgrade. A unique before/after version orders by the
existing strict SemVer comparator; multiple distinct resolutions for one importer/name
are not guessed and a changed ambiguous pair is unknown. Direct dependency additions
and removals are explicit, even if the version remains elsewhere in the closure.
Importer membership additions/removals are separately visible. Renames are removal
plus addition: no guessed continuity across paths. Direct rows identify their owner in
`declaredBy` as `importer:` followed by the JSON tuple `[path,name]`. Membership rows
use `view: sources`, `name: importer:<path>`. Existing ranking and blocking exit codes
remain in force. Remaining closure copies use the existing classification algorithm.

The full manifest digest binds topology. **stackDigest and stackId remain closure
identities**, computed from the existing hashed view with `schemaVersion: "1"` even
for schema-2 manifests. Equal stackDigest does not imply equal importer assignments.
No topology digest is smuggled into the closure identity. Manifest digest also covers
source byte hashes, so equivalent reordered lockfile bytes can produce a different
manifest digest; canonical importer/array order and report serialization remain stable.
Digests provide internal consistency, not source authenticity. A malicious author can
rewrite and rehash a manifest; compare trusted pinned-revision extractions when
provenance matters, as with schema 1.

## Widen-only check

All existing schema-1 artifacts, conservative ambiguity refusals, normative hash
semantics, and selected-stack-v1 gate/report contracts retain their behavior. The new
path requires additional evidence and opt-in. Mixed schema-1/schema-2 diff inputs
produce an unknown blocking migration row, including when closure digests match.
Selected-stack-v1 validation explicitly refuses schema 2; no existing blueprint rule
silently gains workspace semantics or accepts a wider evidence inventory.

## Alternatives considered

Adding importer fields to strict schema 1 would silently change an existing format.
Creating importer nodes would change closure identity and classify package releases as
dependency changes. Guessing pairings, inferring continuity from names, or suppressing
ambiguous downgrades would relax enforcement without new evidence. A sidecar would
require another pairing/binding mechanism and another CLI flow. An explicit new
snapshot version keeps the complete review artifact together.

## Compatibility and migration

Re-extract **both** exact revisions with `stack snapshot --workspace-aware`, then run
ordinary `stack diff --from ... --to ...`. No in-place schema-1 upgrade is possible:
the missing identities cannot be recovered from the old artifact. Schema-1 consumers
reject the new version. npm snapshots refuse the option. The MCP stack-diff reader uses
the same version-aware parser and classifier; no new MCP mutation surface is added.
Do not use these standalone snapshots as selected-stack-v1 gate/report evidence.

The proposal contains code, generated schema and offline tests to make review concrete.
Under RFC-0001's current process, the maintainer records acceptance first; implementation
and normative SPEC updates land together in the follow-on change. This draft does not
record acceptance or amend the process. A release/version decision belongs to that review.

## Validation

`tests/stack-workspace.test.ts` exercises materialized pnpm trees and a committed real
pnpm 10.11.1 lockfile: retained-root downgrades, crossing moves, legitimate removal/drop,
closure-copy removal, dependency-group moves, canonical ordering, mixed-version refusal,
invalid topology and workspace boundaries. Built CLI snapshot/diff has opposing 0/2
controls. Existing schema-1 diff, pnpm extraction, schema parity and golden suites remain
the compatibility controls. No test invokes a registry.

## Proposal and technical review record

This RFC-only change proposes the design for public discussion. It copies the
reviewed draft from implementation candidate `2a7ad38d4d74ba929db46a69b2767397e15279f8`.
References above to code, generated schemas, and tests describe that unmerged
candidate; this RFC-only change does not ship those capabilities or change the
normative specification.

AI technical review (2026-11-01): **ACCEPT** for technical design review. The explicit schema-2 opt-in preserves schema-1 behavior, separates closure identity from importer topology, and blocks mixed-version or ambiguous comparisons. This is an AI technical recommendation, not the RFC acceptance decision.

The review was performed by an AI agent separate from the implementation task.
It does not constitute independent human review, public discussion, maintainer
acceptance, or release authorization. Under RFC-0001, the public RFC pull request
must record discussion and a maintainer decision with its rationale before a
follow-on implementation/specification change lands. The draft status remains
unaccepted until that decision is recorded.
