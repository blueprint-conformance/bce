/**
 * Two selected blueprint files that share `metadata.id@version` must refuse the gate. The gate pairs
 * each report with its baseline partition by that identity, so with a committed baseline a failing
 * blueprint could otherwise read its passing twin's (empty) new-violation set and exit 0.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeGateReport } from '../src/gate.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function blueprint(forbidden: string) {
  return {
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'shared-identity', version: '0.1.0', status: 'draft' },
    intentRefs: ['intent/shared-identity'],
    scope: { repositories: ['example/repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-forbidden-file', type: 'forbiddenFile', severity: 'critical', path: forbidden }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  };
}

function fixture(withBaseline: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'bce-dup-id-'));
  dirs.push(dir);
  mkdirSync(join(dir, '.blueprints'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'bad.ts'), 'export const bad = 1;\n');
  // Sorts first and fails; the twin sorts last and passes.
  writeFileSync(join(dir, '.blueprints', 'a.blueprint.json'), JSON.stringify(blueprint('src/bad.ts')));
  writeFileSync(join(dir, '.blueprints', 'z.blueprint.json'), JSON.stringify(blueprint('src/absent.ts')));
  if (withBaseline) {
    writeFileSync(join(dir, '.blueprints', 'baseline.json'), JSON.stringify({ schemaVersion: '1', engine: 'bce-engine', entries: [] }));
  }
  return dir;
}

describe('gate refuses duplicate blueprint identities', () => {
  it.each([true, false])('refuses with baseline=%s instead of grading twins by one identity', (withBaseline) => {
    const dir = fixture(withBaseline);
    const { doc } = computeGateReport(dir, join(dir, '.blueprints'), null, 'ast');
    expect(doc).toMatchObject({ outcome: 'refusal', exitCode: 2 });
    expect(JSON.stringify(doc)).toContain('shared-identity@0.1.0');
  });
});
