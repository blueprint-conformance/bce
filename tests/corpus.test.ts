/**
 * Quality matrix for the seeded-architecture-defect corpus: the corpus is well-formed
 * (unique ids, engine-mappable constraint ids, ≥20 entries, every fixture resolves on disk), and
 * caughtDefect matches a violation ONLY when the constraintId matches AND the severity is at/above
 * the expected floor AND the report's blueprintRef equals the defect's (subsystem-scoped catch).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SEEDED_CORPUS, caughtDefect, type SeededDefect } from '../src/corpus.js';
import type { ComplianceReport, Violation } from '../src/report.js';

const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');
const FIXROOT = path.join(FIXTURES_ROOT, 'extension-surface');

/**
 * Resolve a SeededDefect.fixture entry to its absolute path on disk. A bare dir name (no `/`)
 * is historical — resolves under `fixtures/extension-surface/`. A `<surfaceRoot>/<dir>` form
 * (contains a `/`) resolves directly under `fixtures/` (the egress corpus entry
 * references `egress-surface/drift-egress-provider-houseidiom`).
 */
function resolveFixturePath(fixture: string): string {
  return fixture.includes('/') ? path.join(FIXTURES_ROOT, fixture) : path.join(FIXROOT, fixture);
}

/**
 * The constraint ids the six corpus blueprints (luna-chat-extension, egress-reader,
 * route-guard, served-behavior, python-service, python-module-layering) emit that the corpus maps onto.
 */
const ENGINE_CONSTRAINT_IDS = new Set([
  'no-direct-provider-sdk',
  'ext-registers-through-governed-path',
  'ext-must-be-recognizable',
  'reader-egress-governed-only',
  // route-guard@0.1.0 (corpus expansion — the missing-tenant-guard route surface)
  'd6-tenant-guard',
  'no-legacy-route-path',
  'no-parallel-provisioner-file',
  'no-mocked-metrics',
  // served-behavior@0.1.0 (the behavioralInvariant grading arm)
  'served-output-varies-with-input',
  // python-service@0.1.0 (B1 python-import-surface — the first non-TypeScript corpus arm)
  'no-committed-secrets-module',
  'no-hardcoded-provider-key',
  // python-module-layering@0.1.0 (structured direct repository-module edge)
  'domain-cannot-import-api',
]);

const mkViolation = (constraintId: string, severity: Violation['severity']): Violation => ({
  constraintId,
  severity,
  component: 'c',
  evidenceType: 'staticAst',
  evidenceRef: 'x.ts#L1',
  observed: '',
  expected: '',
});

/** A synthetic report for a given blueprintRef — used only to unit-test caughtDefect's matching. */
const mkReport = (blueprintRef: string, violations: Violation[]): ComplianceReport => ({
  schemaVersion: '1',
  blueprintRef,
  ctRepoRevision: 'r1',
  score: 0,
  verdict: violations.length === 0 ? 'pass' : 'fail',
  violations,
  evidenceRef: 'x',
  summary: '',
  coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
});

const defectById = (id: string): SeededDefect => {
  const d = SEEDED_CORPUS.find((x) => x.id === id);
  if (!d) throw new Error(`no seeded defect ${id}`);
  return d;
};

describe('SEEDED_CORPUS is well-formed', () => {
  it('has at least 34 seeded defects (floor TIGHTENED 6 → 20 → 34 with corpus v3 — append-only, widen-only ratchet direction)', () => {
    expect(SEEDED_CORPUS.length).toBeGreaterThanOrEqual(34);
  });

  it('every id is unique', () => {
    const ids = SEEDED_CORPUS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every constraintId maps to a constraint the engine emits', () => {
    for (const d of SEEDED_CORPUS) expect(ENGINE_CONSTRAINT_IDS.has(d.constraintId)).toBe(true);
  });

  it('EVERY fixture resolves to a real directory on disk (no dangling fixture id)', () => {
    for (const d of SEEDED_CORPUS) {
      expect(fs.existsSync(resolveFixturePath(d.fixture)), `fixture ${d.fixture} for ${d.id}`).toBe(true);
    }
  });

  it('every blueprintRef is an id@semver, expectedSeverity real, description present', () => {
    for (const d of SEEDED_CORPUS) {
      expect(d.blueprintRef).toMatch(/^[^@]+@\d+\.\d+\.\d+$/);
      expect(['info', 'low', 'medium', 'high', 'critical']).toContain(d.expectedSeverity);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it('is frozen (immutable ground truth)', () => {
    expect(Object.isFrozen(SEEDED_CORPUS)).toBe(true);
  });
});

describe('caughtDefect matching', () => {
  const d = defectById('ext-direct-openai-import'); // luna-chat-extension@0.1.0, no-direct-provider-sdk, critical

  it('catches when blueprintRef + constraintId match AND severity >= expected', () => {
    expect(caughtDefect(d, mkReport(d.blueprintRef, [mkViolation('no-direct-provider-sdk', 'critical')]))).toBe(true);
  });

  it('is a MISS under a DIFFERENT blueprintRef (subsystem-scoped, no cross-subsystem credit)', () => {
    expect(caughtDefect(d, mkReport('other@9.9.9', [mkViolation('no-direct-provider-sdk', 'critical')]))).toBe(false);
  });

  it('is a MISS when the constraintId does not appear (empty report)', () => {
    expect(caughtDefect(d, mkReport(d.blueprintRef, []))).toBe(false);
  });

  it('is a MISS when the constraint matches but severity is BELOW the floor', () => {
    expect(caughtDefect(d, mkReport(d.blueprintRef, [mkViolation('no-direct-provider-sdk', 'high')]))).toBe(false);
  });

  it('is a MISS when a different constraint was violated (no false credit)', () => {
    expect(caughtDefect(d, mkReport(d.blueprintRef, [mkViolation('ext-must-be-recognizable', 'high')]))).toBe(false);
  });

  it('is DETERMINISTIC — repeated calls agree', () => {
    const r = mkReport(d.blueprintRef, [mkViolation('no-direct-provider-sdk', 'critical')]);
    expect(caughtDefect(d, r)).toBe(caughtDefect(d, r));
  });
});

/* -------------------------------------------------------------------------- */
/* egress surface — the seeded ungoverned-egress defect is caught by the REAL engine over its
 * referenced fixture (not just the synthetic-report matcher above). */
describe('egress surface — ext-ungoverned-egress-provider is caught by a REAL engine run', () => {
  it('evaluate() over the real fixture produces a report that caughtDefect() credits', async () => {
    const { parseBlueprint } = await import('../src/schema.js');
    const { AstExtractor, resolveExtraction } = await import('../src/extractors.js');
    const { evaluate } = await import('../src/report.js');

    const d = defectById('ext-ungoverned-egress-provider');
    const bpPath = path.join(FIXTURES_ROOT, 'egress-reader.blueprint.json');
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(bpPath, 'utf8')));
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    const graph = new AstExtractor(cfg).extract(resolveFixturePath(d.fixture), 'corpus-proof');
    const report = evaluate(bp, graph, cfg.profile);

    expect(report.blueprintRef).toBe(d.blueprintRef);
    expect(caughtDefect(d, report)).toBe(true);
  });
});
