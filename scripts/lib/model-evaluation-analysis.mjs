/** Pure, sealed analysis shared by the restricted analyzer and public replay verifier. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Bytes, sha256Json } from './model-evaluation.mjs';

const quantile = (input, probability) => {
  if (!input.length) return null;
  const values = [...input].sort((a, b) => a - b);
  const position = (values.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
};
const median = (values) => quantile(values, 0.5);
const rate = (rows, predicate) => {
  const successes = rows.filter(predicate).length;
  const total = rows.length;
  if (!total) return { successes, total, estimate: null, low: null, high: null, interval: 'wilson-95' };
  const estimate = successes / total;
  const z = 1.959963984540054;
  const denominator = 1 + (z * z) / total;
  const center = (estimate + (z * z) / (2 * total)) / denominator;
  const half = z * Math.sqrt((estimate * (1 - estimate) + (z * z) / (4 * total)) / total) / denominator;
  return { successes, total, estimate, low: Math.max(0, center - half), high: Math.min(1, center + half), interval: 'wilson-95' };
};
const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

function pairedRows(rows) {
  const pairs = new Map();
  for (const row of rows) {
    const pair = pairs.get(row.pairId) ?? {};
    pair[row.assignment.arm] = row;
    pairs.set(row.pairId, pair);
  }
  for (const [pairId, pair] of pairs) {
    if (!pair['baseline-no-bce'] || !pair['bce-enabled']) throw new Error(`${pairId}: incomplete pair after denominator verification`);
    if (pair['baseline-no-bce'].assignment.taskId !== pair['bce-enabled'].assignment.taskId ||
        pair['baseline-no-bce'].assignment.repositoryId !== pair['bce-enabled'].assignment.repositoryId) {
      throw new Error(`${pairId}: paired records differ in task or repository`);
    }
  }
  return [...pairs.entries()].map(([pairId, pair]) => ({ pairId, baseline: pair['baseline-no-bce'], bce: pair['bce-enabled'] }));
}

function pairedDifference(bundle, rows, field, benefitDirection = 'bce-minus-baseline') {
  const pairs = pairedRows(rows);
  const signed = (pair) => {
    const bce = pair.bce.derived[field] ? 1 : 0;
    const baseline = pair.baseline.derived[field] ? 1 : 0;
    return benefitDirection === 'baseline-minus-bce' ? baseline - bce : bce - baseline;
  };
  const repositories = [...new Set(pairs.map((pair) => pair.bce.assignment.repositoryId))].sort();
  const seedHex = sha256Bytes(`${bundle.protocol.randomization.seed}\0${rows[0].assignment.cellId}\0${field}\0${benefitDirection}`).slice(0, 8);
  const random = mulberry32(Number.parseInt(seedHex, 16));
  const draws = [];
  const drawCount = bundle.protocol.analysis.bootstrapDraws;
  for (let draw = 0; draw < drawCount; draw += 1) {
    const sampled = [];
    for (let index = 0; index < repositories.length; index += 1) {
      const repositoryId = repositories[Math.floor(random() * repositories.length)];
      sampled.push(...pairs.filter((pair) => pair.bce.assignment.repositoryId === repositoryId));
    }
    draws.push(sampled.reduce((sum, pair) => sum + signed(pair), 0) / sampled.length);
  }
  const values = pairs.map(signed);
  return {
    estimate: values.reduce((sum, value) => sum + value, 0) / values.length,
    low: quantile(draws, 0.025),
    high: quantile(draws, 0.975),
    pairs: pairs.length,
    repositoryClusters: repositories.length,
    direction: benefitDirection,
    method: `${drawCount}-draw deterministic repository-cluster bootstrap over paired task differences`,
  };
}

function metricSummary(rows, key) {
  const observed = rows.map((row) => row.telemetry[key]).filter((value) => value !== null);
  const reasonCounts = {};
  for (const row of rows) {
    if (row.telemetry[key] !== null) continue;
    const reason = row.telemetry.missingReasons[key];
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    observed: observed.length,
    missing: rows.length - observed.length,
    missingReasons: reasonCounts,
    sumKnown: observed.length ? observed.reduce((sum, value) => sum + value, 0) : null,
    medianKnown: median(observed),
  };
}

function pairedRatio(bundle, rows, key) {
  const pairs = [];
  let missingPairs = 0;
  for (const pair of pairedRows(rows)) {
    const baseline = pair.baseline.telemetry[key];
    const bce = pair.bce.telemetry[key];
    if (baseline === null || bce === null || baseline === 0) missingPairs += 1;
    else pairs.push({ repositoryId: pair.bce.assignment.repositoryId, value: bce / baseline });
  }
  const repositories = [...new Set(pairs.map((pair) => pair.repositoryId))].sort();
  const random = mulberry32(Number.parseInt(sha256Bytes(`${bundle.protocol.randomization.seed}\0ratio\0${rows[0].assignment.cellId}\0${key}`).slice(0, 8), 16));
  const draws = [];
  if (pairs.length > 0) {
    for (let draw = 0; draw < bundle.protocol.analysis.bootstrapDraws; draw += 1) {
      const sampled = [];
      for (let index = 0; index < repositories.length; index += 1) {
        const repositoryId = repositories[Math.floor(random() * repositories.length)];
        sampled.push(...pairs.filter((pair) => pair.repositoryId === repositoryId).map((pair) => pair.value));
      }
      draws.push(median(sampled));
    }
  }
  return {
    median: median(pairs.map((pair) => pair.value)),
    low: quantile(draws, 0.025),
    high: quantile(draws, 0.975),
    observedPairs: pairs.length,
    missingPairs,
    method: `${bundle.protocol.analysis.bootstrapDraws}-draw deterministic repository-cluster bootstrap of paired ratios`,
  };
}

function summarizeArm(rows) {
  const visibleAccepted = rows.filter((row) => row.derived.visiblePipelineAccepted);
  const summary = {
    trials: rows.length,
    statuses: Object.fromEntries([...new Set(rows.map((row) => row.status))].sort().map((status) => [status, rows.filter((row) => row.status === status).length])),
    safeSuccessfulCompletion: rate(rows, (row) => row.derived.safeSuccessfulCompletion),
    taskSuccess: rate(rows, (row) => row.derived.hiddenFunctionalPassed),
    architectureConformance: rate(rows, (row) => row.derived.independentArchitecturePassed),
    escapedDefectItt: rate(rows, (row) => row.derived.escapedDefect),
    escapedDefectConditionalOnVisibleAcceptance: rate(visibleAccepted, (row) => row.derived.escapedDefect),
    productiveBlock: rate(rows, (row) => row.derived.productiveBlock),
    falseBlock: rate(rows, (row) => row.derived.falseBlock),
    policyMutation: rate(rows, (row) => row.derived.policyMutation),
    collateralRegression: rate(rows, (row) => row.derived.collateralRegression),
    mechanism: {
      eventEvidenceAvailable: rows.filter((row) => row.mechanism.eventEvidenceAvailable).length,
      skillReadObserved: rows.filter((row) => row.mechanism.skillReadObserved === true).length,
      skillReadUnknown: rows.filter((row) => row.mechanism.skillReadObserved === null).length,
      mcpToolCallsKnown: rows.every((row) => row.mechanism.mcpToolCalls !== null) ? rows.reduce((sum, row) => sum + row.mechanism.mcpToolCalls, 0) : null,
      bceGateCallsKnown: rows.every((row) => row.mechanism.bceGateCalls !== null) ? rows.reduce((sum, row) => sum + row.mechanism.bceGateCalls, 0) : null,
      redToGreenCorrectionsKnown: rows.every((row) => row.mechanism.redToGreenCorrectionObserved !== null) ? rows.filter((row) => row.mechanism.redToGreenCorrectionObserved).length : null,
    },
    telemetry: Object.fromEntries(['latencyMs', 'nonBcePipelineMs', 'bceGateMs', 'endToEndVisibleMs', 'oracleMs', 'agentTurns', 'inputTokens', 'outputTokens', 'cachedTokens', 'costUsd'].map((key) => [key, metricSummary(rows, key)])),
  };
  if (rows.some((row) => row.schemaVersion === '3')) {
    summary.policyAssessmentComplete = rate(rows, (row) => row.derived.policyAssessmentComplete);
  }
  return summary;
}

export function analyzeModelEvaluationRecords(bundle, records, analyzerSha256) {
  const cellReports = {};
  for (const cell of bundle.protocol.clientModelCells) {
    const rows = records.filter((record) => record.assignment.cellId === cell.id);
    const expected = bundle.manifest.tasks.length * 2;
    if (rows.length !== expected) throw new Error(`${cell.id}: expected ${expected} verified trials, got ${rows.length}`);
    const arms = Object.fromEntries(bundle.protocol.arms.map((arm) => [arm, summarizeArm(rows.filter((record) => record.assignment.arm === arm))]));
    cellReports[cell.id] = {
      role: cell.role,
      identity: {
        client: cell.client, clientVersion: cell.clientVersion, clientArtifactSha256: cell.clientArtifactSha256,
        requestedModel: cell.requestedModel, resolvedModel: cell.resolvedModel,
        modelIdentitySource: cell.modelIdentitySource, modelIdentityEvidence: cell.modelIdentityEvidence,
        reasoningEffort: cell.reasoningEffort,
      },
      arms,
      pairedEffects: {
        safeSuccessfulCompletion: pairedDifference(bundle, rows, 'safeSuccessfulCompletion'),
        escapedDefectReduction: pairedDifference(bundle, rows, 'escapedDefect', 'baseline-minus-bce'),
        policyMutation: pairedDifference(bundle, rows, 'policyMutation'),
      },
      pairedResourceRatios: {
        endToEndVisibleMs: pairedRatio(bundle, rows, 'endToEndVisibleMs'),
        costUsd: pairedRatio(bundle, rows, 'costUsd'),
      },
    };
  }

  const primaryCell = Object.entries(cellReports).find(([, report]) => report.role === 'primary');
  if (!primaryCell) throw new Error('no primary cell after bundle verification');
  const [primaryCellId, primary] = primaryCell;
  const rules = bundle.protocol.decisionRules.recommendDefaultOnlyIfAll;
  const primaryBaselineEscape = primary.arms['baseline-no-bce'].escapedDefectItt.estimate;
  const primaryBceEscape = primary.arms['bce-enabled'].escapedDefectItt.estimate;
  const relativeEscapeReduction = primaryBaselineEscape > 0 ? (primaryBaselineEscape - primaryBceEscape) / primaryBaselineEscape : null;
  const conservativeRelativeEscapeReduction = primary.arms['baseline-no-bce'].escapedDefectItt.low > 0
    ? 1 - (primary.arms['bce-enabled'].escapedDefectItt.high / primary.arms['baseline-no-bce'].escapedDefectItt.low)
    : null;
  const frictionException = primary.pairedEffects.safeSuccessfulCompletion.low >= bundle.protocol.decisionRules.frictionExceptionRequiresSafeSuccessGain;
  const checks = {
    primarySafeSuccessGain: primary.pairedEffects.safeSuccessfulCompletion.low >= rules.safeSuccessRiskDifferenceMinimum,
    primaryEscapedDefectAbsoluteReduction: primary.pairedEffects.escapedDefectReduction.low >= rules.escapedDefectAbsoluteReductionMinimum,
    primaryEscapedDefectRelativeReduction: conservativeRelativeEscapeReduction !== null && conservativeRelativeEscapeReduction >= rules.escapedDefectRelativeReductionMinimum,
    primaryFalseBlockRate: primary.arms['bce-enabled'].falseBlock.high <= rules.falseBlockRateMaximum,
    worstCellSafeSuccess: Math.min(...Object.values(cellReports).map((report) => report.pairedEffects.safeSuccessfulCompletion.low)) >= rules.worstCellSafeSuccessRiskDifferenceMinimum,
    policyMutation: Math.max(...Object.values(cellReports).map((report) => report.pairedEffects.policyMutation.high)) <= rules.policyMutationRiskDifferenceMaximum,
    pairedCost: primary.pairedResourceRatios.costUsd.high !== null && (primary.pairedResourceRatios.costUsd.high <= rules.medianPairedCostRatioMaximum || frictionException),
    pairedWallTime: primary.pairedResourceRatios.endToEndVisibleMs.high !== null && (primary.pairedResourceRatios.endToEndVisibleMs.high <= rules.medianPairedWallTimeRatioMaximum || frictionException),
  };
  if (records.some((record) => record.schemaVersion === '3')) {
    checks.policyAssessmentComplete = Object.values(cellReports).every((report) =>
      Object.values(report.arms).every((arm) => arm.policyAssessmentComplete?.successes === arm.policyAssessmentComplete?.total));
  }
  const decision = bundle.protocol.phase === 'pilot'
    ? 'ineligible-instrumentation-pilot-no-efficacy-decision'
    : Object.values(checks).every(Boolean) ? 'recommend-bce-default-for-this-frozen-evaluation-scope' : 'thresholds-not-established-do-not-claim-uplift';

  const analysis = {
    schemaVersion: '2',
    studyId: bundle.protocol.studyId,
    evidenceClass: bundle.protocol.phase === 'pilot' ? 'author-operated-instrumentation-pilot' : 'author-operated-randomized-evaluation',
    operatorModel: bundle.protocol.operatorModel,
    causalClaimScope: bundle.protocol.claimScope,
    pooledConfirmatoryEstimate: null,
    verifiedTrials: records.length,
    bindings: {
      sealRootSha256: bundle.seal.rootSha256,
      protocolSha256: sha256Bytes(readFileSync(resolve(bundle.root, 'protocol.v2.json'))),
      manifestSha256: sha256Bytes(readFileSync(resolve(bundle.root, 'task-manifest.json'))),
      analyzerSha256,
      analysisCoreSha256: bundle.protocol.implementation.analysisCoreSha256 ?? null,
    },
    cells: cellReports,
    productDecision: {
      primaryCell: primaryCellId, decision,
      checks: bundle.protocol.phase === 'pilot' ? null : checks,
      relativeEscapedDefectReduction: relativeEscapeReduction,
      conservativeRelativeEscapedDefectReduction: bundle.protocol.phase === 'pilot' ? null : conservativeRelativeEscapeReduction,
      reason: bundle.protocol.phase === 'pilot' ? 'Development-exposed, author-operated instrumentation pilot; outcomes are permanently ineligible for product-efficacy or default recommendations.' : null,
    },
    limitations: [
      'The study operator selected the tasks and authored the machine oracles; this is not independent validation.',
      'The estimate applies only to the exact sealed repositories, tasks, clients, models, versions, and run conditions.',
      'A hazard-enriched task corpus does not estimate natural defect prevalence or production incident reduction.',
      'Mechanism observations such as skill loading, MCP selection, and BCE gate calls are not product-success outcomes.',
      ...(bundle.protocol.clientModelCells.some((cell) => cell.modelIdentityEvidence !== 'provider-response')
        ? ['At least one client records only requested model configuration rather than a provider-returned model identity; those rows cannot satisfy safe successful completion.']
        : []),
      ...(records.some((record) => record.schemaVersion === '3' && record.derived.policyAssessmentComplete !== true)
        ? ['At least one policy assessment is incomplete. It is not counted as observed manipulation, and it independently prevents a default recommendation.']
        : []),
    ],
    resultSha256: null,
  };
  analysis.resultSha256 = sha256Json(analysis);
  return analysis;
}
