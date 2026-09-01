import { describe, expect, it } from 'vitest';
import { benchmarkMetrics, metricsByClass, validateJudgments, type BenchmarkJudgment } from '../src/benchmark.js';

const rows: BenchmarkJudgment[] = [
  { caseId: 'a', defectClass: 'dependency', expectedViolation: true, outcome: 'detected', annotators: ['ann-1', 'ann-2'], locations: ['a.ts#L1', 'a.ts#L1'], collateralViolations: 0 },
  { caseId: 'b', defectClass: 'dependency', expectedViolation: true, outcome: 'not-detected', annotators: ['ann-1', 'ann-2'], locations: ['b.ts#L2', 'b.ts#L2'], collateralViolations: 1 },
  { caseId: 'c', defectClass: 'clean', expectedViolation: false, outcome: 'detected', annotators: ['ann-1', 'ann-2'], locations: ['c.ts#L3', 'c.ts#L3'], collateralViolations: 0 },
  { caseId: 'd', defectClass: 'clean', expectedViolation: false, outcome: 'not-detected', annotators: ['ann-1', 'ann-2'], locations: ['d.ts#L4', 'd.ts#L4'], collateralViolations: 0 },
  { caseId: 'e', defectClass: 'runtime', expectedViolation: true, outcome: 'unsupported', annotators: ['ann-1', 'ann-2'], locations: ['e.ts#L5', 'e.ts#L5'], collateralViolations: 0 },
];

describe('benchmark analysis', () => {
  it('keeps unsupported and collateral outcomes visible and computes Wilson intervals', () => {
    const m = benchmarkMetrics(rows);
    expect(m).toMatchObject({ opportunities: 5, supportedOpportunities: 4, unsupported: 1, tp: 1, fp: 1, fn: 1, tn: 1, collateralViolations: 1 });
    expect(m.recall.estimate).toBe(0.5);
    expect(m.recall.low).toBeGreaterThan(0);
    expect(m.falseViolationsPerOpportunity).toBe(0.5);
    expect(Object.keys(metricsByClass(rows))).toEqual(['clean', 'dependency', 'runtime']);
  });

  it('refuses same-person or location-free annotation', () => {
    const bad = [{ ...rows[0]!, annotators: ['same', 'same'] as [string, string], locations: ['a.ts', 'a.ts'] as [string, string] }];
    expect(validateJudgments(bad)).toHaveLength(2);
    expect(() => benchmarkMetrics(bad)).toThrow('invalid benchmark judgments');
  });
});
