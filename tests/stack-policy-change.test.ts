import { describe, expect, it } from 'vitest';
import { classifyPolicyChanges } from '../src/policy-change.js';
const blueprint = () => ({
  constraints: [{ id: 'runtime', type: 'allowedNodeVersions', severity: 'high', versions: ['22.22.2', '24.8.0'] }],
  evidenceRequirements: [], approvals: [],
  stack: { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: ['Dockerfile'], runtimeFiles: ['.nvmrc'] },
});
function classify(mutate: (after: any) => void) {
  const before = blueprint(); const after = structuredClone(before); mutate(after);
  return classifyPolicyChanges([{ path: '.blueprints/stack.blueprint.json', before: JSON.stringify(before), after: JSON.stringify(after) }]);
}
describe('declared-stack policy direction', () => {
  it('narrows runtime allowlists as tightening and widening as relaxation', () => {
    expect(classify((a) => { a.constraints[0].versions = ['22.22.2']; }).classification).toBe('tightening');
    expect(classify((a) => { a.constraints[0].versions.push('26.0.0'); }).classification).toBe('relaxation');
  });
  it('source removal relaxes, source identity changes remain unknown', () => {
    expect(classify((a) => { a.stack.imageFiles = []; }).classification).toBe('relaxation');
    expect(classify((a) => { a.stack.lockfile = 'npm-shrinkwrap.json'; }).classification).toBe('unknown-potential-relaxation');
    expect(classify((a) => { delete a.stack; }).classification).toBe('relaxation');
  });
  it('invalid empty allowlists and malformed additions are unknown, not tightening', () => {
    expect(classify((a) => { a.constraints[0].versions = []; }).classification).toBe('unknown-potential-relaxation');
    expect(classify((a) => { a.constraints.push({ id: 'pin', type: 'pinnedVersion', severity: 'high' }); }).classification).toBe('unknown-potential-relaxation');
  });
  it('a pin substitution cannot be approved as tightening', () => {
    expect(classify((a) => { a.constraints[0] = { id: 'runtime', type: 'pinnedVersion', severity: 'high', stackTarget: { kind: 'node-runtime', name: 'node' }, expectedVersion: '24.8.0' }; })).toMatchObject({ classification: 'unknown-potential-relaxation', approvalBlocked: true });
  });
});
