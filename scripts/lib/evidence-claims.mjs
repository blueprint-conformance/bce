import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve, sep } from 'node:path';

const MATRIX_PATH = 'research/claim-evidence-matrix.json';
const SHA256 = /^[0-9a-f]{64}$/;
const CLAIM_STATUSES = new Set(['product-test-supported', 'directional-observation', 'unestablished']);
const EVIDENCE_CLASSES = new Set(['first-party-mechanism-test', 'author-operated-instrumentation-pilot']);
const V6_BOUNDARY = 'instrumentation-only-development-pilot; never product-efficacy evidence and never a recommendation';
const V6_SCOPE = 'directional-post-ceiling-first-party-pilot-for-one-exact-qualified-local-model-cell-development-only-no-product-efficacy-default-cost-or-transportability-claim';
const V6_DECISION = 'ineligible-instrumentation-pilot-no-efficacy-decision';
const NO_EFFICACY_CLAIM = 'no-efficacy-claim';
const PRIMARY_CLAIM = 'bounded-primary-causal-effect-exact-cell-release-and-task-population';
const TRANSPORT_CLAIM = 'bounded-transportability-causal-effect-exact-cell-release-and-task-population';
const DEFAULT_ADOPTION_CLAIM = 'bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population';

function fail(message) {
  throw new Error(`claim-evidence: ${message}`);
}

function readJson(root, path) {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8'));
  } catch (error) {
    fail(`${path} is not readable JSON: ${error.message}`);
  }
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} keys must be exactly ${expected.join(', ')}`);
  }
}

function boundedFile(root, path, label) {
  if (typeof path !== 'string' || path === '' || isAbsolute(path) || path.split('/').includes('..')) {
    fail(`${label} must be a repository-relative path without traversal`);
  }
  const absolute = join(root, path);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) fail(`${label} does not name a regular file: ${path}`);
  const actual = realpathSync(absolute);
  const boundary = `${realpathSync(root)}${sep}`;
  if (!actual.startsWith(boundary)) fail(`${label} resolves outside the repository: ${path}`);
}

function countByArm(assignments, arm) {
  return assignments.filter((assignment) => assignment.arm === arm).length;
}

function assertRate(rate, total, label) {
  if (!rate || !Number.isInteger(rate.successes) || rate.total !== total ||
      rate.successes < 0 || rate.successes > total || rate.estimate !== rate.successes / total) {
    fail(`${label} is not an exact successes/total/estimate triple`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Json(value) {
  return sha256(JSON.stringify(canonical(value)));
}

export function deriveFoundryClaimClasses(protocol) {
  if (['design-draft', 'frozen-ready-not-run', 'safety-halted'].includes(protocol?.lifecycle)) {
    return [NO_EFFICACY_CLAIM];
  }
  const completed = Array.isArray(protocol?.stages)
    ? protocol.stages.filter((stage) => stage.lifecycle === 'complete')
    : [];
  if (protocol?.lifecycle === 'running' && completed.length === 0) return [NO_EFFICACY_CLAIM];
  if (!['running', 'complete'].includes(protocol?.lifecycle)) fail('Evidence Foundry v3 lifecycle cannot derive a public claim class');
  const claims = [];
  if (completed.some((stage) => stage.stageType === 'primary-confirmatory')) claims.push(PRIMARY_CLAIM);
  if (completed.some((stage) => stage.stageType === 'transport-confirmatory')) claims.push(TRANSPORT_CLAIM);
  if (protocol.lifecycle === 'complete' && completed.length === protocol.stages.length) claims.push(DEFAULT_ADOPTION_CLAIM);
  return claims.length > 0 ? claims : [NO_EFFICACY_CLAIM];
}

export function loadEvidenceClaims(rootInput = '.') {
  const root = resolve(rootInput);
  const matrix = readJson(root, MATRIX_PATH);
  exactKeys(matrix, ['schemaVersion', 'studies', 'claims', 'publicBoundaries'], MATRIX_PATH);
  if (matrix.schemaVersion !== '3') fail(`${MATRIX_PATH} has unsupported schemaVersion`);
  if (!Array.isArray(matrix.studies) || matrix.studies.length !== 2) fail('studies must contain exactly the v6 public result and Evidence Foundry v3 design');
  if (!Array.isArray(matrix.claims) || matrix.claims.length === 0) fail('claims must be a non-empty array');
  if (!Array.isArray(matrix.publicBoundaries) || matrix.publicBoundaries.length === 0) fail('publicBoundaries must be non-empty');

  const claimIds = new Set();
  for (const [index, claim] of matrix.claims.entries()) {
    const label = `claims[${index}]`;
    exactKeys(claim, ['id', 'claim', 'status', 'evidenceClass', 'studyId', 'evidence'], label);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(claim.id ?? '') || claimIds.has(claim.id)) fail(`${label}.id must be unique kebab-case`);
    claimIds.add(claim.id);
    if (typeof claim.claim !== 'string' || claim.claim.trim() !== claim.claim || claim.claim.length < 12) fail(`${label}.claim is invalid`);
    if (!CLAIM_STATUSES.has(claim.status)) fail(`${label}.status is unsupported`);
    if (claim.status === 'unestablished') {
      if (claim.evidence !== null || claim.evidenceClass !== null || claim.studyId !== null) {
        fail(`${label} is unestablished and must not carry evidence or an evidence class`);
      }
    } else {
      if (!EVIDENCE_CLASSES.has(claim.evidenceClass)) fail(`${label}.evidenceClass is unsupported`);
      if (!Array.isArray(claim.evidence) || claim.evidence.length === 0) fail(`${label}.evidence must be non-empty`);
      for (const path of claim.evidence) boundedFile(root, path, `${label}.evidence`);
    }
    if (claim.status === 'product-test-supported' && claim.evidenceClass !== 'first-party-mechanism-test') {
      fail(`${label}: product-test-supported requires first-party-mechanism-test evidence`);
    }
    if (claim.status === 'directional-observation' && claim.evidenceClass !== 'author-operated-instrumentation-pilot') {
      fail(`${label}: directional observations require the author-operated pilot evidence class`);
    }
  }

  const study = matrix.studies.find((entry) => entry.id === 'accelerated-v6');
  const foundryStudy = matrix.studies.find((entry) => entry.id === 'evidence-foundry-v3');
  if (!study || !foundryStudy || study === foundryStudy) fail('the public study index must uniquely identify v6 and Evidence Foundry v3');
  exactKeys(study, ['id', 'label', 'evidenceClass', 'summary', 'protocol', 'manifest', 'studyId', 'resultSha256', 'sealRootSha256', 'eligibility'], 'studies[0]');
  if (study.id !== 'accelerated-v6' || study.evidenceClass !== 'author-operated-instrumentation-pilot') fail('the public study must be accelerated-v6 author-operated instrumentation');
  if (!SHA256.test(study.resultSha256 ?? '') || !SHA256.test(study.sealRootSha256 ?? '')) fail('the public study must carry full result and seal SHA-256 anchors');
  exactKeys(study.eligibility, ['productEfficacy', 'defaultAdoption', 'cost', 'transportability', 'independentReplication'], 'studies[0].eligibility');
  if (Object.values(study.eligibility).some((value) => value !== false)) fail('accelerated-v6 is ineligible for every product claim class');
  for (const field of ['summary', 'protocol', 'manifest']) boundedFile(root, study[field], `studies[0].${field}`);

  const summary = readJson(root, study.summary);
  const protocol = readJson(root, study.protocol);
  const manifest = readJson(root, study.manifest);
  if (summary.resultSha256 !== sha256Json({ ...summary, resultSha256: null }) ||
      summary.analysis?.resultSha256 !== sha256Json({ ...summary.analysis, resultSha256: null })) {
    fail('v6 summary or analysis self-digest is invalid');
  }
  if (sha256(readFileSync(join(root, study.protocol))) !== summary.analysis?.bindings?.protocolSha256 ||
      sha256(readFileSync(join(root, study.manifest))) !== summary.analysis?.bindings?.manifestSha256) {
    fail('v6 protocol or manifest bytes differ from the public result bindings');
  }
  if (new Set([summary.studyId, protocol.studyId, manifest.studyId, study.studyId]).size !== 1) fail('v6 study identities do not cross-bind');
  if (summary.evidenceClass !== study.evidenceClass || summary.analysis?.evidenceClass !== study.evidenceClass) fail('v6 evidence class drifted');
  if (summary.claimBoundary !== V6_BOUNDARY || protocol.claimScope !== V6_SCOPE || summary.analysis?.causalClaimScope !== V6_SCOPE) fail('v6 claim boundary drifted');
  if (summary.analysis?.productDecision?.decision !== V6_DECISION || summary.analysis?.pooledConfirmatoryEstimate !== null) fail('v6 must remain decision-ineligible with no pooled confirmatory estimate');
  if (summary.resultSha256 !== study.resultSha256 || summary.sealedInputs?.rootSha256 !== study.sealRootSha256) fail('v6 result or seal anchor differs from the claim index');
  if (summary.runDisposition?.status !== 'complete' || summary.verifiedTrials !== 16 ||
      summary.runDisposition.plannedTrials !== 16 || summary.runDisposition.committedTrials !== 16) {
    fail('v6 must retain all 16 planned attempts in the completed public result');
  }
  if (protocol.matrix?.repositories !== 4 || protocol.matrix?.totalRandomizedTrials !== 16 ||
      protocol.matrix?.trialsPerArmPerCell !== 8 || protocol.matrix?.exactCartesianPairing !== true) {
    fail('v6 protocol topology differs from the indexed 4-repository, 16-attempt paired pilot');
  }
  if (!Array.isArray(manifest.repositories) || manifest.repositories.length !== 4 ||
      !Array.isArray(manifest.tasks) || manifest.tasks.length !== 8 ||
      !Array.isArray(manifest.assignments) || manifest.assignments.length !== 16 ||
      countByArm(manifest.assignments, 'baseline-no-bce') !== 8 || countByArm(manifest.assignments, 'bce-enabled') !== 8) {
    fail('v6 manifest is not the exact 4-repository x 8-task x 2-arm topology');
  }

  const cells = Object.entries(summary.analysis?.cells ?? {});
  if (cells.length !== 1) fail('v6 public result must contain exactly one model/client cell');
  const [cellId, cell] = cells[0];
  const protocolCell = protocol.clientModelCells?.find((entry) => entry.id === cellId);
  if (!protocolCell || protocolCell.client !== cell.identity?.client ||
      protocolCell.clientVersion !== cell.identity?.clientVersion ||
      protocolCell.resolvedModel !== cell.identity?.resolvedModel) fail('v6 public model/client identity does not match the sealed protocol');
  const baseline = cell.arms?.['baseline-no-bce'];
  const bce = cell.arms?.['bce-enabled'];
  if (baseline?.trials !== 8 || bce?.trials !== 8) fail('v6 result must retain eight trials in each arm');
  for (const [name, arm] of [['baseline', baseline], ['bce', bce]]) {
    assertRate(arm?.safeSuccessfulCompletion, 8, `${name} safe successful completion`);
    assertRate(arm?.taskSuccess, 8, `${name} task success`);
    assertRate(arm?.architectureConformance, 8, `${name} architecture conformance`);
    assertRate(arm?.escapedDefectItt, 8, `${name} escaped defects`);
    assertRate(arm?.policyMutation, 8, `${name} policy mutation`);
  }
  const safeEffect = cell.pairedEffects?.safeSuccessfulCompletion;
  const escapedEffect = cell.pairedEffects?.escapedDefectReduction;
  const elapsedRatio = cell.pairedResourceRatios?.endToEndVisibleMs;
  if (safeEffect?.pairs !== 8 || escapedEffect?.pairs !== 8 || elapsedRatio?.observedPairs !== 8) fail('v6 paired results do not retain all eight pairs');

  exactKeys(foundryStudy, [
    'id', 'label', 'evidenceClass', 'registry', 'protocol', 'powerDesign', 'studyId',
    'registrySha256', 'protocolSha256', 'powerDesignSha256', 'lifecycle', 'ready',
    'currentClaimClasses', 'primaryStage', 'prospectiveStageCount',
  ], 'Evidence Foundry v3 study');
  for (const field of ['registry', 'protocol', 'powerDesign']) boundedFile(root, foundryStudy[field], `Evidence Foundry v3.${field}`);
  for (const field of ['registrySha256', 'protocolSha256', 'powerDesignSha256']) {
    if (!SHA256.test(foundryStudy[field] ?? '')) fail(`Evidence Foundry v3.${field} must be a full SHA-256 anchor`);
  }
  if (sha256(readFileSync(join(root, foundryStudy.registry))) !== foundryStudy.registrySha256 ||
      sha256(readFileSync(join(root, foundryStudy.protocol))) !== foundryStudy.protocolSha256 ||
      sha256(readFileSync(join(root, foundryStudy.powerDesign))) !== foundryStudy.powerDesignSha256) {
    fail('Evidence Foundry v3 registry, protocol, or power-design digest differs from the public claim index');
  }
  const foundryRegistry = readJson(root, foundryStudy.registry);
  const foundryProtocol = readJson(root, foundryStudy.protocol);
  const foundryPower = readJson(root, foundryStudy.powerDesign);
  const registryEntry = foundryRegistry.studies?.find((entry) => entry.studyId === foundryStudy.studyId);
  if (!registryEntry || registryEntry.protocolPath !== foundryStudy.protocol || registryEntry.powerDesignPath !== foundryStudy.powerDesign ||
      registryEntry.protocolSha256 !== foundryStudy.protocolSha256 || registryEntry.powerDesignSha256 !== foundryStudy.powerDesignSha256) {
    fail('Evidence Foundry v3 registry entry does not bind the indexed protocol and power design');
  }
  const expectedEvidenceClass = foundryProtocol.lifecycle === 'design-draft'
    ? 'confirmatory-program-design'
    : 'confirmatory-staged-causal-study';
  if (foundryStudy.evidenceClass !== expectedEvidenceClass || registryEntry.evidenceClass !== expectedEvidenceClass) {
    fail('Evidence Foundry v3 evidence class differs from its lifecycle');
  }
  const derivedClaimClasses = deriveFoundryClaimClasses(foundryProtocol);
  if (foundryProtocol.lifecycle !== foundryStudy.lifecycle || registryEntry.lifecycle !== foundryStudy.lifecycle ||
      JSON.stringify(foundryProtocol.currentClaimClasses) !== JSON.stringify(derivedClaimClasses) ||
      JSON.stringify(foundryStudy.currentClaimClasses) !== JSON.stringify(derivedClaimClasses) ||
      JSON.stringify(registryEntry.currentClaimClasses) !== JSON.stringify(derivedClaimClasses)) {
    fail('Evidence Foundry v3 lifecycle and exact derived claim classes do not cross-bind');
  }
  if (typeof foundryStudy.ready !== 'boolean' ||
      (foundryProtocol.lifecycle !== 'frozen-ready-not-run' && foundryStudy.ready !== false)) {
    fail('Evidence Foundry v3 readiness is not structurally valid for its lifecycle');
  }
  exactKeys(foundryStudy.primaryStage, ['stageId', 'repositoryClusters', 'tasksPerRepository', 'pairs', 'retainedAttempts'], 'Evidence Foundry v3 primaryStage');
  const primaryStage = foundryProtocol.stages?.find((stage) => stage.stageType === 'primary-confirmatory');
  const primaryPower = foundryPower.stages?.find((stage) => stage.stageId === primaryStage?.id);
  const expectedPairs = foundryProtocol.taskPopulation.repositoryClusters * foundryProtocol.taskPopulation.tasksPerRepository;
  if (!primaryStage || primaryStage.id !== foundryStudy.primaryStage.stageId ||
      foundryStudy.primaryStage.repositoryClusters !== foundryProtocol.taskPopulation.repositoryClusters ||
      foundryStudy.primaryStage.tasksPerRepository !== foundryProtocol.taskPopulation.tasksPerRepository ||
      foundryStudy.primaryStage.pairs !== expectedPairs || foundryProtocol.taskPopulation.pairsPerCell !== expectedPairs ||
      foundryStudy.primaryStage.retainedAttempts !== expectedPairs * foundryProtocol.arms.length ||
      primaryPower?.plannedPairs !== expectedPairs) {
    fail('Evidence Foundry v3 primary topology differs from the indexed 40-repository, 120-pair, 240-attempt design');
  }
  if (foundryStudy.prospectiveStageCount !== foundryProtocol.stages.length || foundryProtocol.stages.length !== 4 ||
      foundryProtocol.stages.filter((stage) => stage.stageType === 'transport-confirmatory').length !== 3) {
    fail('Evidence Foundry v3 prospective stage topology differs from one primary plus three transport cells');
  }

  const directional = matrix.claims.find((claim) => claim.id === 'accelerated-v6-directional-observation');
  if (directional?.status !== 'directional-observation' || directional.studyId !== study.id) fail('v6 claim must remain a directional observation bound to accelerated-v6');
  for (const id of ['heldout-generalization', 'coding-agent-outcomes', 'cost-or-iteration', 'independent-governance']) {
    if (matrix.claims.find((claim) => claim.id === id)?.status !== 'unestablished') fail(`${id} must remain unestablished`);
  }

  const boundaryPaths = new Set();
  for (const [index, boundary] of matrix.publicBoundaries.entries()) {
    exactKeys(boundary, ['path', 'required'], `publicBoundaries[${index}]`);
    boundedFile(root, boundary.path, `publicBoundaries[${index}].path`);
    if (boundaryPaths.has(boundary.path)) fail(`public boundary path is duplicated: ${boundary.path}`);
    boundaryPaths.add(boundary.path);
    const content = readFileSync(join(root, boundary.path), 'utf8');
    if (typeof boundary.required !== 'string' || !content.includes(boundary.required)) fail(`${boundary.path} is missing its required claim boundary`);
  }

  return {
    root, matrix, study, summary, protocol, manifest, foundryStudy, foundryProtocol, foundryPower, cellId, cell, baseline, bce,
    safeEffect, escapedEffect, elapsedRatio,
    unestablished: matrix.claims.filter((claim) => claim.status === 'unestablished'),
  };
}

export function bindVerifiedFoundryRegistry(evidence, foundryRegistryReport) {
  if (!evidence || typeof evidence !== 'object') fail('structural evidence projection is required before full verification');
  const verifiedStudy = foundryRegistryReport?.studies?.find(
    (entry) => entry.studyId === evidence.foundryStudy?.studyId,
  );
  if (!verifiedStudy) fail('Evidence Foundry v3 full verifier omitted the indexed study');
  const primaryStageId = evidence.foundryStudy.primaryStage.stageId;
  if (foundryRegistryReport.readinessScope !== primaryStageId || verifiedStudy.readinessScope !== primaryStageId) {
    fail('Evidence Foundry v3 verifier report is not scoped to the exact primary confirmatory stage');
  }
  const executionReady = evidence.foundryProtocol.lifecycle === 'frozen-ready-not-run' && verifiedStudy.ready === true;
  if (evidence.foundryStudy.ready !== executionReady) {
    fail('Evidence Foundry v3 readiness differs from verified primary-stage execution readiness');
  }
  return evidence;
}
