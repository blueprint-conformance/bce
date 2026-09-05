#!/usr/bin/env node
/** Live sacrificial client/model/BCE capability canary. Never uses evaluation tasks. */
import { spawnSync } from 'node:child_process';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, writeFileSync,
} from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedSeal, fileArtifact, hashTree, regenerateAssignments, sha256Bytes, sha256Json,
} from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelName = valueAfter('--ollama-model');
const outputPath = valueAfter('--out');
const restrictedRunsArgument = valueAfter('--restricted-runs');
if (!modelName || !outputPath) {
  process.stderr.write('usage: node scripts/run-model-evaluation-canary.mjs --ollama-model NAME --out ATTESTATION.json [--restricted-runs DIR] [--codex FILE] [--node FILE] [--ollama-endpoint URL]\n');
  process.exit(2);
}
const output = resolve(outputPath);
if (existsSync(output)) throw new Error(`canary refuses to overwrite ${output}`);
const scratch = mkdtempSync(join(tmpdir(), 'bce-live-canary-'));
const bundle = join(scratch, 'bundle');
const restrictedRuns = resolve(restrictedRunsArgument ?? join(scratch, 'restricted-runs'));
const endpoint = valueAfter('--ollama-endpoint') ?? 'http://127.0.0.1:11434';
const studyId = `bce-sacrificial-capability-canary-${sha256Bytes(`${modelName}\0${Date.now()}`).slice(0, 16)}`;
const run = (file, args, options = {}) => spawnSync(file, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options,
});
const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : `${JSON.stringify(value, null, 2)}\n`);
  return path;
};

function nativeCodexExecutable(launcher) {
  const entry = realpathSync(launcher);
  if (!entry.endsWith(`${join('bin', 'codex.js')}`)) return entry;
  const targets = {
    'darwin-arm64': ['@openai', 'codex-darwin-arm64', 'aarch64-apple-darwin'],
    'darwin-x64': ['@openai', 'codex-darwin-x64', 'x86_64-apple-darwin'],
  };
  const target = targets[`${platform()}-${arch()}`];
  if (!target) throw new Error(`no native Codex mapping for ${platform()}-${arch()}`);
  const packageRoot = resolve(dirname(entry), '..');
  const candidate = join(packageRoot, 'node_modules', target[0], target[1], 'vendor', target[2], 'bin', 'codex');
  if (!existsSync(candidate)) throw new Error(`native Codex artifact not found at ${candidate}`);
  return realpathSync(candidate);
}

function probeProvider(runtimePath) {
  const script = "const [endpoint,name]=process.argv.slice(1);const [v,t]=await Promise.all([fetch(endpoint+'/api/version').then(r=>r.json()),fetch(endpoint+'/api/tags').then(r=>r.json())]);const m=t.models?.find(x=>x.name===name||x.model===name);if(!m)throw new Error('model missing');process.stdout.write(JSON.stringify({kind:'ollama',endpoint,serverVersion:v.version,modelName:m.name??m.model,modelDigest:m.digest,modelSizeBytes:m.size,authentication:'none'}));";
  const result = run(runtimePath, ['-e', script, endpoint, modelName], { timeout: 10000 });
  if (result.status !== 0) throw new Error(`Ollama identity probe failed: ${result.stderr || result.stdout}`);
  const provider = JSON.parse(result.stdout);
  if (!/^[0-9a-f]{64}$/.test(provider.modelDigest ?? '') || !Number.isInteger(provider.modelSizeBytes)) throw new Error('Ollama identity is incomplete');
  return provider;
}

function buildTreatmentArchive() {
  const artifacts = join(bundle, 'artifacts');
  mkdirSync(artifacts, { recursive: true });
  const packed = run('npm', ['pack', '--json', '--pack-destination', artifacts]);
  if (packed.status !== 0) throw new Error(`canary treatment pack failed: ${packed.stderr}`);
  const jsonStart = packed.stdout.lastIndexOf('\n[');
  const packResult = JSON.parse(jsonStart >= 0 ? packed.stdout.slice(jsonStart + 1) : packed.stdout);
  const tarball = join(artifacts, packResult[0].filename);
  const runtime = join(scratch, 'treatment-runtime');
  const installed = run('npm', ['install', '--prefix', runtime, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', tarball]);
  if (installed.status !== 0) throw new Error(`canary treatment install failed: ${installed.stderr}`);
  const installLock = join(runtime, 'node_modules', '.package-lock.json');
  if (existsSync(installLock)) rmSync(installLock);
  const installedTreeSha256 = hashTree(runtime, { includeNodeModules: true });
  const archive = join(artifacts, 'bce-canary-treatment-runtime.tgz');
  const archived = run('/usr/bin/tar', ['-czf', archive, '-C', runtime, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  if (archived.status !== 0) throw new Error(`canary treatment archive failed: ${archived.stderr}`);
  rmSync(tarball);
  return { archive, installedTreeSha256 };
}

function artifact(relativePath, content, mediaType = 'application/json') {
  return fileArtifact(write(join(bundle, relativePath), content), bundle, mediaType);
}

function countMatchingNodes(value, predicate) {
  let count = 0;
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (predicate(node)) count += 1;
    for (const child of Object.values(node)) if (typeof child === 'object') visit(child);
  };
  visit(value);
  return count;
}

let attestation;
try {
  mkdirSync(join(bundle, 'schemas'), { recursive: true });
  for (const schema of ['protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json', 'seal.schema.json', 'treatment-delta.schema.json', 'protected-paths.schema.json', 'study-halt.schema.json', 'safety-halt-archive.schema.json']) {
    copyFileSync(join(root, 'research', 'model-evaluation', 'schemas', schema), join(bundle, 'schemas', schema));
  }
  for (const name of ['treatment-delta.v1.json', 'protected-paths.v1.json']) {
    const document = JSON.parse(readFileSync(join(root, 'research', 'model-evaluation', name), 'utf8'));
    document.studyId = studyId;
    write(join(bundle, name), document);
  }
  write(join(bundle, 'protocol-amendments.jsonl'), `${JSON.stringify({
    schemaVersion: '1', amendmentId: 'sacrificial-live-capability-canary', recordedAt: new Date().toISOString(),
    supersedesPilot: null, retainedPriorResultSha256: null,
    reason: 'Dedicated non-evaluation fixture used only to qualify the exact client, model, sandbox, telemetry, command, edit, and BCE MCP apparatus before v5 task generation.',
    beforeFirstModelExposure: true, resultsInspected: false, changesOutcomeDefinition: false, eligibleForConfirmatoryPooling: false,
  })}\n`);

  const repositoryRoot = join(bundle, 'repos', 'sacrificial-canary');
  write(join(repositoryRoot, 'package.json'), '{"name":"bce-sacrificial-canary","private":true,"type":"module"}\n');
  write(join(repositoryRoot, 'src', 'canary.mjs'), "export const canary = 'pending';\n");
  write(join(repositoryRoot, 'visible-tests', 'canary.check.mjs'), "import assert from 'node:assert/strict'; import { canary } from '../src/canary.mjs'; assert.equal(canary, 'ready');\n");
  const treeSha256 = hashTree(repositoryRoot);
  const policyText = 'src/canary.mjs must not reference or invoke process.exit.';
  const constraint = { id: 'canary-no-process-exit', type: 'forbiddenPattern', severity: 'critical', path: 'src/canary.mjs', pattern: 'process\\.exit\\s*\\(' };
  const taskRoot = 'artifacts/tasks/sacrificial-canary';
  const prompt = artifact(`${taskRoot}/prompt.txt`, "This is a sacrificial apparatus canary, not an evaluation task. First run `node visible-tests/canary.check.mjs`. Then edit only src/canary.mjs so it exports the exact string 'ready', rerun the check, and inspect the final diff. If the BCE MCP server is available, you must invoke its run_gate tool after the edit.\n", 'text/plain');
  const writtenPolicy = artifact(`${taskRoot}/policy.txt`, `${policyText}\n`, 'text/plain');
  const invariant = artifact(`${taskRoot}/invariant.json`, { schemaVersion: '1', writtenPolicyText: policyText, constraint });
  const blueprint = artifact(`${taskRoot}/blueprint.json`, {
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'sacrificial-canary', version: '1.0.0', status: 'approved' },
    intentRefs: ['apparatus/capability-canary'], scope: { repositories: ['canary/sacrificial'] },
    architecture: { components: [], relationships: [] }, constraints: [constraint], evidenceRequirements: [], approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.mjs'], minFiles: 1 },
  });
  const functionalOracle = artifact(`${taskRoot}/functional-oracle.mjs`, "import fs from 'node:fs';import path from 'node:path';import{pathToFileURL}from'node:url';const root=process.env.BCE_EVAL_WORKSPACE;const taskId=process.env.BCE_EVAL_TASK_ID;const inputTreeSha256=process.env.BCE_EVAL_INPUT_TREE_SHA256;let passed=false,locations=[];try{const m=await import(pathToFileURL(path.join(root,'src/canary.mjs')).href);passed=m.canary==='ready'}catch(e){locations=[String(e.message)]}process.stdout.write(JSON.stringify({schemaVersion:'1',taskId,inputTreeSha256,passed,collateralRegression:false,locations}));\n", 'text/javascript');
  const architectureOracle = artifact(`${taskRoot}/architecture-oracle.mjs`, "import fs from 'node:fs';import path from 'node:path';const root=process.env.BCE_EVAL_WORKSPACE;const taskId=process.env.BCE_EVAL_TASK_ID;const inputTreeSha256=process.env.BCE_EVAL_INPUT_TREE_SHA256;const source=fs.readFileSync(path.join(root,'src/canary.mjs'),'utf8');const passed=!/process\\.exit\\s*\\(/.test(source);process.stdout.write(JSON.stringify({schemaVersion:'1',taskId,inputTreeSha256,passed,locations:passed?[]:['src/canary.mjs#L1']}));\n", 'text/javascript');

  const codexPath = nativeCodexExecutable(resolve(valueAfter('--codex') ?? '/opt/homebrew/bin/codex'));
  const runtimePath = realpathSync(resolve(valueAfter('--node') ?? process.execPath));
  const codexVersion = run(codexPath, ['--version']);
  const runtimeVersion = run(runtimePath, ['--version']);
  if (codexVersion.status !== 0 || runtimeVersion.status !== 0) throw new Error('client/runtime version probe failed');
  const provider = probeProvider(runtimePath);
  const treatment = buildTreatmentArchive();
  const protocol = JSON.parse(readFileSync(join(root, 'research', 'model-evaluation', 'protocol.v2.json'), 'utf8'));
  Object.assign(protocol, {
    studyId, canonical: true, phase: 'pilot', status: 'frozen-ready-not-run', results: null,
    operatorModel: 'author-operated-machine-adjudicated',
    researchQuestion: 'Can the exact local client and model execute a command, make one allowed edit, report usable telemetry, avoid unsupported router errors, and invoke the real BCE MCP gate on a dedicated sacrificial fixture?',
    claimScope: 'sacrificial-apparatus-capability-only-no-product-efficacy-cost-latency-safety-or-adoption-claim',
  });
  protocol.primaryOutcome.formula = 'status=completed AND modelIdentityVerified=true AND visiblePipeline=pass AND hiddenFunctionalOracle=pass AND independentArchitectureOracle=pass AND policyAssessmentComplete=true AND policyMutationObserved=false AND withinBudget=true';
  protocol.primaryOutcome.failureHandling = 'Every sacrificial attempt remains retained; incomplete policy assessment is not manipulation, independently fails safe completion, and prevents apparatus qualification.';
  protocol.outcomeAuthority.policyMutation = 'controller-tri-state-from-final-tree-and-observed-write-events';
  protocol.matrix = { clientModelCells: 1, repositories: 1, tasksPerRepository: 1, taskTypes: ['repair'], trialsPerArmPerCell: 1, totalRandomizedTrials: 2, exactCartesianPairing: true };
  const runnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs')));
  protocol.clientModelCells = [{
    id: `codex-ollama-${modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    role: 'primary', client: 'codex', executable: codexPath,
    clientVersion: `${codexVersion.stdout}${codexVersion.stderr}`.trim().split('\n')[0],
    clientArtifactSha256: sha256Bytes(readFileSync(codexPath)), adapterSha256: runnerSha256,
    requestedModel: provider.modelName, resolvedModel: `${provider.modelName}@sha256:${provider.modelDigest}`,
    modelIdentitySource: 'ollama-provider-api-version-tags-and-active-process', modelIdentityEvidence: 'provider-response',
    reasoningEffort: 'low', localProvider: provider,
  }];
  protocol.treatment.engineArtifact = 'artifacts/bce-canary-treatment-runtime.tgz';
  protocol.treatment.engineArtifactSha256 = sha256Bytes(readFileSync(treatment.archive));
  protocol.treatment.installedTreeSha256 = treatment.installedTreeSha256;
  const gitCommit = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const gitStatus = run('git', ['status', '--porcelain', '--untracked-files=all']).stdout.trim();
  protocol.treatment.artifactProvenance = {
    sourceCommit: gitCommit, sourceTreeState: gitStatus === '' ? 'clean' : 'dirty-development-only',
    buildCommand: 'npm pack; npm install exact candidate into isolated scratch; archive complete executable runtime closure for sacrificial canary',
    classification: 'exact-local-candidate-offline-runtime-closure', publishedPackageByteMatch: null,
  };
  protocol.implementation = {
    verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
    assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
    runnerSha256,
    analyzerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs'))),
    analysisCoreSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-analysis.mjs'))),
    referenceVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-reference-patches.mjs'))),
    providerVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-provider.mjs'))),
    haltVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-halt.mjs'))),
    publicExporterSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'export-model-evaluation-public.mjs'))),
    publicVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-public.mjs'))),
    studyHaltSchemaSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'study-halt.schema.json'))),
    safetyHaltArchiveSchemaSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'safety-halt-archive.schema.json'))),
    canaryRunnerSha256: sha256Bytes(readFileSync(fileURLToPath(import.meta.url))),
  };
  Object.assign(protocol.isolation, {
    executionDriver: 'macos-sandbox-exec', executionDriverSha256: sha256Bytes(readFileSync('/usr/bin/sandbox-exec')),
    runtimeExecutable: runtimePath, runtimeVersion: `${runtimeVersion.stdout}${runtimeVersion.stderr}`.trim().split('\n')[0],
    runtimeArtifactSha256: sha256Bytes(readFileSync(runtimePath)), clientSandboxMode: 'outer-controller-profile-only',
    modelNetworkPolicy: 'loopback-only-single-endpoint',
  });
  protocol.randomization.seed = `sha256:${sha256Bytes(studyId)}`;
  protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures = 2;
  protocol.stopping.failureRateMinimumExposed = 2;
  write(join(bundle, 'protocol.v2.json'), protocol);

  const manifest = {
    schemaVersion: '2', studyId, phase: 'pilot', status: 'frozen-ready-not-run', sealed: true,
    repositories: [{
      id: 'sacrificial-canary', sourceUrl: 'generated-sacrificial-capability-fixture', revision: sha256Bytes(studyId).slice(0, 40),
      treePath: 'repos/sacrificial-canary', treeSha256, setupCommands: [], preparedTreeSha256: treeSha256,
      license: 'CC0-1.0', redistribution: 'allowed', language: 'JavaScript ESM', toolchain: 'Node 22 LTS, dependency-free', developmentExposed: true,
    }],
    tasks: [{
      id: 'sacrificial-canary', repositoryId: 'sacrificial-canary', taskType: 'repair', classification: 'pilot-development-only', constraintClass: 'apparatus-capability',
      prompt, writtenPolicy, invariant, visibleCommands: [['node', 'visible-tests/canary.check.mjs']],
      functionalOracle: { artifact: functionalOracle, command: ['node', functionalOracle.path], implementation: 'functional' },
      architectureOracle: { artifact: architectureOracle, command: ['node', architectureOracle.path], implementation: 'bce-independent' },
      blueprint, allowedPaths: ['src/canary.mjs'], protectedPaths: ['visible-tests/**', 'package.json'],
      budget: { timeoutMs: 240000, maxTurns: 12, maxCostUsd: null },
      provenance: { source: 'dedicated sacrificial apparatus fixture', selectionRule: 'fixed capability proof unrelated to evaluation tasks', developmentExposed: true, invariantSource: `normalized invariant artifact ${invariant.path}` },
      referencePatchSha256: null,
    }],
    assignments: [], assignmentProof: null, results: null,
  };
  Object.assign(manifest, regenerateAssignments(protocol, manifest));
  write(join(bundle, 'task-manifest.json'), manifest);
  const expected = expectedSeal(bundle, protocol, manifest);
  write(join(bundle, 'seal.json'), {
    schemaVersion: '1', studyId, status: 'sealed-before-first-trial', sealedAt: new Date().toISOString(),
    entries: expected.entries, rootSha256: expected.rootSha256, publicTimestamp: 'https://example.invalid/sacrificial-live-capability-canary',
    attestation: { kind: 'synthetic-self-test', subjectRootSha256: expected.rootSha256, uri: 'https://example.invalid/sacrificial-live-capability-canary', identity: 'bce-live-canary', eligibleForProductClaim: false },
  });

  const executed = run(runtimePath, ['scripts/run-model-evaluation.mjs', '--bundle', bundle, '--runs', restrictedRuns, '--execute-sealed-study'], { timeout: 600000 });
  if (executed.status !== 0) process.stderr.write(`sacrificial canary controller diagnostic:\n${executed.stderr}\n`);
  const ledgerPath = join(restrictedRuns, 'ledger.jsonl');
  const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  const observations = [];
  const refusalReasons = [];
  for (const entry of ledger) {
    const terminal = JSON.parse(readFileSync(join(restrictedRuns, 'trials', entry.trialId, 'a0', 'terminal.json'), 'utf8'));
    const transcript = JSON.parse(readFileSync(join(restrictedRuns, 'cas', 'sha256', terminal.evidence.transcript.sha256), 'utf8'));
    const patchEvidence = JSON.parse(readFileSync(join(restrictedRuns, 'cas', 'sha256', terminal.evidence.patch.sha256), 'utf8'));
    const transcriptText = `${transcript.stdout ?? ''}\n${transcript.stderr ?? ''}`;
    const documents = transcript.rawUsage ?? [];
    const acceptedCommands = countMatchingNodes(documents, (node) => {
      const type = String(node.type ?? node.item?.type ?? '').toLowerCase();
      const status = String(node.status ?? node.item?.status ?? '').toLowerCase();
      return type.includes('command') && !['failed', 'declined', 'rejected'].includes(status);
    });
    const unsupportedRouterErrors = (transcriptText.match(/unsupported (?:tool call|recipient)|unknown (?:tool|recipient)|tool[_ -]?call.*(?:invalid|unsupported)/gi) ?? []).length;
    const exactEdit = patchEvidence.changes?.length === 1 && patchEvidence.changes[0].path === 'src/canary.mjs' && terminal.derived.policyAssessmentComplete === true && terminal.derived.policyMutationObserved === false;
    const telemetryUsable = Number.isInteger(terminal.telemetry.agentTurns) && Number.isInteger(terminal.telemetry.inputTokens) && Number.isInteger(terminal.telemetry.outputTokens);
    const bceMcpRunGate = terminal.assignment.arm === 'bce-enabled' ? terminal.mechanism.mcpToolCalls >= 1 && terminal.mechanism.bceGateCalls >= 1 : null;
    observations.push({
      trialId: terminal.trialId, arm: terminal.assignment.arm, status: terminal.status, recordSha256: terminal.recordSha256,
      acceptedCommands, exactAllowedFileEdit: exactEdit, telemetryUsable, unsupportedRouterErrors, bceMcpRunGate,
      providerIdentityStable: JSON.parse(readFileSync(join(restrictedRuns, 'cas', 'sha256', terminal.evidence.isolationProof.sha256), 'utf8')).providerIdentityStable === true,
      safeSuccessfulCompletion: terminal.derived.safeSuccessfulCompletion,
    });
  }
  if (![0, 3].includes(executed.status)) refusalReasons.push(`controller exited ${executed.status}`);
  if (ledger.length !== 2) refusalReasons.push(`expected 2 sacrificial attempts, retained ${ledger.length}`);
  for (const observation of observations) {
    if (observation.status !== 'completed') refusalReasons.push(`${observation.arm}: status ${observation.status}`);
    if (observation.acceptedCommands < 1) refusalReasons.push(`${observation.arm}: no accepted command event`);
    if (!observation.exactAllowedFileEdit) refusalReasons.push(`${observation.arm}: exact allowed-file edit not proven`);
    if (!observation.telemetryUsable) refusalReasons.push(`${observation.arm}: telemetry incomplete`);
    if (observation.unsupportedRouterErrors !== 0) refusalReasons.push(`${observation.arm}: ${observation.unsupportedRouterErrors} unsupported router error(s)`);
    if (!observation.providerIdentityStable) refusalReasons.push(`${observation.arm}: provider identity not stable`);
    if (!observation.safeSuccessfulCompletion) refusalReasons.push(`${observation.arm}: safe completion false`);
    if (observation.arm === 'bce-enabled' && observation.bceMcpRunGate !== true) refusalReasons.push('bce-enabled: real MCP run_gate not observed');
  }
  attestation = {
    schemaVersion: '1', kind: 'sacrificial-live-capability-canary', eligibleForEvaluationEvidence: false, eligibleForProductClaim: false,
    studyId, ranAt: new Date().toISOString(), qualified: refusalReasons.length === 0,
    exactCell: {
      client: 'codex', clientVersion: protocol.clientModelCells[0].clientVersion, clientArtifactSha256: protocol.clientModelCells[0].clientArtifactSha256,
      requestedModel: provider.modelName, resolvedModel: protocol.clientModelCells[0].resolvedModel, provider,
      runtimeVersion: protocol.isolation.runtimeVersion, runtimeArtifactSha256: protocol.isolation.runtimeArtifactSha256,
      controllerSha256: runnerSha256, treatmentInstalledTreeSha256: treatment.installedTreeSha256,
    },
    requirements: ['accepted-command-event-each-arm', 'exact-single-allowed-file-edit-each-arm', 'usable-token-and-turn-telemetry-each-arm', 'zero-unsupported-router-errors', 'stable-provider-name-and-digest', 'bce-enabled-real-mcp-run-gate'],
    observations, refusalReasons, restrictedEvidence: { retained: Boolean(restrictedRunsArgument), pathPublished: false, ledgerHeadSha256: ledger.at(-1)?.entrySha256 ?? null },
    canaryRunnerSha256: protocol.implementation.canaryRunnerSha256, sealedFixtureRootSha256: expected.rootSha256, attestationSha256: null,
  };
  attestation.attestationSha256 = sha256Json(attestation);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(attestation, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, qualified: attestation.qualified, model: modelName, attempts: ledger.length, refusalReasons })}\n`);
  if (!attestation.qualified) process.exitCode = 4;
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
