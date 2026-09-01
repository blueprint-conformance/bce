/**
 * The NON-VACUOUS recall proof (adversarial-verify finding: the measured-recall gate must be
 * measured against the REAL engine, not synthetic reports). This test runs the ACTUAL
 * AstExtractor + evaluate() over each seeded-corpus fixture directory, builds SeededRun[] from the
 * REAL ComplianceReports, and asserts gateVerdict(measureRecall(SEEDED_CORPUS, realRuns)) PASSES at
 * DEFAULT_THRESHOLDS. Nothing here is mocked — this is what makes the measured-recall verify layer real.
 *
 * CORPUS EXPANSION (N=9 → N=25, suite-v2 corpus-expansion design):
 *  - builds run PER DISTINCT FIXTURE, not per defect — the tri-seed (drift-unrecognized-factory
 *    seeds 3 constraints in ONE fixture) would otherwise run one fixture 3× and inflate the fp
 *    denominator (and count one crying-wolf report 3×). Behavior-identical at N=9.
 *  - a fixture carrying `observations.json` at its root has the recorded probe artifact merged
 *    into the graph through the SAME fail-closed validated path the CLI uses
 *    (src/observations.ts `loadObservations` — FIX 3 seam), never a test-local copy.
 *  - the 12 CLEAN fixtures flow through measureRecall as reports that seed NOTHING — any
 *    violation on them is a cried-wolf false-positive. This is what makes the missing-guard catches
 *    non-gameable: a flag-everything engine passes recall trivially and dies here.
 *  - the route-surface expected-fire matrix (design Appendix) is EXECUTABLE below: each seeded
 *    route/behavior fixture's exact violation (constraintId, component) multiset is asserted, so
 *    same-constraint over-flagging INSIDE a seeded fixture — invisible to both recall and fp by
 *    construction of caughtDefect/measureRecall — is a measured fact, not prose.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import { resolveExtraction } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { evaluate } from '../src/report.js';
import { SEEDED_CORPUS, caughtDefect } from '../src/corpus.js';
import { loadObservations, observationBinding } from '../src/observations.js';
import { measureRecall, gateVerdict, DEFAULT_THRESHOLDS, type SeededRun } from '../src/recall-gate.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');

/**
 * The corpus spans FIVE blueprints (the egress surface added `egress-reader@0.1.0`; the corpus
 * expansion added `route-guard@0.1.0` (the missing-tenant-guard route surface) and
 * `served-behavior@0.1.0` (the behavioralInvariant grading arm)). Map each corpus blueprintRef to
 * its authored blueprint file + resolved extraction config, so the real-engine proof runs each
 * fixture against the RIGHT blueprint.
 */
const BLUEPRINT_BY_REF = new Map<string, { bp: EngineeringBlueprint; cfg: ReturnType<typeof resolveExtraction> }>(
  [
    ['luna-chat-extension@0.1.0', 'luna-chat-extension.blueprint.json'],
    ['egress-reader@0.1.0', 'egress-reader.blueprint.json'],
    ['route-guard@0.1.0', 'route-guard.blueprint.json'],
    ['served-behavior@0.1.0', 'served-behavior.blueprint.json'],
    ['python-service@0.1.0', 'python-service.blueprint.json'],
  ].map(([ref, file]) => {
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(path.join(FIXROOT, file), 'utf8')));
    return [ref, { bp, cfg: resolveExtraction(bp.extraction, bp.constraints) }];
  }),
);

/** Resolve a SeededDefect.fixture entry to its absolute fixture dir (mirrors corpus.test.ts). */
function resolveFixturePath(fixture: string): string {
  return fixture.includes('/') ? path.join(FIXROOT, fixture) : path.join(FIXROOT, 'extension-surface', fixture);
}

/**
 * Run the REAL engine over one fixture dir against its blueprint → a REAL ComplianceReport.
 * A fixture carrying `observations.json` at its root (the behavior surface's recorded probe
 * artifact) has the nodes merged through the SAME fail-closed path the CLI uses (FIX 3 seam),
 * exactly mirroring cli.ts's merge: append + re-sort by id, so the report stays deterministic.
 */
function realRunForFixture(fixture: string, blueprintRef: string): SeededRun {
  const entry = BLUEPRINT_BY_REF.get(blueprintRef);
  if (!entry) throw new Error(`no blueprint wired for corpus blueprintRef ${blueprintRef}`);
  const dir = resolveFixturePath(fixture);
  // the registry front door — routes each blueprint's profile to its provider (the python
  // fixtures extract via the python provider; TS profiles stay on the exact AstExtractor path).
  const graph = makeExtractor('ast', entry.cfg).extract(dir, fixture);
  const obsPath = path.join(dir, 'observations.json');
  if (fs.existsSync(obsPath)) {
    const behavioral = entry.bp.constraints.find((c) => c.type === 'behavioralInvariant');
    if (!behavioral?.probeDefinitionHash || !behavioral.stimulusSetHash || !behavioral.environmentId) {
      throw new Error(`behavioral fixture blueprint lacks observation binding expectations`);
    }
    const obs = loadObservations(obsPath, {
      ...observationBinding(dir, graph),
      probeDefinitionHash: behavioral.probeDefinitionHash,
      stimulusSetHash: behavioral.stimulusSetHash,
      environmentId: behavioral.environmentId,
    });
    graph.components = [...graph.components, ...obs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const report = evaluate(entry.bp, graph, entry.cfg.profile);
  return { fixture, report };
}

/**
 * One run per DISTINCT seeded fixture (the dedup the tri-seed requires). Also asserts the corpus
 * invariant the dedup depends on: every defect sharing a fixture shares its blueprintRef.
 */
function distinctSeededFixtures(): Map<string, string> {
  const fixtureToRef = new Map<string, string>();
  for (const d of SEEDED_CORPUS) {
    const prev = fixtureToRef.get(d.fixture);
    if (prev !== undefined && prev !== d.blueprintRef) {
      throw new Error(`corpus invariant broken: fixture ${d.fixture} maps to both ${prev} and ${d.blueprintRef}`);
    }
    fixtureToRef.set(d.fixture, d.blueprintRef);
  }
  return fixtureToRef;
}

/**
 * The CLEAN control set (design §3): fixtures that seed NOTHING, run through the SAME engine +
 * their surface's blueprint. Any violation on them is a cried-wolf fp. The wrapper-guard shape
 * (a route guarded via an imported `withTenantGuard(handler)` wrapper) is DELIBERATELY absent:
 * it would falsely RED by documented extractor limitation (`coverage.unsupported`), so it is the
 * D6 arm's honest coverage boundary for the limitations paragraph — not an fp-denominator entry.
 */
const CLEAN_FIXTURES: ReadonlyArray<{ fixture: string; blueprintRef: string }> = [
  // extension surface (promoted to clean runs)
  { fixture: 'conformant', blueprintRef: 'luna-chat-extension@0.1.0' },
  { fixture: 'conformant-comment', blueprintRef: 'luna-chat-extension@0.1.0' },
  { fixture: 'conformant-curried', blueprintRef: 'luna-chat-extension@0.1.0' },
  { fixture: 'conformant-typeimport', blueprintRef: 'luna-chat-extension@0.1.0' },
  // egress surface: only a provably governed destination is a clean allowlist control.
  { fixture: 'egress-surface/conformant-houseidiom', blueprintRef: 'egress-reader@0.1.0' },
  // route surface (new) — the denominator for every route-surface constraint
  { fixture: 'route-surface/conformant-guarded', blueprintRef: 'route-guard@0.1.0' },
  { fixture: 'route-surface/conformant-mixed-verbs', blueprintRef: 'route-guard@0.1.0' },
  { fixture: 'route-surface/conformant-nested-segments', blueprintRef: 'route-guard@0.1.0' },
  // behavior surface (new) — green through the full merge+grading path
  { fixture: 'behavior-surface/conformant-varying', blueprintRef: 'served-behavior@0.1.0' },
  // python surface (B1) — the conformant gateway-client tree as the clean control
  { fixture: 'python-surface/conformant', blueprintRef: 'python-service@0.1.0' },
];

describe('every seeded fixture resolves on disk (finding #2 — no dangling fixture id)', () => {
  for (const defect of SEEDED_CORPUS) {
    it(`fixture '${defect.fixture}' (defect ${defect.id}) exists`, () => {
      expect(fs.existsSync(resolveFixturePath(defect.fixture))).toBe(true);
    });
  }
  for (const clean of CLEAN_FIXTURES) {
    it(`clean fixture '${clean.fixture}' exists`, () => {
      expect(fs.existsSync(resolveFixturePath(clean.fixture))).toBe(true);
    });
  }
});

describe('NON-VACUOUS recall — real engine over the seeded corpus + clean control set (finding #3)', () => {
  // one real run per distinct FIXTURE (dedup — see header), then the clean control runs.
  const fixtureToRef = distinctSeededFixtures();
  const seededRuns = [...fixtureToRef.entries()].map(([fixture, ref]) => realRunForFixture(fixture, ref));
  const cleanRuns = CLEAN_FIXTURES.map((c) => realRunForFixture(c.fixture, c.blueprintRef));
  const runs: SeededRun[] = [...seededRuns, ...cleanRuns];

  it('the REAL engine catches every seeded defect (recall 1.0)', () => {
    for (const defect of SEEDED_CORPUS) {
      const run = runs.find((r) => r.fixture === defect.fixture)!;
      expect(caughtDefect(defect, run.report), `defect ${defect.id} must be caught by the real engine`).toBe(true);
    }
  });

  it('measureRecall over REAL runs → recall 1.0, fp 0 over the widened clean set, gate PASSES at DEFAULT_THRESHOLDS', () => {
    const m = measureRecall(SEEDED_CORPUS, runs);
    expect(m.total).toBe(SEEDED_CORPUS.length);
    expect(m.caught).toBe(SEEDED_CORPUS.length);
    expect(m.recall).toBe(1);
    // the fp denominator is now DISTINCT seeded fixtures + the clean control set.
    expect(m.reports).toBe(fixtureToRef.size + CLEAN_FIXTURES.length);
    // intent assertion (design §3): zero cried-wolf reports across seeded AND clean.
    expect(m.falsePositives, 'no report may cry wolf (violations outside its seeded pairs)').toBe(0);
    const v = gateVerdict(m, DEFAULT_THRESHOLDS);
    expect(v.pass, v.reason).toBe(true);
  });

  it('every CLEAN fixture scores ZERO violations (itemized — the honesty counterweight)', () => {
    for (const run of cleanRuns) {
      expect(
        run.report.violations,
        `clean fixture ${run.fixture} must not redden — got ${JSON.stringify(run.report.violations)}`,
      ).toEqual([]);
    }
  });

  it('a SINGLE missed defect is an honest recall<1 that names the exact miss (and legitimately still clears the 0.9 floor at N=25)', () => {
    // strip the openai violation from ONE run: 24/25 = 0.96 — above the floor BY DESIGN (the
    // floor is 0.9, not 1.0); the measurement must still name the miss honestly.
    const regressed = runs.map((r) =>
      r.fixture === 'drift-forbidden-import'
        ? { ...r, report: { ...r.report, violations: r.report.violations.filter((x) => x.constraintId !== 'no-direct-provider-sdk') } }
        : r,
    );
    const m = measureRecall(SEEDED_CORPUS, regressed);
    expect(m.recall).toBeLessThan(1);
    expect(m.misses.map((x) => `${x.fixture}:${x.constraintId}`)).toContain('drift-forbidden-import:no-direct-provider-sdk');
  });

  it('is HONEST-FAIL when the engine loses a whole tooth (recall gate is not a rubber-stamp)', () => {
    // simulate a regressed engine that lost its forbidden-import tooth ENTIRELY: every
    // no-direct-provider-sdk violation vanishes from every run → 7 misses, 18/25 = 0.72 < 0.9.
    const regressed = runs.map((r) => ({
      ...r,
      report: { ...r.report, violations: r.report.violations.filter((x) => x.constraintId !== 'no-direct-provider-sdk') },
    }));
    const m = measureRecall(SEEDED_CORPUS, regressed);
    expect(m.recall).toBeLessThan(DEFAULT_THRESHOLDS.minRecall);
    const v = gateVerdict(m, DEFAULT_THRESHOLDS);
    expect(v.pass).toBe(false); // an honest FAIL — the loop stays refuse-to-arm
    expect(v.reason).toContain('drift-forbidden-import:no-direct-provider-sdk'); // names the exact miss
  });

  /* ------------------------------------------------------------------------ */
  /* The route/behavior expected-fire matrix, EXECUTABLE (review RECOMMENDATION).
   * caughtDefect matches only (blueprintRef, constraintId, severity>=floor) — it never inspects
   * violation.component — so the "defect-specific" column of the design is enforced HERE, as the
   * exact (constraintId, component) multiset each seeded fixture's report must carry. */

  const violationPairs = (fixture: string): Array<[string, string]> => {
    const run = runs.find((r) => r.fixture === fixture);
    if (!run) throw new Error(`no run for fixture ${fixture}`);
    return run.report.violations.map((v) => [v.constraintId, v.component] as [string, string]).sort();
  };

  it('drift-missing-guard → EXACTLY one d6 violation, on the unguarded POST (route:items:POST)', () => {
    expect(violationPairs('route-surface/drift-missing-guard')).toEqual([['d6-tenant-guard', 'route:items:POST']]);
  });

  it('drift-unguarded-new-route → EXACTLY two d6 violations, the new file\'s handlers only', () => {
    expect(violationPairs('route-surface/drift-unguarded-new-route')).toEqual([
      ['d6-tenant-guard', 'route:exports:GET'],
      ['d6-tenant-guard', 'route:exports:POST'],
    ]);
  });

  it('drift-decoy-guard → EXACTLY one d6 violation, on the decoy handler (route:billing:POST)', () => {
    expect(violationPairs('route-surface/drift-decoy-guard')).toEqual([['d6-tenant-guard', 'route:billing:POST']]);
  });

  it('drift-legacy-route → EXACTLY one forbiddenPath violation (d6 stays green on the guarded legacy route)', () => {
    expect(violationPairs('route-surface/drift-legacy-route')).toEqual([
      ['no-legacy-route-path', 'route:src:app:api:legacy:tenants:GET'],
    ]);
  });

  it('drift-shadow-provisioner → EXACTLY one forbiddenFile violation, via the file: pseudo-component', () => {
    expect(violationPairs('route-surface/drift-shadow-provisioner')).toEqual([
      ['no-parallel-provisioner-file', 'file:src/app/api/beta-provisioner.ts'],
    ]);
  });

  it('drift-mock-metric → EXACTLY one forbiddenPattern violation, at the planted file (single line)', () => {
    expect(violationPairs('route-surface/drift-mock-metric')).toEqual([
      ['no-mocked-metrics', 'file:src/app/api/metrics/route.ts'],
    ]);
  });

  it('drift-unrecognized-factory → EXACTLY the three tri-seeded violations (no collateral pair)', () => {
    const pairs = violationPairs('drift-unrecognized-factory');
    expect(pairs.map(([c]) => c).sort()).toEqual([
      'ext-must-be-recognizable',
      'ext-registers-through-governed-path',
      'no-direct-provider-sdk',
    ]);
  });

  it('drift-constant-output → EXACTLY one behavioralInvariant violation (constant-function branch only)', () => {
    expect(violationPairs('behavior-surface/drift-constant-output')).toEqual([
      ['served-output-varies-with-input', 'served-output-varies-with-input'],
    ]);
  });

  it('drift-oracle-violation → EXACTLY one behavioralInvariant violation (oracle branch, on the violated node)', () => {
    expect(violationPairs('behavior-surface/drift-oracle-violation')).toEqual([
      ['served-output-varies-with-input', 'behavior:chat-completion:stim-beta'],
    ]);
  });
});

describe('gateVerdict defends the pinned floor (finding #7)', () => {
  it('REFUSES a sub-floor threshold (minRecall<=0) — a governance bypass', () => {
    const fixtureToRef = distinctSeededFixtures();
    const runs = [...fixtureToRef.entries()].map(([fixture, ref]) => realRunForFixture(fixture, ref));
    const m = measureRecall(SEEDED_CORPUS, runs);
    const v = gateVerdict(m, { minRecall: 0, maxFpRate: 1 });
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('GOVERNANCE-REFUSED');
  });
});
