#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  CLAIM_CLASSES,
  EvidenceFoundryRefusal,
  recomputeStagePower,
  resolveRegularFileInside,
  sha256Bytes,
  studyReadinessBlockers,
  validatePowerDesign,
  validateProtocolV3,
  verifyStudyRegistry,
} from './lib/evidence-foundry-v3.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const clone = (value) => structuredClone(value);
const protocol = readJson('research/model-evaluation/studies/evidence-foundry-v3/protocol.json');
const powerDesign = readJson('research/model-evaluation/studies/evidence-foundry-v3/power-design.json');
const registry = readJson('research/model-evaluation/studies/index.v3.json');

function assertRefuses(fn, pattern) {
  assert.throws(fn, (error) => error instanceof EvidenceFoundryRefusal && pattern.test(error.message), pattern.toString());
}

function assertSchemaObjectsClosed(schema, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  if (schema.type === 'object') assert.equal(schema.additionalProperties, false, `${path} must be closed`);
  if (Array.isArray(schema)) schema.forEach((entry, index) => assertSchemaObjectsClosed(entry, `${path}[${index}]`));
  else for (const [key, value] of Object.entries(schema)) assertSchemaObjectsClosed(value, `${path}.${key}`);
}

function frozenProtocol() {
  const value = clone(protocol);
  value.lifecycle = 'frozen-ready-not-run';
  value.releaseBinding = {
    version: '0.3.0',
    gitCommit: '1'.repeat(40),
    sourceTreeSha256: '2'.repeat(64),
    packageArtifactSha256: '3'.repeat(64),
    installedTreeSha256: '4'.repeat(64),
  };
  value.taskPopulation.status = 'frozen';
  for (const [index, cell] of value.clientModelCells.entries()) {
    cell.client = `client-${index}`;
    cell.executable = `client-${index}`;
    cell.clientVersion = '1.0.0';
    cell.clientArtifactSha256 = '5'.repeat(64);
    cell.adapterArtifactSha256 = '6'.repeat(64);
    cell.requestedModel = `model-${index}`;
    cell.resolvedModel = `model-${index}@sha256:${'7'.repeat(64)}`;
    cell.modelIdentitySource = 'signed-provider-response';
    cell.modelIdentityEvidenceSha256 = '8'.repeat(64);
    cell.reasoningEffort = 'fixed';
    cell.qualification = {
      status: 'qualified-before-heldout-access',
      attestationPath: `research/model-evaluation/studies/evidence-foundry-v3/qualification-${index}.json`,
      attestationSha256: '9'.repeat(64),
    };
  }
  value.evaluator.evaluatorId = 'blinded-evaluator-v1';
  value.evaluator.evaluatorArtifactSha256 = 'a'.repeat(64);
  value.evaluator.rubricSha256 = 'b'.repeat(64);
  for (const stage of value.stages) {
    stage.lifecycle = 'frozen-ready-not-run';
    stage.preregistration = 'sealed-before-heldout-access';
  }
  return value;
}

function beginRun(value) {
  value.lifecycle = 'running';
  value.heldoutAccess = {
    status: 'accessed-after-seal',
    firstAccessAt: '2026-09-07T00:00:00.000Z',
    accessLedgerHeadSha256: 'c'.repeat(64),
  };
}

for (const schemaName of ['study-index.v3.schema.json', 'protocol.v3.schema.json', 'power-design.v1.schema.json']) {
  assertSchemaObjectsClosed(readJson(`research/model-evaluation/schemas/${schemaName}`));
}

assert.equal(CLAIM_CLASSES.length, 6);
assert.equal(new Set(CLAIM_CLASSES.map((entry) => entry.id)).size, 6);
assert.deepEqual(registry.claimClasses, CLAIM_CLASSES);

const report = verifyStudyRegistry({ root });
assert.equal(report.valid, true);
assert.equal(report.ready, false);
assert.equal(report.archives.length, 5);
assert.equal(report.archives.every((archive) => archive.immutable && archive.claimClass === 'apparatus-validation-only'), true);
assert.match(report.readinessBlockers.join('\n'), /release binding is unset/);

const readyCli = spawnSync(process.execPath, [resolve(root, 'scripts/verify-evidence-foundry-registry.mjs'), '--require-ready'], { cwd: root, encoding: 'utf8' });
assert.equal(readyCli.status, 2);
assert.match(readyCli.stderr, /structurally valid but not execution-ready/);
const unknownCli = spawnSync(process.execPath, [resolve(root, 'scripts/verify-evidence-foundry-registry.mjs'), '--invented-flag'], { cwd: root, encoding: 'utf8' });
assert.equal(unknownCli.status, 2);
assert.match(unknownCli.stderr, /unknown argument/);

const indexExtra = clone(registry);
indexExtra.unreviewed = true;
assertRefuses(() => verifyStudyRegistry({ root, index: indexExtra }), /additional properties/);
const claimMutation = clone(registry);
claimMutation.claimClasses[2].meaning = 'A conveniently broader efficacy statement than the sealed evidence allows.';
assertRefuses(() => verifyStudyRegistry({ root, index: claimMutation }), /claim-class catalog differs/);
const archiveMutation = clone(registry);
archiveMutation.legacyArchives[0].contentTreeSha256 = '0'.repeat(64);
assertRefuses(() => verifyStudyRegistry({ root, index: archiveMutation }), /immutable archive digest mismatch/);
const protocolDigestMutation = clone(registry);
protocolDigestMutation.studies[0].protocolSha256 = '0'.repeat(64);
assertRefuses(() => verifyStudyRegistry({ root, index: protocolDigestMutation }), /protocol digest mismatch/);
const duplicateGeneration = clone(registry);
duplicateGeneration.reservedStudyIds[0].generation = 4;
assertRefuses(() => verifyStudyRegistry({ root, index: duplicateGeneration }), /duplicate legacy generation dispositions/);
const falseArchiveClass = clone(registry);
falseArchiveClass.legacyArchives[3].evidenceClass = 'development-exposed-instrumentation-pilot';
assertRefuses(() => verifyStudyRegistry({ root, index: falseArchiveClass }), /archive evidence class differs/);
const falseStudyClass = clone(registry);
falseStudyClass.studies[0].evidenceClass = 'confirmatory-staged-causal-study';
assertRefuses(() => verifyStudyRegistry({ root, index: falseStudyClass }), /registry evidence class differs/);
const traversal = clone(registry);
traversal.studies[0].protocolPath = '../protocol.json';
assertRefuses(() => verifyStudyRegistry({ root, index: traversal }), /pattern/);

const symlinkRoot = mkdtempSync('/tmp/bce-evidence-foundry-symlink-');
try {
  symlinkSync('/etc/passwd', join(symlinkRoot, 'artifact.json'));
  assertRefuses(() => resolveRegularFileInside(symlinkRoot, 'artifact.json'), /symbolic links are refused/);
} finally {
  rmSync(symlinkRoot, { recursive: true, force: true });
}

validateProtocolV3(root, protocol);
validatePowerDesign(root, protocol, powerDesign);
const protocolExtra = clone(protocol);
protocolExtra.resultsAreGreat = true;
assertRefuses(() => validateProtocolV3(root, protocolExtra), /additional properties/);
const duplicateStage = clone(protocol);
duplicateStage.stages[1].id = duplicateStage.stages[0].id;
assertRefuses(() => validateProtocolV3(root, duplicateStage), /duplicate stage IDs/);
const primaryDepends = clone(protocol);
primaryDepends.stages[0].dependsOn = ['transport-a'];
assertRefuses(() => validateProtocolV3(root, primaryDepends), /primary stage may not depend/);
const broadDraftClaim = clone(protocol);
broadDraftClaim.currentClaimClasses = ['bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population'];
assertRefuses(() => validateProtocolV3(root, broadDraftClaim), /require exact claim classes/);
const draftRelease = clone(protocol);
draftRelease.releaseBinding = {
  version: '0.3.0',
  gitCommit: '1'.repeat(40),
  sourceTreeSha256: '2'.repeat(64),
  packageArtifactSha256: '3'.repeat(64),
  installedTreeSha256: '4'.repeat(64),
};
assertRefuses(() => validateProtocolV3(root, draftRelease), /design draft may not claim a frozen release binding/);

const frozen = frozenProtocol();
validateProtocolV3(root, frozen);
const readinessScratch = mkdtempSync(join(tmpdir(), 'bce-evidence-foundry-readiness-'));
try {
  const artifact = (name, value) => {
    const absolute = join(readinessScratch, name);
    const bytes = Buffer.from(JSON.stringify(value));
    writeFileSync(absolute, bytes);
    return { path: relative(readinessScratch, absolute), sha256: sha256Bytes(bytes) };
  };
  const manifest = artifact('task-manifest.json', { sealed: true });
  frozen.taskPopulation.manifestPath = manifest.path;
  frozen.taskPopulation.manifestSha256 = manifest.sha256;
  frozen.artifacts.assignmentSeal = artifact('assignment-seal.json', { sealed: true });
  frozen.artifacts.evaluatorLock = artifact('evaluator-lock.json', { blinded: true });
  frozen.artifacts.powerDesign = artifact('power-design.json', powerDesign);
  for (const [index, cell] of frozen.clientModelCells.entries()) {
    const attestation = artifact(`qualification-${index}.json`, { qualified: true, cellId: cell.id });
    cell.qualification.attestationPath = attestation.path;
    cell.qualification.attestationSha256 = attestation.sha256;
  }
  assert.deepEqual(studyReadinessBlockers(readinessScratch, frozen, powerDesign), []);
  const wrongManifest = clone(frozen);
  wrongManifest.taskPopulation.manifestSha256 = '0'.repeat(64);
  assert.match(studyReadinessBlockers(readinessScratch, wrongManifest, powerDesign).join('\n'), /task manifest digest does not match/);
} finally {
  rmSync(readinessScratch, { recursive: true, force: true });
}
const primaryComplete = clone(frozen);
beginRun(primaryComplete);
primaryComplete.stages[0].lifecycle = 'complete';
primaryComplete.currentClaimClasses = ['bounded-primary-causal-effect-exact-cell-release-and-task-population'];
validateProtocolV3(root, primaryComplete);
validatePowerDesign(root, primaryComplete, powerDesign);
const prematureTransport = clone(frozen);
beginRun(prematureTransport);
prematureTransport.stages[1].lifecycle = 'running';
assertRefuses(() => validateProtocolV3(root, prematureTransport), /transport stage may not start before the primary stage completes/);
const transportComplete = clone(primaryComplete);
transportComplete.stages[1].lifecycle = 'complete';
transportComplete.currentClaimClasses.push('bounded-transportability-causal-effect-exact-cell-release-and-task-population');
validateProtocolV3(root, transportComplete);
const allComplete = clone(frozen);
beginRun(allComplete);
allComplete.lifecycle = 'complete';
for (const stage of allComplete.stages) stage.lifecycle = 'complete';
allComplete.currentClaimClasses = [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
  'bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population',
];
validateProtocolV3(root, allComplete);
const falseIndependent = clone(allComplete);
falseIndependent.currentClaimClasses.push('independent-replication-exact-frozen-scope');
assertRefuses(() => validateProtocolV3(root, falseIndependent), /require exact claim classes/);
const independent = clone(falseIndependent);
independent.operatorModel = 'independent-replication';
validateProtocolV3(root, independent);
const safetyHalt = clone(frozen);
safetyHalt.lifecycle = 'safety-halted';
safetyHalt.stages[0].lifecycle = 'safety-halted';
validateProtocolV3(root, safetyHalt);

const alteredCalculation = clone(powerDesign);
alteredCalculation.stages[0].calculation.requiredPairsBeforeClustering += 1;
assertRefuses(() => validatePowerDesign(root, protocol, alteredCalculation), /does not recompute exactly/);
const impossibleDiscordance = clone(powerDesign);
impossibleDiscordance.stages[0].assumptions.discordantPairRateUnderAlternative = 0.2;
assertRefuses(() => validatePowerDesign(root, protocol, impossibleDiscordance), /incompatible with the design alternative/);
const falseBlockMutation = clone(powerDesign);
falseBlockMutation.falseBlockGuard.requiredZeroEventTrials += 1;
assertRefuses(() => validatePowerDesign(root, protocol, falseBlockMutation), /false-block guard does not recompute exactly/);
const draftWithResults = clone(powerDesign);
draftWithResults.status = 'draft-unvalidated';
draftWithResults.validation = null;
assertRefuses(() => validatePowerDesign(root, protocol, draftWithResults), /draft power design may not present calculations as validated/);
const honestPowerDraft = clone(draftWithResults);
for (const stage of honestPowerDraft.stages) stage.calculation = null;
validatePowerDesign(root, protocol, honestPowerDraft);
assertRefuses(() => validatePowerDesign(root, frozen, honestPowerDraft), /sealed or executing study requires a validated pre-access power design/);
const underpoweredProtocol = clone(protocol);
underpoweredProtocol.taskPopulation.repositoryClusters = 30;
underpoweredProtocol.taskPopulation.pairsPerCell = 90;
const underpowered = clone(powerDesign);
for (const stage of underpowered.stages) {
  stage.plannedRepositoryClusters = 30;
  stage.plannedPairs = 90;
  stage.calculation = recomputeStagePower(stage, underpowered.alpha, underpowered.targetPower);
}
underpowered.falseBlockGuard.plannedBceTrialsPerStage = 90;
underpowered.validation.allStagesMeetPower = false;
assertRefuses(() => validatePowerDesign(root, underpoweredProtocol, underpowered), /underpowered for the declared design alternative/);
const latePower = clone(primaryComplete);
latePower.heldoutAccess.firstAccessAt = '2026-09-05T00:00:00.000Z';
assertRefuses(() => validatePowerDesign(root, latePower, powerDesign), /not completed before first heldout access/);
const powerExtra = clone(powerDesign);
powerExtra.stages[0].assumptions.unsealedGuess = 0.4;
assertRefuses(() => validatePowerDesign(root, protocol, powerExtra), /additional properties/);

console.log('Evidence Foundry v3 foundation self-test: PASS');
