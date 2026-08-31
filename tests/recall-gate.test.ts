/**
 * Quality matrix for the NA-6 measured-recall gate (the measured-recall verify layer):
 * measureRecall (recall + fpRate + misses) and gateVerdict (HONEST pass/fail).
 *
 * The sibling `./corpus.js` module (SeededDefect + caughtDefect) is authored on a parallel wave;
 * This uses the REAL caughtDefect (no mock — finding #3): the arithmetic is exercised over
 * synthetic-but-valid SeededDefect/report pairs whose blueprintRef matches, so recall/fp/verdict
 * math is proven here and the real-engine e2e proof lives in recall-e2e-proof.test.ts.
 */
import { describe, it, expect } from 'vitest';

import {
  measureRecall,
  gateVerdict,
  DEFAULT_THRESHOLDS,
  type SeededRun,
} from '../src/recall-gate.js';
import type { ComplianceReport, Violation } from '../src/report.js';
import type { SeededDefect } from '../src/corpus.js';

/* ---- fixtures --------------------------------------------------------------- */

const mkViolation = (constraintId: string): Violation => ({
  constraintId,
  severity: 'critical',
  component: 'c',
  evidenceType: 'staticAst',
  evidenceRef: 'x#L1',
  observed: '',
  expected: '',
});

const mkReport = (constraintIds: string[], blueprintRef = 'luna@0.1.0'): ComplianceReport => ({
  schemaVersion: '1',
  blueprintRef,
  ctRepoRevision: 'r1',
  score: constraintIds.length === 0 ? 100 : 50,
  verdict: constraintIds.length === 0 ? 'pass' : 'fail',
  violations: constraintIds.map(mkViolation),
  evidenceRef: 'x',
  summary: '',
  coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
});

const mkDefect = (fixture: string, constraintId: string, blueprintRef = 'luna@0.1.0'): SeededDefect =>
  ({ id: `${fixture}-${constraintId}`, fixture, constraintId, blueprintRef, description: 'x', expectedSeverity: 'critical' }) as SeededDefect;

describe('measureRecall (the measured-recall verify layer)', () => {
  it('a PERFECT run catches every seeded defect with zero false-positives → recall 1, fpRate 0', () => {
    const seeded = [mkDefect('f1', 'no-openai'), mkDefect('f2', 'must-register')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['no-openai']) },
      { fixture: 'f2', report: mkReport(['must-register']) },
    ];
    const m = measureRecall(seeded, runs);
    expect(m.recall).toBe(1);
    expect(m.fpRate).toBe(0);
    expect(m.caught).toBe(2);
    expect(m.total).toBe(2);
    expect(m.misses).toEqual([]);
  });

  it('a run that MISSES a defect drops recall and lists the miss', () => {
    const seeded = [mkDefect('f1', 'no-openai'), mkDefect('f2', 'must-register')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['no-openai']) },
      { fixture: 'f2', report: mkReport([]) }, // engine did NOT flag must-register — a MISS
    ];
    const m = measureRecall(seeded, runs);
    expect(m.caught).toBe(1);
    expect(m.recall).toBe(0.5);
    expect(m.misses).toHaveLength(1);
    expect(m.misses[0].constraintId).toBe('must-register');
    expect(m.misses[0].fixture).toBe('f2');
  });

  it('a defect whose fixture never ran is a MISS (never silently dropped)', () => {
    const seeded = [mkDefect('f1', 'no-openai'), mkDefect('ghost', 'unseen')];
    const runs: SeededRun[] = [{ fixture: 'f1', report: mkReport(['no-openai']) }];
    const m = measureRecall(seeded, runs);
    expect(m.caught).toBe(1);
    expect(m.total).toBe(2);
    expect(m.misses.map((d) => d.constraintId)).toEqual(['unseen']);
  });

  it('a violation on a CLEAN fixture (no seeded defect for that constraint) is a false-positive', () => {
    const seeded = [mkDefect('f1', 'no-openai')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['no-openai']) }, // caught, legit
      { fixture: 'clean', report: mkReport(['spurious']) }, // cried wolf → false-positive
    ];
    const m = measureRecall(seeded, runs);
    expect(m.recall).toBe(1);
    expect(m.falsePositives).toBe(1);
    expect(m.reports).toBe(2);
    expect(m.fpRate).toBe(0.5);
  });

  it('a "refuse everything" panel scores recall 1 but is punished by fpRate', () => {
    // one seeded defect, but every report screams an unrelated violation
    const seeded = [mkDefect('f1', 'no-openai')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['no-openai', 'noise-a']) }, // has an unseeded 'noise-a' → fp
      { fixture: 'clean', report: mkReport(['noise-b']) }, // fp
    ];
    const m = measureRecall(seeded, runs);
    expect(m.recall).toBe(1); // caught the one real defect
    expect(m.fpRate).toBe(1); // ...but every report cried wolf
  });

  it('is DETERMINISTIC — misses are sorted, re-run is byte-identical', () => {
    const seeded = [mkDefect('zeta', 'z'), mkDefect('alpha', 'a')];
    const runs: SeededRun[] = [];
    const a = measureRecall(seeded, runs);
    const b = measureRecall(seeded, runs);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // sorted by (fixture constraintId): alpha before zeta
    expect(a.misses.map((d) => d.fixture)).toEqual(['alpha', 'zeta']);
  });

  it('an empty corpus scores recall 0 (honest, never vacuous 1)', () => {
    const m = measureRecall([], []);
    expect(m.recall).toBe(0);
    expect(m.fpRate).toBe(0);
    expect(m.total).toBe(0);
  });
});

describe('gateVerdict (HONEST fail — the honest-fail invariant)', () => {
  it('a perfect measurement PASSES the default floor', () => {
    const seeded = [mkDefect('f1', 'no-openai'), mkDefect('f2', 'must-register')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['no-openai']) },
      { fixture: 'f2', report: mkReport(['must-register']) },
    ];
    const v = gateVerdict(measureRecall(seeded, runs));
    expect(v.pass).toBe(true);
    expect(v.reason).toContain('PASS');
  });

  it('a below-floor recall is an HONEST FAIL that names the missed defect (never a threshold lower)', () => {
    const seeded = [mkDefect('f1', 'a'), mkDefect('f2', 'b'), mkDefect('f3', 'c')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['a']) },
      { fixture: 'f2', report: mkReport([]) }, // miss
      { fixture: 'f3', report: mkReport([]) }, // miss
    ];
    const m = measureRecall(seeded, runs);
    expect(m.recall).toBeCloseTo(1 / 3, 5);
    const v = gateVerdict(m);
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('FAIL');
    expect(v.reason).toContain('advisory');
    expect(v.reason).toContain('f2:b');
    expect(v.reason).toContain('f3:c');
  });

  it('an over-ceiling fpRate FAILS even with recall 1', () => {
    const seeded = [mkDefect('f1', 'real')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['real']) },
      { fixture: 'clean', report: mkReport(['wolf']) }, // fp → fpRate 0.5 > 0.1
    ];
    const v = gateVerdict(measureRecall(seeded, runs));
    expect(v.pass).toBe(false);
    expect(v.reason).toContain('fpRate');
    expect(v.reason).toContain('cried wolf');
  });

  it('honors a caller-supplied (tighter) threshold', () => {
    const seeded = [mkDefect('f1', 'a'), mkDefect('f2', 'b')];
    const runs: SeededRun[] = [
      { fixture: 'f1', report: mkReport(['a']) },
      { fixture: 'f2', report: mkReport(['b']) },
    ];
    const m = measureRecall(seeded, runs); // recall 1, fpRate 0
    // a nonsensical >1 floor can never be met → honest fail (ratchet only tightens)
    expect(gateVerdict(m, { minRecall: 1.01, maxFpRate: 0 }).pass).toBe(false);
    expect(gateVerdict(m, { minRecall: 1, maxFpRate: 0 }).pass).toBe(true);
  });

  it('DEFAULT_THRESHOLDS is the pinned NA-6 floor {minRecall:0.9, maxFpRate:0.1}', () => {
    expect(DEFAULT_THRESHOLDS).toEqual({ minRecall: 0.9, maxFpRate: 0.1 });
  });
});
