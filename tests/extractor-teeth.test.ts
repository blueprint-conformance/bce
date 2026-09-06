import { buildProposalContext, prepareAuthoredDraft, buildReviewPacket, verifyReviewPacket } from '../src/review.js';
import { resolveExtraction } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { REVIEW_IDENTITY_FIXTURE } from './review-fixture.js';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessExtractorTeethCorpus, buildSourceReviewProof } from '../src/extractor-teeth.js';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';

const sha = (value: string): string => createHash('sha256').update(value).digest('hex');

function fixture(): { repo: string; blueprint: EngineeringBlueprint; manifest: Record<string, unknown> } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-extractor-teeth-test-'));
  fs.mkdirSync(path.join(repo, 'src'));
  const source = 'export const value = 1;\n';
  fs.writeFileSync(path.join(repo, 'src', 'index.ts'), source);
  const blueprint = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'extractor-teeth-fixture', version: '1.0.0', status: 'approved' },
    intentRefs: ['test/extractor-teeth'],
    scope: { repositories: ['example/fixture'] },
    architecture: { components: [], relationships: [] },
    constraints: [
      { id: 'no-process-exit', type: 'forbiddenPattern', severity: 'critical', path: 'src/**/*.ts', pattern: 'process\\.exit\\s*\\(' },
      { id: 'no-ts-morph', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'ts-morph', scopePaths: ['src/**/*.ts'] },
    ],
    evidenceRequirements: [],
    approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  });
  const manifest = {
    schemaVersion: '1',
    blueprintRef: 'extractor-teeth-fixture@1.0.0',
    allowedMutationRoots: ['src'],
    cases: [
      {
        id: 'plant-process-exit',
        constraintId: 'no-process-exit',
        operation: { kind: 'appendText', target: 'src/index.ts', preconditionSha256: sha(source), content: '\nexport function stop() { process.exit(1); }\n' },
        expectedEvidencePath: 'src/index.ts',
        allowedCollateralConstraints: [],
      },
      {
        id: 'plant-ts-morph-import',
        constraintId: 'no-ts-morph',
        operation: { kind: 'appendText', target: 'src/index.ts', preconditionSha256: sha(source), content: "\nimport 'ts-morph';\n" },
        expectedEvidencePath: 'src/index.ts',
        allowedCollateralConstraints: [],
      },
    ],
  };
  return { repo, blueprint, manifest };
}

describe('extractor-real source mutation teeth', () => {
  it('kills every mapped constraint through real files and the real AST extractor', () => {
    const { repo, blueprint, manifest } = fixture();
    const report = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest });
    expect(report.verdict).toBe('extractor-real-proven');
    expect(report.killed).toBe(2);
    expect(report.cases.every((entry) => entry.targetViolations.every((ref) => ref.startsWith('src/index.ts#L')))).toBe(true);
    expect(report.proofSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds and copies only declared mutation roots', () => {
    const { repo, blueprint, manifest } = fixture();
    const before = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest });
    fs.mkdirSync(path.join(repo, '.tmp-unrelated'));
    fs.writeFileSync(path.join(repo, '.tmp-unrelated', 'transient.txt'), 'not governed by this corpus\n');
    const after = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest });

    expect(before.verdict).toBe('extractor-real-proven');
    expect(after.verdict).toBe('extractor-real-proven');
    expect(after.inputBindings.sourceTreeSha256).toBe(before.inputBindings.sourceTreeSha256);
  });

  it('refuses missing and duplicate one-to-one mappings', () => {
    const { repo, blueprint, manifest } = fixture();
    const one = structuredClone(manifest) as { cases: unknown[] };
    one.cases.pop();
    const missing = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: one });
    expect(missing.verdict).toBe('refusal');
    expect(missing.unmappedConstraints).toEqual(['no-ts-morph']);

    const duplicate = structuredClone(manifest) as { cases: Array<Record<string, unknown>> };
    duplicate.cases.push({ ...duplicate.cases[0], id: 'plant-process-exit-again' });
    const doubled = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: duplicate });
    expect(doubled.verdict).toBe('refusal');
    expect(doubled.duplicateMappings).toEqual(['no-process-exit']);
  });

  it('refuses precondition tamper, protected targets, syntax errors, and mutations that survive', () => {
    const { repo, blueprint, manifest } = fixture();
    const tampered = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    tampered.cases[0]!.operation.preconditionSha256 = '0'.repeat(64);
    expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: tampered }).cases[0]?.status).toBe('refused');

    const protectedTarget = structuredClone(manifest) as { allowedMutationRoots: string[]; cases: Array<{ operation: Record<string, unknown> }> };
    protectedTarget.allowedMutationRoots.push('.blueprints');
    protectedTarget.cases[0]!.operation = { kind: 'createFile', target: '.blueprints/policy.json', preconditionSha256: null, content: '{}' };
    expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: protectedTarget }).cases[0]?.detail).toContain('protected');

    const syntax = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    syntax.cases[0]!.operation.content = '\nexport {\n';
    expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: syntax }).cases[0]?.detail).toContain('not parseable');

    const survivor = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    survivor.cases[0]!.operation.content = '\nexport const harmless = 2;\n';
    const survived = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: survivor });
    expect(survived.cases.find((entry) => entry.constraintId === 'no-process-exit')?.status).toBe('survived');
    expect(survived.verdict).toBe('refusal');
  });

  it('refuses undeclared collateral, unparseable creates, and symbolic-link mutation targets', () => {
    const { repo, blueprint, manifest } = fixture();
    const collateral = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    collateral.cases[0]!.operation.content = "\nimport 'ts-morph';\nexport function stop() { process.exit(1); }\n";
    const collateralReport = assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: collateral });
    expect(collateralReport.cases.find((entry) => entry.constraintId === 'no-process-exit')?.status).toBe('refused');
    expect(collateralReport.cases.find((entry) => entry.constraintId === 'no-process-exit')?.unexpectedCollateralConstraints).toEqual(['no-ts-morph']);

    const createSyntax = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    createSyntax.cases[0]!.operation = { kind: 'createFile', target: 'src/bad.ts', preconditionSha256: null, content: 'export {\n' };
    expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: createSyntax }).cases[0]?.detail).toContain('not parseable');

    fs.symlinkSync(path.join(repo, 'src', 'index.ts'), path.join(repo, 'src', 'linked.ts'));
    const linked = structuredClone(manifest) as { cases: Array<{ operation: Record<string, unknown> }> };
    linked.cases[0]!.operation.target = 'src/linked.ts';
    expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint, manifest: linked }).cases[0]?.detail).toContain('symbolic link');
  });
});

describe('source proof in authenticated review packets', () => {
  it('replays real mutant graphs and refuses surviving, stale, or counterfeit source proofs', () => {
    const { repo, blueprint, manifest } = fixture();
    const context = buildProposalContext({
      repository: { identity: 'github.com/example/fixture', revision: 'revision-1', worktreeDigest: sha('tree') },
      files: [{ path: 'src/index.ts', content: fs.readFileSync(path.join(repo, 'src/index.ts'), 'utf8') }],
      humanIntent: 'Keep process ownership and parser imports inside their governed boundaries.',
      authoritativeIntentRefs: [{ ref: 'test/extractor-teeth', content: 'Keep process ownership and parser imports inside their governed boundaries.' }],
      excluded: { paths: [], classes: [] },
    });
    const proposal = prepareAuthoredDraft({ context, blueprint, proposalId: 'authored-source-proof' });
    const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
    const graph = makeExtractor('ast', cfg).extract(repo, 'revision-1');
    const args = { proposal, baseBlueprint: null, graph, ...REVIEW_IDENTITY_FIXTURE,
      extractor: { ...REVIEW_IDENTITY_FIXTURE.extractor, profile: 'plugin-surface' as const },
      repositoryPolicyDiff: { complete: true, baseRef: 'main', baseHeadRevision: 'base-1', baseRevision: 'base-1', files: [] },
    };
    expect(buildReviewPacket(args).approval.status).toBe('blocked');
    const sourceProof = buildSourceReviewProof(repo, proposal.candidate, manifest)!;
    const packet = buildReviewPacket({ ...args, sourceProof });
    expect(packet.approval.status).toBe('eligible');
    expect(verifyReviewPacket(packet).valid).toBe(true);
    const forged = structuredClone(sourceProof);
    forged.cases[0]!.graph = graph;
    expect(() => buildReviewPacket({ ...args, sourceProof: forged })).toThrow(/mutant does not replay/);
    const missing = { ...sourceProof, cases: sourceProof.cases.slice(1) };
    expect(() => buildReviewPacket({ ...args, sourceProof: missing })).toThrow(/exactly once/);
    fs.appendFileSync(path.join(repo, 'src/index.ts'), '\nexport const changed = 2;\n');
    expect(() => buildSourceReviewProof(repo, proposal.candidate, manifest)).toThrow(/source proof refused/);
  });
});

it('binds forbidden-file mutants to the exact file evidence without inventing a line number', () => {
  const { repo, blueprint } = fixture();
  const fileBlueprint = parseBlueprint({ ...blueprint, extraction: { ...blueprint.extraction, paths: ['src/**'] }, constraints: [
    { id: 'no-pem', type: 'forbiddenFile', path: 'src/**/*.pem', severity: 'critical' },
  ] });
  const manifest = { schemaVersion: '1', blueprintRef: 'extractor-teeth-fixture@1.0.0', allowedMutationRoots: ['src'],
    cases: [{ id: 'plant-pem-file', constraintId: 'no-pem', expectedEvidencePath: 'src/fixture.pem',
      operation: { kind: 'createFile', target: 'src/fixture.pem', preconditionSha256: null, content: 'inert fixture' } }],
  };
  expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint: fileBlueprint, manifest }).verdict).toBe('extractor-real-proven');
  manifest.cases[0]!.expectedEvidencePath = 'src/different.pem';
  expect(assessExtractorTeethCorpus({ repoDir: repo, blueprint: fileBlueprint, manifest }).verdict).toBe('refusal');
});
