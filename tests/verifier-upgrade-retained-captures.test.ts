import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { compare, digest, loadCapture, stable } from '../examples/verifier-upgrade/compare.mjs';

// Actual historical b47 observations, not a claim about the current candidate.
// No historical package is downloaded or executed.
// The comparator consumes complete reconstructed evidence, not expected verdict stubs.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/verifier-upgrade-retained-captures.json', import.meta.url), 'utf8'));
const names = ['direct-release', 'direct-candidate', 'bounded-release', 'bounded-candidate'] as const;
type CaptureName = typeof names[number];
function admission(side: 'release' | 'candidate') {
  return { artifact: fixture.artifacts[fixture.admissions[side].artifactRef], provenance: fixture.admissions[side].provenance };
}
function capture(name: CaptureName) {
  const record = structuredClone(fixture.captures[name]);
  for (const key of ['artifact', 'artifactAfter']) record.receipt[key] = structuredClone(fixture.artifacts[record.receipt[key]]);
  for (const key of ['before', 'after']) record.receipt[key] = structuredClone(fixture.sources[record.receipt[key]]);
  return { receipt: record.receipt, ...(record.bundle ? { bundle: record.bundle } : {}), ...(record.report ? { report: record.report } : {}) };
}
function writeCapture(root: string, name: CaptureName) {
  const directory = path.join(root, name), value = capture(name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'capture.json'), stable(value.receipt));
  for (const key of ['bundle', 'report'] as const) {
    if (value[key]) fs.writeFileSync(path.join(directory, key + '.json'), stable(value[key]));
  }
  return directory;
}
function compareCli(base: CaptureName, candidate: CaptureName) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-retained-upgrade-'));
  try {
    const before = writeCapture(scratch, base), after = writeCapture(scratch, candidate);
    const admissions = ['release', 'candidate'].map(side => {
      const file = path.join(scratch, side + '.json');
      fs.writeFileSync(file, stable(admission(side as 'release' | 'candidate')));
      return file;
    });
    const result = spawnSync(process.execPath, ['examples/verifier-upgrade/compare.mjs', before, after, ...admissions], { encoding: 'utf8', timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe('');
    return { exit: result.status, comparison: JSON.parse(result.stdout) };
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
}

describe('retained released 0.6.0 versus candidate observations', () => {
  it('retains complete evidence and makes path redactions and lossless references explicit', () => {
    expect(fixture.artifacts.release.version).toBe('0.6.0');
    expect(fixture.artifacts.release.tarballSha256).toBe('00402da4120288abd6d97557bc643d40facad3b86fcc727fc5ec452cb0a6780a');
    expect(fixture.artifacts.candidate.version).toBe('0.6.1');
    expect(fixture.artifacts.candidate.tarballSha256).toBe('9f41bd06a0d3c3667b44212007211e6f1707e7d39dafa95e043a7acf2165b93d');
    expect(fixture.candidateSource.candidateCommit).toBe('b47ece0c8515a04fc4e430b55060c41c13df71db');
    expect(fixture.candidateSource.candidateTree).toBe('5b1c35bb46713ac7f15a9b839e951b43b61e44a3');
    expect(fixture.recordedAt).toBe('2026-11-01T19:32:41.978841+00:00');
    for (const name of names) {
      const value = capture(name), record = fixture.captures[name];
      expect(digest(value.receipt)).toBe(record.projectedReceiptSha256);
      expect(value.receipt.before).toEqual(value.receipt.after);
      expect(value.receipt.artifact).toEqual(value.receipt.artifactAfter);
      expect(value.receipt.artifact).toEqual(admission(name.endsWith('release') ? 'release' : 'candidate').artifact);
      expect(record.captureCliExit).toBe(0); // Attempt recorded; the verifier's exit is retained separately.
      expect(value.receipt.process.exit).toBe(1);
      expect(value.receipt.before.expectedModules).toEqual(['packages/app/api.ts', 'packages/domain/model.ts']);
      expect(record.originalFiles['capture.json']).toMatch(/^[0-9a-f]{64}$/);
      expect(fixture.projection.redactedFields[name].length).toBeGreaterThan(0);
      for (const key of ['bundle', 'report'] as const) {
        if (value[key]) expect(digest(value[key])).toBe(record.originalFiles[key + '.json']);
      }
    }
  });

  it('compares the actual complete direct captures and preserves their common violation', () => {
    const before = capture('direct-release'), after = capture('direct-candidate');
    expect(before.receipt.before).toEqual(after.receipt.before);
    expect(before.bundle.artifacts).toEqual(after.bundle.artifacts);
    // Both actual engines omit this optional field when there are no unresolved imports.
    expect(before.bundle.artifacts.graph.coverage).not.toHaveProperty('unresolvedImports');
    expect(before.report.violations).toHaveLength(1);
    expect(before.report.violations[0]).toMatchObject({ constraintId: 'domain-cannot-import-app', evidenceRef: 'packages/domain/model.ts#L1' });
    expect(before.bundle.artifacts.graph.components).toHaveLength(2);
    expect(before.bundle.artifacts.graph.guardEdges).toHaveLength(1);
    const result = compare(before, after, admission('release'), admission('candidate'));
    expect(result).toMatchObject({ status: 'equivalent-observations', artifactIdentityChanged: true, baseExit: 1, candidateExit: 1,
      sections: { report: false, graph: false, coverage: false, components: false, dependencies: false } });
    expect(compareCli('direct-release', 'direct-candidate')).toEqual({ exit: 0, comparison: result });
  });

  it('keeps the actual bounded-policy release refusal incomparable rather than calling it a removed violation', () => {
    const before = capture('bounded-release'), after = capture('bounded-candidate');
    expect(before.receipt.before).toEqual(after.receipt.before);
    expect(before.receipt.process.stderr).toContain('blueprint failed schema validation');
    expect(before.receipt.before.policy.constraints[1]).toMatchObject({ type: 'forbiddenDependencyPath', maxHops: 2 });
    expect(before).not.toHaveProperty('bundle');
    expect(before).not.toHaveProperty('report');
    expect(after.report.violations).toHaveLength(1);
    expect(after.report.violations[0]).toMatchObject({ constraintId: 'domain-cannot-import-app', evidenceRef: 'packages/domain/model.ts#L1' });
    expect(after.report.violations[0].observed).toContain('1 hop');
    expect(compare(after, after, admission('candidate'), admission('candidate')).status).toBe('equivalent-observations');
    const result = compare(before, after, admission('release'), admission('candidate'));
    expect(result.status).toBe('incomparable');
    expect(result.refusals.some((reason: string) => reason.startsWith('base:'))).toBe(true);
    expect(result).not.toHaveProperty('sections');
    const cli = compareCli('bounded-release', 'bounded-candidate');
    expect(cli.exit).toBe(2);
    expect(cli.comparison.status).toBe('incomparable');
    // loadCapture must preserve the real absence instead of manufacturing a passing report.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-retained-refusal-'));
    try { expect(() => loadCapture(writeCapture(scratch, 'bounded-release'))).toThrow(); }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  });

  it('detects changed observations and refuses incomplete graphs even when counterfactual data is rehashed', () => {
    const before = capture('direct-release'), changed = capture('direct-candidate');
    const rehash = (value: ReturnType<typeof capture>) => {
      for (const key of ['blueprint', 'graph', 'report']) value.bundle.hashes[key] = digest(value.bundle.artifacts[key]);
      const { bundle: ignored, ...hashes } = value.bundle.hashes; void ignored;
      value.bundle.hashes.bundle = digest({ ...value.bundle, hashes });
      value.report = structuredClone(value.bundle.artifacts.report);
    };
    changed.bundle.artifacts.report.violations = [];
    changed.bundle.artifacts.report.score = 100;
    changed.bundle.artifacts.report.verdict = 'pass';
    changed.receipt.process.exit = 0;
    rehash(changed);
    expect(compare(before, changed, admission('release'), admission('candidate'))).toMatchObject({
      status: 'changed-observations', sections: { report: true, graph: false }, baseExit: 1, candidateExit: 0,
    });
    changed.bundle.artifacts.graph.components.pop();
    rehash(changed);
    expect(compare(before, changed, admission('release'), admission('candidate')).status).toBe('incomparable');
  });
});
