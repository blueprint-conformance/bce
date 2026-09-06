#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bindVerifiedFoundryRegistry, deriveFoundryClaimClasses } from './lib/evidence-claims.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bce-evidence-claims-'));
const checker = join(root, 'scripts/check-evidence-claims.mjs');
const claimLibrary = join(root, 'scripts/lib/evidence-claims.mjs');
const matrixPath = 'research/claim-evidence-matrix.json';
const matrix = JSON.parse(readFileSync(join(root, matrixPath), 'utf8'));
const supportPaths = new Set([
  'research/model-evaluation/pilots',
  'research/model-evaluation/schemas',
  'research/model-evaluation/studies/evidence-foundry-v3',
  'scripts/model-evaluation-blinded-evaluator.mjs',
]);
const paths = new Set([
  matrixPath,
  'llms.txt',
  ...matrix.publicBoundaries.map((entry) => entry.path),
  ...matrix.studies.flatMap((study) => [study.summary, study.protocol, study.manifest, study.registry, study.powerDesign].filter(Boolean)),
  ...matrix.claims.flatMap((claim) => claim.evidence ?? []),
]);
for (const path of supportPaths) {
  const target = join(fixture, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, path), target, { recursive: true });
}
for (const path of paths) {
  const target = join(fixture, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, path), target);
}
const originals = new Map([...paths].map((path) => [path, readFileSync(join(fixture, path), 'utf8')]));
const restore = () => { for (const [path, value] of originals) writeFileSync(join(fixture, path), value); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const claimLibrarySource = readFileSync(claimLibrary, 'utf8');
const claimLibraryImports = [...claimLibrarySource.matchAll(/from\s+['"]([^'"]+)['"]/g)]
  .map((match) => match[1]);
assert.ok(claimLibraryImports.length > 0, 'claim projection must retain explicit imports');
assert.ok(
  claimLibraryImports.every((specifier) => specifier.startsWith('node:')),
  `dependency-free claim projection imported ${claimLibraryImports.filter((specifier) => !specifier.startsWith('node:')).join(', ')}`,
);
const checkerSource = readFileSync(checker, 'utf8');
assert.match(checkerSource, /stageId: evidence\.foundryStudy\.primaryStage\.stageId/);
assert.match(checkerSource, /bindVerifiedFoundryRegistry\(evidence, foundryRegistryReport\)/);

const primaryScopedEvidence = {
  foundryProtocol: { lifecycle: 'frozen-ready-not-run' },
  foundryStudy: { studyId: 'study', ready: true, primaryStage: { stageId: 'primary-confirmatory' } },
};
const primaryScopedReport = {
  readinessScope: 'primary-confirmatory',
  studies: [{ studyId: 'study', readinessScope: 'primary-confirmatory', ready: true }],
};
assert.equal(
  bindVerifiedFoundryRegistry(primaryScopedEvidence, primaryScopedReport),
  primaryScopedEvidence,
  'primary-ready claim projection must not require deferred transport readiness',
);
assert.throws(
  () => bindVerifiedFoundryRegistry(primaryScopedEvidence, {
    readinessScope: 'primary-confirmatory',
    studies: [{ studyId: 'study', readinessScope: 'primary-confirmatory', ready: false }],
  }),
  /readiness differs from verified primary-stage execution readiness/,
  'claim projection accepted a missing primary readiness gate',
);
assert.throws(
  () => bindVerifiedFoundryRegistry(primaryScopedEvidence, {
    readinessScope: 'program',
    studies: [{ studyId: 'study', readinessScope: 'program', ready: true }],
  }),
  /not scoped to the exact primary confirmatory stage/,
  'claim projection accepted a program-wide report for a staged primary gate',
);

const lifecycleProtocol = (lifecycle, completedStageTypes = []) => ({
  lifecycle,
  stages: [
    { stageType: 'primary-confirmatory', lifecycle: completedStageTypes.includes('primary') ? 'complete' : 'frozen-ready-not-run' },
    { stageType: 'transport-confirmatory', lifecycle: completedStageTypes.includes('transport') ? 'complete' : 'frozen-ready-not-run' },
    { stageType: 'transport-confirmatory', lifecycle: 'frozen-ready-not-run' },
  ],
});
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('design-draft')), ['no-efficacy-claim']);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('frozen-ready-not-run')), ['no-efficacy-claim']);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('safety-halted', ['primary'])), ['no-efficacy-claim']);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('running')), ['no-efficacy-claim']);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('running', ['primary'])), [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
]);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('running', ['primary', 'transport'])), [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
]);
assert.deepEqual(deriveFoundryClaimClasses(lifecycleProtocol('complete', ['primary', 'transport'])), [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
]);
const fullyComplete = lifecycleProtocol('complete', ['primary', 'transport']);
for (const stage of fullyComplete.stages) stage.lifecycle = 'complete';
assert.deepEqual(deriveFoundryClaimClasses(fullyComplete), [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
  'bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population',
]);

for (const workflowPath of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
  const workflow = readFileSync(join(root, workflowPath), 'utf8');
  assert.equal((workflow.match(/npm run research:evidence-foundry-v3/g) ?? []).length, 1, `${workflowPath} must directly execute the v3 registry verifier once`);
  assert.equal((workflow.match(/npm run test:evidence-claims/g) ?? []).length, 1, `${workflowPath} must execute the lifecycle claim policy once`);
  assert.ok(workflow.indexOf('npm ci') < workflow.indexOf('npm run test:evidence-claims'), `${workflowPath} must install verifier dependencies before evidence claims`);
}

function reject(label, mutate, marker) {
  restore();
  mutate();
  try {
    execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error(`${label}: evidence checker accepted the contradiction`);
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes(marker)) throw error;
  }
}

reject('directional evidence promoted to product claim', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.claims.find((claim) => claim.id === 'accelerated-v6-directional-observation').status = 'product-test-supported';
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'product-test-supported requires first-party-mechanism-test evidence');

reject('product eligibility fabricated', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies[0].eligibility.productEfficacy = true;
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'ineligible for every product claim class');

reject('result anchor drift', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies[0].resultSha256 = '0'.repeat(64);
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'result or seal anchor differs');

reject('attempt denominator rewritten', () => {
  const path = matrix.studies[0].summary;
  const value = JSON.parse(originals.get(path));
  value.verifiedTrials = 15;
  writeFileSync(join(fixture, path), `${JSON.stringify(value, null, 2)}\n`);
}, 'summary or analysis self-digest is invalid');

reject('Evidence Foundry lifecycle promoted without results', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies.find((study) => study.id === 'evidence-foundry-v3').lifecycle = 'complete';
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'lifecycle and exact derived claim classes do not cross-bind');

reject('Evidence Foundry bounded claim fabricated before a completed stage', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies.find((study) => study.id === 'evidence-foundry-v3').currentClaimClasses = [
    'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  ];
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'lifecycle and exact derived claim classes do not cross-bind');

reject('Evidence Foundry draft presented as execution-ready', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies.find((study) => study.id === 'evidence-foundry-v3').ready = true;
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'readiness is not structurally valid for its lifecycle');

reject('claim-bearing running transition without sealed result and registry proof', () => {
  const value = JSON.parse(originals.get(matrixPath));
  const foundry = value.studies.find((study) => study.id === 'evidence-foundry-v3');
  const protocol = JSON.parse(originals.get(foundry.protocol));
  protocol.lifecycle = 'running';
  protocol.heldoutAccess = {
    status: 'accessed-after-seal',
    firstAccessAt: '2026-09-07T00:00:00.000Z',
    accessLedgerHeadSha256: 'a'.repeat(64),
  };
  protocol.stages[0].lifecycle = 'complete';
  protocol.currentClaimClasses = ['bounded-primary-causal-effect-exact-cell-release-and-task-population'];
  const protocolBytes = `${JSON.stringify(protocol, null, 2)}\n`;
  writeFileSync(join(fixture, foundry.protocol), protocolBytes);
  foundry.protocolSha256 = sha256(protocolBytes);
  foundry.lifecycle = 'running';
  foundry.evidenceClass = 'confirmatory-staged-causal-study';
  foundry.currentClaimClasses = [...protocol.currentClaimClasses];

  const registry = JSON.parse(originals.get(foundry.registry));
  const entry = registry.studies.find((study) => study.studyId === foundry.studyId);
  entry.protocolSha256 = foundry.protocolSha256;
  entry.lifecycle = foundry.lifecycle;
  entry.evidenceClass = foundry.evidenceClass;
  entry.currentClaimClasses = [...foundry.currentClaimClasses];
  const registryBytes = `${JSON.stringify(registry, null, 2)}\n`;
  writeFileSync(join(fixture, foundry.registry), registryBytes);
  foundry.registrySha256 = sha256(registryBytes);
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'full registry and result verification refused');

reject('Evidence Foundry primary denominator rewritten', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies.find((study) => study.id === 'evidence-foundry-v3').primaryStage.retainedAttempts = 239;
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'primary topology differs');

reject('Evidence Foundry protocol digest drift', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies.find((study) => study.id === 'evidence-foundry-v3').protocolSha256 = '0'.repeat(64);
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'registry, protocol, or power-design digest differs');

reject('public boundary removed', () => {
  const boundary = matrix.publicBoundaries[0];
  writeFileSync(join(fixture, boundary.path), originals.get(boundary.path).replace(boundary.required, 'Evidence is promising.'));
}, 'missing its required claim boundary');

reject('unqualified efficacy prose introduced', () => {
  const boundary = matrix.publicBoundaries[0];
  writeFileSync(join(fixture, boundary.path), `${originals.get(boundary.path)}\nBCE improves\ncoding-agent outcomes.\n`);
}, 'unqualified product-efficacy claim');

reject('obsolete v2 study restored as current', () => {
  const boundary = matrix.publicBoundaries.find((entry) => entry.path === 'PRODUCT.md');
  writeFileSync(join(fixture, boundary.path), `${originals.get(boundary.path)}\nThe canonical 600-trial confirmatory study is the current forward study.\n`);
}, 'obsolete v2 study presented as the current forward study');

restore();
const accepted = execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
if (!accepted.includes('PASS')) throw new Error(`clean evidence claim set did not pass:\n${accepted}`);
process.stdout.write('evidence-claim-policy self-test: PASS (v6 and v3 promotion, eligibility, anchor, denominator, boundary, stale-plan, and prose contradictions rejected)\n');
