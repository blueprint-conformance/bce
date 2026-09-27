import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, it } from 'vitest';
import { assessExtractorTeethCorpus } from '../src/extractor-teeth.js';
import { parseBlueprint, type Constraint } from '../src/schema.js';
import { prepareDeclaredEvidence } from '../src/stack/stack-evaluation.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
it('real selected-source mutations kill all five rule families without synthesized graph facts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-stack-teeth-'));
  try {
    const files = {
      'package.json': JSON.stringify({ name: 'consumer', version: '1.0.0' }),
      'package-lock.json': JSON.stringify({ name: 'consumer', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'consumer', version: '1.0.0' }, 'node_modules/is-number': { version: '7.0.0' } } }),
      '.nvmrc': '22.22.2\n',
      Dockerfile: `FROM node@sha256:${'a'.repeat(64)}\n`,
    };
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
    const bp = (constraint: Constraint) => parseBlueprint({ apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
      metadata: { id: 'stack', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' }, minEngineVersion: '0.5.0',
      intentRefs: ['intent:test'], scope: { repositories: ['test'] }, architecture: { components: [], relationships: [] },
      stack: { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: ['Dockerfile'], runtimeFiles: ['.nvmrc'] },
      constraints: [constraint], evidenceRequirements: [{ type: 'declaredStack', required: true, onMissing: 'block' }], approvals: [{ role: 'owner', stage: 'ratify' }],
    });
    const pin: Constraint = { id: 'pin', type: 'pinnedVersion', severity: 'high', stackTarget: { kind: 'npm', name: 'is-number' }, expectedVersion: '7.0.0' };
    const digest = prepareDeclaredEvidence(bp(pin), root, 'test').manifest!.stackDigest;
    const cases: Array<{ constraint: Constraint; file: keyof typeof files; find: string; replacement: string }> = [
      { constraint: pin, file: 'package-lock.json', find: '7.0.0', replacement: '8.0.0' },
      { constraint: { id: 'closure', type: 'stackClosureMatch', severity: 'high', expectedStackDigest: digest }, file: 'package-lock.json', find: '7.0.0', replacement: '8.0.0' },
      { constraint: { id: 'forbid', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }, file: 'package-lock.json', find: 'node_modules/is-number', replacement: 'node_modules/legacy-package' },
      { constraint: { id: 'images', type: 'requirePinnedImages', severity: 'high' }, file: 'Dockerfile', find: `node@sha256:${'a'.repeat(64)}`, replacement: 'node:22' },
      { constraint: { id: 'runtime', type: 'allowedNodeVersions', severity: 'high', versions: ['22.22.2'] }, file: '.nvmrc', find: '22.22.2', replacement: '24.8.0' },
    ];
    for (const item of cases) {
      const report = assessExtractorTeethCorpus({ blueprint: bp(item.constraint), repoDir: root, manifest: {
        schemaVersion: '1', blueprintRef: 'stack@1.0.0', allowedMutationRoots: [item.file],
        cases: [{ id: `mutate-${item.constraint.id}`, constraintId: item.constraint.id, operation: { kind: 'replaceText', target: item.file, preconditionSha256: hash(files[item.file]), find: item.find, replacement: item.replacement }, expectedEvidencePath: item.file, allowedCollateralConstraints: [] }],
      } });
      expect(report, JSON.stringify(report)).toMatchObject({ verdict: 'extractor-real-proven', cleanVerdict: 'pass', killed: 1, refused: 0 });
      expect(fs.readFileSync(path.join(root, item.file), 'utf8')).toBe(files[item.file]);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

it('preserves the checkout anchor while proving a pnpm link mutation on the copied mutant', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-stack-link-teeth-'));
  const root = path.join(parent, 'link-reenter');
  try {
    fs.mkdirSync(path.join(root, 'vendor/lib'), { recursive: true });
    fs.mkdirSync(path.join(root, 'vendor/other'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'link-root', version: '1.0.0', dependencies: { l1: 'link:../link-reenter/vendor/lib', l2: 'link:./vendor/lib/' } }));
    fs.writeFileSync(path.join(root, 'vendor/lib/package.json'), JSON.stringify({ name: 'lib', version: '1.0.0' }));
    fs.writeFileSync(path.join(root, 'vendor/other/package.json'), JSON.stringify({ name: 'other', version: '1.0.0' }));
    const before = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      l1:\n        specifier: link:../link-reenter/vendor/lib\n        version: link:vendor/lib\n      l2:\n        specifier: link:./vendor/lib/\n        version: link:vendor/lib\n";
    const oldBlock = '      l2:\n        specifier: link:./vendor/lib/\n        version: link:vendor/lib';
    const newBlock = '      l2:\n        specifier: link:./vendor/other/\n        version: link:vendor/other';
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), before);
    const config = { source: 'pnpm-lockfile-v9' as const, lockfile: 'pnpm-lock.yaml', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] };
    const blueprint = parseBlueprint({ apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
      metadata: { id: 'stack-link', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' }, minEngineVersion: '0.5.0',
      intentRefs: ['intent:test'], scope: { repositories: ['test'] }, architecture: { components: [], relationships: [] }, stack: config,
      constraints: [{ id: 'closure', type: 'stackClosureMatch', severity: 'high', expectedStackDigest: prepareDeclaredEvidence(parseBlueprint({
        apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint', metadata: { id: 'seed', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' }, minEngineVersion: '0.5.0',
        intentRefs: ['intent:test'], scope: { repositories: ['test'] }, architecture: { components: [], relationships: [] }, stack: config,
        constraints: [{ id: 'placeholder', type: 'forbiddenStackPackage', severity: 'high', packageName: 'never' }], evidenceRequirements: [{ type: 'declaredStack', required: true, onMissing: 'block' }], approvals: [],
      }), root, 'clean').manifest!.stackDigest }],
      evidenceRequirements: [{ type: 'declaredStack', required: true, onMissing: 'block' }], approvals: [],
    });
    const report = assessExtractorTeethCorpus({ blueprint, repoDir: root, manifest: {
      schemaVersion: '1', blueprintRef: 'stack-link@1.0.0', allowedMutationRoots: ['pnpm-lock.yaml'],
      cases: [{ id: 'move-link', constraintId: 'closure', operation: { kind: 'replaceText', target: 'pnpm-lock.yaml', preconditionSha256: hash(before), find: oldBlock, replacement: newBlock }, expectedEvidencePath: 'pnpm-lock.yaml', allowedCollateralConstraints: [] }],
    } });
    expect(report, JSON.stringify(report)).toMatchObject({ verdict: 'extractor-real-proven', cleanVerdict: 'pass', killed: 1, refused: 0 });
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
