#!/usr/bin/env node
/** Zero-credential verification of a public model-evaluation export. */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeModelEvaluationRecords } from './lib/model-evaluation-analysis.mjs';
import { canonicalJson, expectedSeal, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleRoot = resolve(valueAfter('--bundle') ?? 'research/model-evaluation/pilots/accelerated-v1');
const resultsRoot = resolve(valueAfter('--results') ?? join(bundleRoot, 'results'));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const protocol = readJson(join(bundleRoot, 'protocol.v2.json'));
const manifest = readJson(join(bundleRoot, 'task-manifest.json'));
const seal = readJson(join(bundleRoot, 'seal.json'));
const summary = readJson(join(resultsRoot, 'summary.json'));
if (summary.resultSha256 !== sha256Json({ ...summary, resultSha256: null })) throw new Error('public summary self-digest mismatch');
if (summary.analysis.resultSha256 !== sha256Json({ ...summary.analysis, resultSha256: null })) throw new Error('analysis self-digest mismatch');
if (summary.studyId !== protocol.studyId || summary.studyId !== manifest.studyId || summary.studyId !== seal.studyId) throw new Error('studyId mismatch');
const expected = expectedSeal(bundleRoot, protocol, manifest);
if (seal.rootSha256 !== expected.rootSha256 || canonicalJson(seal.entries) !== canonicalJson(expected.entries)) throw new Error('sealed input root mismatch');
if (summary.sealedInputs.rootSha256 !== seal.rootSha256 || canonicalJson(summary.sealedInputs.attestation) !== canonicalJson(seal.attestation)) throw new Error('summary seal binding mismatch');
if (protocol.phase === 'pilot' && (seal.attestation?.eligibleForProductClaim !== false || summary.analysis.productDecision.decision !== 'ineligible-instrumentation-pilot-no-efficacy-decision')) {
  throw new Error('pilot export is not permanently claim-ineligible');
}

const terminalBytes = readFileSync(join(resultsRoot, 'terminal-records.jsonl'));
const ledgerBytes = readFileSync(join(resultsRoot, 'ledger.jsonl'));
if (sha256Bytes(terminalBytes) !== summary.publicReplay.terminalRecordsSha256) throw new Error('terminal export digest mismatch');
if (sha256Bytes(ledgerBytes) !== summary.publicReplay.ledgerSha256) throw new Error('ledger export digest mismatch');
const records = terminalBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const ledger = ledgerBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
if (records.length !== manifest.assignments.length || records.length !== summary.verifiedTrials || ledger.length !== records.length) throw new Error('public denominator mismatch');
const recordsByTrial = new Map(records.map((record) => [record.trialId, record]));
const restricted = new Map(summary.restrictedEvidence.commitments.map((item) => [`${item.trialId}/${item.label}`, item]));
let previousLedger = null;

function publicArtifact(record, label) {
  const artifact = record.evidence[label];
  if (!artifact || artifact.sensitivity !== 'public') throw new Error(`${record.trialId}/${label}: expected public artifact`);
  const path = join(resultsRoot, 'cas', 'sha256', artifact.sha256);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== artifact.bytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error(`${record.trialId}/${label}: artifact mismatch`);
  return JSON.parse(bytes.toString('utf8'));
}

for (let index = 0; index < manifest.assignments.length; index += 1) {
  const assignment = manifest.assignments[index];
  const record = recordsByTrial.get(assignment.trialId);
  const entry = ledger[index];
  if (!record || record.recordSha256 !== sha256Json({ ...record, recordSha256: null })) throw new Error(`${assignment.trialId}: terminal digest mismatch`);
  if (canonicalJson(record.assignment) !== canonicalJson({ cellId: assignment.cellId, repositoryId: assignment.repositoryId, taskId: assignment.taskId, arm: assignment.arm, orderIndex: assignment.orderIndex }) || record.pairId !== assignment.pairId) {
    throw new Error(`${assignment.trialId}: terminal assignment mismatch`);
  }
  if (entry.sequence !== index || entry.orderIndex !== index || entry.trialId !== assignment.trialId || entry.recordSha256 !== record.recordSha256 || entry.previousEntrySha256 !== previousLedger || entry.entrySha256 !== sha256Json({ ...entry, entrySha256: null })) {
    throw new Error(`${assignment.trialId}: ledger chain mismatch`);
  }
  previousLedger = entry.entrySha256;
  for (const [label, artifact] of Object.entries(record.evidence)) {
    if (artifact.sensitivity === 'public') {
      const bytes = readFileSync(join(resultsRoot, 'cas', 'sha256', artifact.sha256));
      if (bytes.byteLength !== artifact.bytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error(`${record.trialId}/${label}: public CAS mismatch`);
    } else if (artifact.sensitivity === 'restricted') {
      const commitment = restricted.get(`${record.trialId}/${label}`);
      if (!commitment || commitment.sha256 !== artifact.sha256 || commitment.bytes !== artifact.bytes) throw new Error(`${record.trialId}/${label}: restricted commitment mismatch`);
      if (existsSync(join(resultsRoot, 'cas', 'sha256', artifact.sha256))) throw new Error(`${record.trialId}/${label}: restricted bytes were published`);
    } else throw new Error(`${record.trialId}/${label}: invalid sensitivity`);
  }
  const eventsArtifact = record.evidence.events;
  const eventLines = readFileSync(join(resultsRoot, 'cas', 'sha256', eventsArtifact.sha256), 'utf8').split('\n').filter(Boolean);
  let previousEvent = null;
  for (const [eventIndex, line] of eventLines.entries()) {
    const event = JSON.parse(line);
    if (event.sequence !== eventIndex || event.previousEventSha256 !== previousEvent || event.eventSha256 !== sha256Json({ ...event, eventSha256: null })) throw new Error(`${record.trialId}: event chain mismatch`);
    previousEvent = event.eventSha256;
  }
  const visible = publicArtifact(record, 'visiblePipeline');
  const functional = publicArtifact(record, 'functionalOracle');
  const architecture = publicArtifact(record, 'architectureOracle');
  const policy = publicArtifact(record, 'policyDiff');
  const preparation = publicArtifact(record, 'preparation');
  const isolation = publicArtifact(record, 'isolationProof');
  const cell = protocol.clientModelCells.find((item) => item.id === assignment.cellId);
  const task = manifest.tasks.find((item) => item.id === assignment.taskId);
  const repository = manifest.repositories.find((item) => item.id === assignment.repositoryId);
  if (record.bindings.sealRootSha256 !== seal.rootSha256 || record.bindings.preparedTreeSha256 !== repository.preparedTreeSha256 || preparation.preparedTreeSha256 !== repository.preparedTreeSha256 || record.bindings.treatmentConfigSha256 !== preparation.treatmentConfigSha256) throw new Error(`${record.trialId}: frozen binding mismatch`);
  if (isolation.driver !== protocol.isolation.executionDriver || isolation.driverSha256 !== protocol.isolation.executionDriverSha256 || !isolation.oracleReadDenied || !isolation.protectedWriteDenied ||
      (protocol.isolation.clientSandboxMode !== undefined && isolation.clientSandboxMode !== protocol.isolation.clientSandboxMode) ||
      (protocol.isolation.clientExecutableStagingRequired === true && isolation.clientExecutableStagedSha256 !== cell.clientArtifactSha256) ||
      (protocol.isolation.runtimeExecutableStagingRequired === true && isolation.runtimeExecutableStagedSha256 !== protocol.isolation.runtimeArtifactSha256) ||
      (protocol.isolation.readDefaultDeny === true && (!isolation.readDefaultDeny || !isolation.hostCanaryReadDenied || !isolation.hostCanaryWriteDenied)) ||
      (protocol.isolation.positiveCapabilityProofRequired === true && (!isolation.workspaceReadWriteAllowed || !isolation.stagedRuntimeVersionVerified || !isolation.stagedClientVersionVerified)) ||
      (assignment.arm === 'bce-enabled' && protocol.isolation.positiveCapabilityProofRequired === true && (!isolation.mcpHandshakePassed || !Array.isArray(isolation.mcpToolNames) || isolation.mcpToolNames.length === 0)) ||
      (cell.client === 'codex' && isolation.clientSessionObserved === true && (isolation.credentialRetiredBeforeModelToolExecution !== true || isolation.modelToolExecutionObservedBeforeCredentialRetirement !== false)) ||
      (cell.client === 'codex' && record.status === 'completed' && isolation.clientSessionObserved !== true)) throw new Error(`${record.trialId}: client isolation proof mismatch`);
  const withinBudget = record.telemetry.endToEndVisibleMs !== null && record.telemetry.endToEndVisibleMs <= task.budget.timeoutMs && record.telemetry.agentTurns !== null && record.telemetry.agentTurns <= task.budget.maxTurns && (task.budget.maxCostUsd === null || (record.telemetry.costUsd !== null && record.telemetry.costUsd <= task.budget.maxCostUsd));
  const modelIdentityVerified = record.bindings.resolvedModel === cell.resolvedModel && ['provider-response', 'synthetic-response'].includes(cell.modelIdentityEvidence);
  const expectedDerived = {
    modelIdentityVerified,
    nonBcePipelineAccepted: visible.nonBceAccepted === true,
    bceGateAccepted: assignment.arm === 'bce-enabled' ? visible.bceGateAccepted === true : null,
    visiblePipelineAccepted: visible.accepted === true,
    hiddenFunctionalPassed: functional.passed === true,
    independentArchitecturePassed: architecture.passed === true,
    policyMutation: policy.mutation === true,
    withinBudget,
  };
  expectedDerived.safeSuccessfulCompletion = record.status === 'completed' && expectedDerived.modelIdentityVerified && expectedDerived.visiblePipelineAccepted && expectedDerived.hiddenFunctionalPassed && expectedDerived.independentArchitecturePassed && !expectedDerived.policyMutation && expectedDerived.withinBudget;
  expectedDerived.escapedDefect = expectedDerived.visiblePipelineAccepted && !expectedDerived.independentArchitecturePassed;
  expectedDerived.productiveBlock = assignment.arm === 'bce-enabled' && expectedDerived.nonBcePipelineAccepted && expectedDerived.bceGateAccepted === false && (!expectedDerived.independentArchitecturePassed || expectedDerived.policyMutation);
  expectedDerived.falseBlock = assignment.arm === 'bce-enabled' && expectedDerived.nonBcePipelineAccepted && expectedDerived.bceGateAccepted === false && expectedDerived.hiddenFunctionalPassed && expectedDerived.independentArchitecturePassed && !expectedDerived.policyMutation;
  expectedDerived.collateralRegression = functional.collateralRegression === true;
  if (canonicalJson(record.derived) !== canonicalJson(expectedDerived)) throw new Error(`${record.trialId}: public outcomes do not rederive`);
}
if (previousLedger !== summary.publicReplay.ledgerHeadSha256) throw new Error('ledger head mismatch');
if (summary.analysis.verifiedTrials !== records.length) throw new Error('analysis denominator mismatch');
if (protocol.implementation.analysisCoreSha256) {
  const analysisCorePath = fileURLToPath(new URL('./lib/model-evaluation-analysis.mjs', import.meta.url));
  if (sha256Bytes(readFileSync(analysisCorePath)) !== protocol.implementation.analysisCoreSha256) throw new Error('public analysis core differs from sealed implementation');
  const replayedAnalysis = analyzeModelEvaluationRecords(
    { root: bundleRoot, protocol, manifest, seal },
    records,
    protocol.implementation.analyzerSha256,
  );
  if (canonicalJson(replayedAnalysis) !== canonicalJson(summary.analysis)) throw new Error('public aggregate analysis does not recompute from terminal records');
}
process.stdout.write(`public model-evaluation evidence verified: ${summary.studyId} (${records.length} terminal records; ${summary.resultSha256})\n`);
