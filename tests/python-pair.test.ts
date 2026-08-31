/**
 * The Python RED/GREEN discriminating pair at the GATE level (B1-WO-03) — one blueprint, four
 * trees, verdicts by the same runGate() path CI drives: GREEN (pass, score 100) on the
 * conformant tree; RED (fail, the exact seeded constraint named) on each drift tree. Plus the
 * profile's LOUD egress refusal: a forbiddenEgress python blueprint is refused, never silently
 * scored on a surface that cannot observe egress.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGate } from '../src/gate.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const surface = (name: string): string => path.join(FIXROOT, 'python-surface', name);

/** a blueprint dir holding ONLY the python-service blueprint (full-sweep gate mode). */
const blueprintDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-py-bp-'));
  fs.copyFileSync(
    path.join(FIXROOT, 'python-service.blueprint.json'),
    path.join(dir, 'python-service.blueprint.json'),
  );
  return dir;
};

describe('python-surface RED/GREEN discriminating set (gate-level)', () => {
  it('GREEN: conformant passes at score 100', () => {
    const result = runGate(surface('conformant'), blueprintDir(), null, 'ast');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]!.verdict).toBe('pass');
    expect(result.reports[0]!.score).toBe(100);
    expect(result.reports[0]!.coverage.extractor).toBe('line-scan'); // the disclosed single provider
  });

  const RED: Array<[tree: string, constraintId: string]> = [
    ['drift-forbidden-import', 'no-direct-provider-sdk'],
    ['drift-secrets-file', 'no-committed-secrets-module'],
    ['drift-hardcoded-key', 'no-hardcoded-provider-key'],
  ];
  for (const [tree, constraintId] of RED) {
    it(`RED: ${tree} fails naming ${constraintId}`, () => {
      const result = runGate(surface(tree), blueprintDir(), null, 'ast');
      expect(result.reports).toHaveLength(1);
      expect(result.reports[0]!.verdict).toBe('fail');
      expect(result.reports[0]!.violations.some((v) => v.constraintId === constraintId)).toBe(true);
    });
  }

  it('kind flag is inert for this profile: line-scan produces the identical report', () => {
    const ast = runGate(surface('drift-forbidden-import'), blueprintDir(), null, 'ast');
    const ls = runGate(surface('drift-forbidden-import'), blueprintDir(), null, 'line-scan');
    expect(ast.reports).toEqual(ls.reports);
  });

  it('REFUSAL: a forbiddenEgress python blueprint is refused LOUD (never silently scored)', () => {
    const dir = blueprintDir();
    const bpPath = path.join(dir, 'python-service.blueprint.json');
    const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8'));
    bp.constraints.push({
      id: 'no-provider-egress',
      type: 'forbiddenEgress',
      severity: 'critical',
      from: '*',
      to: 'api.openai.com',
      policyRef: 'policy/gateway-choke-point',
    });
    fs.writeFileSync(bpPath, JSON.stringify(bp));
    const result = runGate(surface('conformant'), dir, null, 'ast');
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0]!.verdict).toBe('fail');
    expect(result.reports[0]!.summary).toContain('not supported by the python-import-surface profile');
  });
});
