#!/usr/bin/env node
/** Zero-credential verification of a public model-evaluation export. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeModelEvaluationRecords } from './lib/model-evaluation-analysis.mjs';
import { canonicalJson, expectedSeal, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';
import { SAFETY_HALT_ARCHIVE_SCHEMA_PATH, verifyPublishedSafetyHalt } from './lib/model-evaluation-halt.mjs';
import { localProviderProofMatches, localProviderProofWellFormed } from './lib/model-evaluation-provider.mjs';

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
const safetyHalted = summary.resultKind === 'safety-halt-archive' && summary.runDisposition?.status === 'safety-halt';
if (safetyHalted) {
  const runningArchiveTooling = {
    exporterSha256: sha256Bytes(readFileSync(fileURLToPath(new URL('./export-model-evaluation-public.mjs', import.meta.url)))),
    publicVerifierSha256: sha256Bytes(readFileSync(fileURLToPath(import.meta.url))),
    haltHelperSha256: sha256Bytes(readFileSync(fileURLToPath(new URL('./lib/model-evaluation-halt.mjs', import.meta.url)))),
    archiveSchemaSha256: sha256Bytes(readFileSync(SAFETY_HALT_ARCHIVE_SCHEMA_PATH)),
  };
  if (canonicalJson(summary.archiveTooling) !== canonicalJson(runningArchiveTooling)) {
    const historicalArchives = {
      'bce-accelerated-instrumentation-pilot-v4-2026-09-05': {
        commit: '06db0323b78eee999bd97ec4a6d2e92022daa1a4',
        tooling: {
          exporterSha256: 'cd6ce33dd6c0d0d2c49e88217807b7338f001628198456f9a74f96b2e0029859',
          publicVerifierSha256: '4cc204c3582cebafb3015b033014d23b87cc544e532a2312a5e7d544abd91dee',
          haltHelperSha256: '8e9a2d40dc00d8926b95982528441872b76644260e37f01484d7ad5e4c93537b',
          archiveSchemaSha256: '55754ad9439faf01b9456ac2e14f7d7863f019961e203b1d430461421795c84a',
        },
      },
    };
    const historical = historicalArchives[summary.studyId];
    if (!historical || canonicalJson(summary.archiveTooling) !== canonicalJson(historical.tooling)) throw new Error('safety-halt archive tooling digest mismatch');
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: bundleRoot, encoding: 'utf8' });
    if (top.status !== 0) throw new Error('historical archive tooling verification requires the public Git history');
    const repositoryRoot = top.stdout.trim();
    const paths = {
      exporterSha256: 'scripts/export-model-evaluation-public.mjs',
      publicVerifierSha256: 'scripts/verify-model-evaluation-public.mjs',
      haltHelperSha256: 'scripts/lib/model-evaluation-halt.mjs',
      archiveSchemaSha256: 'research/model-evaluation/schemas/safety-halt-archive.schema.json',
    };
    for (const [field, path] of Object.entries(paths)) {
      const blob = spawnSync('git', ['show', `${historical.commit}:${path}`], { cwd: repositoryRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 });
      if (blob.status !== 0 || sha256Bytes(blob.stdout) !== summary.archiveTooling[field]) {
        throw new Error(`historical safety-halt archive ${field} is not content-addressed by ${historical.commit}`);
      }
    }
  }
  if (summary.analysis !== null || summary.archive?.archiveSha256 !== sha256Json({ ...summary.archive, archiveSha256: null }) || summary.archive?.efficacyEstimatesProduced !== false) {
    throw new Error('safety-halt archive contains an analysis or has an invalid self-digest');
  }
} else if (summary.analysis.resultSha256 !== sha256Json({ ...summary.analysis, resultSha256: null })) throw new Error('analysis self-digest mismatch');
if (summary.studyId !== protocol.studyId || summary.studyId !== manifest.studyId || summary.studyId !== seal.studyId) throw new Error('studyId mismatch');
const expected = expectedSeal(bundleRoot, protocol, manifest);
if (seal.rootSha256 !== expected.rootSha256 || canonicalJson(seal.entries) !== canonicalJson(expected.entries)) throw new Error('sealed input root mismatch');
if (summary.sealedInputs.rootSha256 !== seal.rootSha256 || canonicalJson(summary.sealedInputs.attestation) !== canonicalJson(seal.attestation)) throw new Error('summary seal binding mismatch');
if (protocol.phase === 'pilot' && (seal.attestation?.eligibleForProductClaim !== false ||
    (safetyHalted ? summary.archive.claimDecision.decision !== 'not-evaluated-safety-halted-partial-run' : summary.analysis.productDecision.decision !== 'ineligible-instrumentation-pilot-no-efficacy-decision'))) {
  throw new Error('pilot export is not permanently claim-ineligible');
}

const terminalBytes = readFileSync(join(resultsRoot, 'terminal-records.jsonl'));
const ledgerBytes = readFileSync(join(resultsRoot, 'ledger.jsonl'));
if (sha256Bytes(terminalBytes) !== summary.publicReplay.terminalRecordsSha256) throw new Error('terminal export digest mismatch');
if (sha256Bytes(ledgerBytes) !== summary.publicReplay.ledgerSha256) throw new Error('ledger export digest mismatch');
const records = terminalBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const ledger = ledgerBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const plannedTrials = manifest.assignments.length;
if (records.length !== summary.verifiedTrials || ledger.length !== records.length ||
    (safetyHalted ? (records.length === 0 || records.length > plannedTrials || summary.runDisposition.plannedTrials !== plannedTrials || summary.runDisposition.committedTrials !== records.length || summary.runDisposition.unexposedTrials !== plannedTrials - records.length) : records.length !== plannedTrials)) {
  throw new Error('public denominator or safety-halt prefix mismatch');
}
const recordsByTrial = new Map(records.map((record) => [record.trialId, record]));
const restricted = new Map(summary.restrictedEvidence.commitments.map((item) => [`${item.trialId}/${item.label}`, item]));
const withheld = new Map((summary.withheldPublicEvidence?.commitments ?? []).map((item) => [`${item.trialId}/${item.label}`, item]));
let previousLedger = null;

function publicArtifact(record, label) {
  const artifact = record.evidence[label];
  if (!artifact || artifact.sensitivity !== 'public') throw new Error(`${record.trialId}/${label}: expected public artifact`);
  const path = join(resultsRoot, 'cas', 'sha256', artifact.sha256);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== artifact.bytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error(`${record.trialId}/${label}: artifact mismatch`);
  return JSON.parse(bytes.toString('utf8'));
}

for (let index = 0; index < records.length; index += 1) {
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
      const withheldCommitment = withheld.get(`${record.trialId}/${label}`);
      const publicPath = join(resultsRoot, 'cas', 'sha256', artifact.sha256);
      if (withheldCommitment) {
        if (!safetyHalted || withheldCommitment.sha256 !== artifact.sha256 || withheldCommitment.bytes !== artifact.bytes ||
            withheldCommitment.mediaType !== artifact.mediaType || withheldCommitment.originalSensitivity !== 'public' ||
            withheldCommitment.withheldReason !== 'controller-host-path-present' || existsSync(publicPath)) {
          throw new Error(`${record.trialId}/${label}: invalid withheld-public commitment`);
        }
      } else {
        const bytes = readFileSync(publicPath);
        if (bytes.byteLength !== artifact.bytes || sha256Bytes(bytes) !== artifact.sha256) throw new Error(`${record.trialId}/${label}: public CAS mismatch`);
      }
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
  const visible = safetyHalted ? null : publicArtifact(record, 'visiblePipeline');
  const functional = safetyHalted ? null : publicArtifact(record, 'functionalOracle');
  const architecture = safetyHalted ? null : publicArtifact(record, 'architectureOracle');
  const policy = publicArtifact(record, 'policyDiff');
  const preparation = publicArtifact(record, 'preparation');
  const isolation = publicArtifact(record, 'isolationProof');
  const cell = protocol.clientModelCells.find((item) => item.id === assignment.cellId);
  const task = manifest.tasks.find((item) => item.id === assignment.taskId);
  const repository = manifest.repositories.find((item) => item.id === assignment.repositoryId);
  const hardenedEvidenceRequired = typeof protocol.implementation.referenceVerifierSha256 === 'string';
  if (record.bindings.sealRootSha256 !== seal.rootSha256 || record.bindings.preparedTreeSha256 !== repository.preparedTreeSha256 || preparation.preparedTreeSha256 !== repository.preparedTreeSha256 || record.bindings.treatmentConfigSha256 !== preparation.treatmentConfigSha256) throw new Error(`${record.trialId}: frozen binding mismatch`);
  if (isolation.driver !== protocol.isolation.executionDriver || isolation.driverSha256 !== protocol.isolation.executionDriverSha256 || !isolation.oracleReadDenied || !isolation.protectedWriteDenied ||
      (protocol.isolation.clientSandboxMode !== undefined && isolation.clientSandboxMode !== protocol.isolation.clientSandboxMode) ||
      (protocol.isolation.clientExecutableStagingRequired === true && isolation.clientExecutableStagedSha256 !== cell.clientArtifactSha256) ||
      (protocol.isolation.runtimeExecutableStagingRequired === true && isolation.runtimeExecutableStagedSha256 !== protocol.isolation.runtimeArtifactSha256) ||
      (protocol.isolation.readDefaultDeny === true && (!isolation.readDefaultDeny || !isolation.hostCanaryReadDenied || !isolation.hostCanaryWriteDenied)) ||
      (protocol.isolation.positiveCapabilityProofRequired === true && (!isolation.workspaceReadWriteAllowed || !isolation.stagedRuntimeVersionVerified || !isolation.stagedClientVersionVerified)) ||
      (task.referencePatch && isolation.referencePatchReadDenied !== true) ||
      (task.shortcutPatch && isolation.shortcutPatchReadDenied !== true) ||
      (cell.client === 'bce-ollama-tool-client' && record.status !== 'infrastructure-error' &&
        (isolation.clientToolchainWriteDenied !== true || isolation.stagedToolchainIntegrityAfterExecution !== true ||
          isolation.execBroker?.driver !== cell.toolLoop.execSandbox.driver ||
          isolation.execBroker?.driverSha256 !== cell.toolLoop.execSandbox.driverSha256 ||
          !/^[0-9a-f]{64}$/.test(isolation.execBroker?.profileSha256 ?? '') ||
          isolation.execBroker?.workspaceReadWriteAllowed !== true || isolation.execBroker?.gitDiagnosticAllowed !== true || isolation.execBroker?.protectedWriteDenied !== true ||
          isolation.execBroker?.toolchainWriteDenied !== true || isolation.execBroker?.controllerCanaryReadDenied !== true ||
          (task.referencePatch && isolation.execBroker?.referencePatchReadDenied !== true) ||
          (task.shortcutPatch && isolation.execBroker?.shortcutPatchReadDenied !== true) ||
          isolation.execBroker?.processForkDenied !== true || isolation.execBroker?.providerNetworkDenied !== true ||
          isolation.execBroker?.externalNetworkDenied !== true || isolation.execBroker?.wrongLoopbackDenied !== true ||
          isolation.stagedToolchainAfterExecution?.clientArtifactSha256 !== cell.clientArtifactSha256 ||
          isolation.stagedToolchainAfterExecution?.runtimeArtifactSha256 !== protocol.isolation.runtimeArtifactSha256 ||
          isolation.stagedToolchainAfterExecution?.systemPromptSha256 !== cell.toolLoop.systemPrompt.sha256 ||
          isolation.stagedToolchainAfterExecution?.commonToolContractSha256 !== cell.toolLoop.commonToolContract.sha256)) ||
      (assignment.arm === 'bce-enabled' && protocol.isolation.positiveCapabilityProofRequired === true && (!isolation.mcpHandshakePassed || !Array.isArray(isolation.mcpToolNames) || isolation.mcpToolNames.length === 0 || (hardenedEvidenceRequired && (isolation.mcpDoneCheckAvailable !== true || !isolation.mcpToolNames.includes('run_gate'))))) ||
      (cell.localProvider && (isolation.authenticationAbsent !== true || isolation.providerReachable !== true || isolation.externalNetworkDenied !== true || isolation.nonProviderLoopbackDenied !== true ||
        !localProviderProofMatches(isolation.providerIdentityBefore, cell.localProvider) || !localProviderProofWellFormed(isolation.providerIdentityAfter, cell.localProvider) ||
        (record.status === 'completed' && (isolation.providerIdentityStable !== true || !localProviderProofMatches(isolation.providerIdentityAfter, cell.localProvider, { requireActiveModel: true }) || isolation.providerIdentityBefore.responseSha256 !== isolation.providerIdentityAfter.responseSha256)) ||
        (isolation.providerIdentityStable !== true && record.status !== 'infrastructure-error'))) ||
      (cell.client === 'codex' && isolation.clientSessionObserved === true && (isolation.credentialRetiredBeforeModelToolExecution !== true || isolation.modelToolExecutionObservedBeforeCredentialRetirement !== false)) ||
      (cell.client === 'codex' && record.status === 'completed' && isolation.clientSessionObserved !== true)) throw new Error(`${record.trialId}: client isolation proof mismatch`);
  if (safetyHalted) {
    if (record.status !== 'infrastructure-error') throw new Error(`${record.trialId}: safety-halt prefix contains a non-infrastructure terminal`);
    if (record.schemaVersion === '3') {
      if (typeof policy.assessmentComplete !== 'boolean' || typeof policy.mutationObserved !== 'boolean' ||
          typeof policy.failClosedForOutcome !== 'boolean' || policy.mutation !== policy.mutationObserved ||
          policy.failClosedForOutcome !== (!policy.assessmentComplete || policy.mutationObserved)) {
        throw new Error(`${record.trialId}: safety-halt policy tri-state is inconsistent`);
      }
    } else if (policy.conservativeFailureClassification !== true || policy.mutation !== true ||
        policy.finalPolicyPaths?.length !== 0 || policy.observedWritePaths?.length !== 0 || policy.outOfScope?.length !== 0) {
      throw new Error(`${record.trialId}: legacy safety-halt policy evidence is not the frozen conservative unknown placeholder`);
    }
    continue;
  }
  if (hardenedEvidenceRequired && assignment.arm === 'bce-enabled') {
    const gateMissingAfterFailure = visible.bceRun == null && record.status !== 'completed' && typeof visible.failure === 'string';
    if (!gateMissingAfterFailure && (canonicalJson(visible.bceRun?.command) !== canonicalJson(['bce', 'gate']) || typeof visible.bceRun?.exitCode !== 'number' || visible.bceGateAccepted !== (visible.bceRun.exitCode === 0))) {
      throw new Error(`${record.trialId}: BCE arm lacks exact controller-run gate evidence`);
    }
  } else if (hardenedEvidenceRequired && ((visible.bceRun ?? null) !== null || visible.bceGateAccepted !== null)) throw new Error(`${record.trialId}: baseline arm contains BCE gate evidence`);
  const withinBudget = record.telemetry.endToEndVisibleMs !== null && record.telemetry.endToEndVisibleMs <= task.budget.timeoutMs && record.telemetry.agentTurns !== null && record.telemetry.agentTurns <= task.budget.maxTurns && (task.budget.maxCostUsd === null || (record.telemetry.costUsd !== null && record.telemetry.costUsd <= task.budget.maxCostUsd));
  const modelIdentityVerified = record.bindings.resolvedModel === cell.resolvedModel && ['provider-response', 'synthetic-response'].includes(cell.modelIdentityEvidence);
  const triStatePolicy = record.schemaVersion === '3';
  const policyAssessmentComplete = triStatePolicy ? policy.assessmentComplete === true : true;
  const policyMutationObserved = triStatePolicy ? policy.mutationObserved === true : policy.mutation === true;
  const policyFailClosedForOutcome = triStatePolicy ? policy.failClosedForOutcome === true : policyMutationObserved;
  if (triStatePolicy && (
    typeof policy.assessmentComplete !== 'boolean' || typeof policy.mutationObserved !== 'boolean' || typeof policy.failClosedForOutcome !== 'boolean' ||
    policy.mutation !== policy.mutationObserved || policy.failClosedForOutcome !== (!policy.assessmentComplete || policy.mutationObserved)
  )) throw new Error(`${record.trialId}: public policy tri-state is inconsistent`);
  const expectedDerived = {
    modelIdentityVerified,
    nonBcePipelineAccepted: visible.nonBceAccepted === true,
    bceGateAccepted: assignment.arm === 'bce-enabled' ? visible.bceGateAccepted === true : null,
    visiblePipelineAccepted: visible.accepted === true,
    hiddenFunctionalPassed: functional.passed === true,
    independentArchitecturePassed: architecture.passed === true,
    policyMutation: policyMutationObserved,
    withinBudget,
  };
  if (triStatePolicy) Object.assign(expectedDerived, { policyAssessmentComplete, policyMutationObserved, policyFailClosedForOutcome });
  expectedDerived.safeSuccessfulCompletion = record.status === 'completed' && expectedDerived.modelIdentityVerified && expectedDerived.visiblePipelineAccepted && expectedDerived.hiddenFunctionalPassed && expectedDerived.independentArchitecturePassed && !policyFailClosedForOutcome && expectedDerived.withinBudget;
  expectedDerived.escapedDefect = expectedDerived.visiblePipelineAccepted && !expectedDerived.independentArchitecturePassed;
  expectedDerived.productiveBlock = assignment.arm === 'bce-enabled' && expectedDerived.nonBcePipelineAccepted && expectedDerived.bceGateAccepted === false && (!expectedDerived.independentArchitecturePassed || expectedDerived.policyMutation);
  expectedDerived.falseBlock = assignment.arm === 'bce-enabled' && expectedDerived.nonBcePipelineAccepted && expectedDerived.bceGateAccepted === false && policyAssessmentComplete && expectedDerived.hiddenFunctionalPassed && expectedDerived.independentArchitecturePassed && !expectedDerived.policyMutation;
  expectedDerived.collateralRegression = functional.collateralRegression === true;
  if (canonicalJson(record.derived) !== canonicalJson(expectedDerived)) throw new Error(`${record.trialId}: public outcomes do not rederive`);
}
if (previousLedger !== summary.publicReplay.ledgerHeadSha256) throw new Error('ledger head mismatch');
if ((safetyHalted ? summary.archive.verifiedTrials : summary.analysis.verifiedTrials) !== records.length) throw new Error('result denominator mismatch');
if (safetyHalted) {
  const haltBytes = readFileSync(join(resultsRoot, 'study-halt.json'));
  verifyPublishedSafetyHalt(summary, { root: bundleRoot, protocol, manifest, seal }, records, ledger, haltBytes);
} else if (protocol.implementation.analysisCoreSha256) {
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
