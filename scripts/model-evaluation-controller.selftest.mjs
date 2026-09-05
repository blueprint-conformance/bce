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

function startFakeOllama(name, { flipDigestAfterFirstTags = false, omitActiveModel = false, serveToolLoop = false } = {}) {
  const serverPath = join(scratch, `${name}-ollama-server.mjs`);
  const portPath = join(scratch, `${name}-ollama-port.txt`);
  const modelDigest = sha256Bytes(`${name}-model`);
  const changedDigest = sha256Bytes(`${name}-changed-model`);
  writeFileSync(serverPath, `import http from 'node:http';
import fs from 'node:fs';
let tags=0;
const model=${JSON.stringify('fixture-local:32b')};
const expected=${JSON.stringify(modelDigest)};
const changed=${JSON.stringify(changedDigest)};
const flip=${JSON.stringify(flipDigestAfterFirstTags)};
const omit=${JSON.stringify(omitActiveModel)};
const serveToolLoop=${JSON.stringify(serveToolLoop)};
const response=(res,value)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value))};
const server=http.createServer((req,res)=>{
  if(req.url==='/api/version')return response(res,{version:'0.20.6-fixture'});
  if(req.url==='/api/tags'){const digest=flip&&tags++>0?changed:expected;return response(res,{models:[{name:model,model,digest,size:20201253829}]});}
  if(req.url==='/api/ps'){const digest=flip&&tags>1?changed:expected;return response(res,{models:omit?[]:[{name:model,model,digest,size:31232580640,size_vram:17179869184,context_length:40960}]});}
  if(req.url==='/api/chat'&&serveToolLoop){const chunks=[];req.on('data',chunk=>chunks.push(chunk));req.on('end',()=>{const body=JSON.parse(Buffer.concat(chunks).toString());const turn=body.messages.filter(message=>message.role==='assistant').length+1;const hasGate=body.tools.some(tool=>tool.function?.name==='run_gate');let message;if(turn===1)message={role:'assistant',content:'',tool_calls:[{function:{name:'exec',arguments:{argv:['node','-e',\"process.stdout.write('broker-ok')\"]}}}]};else if(turn===2&&hasGate)message={role:'assistant',content:'',tool_calls:[{function:{name:'run_gate',arguments:{}}}]};else message={role:'assistant',content:'done'};response(res,{model,message,prompt_eval_count:7,eval_count:3})});return;}
  res.statusCode=404;response(res,{error:'not found'});
});
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(${JSON.stringify(portPath)},String(server.address().port)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
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
  copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'capability-canary-attestation.schema.json'), join(bundle, 'schemas', 'capability-canary-attestation.schema.json'));
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
  protocol.implementation.ollamaToolClientSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'model-evaluation-ollama-tool-client.mjs')));
  protocol.implementation.ollamaToolClientEventVerifierSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-client-events.mjs')));
  protocol.implementation.ollamaSystemPromptSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'client', 'ollama-system-prompt.v1.txt')));
  protocol.implementation.ollamaCommonToolsSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'client', 'ollama-common-tools.v1.json')));
  protocol.implementation.ollamaClientEventSchemaSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'client-event.schema.json')));
  protocol.implementation.capabilityCanaryAttestationSchemaSha256 = sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'capability-canary-attestation.schema.json')));
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

function probeBundledRunGateTool(bundle, protocol) {
  const treatmentRoot = join(scratch, `reference-treatment-${Date.now()}`);
  mkdirSync(treatmentRoot, { recursive: true });
  const extracted = spawnSync('/usr/bin/tar', ['-xzf', join(bundle, protocol.treatment.engineArtifact), '-C', treatmentRoot], { encoding: 'utf8' });
  if (extracted.status !== 0) throw new Error(`reference treatment extraction failed: ${extracted.stderr}`);
  const mcpServer = join(treatmentRoot, 'node_modules', 'bce-engine', 'dist', 'mcp-server.js');
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'controller-self-test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((value) => JSON.stringify(value)).join('\n') + '\n';
  const result = spawnSync(protocol.isolation.runtimeExecutable, [mcpServer], { cwd: root, input, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`reference treatment MCP probe failed: ${result.stderr}`);
  const responses = result.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const tools = responses.find((response) => response.id === 2)?.result?.tools ?? [];
  const runGate = tools.filter((tool) => tool?.name === 'run_gate');
  if (runGate.length !== 1) throw new Error('reference treatment did not expose exactly one run_gate tool');
  return sha256Json(runGate[0]);
}

function prepareReferenceClientBundle(name, provider) {
  const prepared = prepareBundle(name);
  const protocolPath = join(prepared.bundle, 'protocol.v2.json');
  const manifestPath = join(prepared.bundle, 'task-manifest.json');
  const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const clientPath = join(root, 'scripts', 'model-evaluation-ollama-tool-client.mjs');
  const systemPromptSource = join(root, 'research', 'model-evaluation', 'client', 'ollama-system-prompt.v1.txt');
  const commonToolsSource = join(root, 'research', 'model-evaluation', 'client', 'ollama-common-tools.v1.json');
  const eventSchemaSource = join(root, 'research', 'model-evaluation', 'schemas', 'client-event.schema.json');
  mkdirSync(join(prepared.bundle, 'client'), { recursive: true });
  copyFileSync(systemPromptSource, join(prepared.bundle, 'client', 'ollama-system-prompt.v1.txt'));
  copyFileSync(commonToolsSource, join(prepared.bundle, 'client', 'ollama-common-tools.v1.json'));
  copyFileSync(eventSchemaSource, join(prepared.bundle, 'schemas', 'client-event.schema.json'));
  protocol.isolation.modelNetworkPolicy = 'loopback-only-single-endpoint';
  const clientVersion = `${spawnSync(protocol.isolation.runtimeExecutable, [clientPath, '--version'], { encoding: 'utf8' }).stdout}`.trim();
  const runGateSha256 = probeBundledRunGateTool(prepared.bundle, protocol);
  protocol.clientModelCells[0] = {
    ...protocol.clientModelCells[0],
    client: 'bce-ollama-tool-client', executable: clientPath, clientVersion,
    clientArtifactSha256: sha256Bytes(readFileSync(clientPath)), adapterSha256: protocol.implementation.runnerSha256,
    requestedModel: provider.modelName, resolvedModel: `${provider.modelName}@sha256:${provider.modelDigest}`,
    modelIdentitySource: 'ollama-provider-api-version-tags-and-active-process', modelIdentityEvidence: 'provider-response',
    reasoningEffort: 'low', localProvider: provider,
    toolLoop: {
      eventProtocol: 'bce-ollama-tool-client-events/v1', clientImplementationSha256: sha256Bytes(readFileSync(clientPath)),
      systemPrompt: { path: 'client/ollama-system-prompt.v1.txt', sha256: sha256Bytes(readFileSync(systemPromptSource)) },
      commonToolContract: { path: 'client/ollama-common-tools.v1.json', sha256: sha256Bytes(readFileSync(commonToolsSource)) },
      clientEventSchema: { path: 'schemas/client-event.schema.json', sha256: sha256Bytes(readFileSync(eventSchemaSource)) },
      modelOptions: { temperature: 0, seed: 424242, numCtx: 32768, keepAlive: '10m' },
      execSandbox: {
        driver: '/usr/bin/sandbox-exec', driverSha256: sha256Bytes(readFileSync('/usr/bin/sandbox-exec')),
        networkPolicy: 'deny-all', processPolicy: 'deny-fork',
        filesystemPolicy: 'controller-read-default-deny-workspace-write-protected-roots-denied',
      },
      limits: { maximumTurns: 64, maxFileBytes: 262144, maxToolOutputBytes: 32768, commandTimeoutMs: 120000, providerTimeoutMs: 180000 },
      mcpRunGateToolSha256: runGateSha256, qualificationAttestation: null,
    },
  };
  for (const task of manifest.tasks) task.budget.maxCostUsd = null;
  writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const expected = expectedSeal(prepared.bundle, protocol, manifest);
  writeFileSync(join(prepared.bundle, 'seal.json'), `${JSON.stringify({
    schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial',
    sealedAt: '2026-09-05T00:00:00.000Z', entries: expected.entries, rootSha256: expected.rootSha256,
    publicTimestamp: 'https://example.invalid/synthetic-reference-client-controller-self-test',
    attestation: { kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256, uri: 'https://example.invalid/synthetic-reference-client-controller-self-test', identity: 'controller-self-test', eligibleForProductClaim: false },
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

function executeReferenceClientBrokerIsolation() {
  const server = startFakeOllama('reference-client-broker', { serveToolLoop: true });
  try {
    const { bundle, runs } = prepareReferenceClientBundle('reference-client-broker-isolation', server.provider);
    const result = spawnSync(process.execPath, [
      'scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', runs, '--execute-sealed-study', '--limit', '1',
    ], { cwd: root, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300000 });
    if (result.status !== 0) throw new Error(`reference client broker fixture failed:\n${result.stdout}\n${result.stderr}`);
    const manifest = JSON.parse(readFileSync(join(bundle, 'task-manifest.json'), 'utf8'));
    const trialId = manifest.assignments[0].trialId;
    const terminalPath = join(runs, 'trials', trialId, 'a0', 'terminal.json');
    const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
    const bundleVerification = verifyBundle(bundle, { requireSealed: true });
    if (!bundleVerification.ok) throw new Error(`reference client broker bundle refused: ${bundleVerification.refusals.join('; ')}`);
    verifyTerminalRecord(terminal, { bundle: bundleVerification, runsRoot: runs, terminalPath });
    const isolation = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.isolationProof.sha256), 'utf8'));
    const transcript = JSON.parse(readFileSync(join(runs, 'cas', 'sha256', terminal.evidence.transcript.sha256), 'utf8'));
    const brokerEvidence = transcript.sealedClientEventVerification?.execBrokerControllerEvidence;
    if (terminal.status !== 'completed' || transcript.sealedClientEventVerification?.passed !== true || transcript.sealedClientEventVerification?.execBrokerError !== null ||
        !Array.isArray(brokerEvidence) || brokerEvidence.length !== 1 || brokerEvidence[0].response.result.processGroupTerminated !== true ||
        isolation.execBroker?.workspaceReadWriteAllowed !== true || isolation.execBroker?.protectedWriteDenied !== true ||
        isolation.execBroker?.toolchainWriteDenied !== true || isolation.execBroker?.controllerCanaryReadDenied !== true ||
        isolation.execBroker?.processForkDenied !== true || isolation.execBroker?.providerNetworkDenied !== true ||
        isolation.execBroker?.externalNetworkDenied !== true || isolation.execBroker?.wrongLoopbackDenied !== true ||
        isolation.stagedToolchainIntegrityAfterExecution !== true || terminal.mechanism.commonToolCalls < 1) {
      throw new Error(`reference client broker isolation proof was incomplete: ${JSON.stringify({ terminal, isolation, brokerEvidence })}`);
    }
    if (terminal.assignment.arm === 'bce-enabled' && (terminal.mechanism.bceGateCalls !== 1 || terminal.mechanism.bceVerdictSequence.length !== 1)) {
      throw new Error('reference client treatment arm did not retain one exact MCP gate verdict');
    }
  } finally {
    stopFakeOllama(server);
  }
}

function verifyReferenceCanaryBinding() {
  const server = startFakeOllama('reference-canary-binding');
  try {
    const { bundle } = prepareReferenceClientBundle('reference-canary-binding', server.provider);
    const protocolPath = join(bundle, 'protocol.v2.json');
    const manifestPath = join(bundle, 'task-manifest.json');
    const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const cell = protocol.clientModelCells[0];
    const sourceCommit = 'a'.repeat(40);
    const requirements = [
      'independent-terminal-replay-all-attempts', 'successful-command-completion-each-arm',
      'exact-single-allowed-file-edit-each-arm', 'usable-token-and-turn-telemetry-each-arm',
      'zero-tool-router-errors-each-arm', 'stable-provider-name-and-digest',
      'bce-enabled-exact-successful-mcp-run-gate', 'bce-enabled-last-exact-mcp-verdict-pass',
      'sealed-client-event-chain-each-arm', 'controller-bijective-exec-broker-evidence-each-arm',
    ];
    const observation = (arm) => ({
      trialId: `qualification-${arm}`, arm, status: 'completed', recordSha256: sha256Bytes(`record-${arm}`),
      successfulCommands: 2, exactAllowedFileEdit: true, telemetryUsable: true, toolRouterErrors: 0,
      bceMcpRunGate: arm === 'bce-enabled' ? true : null, bceLastVerifiedVerdict: arm === 'bce-enabled' ? 'pass' : null,
      clientEventChainVerified: true, execBrokerControllerVerified: true, providerIdentityStable: true, safeSuccessfulCompletion: true,
    });
    const attestation = {
      schemaVersion: '1', kind: 'sacrificial-live-capability-canary', eligibleForEvaluationEvidence: false, eligibleForProductClaim: false,
      studyId: 'synthetic-reference-canary-binding', ranAt: '2026-09-05T00:00:00.000Z', sourceCommit, sourceTreeState: 'clean', qualified: true,
      exactCell: {
        client: cell.client, clientVersion: cell.clientVersion, clientArtifactSha256: cell.clientArtifactSha256,
        reasoningEffort: cell.reasoningEffort, requestedModel: cell.requestedModel, resolvedModel: cell.resolvedModel,
        provider: cell.localProvider, runtimeVersion: protocol.isolation.runtimeVersion, runtimeArtifactSha256: protocol.isolation.runtimeArtifactSha256,
        controllerSha256: protocol.implementation.runnerSha256, implementation: protocol.implementation,
        treatmentArtifactSha256: protocol.treatment.engineArtifactSha256, treatmentInstalledTreeSha256: protocol.treatment.installedTreeSha256,
        toolLoop: { ...cell.toolLoop, qualificationAttestation: null },
      },
      requirements, observations: [observation('baseline-no-bce'), observation('bce-enabled')], refusalReasons: [],
      restrictedEvidence: { retained: true, pathPublished: false, ledgerHeadSha256: sha256Bytes('qualification-ledger-head') },
      canaryRunnerSha256: protocol.implementation.canaryRunnerSha256,
      sealedFixtureProtocolSha256: sha256Bytes('qualification-protocol'), sealedFixtureManifestSha256: sha256Bytes('qualification-manifest'),
      sealedFixtureRootSha256: sha256Bytes('qualification-root'), attestationSha256: null,
    };
    attestation.attestationSha256 = sha256Json(attestation);
    const attestationPath = join(bundle, 'artifacts', 'qualified-canary.json');
    writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
    cell.toolLoop.qualificationAttestation = { path: 'artifacts/qualified-canary.json', sha256: sha256Bytes(readFileSync(attestationPath)) };
    writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
    const sealBundle = () => {
      const expected = expectedSeal(bundle, protocol, manifest);
      writeFileSync(join(bundle, 'seal.json'), `${JSON.stringify({
        schemaVersion: '1', studyId: protocol.studyId, status: 'sealed-before-first-trial', sealedAt: '2026-09-05T00:00:00.000Z',
        entries: expected.entries, rootSha256: expected.rootSha256,
        publicTimestamp: `https://github.com/blueprint-conformance/bce/commit/${sourceCommit}`,
        attestation: { kind: 'local-git-commit', subjectRootSha256: expected.rootSha256, uri: `https://github.com/blueprint-conformance/bce/commit/${sourceCommit}`, identity: 'controller-self-test', eligibleForProductClaim: false, gitCommit: sourceCommit },
      }, null, 2)}\n`);
    };
    sealBundle();
    const accepted = verifyBundle(bundle, { requireSealed: true });
    if (!accepted.ok) throw new Error(`valid sealed reference canary binding was refused: ${accepted.refusals.join('; ')}`);

    attestation.observations[1].bceLastVerifiedVerdict = 'fail';
    attestation.attestationSha256 = null;
    attestation.attestationSha256 = sha256Json(attestation);
    writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`);
    cell.toolLoop.qualificationAttestation.sha256 = sha256Bytes(readFileSync(attestationPath));
    writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
    sealBundle();
    const refused = verifyBundle(bundle, { requireSealed: true });
    if (refused.ok || !refused.refusals.some((message) => message.includes('complete clean two-arm capability contract'))) {
      throw new Error('self-rehashed canary with a final failing gate verdict was not refused');
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
executeReferenceClientBrokerIsolation();
verifyReferenceCanaryBinding();
executeSymlinkReplayRefusal();
executeProviderIdentityDriftRefusal();
executeMissingActiveProviderRefusal();
executeFirstClassSafetyHalt();
process.stdout.write('model-evaluation controller self-test: PASS (outer-only strict sandbox + MCP done-check preflight; 8/8 normal rows; nested-sandbox regression refused; 8/8 caught faults terminalized; hard crash recovered; credential retired before hosted model command; credential-free loopback provider identity stable; first-party typed exec broker denied provider/external network, forks, oracle reads, protected writes, and toolchain writes with bijective controller evidence; allowed-path symlink replay refused before oracles; provider digest drift and missing-active failures retained without erasing policy evidence; pre-trigger, replayed, and tampered safety-halt states fail closed; first-class halt exits 3; aggregate tamper refused; pilot recommendation impossible)\n');
rmSync(scratch, { recursive: true, force: true });
