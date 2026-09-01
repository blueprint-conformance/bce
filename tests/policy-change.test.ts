import { describe, expect, it } from 'vitest';
import { classifyPolicyChanges } from '../src/policy-change.js';

describe('policy change classifier', () => {
  it('separates code repair, policy edits, and semantic relaxation', () => {
    expect(classifyPolicyChanges([{ path: 'src/report.ts', before: 'a', after: 'b' }]).classification).toBe('code-repair');
    expect(classifyPolicyChanges([{ path: 'GOVERNANCE.md', before: 'a', after: 'b' }]).classification).toBe('policy-change');
    expect(classifyPolicyChanges([{ path: '.bce-mode.json', before: '{"mode":"enforced"}', after: '{"mode":"advisory"}' }])).toMatchObject({
      classification: 'policy-relaxation', humanOwnerReviewRequired: true,
    });
  });

  it('detects baseline growth and blueprint constraint removal/severity lowering', () => {
    const baseline = classifyPolicyChanges([{ path: '.blueprints/baseline.json', before: '{"entries":[]}', after: '{"entries":[{"id":"x"}]}' }]);
    expect(baseline.classification).toBe('policy-relaxation');
    const before = { constraints: [{ id: 'keep', severity: 'critical' }, { id: 'remove', severity: 'high' }] };
    const after = { constraints: [{ id: 'keep', severity: 'low' }] };
    const blueprint = classifyPolicyChanges([{ path: '.blueprints/a.blueprint.json', before: JSON.stringify(before), after: JSON.stringify(after) }]);
    expect(blueprint.classification).toBe('policy-relaxation');
    expect(blueprint.changes[0]?.reasons.join(' ')).toContain('constraint removed');
    expect(blueprint.changes[0]?.reasons.join(' ')).toContain('severity lowered');
  });
});
