import { expect, it } from 'vitest';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { buildSourceReviewProof } from '../src/extractor-teeth.js';
import { parseBlueprint } from '../src/schema.js';
it('graph teeth never credits selected-stack constraints without stack source mutation evidence', () => {
  const blueprint = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'stack', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' },
    minEngineVersion: '0.5.0', intentRefs: ['intent:test'], scope: { repositories: ['test'] }, architecture: { components: [], relationships: [] },
    stack: { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] },
    constraints: [{ id: 'no-old', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }],
    evidenceRequirements: [{ type: 'declaredStack', required: true, onMissing: 'block' }], approvals: [{ role: 'owner', stage: 'ratify' }],
  });
  const report = assessTeeth(blueprint, { schemaVersion: '1', ctRepoRevision: 'test', components: [], guardEdges: [], coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] } });
  expect(report.witnesses[0]?.verdict).toBe(ConstraintTeeth.INDETERMINATE);
  expect(report.verdict).toBe('toothless');
  expect(() => buildSourceReviewProof('.', blueprint, {})).toThrow('source review proof refused: graph-only');
});

it('inspection names the selected-source lens and graph-only review refuses certification', async () => {
  const { explainConstraint, buildReviewPacket } = await import('../src/review.js');
  const { materialize } = await import('../src/materializer.js');
  const { makeProposalFixture } = await import('./review-fixture.js');
  const proposal = makeProposalFixture();
  const constraint = { id: 'forbid', type: 'forbiddenStackPackage' as const, severity: 'high' as const, packageName: 'legacy-package' };
  proposal.candidate.constraints = [constraint];
  proposal.candidate.minEngineVersion = '0.5.0';
  proposal.candidate.stack = { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] };
  const explanation = explainConstraint({ constraint, blueprint: proposal.candidate });
  expect(explanation.lens.summary).toContain('declared-stack provider');
  expect(explanation.lens.matchedScope).toEqual(['package-lock.json', 'package.json']);
  expect(explanation.proof.gradeability).toBe('unsupported');
  // Deliberately omit irrelevant graph/identity fields: the unsupported evidence boundary must
  // refuse before constructing or certifying a graph-only packet.
  expect(() => buildReviewPacket({ proposal } as Parameters<typeof buildReviewPacket>[0])).toThrow('review packet refused: declared-stack');
  expect(() => materialize(proposal.candidate, {} as Parameters<typeof materialize>[1])).toThrow('materialization refused: declared-stack');
});
