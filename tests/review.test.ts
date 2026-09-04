import { describe, expect, it } from 'vitest';
import {
  BlueprintDecisionRecordSchema,
  BlueprintProposalSchema,
  BlueprintReviewPacketSchema,
  ProposalContextSchema,
  type BlueprintReviewPacket,
} from '../src/review-contracts.js';
import {
  buildProposalContext,
  buildReviewPacket,
  compareBlueprintPolicy,
  compileDraftPlan,
  inspectBlueprint,
  recordReviewDecision,
  reviewDigest,
  verifyReviewPacket,
} from '../src/review.js';
import { stableStringify } from '../src/report.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import {
  REVIEW_IDENTITY_FIXTURE,
  fixtureDigest,
  makeDraftPlanFixture,
  makeGraphFixture,
  makeProposalContextFixture,
  makeProposalFixture,
  makeReviewerFixture,
  makeReviewFixture,
} from './review-fixture.js';

const hex = fixtureDigest;
const context = makeProposalContextFixture;
const plan = makeDraftPlanFixture;
const proposal = makeProposalFixture;
const graph = makeGraphFixture;
const identity = REVIEW_IDENTITY_FIXTURE;
const reviewer = makeReviewerFixture;
const packet = (overrides: Partial<Parameters<typeof buildReviewPacket>[0]> = {}): BlueprintReviewPacket =>
  makeReviewFixture(overrides).packet;

describe('ProposalContext@1 and BlueprintDraftPlan@1', () => {
  it('builds a canonical bounded context independent of caller list ordering', () => {
    const a = context();
    const b = buildProposalContext({
      repository: a.repository,
      files: [...a.files].reverse().map(({ path, content, mediaType }) => ({
        path,
        content,
        ...(mediaType !== undefined ? { mediaType } : {}),
      })),
      humanIntent: a.humanIntent,
      authoritativeIntentRefs: [...a.authoritativeIntentRefs].reverse().map(({ ref, content }) => ({ ref, content })),
      excluded: { paths: [...a.excluded.paths].reverse(), classes: [...a.excluded.classes].reverse() },
    });
    expect(stableStringify(b)).toBe(stableStringify(a));
    expect(a.files.map((item) => item.path)).toEqual(['src/a.ts', 'src/z.ts']);
    expect(ProposalContextSchema.parse(a)).toEqual(a);
  });

  it('rejects traversal, duplicate disclosure paths, and unknown contract fields', () => {
    expect(() => buildProposalContext({
      repository: { identity: 'example/repo', revision: 'r', worktreeDigest: hex('t') },
      files: [{ path: '../secret', content: 'x' }],
      humanIntent: 'intent',
      authoritativeIntentRefs: [{ ref: 'intent', content: 'intent' }],
      excluded: { paths: [], classes: [] },
    })).toThrow(/repository-relative|traversal/);
    const valid = context();
    expect(() => buildProposalContext({
      repository: valid.repository,
      files: [{ path: 'x.ts', content: 'a' }, { path: 'x.ts', content: 'b' }],
      humanIntent: valid.humanIntent,
      authoritativeIntentRefs: [{ ref: 'intent', content: 'intent' }],
      excluded: { paths: [], classes: [] },
    })).toThrow(/duplicate file paths/);
    expect(ProposalContextSchema.safeParse({ ...valid, surprise: true }).success).toBe(false);
  });

  it('compiles only a draft and refuses anchors outside the content-addressed context', () => {
    const ctx = context();
    const compiled = proposal(ctx, plan(ctx));
    expect(compiled.candidate.metadata.status).toBe('draft');
    const approved = structuredClone(compiled);
    approved.candidate.metadata.status = 'approved';
    expect(BlueprintProposalSchema.safeParse(approved).success).toBe(false);
    expect(compiled.digests.artifact).toBe(reviewDigest(compiled.candidate));
    const bad = structuredClone(plan(ctx));
    bad.clauses[0]!.assertions[0]!.anchors[0]!.sha256 = hex('tampered');
    expect(() => compileDraftPlan({ context: ctx, plan: bad, promptDigest: hex('p'), generationDigest: hex('g') })).toThrow(/anchor digest mismatch/);
    const inventedLine = structuredClone(plan(ctx));
    inventedLine.clauses[0]!.assertions[0]!.anchors[0]!.lineStart = 999;
    expect(() => compileDraftPlan({ context: ctx, plan: inventedLine, promptDigest: hex('p'), generationDigest: hex('g') })).toThrow(/lineStart is outside/);
    const duplicate = structuredClone(plan(ctx));
    duplicate.clauses.push(structuredClone(duplicate.clauses[0]!));
    expect(() => compileDraftPlan({ context: ctx, plan: duplicate, promptDigest: hex('p'), generationDigest: hex('g') })).toThrow(/duplicate constraint id/);
    const mismatchedId = structuredClone(plan(ctx));
    mismatchedId.proposalId = 'different-id';
    expect(() => compileDraftPlan({ context: ctx, plan: mismatchedId, promptDigest: hex('p'), generationDigest: hex('g') })).toThrow(/must equal/);
  });
});

describe('inspection and semantic comparison', () => {
  it('uses Promise / Lens / Proof / Limits for every constraint', () => {
    const candidate = proposal().candidate;
    const inspected = inspectBlueprint({ blueprint: candidate, graph: graph() });
    expect(inspected.clauses).toHaveLength(candidate.constraints.length);
    for (const clause of inspected.clauses) {
      expect(clause.promise).toBeTruthy();
      expect(clause.lens.summary).toBeTruthy();
      expect(clause.proof.summary).toBeTruthy();
      expect(clause.limits.length).toBeGreaterThan(0);
      expect(JSON.parse(clause.canonicalJson)).toEqual(candidate.constraints.find((item) => item.id === clause.constraintId));
    }
  });

  it('classifies every weakening mutation as relaxation or blocking unknown', () => {
    const approved = structuredClone(proposal().candidate);
    approved.metadata.status = 'approved';
    approved.constraints.push({
      id: 'no-provider', type: 'forbiddenEgress', severity: 'critical', governedHosts: ['gateway.internal'], forbiddenEgressHosts: ['api.vendor.test'],
    });
    approved.evidenceRequirements = [{ type: 'scan', required: true, onMissing: 'block', minimumCoverage: 0.9 }];
    approved.approvals.push({ role: 'security-owner', stage: 'ratify' });

    const mutations: Array<[string, (candidate: EngineeringBlueprint) => void]> = [
      ['constraint removal', (c) => { c.constraints = c.constraints.filter((item) => item.id !== 'api-exists'); }],
      ['severity reduction', (c) => { c.constraints[0]!.severity = 'low'; }],
      ['changed argument', (c) => { c.constraints[0]!.component = 'somethingElse'; }],
      ['repository removal', (c) => { c.scope.repositories = ['other/repo']; }],
      ['scope narrowing', (c) => { c.scope.paths = ['src/api/**']; }],
      ['lower minFiles', (c) => { c.extraction!.minFiles = 0 as never; }],
      ['allowlist expansion', (c) => { c.constraints[1]!.governedHosts = ['gateway.internal', 'api.vendor.test']; }],
      ['forbidden host removal', (c) => { c.constraints[1]!.forbiddenEgressHosts = []; }],
      ['evidence optional', (c) => { c.evidenceRequirements[0]!.required = false; }],
      ['missing evidence warn', (c) => { c.evidenceRequirements[0]!.onMissing = 'warn'; }],
      ['approval removed', (c) => { c.approvals = c.approvals.filter((item) => item.role !== 'security-owner'); }],
      ['profile changed', (c) => { c.extraction!.profile = 'plugin-surface'; }],
    ];
    for (const [label, mutate] of mutations) {
      const candidate = structuredClone(approved);
      mutate(candidate);
      // Keep inputs schema-valid where the mutation's semantic value, not schema validation, is under test.
      if (label === 'lower minFiles') candidate.extraction!.minFiles = undefined as never;
      const result = compareBlueprintPolicy({ baseBlueprint: approved, candidateBlueprint: candidate });
      expect(['relaxation', 'unknown-potential-relaxation'], label).toContain(result.classification);
      if (result.classification === 'unknown-potential-relaxation') expect(result.blocksApproval, label).toBe(true);
    }
  });

  it('treats protected workflow, pin, skill, MCP, and evaluator edits as relaxation or blocking unknown', () => {
    const candidate = proposal().candidate;
    const protectedFiles = [
      '.github/workflows/gate.yml', '.engine-pin.json', 'skills/bce/SKILL.md', 'src/mcp-server.ts', 'src/report.ts',
    ];
    for (const path of protectedFiles) {
      const result = compareBlueprintPolicy({ baseBlueprint: candidate, candidateBlueprint: candidate, files: [{ path, before: 'old', after: 'new' }] });
      expect(['relaxation', 'unknown-potential-relaxation'], path).toContain(result.classification);
      expect(result.classification === 'relaxation' || result.blocksApproval, path).toBe(true);
    }
    const mode = compareBlueprintPolicy({
      baseBlueprint: candidate,
      candidateBlueprint: candidate,
      files: [{ path: '.bce-mode.json', before: '{"mode":"enforced"}', after: '{"mode":"advisory"}' }],
    });
    expect(mode.classification).toBe('relaxation');
  });
});

describe('BlueprintReviewPacket@1 and BlueprintDecisionRecord@1', () => {
  it('emits byte-identical packets without time or randomness and replays them successfully', () => {
    const one = packet();
    const two = packet();
    expect(stableStringify(two)).toBe(stableStringify(one));
    expect(stableStringify(one)).not.toContain('decidedAt');
    expect(one.packetDigest).toBe(reviewDigest((({ packetDigest: _ignored, ...body }) => body)(one)));
    expect(one.approval).toMatchObject({ status: 'eligible', blockers: [] });
    expect(one.unsupportedCoverage).toContain('Dynamic runtime behavior is outside this static clause.');
    expect(verifyReviewPacket(one)).toEqual({ valid: true, integrity: 'verified', failures: [] });
    expect(BlueprintReviewPacketSchema.parse(one)).toEqual(one);
  });

  it('detects candidate, packet, graph, and provenance tampering', () => {
    const original = packet();
    const mutations: Array<[string, (copy: BlueprintReviewPacket) => void]> = [
      ['candidate', (copy) => { copy.artifacts.proposal.candidate.metadata.name = 'Tampered'; }],
      ['packet', (copy) => { copy.contract.plainLanguageContract = 'Tampered'; }],
      ['graph', (copy) => { copy.artifacts.graph.components[0]!.path = 'src/z.ts'; }],
      ['provenance', (copy) => { copy.provenance.engineDigest = hex('wrong'); }],
    ];
    for (const [label, mutate] of mutations) {
      const copy = structuredClone(original);
      mutate(copy);
      expect(verifyReviewPacket(copy).valid, label).toBe(false);
    }
  });

  it('records only explicit authenticated decisions and invalidates them when any bound input changes', () => {
    const original = packet();
    const decision = recordReviewDecision({
      packet: original,
      decision: 'approve',
      reviewer: reviewer(),
      satisfiedRequirement: original.approval.requirements[0],
      rationale: 'The packet proves the intended governed component.',
      decidedAt: '2026-09-03T12:00:00.000Z',
    });
    expect(decision.decidedAt).toBe('2026-09-03T12:00:00.000Z');
    expect(decision.binding.packetDigest).toBe(original.packetDigest);
    expect(verifyReviewPacket(original, decision)).toMatchObject({ valid: true, decisionValid: true });
    expect(BlueprintDecisionRecordSchema.parse(decision)).toEqual(decision);

    const changedIdentityPackets = [
      packet({ engine: { ...identity.engine, artifactDigest: hex('engine-2') } }),
      packet({ extractor: { ...identity.extractor, artifactDigest: hex('extractor-2') } }),
      packet({ toolchain: { ...identity.toolchain, dependencyLockDigest: hex('lock-2') } }),
    ];
    // Rebuild through the public constructor so every new packet is internally valid.
    const contextTwo = buildProposalContext({
      repository: { ...context().repository, worktreeDigest: hex('tree-2') },
      files: context().files.map(({ path, content, mediaType }) => ({ path, content, ...(mediaType ? { mediaType } : {}) })),
      humanIntent: context().humanIntent,
      authoritativeIntentRefs: context().authoritativeIntentRefs.map(({ ref, content }) => ({ ref, content })),
      excluded: context().excluded,
    });
    changedIdentityPackets.push(packet({ proposal: proposal(contextTwo, plan(contextTwo)) }));
    const changedCandidatePlan = plan();
    changedCandidatePlan.clauses[0]!.constraint.severity = 'critical';
    changedIdentityPackets.push(packet({ proposal: proposal(context(), changedCandidatePlan) }));
    const prior = context();
    const revisionContext = buildProposalContext({
      repository: { ...prior.repository, revision: 'revision-2' },
      files: prior.files.map(({ path, content, mediaType }) => ({ path, content, ...(mediaType ? { mediaType } : {}) })),
      humanIntent: prior.humanIntent,
      authoritativeIntentRefs: prior.authoritativeIntentRefs.map(({ ref, content }) => ({ ref, content })),
      excluded: prior.excluded,
    });
    changedIdentityPackets.push(packet({
      proposal: proposal(revisionContext, plan(revisionContext)),
      graph: graph('revision-2'),
    }));

    for (const changed of changedIdentityPackets) {
      expect(verifyReviewPacket(changed).valid).toBe(true);
      expect(verifyReviewPacket(changed, decision)).toMatchObject({ valid: false, decisionValid: false });
    }
  });

  it('binds and classifies the protected repository diff and blocks an incomplete base', () => {
    const weakened = packet({
      repositoryPolicyDiff: {
        baseRef: 'main', baseHeadRevision: 'base-1', baseRevision: 'base-1', complete: true,
        files: [{ path: '.github/CODEOWNERS', before: '*.ts @security\n', after: '*.ts @security\n*.ts @everyone\n' }],
      },
    });
    expect(weakened.semanticDiff.classification).toBe('unknown-potential-relaxation');
    expect(weakened.approval.status).toBe('blocked');
    const incomplete = packet({ repositoryPolicyDiff: {
      baseRef: null, baseHeadRevision: null, baseRevision: null, complete: false, files: [],
    } });
    expect(incomplete.approval).toMatchObject({ status: 'blocked' });
    expect(incomplete.approval.blockers.join(' ')).toMatch(/trustworthy base revision/);
  });

  it('blocks approval when semantic direction is unknown but still permits reject/request-changes', () => {
    const proposed = proposal();
    const base = structuredClone(proposed.candidate);
    base.metadata.status = 'approved';
    base.constraints[0]!.component = 'oldComponent';
    const blocked = packet({ proposal: proposed, baseBlueprint: base });
    expect(blocked.semanticDiff.classification).toBe('unknown-potential-relaxation');
    expect(blocked.approval.status).toBe('blocked');
    expect(() => recordReviewDecision({
      packet: blocked,
      decision: 'approve',
      reviewer: reviewer(),
      satisfiedRequirement: blocked.approval.requirements[0],
      rationale: 'approve anyway',
      decidedAt: '2026-09-03T12:00:00.000Z',
    })).toThrow(/cannot approve a blocked review packet/);
    expect(recordReviewDecision({
      packet: blocked,
      decision: 'request-changes',
      reviewer: reviewer(),
      rationale: 'Resolve the ambiguous component change.',
      decidedAt: '2026-09-03T12:00:00.000Z',
    }).decision).toBe('request-changes');
  });
});
