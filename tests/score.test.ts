/**
 * Quality matrix for the observability primitives: Architecture Score,
 * score time-series/trend, Top-Violations rollup.
 */
import { describe, it, expect } from 'vitest';
import {
  subsystemScore,
  architectureScore,
  toScoreSample,
  trendSummary,
  topViolations,
} from '../src/score.js';
import type { ComplianceReport } from '../src/report.js';

const mk = (id: string, score: number, verdict: 'pass' | 'fail', violations: ComplianceReport['violations'] = [], rev = 'r1'): ComplianceReport => ({
  schemaVersion: '1', blueprintRef: `${id}@0.1.0`, ctRepoRevision: rev, score, verdict, violations,
  evidenceRef: 'x', summary: '', coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
});

const crit = { constraintId: 'no-openai', severity: 'critical' as const, component: 'c', evidenceType: 'staticAst', evidenceRef: 'x#L1', observed: '', expected: '' };
const high = { constraintId: 'no-register', severity: 'high' as const, component: 'c', evidenceType: 'staticAst', evidenceRef: 'x#L2', observed: '', expected: '' };

describe('Architecture Score', () => {
  it('an empty fleet scores 0 (honest, never vacuous 100)', () => {
    expect(architectureScore([]).overall).toBe(0);
  });

  it('rolls subsystem scores into the fleet mean + passing count', () => {
    const a = architectureScore([mk('luna', 100, 'pass'), mk('cis', 60, 'fail', [crit])]);
    expect(a.overall).toBe(80); // (100+60)/2
    expect(a.passing).toBe(1);
    expect(a.total).toBe(2);
    expect(a.bySeverity.critical).toBe(1);
  });

  it('subsystems are sorted deterministically', () => {
    const a = architectureScore([mk('zeta', 90, 'pass'), mk('alpha', 80, 'pass')]);
    expect(a.subsystems.map((s) => s.subsystem)).toEqual(['alpha', 'zeta']);
  });

  it('a single subsystem score reflects its severity mix', () => {
    const s = subsystemScore(mk('luna', 40, 'fail', [crit, high]));
    expect(s.bySeverity.critical).toBe(1);
    expect(s.bySeverity.high).toBe(1);
    expect(s.violationCount).toBe(2);
  });
});

describe('score time-series / trend', () => {
  it('a sample is revision-anchored (not wall-clock)', () => {
    const s = toScoreSample(mk('luna', 100, 'pass', [], 'abc123'));
    expect(s.revision).toBe('abc123');
    expect(s.subsystem).toBe('luna');
  });

  it('summarizes a trend: delta positive = improving', () => {
    const series = [
      toScoreSample(mk('luna', 60, 'fail', [crit], 'r1')),
      toScoreSample(mk('luna', 80, 'fail', [high], 'r2')),
      toScoreSample(mk('luna', 100, 'pass', [], 'r3')),
    ];
    const t = trendSummary(series);
    expect(t).toHaveLength(1);
    expect(t[0].first).toBe(60);
    expect(t[0].last).toBe(100);
    expect(t[0].delta).toBe(40); // improving
    expect(t[0].min).toBe(60);
    expect(t[0].max).toBe(100);
  });

  it('empty series → []', () => {
    expect(trendSummary([])).toEqual([]);
  });
});

describe('Top-Violations rollup', () => {
  it('ranks by total severity weight (impact), deterministic', () => {
    const reports = [
      mk('luna', 40, 'fail', [crit, high]),
      mk('cis', 60, 'fail', [crit]),
    ];
    const top = topViolations(reports);
    // no-openai (critical, count 2, weight 80) ranks above no-register (high, count 1, weight 20)
    expect(top[0].constraintId).toBe('no-openai');
    expect(top[0].count).toBe(2);
    expect(top[0].weight).toBe(80);
    expect(top[0].subsystems).toEqual(['cis', 'luna']);
    expect(top[1].constraintId).toBe('no-register');
  });

  it('respects the limit', () => {
    expect(topViolations([mk('a', 40, 'fail', [crit, high])], 1)).toHaveLength(1);
  });

  it('no violations → empty feed', () => {
    expect(topViolations([mk('luna', 100, 'pass')])).toEqual([]);
  });
});
