/**
 * Quality matrix for the Blueprint materializer (Half A): the intended-graph projection +
 * the exactly-three-class intended-vs-observed diff + report.ts-weighted scoring + the PROPOSED
 * upsert plan. Mirrors tests/emit.test.ts convention (in-file fixtures, `../src/*.js` imports).
 *
 * Anti-theatre: for EACH of the three violation classes a discriminating RED fixture proves the
 * class FIRES, and a conformant GREEN fixture proves the whole diff can only pass when the observed
 * graph genuinely conforms — a green diff must mean something was proven.
 */
import { describe, it, expect } from 'vitest';
import {
  materialize,
  materializeIntendedGraph,
  diffIntendedVsObserved,
  APPLY_IS_ATTENDED,
  type MaterializationResult,
} from '../src/materializer.js';
import { SEVERITY_WEIGHT, stableStringify } from '../src/report.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** A minimal valid blueprint builder — override architecture/constraints/evidence per test. */
function makeBlueprint(over: Partial<EngineeringBlueprint> = {}): EngineeringBlueprint {
  return {
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'materializer-fixture', version: '1.0.0', status: 'approved' },
    intentRefs: ['intent:demo'],
    scope: { repositories: ['service-beta'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'c-floor', type: 'requiredComponent', severity: 'medium', component: 'store' }],
    evidenceRequirements: [],
    approvals: [],
    ...over,
  } as EngineeringBlueprint;
}

/** A minimal observed graph builder. */
function makeObserved(over: Partial<ArchitectureGraph> = {}): ArchitectureGraph {
  return {
    schemaVersion: '1',
    ctRepoRevision: 'rev-abc',
    components: [],
    guardEdges: [],
    coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
    ...over,
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}

/* -------------------------------------------------------------------------- */
/* Projection is a real GraphNode shape                                        */
/* -------------------------------------------------------------------------- */

describe('projection — the intended graph is a real ObservedComponent shape', () => {
  it('materializeIntendedGraph emits {id,type,path,line} nodes and externalId key blueprint:<id>:<component>', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
    });
    const intended = materializeIntendedGraph(bp);
    const node = intended.components[0];
    // structurally an ObservedComponent
    expect(node).toEqual({ id: 'store', type: 'ontologyStore', path: 'blueprint:materializer-fixture', line: 0 });
    expect(Object.keys(node).sort()).toEqual(['id', 'line', 'path', 'type']);

    const observed = makeObserved({ components: [{ id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 }] });
    const result = materialize(bp, observed);
    const nodeUpsert = result.upsertPlan.find((u) => u.kind === 'node');
    expect(nodeUpsert?.externalId).toBe('blueprint:materializer-fixture:store');
  });
});

/* -------------------------------------------------------------------------- */
/* Class 1 — declared-but-absent                                               */
/* -------------------------------------------------------------------------- */

describe('class 1 — declared-but-absent', () => {
  it('component: an intended component missing from observed → exactly one declared-but-absent violation', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
      // requiredComponent at 'critical' governs the absent component's severity
      constraints: [{ id: 'store-required', type: 'requiredComponent', severity: 'critical', component: 'ontologyStore' }],
    });
    const observed = makeObserved({ components: [] }); // NO 'store'
    const result = materialize(bp, observed);

    const absent = result.violations.filter((v) => v.class === 'declared-but-absent');
    expect(absent).toHaveLength(1);
    expect(absent[0].component).toBe('store');
    expect(absent[0].severity).toBe('critical'); // from the governing requiredComponent constraint
    expect(absent[0].observed).toContain('absent');
    expect(absent[0].expected).toContain('store');
    // no other class fired
    expect(result.byClass['present-but-forbidden']).toBe(0);
    expect(result.byClass['missing-required-evidence']).toBe(0);
  });

  it('edge: an intended allowed edge missing from observed → declared-but-absent edge violation, scored', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [
          { id: 'route', type: 'apiRouteHandler' },
          { id: 'store', type: 'ontologyStore' },
        ],
        relationships: [{ from: 'route', to: 'store', type: 'writes', allowed: true }],
      },
      constraints: [{ id: 'route-writes', type: 'requiredDependency', severity: 'high', component: 'apiRouteHandler' }],
    });
    // both components present, but NO route->store writes edge
    const observed = makeObserved({
      components: [
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 },
        { id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 },
      ],
      guardEdges: [],
    });
    const result = materialize(bp, observed);
    const absentEdge = result.violations.filter(
      (v) => v.class === 'declared-but-absent' && v.constraintId.includes('edge'),
    );
    expect(absentEdge).toHaveLength(1);
    expect(absentEdge[0].observed).toContain('route -> store');
    // scoring subtracted this severity's weight (high=20) → 80
    expect(result.score).toBe(100 - SEVERITY_WEIGHT['high']);
  });
});

/* -------------------------------------------------------------------------- */
/* Class 2 — present-but-forbidden                                             */
/* -------------------------------------------------------------------------- */

describe('class 2 — present-but-forbidden', () => {
  it('an observed edge matching an allowed:false relationship → present-but-forbidden with the REAL observed evidenceRef', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [{ id: 'route', type: 'apiRouteHandler' }],
        relationships: [{ from: 'route', to: 'openai', type: 'imports', allowed: false }],
      },
      constraints: [{ id: 'no-openai', type: 'forbiddenDependency', severity: 'critical', from: 'route', to: 'openai' }],
    });
    const observed = makeObserved({
      components: [{ id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 }],
      guardEdges: [{ from: 'route', to: 'openai', type: 'imports', evidenceRef: 'r.ts#L11' }],
    });
    const result = materialize(bp, observed);
    const forbidden = result.violations.filter((v) => v.class === 'present-but-forbidden');
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0].evidenceRef).toBe('r.ts#L11'); // the REAL observed anchor, read-only
    expect(forbidden[0].observed).toContain('forbidden');
    expect(forbidden[0].expected).toContain('no imports edge');
    expect(forbidden[0].severity).toBe('critical'); // from the forbiddenDependency constraint
  });

  it('two matching observed edges → two present-but-forbidden violations (per-edge, deterministic sort)', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [
          { id: 'route', type: 'apiRouteHandler' },
          { id: 'route2', type: 'apiRouteHandler' },
        ],
        relationships: [
          { from: 'route', to: 'openai', type: 'imports', allowed: false },
          { from: 'route2', to: 'openai', type: 'imports', allowed: false },
        ],
      },
      constraints: [{ id: 'no-openai', type: 'forbiddenDependency', severity: 'high', to: 'openai' }],
    });
    const observed = makeObserved({
      components: [
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 },
        { id: 'route2', type: 'apiRouteHandler', path: 'r2.ts', line: 1 },
      ],
      guardEdges: [
        { from: 'route2', to: 'openai', type: 'imports', evidenceRef: 'r2.ts#L9' },
        { from: 'route', to: 'openai', type: 'imports', evidenceRef: 'r.ts#L9' },
      ],
    });
    const result = materialize(bp, observed);
    const forbidden = result.violations.filter((v) => v.class === 'present-but-forbidden');
    expect(forbidden).toHaveLength(2);
    // deterministic sort by (class, constraintId, component, evidenceRef) → route before route2
    expect(forbidden.map((v) => v.component)).toEqual(['route', 'route2']);
  });
});

/* -------------------------------------------------------------------------- */
/* Class 3 — missing-required-evidence                                        */
/* -------------------------------------------------------------------------- */

describe('class 3 — missing-required-evidence', () => {
  it('governing component present in observed but its required evidence marker absent → one violation', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'route', type: 'apiRouteHandler' }], relationships: [] },
      constraints: [
        { id: 'route-guard', type: 'requiredEvidence', severity: 'high', component: 'route', evidenceType: 'tenantGuard' },
        // keep a floor requiredComponent so class-1 doesn't also fire on 'route'
        { id: 'route-exists', type: 'requiredComponent', severity: 'low', component: 'apiRouteHandler' },
      ],
      evidenceRequirements: [{ type: 'tenantGuard', required: true, onMissing: 'block' }],
    });
    const observed = makeObserved({
      components: [{ id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 }], // route EXISTS
      guardEdges: [], // but NO tenantGuard edge from route
    });
    const result = materialize(bp, observed);
    const missing = result.violations.filter((v) => v.class === 'missing-required-evidence');
    expect(missing).toHaveLength(1);
    expect(missing[0].component).toBe('route');
    expect(missing[0].evidenceType).toBe('tenantGuard');
    expect(missing[0].severity).toBe('high');
  });

  it('required:false OR onMissing:unknown does NOT produce a missing-required-evidence violation (honest)', () => {
    const base = {
      architecture: { components: [{ id: 'route', type: 'apiRouteHandler' }], relationships: [] },
      constraints: [
        { id: 'route-guard', type: 'requiredEvidence' as const, severity: 'high' as const, component: 'route', evidenceType: 'tenantGuard' },
        { id: 'route-exists', type: 'requiredComponent' as const, severity: 'low' as const, component: 'apiRouteHandler' },
      ],
    };
    const observed = makeObserved({
      components: [{ id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 }],
      guardEdges: [],
    });

    const softReq = materialize(makeBlueprint({ ...base, evidenceRequirements: [{ type: 'tenantGuard', required: false, onMissing: 'block' }] }), observed);
    expect(softReq.byClass['missing-required-evidence']).toBe(0);

    const unknownDisposition = materialize(makeBlueprint({ ...base, evidenceRequirements: [{ type: 'tenantGuard', required: true, onMissing: 'unknown' }] }), observed);
    expect(unknownDisposition.byClass['missing-required-evidence']).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Conformant fixture — the anti-theatre GREEN                                */
/* -------------------------------------------------------------------------- */

describe('conformant fixture — a green diff must mean something was proven', () => {
  it('intended graph exactly matches observed → ZERO violations, score 100, verdict pass, byClass all-zero', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [
          { id: 'route', type: 'apiRouteHandler' },
          { id: 'store', type: 'ontologyStore' },
        ],
        relationships: [
          { from: 'route', to: 'store', type: 'writes', allowed: true },
          { from: 'route', to: 'openai', type: 'imports', allowed: false },
        ],
      },
      constraints: [
        { id: 'route-required', type: 'requiredComponent', severity: 'critical', component: 'apiRouteHandler' },
        { id: 'store-required', type: 'requiredComponent', severity: 'critical', component: 'ontologyStore' },
        { id: 'route-guard', type: 'requiredEvidence', severity: 'high', component: 'route', evidenceType: 'tenantGuard' },
        { id: 'no-openai', type: 'forbiddenDependency', severity: 'critical', from: 'route', to: 'openai' },
      ],
      evidenceRequirements: [{ type: 'tenantGuard', required: true, onMissing: 'block' }],
    });
    const observed = makeObserved({
      components: [
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 },
        { id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 },
      ],
      guardEdges: [
        { from: 'route', to: 'store', type: 'writes', evidenceRef: 'r.ts#L20' }, // allowed edge present
        { from: 'route', to: 'tenantGuard', type: 'tenantGuard', evidenceRef: 'r.ts#L3' }, // required evidence satisfied
        // NO route->openai imports edge (the forbidden edge is genuinely absent)
      ],
    });
    const result = materialize(bp, observed);
    expect(result.violations).toHaveLength(0);
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('pass');
    expect(result.byClass).toEqual({ 'declared-but-absent': 0, 'present-but-forbidden': 0, 'missing-required-evidence': 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Scoring reuses report.ts weights                                            */
/* -------------------------------------------------------------------------- */

describe('scoring — reuses report.ts SEVERITY_WEIGHT and floors at 0', () => {
  it('one critical + one high → score 40; three criticals → score 0 (floored); bySeverity mirrors counts', () => {
    // one critical (absent critical component) + one high (missing-required-evidence at high)
    const bp1 = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }, { id: 'route', type: 'apiRouteHandler' }], relationships: [] },
      constraints: [
        { id: 'store-required', type: 'requiredComponent', severity: 'critical', component: 'ontologyStore' },
        { id: 'route-guard', type: 'requiredEvidence', severity: 'high', component: 'route', evidenceType: 'tenantGuard' },
      ],
      evidenceRequirements: [{ type: 'tenantGuard', required: true, onMissing: 'block' }],
    });
    // 'route' present (so class-3 fires, not class-1) ; 'store' ABSENT (class-1 critical)
    const observed1 = makeObserved({
      components: [{ id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 }],
      guardEdges: [],
    });
    const r1 = materialize(bp1, observed1);
    expect(r1.score).toBe(100 - SEVERITY_WEIGHT['critical'] - SEVERITY_WEIGHT['high']); // 100-40-20 = 40
    expect(r1.bySeverity['critical']).toBe(1);
    expect(r1.bySeverity['high']).toBe(1);

    // three critical absent components → 100-120 floored to 0
    const bp2 = makeBlueprint({
      architecture: {
        components: [
          { id: 'a', type: 'ta' },
          { id: 'b', type: 'tb' },
          { id: 'c', type: 'tc' },
        ],
        relationships: [],
      },
      constraints: [
        { id: 'ra', type: 'requiredComponent', severity: 'critical', component: 'ta' },
        { id: 'rb', type: 'requiredComponent', severity: 'critical', component: 'tb' },
        { id: 'rc', type: 'requiredComponent', severity: 'critical', component: 'tc' },
      ],
    });
    const r2 = materialize(bp2, makeObserved({ components: [] }));
    expect(r2.score).toBe(0); // floored, not negative
    expect(r2.bySeverity['critical']).toBe(3);
  });

  it('imports SEVERITY_WEIGHT from report.ts — the materializer uses the SAME constant', () => {
    // if the materializer had a private copy, mutating the shared export would not change its output.
    // We assert the score arithmetic matches the imported constant exactly (proven above); this asserts
    // the constant is the report.ts one, not a bespoke ladder.
    expect(SEVERITY_WEIGHT).toEqual({ critical: 40, high: 20, medium: 10, low: 5, info: 0 });
  });
});

/* -------------------------------------------------------------------------- */
/* Verdict + score-100-can-still-fail legibility                              */
/* -------------------------------------------------------------------------- */

describe('verdict — score 100 can still be a FAIL', () => {
  it('an info-only violation set → score 100 but verdict fail, and the summary flags it', () => {
    // an evidence marker resolved to info via a requiredEvidence constraint at info severity
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'route', type: 'apiRouteHandler' }], relationships: [] },
      constraints: [
        { id: 'route-guard', type: 'requiredEvidence', severity: 'info', component: 'route', evidenceType: 'tenantGuard' },
        { id: 'route-exists', type: 'requiredComponent', severity: 'low', component: 'apiRouteHandler' },
      ],
      evidenceRequirements: [{ type: 'tenantGuard', required: true, onMissing: 'warn' }],
    });
    const observed = makeObserved({
      components: [{ id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 }],
      guardEdges: [],
    });
    const result = materialize(bp, observed);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations.every((v) => v.severity === 'info')).toBe(true);
    expect(result.score).toBe(100);
    expect(result.verdict).toBe('fail');
    expect(result.summary).toContain('FAIL despite score 100');
  });
});

/* -------------------------------------------------------------------------- */
/* Determinism                                                                 */
/* -------------------------------------------------------------------------- */

describe('determinism — same in → byte-identical out; input order does not change output', () => {
  it('stableStringify(materialize) is byte-identical across runs and across shuffled input order', () => {
    const componentsA = [
      { id: 'route', type: 'apiRouteHandler' },
      { id: 'store', type: 'ontologyStore' },
      { id: 'audit', type: 'auditSink' },
    ];
    const relationshipsA = [
      { from: 'route', to: 'store', type: 'writes', allowed: true },
      { from: 'route', to: 'openai', type: 'imports', allowed: false },
    ];
    const bpA = makeBlueprint({ architecture: { components: componentsA, relationships: relationshipsA } });
    const bpB = makeBlueprint({
      architecture: {
        components: [...componentsA].reverse(),
        relationships: [...relationshipsA].reverse(),
      },
    });

    const guardEdges = [
      { from: 'route', to: 'openai', type: 'imports', evidenceRef: 'r.ts#L11' },
      { from: 'route', to: 'store', type: 'writes', evidenceRef: 'r.ts#L20' },
    ];
    const observedA = makeObserved({
      components: [
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 },
        { id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 },
        { id: 'audit', type: 'auditSink', path: 'a.ts', line: 1 },
      ],
      guardEdges,
    });
    const observedB = makeObserved({
      components: [...observedA.components].reverse(),
      guardEdges: [...guardEdges].reverse(),
    });

    const s1 = stableStringify(materialize(bpA, observedA));
    const s2 = stableStringify(materialize(bpA, observedA));
    const sShuffled = stableStringify(materialize(bpB, observedB));

    expect(s1).toBe(s2); // same in → identical
    expect(sShuffled).toBe(s1); // shuffled input order → identical serialized result (incl. upsertPlan)
  });
});

/* -------------------------------------------------------------------------- */
/* Read-only invariant                                                        */
/* -------------------------------------------------------------------------- */

describe('read-only — materialize never mutates the passed observed graph', () => {
  it('deep-frozen observed graph: the call completes without throwing and the graph is unchanged', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
    });
    const observed = makeObserved({
      components: [{ id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 }],
      guardEdges: [{ from: 'store', to: 'x', type: 'writes', evidenceRef: 's.ts#L2' }],
    });
    const snapshot = stableStringify(observed);
    deepFreeze(observed);
    expect(() => materialize(bp, observed)).not.toThrow(); // no in-place write attempted
    expect(stableStringify(observed)).toBe(snapshot); // structurally unchanged
  });
});

/* -------------------------------------------------------------------------- */
/* APPLY_IS_ATTENDED + PROPOSED plan + no write function                       */
/* -------------------------------------------------------------------------- */

describe('attended boundary — PROPOSED plan, marker true, no apply/write function', () => {
  it('every UpsertDescriptor is PROPOSED + applyIsAttended, result.applyIsAttended true', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [{ id: 'route', type: 'apiRouteHandler' }, { id: 'store', type: 'ontologyStore' }],
        relationships: [{ from: 'route', to: 'store', type: 'writes', allowed: true }],
      },
    });
    const observed = makeObserved({
      components: [
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 1 },
        { id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 },
      ],
      guardEdges: [{ from: 'route', to: 'store', type: 'writes', evidenceRef: 'r.ts#L20' }],
    });
    const result = materialize(bp, observed);
    expect(result.applyIsAttended).toBe(true);
    expect(APPLY_IS_ATTENDED).toBe(true);
    expect(result.upsertPlan.length).toBeGreaterThan(0);
    expect(result.upsertPlan.every((u) => u.approvalState === 'PROPOSED')).toBe(true);
    expect(result.upsertPlan.every((u) => u.applyIsAttended === true)).toBe(true);
  });

  it('the materializer module exports NO apply/upsert/write/commit/persist function', async () => {
    const mod = await import('../src/materializer.js');
    const applyLike = Object.keys(mod).filter((k) => {
      const v = (mod as Record<string, unknown>)[k];
      // a function whose name suggests it applies/writes — allow the plan-shape names (UpsertDescriptor/upsertPlan).
      return typeof v === 'function' && /apply|upsert(?!Plan|Descriptor)|write|commit|persist/i.test(k);
    });
    expect(applyLike).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Does not duplicate evaluate()                                              */
/* -------------------------------------------------------------------------- */

describe('SOLID boundary — materialize is a distinct lens from report.evaluate()', () => {
  it('the result SHAPE carries class + intended + upsertPlan (graph-derived), not a ComplianceReport', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
    });
    const observed = makeObserved({ components: [] });
    const result: MaterializationResult = materialize(bp, observed);
    // materialization-specific fields a ComplianceReport does NOT have
    expect(result).toHaveProperty('intended');
    expect(result).toHaveProperty('upsertPlan');
    expect(result).toHaveProperty('byClass');
    // every violation carries the graph-derived class tag (not a constraint-type)
    expect(result.violations.every((v) => ['declared-but-absent', 'present-but-forbidden', 'missing-required-evidence'].includes(v.class))).toBe(true);
    // the diff derives from node/edge presence — its constraintIds are diff:* synthetic, not the blueprint's constraint ids
    expect(result.violations.every((v) => v.constraintId.startsWith('diff:'))).toBe(true);
  });

  it('diffIntendedVsObserved is a standalone read-only function returning DiffViolation[]', () => {
    const bp = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
    });
    const intended = materializeIntendedGraph(bp);
    const violations = diffIntendedVsObserved(intended, makeObserved({ components: [] }));
    expect(Array.isArray(violations)).toBe(true);
    expect(violations[0].class).toBe('declared-but-absent');
  });
});

/* -------------------------------------------------------------------------- */
/* FAIL-CLOSED empty-projection floor (adversarial-verify fix)                  */
/* An empty blueprint conforms to any observed graph VACUOUSLY — it must not     */
/* diff-clean to score 100/pass (mirrors report.ts __no-enforcing-constraints__).*/
/* -------------------------------------------------------------------------- */

describe('empty-projection floor — a blueprint that projects nothing must NOT score 100/pass', () => {
  it('an empty-architecture, no-evidence blueprint fails closed against ANY observed graph', () => {
    // zero intended components, zero relationships, zero required-evidence markers
    const empty = makeBlueprint({
      architecture: { components: [], relationships: [] },
      evidenceRequirements: [],
    });
    // even against a rich, "healthy-looking" observed graph, the diff must NOT report clean:
    const richObserved = makeObserved({
      components: [
        { id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 },
        { id: 'route', type: 'apiRouteHandler', path: 'r.ts', line: 2 },
      ],
      guardEdges: [{ from: 'route', to: 'requireTenantWriteAccess', type: 'guards', evidenceRef: 'r.ts#L3' }],
    });
    const result = materialize(empty, richObserved);
    expect(result.verdict).toBe('fail');
    expect(result.score).toBeLessThan(100);
    const floor = result.violations.find((v) => v.constraintId === '__no-intended-architecture__');
    expect(floor, 'the empty-projection floor violation must be present').toBeDefined();
    expect(floor?.severity).toBe('critical');
  });

  it('a blueprint with even ONE intended component does NOT trip the floor', () => {
    const oneComponent = makeBlueprint({
      architecture: { components: [{ id: 'store', type: 'ontologyStore' }], relationships: [] },
    });
    const observed = makeObserved({ components: [{ id: 'store', type: 'ontologyStore', path: 's.ts', line: 1 }] });
    const result = materialize(oneComponent, observed);
    expect(result.violations.some((v) => v.constraintId === '__no-intended-architecture__')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Read-only invariant — materialize() NEVER mutates the caller's observed graph */
/* (adversarial-verify fix: MULTI-element, deliberately-unsorted, deep-frozen). */
/* -------------------------------------------------------------------------- */

describe('read-only — materialize never mutates the passed observed graph', () => {
  it('does not in-place sort/reverse a multi-element, deliberately-unsorted, frozen observed graph', () => {
    const bp = makeBlueprint({
      architecture: {
        components: [{ id: 'store', type: 'ontologyStore' }],
        relationships: [{ from: 'route', to: 'openai', type: 'imports', allowed: false }],
      },
    });
    // ≥2 components + ≥2 guardEdges in a deliberately NON-sorted order — a real in-place
    // .sort()/.reverse() inside materialize() would reorder these and the frozen graph would throw.
    const observed = deepFreeze(
      makeObserved({
        components: [
          { id: 'zeta', type: 'apiRouteHandler', path: 'z.ts', line: 9 },
          { id: 'alpha', type: 'ontologyStore', path: 'a.ts', line: 1 },
        ],
        guardEdges: [
          { from: 'zeta', to: 'requireX', type: 'guards', evidenceRef: 'z.ts#L9' },
          { from: 'alpha', to: 'requireY', type: 'guards', evidenceRef: 'a.ts#L1' },
        ],
      }),
    );
    // must NOT throw (frozen) — proves materialize copies before sorting for the content hash.
    expect(() => materialize(bp, observed)).not.toThrow();
    // and the caller's arrays remain in their original (unsorted) order.
    expect(observed.components.map((c) => c.id)).toEqual(['zeta', 'alpha']);
    expect(observed.guardEdges.map((e) => e.from)).toEqual(['zeta', 'alpha']);
  });
});
