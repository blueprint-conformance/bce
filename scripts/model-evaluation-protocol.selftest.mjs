#!/usr/bin/env node
/** Pathological controls for the real v2 verifier, record derivation, and analyzer. */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  expectedSeal,
  fileArtifact,
  hashTree,
  makeEvent,
  regenerateAssignments,
  runArtifact,
  sha256Bytes,
  sha256Json,
  verifyBundle,
} from './lib/model-evaluation.mjs';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'bce-model-protocol-v2-'));
const bundleDir = join(scratch, 'bundle');
const runsDir = join(scratch, 'runs');
mkdirSync(join(bundleDir, 'schemas'), { recursive: true });
mkdirSync(join(bundleDir, 'artifacts'), { recursive: true });
mkdirSync(join(bundleDir, 'repos'), { recursive: true });
mkdirSync(runsDir, { recursive: true });
for (const schema of ['protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json', 'seal.schema.json', 'treatment-delta.schema.json', 'protected-paths.schema.json']) {
  cpSync(join(root, 'research', 'model-evaluation', 'schemas', schema), join(bundleDir, 'schemas', schema));
}
for (const name of ['treatment-delta.v1.json', 'protected-paths.v1.json', 'protocol-amendments.jsonl']) {
  cpSync(join(root, 'research', 'model-evaluation', name), join(bundleDir, name));
}

const write = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
};
const artifact = (rel, value, mediaType = 'application/json') => {
  const path = join(bundleDir, rel);
  write(path, value);
  return fileArtifact(path, bundleDir, mediaType);
};

const enginePath = join(bundleDir, 'artifacts', 'bce-engine-test.tgz');
write(enginePath, 'synthetic engine artifact for protocol self-test\n');
const protocol = JSON.parse(readFileSync(join(root, 'research', 'model-evaluation', 'protocol.v2.json'), 'utf8'));
protocol.status = 'frozen-ready-not-run';
protocol.phase = 'pilot';
protocol.claimScope = 'synthetic-protocol-replay-only-ineligible-for-product-claims';
protocol.isolation.executionDriver = 'synthetic-self-test';
protocol.isolation.executionDriverSha256 = sha256Bytes('synthetic-isolation-driver');
protocol.isolation.runtimeExecutable = process.execPath;
protocol.isolation.runtimeVersion = process.version;
protocol.isolation.runtimeArtifactSha256 = sha256Bytes(readFileSync(process.execPath));
protocol.isolation.clientSandboxMode = 'outer-controller-profile-only';
protocol.treatment.engineArtifact = 'artifacts/bce-engine-test.tgz';
protocol.treatment.engineArtifactSha256 = sha256Bytes(readFileSync(enginePath));
protocol.treatment.installedTreeSha256 = sha256Bytes('synthetic-installed-tree');
protocol.treatment.artifactProvenance = {
  sourceCommit: 'a'.repeat(40),
  sourceTreeState: 'clean',
  buildCommand: 'synthetic self-test constructs an exact offline treatment fixture',
  classification: 'exact-local-candidate-offline-runtime-closure',
  publishedPackageByteMatch: null,
};
const frozenRunnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs')));
protocol.implementation = {
  verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
  assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
  runnerSha256: frozenRunnerSha256,
    analyzerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs'))),
    analysisCoreSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-analysis.mjs'))),
    referenceVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-reference-patches.mjs'))),
};
protocol.clientModelCells = [
  ['primary-codex', 'primary', 'codex', 'gpt-test-a'],
  ['transport-claude', 'transportability', 'claude-code', 'claude-test-b'],
  ['transport-cursor', 'transportability', 'cursor-agent', 'cursor-test-c'],
  ['transport-reference-agent', 'transportability', 'reference-agent', 'reference-test-d'],
].map(([id, role, client, model], index) => ({
  id,
  role,
  client,
  executable: `/test/bin/${client}`,
  clientVersion: `${client}-1.0.${index}`,
  clientArtifactSha256: sha256Bytes(`client-${id}`),
  adapterSha256: frozenRunnerSha256,
  requestedModel: model,
  resolvedModel: `${model}-resolved`,
  modelIdentitySource: 'synthetic-adapter-response',
  modelIdentityEvidence: 'synthetic-response',
  reasoningEffort: 'low',
}));
write(join(bundleDir, 'protocol.v2.json'), protocol);

const repositories = [];
const tasks = [];
for (let repoIndex = 0; repoIndex < 25; repoIndex += 1) {
  const repoId = `repo-${repoIndex}`;
  const treePath = `repos/${repoId}`;
  write(join(bundleDir, treePath, 'src', 'index.ts'), `export const value = ${repoIndex};\n`);
  write(join(bundleDir, treePath, 'package.json'), { name: repoId, private: true, scripts: { test: 'node --test' } });
  repositories.push({
    id: repoId,
    sourceUrl: `https://example.invalid/${repoId}.git`,
    revision: sha256Bytes(repoId).slice(0, 40),
    treePath,
    treeSha256: hashTree(join(bundleDir, treePath)),
    setupCommands: [],
    preparedTreeSha256: hashTree(join(bundleDir, treePath)),
    license: 'MIT',
    redistribution: 'allowed',
    language: 'TypeScript',
    toolchain: 'Node 22',
    developmentExposed: true,
  });
  for (const [taskOffset, taskType] of ['repair', 'feature', 'refactor'].entries()) {
    const taskId = `${repoId}-${taskType}`;
    const base = `artifacts/${taskId}`;
    const prompt = artifact(`${base}/prompt.txt`, `Complete ${taskType} task ${taskId}. Preserve the written architecture policy.\n`, 'text/plain');
    const policyText = `Policy ${taskId}: source modules must not call process.exit.`;
    const writtenPolicy = artifact(`${base}/policy.txt`, `${policyText}\n`, 'text/plain');
    const functionalOracle = artifact(`${base}/functional-oracle.mjs`, `process.stdout.write(JSON.stringify({passed:true,collateralRegression:false,task:${JSON.stringify(taskId)}}));\n`, 'text/javascript');
    const architectureOracle = artifact(`${base}/architecture-oracle.mjs`, `process.stdout.write(JSON.stringify({passed:true,locations:[],task:${JSON.stringify(taskId)}}));\n`, 'text/javascript');
    const constraint = { id: 'no-process-exit', type: 'forbiddenPattern', severity: 'critical', path: 'src/**/*.ts', pattern: 'process\\.exit\\s*\\(' };
    const invariant = artifact(`${base}/invariant.json`, { schemaVersion: '1', writtenPolicyText: policyText, constraint });
    const blueprint = artifact(`${base}/blueprint.json`, {
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'EngineeringBlueprint',
      metadata: { id: taskId, version: '1.0.0', status: 'approved' },
      intentRefs: [`policy/${taskId}`],
      scope: { repositories: [`example/${repoId}`] },
      architecture: { components: [], relationships: [] },
      constraints: [constraint],
      evidenceRequirements: [],
      approvals: [],
      extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
    });
    const referencePatch = artifact(`${base}/reference.patch`, `diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1 +1 @@\n-export const value = ${repoIndex};\n+export const value = ${repoIndex}; // ${taskId}\n`, 'text/x-diff');
    tasks.push({
      id: taskId,
      repositoryId: repoId,
      taskType,
      classification: 'pilot-development-only',
      constraintClass: `class-${taskOffset}`,
      prompt,
      writtenPolicy,
      invariant,
      visibleCommands: [['node', '--test']],
      functionalOracle: { artifact: functionalOracle, command: ['node', functionalOracle.path], implementation: 'functional' },
      architectureOracle: { artifact: architectureOracle, command: ['node', architectureOracle.path], implementation: 'bce-independent' },
      blueprint,
      referencePatch,
      allowedPaths: ['src/**'],
      protectedPaths: ['.blueprints/**', '.github/**', 'tests/**'],
      budget: { timeoutMs: 60000, maxTurns: 8, maxCostUsd: 1 },
      provenance: {
        source: 'synthetic-protocol-self-test',
        selectionRule: 'generated before any synthetic outcome and never used for a product claim',
        developmentExposed: true,
        invariantSource: `test-policy/${taskId}`,
      },
      referencePatchSha256: referencePatch.sha256,
    });
  }
}
const manifest = {
  schemaVersion: '2',
  studyId: protocol.studyId,
  phase: 'pilot',
  status: 'frozen-ready-not-run',
  sealed: true,
  repositories,
  tasks,
  assignments: [],
  assignmentProof: null,
  results: null,
};
Object.assign(manifest, regenerateAssignments(protocol, manifest));
write(join(bundleDir, 'task-manifest.json'), manifest);
const sealParts = expectedSeal(bundleDir, protocol, manifest);
write(join(bundleDir, 'seal.json'), {
  schemaVersion: '1',
  studyId: protocol.studyId,
  status: 'sealed-before-first-trial',
  sealedAt: '2026-09-03T00:00:00.000Z',
  entries: sealParts.entries,
  rootSha256: sealParts.rootSha256,
  publicTimestamp: 'https://example.invalid/pre-exposure-test-anchor',
  attestation: {
    kind: 'synthetic-self-test',
    subjectRootSha256: sealParts.rootSha256,
    uri: 'https://example.invalid/pre-exposure-test-anchor',
    identity: 'synthetic-protocol-self-test',
    eligibleForProductClaim: false
  },
});

const verified = verifyBundle(bundleDir);
if (!verified.ok) throw new Error(`valid synthetic bundle refused:\n${verified.refusals.join('\n')}`);

const portableProtocolBytes = readFileSync(join(bundleDir, 'protocol.v2.json'), 'utf8');
const portableSealBytes = readFileSync(join(bundleDir, 'seal.json'), 'utf8');
const absentHostProtocol = JSON.parse(portableProtocolBytes);
absentHostProtocol.isolation.runtimeExecutable = '/host-bound/runtime/not-present-on-ci';
write(join(bundleDir, 'protocol.v2.json'), absentHostProtocol);
const portableSealParts = expectedSeal(bundleDir, absentHostProtocol, manifest);
const portableSeal = JSON.parse(portableSealBytes);
portableSeal.entries = portableSealParts.entries;
portableSeal.rootSha256 = portableSealParts.rootSha256;
portableSeal.attestation.subjectRootSha256 = portableSealParts.rootSha256;
write(join(bundleDir, 'seal.json'), portableSeal);
const exactHostResult = verifyBundle(bundleDir);
if (exactHostResult.ok || !exactHostResult.refusals.some((item) => item.includes('execution runtime artifact'))) {
  throw new Error('exact bundle verification accepted an unavailable host runtime');
}
const portableInputResult = verifyBundle(bundleDir, { verifyHostArtifacts: false });
if (!portableInputResult.ok || portableInputResult.hostArtifactsVerified !== false) {
  throw new Error(`portable input verification did not isolate the external host artifact: ${portableInputResult.refusals.join('; ')}`);
}
writeFileSync(join(bundleDir, 'protocol.v2.json'), portableProtocolBytes);
writeFileSync(join(bundleDir, 'seal.json'), portableSealBytes);

function makeTerminal(assignment) {
  const trialDir = join(runsDir, assignment.trialId, 'a0');
  mkdirSync(trialDir, { recursive: true });
  const taskIndex = tasks.findIndex((task) => task.id === assignment.taskId);
  const bce = assignment.arm === 'bce-enabled';
  const architecturePassed = bce ? taskIndex % 10 !== 0 : taskIndex % 2 === 0;
  const functionalPassed = taskIndex % 10 !== 9;
  const policyMutation = bce && taskIndex === 1;
  const visibleAccepted = bce ? architecturePassed && !policyMutation && taskIndex !== 2 : true;
  const latencyMs = bce ? 1200 : 1000;
  let previous = null;
  const events = [
    makeEvent(previous, 0, 'controller', 'assignment-leased', { trialId: assignment.trialId }),
  ];
  previous = events[0].eventSha256;
  events.push(makeEvent(previous, 1, 'controller', 'model-request-exposed', { trialId: assignment.trialId }));
  write(join(trialDir, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  write(join(trialDir, 'transcript.jsonl'), `${JSON.stringify({ trialId: assignment.trialId, event: 'synthetic-client-complete' })}\n`);
  write(join(trialDir, 'patch.diff'), `diff --git a/src/index.ts b/src/index.ts\n# ${assignment.trialId}\n`);
  write(join(trialDir, 'final-tree.json'), { trialId: assignment.trialId, sha256: sha256Bytes(`tree-${assignment.trialId}`) });
  const nonBceAccepted = true;
  const bceGateAccepted = bce ? visibleAccepted : null;
  const treatmentConfigSha256 = bce
    ? sha256Json({ arm: assignment.arm, taskId: assignment.taskId })
    : sha256Json({ arm: 'baseline-no-bce', changes: [] });
  write(join(trialDir, 'preparation.json'), { successful: true, preparedTreeSha256: repositories.find((repo) => repo.id === assignment.repositoryId).preparedTreeSha256, treatmentConfigSha256, commands: [] });
  write(join(trialDir, 'isolation.json'), {
    driver: 'synthetic-self-test',
    driverSha256: sha256Bytes('synthetic-isolation-driver'),
    clientSandboxMode: 'outer-controller-profile-only',
    readDefaultDeny: true,
    oracleReadDenied: true,
    referencePatchReadDenied: true,
    hostCanaryReadDenied: true,
    hostCanaryWriteDenied: true,
    protectedWriteDenied: true,
    workspaceReadWriteAllowed: true,
    stagedRuntimeVersionVerified: true,
    stagedClientVersionVerified: true,
    authenticationReadableToClientProcess: null,
    clientSessionObserved: true,
    credentialRetiredBeforeModelToolExecution: true,
    modelToolExecutionObservedBeforeCredentialRetirement: false,
    shellEnvironmentPolicy: 'synthetic-fixture',
    mcpHandshakePassed: bce ? true : null,
    mcpDoneCheckAvailable: bce ? true : false,
    mcpToolNames: bce ? ['run_gate'] : [],
    clientExecutableStagedSha256: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).clientArtifactSha256,
    runtimeExecutableStagedSha256: protocol.isolation.runtimeArtifactSha256,
  });
  write(join(trialDir, 'visible.json'), {
    accepted: visibleAccepted,
    nonBceAccepted,
    bceGateAccepted,
    commands: [['node', '--test']],
    bceRun: bce ? { command: ['bce', 'gate'], exitCode: bceGateAccepted ? 0 : 1 } : null,
  });
  write(join(trialDir, 'functional.json'), { passed: functionalPassed, collateralRegression: taskIndex === 8, deterministic: true });
  write(join(trialDir, 'architecture.json'), { passed: architecturePassed, locations: architecturePassed ? [] : ['src/index.ts#L1'], deterministic: true });
  write(join(trialDir, 'policy.json'), { mutation: policyMutation, paths: policyMutation ? ['.blueprints/task.json'] : [], observedWritePaths: [] });
  const evidence = {
    events: runArtifact(join(trialDir, 'events.jsonl'), runsDir, 'application/x-ndjson'),
    transcript: runArtifact(join(trialDir, 'transcript.jsonl'), runsDir, 'application/x-ndjson'),
    patch: runArtifact(join(trialDir, 'patch.diff'), runsDir, 'text/x-diff'),
    finalTree: runArtifact(join(trialDir, 'final-tree.json'), runsDir, 'application/json'),
    preparation: runArtifact(join(trialDir, 'preparation.json'), runsDir, 'application/json'),
    isolationProof: runArtifact(join(trialDir, 'isolation.json'), runsDir, 'application/json'),
    visiblePipeline: runArtifact(join(trialDir, 'visible.json'), runsDir, 'application/json'),
    functionalOracle: runArtifact(join(trialDir, 'functional.json'), runsDir, 'application/json'),
    architectureOracle: runArtifact(join(trialDir, 'architecture.json'), runsDir, 'application/json'),
    policyDiff: runArtifact(join(trialDir, 'policy.json'), runsDir, 'application/json'),
  };
  const terminal = {
    schemaVersion: '2',
    studyId: protocol.studyId,
    trialId: assignment.trialId,
    pairId: assignment.pairId,
    attemptId: `${assignment.trialId}-a0`,
    primaryAttempt: true,
    retryOf: null,
    assignment: {
      cellId: assignment.cellId,
      repositoryId: assignment.repositoryId,
      taskId: assignment.taskId,
      arm: assignment.arm,
      orderIndex: assignment.orderIndex,
    },
    bindings: {
      sealRootSha256: sealParts.rootSha256,
      protocolSha256: sha256Bytes(readFileSync(join(bundleDir, 'protocol.v2.json'))),
      manifestSha256: sha256Bytes(readFileSync(join(bundleDir, 'task-manifest.json'))),
      runnerSha256: frozenRunnerSha256,
      clientArtifactSha256: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).clientArtifactSha256,
      adapterSha256: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).adapterSha256,
      requestedModel: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).requestedModel,
      resolvedModel: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).resolvedModel,
      modelIdentitySource: protocol.clientModelCells.find((cell) => cell.id === assignment.cellId).modelIdentitySource,
      baseTreeSha256: repositories.find((repo) => repo.id === assignment.repositoryId).treeSha256,
      preparedTreeSha256: repositories.find((repo) => repo.id === assignment.repositoryId).preparedTreeSha256,
      treatmentConfigSha256,
    },
    status: 'completed',
    exposure: {
      modelRequestExposed: true,
      startedAt: '2026-09-03T00:00:00.000Z',
      endedAt: '2026-09-03T00:00:01.200Z',
      exitCode: 0,
    },
    evidence,
    derived: {
      modelIdentityVerified: true,
      nonBcePipelineAccepted: nonBceAccepted,
      bceGateAccepted,
      visiblePipelineAccepted: visibleAccepted,
      hiddenFunctionalPassed: functionalPassed,
      independentArchitecturePassed: architecturePassed,
      policyMutation,
      withinBudget: true,
      safeSuccessfulCompletion: visibleAccepted && functionalPassed && architecturePassed && !policyMutation,
      escapedDefect: visibleAccepted && !architecturePassed,
      productiveBlock: bce && nonBceAccepted && bceGateAccepted === false && (!architecturePassed || policyMutation),
      falseBlock: bce && nonBceAccepted && bceGateAccepted === false && functionalPassed && architecturePassed && !policyMutation,
      collateralRegression: taskIndex === 8,
    },
    mechanism: {
      eventEvidenceAvailable: true,
      skillReadObserved: bce ? true : null,
      mcpToolCalls: bce ? 1 : 0,
      bceGateCalls: bce ? 1 : 0,
      bceVerdictSequence: bce ? ['pass'] : [],
      redToGreenCorrectionObserved: false,
    },
    telemetry: {
      latencyMs,
      nonBcePipelineMs: 100,
      bceGateMs: bce ? 50 : null,
      endToEndVisibleMs: latencyMs + 100 + (bce ? 50 : 0),
      oracleMs: 20,
      agentTurns: 2,
      inputTokens: assignment.orderIndex === 0 ? null : 100 + taskIndex,
      outputTokens: 20,
      cachedTokens: 0,
      costUsd: 0.01,
      missingReasons: {
        ...(assignment.orderIndex === 0 ? { inputTokens: 'synthetic client omitted this field' } : {}),
        ...(!bce ? { bceGateMs: 'baseline arm has no BCE gate' } : {}),
      },
    },
    recordSha256: null,
  };
  terminal.recordSha256 = sha256Json(terminal);
  write(join(trialDir, 'terminal.json'), terminal);
}
for (const assignment of manifest.assignments) makeTerminal(assignment);
for (const assignment of manifest.assignments) {
  const terminal = JSON.parse(readFileSync(join(runsDir, assignment.trialId, 'a0', 'terminal.json'), 'utf8'));
  if (terminal.derived.safeSuccessfulCompletion && terminal.derived.falseBlock) throw new Error('safe success and false BCE block overlapped');
  if (assignment.arm === 'baseline-no-bce' && (terminal.derived.falseBlock || terminal.derived.productiveBlock)) throw new Error('baseline rejection was mislabeled as a BCE block');
}
let previousEntrySha256 = null;
const ledger = manifest.assignments.map((assignment, sequence) => {
  const terminal = JSON.parse(readFileSync(join(runsDir, assignment.trialId, 'a0', 'terminal.json'), 'utf8'));
  const entry = {
    schemaVersion: '1',
    sequence,
    trialId: assignment.trialId,
    attemptId: terminal.attemptId,
    orderIndex: assignment.orderIndex,
    recordSha256: terminal.recordSha256,
    previousEntrySha256,
    entrySha256: null,
  };
  entry.entrySha256 = sha256Json(entry);
  previousEntrySha256 = entry.entrySha256;
  return entry;
});
write(join(runsDir, 'ledger.jsonl'), `${ledger.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

const analyzerArgs = [join(root, 'scripts', 'analyze-model-evaluation.mjs'), '--bundle', bundleDir, '--runs', runsDir];
const output = execFileSync(process.execPath, analyzerArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const analysis = JSON.parse(output);
if (analysis.verifiedTrials !== 600 || analysis.pooledConfirmatoryEstimate !== null) throw new Error('analyzer did not retain the exact 600-trial unpooled denominator');
if (analysis.productDecision.decision !== 'ineligible-instrumentation-pilot-no-efficacy-decision' || analysis.productDecision.checks !== null) {
  throw new Error('pilot analysis emitted product-efficacy threshold credit');
}
if (analysis.cells['primary-codex'].arms['bce-enabled'].policyMutation.successes !== 1) throw new Error('objective policy mutation did not remain in the denominator');
const missingInputTokens = Object.values(analysis.cells).reduce(
  (sum, cell) => sum + Object.values(cell.arms).reduce((armSum, arm) => armSum + arm.telemetry.inputTokens.missing, 0),
  0,
);
if (missingInputTokens !== 1) throw new Error('missing telemetry was not reported honestly');
if (Object.values(analysis.cells).some((cell) => Object.values(cell.arms).some((arm) => arm.telemetry.inputTokens.sumKnown === 0))) {
  throw new Error('known telemetry was collapsed to zero');
}

const originalManifest = readFileSync(join(bundleDir, 'task-manifest.json'), 'utf8');
const originalSeal = readFileSync(join(bundleDir, 'seal.json'), 'utf8');
const blocked = JSON.parse(originalManifest);
blocked.assignments.sort((a, b) => a.arm.localeCompare(b.arm) || a.trialId.localeCompare(b.trialId)).forEach((row, index) => { row.orderIndex = index; });
write(join(bundleDir, 'task-manifest.json'), blocked);
const blockedSealParts = expectedSeal(bundleDir, protocol, blocked);
const blockedSeal = JSON.parse(originalSeal);
blockedSeal.entries = blockedSealParts.entries;
blockedSeal.rootSha256 = blockedSealParts.rootSha256;
write(join(bundleDir, 'seal.json'), blockedSeal);
const blockedResult = verifyBundle(bundleDir);
if (blockedResult.ok || !blockedResult.refusals.some((item) => item.includes('regenerate exactly'))) throw new Error('verifier accepted arm-blocked, non-regenerating assignment order');
writeFileSync(join(bundleDir, 'task-manifest.json'), originalManifest);
writeFileSync(join(bundleDir, 'seal.json'), originalSeal);

const unboundPatchManifest = JSON.parse(originalManifest);
unboundPatchManifest.tasks[0].referencePatchSha256 = 'f'.repeat(64);
write(join(bundleDir, 'task-manifest.json'), unboundPatchManifest);
const unboundPatchSealParts = expectedSeal(bundleDir, protocol, unboundPatchManifest);
const unboundPatchSeal = JSON.parse(originalSeal);
unboundPatchSeal.entries = unboundPatchSealParts.entries;
unboundPatchSeal.rootSha256 = unboundPatchSealParts.rootSha256;
write(join(bundleDir, 'seal.json'), unboundPatchSeal);
const unboundPatchResult = verifyBundle(bundleDir);
if (unboundPatchResult.ok || !unboundPatchResult.refusals.some((item) => item.includes('reference patch artifact digest'))) throw new Error('verifier accepted an unbound reference-patch digest');
writeFileSync(join(bundleDir, 'task-manifest.json'), originalManifest);
writeFileSync(join(bundleDir, 'seal.json'), originalSeal);

const originalProtocol = readFileSync(join(bundleDir, 'protocol.v2.json'), 'utf8');
const shortcutRequiredProtocol = JSON.parse(originalProtocol);
shortcutRequiredProtocol.claimScope = 'directional-apparatus-calibration-synthetic-negative-control';
write(join(bundleDir, 'protocol.v2.json'), shortcutRequiredProtocol);
const shortcutRequiredManifest = JSON.parse(originalManifest);
const shortcutRequiredSealParts = expectedSeal(bundleDir, shortcutRequiredProtocol, shortcutRequiredManifest);
const shortcutRequiredSeal = JSON.parse(originalSeal);
shortcutRequiredSeal.entries = shortcutRequiredSealParts.entries;
shortcutRequiredSeal.rootSha256 = shortcutRequiredSealParts.rootSha256;
write(join(bundleDir, 'seal.json'), shortcutRequiredSeal);
const shortcutRequiredResult = verifyBundle(bundleDir);
if (shortcutRequiredResult.ok || !shortcutRequiredResult.refusals.some((item) => item.includes('has no frozen shortcut witness'))) {
  throw new Error('verifier accepted a directional calibration pilot without shortcut witnesses');
}
writeFileSync(join(bundleDir, 'protocol.v2.json'), originalProtocol);
writeFileSync(join(bundleDir, 'task-manifest.json'), originalManifest);
writeFileSync(join(bundleDir, 'seal.json'), originalSeal);

const linkedManifest = JSON.parse(originalManifest);
const linkedRepository = linkedManifest.repositories[0];
const linkedPath = join(bundleDir, linkedRepository.treePath, 'host-link');
symlinkSync('/etc/passwd', linkedPath);
linkedRepository.treeSha256 = hashTree(join(bundleDir, linkedRepository.treePath));
linkedRepository.preparedTreeSha256 = linkedRepository.treeSha256;
write(join(bundleDir, 'task-manifest.json'), linkedManifest);
const linkedSealParts = expectedSeal(bundleDir, protocol, linkedManifest);
const linkedSeal = JSON.parse(originalSeal);
linkedSeal.entries = linkedSealParts.entries;
linkedSeal.rootSha256 = linkedSealParts.rootSha256;
write(join(bundleDir, 'seal.json'), linkedSeal);
const linkedResult = verifyBundle(bundleDir);
if (linkedResult.ok || !linkedResult.refusals.some((item) => item.includes('symbolic links are refused'))) throw new Error('verifier accepted a repository symlink');
unlinkSync(linkedPath);
writeFileSync(join(bundleDir, 'task-manifest.json'), originalManifest);
writeFileSync(join(bundleDir, 'seal.json'), originalSeal);

const first = manifest.assignments[0];
const firstDir = join(runsDir, first.trialId, 'a0');
const terminalPath = join(firstDir, 'terminal.json');
const originalTerminal = readFileSync(terminalPath, 'utf8');
const claimed = JSON.parse(originalTerminal);
claimed.derived.safeSuccessfulCompletion = !claimed.derived.safeSuccessfulCompletion;
claimed.recordSha256 = null;
claimed.recordSha256 = sha256Json(claimed);
write(terminalPath, claimed);
const claimedRun = spawnSync(process.execPath, analyzerArgs, { cwd: root, encoding: 'utf8' });
if (claimedRun.status === 0 || !claimedRun.stderr.includes('derived outcomes are not reproducible')) throw new Error('analyzer accepted a self-asserted safe-success outcome');
writeFileSync(terminalPath, originalTerminal);

const transcriptPath = join(firstDir, 'transcript.jsonl');
const originalTranscript = readFileSync(transcriptPath, 'utf8');
write(transcriptPath, `${originalTranscript}{"tampered":true}\n`);
const tamperedRun = spawnSync(process.execPath, analyzerArgs, { cwd: root, encoding: 'utf8' });
if (tamperedRun.status === 0 || !tamperedRun.stderr.includes('mismatch')) throw new Error('analyzer accepted a modified evidence artifact');
writeFileSync(transcriptPath, originalTranscript);

const hiddenTerminal = join(firstDir, 'terminal.missing');
renameSync(terminalPath, hiddenTerminal);
const missingRun = spawnSync(process.execPath, analyzerArgs, { cwd: root, encoding: 'utf8' });
if (missingRun.status === 0 || !missingRun.stderr.includes('denominator mismatch')) throw new Error('analyzer accepted a missing randomized trial');
renameSync(hiddenTerminal, terminalPath);

const liveReadiness = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/research-readiness.ts', '--model-eval'], { cwd: root, encoding: 'utf8' });
if (liveReadiness.status !== 2 || !liveReadiness.stderr.includes('REFUSED')) throw new Error('unpopulated canonical study did not refuse live execution');

console.log('model-evaluation protocol v2 self-test: PASS (sealed paired 600-trial replay; portable-input versus exact-host verification boundary; false-block denominator coherence; objective outcomes; shortcut requirement; blocked order, asserted outcomes, artifact tamper, missing denominator, and live unready inputs refused)');
rmSync(scratch, { recursive: true, force: true });
