/**
 * conformance-vectors.test.ts — the reference engine passes 100% of its own vectors.
 *
 * spec/conformance-vectors/vectors.json is the portable (blueprint, tree) → expected-verdict
 * data artifact; scripts/run-conformance-vectors.ts is the reference engine's self-runner
 * over it (real CLI child processes, real exit codes). This test wires that runner into
 * the every-push suite so a change that breaks ANY vector — verdict, exit code, clean-green
 * discipline, or catching the WRONG defect — is a red build, not a stale data file.
 *
 * Honesty legs:
 *  - the 100% assertion is over REAL engine executions (nothing mocked, nothing synthetic);
 *  - the negative cases prove the ASSESSMENT ITSELF can fail — a runner that cannot report
 *    a failure would make the 100% claim vacuous;
 *  - the structural leg proves the data file's own declared counts match its list
 *    (loadVectorsFile is fail-closed and would throw on drift).
 */
import { describe, it, expect } from 'vitest';
import {
  loadVectorsFile,
  runAllVectors,
  assessVector,
  type ConformanceVector,
  type VectorOutcome,
} from '../scripts/run-conformance-vectors.js';
import type { ComplianceReport } from '../src/report.js';

describe('conformance vectors — data-file integrity', () => {
  it('vectors.json loads fail-closed: counts match the list, ids unique, all paths exist', () => {
    const vf = loadVectorsFile();
    expect(vf.vectors.length).toBeGreaterThan(0);
    expect(vf.counts.vectors).toBe(vf.vectors.length);
    // every enforced red constraint type is represented (the vectors README's coverage claim)
    const redTypes = new Set(vf.vectors.filter((v) => v.expectedVerdict === 'fail').map((v) => v.constraintType));
    for (const t of [
      'forbiddenDependency',
      'requiredDependency',
      'forbiddenEgress',
      'forbiddenPath',
      'forbiddenFile',
      'forbiddenPattern',
      'requiredComponent',
      'behavioralInvariant',
    ]) {
      expect(redTypes, `enforced constraint type '${t}' must have a red vector`).toContain(t);
    }
  });
});

describe('conformance vectors — the reference engine vs its own vectors', () => {
  it('passes 100% of the vectors (real CLI child processes, real exit codes)', { timeout: 120_000 }, () => {
    const { assessments, allOk } = runAllVectors();
    const failed = assessments.filter((a) => !a.ok);
    expect(
      allOk,
      `vector failures:\n${failed.map((a) => `  ${a.id}: ${a.failures.join('; ')}`).join('\n')}`,
    ).toBe(true);
    expect(assessments.length).toBe(loadVectorsFile().counts.vectors);
  });
});

describe('conformance vectors — the assessment can fail (a check that cannot go red is not a check)', () => {
  const greenVector: ConformanceVector = {
    id: 'synthetic-green',
    intent: 'synthetic',
    blueprintRef: 'x@0.1.0',
    blueprintFile: 'fixtures/luna-chat-extension.blueprint.json',
    extractionProfile: 'plugin-surface',
    tree: 'fixtures/extension-surface/conformant',
    extractor: 'ast',
    expectedVerdict: 'pass',
    expectedExitCode: 0,
  };
  const redVector: ConformanceVector = {
    ...greenVector,
    id: 'synthetic-red',
    expectedVerdict: 'fail',
    expectedExitCode: 1,
    constraintId: 'no-direct-provider-sdk',
    constraintType: 'forbiddenDependency',
    expectedSeverity: 'critical',
  };
  const baseReport: ComplianceReport = {
    schemaVersion: '1',
    blueprintRef: 'x@0.1.0',
    ctRepoRevision: 'unpinned',
    score: 100,
    verdict: 'pass',
    violations: [],
    evidenceRef: 'n/a',
    summary: 'synthetic',
  };
  const outcome = (over: Partial<VectorOutcome> & { report?: ComplianceReport | null }): VectorOutcome => ({
    exitCode: 0,
    report: baseReport,
    stdout: '',
    stderr: '',
    ...over,
  });

  it('flags a green vector whose run exited non-zero', () => {
    const a = assessVector(greenVector, outcome({ exitCode: 1 }));
    expect(a.ok).toBe(false);
    expect(a.failures.join(' ')).toContain('exit code 1');
  });

  it('flags a green vector whose report carries violations despite a pass verdict claim', () => {
    const dirty: ComplianceReport = {
      ...baseReport,
      violations: [
        {
          constraintId: 'other',
          severity: 'low',
          component: 'c',
          evidenceType: 'x',
          evidenceRef: 'x',
          observed: 'x',
          expected: 'x',
        },
      ],
    };
    const a = assessVector(greenVector, outcome({ report: dirty }));
    expect(a.ok).toBe(false);
    expect(a.failures.join(' ')).toContain('1 violation(s)');
  });

  it('flags a red vector caught on the WRONG constraint (a coincidental red is not a catch)', () => {
    const wrongConstraint: ComplianceReport = {
      ...baseReport,
      score: 60,
      verdict: 'fail',
      violations: [
        {
          constraintId: 'some-other-constraint',
          severity: 'critical',
          component: 'c',
          evidenceType: 'x',
          evidenceRef: 'x',
          observed: 'x',
          expected: 'x',
        },
      ],
    };
    const a = assessVector(redVector, outcome({ exitCode: 1, report: wrongConstraint }));
    expect(a.ok).toBe(false);
    expect(a.failures.join(' ')).toContain("no violation on constraint 'no-direct-provider-sdk'");
  });

  it('flags a red vector caught below the declared severity floor', () => {
    const belowFloor: ComplianceReport = {
      ...baseReport,
      score: 95,
      verdict: 'fail',
      violations: [
        {
          constraintId: 'no-direct-provider-sdk',
          severity: 'low',
          component: 'c',
          evidenceType: 'x',
          evidenceRef: 'x',
          observed: 'x',
          expected: 'x',
        },
      ],
    };
    const a = assessVector(redVector, outcome({ exitCode: 1, report: belowFloor }));
    expect(a.ok).toBe(false);
    expect(a.failures.join(' ')).toContain('severity floor');
  });

  it('flags a run that emitted no parseable report at all', () => {
    const a = assessVector(greenVector, outcome({ report: null }));
    expect(a.ok).toBe(false);
    expect(a.failures.join(' ')).toContain('no parseable ComplianceReport');
  });
});
