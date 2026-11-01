# RFC-0004: Explicit bounded dependency paths

Status: draft (proposed; pending public PR discussion)
Author(s): bce maintainers, prepared with an AI coding agent

## Summary

Add `forbiddenDependencyPath`, an explicit TypeScript module boundary over one or two
observed import edges. Require `maxHops: 2`, a nonempty source scope, and a resolved
module/package/builtin target selector. Keep `forbiddenDependency` direct. Reuse the
existing graph and compliance-report shapes; this is a reviewable candidate implementation,
not an accepted specification or a released capability.

## Motivation

A domain module can reach a forbidden application module through one adapter without
carrying the forbidden direct edge itself. A direct-edge rule correctly sees no violation
in that source module; silently redefining it as transitive would change existing policy.
An explicit bounded rule can express the stronger intent while retaining the actual
provider's evidence limits and predictable traversal depth.

## Design

The new arm accepts only `id`, `type`, `severity`, `to`, `scopePaths`, and `maxHops`:

```json
{
  "id": "domain-cannot-reach-app",
  "type": "forbiddenDependencyPath",
  "severity": "critical",
  "scopePaths": ["src/domain/**"],
  "to": "module:src/app/**",
  "maxHops": 2
}
```

It requires `extraction.profile: typescript-module-graph`, AST extraction, and the
existing explicit extraction paths/minFiles floor. `scopePaths` selects real scanned
source modules. Extraction paths must also include reachable local intermediates;
source scope and extraction inventory serve different purposes. Targets use the existing
`module:<path-or-glob>`, `package:<npm-root>`, or `builtin:<node-name>` vocabulary.
Relative POSIX scopes must be nonempty and traversal-free. `maxHops` has no default;
values other than 2 refuse. Other constraint arms cannot carry this field.

For each matching root, examine its `imports` edges and the outgoing `imports` edges of
each reachable local first-hop module. A matching endpoint at either depth is a
violation. Package and builtin targets terminate traversal; their internals are not
in the local graph. Third-hop-only paths are outside this explicit contract, not a
claim that arbitrary transitive reachability is safe. All statically named import
forms, including type-only imports and re-exports, follow the existing provider's edges.
No resolver, alias logic, runtime semantics, cycle analysis, or package ownership is
reimplemented in the evaluator.

Refuse with exit 2 when no source module matches, scan coverage is absent, a root or
local intermediate is not a scanned TypeScript component, a relevant root/intermediate
has unresolved imports, or an examined edge has an unclassified target. A removed
intermediate therefore cannot silently erase a path: its remaining source import is
unresolved. A real-source deletion of both the edge and the module can be a valid fix.
Unrelated uncertainty and uncertainty strictly beyond the two-edge boundary do not
prevent grading this bounded rule. A known violation beside relevant uncertainty does
not turn a refusal into a gradeable report.

The public API raises `DependencyPathRefusal`. The gate translates it into its existing
structural refusal envelope, which bypasses advisory/baseline pass logic and exits 2.
The read-only MCP gate uses the same gate implementation. The existing compiler keeps
its direct-edge semantic owner; its existing deferred-family seam leaves this new arm
with the evaluator.

A violation keeps compliance-report schema 1: `component` is the root module id,
`evidenceRef` anchors the final edge, and `observed` includes the complete ordered path
with every edge's evidence anchor. Thus a second-hop source mutation points to the
actual intermediate source, while the whole route remains reviewable. Canonical edge
ordering and witness deduplication make violations deterministic. Baseline identity
continues to use blueprint/constraint/component, so line churn updates evidence without
inventing a new violation identity. This proposal does not redefine baseline granularity.

Graph-only teeth inject a two-edge path between existing scanned modules and report
only evaluator refutability. Positive source proof still requires the existing isolated,
digest-preconditioned real-source mutation path. Unknown evidence is indeterminate.
Policy review recognizes this as an enforcing arm; removal or scope narrowing is a
relaxation, and endpoint changes remain directionally unknown.

## Widen-only check

Existing `forbiddenDependency` semantics, graph format, report schema, and compiler
predicate remain unchanged. The new name cannot be mistaken for a new default on an old
rule. No skip flag or partial-evidence success is introduced. Existing report bytes stay
unchanged unless the new constraint is present.

The candidate requires `minEngineVersion >=0.6.1`, and portfolio members require that
engine pin. CLI authoring and portfolio compilation emit the same floor. This is
necessary because older gates may tolerate unknown constraint names: the released
0.6.0 engine must fail its version preflight before skipping the new arm. **0.6.1 is the
current unreleased candidate in release-state.json; re-check this floor before landing
or release if ordering changes.** This RFC does not authorize or announce a release.

## Alternatives considered

Changing C3 to transitive would silently broaden existing policy. Unlimited reachability
would add a different complexity and evidence contract. A second graph or resolver would
duplicate provider logic. New graph/report fields are unnecessary for complete two-edge
witnesses, which fit the existing anchored text fields. Compiler-IR expansion is deferred
because its current direct-only predicate explicitly leaves other families to the evaluator.

## Compatibility and rollout

Existing blueprints remain direct. Authors must choose the new type, write `maxHops: 2`,
set the candidate engine floor, and scan both roots and intermediates. The generated
JSON Schemas add the enum member and optional structural `maxHops` property; required
arm fields, legal-arm restrictions, profile, path, and engine-floor conditions remain
engine-enforced cross-field checks, as with existing module-profile refinements.

RFC-0001 currently requires maintainer acceptance followed by an implementation/spec
change. This draft and implementation make that review concrete; neither records
acceptance. The normative specification must be updated with the accepted contract in
that follow-on landing. Release ordering must retain the unknown-constraint version guard.

## Validation

`tests/dependency-path.test.ts` exercises real TypeScript extraction, one/two/three-edge
controls, unchanged direct semantics, type-only/re-export edges, unresolved/deleted/
unscanned intermediates, zero roots, missing coverage, package/builtin endpoints, line
churn, deterministic witnesses, portfolio floors, policy review, and real-source mutation
proof. Built CLI author/gate controls demonstrate 0 (pass), 1 (violation), and 2 (refusal).
Existing TypeScript module, compiler, schema parity and full-suite tests are compatibility
controls. No network or installed-package internals participate in the path analysis.

## Proposal and technical review record

This RFC-only change proposes the design for public discussion. It copies the
reviewed draft from implementation candidate `2a7ad38d4d74ba929db46a69b2767397e15279f8`.
References above to code, generated schemas, and tests describe that unmerged
candidate; this RFC-only change does not ship those capabilities or change the
normative specification.

AI technical review (2026-11-01): **CHANGES REQUIRED** for the implementation candidate; the proposed bounded semantics are suitable for public design review. The mixed declared-stack/path dispatcher must translate DependencyPathRefusal into structured indeterminate evidence instead of letting it escape the gate report path. The follow-on implementation must include a regression for that combination. Existing direct-edge semantics, explicit hop bound, and candidate engine floor are otherwise preserved.

The review was performed by an AI agent separate from the implementation task.
It does not constitute independent human review, public discussion, maintainer
acceptance, or release authorization. Under RFC-0001, the public RFC pull request
must record discussion and a maintainer decision with its rationale before a
follow-on implementation/specification change lands. The draft status remains
unaccepted until that decision is recorded.

### Implementation finding resolution (2026-11-01)

The mixed-dispatcher finding above was corrected in candidate commit
`62da51b855168b73f28ba7433b0c294a99e09a10`: the shared live/replay evaluator
translates the typed refusal into structured indeterminate evidence. Added
controls cover enforced/advisory policy, API, offline replay, and CLI report output.
Separate review confirmed the correction. A second integration finding, distinct
path witnesses producing one work-order ID, was corrected in
`ab0cb09542aedb03b77c116216e7e19f1172304a`; complete witnesses disambiguate
collisions while existing unambiguous IDs remain unchanged. Separate AI review
accepted that correction.

The combined source candidate `90c3e54323091515420e225d3cfa5dc5686ae413`
passed build/typecheck, 1,493 tests with four skips, self-gates, and 50 real-source
mutation checks. These are local implementation results, not public adoption,
a released package, or this RFC's acceptance decision. The proposal remains draft
for public discussion.
