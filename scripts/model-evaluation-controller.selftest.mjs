#!/usr/bin/env node
/** Drive the real controller with a no-model fixture through normal and faulted exposed runs. */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expectedSeal, hashTree, sha256Bytes, sha256Json, verifyBundle, verifyTerminalRecord } from './lib/model-evaluation.mjs';

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

function startFakeOllama(name, { flipDigestAfterFirstTags = false, omitActiveModel = false } = {}) {
  const serverPath = join(scratch, `${name}-ollama-server.mjs`);
  const portPath = join(scratch, `${name}-ollama-port.txt`);
  const modelDigest = sha256Bytes(`${name}-model`);
  const changedDigest = sha256Bytes(`${name}-changed-model`);
  writeFileSync(serverPath, `import http from 'node:http'; import fs from 'node:fs'; let tags=0; const model=${JSON.stringify('fixture-local:32b')}; const expected=${JSON.stringify(modelDigest)}; const changed=${JSON.stringify(changedDigest)}; const flip=${JSON.stringify(flipDigestAfterFirstTags)}; const omit=${JSON.stringify(omitActiveModel)}; const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json'); if(req.url==='/api/version') return res.end(JSON.stringify({version:'0.20.6-fixture'})); if(req.url==='/api/tags'){const digest=flip&&tags++>0?changed:expected;return res.end(JSON.stringify({models:[{name:model,model,digest,size:20201253829}]}));} if(req.url==='/api/ps'){const digest=flip&&tags>1?changed:expected;return res.end(JSON.stringify({models:omit?[]:[{name:model,model,digest,size:31232580640,size_vram:17179869184,context_length:40960}]}));} res.statusCode=404;res.end(JSON.stringify({error:'not found'}));}); server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(portPath)},String(server.address().port))); process.on('SIGTERM',()=>server.close(()=>process.exit(0)));\n`);
  const child = spawn(process.execPath, [serverPath], { stdio: ['ignore', 'ignore', 'pipe'] });
  const deadline = Date.now() + 5000;
  while (!existsSync(portPath) && Date.now() < deadline) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  if (!existsSync(portPath)) throw new Error(`${name}: fake Ollama did not start`);
  const port = Number(readFileSync(portPath, 'utf8'));
  return {
    child,
    modelDigest,
    provider: {
      kind: 'ollama', endpoint: `http://127.0.0.1:${port}`, serverVersion: '0.20.6-fixture',
      modelName: 'fixture-local:32b', modelDigest, modelSizeBytes: 20201253829, authentication: 'none',
    },
  };
}

function stopFakeOllama(server) {
  if (!server?.child.killed) server.child.kill('SIGTERM');
}

function prepareBundle(name) {
  const bundle = join(scratch, name, 'bundle');
  cpSync(sourceBundle, bundle, { recursive: true });
  copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'protocol.schema.json'), join(bundle, 'schemas', 'protocol.schema.json'));
  copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'terminal-record.schema.json'), join(bundle, 'schemas', 'terminal-record.schema.json'));
  copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'study-halt.schema.json'), join(bundle, 'schemas', 'study-halt.schema.json'));
  copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'safety-halt-archive.schema.json'), join(bundle, 'schemas', 'safety-halt-archive.schema.json'));
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
  protocol.implementation.referenceVerifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-reference-patches.mjs')));
  protocol.implementation.providerVerifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-provider.mjs')));
  protocol.implementation.haltVerifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-halt.mjs')));
  protocol.implementation.publicExporterSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'export-model-evaluation-public.mjs')));
  protocol.implementation.publicVerifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-public.mjs')));
  protocol.implementation.studyHaltSchemaSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'study-halt.schema.json')));
  protocol.implementation.safetyHaltArchiveSchemaSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'safety-halt-archive.schema.json')));
  protocol.implementation.canaryRunnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation-canary.mjs')));
  protocol.treatment.artifactProvenance.sourceTreeState = 'clean';
  const nvmRuntime = process.env.NVM_BIN ? join(process.env.NVM_BIN, 'node') : null;
  const runtimeExecutable = nvmRuntime && existsSync(nvmRuntime) ? nvmRuntime : process.execPath;
  protocol.isolation.executionDriver = 'macos-sandbox-exec';
  protocol.isolation.executionDriverSha256 = sha256Bytes(readFileSync('/usr/bin/sandbox-exec'));
  protocol.isolation.runtimeExecutable = runtimeExecutable;
  protocol.isolation.runtimeVersion = `${spawnSync(runtimeExecutable, ['--version'], { encoding: 'utf8' }).stdout}`.trim();
  protocol.isolation.runtimeArtifactSha256 = sha256Bytes(readFileSync(runtimeExecutable));
  protocol.isolation.clientSandboxMode = 'outer-controller-profile-only';
  protocol.isolation.modelNetworkPolicy = null;
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

function prepareLocalProviderBundle(name, provider) {
  const prepared = prepareBundle(name);
  const protocolPath = join(prepared.bundle, 'protocol.v2.json');
  const manifestPath = join(prepared.bundle, 'task-manifest.json');
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  protocol.isolation.modelNetworkPolicy = 'loopback-only-single-endpoint';
  protocol.clientModelCells[0] = {
    ...protocol.clientModelCells[0],
    client: 'codex',
    executable: fixtureClient,
    clientVersion: 'fixture-agent 1.0.0',
    clientArtifactSha256: sha256Bytes(readFileSync(fixtureClient)),
    requestedModel: provider.modelName,
    resolvedModel: `${provider.modelName}@sha256:${provider.modelDigest}`,
    modelIdentitySource: 'ollama-api-version-and-tags-before-and-after-attempt',
    modelIdentityEvidence: 'provider-response',
    localProvider: provider,
  };
  for (const task of manifest.tasks) task.budget.maxCostUsd = null;
  writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const expected = expectedSeal(prepared.bundle, protocol, manifest);
  writeFileSync(join(prepared.bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-05T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-local-provider-controller-self-test',
    attestation: {
      kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256,
      uri: 'https://example.invalid/synthetic-local-provider-controller-self-test', identity: 'controller-self-test',
      eligibleForProductClaim: false,
    },
  }, null, 2)}\n`);
  return prepared;
}

function prepareSymlinkReplayBundle() {
  const prepared = prepareBundle('symlink-replay-refusal');
  const protocol = JSON.parse(readFileSync(join(prepared.bundle, 'protocol.v2.json'), 'utf8'));
  const manifestPath = join(prepared.bundle, 'task-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const assignment = manifest.assignments[0];
  const task = manifest.tasks.find((entry) => entry.id === assignment.taskId);
  const repository = manifest.repositories.find((entry) => entry.id === assignment.repositoryId);
  const repositoryRoot = join(prepared.bundle, repository.treePath);
  mkdirSync(join(repositoryRoot, 'src'), { recursive: true });
  writeFileSync(join(repositoryRoot, 'src', 'service.mjs'), "export const service = 'original';\n");
  writeFileSync(join(repositoryRoot, 'src', 'gateway.mjs'), "export const gateway = 'must-not-be-replayed-through-a-link';\n");
  repository.treeSha256 = hashTree(repositoryRoot);
  repository.preparedTreeSha256 = repository.treeSha256;
  const promptPath = join(prepared.bundle, task.prompt.path);
  const promptBytes = Buffer.from('Create a symbolic-link output fixture. Only edit src/service.mjs.\n');
  writeFileSync(promptPath, promptBytes);
  task.prompt.sha256 = sha256Bytes(promptBytes);
  task.prompt.bytes = promptBytes.byteLength;
  task.allowedPaths = ['src/service.mjs'];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const expected = expectedSeal(prepared.bundle, protocol, manifest);
  writeFileSync(join(prepared.bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-05T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-symlink-replay-controller-self-test',
    attestation: { kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256, uri: 'https://example.invalid/synthetic-symlink-replay-controller-self-test', identity: 'controller-self-test', eligibleForProductClaim: false },
  }, null, 2)}\n`);
  return { ...prepared, assignment };
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
  const syntheticCodexHome = join(scratch, 'synthetic-codex-source');
  mkdirSync(syntheticCodexHome, { recursive: true, mode: 0o700 });
  writeFileSync(join(syntheticCodexHome, 'auth.json'), '{"synthetic":"controller-self-test-only"}\n', { mode: 0o600 });
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
  ], { cwd: root, env: { ...process.env, CODEX_HOME: syntheticCodexHome }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`credential retirement fixture failed:\n${result.stdout}\n${result.stderr}`);
  const trialId = manifest.assignments[0].trialId;
  const terminal = JSON.parse(readFileSync(join(runs, 'trials', trialId, 'a0', 'terminal.json'), 'utf8'));
  const isolation = JSON.parse(readFileSync(join(runs, 'trials', trialId, 'a0', 'isolation-proof.json'), 'utf8'));
  if (terminal.status !== 'completed' || isolation.clientSessionObserved !== true || isolation.credentialRetiredBeforeModelToolExecution !== true || isolation.modelToolExecutionObservedBeforeCredentialRetirement !== false) {
    throw new Error(`credential retirement was not proven before the synthetic model command: ${JSON.stringify(isolation)}`);
  }
}

function executeLocalProviderIsolation() {
  const server = startFakeOllama('stable-local');
  try {
    const { bundle, runs } = prepareLocalProviderBundle('local-provider-isolation', server.provider);
    const sourceCodexHome = join(scratch, 'local-provider-must-ignore-auth');
    mkdirSync(sourceCodexHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(sourceCodexHome, 'auth.json'), '{"must":"not-be-copied"}\n', { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
    ], { cwd: root, env: { ...process.env, CODEX_HOME: sourceCodexHome }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`local provider fixture failed:\n${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
    const trialId = manifest.assignments[0].trialId;
    const terminal = JSON.parse(readFileSync(join(runs, 'trials', trialId, 'a0', 'terminal.json'), 'utf8'));
    const isolation = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.isolationProof.sha256), 'utf8'));
    if (terminal.status !== 'completed' || terminal.derived.modelIdentityVerified !== true || isolation.authenticationAbsent !== true ||
        isolation.providerReachable !== true || isolation.providerIdentityStable !== true || isolation.externalNetworkDenied !== true || isolation.nonProviderLoopbackDenied !== true) {
      throw new Error(`local provider identity/isolation proof was incomplete: ${JSON.stringify(isolation)}`);
    }
    if (isolation.providerIdentityAfter.activeModel.runtimeSizeBytes === server.provider.modelSizeBytes || isolation.providerIdentityAfter.activeModel.contextLength !== 40960) {
      throw new Error('local provider proof did not retain distinct runtime-size/context diagnostics');
    }
    const protocolPath = join(bundle, 'protocol.v2.json');
    const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
    protocol.clientModelCells[0].localProvider.endpoint = 'https://example.com:443';
    writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
    const refused = verifyBundle(bundle, { requireSealed: false });
    if (refused.ok || !refused.refusals.some((message) => message.includes('explicit loopback port'))) {
      throw new Error('non-loopback local provider endpoint was not refused');
    }
  } finally {
    stopFakeOllama(server);
  }
}

function executeSymlinkReplayRefusal() {
  const { bundle, runs, assignment } = prepareSymlinkReplayBundle();
  const result = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`symlink replay fixture controller failed:\n${result.stdout}\n${result.stderr}`);
  const terminalPath = join(runs, 'trials', assignment.trialId, 'a0', 'terminal.json');
  const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
  const bundleVerification = verifyBundle(bundle, { requireSealed: true });
  if (!bundleVerification.ok) throw new Error(`symlink fixture bundle refused: ${bundleVerification.refusals.join('; ')}`);
  verifyTerminalRecord(terminal, { bundle: bundleVerification, runsRoot: runs, terminalPath });
  const architecture = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.architectureOracle.sha256), 'utf8'));
  const transcript = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.transcript.sha256), 'utf8'));
  if (terminal.status !== 'infrastructure-error' || architecture.executed !== false || !JSON.stringify(transcript).includes('symbolic-link output replay is refused')) {
    throw new Error('allowed-path symlink was not terminalized before oracle replay');
  }
}

function executeProviderIdentityDriftRefusal() {
  const server = startFakeOllama('drifting-local', { flipDigestAfterFirstTags: true });
  try {
    const { bundle, runs } = prepareLocalProviderBundle('local-provider-identity-drift', server.provider);
    const result = spawnSync(process.execPath, [
      'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
    ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`provider drift fixture controller failed:\n${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
    const trialId = manifest.assignments[0].trialId;
    const terminalPath = join(runs, 'trials', trialId, 'a0', 'terminal.json');
    const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
    const bundleVerification = verifyBundle(bundle, { requireSealed: true });
    if (!bundleVerification.ok) throw new Error(`provider drift bundle refused: ${bundleVerification.refusals.join('; ')}`);
    verifyTerminalRecord(terminal, { bundle: bundleVerification, runsRoot: runs, terminalPath });
    const isolation = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.isolationProof.sha256), 'utf8'));
    const policy = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.policyDiff.sha256), 'utf8'));
    const patch = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.patch.sha256), 'utf8'));
    if (terminal.status !== 'infrastructure-error' || isolation.providerIdentityBefore?.matched !== true || isolation.providerIdentityAfter?.matched !== false || isolation.providerIdentityStable !== false) {
      throw new Error('post-exposure local-provider identity drift was not retained as an infrastructure error');
    }
    if (policy.assessmentComplete !== true || policy.mutationObserved !== false || policy.failClosedForOutcome !== false || patch.available === false || terminal.derived.policyMutation !== false || terminal.derived.policyAssessmentComplete !== true) {
      throw new Error('post-exposure provider drift erased evidence or mislabeled unknown policy state as manipulation');
    }
  } finally {
    stopFakeOllama(server);
  }
}

function executeMissingActiveProviderRefusal() {
  const server = startFakeOllama('missing-active-local', { omitActiveModel: true });
  try {
    const { bundle, runs } = prepareLocalProviderBundle('local-provider-missing-active', server.provider);
    const result = spawnSync(process.execPath, [
      'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
    ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) throw new Error(`missing-active fixture controller failed:\n${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
    const terminal = JSON.parse(readFileSync(join(runs, 'trials', manifest.assignments[0].trialId, 'a0', 'terminal.json'), 'utf8'));
    const isolation = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.isolationProof.sha256), 'utf8'));
    if (terminal.status !== 'infrastructure-error' || isolation.providerIdentityAfter?.activeModel !== null || isolation.providerIdentityStable !== false) {
      throw new Error('missing active model was not retained as an infrastructure error');
    }
  } finally {
    stopFakeOllama(server);
  }
}

function executeFirstClassSafetyHalt() {
  const pretrigger = prepareBundle('conflicting-pretrigger-safety-halt');
  mkdirSync(pretrigger.runs, { recursive: true });
  writeFileSync(join(pretrigger.runs, 'study-halt.json'), '{}\n');
  const pretriggerRefusal = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', pretrigger.bundle, '--runs', pretrigger.runs, '--execute-sealed-study',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (pretriggerRefusal.status !== 1 || !/conflicts with the committed ledger/.test(pretriggerRefusal.stderr)) {
    throw new Error('pre-trigger study halt did not fail closed as conflicting state');
  }

  const { bundle, runs } = prepareBundle('first-class-safety-halt');
  const protocolPath = join(bundle, 'protocol.v2.json');
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
  protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures = 1;
  writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  const expected = expectedSeal(bundle, protocol, manifest);
  writeFileSync(join(bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-05T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-first-class-halt-self-test',
    attestation: { kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256, uri: 'https://example.invalid/synthetic-first-class-halt-self-test', identity: 'controller-self-test', eligibleForProductClaim: false },
  }, null, 2)}\n`);
  const first = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], { cwd: root, env: { ...process.env, BCE_MODEL_EVAL_FAULT_AT: 'after-client' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (first.status !== 3) throw new Error(`safety halt did not exit 3:\n${first.stdout}\n${first.stderr}`);
  const haltPath = join(runs, 'study-halt.json');
  const firstBytes = readFileSync(haltPath, 'utf8');
  const halt = JSON.parse(firstBytes);
  if (halt.schemaVersion !== '2' || halt.trigger.rule !== 'consecutive-post-exposure-infrastructure-failures' || halt.evidence.committedTrials !== 1 || halt.evidence.plannedTrials !== manifest.assignments.length || halt.haltSha256 !== sha256Json({ ...halt, haltSha256: null })) {
    throw new Error(`first-class halt is incomplete: ${firstBytes}`);
  }
  const resumed = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (resumed.status !== 3 || readFileSync(haltPath, 'utf8') !== firstBytes) {
    throw new Error('rerun did not validate and preserve the existing immutable safety halt');
  }
  const tampered = { ...halt, trigger: { ...halt.trigger, observed: halt.trigger.observed + 1 }, haltSha256: null };
  tampered.haltSha256 = sha256Json(tampered);
  writeFileSync(haltPath, `${JSON.stringify(tampered, null, 2)}\n`);
  const refused = spawnSync(process.execPath, [
    'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study',
  ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (refused.status !== 1 || !/does not recompute/.test(refused.stderr)) throw new Error('conflicting safety halt was not refused as corruption');
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
executeLocalProviderIsolation();
executeSymlinkReplayRefusal();
executeProviderIdentityDriftRefusal();
executeMissingActiveProviderRefusal();
executeFirstClassSafetyHalt();
process.stdout.write('model-evaluation controller self-test: PASS (outer-only strict sandbox + MCP done-check preflight; 8/8 normal rows; nested-sandbox regression refused; 8/8 caught faults terminalized; hard crash recovered; credential retired before hosted model command; credential-free loopback provider identity stable with unequal artifact/runtime sizes; external and wrong-port network denied; allowed-path symlink replay refused before oracles; provider digest drift and missing-active failures retained without erasing policy evidence; pre-trigger, replayed, and tampered safety-halt states fail closed; first-class halt exits 3; aggregate tamper refused; pilot recommendation impossible)\n');
rmSync(scratch, { recursive: true, force: true });
