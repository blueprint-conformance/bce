import { describe, expect, it } from 'vitest';
import { Ajv } from 'ajv';
import type { ComplianceReport } from '../src/report.js';
import { architectureScore, toScoreSample, trendSummary } from '../src/score.js';
import { collectPortfolio } from '../src/portfolio-collect.js';
import { toEvidenceRecord, verifyEvidenceChain } from '../src/emit.js';
import { renderReportJUnit, renderReportMarkdown, renderReportSarif } from '../src/report.js';
import { generateSchemas } from '../scripts/generate-schemas.js';

const refused = (): ComplianceReport => ({
  schemaVersion: '2', blueprintRef: 'contract@1.0.0', ctRepoRevision: 'test', score: null, verdict: 'indeterminate',
  violations: [], evidenceRef: 'unavailable', summary: 'Insufficient selected package evidence',
  coverage: { providers: [{ evidenceClass: 'declaredStack', filesScanned: 0, unsupported: ['missing lockfile'] }] },
  stack: null, refusals: [{ constraintId: 'no-old', evidenceClass: 'declaredStack', code: 'missing-source', reason: 'missing <lockfile>', sources: ['package-lock.json'] }],
});
const passing = (): ComplianceReport => ({
  schemaVersion: '1', blueprintRef: 'code@1.0.0', ctRepoRevision: 'test', score: 100, verdict: 'pass', violations: [],
  evidenceRef: 'graph', summary: 'pass', coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
});

describe('indeterminate consumer semantics', () => {
  it('cannot average a refusal away or manufacture a numeric trend', () => {
    expect(architectureScore([passing(), refused()])).toMatchObject({ overall: null, passing: 1, total: 2 });
    expect(trendSummary([toScoreSample(refused())])).toEqual([{ subsystem: 'contract', samples: 1, first: null, last: null, min: null, max: null, delta: null }]);
    expect(collectPortfolio({ registry: { consumers: [{ repo: 'one' }], governance: { minMembers: 1 } }, reportsByRepo: { one: [passing(), refused()] } })).toMatchObject({ refused: true, reason: expect.stringContaining('insufficient evidence') });
  });
  it('retains refusal in evidence and derives no invented manifest digests', () => {
    const record = toEvidenceRecord(refused());
    expect(record).toMatchObject({ score: null, verdict: 'indeterminate' });
    expect(record).not.toHaveProperty('stackDigest');
    expect(record).not.toHaveProperty('manifestDigest');
    expect(verifyEvidenceChain([record])).toBe(-1);
    const report = refused();
    if (report.schemaVersion !== '2') throw new Error('expected v2');
    report.stack = { stackDigest: 'a'.repeat(64), manifestDigest: 'b'.repeat(64), sourceConfigDigest: 'c'.repeat(64), claim: 'selected-declarations-not-installed-state' };
    expect(toEvidenceRecord(report)).toMatchObject({ stackDigest: 'a'.repeat(64), manifestDigest: 'b'.repeat(64) });
  });
  it('renders refusal as missing evidence, JUnit error, and unsuccessful SARIF execution', () => {
    expect(renderReportMarkdown(refused())).toContain('Score: unavailable (insufficient evidence)');
    expect(renderReportMarkdown(refused())).toContain('Refusal **no-old**');
    expect(renderReportJUnit(refused())).toContain('errors="1"');
    expect(renderReportJUnit(refused())).toContain('<error type="missing-source" message="missing &lt;lockfile&gt;">');
    expect(renderReportSarif(refused())).toMatchObject({ runs: [{ invocations: [{ executionSuccessful: false }], properties: { score: null } }] });
    expect(renderReportSarif(passing())).toMatchObject({ runs: [{ invocations: [{ executionSuccessful: true }] }] });
  });
  it('generated output contracts distinguish v1, v2 and invalid score/refusal combinations', () => {
    const ajv = new Ajv({ strict: false, allowUnionTypes: true });
    const generated = generateSchemas();
    const validate = ajv.compile(generated['compliance-report.schema.json']!);
    expect(validate(passing()), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(refused()), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...refused(), score: 100 })).toBe(false);
    expect(validate({ ...refused(), verdict: 'pass' })).toBe(false);
    expect(validate({ ...refused(), refusals: [] })).toBe(false);
    expect(validate({ ...passing(), schemaVersion: '2' })).toBe(false);
    expect(ajv.compile(generated['evidence-record.schema.json']!)(toEvidenceRecord(refused()))).toBe(true);
  });
});
