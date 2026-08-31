/**
 * materializer.ts — the intended-graph materializer (Half A, the AI-drivable pure module).
 *
 * Projects a validated EngineeringBlueprint into an INTENDED architecture graph — reusing the
 * graph-builder's OWN `ObservedComponent`/`ObservedEdge`/`ArchitectureGraph` interfaces (the
 * "GraphNode shape") so the intended projection is byte-comparable to the observed graph — then
 * diffs INTENDED-vs-OBSERVED into violations in EXACTLY THREE classes:
 *
 *   1. `declared-but-absent`        — an intended component/edge with no matching observed node/edge.
 *   2. `present-but-forbidden`      — an OBSERVED edge that matches an intended forbidden relationship.
 *   3. `missing-required-evidence`  — an intended requiredEvidence marker whose governing component
 *                                      exists in observed but lacks a satisfying edge of that type.
 *
 * SOLID boundary: this is a DISTINCT LENS from `report.ts`'s `evaluate()`. `report.ts`
 * owns constraint-EVALUATION (walks `blueprint.constraints[]`); `materializer.ts` owns
 * graph-PROJECTION + graph-DIFF (walks `blueprint.architecture` + `evidenceRequirements`). The two
 * share ONLY `SEVERITY_WEIGHT` + `Violation` + `stableStringify` (consumed, never re-implemented —
 * consume-don't-duplicate). This module NEVER imports or calls `evaluate()`.
 *
 * Purity (conformance-engine-not-compiler): consumes the observed graph READ-ONLY,
 * performs NO store write, NO network, NO wall-clock, NO Math.random. Deterministic: same
 * (blueprint, observed) in → byte-identical `MaterializationResult` out (all arrays sorted via the
 * graph.ts comparators; `evidenceRef` is a content SHA of the projection + observed).
 *
 * Attended boundary: the result carries an explicit `APPLY_IS_ATTENDED` marker
 * and a set of PROPOSED-shaped `UpsertDescriptor`s (externalId `blueprint:<id>:<component>`). The
 * ACTUAL CT-ontology upsert of those descriptors is a SEPARATE, operator-gated surface
 * (Half B) — an attended operator ceremony. This module exports NO apply/upsert/write/commit/persist
 * function, so advancing past PROPOSED (and any mutation) is not even EXPRESSIBLE here. Self-
 * contained: no CT/Prisma/fs/a-private-contracts-package import (mirrors emit.ts discipline).
 */
import { createHash } from 'node:crypto';
import type { ArchitectureGraph, ObservedComponent, ObservedEdge } from './graph.js';
import { compareComponents, compareEdges } from './graph.js';
import type { EngineeringBlueprint, Severity } from './schema.js';
import type { Violation } from './report.js';
import { SEVERITY_WEIGHT, stableStringify } from './report.js';

/* -------------------------------------------------------------------------- */
/* Attended-boundary marker (attended-apply policy)                           */
/* -------------------------------------------------------------------------- */

/**
 * The immutable marker asserting that applying this module's `upsertPlan` is an ATTENDED operation.
 * Present on the top-level result AND on every emitted `UpsertDescriptor`. This module never honors
 * it (it never applies anything); the operator-gated CT surface (Half B) is where the marker gates a
 * attended operator ceremony. Its literal-`true` type makes "apply-without-a-human" un-expressible.
 */
export const APPLY_IS_ATTENDED: true = true;

/* -------------------------------------------------------------------------- */
/* The three diff classes + the diff violation                                */
/* -------------------------------------------------------------------------- */

/** The EXACTLY-THREE violation classes the intended-vs-observed diff can emit. */
export type ViolationClass = 'declared-but-absent' | 'present-but-forbidden' | 'missing-required-evidence';

/**
 * A diff violation. Reuses `Violation` VERBATIM from report.ts (constraintId/severity/component/
 * evidenceType/evidenceRef/observed/expected) + the diff-class tag. NO new severity ladder — the
 * severity is a `Severity` scored with report.ts's `SEVERITY_WEIGHT`.
 */
export interface DiffViolation extends Violation {
  class: ViolationClass;
}

/* -------------------------------------------------------------------------- */
/* The intended graph (a real GraphNode projection)                           */
/* -------------------------------------------------------------------------- */

/**
 * The intended node type IS the graph-builder's `ObservedComponent` (structural alias — byte-
 * comparable to an observed node). For a declared-only node with no observed source yet, `line=0`
 * and `path=blueprint:<id>`.
 */
export type IntendedComponent = ObservedComponent;

/** A required-evidence marker projected from a blueprint `evidenceRequirement`, keyed to its governing component. */
export interface RequiredEvidenceMarker {
  /** the observed-component id this evidence requirement governs. */
  component: string;
  /** the evidence edge-type that satisfies it (e.g. `tenantGuard`, `guards`). */
  evidenceType: string;
  /** the severity a missing marker is scored at. */
  severity: Severity;
  /** the requirement's disposition when the evidence is absent. */
  onMissing: 'unknown' | 'block' | 'warn';
}

/**
 * The projected INTENDED architecture graph. `components` + `edges` are `ObservedComponent`/
 * `ObservedEdge` (byte-comparable to observed). Arrays are pre-sorted via the graph.ts comparators.
 */
export interface IntendedGraph {
  schemaVersion: '1';
  /** `<metadata.id>@<metadata.version>` — the blueprint this projection came from. */
  blueprintRef: string;
  /** intended nodes (allowed component declarations), sorted by compareComponents. */
  components: ObservedComponent[];
  /** intended edges (allowed relationships), sorted by compareEdges. */
  edges: ObservedEdge[];
  /** forbidden relationships (allowed:false) — captured for the present-but-forbidden diff, sorted. */
  forbiddenEdges: ObservedEdge[];
  /** required-evidence markers (required:true) keyed to a governing component, sorted. */
  requiredEvidence: RequiredEvidenceMarker[];
}

/* -------------------------------------------------------------------------- */
/* The PROPOSED upsert descriptor (the plan a CT surface would apply)         */
/* -------------------------------------------------------------------------- */

/**
 * The idempotent-upsert PLAN a (deferred, operator-gated) CT surface would apply. `externalId` is
 * `blueprint:<id>:<component>` — the upsert KEY. `approvalState` is PROPOSED (mirrors emit.ts's
 * APPROVAL_FLOOR floor); `applyIsAttended` is `true`. NEVER executed here.
 */
export interface UpsertDescriptor {
  externalId: string;
  kind: 'node' | 'edge';
  type: string;
  from?: string;
  to?: string;
  approvalState: 'PROPOSED';
  applyIsAttended: true;
}

/* -------------------------------------------------------------------------- */
/* The top-level result                                                       */
/* -------------------------------------------------------------------------- */

export interface MaterializationResult {
  schemaVersion: '1';
  blueprintRef: string;
  /** the observed graph's revision anchor — carried through so a consumer sees WHAT it diffed against. */
  ctRepoRevision: string;
  intended: IntendedGraph;
  violations: DiffViolation[];
  /** per-class violation counts (all three keys always present, zero when clean). */
  byClass: Record<ViolationClass, number>;
  /** report.ts scoring formula: max(0, 100 - Σ SEVERITY_WEIGHT[v.severity]). */
  score: number;
  /** fail whenever violations.length > 0 (even an all-info set that leaves score 100). */
  verdict: 'pass' | 'fail';
  /** per-severity violation counts (all five keys always present). */
  bySeverity: Record<Severity, number>;
  /** content-addressed anchor: `intended-vs-observed@sha256:` + sha256(stableStringify({intended,observed})). */
  evidenceRef: string;
  summary: string;
  /** the PROPOSED upsert plan a CT surface would apply — pure DATA, never executed here. */
  upsertPlan: UpsertDescriptor[];
  applyIsAttended: true;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                  */
/* -------------------------------------------------------------------------- */

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Total-order comparator for required-evidence markers (by component, then evidenceType). */
function compareEvidence(a: RequiredEvidenceMarker, b: RequiredEvidenceMarker): number {
  const ka = `${a.component} ${a.evidenceType}`;
  const kb = `${b.component} ${b.evidenceType}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Total-order comparator for diff violations. Mirrors report.ts's `compareViolations` shape (by
 * constraintId, then component) but ALSO folds in `class` + `evidenceRef` so per-edge violations of
 * the same class/component (two forbidden edges) sort stably and deterministically.
 */
function compareDiffViolations(a: DiffViolation, b: DiffViolation): number {
  const ka = `${a.class} ${a.constraintId} ${a.component} ${a.evidenceRef}`;
  const kb = `${b.class} ${b.constraintId} ${b.component} ${b.evidenceRef}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Total-order comparator for upsert descriptors (by externalId, then kind, then from/to). */
function compareUpserts(a: UpsertDescriptor, b: UpsertDescriptor): number {
  const ka = `${a.externalId} ${a.kind} ${a.from ?? ''} ${a.to ?? ''} ${a.type}`;
  const kb = `${b.externalId} ${b.kind} ${b.from ?? ''} ${b.to ?? ''} ${b.type}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** The synthetic constraint-id a diff violation carries (the diff derives from graph, not a constraint[]). */
function diffConstraintId(cls: ViolationClass, detail: string): string {
  return `diff:${cls}:${detail}`;
}

/**
 * Resolve the governing component + edge-type for each `required:true` evidence requirement.
 *
 * The observed graph has NO node-attached evidence marker (risk note): evidence is modeled as a
 * satisfying `guardEdge` of the required type. `EvidenceRequirement` itself carries no component,
 * so we resolve the governing component from the blueprint's `constraints[]` where
 * `type==='requiredEvidence'` and `evidenceType` matches — the constraint's `component` names the
 * governed node. A requirement with no matching requiredEvidence constraint governs EVERY declared
 * architecture component (a subsystem-wide evidence floor). `required:false` or `onMissing:'unknown'`
 * NEVER produces a marker (honest — a soft requirement is not a block).
 */
function resolveRequiredEvidence(blueprint: EngineeringBlueprint): RequiredEvidenceMarker[] {
  const evidenceConstraints = blueprint.constraints.filter((c) => c.type === 'requiredEvidence');
  const declaredComponentIds = blueprint.architecture.components.map((c) => c.id);
  const markers: RequiredEvidenceMarker[] = [];

  for (const req of blueprint.evidenceRequirements) {
    if (!req.required) continue; // soft requirement — never a class-3 block
    const onMissing: 'unknown' | 'block' | 'warn' = req.onMissing ?? 'unknown';
    if (onMissing === 'unknown') continue; // honest: an unknown-disposition requirement is not a block

    // constraints that govern this evidence type name the concrete component(s).
    const governing = evidenceConstraints.filter((c) => c.evidenceType === req.type && c.component);
    if (governing.length > 0) {
      for (const c of governing) {
        markers.push({
          component: c.component as string,
          evidenceType: req.type,
          severity: c.severity,
          onMissing,
        });
      }
    } else {
      // no explicit governing constraint → a subsystem-wide floor over every declared component.
      // severity defaults to the lowest non-info rung when the requirement declares none via a
      // constraint — `low` (a warn/block requirement is at least `low`, never silently `info`).
      const sev: Severity = onMissing === 'block' ? 'high' : 'medium';
      for (const cid of declaredComponentIds) {
        markers.push({ component: cid, evidenceType: req.type, severity: sev, onMissing });
      }
    }
  }

  // de-dup (component, evidenceType) — keep the highest-severity marker for a duplicate key.
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  const byKey = new Map<string, RequiredEvidenceMarker>();
  for (const m of markers) {
    const key = `${m.component} ${m.evidenceType}`;
    const prior = byKey.get(key);
    if (!prior || rank[m.severity] > rank[prior.severity]) byKey.set(key, m);
  }
  return [...byKey.values()].sort(compareEvidence);
}

/**
 * The severity a `declared-but-absent` violation is scored at. The blueprint's `architecture` block
 * carries no per-component severity, so we resolve it from a governing constraint:
 *   - a `requiredComponent` constraint naming this component's TYPE, or a `requiredDependency`
 *     constraint naming it, contributes its severity;
 *   - absent any, a declared-but-absent component defaults to `high` (a declared node that never
 *     materialized is a real drift signal, not `info`).
 */
function severityForAbsentComponent(blueprint: EngineeringBlueprint, componentType: string): Severity {
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  let best: Severity | undefined;
  for (const c of blueprint.constraints) {
    const governsType =
      (c.type === 'requiredComponent' && c.component === componentType) ||
      (c.type === 'requiredDependency' && c.component === componentType);
    if (governsType && (!best || rank[c.severity] > rank[best])) best = c.severity;
  }
  return best ?? 'high';
}

/** The severity a `declared-but-absent` edge (missing allowed relationship) is scored at. */
function severityForAbsentEdge(blueprint: EngineeringBlueprint): Severity {
  // a missing required-dependency-shaped edge inherits the highest requiredDependency severity, else `medium`.
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  let best: Severity | undefined;
  for (const c of blueprint.constraints) {
    if (c.type === 'requiredDependency' && (!best || rank[c.severity] > rank[best])) best = c.severity;
  }
  return best ?? 'medium';
}

/** The severity a `present-but-forbidden` edge is scored at (highest forbiddenDependency severity, else `high`). */
function severityForForbiddenEdge(blueprint: EngineeringBlueprint): Severity {
  const rank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
  let best: Severity | undefined;
  for (const c of blueprint.constraints) {
    if (c.type === 'forbiddenDependency' && (!best || rank[c.severity] > rank[best])) best = c.severity;
  }
  return best ?? 'high';
}

/**
 * Assert component-id uniqueness + a clean externalId key within a blueprint (risk note: idempotency
 * of `blueprint:<id>:<component>`). A duplicate component id, or an id bearing the `:` delimiter,
 * would make Half-B's upsert-by-externalId collide/parse ambiguously — reject at projection time.
 */
function assertProjectableComponentIds(blueprint: EngineeringBlueprint): void {
  const seen = new Set<string>();
  for (const comp of blueprint.architecture.components) {
    if (comp.id.includes(':')) {
      throw new Error(
        `materializer: architecture.component id '${comp.id}' contains a ':' delimiter, which would make the ` +
          `externalId key 'blueprint:<id>:<component>' parse ambiguously. Component ids MUST be ':'-free.`,
      );
    }
    if (seen.has(comp.id)) {
      throw new Error(
        `materializer: duplicate architecture.component id '${comp.id}' — component ids MUST be unique within ` +
          `a blueprint (the externalId 'blueprint:<id>:${comp.id}' is the idempotent upsert key).`,
      );
    }
    seen.add(comp.id);
  }
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Project a validated blueprint into an INTENDED architecture graph — a pure DATA transform.
 *
 *   - `architecture.components`         → intended nodes (`ObservedComponent`, path=`blueprint:<id>`, line=0).
 *   - `architecture.relationships`(allowed:true)  → intended `edges`.
 *   - `architecture.relationships`(allowed:false) → `forbiddenEdges` (captured for the diff).
 *   - `evidenceRequirements`(required:true) → `requiredEvidence` markers keyed to a governing component.
 *
 * Assumes a validated blueprint (the caller runs `parseBlueprint`); additionally asserts component-id
 * projectability (uniqueness + no ':' — the upsert-key discipline the schema does not enforce).
 */
export function materializeIntendedGraph(blueprint: EngineeringBlueprint): IntendedGraph {
  assertProjectableComponentIds(blueprint);
  const blueprintRef = `${blueprint.metadata.id}@${blueprint.metadata.version}`;
  const nodePath = `blueprint:${blueprint.metadata.id}`;

  const components: ObservedComponent[] = blueprint.architecture.components
    .map((c) => ({ id: c.id, type: c.type, path: nodePath, line: 0 }))
    .sort(compareComponents);

  const edges: ObservedEdge[] = [];
  const forbiddenEdges: ObservedEdge[] = [];
  for (const rel of blueprint.architecture.relationships) {
    const edge: ObservedEdge = {
      from: rel.from,
      to: rel.to,
      type: rel.type,
      evidenceRef: `${nodePath}#${rel.from}->${rel.to}:${rel.type}`,
    };
    if (rel.allowed) edges.push(edge);
    else forbiddenEdges.push(edge);
  }
  edges.sort(compareEdges);
  forbiddenEdges.sort(compareEdges);

  const requiredEvidence = resolveRequiredEvidence(blueprint);

  return { schemaVersion: '1', blueprintRef, components, edges, forbiddenEdges, requiredEvidence };
}

/* -------------------------------------------------------------------------- */
/* The 3-class diff                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Diff the intended graph against an observed `ArchitectureGraph`, READ-ONLY, into the exactly-three
 * violation classes. Deterministic + sorted. Never mutates `observed`.
 *
 *   1. `declared-but-absent`  — an intended component with no observed component of the same id, OR
 *      an intended edge with no observed guardEdge matching (from, to, type).
 *   2. `present-but-forbidden`— an OBSERVED guardEdge matching an intended forbiddenEdge (allowed:false
 *      relationship) by (from, to, type). One violation PER matching observed edge; `evidenceRef` is
 *      the REAL observed edge's anchor (read-only from observed).
 *   3. `missing-required-evidence` — an intended requiredEvidence marker whose governing component
 *      EXISTS in observed but has no satisfying observed edge of that evidenceType.
 */
export function diffIntendedVsObserved(intended: IntendedGraph, observed: ArchitectureGraph): DiffViolation[] {
  const violations: DiffViolation[] = [];

  const observedComponentIds = new Set(observed.components.map((c) => c.id));
  const observedEdgeKey = (e: ObservedEdge): string => `${e.from} ${e.to} ${e.type}`;
  const observedEdgeKeys = new Set(observed.guardEdges.map(observedEdgeKey));

  // Class-1/class-2 severities are baked to a class-appropriate default here so this stays a
  // standalone, honest function; `materialize` re-grades them to the blueprint's declared risk
  // posture. Class-3 already carries the resolved marker severity from the projection.

  // --- class 1: declared-but-absent (components) ---
  for (const comp of intended.components) {
    if (!observedComponentIds.has(comp.id)) {
      violations.push({
        class: 'declared-but-absent',
        constraintId: diffConstraintId('declared-but-absent', `component:${comp.id}`),
        severity: 'high',
        component: comp.id,
        evidenceType: 'graphDiff',
        evidenceRef: comp.path,
        observed: `intended component '${comp.id}' is absent from the observed graph`,
        expected: `an observed component with id '${comp.id}' (type '${comp.type}')`,
      });
    }
  }

  // --- class 1: declared-but-absent (edges) ---
  for (const edge of intended.edges) {
    if (!observedEdgeKeys.has(observedEdgeKey(edge))) {
      violations.push({
        class: 'declared-but-absent',
        constraintId: diffConstraintId('declared-but-absent', `edge:${edge.from}->${edge.to}:${edge.type}`),
        severity: 'medium',
        component: edge.from,
        evidenceType: 'graphDiff',
        evidenceRef: edge.evidenceRef,
        observed: `intended edge ${edge.from} -> ${edge.to} (${edge.type}) is absent from the observed graph`,
        expected: `an observed ${edge.type} edge ${edge.from} -> ${edge.to}`,
      });
    }
  }

  // --- class 2: present-but-forbidden (one per matching OBSERVED edge) ---
  const forbiddenKeys = new Set(intended.forbiddenEdges.map(observedEdgeKey));
  for (const oe of observed.guardEdges) {
    if (forbiddenKeys.has(observedEdgeKey(oe))) {
      violations.push({
        class: 'present-but-forbidden',
        constraintId: diffConstraintId('present-but-forbidden', `edge:${oe.from}->${oe.to}:${oe.type}`),
        severity: 'high',
        component: oe.from,
        evidenceType: 'graphDiff',
        evidenceRef: oe.evidenceRef, // the REAL observed anchor
        observed: `observed edge ${oe.from} -> ${oe.to} (${oe.type}) is present but forbidden by the blueprint`,
        expected: `no ${oe.type} edge ${oe.from} -> ${oe.to}`,
      });
    }
  }

  // --- class 3: missing-required-evidence ---
  for (const marker of intended.requiredEvidence) {
    // only governs a component that ACTUALLY EXISTS in observed (a component that is itself absent is
    // a class-1 signal, not a class-3 one — never double-count the same absence into two classes).
    if (!observedComponentIds.has(marker.component)) continue;
    const satisfied = observed.guardEdges.some(
      (e) => e.from === marker.component && e.type === marker.evidenceType,
    );
    if (!satisfied) {
      violations.push({
        class: 'missing-required-evidence',
        constraintId: diffConstraintId('missing-required-evidence', `${marker.component}:${marker.evidenceType}`),
        severity: marker.severity,
        component: marker.component,
        evidenceType: marker.evidenceType,
        evidenceRef: `${marker.component}#required-evidence:${marker.evidenceType}`,
        observed: `component '${marker.component}' exists but has no satisfying '${marker.evidenceType}' evidence edge`,
        expected: `a '${marker.evidenceType}' evidence edge from '${marker.component}' (onMissing: ${marker.onMissing})`,
      });
    }
  }

  return violations.sort(compareDiffViolations);
}

/* -------------------------------------------------------------------------- */
/* The composed entrypoint                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Top-level: project → diff → score (report.ts SEVERITY_WEIGHT) → build the PROPOSED upsertPlan.
 * Pure; performs NO write; returns DATA with `applyIsAttended:true`. This is the module's single
 * composed entrypoint the CLI / a read-only CT board consumes.
 *
 * The diff's class-1/class-2 severities are re-graded here from the blueprint's governing constraints
 * (the standalone `diffIntendedVsObserved` bakes class-appropriate defaults; `materialize` upgrades
 * them to the blueprint's declared risk posture — class-3 already carries the marker severity).
 */
export function materialize(blueprint: EngineeringBlueprint, observed: ArchitectureGraph): MaterializationResult {
  const intended = materializeIntendedGraph(blueprint);
  const rawViolations = diffIntendedVsObserved(intended, observed);

  // re-grade class-1/class-2 severities from the blueprint's declared constraints (class-3 already
  // carries the resolved marker severity from the projection).
  const componentTypeById = new Map(intended.components.map((c) => [c.id, c.type]));
  const absentEdgeSeverity = severityForAbsentEdge(blueprint);
  const forbiddenSeverity = severityForForbiddenEdge(blueprint);
  const violations: DiffViolation[] = rawViolations
    .map((v) => {
      if (v.class === 'declared-but-absent') {
        // component-absent (component id is a known intended node) vs edge-absent.
        if (componentTypeById.has(v.component) && v.constraintId.startsWith('diff:declared-but-absent:component:')) {
          return { ...v, severity: severityForAbsentComponent(blueprint, componentTypeById.get(v.component) as string) };
        }
        return { ...v, severity: absentEdgeSeverity };
      }
      if (v.class === 'present-but-forbidden') {
        return { ...v, severity: forbiddenSeverity };
      }
      return v; // missing-required-evidence keeps its marker severity
    })
    .sort(compareDiffViolations);

  // FAIL-CLOSED empty-projection floor (mirrors report.ts §"__no-enforcing-constraints__"): a
  // blueprint that projects NOTHING to enforce — zero intended components, zero intended edges,
  // zero required-evidence markers — must NOT diff-clean to score 100/pass. An empty intended
  // architecture conforms to any observed graph vacuously; a green diff must mean "an intended
  // architecture was checked", never "there was nothing to check" (honest-coverage + widen-only:
  // ratchet). Emit a hard violation so the verdict is fail and a gate over it exits non-zero.
  if (
    intended.components.length === 0 &&
    intended.edges.length === 0 &&
    intended.requiredEvidence.length === 0
  ) {
    violations.push({
      class: 'declared-but-absent',
      constraintId: '__no-intended-architecture__',
      severity: 'critical',
      component: blueprint.metadata.id,
      evidenceType: 'staticAst',
      evidenceRef: `blueprint:${blueprint.metadata.id}`,
      observed: 'blueprint projects nothing — 0 intended components, 0 edges, 0 required-evidence markers',
      expected: 'at least one intended component, edge, or required-evidence marker to diff against',
    });
    violations.sort(compareDiffViolations);
  }

  // scoring — report.ts formula, SAME constant, floored at 0.
  const score = Math.max(
    0,
    violations.reduce((acc, v) => acc - SEVERITY_WEIGHT[v.severity], 100),
  );
  const verdict: 'pass' | 'fail' = violations.length === 0 ? 'pass' : 'fail';

  const byClass: Record<ViolationClass, number> = {
    'declared-but-absent': 0,
    'present-but-forbidden': 0,
    'missing-required-evidence': 0,
  };
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const v of violations) {
    byClass[v.class] += 1;
    bySeverity[v.severity] += 1;
  }

  // PROPOSED upsert plan — one node descriptor per intended component + one edge descriptor per
  // intended (allowed) edge. externalId `blueprint:<id>:<component>`. NEVER executed here.
  const upsertPlan: UpsertDescriptor[] = [
    ...intended.components.map<UpsertDescriptor>((c) => ({
      externalId: `blueprint:${blueprint.metadata.id}:${c.id}`,
      kind: 'node',
      type: c.type,
      approvalState: 'PROPOSED',
      applyIsAttended: true,
    })),
    ...intended.edges.map<UpsertDescriptor>((e) => ({
      externalId: `blueprint:${blueprint.metadata.id}:${e.from}->${e.to}:${e.type}`,
      kind: 'edge',
      type: e.type,
      from: e.from,
      to: e.to,
      approvalState: 'PROPOSED',
      applyIsAttended: true,
    })),
  ].sort(compareUpserts);

  // Canonicalize the observed graph for the content hash WITHOUT mutating the caller's input
  // (read-only invariant): sort copies of its arrays via the graph.ts comparators so the evidenceRef
  // is content-derived and input-array-ORDER-independent (the byte-identical determinism contract).
  const observedCanonical: ArchitectureGraph = {
    ...observed,
    components: [...observed.components].sort(compareComponents),
    guardEdges: [...observed.guardEdges].sort(compareEdges),
  };
  const evidenceRef = `intended-vs-observed@sha256:${sha256(stableStringify({ intended, observed: observedCanonical }))}`;

  const summaryParts = [
    `${intended.components.length} intended component(s), ${intended.edges.length} intended edge(s)`,
    `${violations.length} violation(s)`,
    `declared-but-absent ${byClass['declared-but-absent']}, present-but-forbidden ${byClass['present-but-forbidden']}, missing-required-evidence ${byClass['missing-required-evidence']}`,
    `score ${score}`,
    `${upsertPlan.length} PROPOSED upsert(s) — apply is ATTENDED, not performed here`,
  ];
  // legibility (mirrors report.ts): an all-info violation set yields score 100 but verdict fail.
  if (score === 100 && verdict === 'fail') summaryParts.push('FAIL despite score 100 (info-only violations)');

  return {
    schemaVersion: '1',
    blueprintRef: intended.blueprintRef,
    ctRepoRevision: observed.ctRepoRevision,
    intended,
    violations,
    byClass,
    score,
    verdict,
    bySeverity,
    evidenceRef,
    summary: summaryParts.join('; '),
    upsertPlan,
    applyIsAttended: true,
  };
}
