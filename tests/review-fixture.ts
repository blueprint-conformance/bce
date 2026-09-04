import { createHash } from 'node:crypto';
import type { ArchitectureGraph } from '../src/graph.js';
import { BlueprintDraftPlanSchema, type BlueprintDraftPlan, type BlueprintReviewPacket } from '../src/review-contracts.js';
import { buildProposalContext, buildReviewPacket, compileDraftPlan } from '../src/review.js';

export const fixtureDigest = (seed: string): string => createHash('sha256').update(seed).digest('hex');

export function makeProposalContextFixture() {
  return buildProposalContext({
    repository: { identity: 'github.com/example/repo', revision: 'revision-1', worktreeDigest: fixtureDigest('tree-1') },
    files: [
      { path: 'src/z.ts', content: 'export const z = 1;\n' },
      { path: 'src/a.ts', content: 'export const a = 1;\n', mediaType: 'text/typescript' },
    ],
    humanIntent: 'The service must expose a governed API component.',
    authoritativeIntentRefs: [
      { ref: 'docs/intent.md', content: '# Intent\nExpose a governed API component.\n' },
    ],
    excluded: { paths: ['vendor/**', 'generated/**'], classes: ['binary', 'secret'] },
  });
}

export function makeDraftPlanFixture(ctx = makeProposalContextFixture()): BlueprintDraftPlan {
  const file = ctx.files.find((item) => item.path === 'src/a.ts')!;
  const source = ctx.authoritativeIntentRefs[0]!;
  return BlueprintDraftPlanSchema.parse({
    schemaVersion: '1',
    kind: 'BlueprintDraftPlan',
    proposalId: 'governed-api',
    contextDigest: ctx.contextDigest,
    metadata: { id: 'governed-api', name: 'Governed API', version: '0.1.0', ownerRole: 'platform-owner' },
    scope: {
      repositories: ['github.com/example/repo'],
      paths: ['src/**'],
      assertions: [
        {
          claim: 'The governed surface is under src.',
          basis: 'observed-fact',
          anchors: [{ kind: 'repository-file', ref: file.path, sha256: file.sha256, lineStart: 1 }],
          uncertainty: { level: 'low', reason: 'Only the disclosed manifest was inspected.' },
          alternatives: ['Use a narrower component directory after repository review.'],
          knownBlindSpots: ['Generated files were excluded.'],
        },
      ],
    },
    architecture: { components: [{ id: 'api', type: 'apiRouteHandler' }], relationships: [] },
    clauses: [
      {
        constraint: { id: 'api-exists', type: 'requiredComponent', severity: 'high', component: 'apiRouteHandler' },
        assertions: [
          {
            claim: 'A governed API component is required by intent.',
            basis: 'source-backed-intent',
            anchors: [{ kind: 'intent-reference', ref: source.ref, sha256: source.sha256, lineStart: 1 }],
            uncertainty: { level: 'none', reason: 'The authoritative intent states this directly.' },
            alternatives: [],
            knownBlindSpots: [],
          },
        ],
      },
    ],
    evidenceRequirements: [],
    approvals: [{ role: 'platform-owner', stage: 'ratify' }],
    extraction: { profile: 'next-route-handler', paths: ['src/**'], minFiles: 1 },
    knownBlindSpots: ['Dynamic runtime behavior is outside this static clause.'],
  });
}

export function makeProposalFixture(
  ctx = makeProposalContextFixture(),
  draftPlan = makeDraftPlanFixture(ctx),
) {
  return compileDraftPlan({
    context: ctx,
    plan: draftPlan,
    promptDigest: fixtureDigest('prompt'),
    generationDigest: fixtureDigest('generation'),
  });
}

export function makeGraphFixture(revision = 'revision-1'): ArchitectureGraph {
  return {
    schemaVersion: '1',
    ctRepoRevision: revision,
    components: [{ id: 'route:api:GET', type: 'apiRouteHandler', path: 'src/a.ts', line: 1 }],
    guardEdges: [],
    coverage: { extractor: 'ast', filesScanned: 2, unsupported: [], scannedFiles: ['src/a.ts', 'src/z.ts'] },
  };
}

export const REVIEW_IDENTITY_FIXTURE = {
  engine: { name: 'bce-engine' as const, version: '0.2.0', artifactDigest: fixtureDigest('engine'), sourceRevision: 'commit-1' },
  extractor: {
    provider: 'typescript-ts-morph',
    kind: 'ast' as const,
    profile: 'next-route-handler' as const,
    version: '0.2.0',
    artifactDigest: fixtureDigest('extractor'),
  },
  toolchain: {
    runtime: 'node',
    version: '22.19.0',
    platform: 'darwin',
    arch: 'arm64',
    packageManager: { name: 'npm' as const, version: '10.8.2' },
    dependencyLockDigest: fixtureDigest('lock'),
  },
};

export function makeReviewerFixture() {
  return {
    id: 'maintainer@example.com',
    authentication: {
      method: 'scm' as const,
      issuer: 'https://github.com',
      subject: 'github:maintainer',
      assertionDigest: fixtureDigest('review-assertion'),
      reference: 'https://github.com/example/repo/pull/1#pullrequestreview-1',
    },
  };
}

export function makeReviewFixture(
  overrides: Partial<Parameters<typeof buildReviewPacket>[0]> = {},
): { packet: BlueprintReviewPacket } {
  return {
    packet: buildReviewPacket({
      proposal: makeProposalFixture(),
      baseBlueprint: null,
      graph: makeGraphFixture(),
      repositoryPolicyDiff: {
        baseRef: 'main', baseHeadRevision: 'base-1', baseRevision: 'base-1', complete: true, files: [],
      },
      ...REVIEW_IDENTITY_FIXTURE,
      ...overrides,
    }),
  };
}
