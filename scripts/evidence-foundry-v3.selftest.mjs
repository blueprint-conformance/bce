#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  CLAIM_CLASSES,
  EvidenceFoundryRefusal,
  RUNTIME_DERIVATION_CERTIFICATE_IDENTITY,
  RUNTIME_DERIVATION_CERTIFICATE_ISSUER,
  canonical,
  externalResultAnchorRefusals,
  registryReleaseEvidenceRefusals,
  recomputeStagePower,
  resolveRegularFileInside,
  sha256Bytes,
  stageExecutionCellBindingRefusals,
  stageTreatmentReleaseBindingRefusals,
  studyReadinessBlockers,
  runtimeDerivationEvidenceRefusals,
  validateRuntimeDerivationStatement,
  validatePowerDesign,
  validateProtocolV3,
  verifyStageBundleForLifecycle,
  verifyStudyRegistry,
} from './lib/evidence-foundry-v3.mjs';
import { expectedSeal } from './lib/model-evaluation.mjs';

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
  const packageBytes = Buffer.from('synthetic release artifact');
  const attestationBytes = Buffer.from('{}');
  value.releaseBinding = {
    packageName: 'bce-engine',
    studyId: value.studyId,
    version: '0.3.0',
    gitCommit: '1'.repeat(40),
    sourceTreeSha256: '2'.repeat(64),
    packageArtifactPath: 'research/model-evaluation/studies/evidence-foundry-v3/release.tgz',
    packageArtifactSha256: sha256Bytes(packageBytes),
    npmIntegrity: `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`,
    registryTarballUrl: 'https://registry.npmjs.org/bce-engine/-/bce-engine-0.3.0.tgz',
    runtimeArtifactPath: 'research/model-evaluation/studies/evidence-foundry-v3/release-runtime.tgz',
    runtimeArtifactSha256: '3'.repeat(64),
    installedTreeSha256: '4'.repeat(64),
    registryVerification: {
      recordPath: 'research/model-evaluation/studies/evidence-foundry-v3/registry-verification.json',
      recordSha256: 'a'.repeat(64),
    },
    runtimeDerivation: {
      statementPath: 'research/model-evaluation/studies/evidence-foundry-v3/runtime-derivation.json',
      statementSha256: 'b'.repeat(64),
      bundlePath: 'research/model-evaluation/studies/evidence-foundry-v3/runtime-derivation.sigstore',
      bundleSha256: 'c'.repeat(64),
      certificateIssuer: RUNTIME_DERIVATION_CERTIFICATE_ISSUER,
      certificateIdentityURI: RUNTIME_DERIVATION_CERTIFICATE_IDENTITY,
    },
    releaseStatePath: 'release-state.json',
    releaseStateSha256: '5'.repeat(64),
    attestationPath: 'research/model-evaluation/studies/evidence-foundry-v3/release-attestation.json',
    attestationSha256: sha256Bytes(attestationBytes),
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
      status: 'qualified-before-stage-exposure',
      attestationPath: `research/model-evaluation/studies/evidence-foundry-v3/qualification-${index}.json`,
      attestationSha256: '9'.repeat(64),
    };
  }
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

for (const schemaName of ['study-index.v3.schema.json', 'protocol.v3.schema.json', 'power-design.v1.schema.json', 'runtime-derivation.v1.schema.json']) {
  assertSchemaObjectsClosed(readJson(`research/model-evaluation/schemas/${schemaName}`));
}

const portableStageScratch = mkdtempSync(join(root, '.bce-completed-stage-portability-'));
try {
  const portableBundle = join(portableStageScratch, 'bundle');
  cpSync(resolve(root, 'research/model-evaluation/pilots/accelerated-v6'), portableBundle, { recursive: true });
  const publicVerifier = resolve(root, 'scripts/verify-model-evaluation-public.mjs');
  const portableResults = join(portableBundle, 'results');
  const replayed = spawnSync(process.execPath, [publicVerifier, '--bundle', portableBundle, '--results', portableResults], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(replayed.status, 0, `portable public replay fixture refused: ${replayed.stderr}`);
  const terminalRecordsPath = join(portableResults, 'terminal-records.jsonl');
  const terminalRecordBytes = readFileSync(terminalRecordsPath);
  rmSync(terminalRecordsPath);
  const missingTerminals = spawnSync(process.execPath, [publicVerifier, '--bundle', portableBundle, '--results', portableResults], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  assert.notEqual(missingTerminals.status, 0, 'public replay accepted missing terminal evidence');
  writeFileSync(terminalRecordsPath, terminalRecordBytes);

  const protocolPath = join(portableBundle, 'protocol.v2.json');
  const portableProtocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  portableProtocol.isolation.runtimeExecutable = '/private/nonexistent-bce-execution-host/node';
  writeFileSync(protocolPath, `${JSON.stringify(portableProtocol, null, 2)}\n`);
  const manifest = JSON.parse(readFileSync(join(portableBundle, 'task-manifest.json'), 'utf8'));
  const sealPath = join(portableBundle, 'seal.json');
  const seal = JSON.parse(readFileSync(sealPath, 'utf8'));
  const resealed = expectedSeal(portableBundle, portableProtocol, manifest);
  seal.entries = resealed.entries;
  seal.rootSha256 = resealed.rootSha256;
  seal.attestation.subjectRootSha256 = resealed.rootSha256;
  writeFileSync(sealPath, `${JSON.stringify(seal, null, 2)}\n`);

  const completedVerification = verifyStageBundleForLifecycle(portableBundle, { lifecycle: 'complete' });
  assert.equal(completedVerification.ok, true, completedVerification.refusals.join('\n'));
  assert.equal(completedVerification.hostArtifactsVerified, false);
  const preRunVerification = verifyStageBundleForLifecycle(portableBundle, { lifecycle: 'frozen-ready-not-run' });
  assert.equal(preRunVerification.ok, false, 'pre-run readiness accepted an absent execution-host runtime');
  assert.match(preRunVerification.refusals.join('\n'), /execution runtime artifact/);

  portableProtocol.isolation.runtimeArtifactSha256 = 'f'.repeat(64);
  writeFileSync(protocolPath, `${JSON.stringify(portableProtocol, null, 2)}\n`);
  const tamperedCompleted = verifyStageBundleForLifecycle(portableBundle, { lifecycle: 'complete' });
  assert.equal(tamperedCompleted.ok, false, 'portable completed-stage verification accepted sealed runtime-identity drift');
  assert.match(tamperedCompleted.refusals.join('\n'), /seal entries do not exactly match|seal root digest mismatch/);
} finally {
  rmSync(portableStageScratch, { recursive: true, force: true });
}

assert.equal(CLAIM_CLASSES.length, 6);
assert.equal(new Set(CLAIM_CLASSES.map((entry) => entry.id)).size, 6);
assert.deepEqual(registry.claimClasses, CLAIM_CLASSES);

const stageCell = {
  id: 'transport-cell-a', role: 'transportability', client: 'bce-ollama-tool-client', executable: '/sealed/client.mjs',
  clientVersion: 'bce-ollama-tool-client 1.0.0', clientArtifactSha256: '1'.repeat(64), adapterArtifactSha256: '2'.repeat(64),
  requestedModel: 'model', resolvedModel: `model@sha256:${'3'.repeat(64)}`, modelIdentitySource: 'provider-response', reasoningEffort: 'low',
};
const singleStageBundleCell = { ...stageCell, role: 'primary', adapterSha256: stageCell.adapterArtifactSha256 };
delete singleStageBundleCell.adapterArtifactSha256;
assert.deepEqual(stageExecutionCellBindingRefusals({ id: 'primary-confirmatory' }, { ...stageCell, role: 'primary' }, singleStageBundleCell), []);
assert.deepEqual(stageExecutionCellBindingRefusals({ id: 'transport-a' }, stageCell, singleStageBundleCell), []);
assert.match(
  stageExecutionCellBindingRefusals({ id: 'transport-a' }, stageCell, { ...singleStageBundleCell, role: 'transportability' }).join('\n'),
  /must be primary within its single-stage v2 design/,
);
assert.match(
  stageExecutionCellBindingRefusals({ id: 'transport-a' }, stageCell, { ...singleStageBundleCell, resolvedModel: 'other' }).join('\n'),
  /identity differs from the preregistered cell/,
);
const stageReleaseBinding = { runtimeArtifactSha256: 'a'.repeat(64), installedTreeSha256: 'b'.repeat(64), gitCommit: 'c'.repeat(40) };
const stageTreatment = {
  treatment: {
    engineArtifactSha256: stageReleaseBinding.runtimeArtifactSha256,
    installedTreeSha256: stageReleaseBinding.installedTreeSha256,
    artifactProvenance: { sourceCommit: stageReleaseBinding.gitCommit, publishedPackageByteMatch: true },
  },
};
assert.deepEqual(stageTreatmentReleaseBindingRefusals({ id: 'primary-confirmatory' }, stageTreatment, stageReleaseBinding), []);
const unknownRegistryMatch = clone(stageTreatment);
unknownRegistryMatch.treatment.artifactProvenance.publishedPackageByteMatch = null;
assert.match(
  stageTreatmentReleaseBindingRefusals({ id: 'primary-confirmatory' }, unknownRegistryMatch, stageReleaseBinding).join('\n'),
  /registry-byte identity/,
);

const report = verifyStudyRegistry({ root });
assert.equal(report.valid, true);
assert.equal(typeof report.ready, 'boolean');
assert.equal(report.archives.length, 5);
assert.equal(report.archives.every((archive) => archive.immutable && archive.claimClass === 'apparatus-validation-only'), true);
assert.equal(report.studies[0].lifecycle, protocol.lifecycle);
assert.deepEqual(report.studies[0].claimClasses, protocol.currentClaimClasses);
const unknownCli = spawnSync(process.execPath, [resolve(root, 'scripts/verify-evidence-foundry-registry.mjs'), '--invented-flag'], { cwd: root, encoding: 'utf8' });
assert.equal(unknownCli.status, 2);
assert.match(unknownCli.stderr, /unknown argument/);

const captureCli = resolve(root, 'scripts/capture-evidence-foundry-registry.mjs');
const captureNoArgs = spawnSync(process.execPath, [captureCli], { cwd: root, encoding: 'utf8' });
assert.equal(captureNoArgs.status, 2);
assert.match(captureNoArgs.stderr, /usage:/);
const captureTraversal = spawnSync(process.execPath, [captureCli,
  '--version', '0.3.0', '--source-commit', '1'.repeat(40), '--out-dir', '../outside',
], { cwd: root, encoding: 'utf8' });
assert.equal(captureTraversal.status, 2);
assert.match(captureTraversal.stderr, /repository-relative and traversal-free/);
const captureExisting = spawnSync(process.execPath, [captureCli,
  '--version', '0.3.0', '--source-commit', '1'.repeat(40), '--out-dir', 'research',
], { cwd: root, encoding: 'utf8' });
assert.equal(captureExisting.status, 2);
assert.match(captureExisting.stderr, /already exists.*may not be replaced/);

const runtimeDerivationCli = resolve(root, 'scripts/create-evidence-foundry-runtime-derivation.mjs');
const runtimeDerivationOutsideActions = spawnSync(process.execPath, [runtimeDerivationCli], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, GITHUB_ACTIONS: 'false' },
});
assert.equal(runtimeDerivationOutsideActions.status, 2);
assert.match(runtimeDerivationOutsideActions.stderr, /only by the identified BCE main-branch GitHub Actions workflow/);

const anchorCli = resolve(root, 'scripts/create-evidence-foundry-result-anchor.mjs');
const anchorOutsideActions = spawnSync(process.execPath, [anchorCli,
  '--stage', 'primary-confirmatory', '--results', 'results', '--out', 'anchor.json',
], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'false' } });
assert.equal(anchorOutsideActions.status, 2);
assert.match(anchorOutsideActions.stderr, /only by an identified blueprint-conformance\/bce GitHub Actions run/);

const anchorWorkflow = readFileSync(resolve(root, '.github/workflows/evidence-foundry-anchor.yml'), 'utf8');
assert.match(anchorWorkflow, /workflow_dispatch:/);
assert.match(anchorWorkflow, /id-token: write/);
assert.match(anchorWorkflow, /GITHUB_REF" = "refs\/heads\/main/);
assert.doesNotMatch(anchorWorkflow, /refs\/tags/);
assert.match(anchorWorkflow, /create-evidence-foundry-result-anchor\.mjs/);
assert.match(anchorWorkflow, /verify-evidence-foundry-registry\.mjs --json/);
assert.match(anchorWorkflow, /@sigstore\/cli\/bin\/run attest/);
assert.match(anchorWorkflow, /@sigstore\/cli\/bin\/run verify/);
assert.match(anchorWorkflow, /actions\/upload-artifact@[0-9a-f]{40}/);
const runtimeDerivationWorkflow = readFileSync(resolve(root, '.github/workflows/evidence-foundry-runtime-derivation.yml'), 'utf8');
assert.match(runtimeDerivationWorkflow, /workflow_dispatch:/);
assert.match(runtimeDerivationWorkflow, /id-token: write/);
assert.match(runtimeDerivationWorkflow, /GITHUB_REF" = "refs\/heads\/main/);
assert.match(runtimeDerivationWorkflow, /create-evidence-foundry-runtime-derivation\.mjs/);
assert.doesNotMatch(runtimeDerivationWorkflow, /npm pack/);
assert.match(runtimeDerivationWorkflow, /@sigstore\/cli\/bin\/run attest/);
assert.match(runtimeDerivationWorkflow, /@sigstore\/cli\/bin\/run verify/);
assert.match(runtimeDerivationWorkflow, /actions\/upload-artifact@[0-9a-f]{40}/);

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
  packageName: 'bce-engine',
  studyId: draftRelease.studyId,
  version: '0.3.0',
  gitCommit: '1'.repeat(40),
  sourceTreeSha256: '2'.repeat(64),
  packageArtifactPath: 'research/model-evaluation/studies/evidence-foundry-v3/release.tgz',
  packageArtifactSha256: '3'.repeat(64),
  npmIntegrity: `sha512-${Buffer.from('synthetic').toString('base64')}`,
  registryTarballUrl: 'https://registry.npmjs.org/bce-engine/-/bce-engine-0.3.0.tgz',
  runtimeArtifactPath: 'research/model-evaluation/studies/evidence-foundry-v3/release-runtime.tgz',
  runtimeArtifactSha256: '3'.repeat(64),
  installedTreeSha256: '4'.repeat(64),
  registryVerification: {
    recordPath: 'research/model-evaluation/studies/evidence-foundry-v3/registry-verification.json',
    recordSha256: 'a'.repeat(64),
  },
  runtimeDerivation: {
    statementPath: 'research/model-evaluation/studies/evidence-foundry-v3/runtime-derivation.json',
    statementSha256: 'b'.repeat(64),
    bundlePath: 'research/model-evaluation/studies/evidence-foundry-v3/runtime-derivation.sigstore',
    bundleSha256: 'c'.repeat(64),
    certificateIssuer: RUNTIME_DERIVATION_CERTIFICATE_ISSUER,
    certificateIdentityURI: RUNTIME_DERIVATION_CERTIFICATE_IDENTITY,
  },
  releaseStatePath: 'release-state.json',
  releaseStateSha256: '5'.repeat(64),
  attestationPath: 'research/model-evaluation/studies/evidence-foundry-v3/release-attestation.json',
  attestationSha256: '5'.repeat(64),
};
assertRefuses(() => validateProtocolV3(root, draftRelease), /design draft may not claim a frozen release binding/);

const frozen = frozenProtocol();
validateProtocolV3(root, frozen);
const primaryOnlyProtocol = clone(frozen);
for (const cell of primaryOnlyProtocol.clientModelCells.slice(1)) {
  cell.qualification = { status: 'unqualified', attestationPath: null, attestationSha256: null };
}
validateProtocolV3(root, primaryOnlyProtocol);
const readinessScratch = mkdtempSync(join(tmpdir(), 'bce-evidence-foundry-readiness-'));
try {
  const runtimeDerivationSchemaPath = join(readinessScratch, 'research', 'model-evaluation', 'schemas', 'runtime-derivation.v1.schema.json');
  mkdirSync(dirname(runtimeDerivationSchemaPath), { recursive: true });
  writeFileSync(runtimeDerivationSchemaPath, readFileSync(resolve(root, 'research/model-evaluation/schemas/runtime-derivation.v1.schema.json')));
  const ready = clone(frozen);
  const artifactBytes = (name, bytes) => {
    const absolute = join(readinessScratch, name);
    writeFileSync(absolute, bytes);
    return { path: relative(readinessScratch, absolute), sha256: sha256Bytes(bytes) };
  };
  const artifact = (name, value) => artifactBytes(name, Buffer.from(JSON.stringify(value)));
  const packageArtifact = artifactBytes('release.tgz', Buffer.from('synthetic release artifact'));
  const packageIntegrity = `sha512-${createHash('sha512').update(readFileSync(join(readinessScratch, packageArtifact.path))).digest('base64')}`;
  const packageSha512 = createHash('sha512').update(readFileSync(join(readinessScratch, packageArtifact.path))).digest('hex');
  ready.releaseBinding.packageArtifactPath = packageArtifact.path;
  ready.releaseBinding.packageArtifactSha256 = packageArtifact.sha256;
  ready.releaseBinding.npmIntegrity = packageIntegrity;
  const packageSubject = [{
    name: `pkg:npm/${ready.releaseBinding.packageName}@${ready.releaseBinding.version}`,
    digest: { sha512: packageSha512 },
  }];
  const provenanceStatement = {
    subject: packageSubject,
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        externalParameters: {
          workflow: {
            repository: 'https://github.com/blueprint-conformance/bce',
            path: '.github/workflows/release.yml',
            ref: 'refs/tags/v0.3.0',
          },
        },
        resolvedDependencies: [{
          uri: 'git+https://github.com/blueprint-conformance/bce@refs/tags/v0.3.0',
          digest: { gitCommit: ready.releaseBinding.gitCommit },
        }],
      },
    },
  };
  const dsse = (statement) => ({ dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement)).toString('base64') } });
  const provenanceBundle = artifact('npm-provenance.sigstore', dsse(provenanceStatement));
  const registryVerification = artifact('registry-verification.json', {
    schemaVersion: '1',
    packageName: ready.releaseBinding.packageName,
    version: ready.releaseBinding.version,
    registry: 'https://registry.npmjs.org/',
    tarballUrl: ready.releaseBinding.registryTarballUrl,
    npmIntegrity: packageIntegrity,
    downloadedTarballSha256: packageArtifact.sha256,
    attestationsUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/bce-engine@0.3.0',
    capturedAt: '2026-09-06T00:00:00.000Z',
    provenanceAttestation: {
      path: provenanceBundle.path,
      sha256: provenanceBundle.sha256,
      predicateType: provenanceStatement.predicateType,
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      certificateIdentityURI: 'https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v0.3.0',
    },
  });
  ready.releaseBinding.registryVerification = { recordPath: registryVerification.path, recordSha256: registryVerification.sha256 };
  const runtimeArtifact = artifactBytes('bce-treatment-runtime.tgz', Buffer.from('runtime derived only from synthetic release artifact'));
  ready.releaseBinding.runtimeArtifactPath = runtimeArtifact.path;
  ready.releaseBinding.runtimeArtifactSha256 = runtimeArtifact.sha256;
  ready.releaseBinding.installedTreeSha256 = '4'.repeat(64);
  const runtimeDerivationStatementValue = {
    schemaVersion: '1',
    kind: 'registry-package-runtime-derivation',
    package: {
      name: ready.releaseBinding.packageName,
      version: ready.releaseBinding.version,
      sourceCommit: ready.releaseBinding.gitCommit,
      registryTarballUrl: ready.releaseBinding.registryTarballUrl,
      artifactPath: ready.releaseBinding.packageArtifactPath,
      artifactSha256: ready.releaseBinding.packageArtifactSha256,
      npmIntegrity: ready.releaseBinding.npmIntegrity,
      registryVerificationPath: ready.releaseBinding.registryVerification.recordPath,
      registryVerificationSha256: ready.releaseBinding.registryVerification.recordSha256,
    },
    builder: {
      workflowSourceCommit: '2'.repeat(40),
      workflowRunUrl: 'https://github.com/blueprint-conformance/bce/actions/runs/123/attempts/1',
      nodeVersion: 'v22.22.2',
      npmVersion: '11.19.1',
      platform: 'linux',
      architecture: 'x64',
      installCommand: 'corepack npm@11.19.1 --registry=https://registry.npmjs.org/ install --ignore-scripts --no-audit --no-fund --package-lock=true',
    },
    runtime: {
      archiveName: 'bce-treatment-runtime.tgz',
      artifactSha256: ready.releaseBinding.runtimeArtifactSha256,
      installedTreeSha256: ready.releaseBinding.installedTreeSha256,
    },
    createdAt: '2026-09-06T00:00:00.000Z',
    statementSha256: null,
  };
  runtimeDerivationStatementValue.statementSha256 = sha256Bytes(JSON.stringify(canonical(runtimeDerivationStatementValue)));
  validateRuntimeDerivationStatement(readinessScratch, runtimeDerivationStatementValue);
  const runtimeDerivationStatement = artifact('runtime-derivation.json', runtimeDerivationStatementValue);
  const runtimeDerivationBundle = artifact('runtime-derivation.sigstore', dsse(runtimeDerivationStatementValue));
  ready.releaseBinding.runtimeDerivation = {
    statementPath: runtimeDerivationStatement.path,
    statementSha256: runtimeDerivationStatement.sha256,
    bundlePath: runtimeDerivationBundle.path,
    bundleSha256: runtimeDerivationBundle.sha256,
    certificateIssuer: RUNTIME_DERIVATION_CERTIFICATE_ISSUER,
    certificateIdentityURI: RUNTIME_DERIVATION_CERTIFICATE_IDENTITY,
  };
  let observedRuntimeSigner = null;
  assert.deepEqual(runtimeDerivationEvidenceRefusals(readinessScratch, ready.releaseBinding, {
    verifySigstore: (_root, _bundle, signer) => { observedRuntimeSigner = signer; },
  }), []);
  assert.deepEqual(observedRuntimeSigner, {
    issuer: RUNTIME_DERIVATION_CERTIFICATE_ISSUER,
    identity: RUNTIME_DERIVATION_CERTIFICATE_IDENTITY,
  });
  const releaseState = artifact('release-state.json', {
    currentVersion: ready.releaseBinding.version,
    npmIntegrity: packageIntegrity,
    tarballSha256: packageArtifact.sha256,
    githubReleaseImmutable: true,
    repositoryImmutableReleasesEnabled: true,
    provenanceRunUrl: 'https://github.com/blueprint-conformance/bce/actions/runs/1',
    canonicalReleaseUrl: `https://github.com/blueprint-conformance/bce/releases/tag/v${ready.releaseBinding.version}`,
  });
  ready.releaseBinding.releaseStatePath = releaseState.path;
  ready.releaseBinding.releaseStateSha256 = releaseState.sha256;
  const releaseAttestationValue = {
    schemaVersion: '1',
    studyId: ready.releaseBinding.studyId,
    packageName: ready.releaseBinding.packageName,
    version: ready.releaseBinding.version,
    gitCommit: ready.releaseBinding.gitCommit,
    sourceTreeSha256: ready.releaseBinding.sourceTreeSha256,
    packageArtifactSha256: packageArtifact.sha256,
    npmIntegrity: packageIntegrity,
    registryTarballUrl: ready.releaseBinding.registryTarballUrl,
    runtimeArtifactSha256: ready.releaseBinding.runtimeArtifactSha256,
    installedTreeSha256: ready.releaseBinding.installedTreeSha256,
    registryVerificationSha256: registryVerification.sha256,
    runtimeDerivationStatementSha256: runtimeDerivationStatement.sha256,
    runtimeDerivationBundleSha256: runtimeDerivationBundle.sha256,
    releaseStateSha256: releaseState.sha256,
  };
  const releaseAttestation = artifact('release-attestation.json', releaseAttestationValue);
  ready.releaseBinding.attestationPath = releaseAttestation.path;
  ready.releaseBinding.attestationSha256 = releaseAttestation.sha256;
  const manifest = artifact('task-manifest.json', { sealed: true });
  ready.taskPopulation.manifestPath = manifest.path;
  ready.taskPopulation.manifestSha256 = manifest.sha256;
  ready.artifacts.assignmentSeal = artifact('assignment-seal.json', { sealed: true });
  const evaluatorArtifact = artifactBytes('blinded-evaluator.mjs', readFileSync(resolve(root, protocol.evaluator.evaluatorArtifactPath)));
  const evaluatorRubric = artifactBytes('evaluator-rubric.json', readFileSync(resolve(root, protocol.evaluator.rubricPath)));
  ready.evaluator.evaluatorArtifactPath = evaluatorArtifact.path;
  ready.evaluator.evaluatorArtifactSha256 = evaluatorArtifact.sha256;
  ready.evaluator.rubricPath = evaluatorRubric.path;
  ready.evaluator.rubricSha256 = evaluatorRubric.sha256;
  ready.artifacts.evaluatorLock = artifact('evaluator-lock.json', {
    schemaVersion: '1',
    evaluatorId: ready.evaluator.evaluatorId,
    evaluator: { path: evaluatorArtifact.path, sha256: evaluatorArtifact.sha256 },
    rubric: { path: evaluatorRubric.path, sha256: evaluatorRubric.sha256 },
    armBlind: true,
    deterministicPrimaryOracles: true,
    lockedBeforeHeldoutAccess: true,
  });
  ready.artifacts.integrityLock = artifactBytes('integrity-lock.json', readFileSync(resolve(root, protocol.artifacts.integrityLock.path)));
  ready.artifacts.powerDesign = artifact('power-design.json', powerDesign);
  for (const [index, cell] of ready.clientModelCells.entries()) {
    const attestation = artifact(`qualification-${index}.json`, { qualified: true, cellId: cell.id });
    cell.qualification.attestationPath = attestation.path;
    cell.qualification.attestationSha256 = attestation.sha256;
  }
  const readiness = (candidate, options = {}) => studyReadinessBlockers(readinessScratch, candidate, powerDesign, {
    ...options,
    verifySigstore: () => {},
  });
  assert.deepEqual(registryReleaseEvidenceRefusals(readinessScratch, ready.releaseBinding, { verifySigstore: () => {} }), []);
  assert.deepEqual(readiness(ready).filter((item) => /sealed execution bundle is unset/.test(item)), [
    'primary-confirmatory sealed execution bundle is unset',
    'transport-a sealed execution bundle is unset',
    'transport-b sealed execution bundle is unset',
    'transport-c sealed execution bundle is unset',
  ]);
  const primaryOnly = clone(ready);
  for (const cell of primaryOnly.clientModelCells.slice(1)) {
    cell.qualification = { status: 'unqualified', attestationPath: null, attestationSha256: null };
  }
  assert.deepEqual(readiness(primaryOnly, { stageId: 'primary-confirmatory' }), [
    'primary-confirmatory sealed execution bundle is unset',
  ]);
  mkdirSync(join(readinessScratch, 'fake-bundle'));
  const fakeBundle = clone(primaryOnly);
  fakeBundle.stages[0].executionBundlePath = 'fake-bundle';
  assert.match(readiness(fakeBundle, { stageId: 'primary-confirmatory' }).join('\n'), /execution bundle verifier failed/);
  assert.match(readiness(primaryOnly).join('\n'), /transport-cell-a is not qualified before stage exposure/);
  assertRefuses(() => studyReadinessBlockers(readinessScratch, primaryOnly, powerDesign, { stageId: 'unknown-stage' }), /unknown stage/);
  const wrongIntegrity = clone(ready);
  wrongIntegrity.releaseBinding.npmIntegrity = `sha512-${Buffer.from('wrong bytes').toString('base64')}`;
  assert.match(readiness(wrongIntegrity).join('\n'), /npm integrity does not match/);
  const wrongRegistryUrl = clone(ready);
  wrongRegistryUrl.releaseBinding.registryTarballUrl = 'https://registry.npmjs.org/bce-engine/-/bce-engine-9.9.9.tgz';
  assert.match(readiness(wrongRegistryUrl).join('\n'), /registry tarball URL is not canonical/);
  const falseEvaluatorLock = clone(ready);
  falseEvaluatorLock.artifacts.evaluatorLock = artifact('false-evaluator-lock.json', {
    schemaVersion: '1',
    evaluatorId: ready.evaluator.evaluatorId,
    evaluator: { path: evaluatorArtifact.path, sha256: evaluatorArtifact.sha256 },
    rubric: { path: evaluatorRubric.path, sha256: evaluatorRubric.sha256 },
    armBlind: false,
    deterministicPrimaryOracles: true,
    lockedBeforeHeldoutAccess: true,
  });
  assert.match(readiness(falseEvaluatorLock).join('\n'), /evaluator lock content differs/);
  const falseIntegrityLock = clone(ready);
  falseIntegrityLock.artifacts.integrityLock = artifact('false-integrity-lock.json', { schemaVersion: '1', policyId: 'weaker-policy' });
  assert.match(readiness(falseIntegrityLock).join('\n'), /run-integrity lock differs/);
  const wrongManifest = clone(ready);
  wrongManifest.taskPopulation.manifestSha256 = '0'.repeat(64);
  assert.match(readiness(wrongManifest).join('\n'), /task manifest digest does not match/);

  const wrongRegistryBytes = clone(ready);
  wrongRegistryBytes.releaseBinding.packageArtifactSha256 = '0'.repeat(64);
  assert.match(readiness(wrongRegistryBytes).join('\n'), /registry verification record differs|package artifact digest does not match/);
  const wrongProvenanceCommit = clone(provenanceStatement);
  wrongProvenanceCommit.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'f'.repeat(40);
  const wrongProvenanceBundle = artifact('wrong-provenance.sigstore', dsse(wrongProvenanceCommit));
  const wrongProvenanceRecordValue = JSON.parse(readFileSync(join(readinessScratch, registryVerification.path), 'utf8'));
  wrongProvenanceRecordValue.provenanceAttestation.path = wrongProvenanceBundle.path;
  wrongProvenanceRecordValue.provenanceAttestation.sha256 = wrongProvenanceBundle.sha256;
  const wrongProvenanceRecord = artifact('wrong-registry-verification.json', wrongProvenanceRecordValue);
  const wrongProvenance = clone(ready);
  wrongProvenance.releaseBinding.registryVerification = { recordPath: wrongProvenanceRecord.path, recordSha256: wrongProvenanceRecord.sha256 };
  assert.match(readiness(wrongProvenance).join('\n'), /does not bind the exact BCE release workflow, tag, and source commit/);

  const swappedRuntimeArtifact = artifactBytes('swapped-runtime.tgz', Buffer.from('hostile runtime B'));
  const swappedRuntime = clone(ready);
  swappedRuntime.releaseBinding.runtimeArtifactPath = swappedRuntimeArtifact.path;
  swappedRuntime.releaseBinding.runtimeArtifactSha256 = swappedRuntimeArtifact.sha256;
  swappedRuntime.releaseBinding.installedTreeSha256 = 'f'.repeat(64);
  const swappedReleaseAttestation = artifact('swapped-release-attestation.json', {
    ...releaseAttestationValue,
    runtimeArtifactSha256: swappedRuntime.releaseBinding.runtimeArtifactSha256,
    installedTreeSha256: swappedRuntime.releaseBinding.installedTreeSha256,
  });
  swappedRuntime.releaseBinding.attestationPath = swappedReleaseAttestation.path;
  swappedRuntime.releaseBinding.attestationSha256 = swappedReleaseAttestation.sha256;
  assert.match(
    runtimeDerivationEvidenceRefusals(readinessScratch, swappedRuntime.releaseBinding, { verifySigstore: () => {} }).join('\n'),
    /does not bind the exact executed runtime archive and installed tree/,
  );
  assert.match(readiness(swappedRuntime).join('\n'), /does not bind the exact executed runtime archive and installed tree/);

  const summary = {
    resultSha256: 'd'.repeat(64),
    publicReplay: { checkpointHeadSha256: 'e'.repeat(64) },
  };
  const anchor = {
    schemaVersion: '2',
    anchorKind: 'sigstore-github-oidc-result-anchor',
    studyId: ready.studyId,
    executionStudyId: 'bce-primary-execution',
    stageId: ready.stages[0].id,
    resultSha256: summary.resultSha256,
    checkpointHeadSha256: summary.publicReplay.checkpointHeadSha256,
    releasePackageArtifactSha256: ready.releaseBinding.packageArtifactSha256,
    releaseRegistryVerificationSha256: ready.releaseBinding.registryVerification.recordSha256,
    resultSourceCommit: '1'.repeat(40),
    anchorWorkflowCommit: '1'.repeat(40),
    operatorModel: 'solo-maintainer-machine-adjudicated',
    operatorIndependence: 'author-controlled-not-independent',
    publicUrl: 'https://github.com/blueprint-conformance/bce/actions/runs/123/attempts/1',
    anchoredAt: '2026-09-06T00:00:00.000Z',
    anchorSha256: null,
  };
  anchor.anchorSha256 = sha256Bytes(JSON.stringify(canonical(anchor)));
  const anchorArtifact = artifact('primary-result-anchor.json', anchor);
  const anchorBundle = artifact('primary-result-anchor.sigstore', {
    dsseEnvelope: { payload: readFileSync(join(readinessScratch, anchorArtifact.path)).toString('base64') },
  });
  const anchoredStage = clone(ready.stages[0]);
  anchoredStage.resultEvidence = {
    resultsPath: 'results',
    resultSha256: summary.resultSha256,
    checkpointHeadSha256: summary.publicReplay.checkpointHeadSha256,
    externalAnchorPath: anchorArtifact.path,
    externalAnchorSha256: anchorArtifact.sha256,
    externalAnchorBundlePath: anchorBundle.path,
    externalAnchorBundleSha256: anchorBundle.sha256,
    externalAnchorCertificateIssuer: 'https://token.actions.githubusercontent.com',
    externalAnchorCertificateIdentityURI: 'https://github.com/blueprint-conformance/bce/.github/workflows/evidence-foundry-anchor.yml@refs/heads/main',
  };
  assert.deepEqual(externalResultAnchorRefusals(
    readinessScratch, ready, anchoredStage, anchor.executionStudyId, summary, { verifySigstore: () => {} },
  ), []);
  const spoofedBundle = artifact('spoofed-result-anchor.sigstore', dsse({ ...anchor, resultSha256: '0'.repeat(64) }));
  const spoofedStage = clone(anchoredStage);
  spoofedStage.resultEvidence.externalAnchorBundlePath = spoofedBundle.path;
  spoofedStage.resultEvidence.externalAnchorBundleSha256 = spoofedBundle.sha256;
  assert.match(externalResultAnchorRefusals(
    readinessScratch, ready, spoofedStage, anchor.executionStudyId, summary, { verifySigstore: () => {} },
  ).join('\n'), /Sigstore payload differs from the exact anchor bytes/);
} finally {
  rmSync(readinessScratch, { recursive: true, force: true });
}
const primaryComplete = clone(frozen);
beginRun(primaryComplete);
primaryComplete.stages[0].lifecycle = 'complete';
primaryComplete.currentClaimClasses = ['bounded-primary-causal-effect-exact-cell-release-and-task-population'];
assertRefuses(
  () => validateProtocolV3(root, primaryComplete),
  /registry verification record.*(?:ENOENT|no such file)|complete without public result evidence/,
);
try {
  validateProtocolV3(root, primaryComplete);
  assert.fail('claim-bearing protocol with unavailable registry proof must refuse');
} catch (error) {
  assert.match(error.message, /registry verification record/);
  assert.match(error.message, /complete without public result evidence/);
}
const prematureTransport = clone(frozen);
beginRun(prematureTransport);
prematureTransport.stages[1].lifecycle = 'running';
assertRefuses(() => validateProtocolV3(root, prematureTransport), /transport stage may not start before the primary stage completes/);
const transportComplete = clone(primaryComplete);
transportComplete.stages[1].lifecycle = 'complete';
transportComplete.currentClaimClasses.push('bounded-transportability-causal-effect-exact-cell-release-and-task-population');
assertRefuses(() => validateProtocolV3(root, transportComplete), /complete without public result evidence/);
const allComplete = clone(frozen);
beginRun(allComplete);
allComplete.lifecycle = 'complete';
for (const stage of allComplete.stages) stage.lifecycle = 'complete';
allComplete.currentClaimClasses = [
  'bounded-primary-causal-effect-exact-cell-release-and-task-population',
  'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
  'bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population',
];
assertRefuses(() => validateProtocolV3(root, allComplete), /complete without public result evidence/);
const falseIndependent = clone(allComplete);
falseIndependent.currentClaimClasses.push('independent-replication-exact-frozen-scope');
assertRefuses(() => validateProtocolV3(root, falseIndependent), /require exact claim classes/);
const independent = clone(falseIndependent);
independent.operatorModel = 'independent-replication';
assertRefuses(() => validateProtocolV3(root, independent), /must be equal to constant/);
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

const canaryTestRootName = `.canary-publication-selftest-${process.pid}`;
const canaryTestRoot = join(root, canaryTestRootName);
const canaryScript = join(root, 'scripts', 'run-model-evaluation-canary.mjs');
const runCanaryRefusal = (extraArguments, pattern) => {
  const result = spawnSync(process.execPath, [
    canaryScript,
    '--ollama-model', 'must-not-be-contacted',
    '--client', 'bce-ollama-tool-client',
    '--runtime-derivation', 'must-not-be-read.json',
    ...extraArguments,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, pattern);
};
rmSync(canaryTestRoot, { recursive: true, force: true });
mkdirSync(canaryTestRoot);
try {
  const existingRoot = `${canaryTestRootName}/existing`;
  mkdirSync(join(root, existingRoot));
  runCanaryRefusal([
    '--public-replay-root', existingRoot,
    '--out', `${existingRoot}/qualification-attestation.json`,
  ], /public replay destination already exists/);

  runCanaryRefusal([
    '--public-replay-root', `../${canaryTestRootName}-escape`,
    '--out', join(dirname(root), `${canaryTestRootName}-escape`, 'qualification-attestation.json'),
  ], /normalized repository-relative path without traversal/);
  assert.equal(existsSync(join(dirname(root), `${canaryTestRootName}-escape`)), false);

  symlinkSync(canaryTestRoot, join(canaryTestRoot, 'linked-parent'), 'dir');
  const symlinkRoot = `${canaryTestRootName}/linked-parent/publication`;
  runCanaryRefusal([
    '--public-replay-root', symlinkRoot,
    '--out', `${symlinkRoot}/qualification-attestation.json`,
  ], /path traverses a symlink/);

  const nonFirstPartyRoot = `${canaryTestRootName}/non-first-party`;
  const nonFirstParty = spawnSync(process.execPath, [
    canaryScript,
    '--ollama-model', 'must-not-be-contacted',
    '--client', 'codex',
    '--runtime-derivation', 'must-not-be-read.json',
    '--public-replay-root', nonFirstPartyRoot,
    '--out', `${nonFirstPartyRoot}/qualification-attestation.json`,
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(nonFirstParty.status, 2, nonFirstParty.stderr || nonFirstParty.stdout);
  assert.match(nonFirstParty.stderr, /requires the first-party bce-ollama-tool-client/);
  assert.equal(existsSync(join(root, nonFirstPartyRoot)), false);
} finally {
  rmSync(canaryTestRoot, { recursive: true, force: true });
}

console.log('Evidence Foundry v3 foundation self-test: PASS');
