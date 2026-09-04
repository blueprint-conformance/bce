import { describe, expect, it } from 'vitest';
import { classifyPolicyChanges, type FileChange, type PolicyChangeClass } from '../src/policy-change.js';

function blueprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: {
      id: 'review-gate', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward',
    },
    intentRefs: ['intent/review-gate'],
    scope: { repositories: ['example/repo'], paths: ['src/**', 'tests/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [
      { id: 'no-secret', type: 'forbiddenPattern', severity: 'high', pattern: 'SECRET', path: 'src/**' },
      {
        id: 'egress',
        type: 'forbiddenEgress',
        severity: 'critical',
        from: '*',
        governedHosts: ['gateway.internal'],
        egressCallees: ['customFetch'],
      },
    ],
    evidenceRequirements: [
      { type: 'staticAst', required: true, onMissing: 'block', freshnessSeconds: 60, minimumCoverage: 0.9 },
    ],
    approvals: [{ role: 'maintainer', stage: 'ratify' }, { role: 'security', stage: 'approve' }],
    extraction: { profile: 'plugin-surface', paths: ['src/**', 'tests/**'], minFiles: 10 },
    minEngineVersion: '0.1.5',
    ...overrides,
  };
}

function policyChange(before: Record<string, unknown>, after: Record<string, unknown>): FileChange {
  return {
    path: '.blueprints/review.blueprint.json',
    before: JSON.stringify(before),
    after: JSON.stringify(after),
  };
}

function mutate(mutator: (candidate: Record<string, any>) => void): FileChange {
  const before = blueprint();
  const after = structuredClone(before) as Record<string, any>;
  mutator(after);
  return policyChange(before, after);
}

function expectClass(change: FileChange, classification: PolicyChangeClass): ReturnType<typeof classifyPolicyChanges> {
  const report = classifyPolicyChanges([change]);
  expect(report.classification).toBe(classification);
  return report;
}

describe('policy semantic-change security gate', () => {
  it('uses the four semantic classes and treats non-policy or semantic no-op edits as neutral', () => {
    expectClass({ path: 'src/unrelated-ui.ts', before: 'a', after: 'b' }, 'neutral');
    const same = blueprint();
    expectClass({
      path: '.blueprints/review.blueprint.json',
      before: JSON.stringify(same),
      after: JSON.stringify(same, null, 2),
    }, 'neutral');
    expect(classifyPolicyChanges([])).toMatchObject({
      classification: 'neutral', humanOwnerReviewRequired: false, approvalBlocked: false,
    });
  });

  it('detects enforced-to-advisory as relaxation and the inverse as tightening', () => {
    expectClass(
      { path: '.bce-mode.json', before: '{"mode":"enforced"}', after: '{"mode":"advisory"}' },
      'relaxation',
    );
    expectClass(
      { path: '.bce-mode.json', before: '{"mode":"advisory"}', after: '{"mode":"enforced"}' },
      'tightening',
    );
  });

  it('detects constraint removal, severity reduction, and argument/pattern/path changes', () => {
    expectClass(mutate((after) => after.constraints.pop()), 'relaxation');
    expectClass(mutate((after) => { after.constraints[0].severity = 'low'; }), 'relaxation');
    expectClass(mutate((after) => { after.constraints[0].pattern = 'TOKEN'; }), 'unknown-potential-relaxation');
    expectClass(mutate((after) => { after.constraints[0].path = 'lib/**'; }), 'unknown-potential-relaxation');
    expectClass(mutate((after) => { after.constraints[1].from = 'service'; }), 'unknown-potential-relaxation');
    expectClass(mutate((after) => { after.constraints[0].severity = 'critical'; }), 'tightening');
    expectClass(
      mutate((after) => after.constraints.push({ id: 'new', type: 'forbiddenFile', severity: 'high', path: '.env' })),
      'tightening',
    );
  });

  it('detects repository/scope narrowing and lower minFiles', () => {
    expectClass(mutate((after) => after.scope.repositories.push('example/second')), 'tightening');
    expectClass(mutate((after) => { after.scope.repositories = []; }), 'relaxation');
    expectClass(mutate((after) => after.scope.paths.pop()), 'relaxation');
    expectClass(mutate((after) => { delete after.scope.paths; }), 'tightening');
    expectClass(mutate((after) => { after.extraction.minFiles = 9; }), 'relaxation');
    expectClass(mutate((after) => { after.extraction.minFiles = 11; }), 'tightening');
  });

  it('blocks ambiguous extractor, profile, and configuration changes', () => {
    const changes = [
      mutate((after) => { after.extraction.profile = 'next-route-handler'; }),
      mutate((after) => after.extraction.paths.pop()),
      mutate((after) => { after.extraction.guardSymbols = ['requireTenantAccess']; }),
      mutate((after) => { after.extraction.forbiddenImports = ['provider-sdk']; }),
    ];
    for (const change of changes) {
      const report = expectClass(change, 'unknown-potential-relaxation');
      expect(report.approvalBlocked).toBe(true);
    }
  });

  it('detects egress allowlist expansion and forbidden-host or detector removal', () => {
    expectClass(mutate((after) => after.constraints[1].governedHosts.push('provider.example')), 'relaxation');
    expectClass(mutate((after) => { after.constraints[1].governedHosts = ['gateway.internal', 'second.internal']; }), 'relaxation');

    const blocklist = blueprint({
      constraints: [{
        id: 'egress',
        type: 'forbiddenEgress',
        severity: 'critical',
        to: 'api.one.example',
        forbiddenEgressHosts: ['api.two.example'],
        egressCallees: ['customFetch'],
      }],
    });
    const removedHost = structuredClone(blocklist) as Record<string, any>;
    removedHost.constraints[0].forbiddenEgressHosts = [];
    expectClass(policyChange(blocklist, removedHost), 'relaxation');
    const removedTo = structuredClone(blocklist) as Record<string, any>;
    delete removedTo.constraints[0].to;
    expectClass(policyChange(blocklist, removedTo), 'relaxation');
    const removedCallee = structuredClone(blocklist) as Record<string, any>;
    removedCallee.constraints[0].egressCallees = [];
    expectClass(policyChange(blocklist, removedCallee), 'relaxation');
  });

  it('detects required-evidence optionality and missing-evidence weakening', () => {
    expectClass(mutate((after) => { after.evidenceRequirements[0].required = false; }), 'relaxation');
    expectClass(mutate((after) => { after.evidenceRequirements[0].onMissing = 'warn'; }), 'relaxation');
    expectClass(mutate((after) => after.evidenceRequirements.splice(0, 1)), 'relaxation');
    expectClass(mutate((after) => { after.evidenceRequirements[0].minimumCoverage = 0.8; }), 'relaxation');
    expectClass(mutate((after) => { after.evidenceRequirements[0].freshnessSeconds = 120; }), 'relaxation');
  });

  it('detects approval removal and role/stage weakening as relaxation', () => {
    expectClass(mutate((after) => after.approvals.pop()), 'relaxation');
    expectClass(mutate((after) => { after.approvals[0].role = 'contributor'; }), 'relaxation');
    expectClass(mutate((after) => { after.approvals[0].stage = 'propose'; }), 'relaxation');
    expectClass(mutate((after) => after.approvals.push({ role: 'legal', stage: 'ratify' })), 'tightening');
  });

  it('detects baseline creation/growth and recognizes shrink/removal as tightening', () => {
    expectClass({ path: '.blueprints/baseline.json', after: '{"entries":[]}' }, 'relaxation');
    expectClass(
      { path: '.blueprints/baseline.json', before: '{"entries":[]}', after: '{"entries":[{"id":"x"}]}' },
      'relaxation',
    );
    expectClass(
      { path: '.blueprints/baseline.json', before: '{"entries":[{"id":"x"}]}', after: '{"entries":[]}' },
      'tightening',
    );
    expectClass({ path: '.blueprints/baseline.json', before: '{"entries":[{"id":"x"}]}' }, 'tightening');
  });

  it('protects workflow, engine-pin, skill, MCP, evaluator, and policy-file protection changes', () => {
    const protectedMutations: FileChange[] = [
      { path: '.github/workflows/ci.yml', before: 'required: true', after: 'required: false' },
      {
        path: '.engine-pin.json',
        before: '{"pin":"0.1.5","range":false,"published":true}',
        after: '{"pin":"0.1.6","range":false,"published":true}',
      },
      { path: 'skills/bce/SKILL.md', before: 'read only', after: 'may write' },
      { path: 'src/mcp-server.ts', before: 'readOnly()', after: 'writePolicy()' },
      { path: 'src/report.ts', before: 'failClosed()', after: 'return pass' },
      { path: 'src/index.ts', before: 'export readOnly', after: 'export writePolicy' },
      { path: 'src/extractors.ts', before: 'bounded extraction', after: 'skip files' },
      { path: 'src/extractor-registry.ts', before: 'registered extractor', after: 'dynamic extractor' },
      { path: 'src/python-extractor.ts', before: 'parse source', after: 'return empty graph' },
      { path: 'src/graph.ts', before: 'strict graph', after: 'accept unknown graph' },
      { path: 'src/teeth-waiver.ts', before: 'reviewed waiver', after: 'automatic waiver' },
      { path: 'src/safe-regex.ts', before: 'reject unsafe', after: 'accept unsafe' },
      { path: 'src/observations.ts', before: 'validate evidence', after: 'trust evidence' },
      { path: 'src/runtime-identity.ts', before: 'bind toolchain', after: 'omit toolchain' },
      { path: 'AGENTS.md', before: 'human authority', after: 'assistant may approve' },
      { path: 'CLAUDE.md', before: 'human authority', after: 'assistant may approve' },
      { path: '.cursorrules', before: 'human authority', after: 'assistant may approve' },
      { path: 'AGENTS.bce.md', before: 'human authority', after: 'assistant may approve' },
      { path: 'CODEOWNERS', before: '/.blueprints/** @owners', after: '/src/** @owners' },
      { path: 'docs/CODEOWNERS', before: '/.blueprints/** @owners', after: '/src/** @owners' },
    ];
    for (const mutation of protectedMutations) {
      const report = classifyPolicyChanges([mutation]);
      expect(['relaxation', 'unknown-potential-relaxation']).toContain(report.classification);
      expect(report.approvalBlocked || report.classification === 'relaxation').toBe(true);
    }
  });

  it('classifies deletion of protected machinery as relaxation', () => {
    for (const protectedPath of [
      '.github/workflows/self-gate.yml', '.engine-pin.json', 'skills/bce/SKILL.md',
      'src/mcp-server.ts', 'src/score.ts', 'src/index.ts', 'src/extractors.ts',
      'src/extractor-registry.ts', 'src/python-extractor.ts', 'src/graph.ts', 'src/teeth-waiver.ts',
      'src/safe-regex.ts', 'src/observations.ts', 'src/runtime-identity.ts',
      'AGENTS.md', 'CLAUDE.md', '.cursorrules', 'AGENTS.bce.md', 'CODEOWNERS', 'docs/CODEOWNERS',
    ]) {
      const before = protectedPath === '.engine-pin.json' ? '{"pin":"0.1.5"}' : 'protected';
      expectClass({ path: protectedPath, before }, 'relaxation');
    }
  });

  it('makes invalid or unsupported protected changes blocking unknowns with no override input', () => {
    const report = expectClass(
      { path: '.blueprints/review.blueprint.json', before: JSON.stringify(blueprint()), after: '{not-json' },
      'unknown-potential-relaxation',
    );
    expect(report).toMatchObject({ humanOwnerReviewRequired: true, approvalBlocked: true });
    expect(report.changes[0]).toMatchObject({ approvalBlocked: true });
  });

  it('preserves known relaxation while retaining the approval block from a simultaneous unknown', () => {
    const report = classifyPolicyChanges([
      mutate((after) => after.constraints.pop()),
      { path: 'src/mcp-server.ts', before: 'readOnly()', after: 'unknown change' },
    ]);
    expect(report.classification).toBe('relaxation');
    expect(report.approvalBlocked).toBe(true);
  });

  it('normalizes paths and produces deterministic results and reasons', () => {
    const changes: FileChange[] = [
      {
        path: '.blueprints\\baseline.json',
        before: '{"entries":[]}',
        after: '{"entries":[{"id":"b"},{"id":"a"}]}',
      },
      mutate((after) => { after.constraints[0].severity = 'low'; }),
    ];
    const first = classifyPolicyChanges(changes);
    expect(first).toEqual(classifyPolicyChanges(structuredClone(changes)));
    expect(first.changes[0]?.path).toBe('.blueprints/baseline.json');
    expect(first.changes[0]?.reasons.join(' ')).toContain('a, b');
  });

  it('covers every required weakening mutation with relaxation or a blocking unknown', () => {
    const weakeningCorpus: Array<[string, FileChange]> = [
      ['constraint removal', mutate((after) => after.constraints.pop())],
      ['severity reduction', mutate((after) => { after.constraints[0].severity = 'info'; })],
      ['argument change', mutate((after) => { after.constraints[1].from = 'narrower'; })],
      ['pattern change', mutate((after) => { after.constraints[0].pattern = 'DIFFERENT'; })],
      ['path change', mutate((after) => { after.constraints[0].path = 'narrow/**'; })],
      ['repository removal', mutate((after) => after.scope.repositories.pop())],
      ['scope narrowing', mutate((after) => after.scope.paths.pop())],
      ['lower minFiles', mutate((after) => { after.extraction.minFiles = 1; })],
      ['allowlist expansion', mutate((after) => after.constraints[1].governedHosts.push('public.example'))],
      ['required evidence optional', mutate((after) => { after.evidenceRequirements[0].required = false; })],
      ['missing evidence warn', mutate((after) => { after.evidenceRequirements[0].onMissing = 'warn'; })],
      ['approval removal', mutate((after) => after.approvals.pop())],
      ['extractor change', mutate((after) => { after.extraction.profile = 'next-route-handler'; })],
      ['enforced to advisory', { path: '.bce-mode.json', before: '{"mode":"enforced"}', after: '{"mode":"advisory"}' }],
      ['baseline creation', { path: '.blueprints/baseline.json', after: '{"entries":[]}' }],
      ['workflow weakening', { path: '.github/workflows/self-gate.yml', before: 'run: gate', after: 'run: echo pass' }],
      ['engine pin weakening', { path: '.engine-pin.json', before: '{"range":false,"published":true}', after: '{"range":true,"published":true}' }],
      ['skill weakening', { path: 'skills/bce/SKILL.md', before: 'MUST gate', after: 'may gate' }],
      ['MCP weakening', { path: 'src/mcp-server.ts', before: 'read only', after: 'write enabled' }],
      ['evaluator weakening', { path: 'src/score.ts', before: 'fail closed', after: 'pass' }],
      ['protection weakening', { path: 'CODEOWNERS', before: '/.blueprints/** @owners', after: '' }],
    ];

    for (const [name, mutation] of weakeningCorpus) {
      const report = classifyPolicyChanges([mutation]);
      expect(
        report.classification === 'relaxation' ||
          (report.classification === 'unknown-potential-relaxation' && report.approvalBlocked),
        name,
      ).toBe(true);
    }
  });
});
