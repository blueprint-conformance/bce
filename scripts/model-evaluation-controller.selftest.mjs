#!/usr/bin/env node
/** Drive the real controller with a no-model fixture through normal and faulted exposed runs. */
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedSeal, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';

if (process.platform !== 'darwin') {
  process.stderr.write('controller self-test requires the same macOS sandbox-exec driver as the accelerated pilot\n');
  process.exit(2);
}
const root = process.cwd();
const sourceBundle = join(root, 'research', 'model-evaluation', 'pilots', 'accelerated-v2');
const scratch = mkdtempSync(join(tmpdir(), 'bce-controller-selftest-'));
const fixtureClient = join(scratch, 'fixture-client.mjs');
copyFileSync(join(root, 'scripts', 'fixtures', 'model-evaluation-fake-client.mjs'), fixtureClient);
chmodSync(fixtureClient, 0o755);

function prepareBundle(name) {
  const bundle = join(scratch, name, 'bundle');
  cpSync(sourceBundle, bundle, { recursive: true });
  const protocolPath = join(bundle, 'protocol.v2.json');
  const manifestPath = join(bundle, 'task-manifest.json');
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const currentRunnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs')));
  protocol.implementation.verifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs')));
  protocol.implementation.assignmentGeneratorSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs')));
  protocol.implementation.runnerSha256 = currentRunnerSha256;
  protocol.implementation.analyzerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs')));
  protocol.implementation.analysisCoreSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-analysis.mjs')));
  protocol.treatment.artifactProvenance.sourceTreeState = 'clean';
  protocol.clientModelCells[0] = {
    ...protocol.clientModelCells[0],
    client: 'fixture-agent',
    executable: fixtureClient,
    clientVersion: 'fixture-agent 1.0.0',
    clientArtifactSha256: sha256Bytes(readFileSync(fixtureClient)),
    adapterSha256: currentRunnerSha256,
    requestedModel: 'fixture-model-v1',
    resolvedModel: 'fixture-model-v1',
    modelIdentitySource: 'synthetic-fixture-output',
    modelIdentityEvidence: 'synthetic-response',
  };
  protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures = 99;
  protocol.stopping.failureRateMinimumExposed = 99;
  writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  const expected = expectedSeal(bundle, protocol, manifest);
  writeFileSync(join(bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-03T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-controller-self-test',
    attestation: {
      kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256,
      uri: 'https://example.invalid/synthetic-controller-self-test', identity: 'controller-self-test',
      eligibleForProductClaim: false,
    },
  }, null, 2)}\n`);
  return { bundle, runs: join(scratch, name, 'runs') };
}

function execute(name, fault = null) {
  const { bundle, runs } = prepareBundle(name);
  const env = { ...process.env };
  if (fault) env.BCE_MODEL_EVAL_FAULT_AT = fault;
  const result = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name} controller run failed:\n${result.stdout}\n${result.stderr}`);
  const analysis = JSON.parse(execFileSync(process.execPath, [
    'scripts/analyze-model-evaluation.mjs', '--bundle', bundle, '--runs', runs,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  if (analysis.verifiedTrials !== 8 || analysis.productDecision.decision !== 'ineligible-instrumentation-pilot-no-efficacy-decision') {
    throw new Error(`${name}: pilot analyzer did not retain 8 claim-ineligible rows`);
  }
  return { analysis, output: result.stdout, bundle, runs };
}

function executeHardCrashRecovery() {
  const { bundle, runs } = prepareBundle('hard-crash-recovery');
  const crashed = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], {
    cwd: root,
    env: { ...process.env, BCE_MODEL_EVAL_FAULT_AT: 'hard-crash-after-client' },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (crashed.signal !== 'SIGKILL') throw new Error(`hard-crash fixture was not killed as intended: ${crashed.status}/${crashed.signal}\n${crashed.stderr}`);
  const resumed = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (resumed.status !== 0) throw new Error(`controller did not recover hard crash:\n${resumed.stdout}\n${resumed.stderr}`);
  const analysis = JSON.parse(execFileSync(process.execPath, [
    'scripts/analyze-model-evaluation.mjs', '--bundle', bundle, '--runs', runs,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const statuses = Object.values(analysis.cells['primary-codex-mini'].arms)
    .reduce((counts, arm) => {
      for (const [status, count] of Object.entries(arm.statuses)) counts[status] = (counts[status] ?? 0) + count;
      return counts;
    }, {});
  if (analysis.verifiedTrials !== 8 || statuses['infrastructure-error'] !== 1 || statuses.completed !== 7) {
    throw new Error(`hard-crash recovery did not preserve the denominator: ${JSON.stringify(statuses)}`);
  }
}

function executeCredentialRetirement() {
  const { bundle, runs } = prepareBundle('credential-retirement');
  const protocolPath = join(bundle, 'protocol.v2.json');
  const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  protocol.clientModelCells[0].client = 'codex';
  protocol.clientModelCells[0].modelIdentitySource = 'codex-requested-model-cli-accepted-no-provider-id';
  protocol.clientModelCells[0].modelIdentityEvidence = 'client-request-configuration';
  writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  const expected = expectedSeal(bundle, protocol, manifest);
  writeFileSync(join(bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-03T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-controller-self-test',
    attestation: { kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256, uri: 'https://example.invalid/synthetic-controller-self-test', identity: 'controller-self-test', eligibleForProductClaim: false },
  }, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`credential retirement fixture failed:\n${result.stdout}\n${result.stderr}`);
  const trialId = manifest.assignments[0].trialId;
  const terminal = JSON.parse(readFileSync(join(runs, 'trials', trialId, 'a0', 'terminal.json'), 'utf8'));
  const isolation = JSON.parse(readFileSync(join(runs, 'trials', trialId, 'a0', 'isolation-proof.json'), 'utf8'));
  if (terminal.status !== 'completed' || isolation.clientSessionObserved !== true || isolation.credentialRetiredBeforeModelToolExecution !== true || isolation.modelToolExecutionObservedBeforeCredentialRetirement !== false) {
    throw new Error(`credential retirement was not proven before the synthetic model command: ${JSON.stringify(isolation)}`);
  }
}

const normal = execute('normal');
const safe = normal.analysis.cells['primary-codex-mini'].arms;
if (safe['baseline-no-bce'].safeSuccessfulCompletion.successes !== 4 || safe['bce-enabled'].safeSuccessfulCompletion.successes !== 4) {
  throw new Error('normal fixture did not prove the real controller/oracles across both arms');
}
const publicOut = join(scratch, 'normal-public');
execFileSync(process.execPath, [
  'scripts/export-model-evaluation-public.mjs', '--bundle', normal.bundle, '--runs', normal.runs, '--out', publicOut,
], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const publicSummary = JSON.parse(readFileSync(join(publicOut, 'summary.json'), 'utf8'));
if (publicSummary.verifiedTrials !== 8 || publicSummary.restrictedEvidence.commitments.length !== 8 ||
    publicSummary.restrictedEvidence.commitments.some((commitment) => existsSync(join(publicOut, 'cas', 'sha256', commitment.sha256)))) {
  throw new Error('public exporter did not preserve transcript commitments while excluding restricted transcript bytes');
}
const publicVerification = spawnSync(process.execPath, [
  'scripts/verify-model-evaluation-public.mjs', '--bundle', normal.bundle, '--results', publicOut,
], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (publicVerification.status !== 0) throw new Error(`public replay failed:\n${publicVerification.stderr}`);
const tamperedSummary = structuredClone(publicSummary);
tamperedSummary.analysis.cells['primary-codex-mini'].arms['baseline-no-bce'].taskSuccess.successes = 0;
tamperedSummary.analysis.resultSha256 = sha256Json({ ...tamperedSummary.analysis, resultSha256: null });
tamperedSummary.resultSha256 = sha256Json({ ...tamperedSummary, resultSha256: null });
writeFileSync(join(publicOut, 'summary.json'), `${JSON.stringify(tamperedSummary, null, 2)}\n`);
const tamperedVerification = spawnSync(process.execPath, [
  'scripts/verify-model-evaluation-public.mjs', '--bundle', normal.bundle, '--results', publicOut,
], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (tamperedVerification.status === 0 || !/aggregate analysis does not recompute/.test(tamperedVerification.stderr)) {
  throw new Error('public verifier accepted self-rehashed aggregate analysis tamper');
}
const faulted = execute('fault-after-client', 'after-client');
for (const arm of Object.values(faulted.analysis.cells['primary-codex-mini'].arms)) {
  if (arm.statuses['infrastructure-error'] !== 4 || arm.safeSuccessfulCompletion.successes !== 0) {
    throw new Error('post-exposure fault was not terminalized as an ITT infrastructure failure');
  }
}
executeHardCrashRecovery();
executeCredentialRetirement();
process.stdout.write('model-evaluation controller self-test: PASS (strict sandbox + MCP preflight; 8/8 normal rows; 8/8 caught faults terminalized; hard crash recovered; credential retired before model command; aggregate tamper refused; pilot recommendation impossible)\n');
rmSync(scratch, { recursive: true, force: true });
