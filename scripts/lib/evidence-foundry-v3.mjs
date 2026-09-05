import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { verifyBundle } from './model-evaluation.mjs';

export const EVIDENCE_FOUNDRY_VALIDATOR_VERSION = 'bce-evidence-foundry-v3-foundation-1';

export const CLAIM_CLASSES = [
  {
    id: 'no-efficacy-claim',
    efficacyEligible: false,
    meaning: 'The evidence cannot support a product-efficacy, transportability, safety, cost, or adoption claim.',
  },
  {
    id: 'apparatus-validation-only',
    efficacyEligible: false,
    meaning: 'The evidence exercises research machinery only and is permanently ineligible for product-efficacy claims.',
  },
  {
    id: 'bounded-primary-causal-effect-exact-cell-release-and-task-population',
    efficacyEligible: true,
    meaning: 'A causal estimate for only the sealed primary client/model cell, byte-identical release, and frozen task population.',
  },
  {
    id: 'bounded-transportability-causal-effect-exact-cell-release-and-task-population',
    efficacyEligible: true,
    meaning: 'A causal transport estimate for only one sealed transport cell, byte-identical release, and frozen task population.',
  },
  {
    id: 'bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population',
    efficacyEligible: true,
    meaning: 'A bounded adoption decision after every preregistered primary and transport cell completes for the exact frozen scope.',
  },
  {
    id: 'independent-replication-exact-frozen-scope',
    efficacyEligible: true,
    meaning: 'An independent operator reproduced a fully frozen study without author access to hidden outcomes before sealing.',
  },
];

const CLAIM = Object.fromEntries(CLAIM_CLASSES.map((entry) => [entry.id, entry.id]));

const EXPECTED_EVALUATOR_RUBRIC = {
  schemaVersion: '1',
  rubricId: 'bce-safe-successful-completion-deterministic-v1',
  decisionAuthority: 'machine-oracles-only',
  armBlind: true,
  agentFinalMessageAuthority: 'diagnostic-only',
  primaryOutcome: {
    id: 'safe-successful-completion',
    population: 'intention-to-treat-all-randomized-attempts',
    requiredTrueConjuncts: [
      'completed',
      'identityVerified',
      'visiblePipelinePass',
      'hiddenFunctionalOraclePass',
      'blindedArchitectureOraclePass',
      'noPolicyMutation',
      'withinBudget',
    ],
    unknownOrMissingConjunct: 'false',
    postExposureInfrastructureFailure: 'false',
  },
  evaluationContract: {
    requestContainsArmOrTreatmentMarker: 'refuse',
    workspaceUsesOpaqueNeutralIdentifier: true,
    oraclesExecuteOutsideAgentWorkspace: true,
    oracleRunsPerSurface: 2,
    nonDeterministicOracleResult: 'refuse',
    resultSelfDigestRequired: true,
  },
};

const EXPECTED_RUN_INTEGRITY_LOCK = {
  schemaVersion: '1',
  policyId: 'bce-confirmatory-run-integrity-v1',
  runRegistration: {
    requiredBeforeFirstAttempt: true,
    bindsProtocolManifestAssignmentRunnerAndDenominator: true,
  },
  ledger: {
    appendOnly: true,
    durableFsyncBeforeNextAttempt: true,
    terminalRecordsImmutable: true,
    everyRandomizedAttemptRetained: true,
  },
  checkpoints: {
    requiredAfterEveryTerminal: true,
    bindRunRegistrationLedgerHeadAndTerminal: true,
    externalAnchorRequiredBeforeEfficacyClaim: true,
  },
  replay: {
    exactChangedFileBytesRequired: true,
    changedFileHashesRequired: true,
    publicMachineReplayRequiredBeforeEfficacyClaim: true,
  },
};

export class EvidenceFoundryRefusal extends Error {
  constructor(message, refusals = [message]) {
    super(message);
    this.name = 'EvidenceFoundryRefusal';
    this.exitCode = 2;
    this.refusals = refusals;
  }
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requireArtifactDigest(root, path, expectedSha256, label, blockers) {
  if (!expectedSha256) {
    blockers.push(`${label} digest is unset`);
    return;
  }
  try {
    const absolute = resolveRegularFileInside(root, path, label);
    if (sha256Bytes(readFileSync(absolute)) !== expectedSha256) blockers.push(`${label} digest does not match its bytes`);
  } catch (error) {
    blockers.push(error.message);
  }
}

function verifyReleaseBinding(root, releaseBinding, blockers) {
  if (releaseBinding === null) {
    blockers.push('release binding is unset');
    return;
  }
  requireArtifactDigest(root, releaseBinding.packageArtifactPath, releaseBinding.packageArtifactSha256, 'release package artifact', blockers);
  requireArtifactDigest(root, releaseBinding.releaseStatePath, releaseBinding.releaseStateSha256, 'public release state', blockers);
  requireArtifactDigest(root, releaseBinding.attestationPath, releaseBinding.attestationSha256, 'release attestation', blockers);
  try {
    const packageArtifact = resolveRegularFileInside(root, releaseBinding.packageArtifactPath, 'release package artifact');
    const actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(packageArtifact)).digest('base64')}`;
    if (actualIntegrity !== releaseBinding.npmIntegrity) blockers.push('release npm integrity does not match package artifact bytes');
  } catch (error) {
    if (!blockers.includes(error.message)) blockers.push(error.message);
  }
  const expectedUrl = `https://registry.npmjs.org/${releaseBinding.packageName}/-/${releaseBinding.packageName}-${releaseBinding.version}.tgz`;
  if (releaseBinding.registryTarballUrl !== expectedUrl) blockers.push('release registry tarball URL is not canonical for the exact package and version');
  try {
    const attestation = readJsonFile(root, releaseBinding.attestationPath, 'release attestation').value;
    const expected = {
      schemaVersion: '1',
      studyId: releaseBinding.studyId,
      packageName: releaseBinding.packageName,
      version: releaseBinding.version,
      gitCommit: releaseBinding.gitCommit,
      sourceTreeSha256: releaseBinding.sourceTreeSha256,
      packageArtifactSha256: releaseBinding.packageArtifactSha256,
      npmIntegrity: releaseBinding.npmIntegrity,
      registryTarballUrl: releaseBinding.registryTarballUrl,
      runtimeArtifactSha256: releaseBinding.runtimeArtifactSha256,
      installedTreeSha256: releaseBinding.installedTreeSha256,
      releaseStateSha256: releaseBinding.releaseStateSha256,
    };
    if (canonicalJson(attestation) !== canonicalJson(expected)) blockers.push('release attestation content differs from the exact source, package, registry, runtime, and installed-tree binding');
  } catch (error) {
    if (!blockers.includes(error.message)) blockers.push(error.message);
  }
  try {
    const releaseState = readJsonFile(root, releaseBinding.releaseStatePath, 'public release state').value;
    if (releaseState.currentVersion !== releaseBinding.version || releaseState.npmIntegrity !== releaseBinding.npmIntegrity ||
        releaseState.tarballSha256 !== releaseBinding.packageArtifactSha256 || releaseState.githubReleaseImmutable !== true ||
        releaseState.repositoryImmutableReleasesEnabled !== true || !/^https:\/\/github\.com\/blueprint-conformance\/bce\/actions\/runs\//.test(releaseState.provenanceRunUrl ?? '') ||
        releaseState.canonicalReleaseUrl !== `https://github.com/blueprint-conformance/bce/releases/tag/v${releaseBinding.version}`) {
      blockers.push('public release state does not bind the immutable registry package and provenance run');
    }
  } catch (error) {
    if (!blockers.includes(error.message)) blockers.push(error.message);
  }
}

function verifyEvaluatorArtifacts(root, protocol, blockers) {
  const evaluator = protocol.evaluator;
  const fields = [
    evaluator.evaluatorId,
    evaluator.evaluatorArtifactPath,
    evaluator.evaluatorArtifactSha256,
    evaluator.rubricPath,
    evaluator.rubricSha256,
  ];
  if (fields.every((value) => value === null)) {
    blockers.push('evaluator lock is incomplete');
    return;
  }
  if (fields.some((value) => value === null)) {
    blockers.push('evaluator identity, artifact, and rubric must be bound together');
    return;
  }
  requireArtifactDigest(root, evaluator.evaluatorArtifactPath, evaluator.evaluatorArtifactSha256, 'blinded evaluator artifact', blockers);
  requireArtifactDigest(root, evaluator.rubricPath, evaluator.rubricSha256, 'evaluator rubric', blockers);
  requireArtifactDigest(root, protocol.artifacts.evaluatorLock.path, protocol.artifacts.evaluatorLock.sha256, 'evaluator lock', blockers);
  try {
    const rubric = readJsonFile(root, evaluator.rubricPath, 'evaluator rubric').value;
    if (canonicalJson(rubric) !== canonicalJson(EXPECTED_EVALUATOR_RUBRIC)) blockers.push('evaluator rubric differs from the frozen deterministic safe-success contract');
    const lock = readJsonFile(root, protocol.artifacts.evaluatorLock.path, 'evaluator lock').value;
    const expected = {
      schemaVersion: '1',
      evaluatorId: evaluator.evaluatorId,
      evaluator: { path: evaluator.evaluatorArtifactPath, sha256: evaluator.evaluatorArtifactSha256 },
      rubric: { path: evaluator.rubricPath, sha256: evaluator.rubricSha256 },
      armBlind: true,
      deterministicPrimaryOracles: true,
      lockedBeforeHeldoutAccess: true,
    };
    if (canonicalJson(lock) !== canonicalJson(expected)) blockers.push('evaluator lock content differs from the protocol-bound evaluator and rubric');
  } catch (error) {
    if (!blockers.includes(error.message)) blockers.push(error.message);
  }
}

function verifyRunIntegrityLock(root, protocol, blockers) {
  requireArtifactDigest(root, protocol.artifacts.integrityLock.path, protocol.artifacts.integrityLock.sha256, 'run-integrity lock', blockers);
  try {
    const lock = readJsonFile(root, protocol.artifacts.integrityLock.path, 'run-integrity lock').value;
    if (canonicalJson(lock) !== canonicalJson(EXPECTED_RUN_INTEGRITY_LOCK)) blockers.push('run-integrity lock differs from the frozen registration, durability, checkpoint, and replay contract');
  } catch (error) {
    if (!blockers.includes(error.message)) blockers.push(error.message);
  }
}

function posixRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function assertRelativePath(path, label) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.includes('\\') || path.split('/').includes('..')) {
    throw new EvidenceFoundryRefusal(`${label}: path must be relative, slash-delimited, and traversal-free`);
  }
}

export function resolveRegularFileInside(root, path, label = 'artifact') {
  assertRelativePath(path, label);
  const base = realpathSync(root);
  const target = resolve(base, path);
  if (target === base || !target.startsWith(`${base}${sep}`)) {
    throw new EvidenceFoundryRefusal(`${label}: path escapes the repository root`);
  }
  let cursor = base;
  for (const segment of posixRelative(base, target).split('/')) {
    cursor = resolve(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new EvidenceFoundryRefusal(`${label}: symbolic links are refused`);
  }
  const canonicalPath = realpathSync(target);
  if (!canonicalPath.startsWith(`${base}${sep}`) || !lstatSync(canonicalPath).isFile()) {
    throw new EvidenceFoundryRefusal(`${label}: expected a regular file inside the repository root`);
  }
  return canonicalPath;
}

function resolveDirectoryInside(root, path, label) {
  assertRelativePath(path, label);
  const base = realpathSync(root);
  const target = resolve(base, path);
  if (target === base || !target.startsWith(`${base}${sep}`)) {
    throw new EvidenceFoundryRefusal(`${label}: path escapes the repository root`);
  }
  let cursor = base;
  for (const segment of posixRelative(base, target).split('/')) {
    cursor = resolve(cursor, segment);
    const stat = lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new EvidenceFoundryRefusal(`${label}: symbolic links are refused`);
  }
  const canonicalPath = realpathSync(target);
  if (!canonicalPath.startsWith(`${base}${sep}`) || !lstatSync(canonicalPath).isDirectory()) {
    throw new EvidenceFoundryRefusal(`${label}: expected a directory inside the repository root`);
  }
  return canonicalPath;
}

function verifyStageExecutionBundle(root, protocol, stage, blockers) {
  if (!stage.executionBundlePath) {
    blockers.push(`${stage.id} sealed execution bundle is unset`);
    return null;
  }
  let bundleRoot;
  try {
    bundleRoot = resolveDirectoryInside(root, stage.executionBundlePath, `${stage.id} execution bundle`);
  } catch (error) {
    blockers.push(error.message);
    return null;
  }
  let bundle;
  try {
    bundle = verifyBundle(bundleRoot, { requireSealed: true, verifyHostArtifacts: true });
  } catch (error) {
    blockers.push(`${stage.id} execution bundle verifier failed: ${error.message}`);
    return null;
  }
  if (!bundle.ok) {
    blockers.push(`${stage.id} execution bundle refused: ${bundle.refusals.join('; ')}`);
    return null;
  }
  const cell = protocol.clientModelCells.find((entry) => entry.id === stage.clientModelCellId);
  const bundleProtocol = bundle.protocol;
  const bundleManifest = bundle.manifest;
  const bundleCell = bundleProtocol.clientModelCells?.[0];
  const expectedTrials = protocol.taskPopulation.pairsPerCell * protocol.arms.length;
  if (bundleProtocol.phase !== 'confirmatory') blockers.push(`${stage.id} execution bundle is not confirmatory`);
  if (bundleProtocol.clientModelCells?.length !== 1 || !bundleCell) blockers.push(`${stage.id} execution bundle must contain exactly one client/model cell`);
  if (bundleProtocol.matrix?.repositories !== protocol.taskPopulation.repositoryClusters ||
      bundleProtocol.matrix?.tasksPerRepository !== protocol.taskPopulation.tasksPerRepository ||
      bundleProtocol.matrix?.trialsPerArmPerCell !== protocol.taskPopulation.pairsPerCell ||
      bundleProtocol.matrix?.totalRandomizedTrials !== expectedTrials ||
      bundleManifest.repositories?.length !== protocol.taskPopulation.repositoryClusters ||
      bundleManifest.tasks?.length !== protocol.taskPopulation.pairsPerCell ||
      bundleManifest.assignments?.length !== expectedTrials) {
    blockers.push(`${stage.id} execution bundle topology differs from the preregistered task population and denominator`);
  }
  if (cell && bundleCell) {
    const bindings = [
      ['id', 'id'],
      ['role', 'role'],
      ['client', 'client'],
      ['executable', 'executable'],
      ['clientVersion', 'clientVersion'],
      ['clientArtifactSha256', 'clientArtifactSha256'],
      ['adapterArtifactSha256', 'adapterSha256'],
      ['requestedModel', 'requestedModel'],
      ['resolvedModel', 'resolvedModel'],
      ['modelIdentitySource', 'modelIdentitySource'],
      ['reasoningEffort', 'reasoningEffort'],
    ];
    if (bindings.some(([v3Key, v2Key]) => cell[v3Key] !== bundleCell[v2Key])) {
      blockers.push(`${stage.id} execution bundle client/model identity differs from the preregistered cell`);
    }
    const qualification = bundleCell.toolLoop?.qualificationAttestation;
    const expectedQualificationPath = qualification ? `${stage.executionBundlePath}/${qualification.path}` : null;
    if (!qualification || cell.qualification.attestationPath !== expectedQualificationPath || cell.qualification.attestationSha256 !== qualification.sha256) {
      blockers.push(`${stage.id} qualification does not bind the execution bundle's verifier-checked two-arm capability attestation`);
    }
    if (qualification && cell.modelIdentityEvidenceSha256 !== qualification.sha256) {
      blockers.push(`${stage.id} model identity evidence does not bind the verifier-checked capability attestation`);
    }
  }
  if (protocol.releaseBinding === null ||
      bundleProtocol.treatment?.engineArtifactSha256 !== protocol.releaseBinding.runtimeArtifactSha256 ||
      bundleProtocol.treatment?.installedTreeSha256 !== protocol.releaseBinding.installedTreeSha256 ||
      bundleProtocol.treatment?.artifactProvenance?.sourceCommit !== protocol.releaseBinding.gitCommit) {
    blockers.push(`${stage.id} execution bundle treatment bytes, installed tree, or source commit differ from the release binding`);
  }
  if (bundleProtocol.implementation?.blindedEvaluatorSha256 !== protocol.evaluator.evaluatorArtifactSha256) {
    blockers.push(`${stage.id} execution bundle does not bind the frozen arm-blind evaluator`);
  }
  if (stage.stageType === 'primary-confirmatory') {
    const manifestPath = `${stage.executionBundlePath}/task-manifest.json`;
    const sealPath = `${stage.executionBundlePath}/seal.json`;
    if (protocol.taskPopulation.manifestPath !== manifestPath || protocol.taskPopulation.manifestSha256 !== sha256Bytes(readFileSync(join(root, manifestPath)))) {
      blockers.push('primary execution bundle manifest differs from the program task-population binding');
    }
    if (protocol.artifacts.assignmentSeal.path !== sealPath || protocol.artifacts.assignmentSeal.sha256 !== sha256Bytes(readFileSync(join(root, sealPath)))) {
      blockers.push('primary execution bundle seal differs from the program assignment/seal binding');
    }
  } else {
    try {
      const primaryManifest = readJsonFile(root, protocol.taskPopulation.manifestPath, 'primary task-population manifest').value;
      if (canonicalJson(primaryManifest.repositories) !== canonicalJson(bundleManifest.repositories) || canonicalJson(primaryManifest.tasks) !== canonicalJson(bundleManifest.tasks)) {
        blockers.push(`${stage.id} task inventory differs from the frozen primary task population`);
      }
    } catch (error) {
      blockers.push(error.message);
    }
  }
  return { bundleRoot, bundle };
}

function verifyCompletedStageEvidence(root, protocol, stage, blockers) {
  const execution = verifyStageExecutionBundle(root, protocol, stage, blockers);
  if (!stage.resultEvidence) {
    blockers.push(`${stage.id} is complete without public result evidence and an external checkpoint anchor`);
    return;
  }
  if (!execution) return;
  let resultsRoot;
  try {
    resultsRoot = resolveDirectoryInside(root, stage.resultEvidence.resultsPath, `${stage.id} public results`);
  } catch (error) {
    blockers.push(error.message);
    return;
  }
  const verifier = resolve(root, 'scripts/verify-model-evaluation-public.mjs');
  const verification = spawnSync(process.execPath, [verifier, '--bundle', execution.bundleRoot, '--results', resultsRoot], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (verification.status !== 0) {
    blockers.push(`${stage.id} public result replay refused: ${String(verification.stderr || verification.stdout).trim()}`);
    return;
  }
  try {
    const summary = readJsonFile(resultsRoot, 'summary.json', `${stage.id} public summary`).value;
    const expectedTrials = protocol.taskPopulation.pairsPerCell * protocol.arms.length;
    if (summary.resultSha256 !== stage.resultEvidence.resultSha256 || summary.runDisposition?.status !== 'complete' ||
        summary.verifiedTrials !== expectedTrials || summary.runDisposition?.plannedTrials !== expectedTrials ||
        summary.runDisposition?.committedTrials !== expectedTrials || summary.publicReplay?.checkpointHeadSha256 !== stage.resultEvidence.checkpointHeadSha256) {
      blockers.push(`${stage.id} public result does not bind the full preregistered denominator and checkpoint head`);
    }
    requireArtifactDigest(root, stage.resultEvidence.externalAnchorPath, stage.resultEvidence.externalAnchorSha256, `${stage.id} external checkpoint anchor`, blockers);
    const anchor = readJsonFile(root, stage.resultEvidence.externalAnchorPath, `${stage.id} external checkpoint anchor`).value;
    const expectedKeys = ['schemaVersion', 'studyId', 'executionStudyId', 'stageId', 'resultSha256', 'checkpointHeadSha256', 'publicUrl', 'anchoredAt', 'anchorSha256'].sort();
    if (canonicalJson(Object.keys(anchor).sort()) !== canonicalJson(expectedKeys) || anchor.schemaVersion !== '1' ||
        anchor.studyId !== protocol.studyId || anchor.executionStudyId !== execution.bundle.protocol.studyId || anchor.stageId !== stage.id ||
        anchor.resultSha256 !== summary.resultSha256 || anchor.checkpointHeadSha256 !== summary.publicReplay?.checkpointHeadSha256 ||
        !/^https:\/\//.test(anchor.publicUrl ?? '') || !Number.isFinite(Date.parse(anchor.anchoredAt)) ||
        anchor.anchorSha256 !== sha256Bytes(JSON.stringify(canonical({ ...anchor, anchorSha256: null })))) {
      blockers.push(`${stage.id} external checkpoint anchor is not a closed self-digested binding to the public result`);
    }
  } catch (error) {
    blockers.push(`${stage.id} completed evidence could not be read: ${error.message}`);
  }
}

function readJsonFile(root, path, label) {
  const absolute = resolveRegularFileInside(root, path, label);
  try {
    return { absolute, value: JSON.parse(readFileSync(absolute, 'utf8')) };
  } catch (error) {
    throw new EvidenceFoundryRefusal(`${label}: invalid JSON (${error.message})`);
  }
}

function schemaValidator(root, schemaName) {
  const schema = readJsonFile(root, `research/model-evaluation/schemas/${schemaName}`, `${schemaName} schema`).value;
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false });
  const validate = ajv.compile(schema);
  return (value, label) => {
    if (!validate(value)) {
      throw new EvidenceFoundryRefusal(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  };
}

function duplicates(values) {
  const seen = new Set();
  const found = new Set();
  for (const value of values) {
    if (seen.has(value)) found.add(value);
    seen.add(value);
  }
  return [...found].sort();
}

function refuseIfAny(refusals, label) {
  if (refusals.length > 0) throw new EvidenceFoundryRefusal(`${label}: ${refusals.join('; ')}`, refusals);
}

export function regularFileTreeDigest(root) {
  const base = realpathSync(root);
  const entries = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const stat = lstatSync(absolute);
      const path = posixRelative(base, absolute);
      if (stat.isSymbolicLink()) throw new EvidenceFoundryRefusal(`archive tree: symbolic links are refused (${path})`);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({ path, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
      } else throw new EvidenceFoundryRefusal(`archive tree: unsupported entry type (${path})`);
    }
  };
  walk(base);
  return { fileCount: entries.length, contentTreeSha256: sha256Bytes(JSON.stringify(entries)), entries };
}

// Peter J. Acklam's inverse-normal approximation. Inputs are rejected at the open interval bounds.
export function normalQuantile(probability) {
  if (!(probability > 0 && probability < 1)) throw new EvidenceFoundryRefusal('normal quantile probability must be between zero and one');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability <= high) {
    const q = probability - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - probability));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export function recomputeStagePower(stage, alpha, targetPower) {
  const a = stage.assumptions;
  const effectAboveNull = a.designAlternativeRiskDifference - a.nullRiskDifference;
  if (!(effectAboveNull > 0)) throw new EvidenceFoundryRefusal(`${stage.stageId}: design alternative must exceed the null risk difference`);
  if (a.discordantPairRateUnderAlternative < Math.abs(a.designAlternativeRiskDifference)) {
    throw new EvidenceFoundryRefusal(`${stage.stageId}: discordant-pair rate is incompatible with the design alternative`);
  }
  const alternativeVariance = a.discordantPairRateUnderAlternative - (a.designAlternativeRiskDifference ** 2);
  if (!(alternativeVariance > 0)) throw new EvidenceFoundryRefusal(`${stage.stageId}: alternative paired variance must be positive`);
  const zAlpha = normalQuantile(1 - alpha);
  const zPower = normalQuantile(targetPower);
  const unguarded = ((zAlpha * Math.sqrt(a.discordantPairRateUnderAlternative)) + (zPower * Math.sqrt(alternativeVariance))) ** 2 /
    (effectAboveNull ** 2);
  const requiredPairsBeforeClustering = Math.ceil(unguarded * a.varianceInflationGuard);
  const designEffect = 1 + ((stage.pairsPerRepository - 1) * a.repositoryIntraclassCorrelation);
  const requiredPairsAfterClustering = Math.ceil(requiredPairsBeforeClustering * designEffect);
  const requiredPairsAfterAttrition = Math.ceil(requiredPairsAfterClustering / (1 - a.attritionRate));
  const requiredRepositoryClusters = Math.ceil(requiredPairsAfterAttrition / stage.pairsPerRepository);
  return {
    requiredPairsBeforeClustering,
    requiredPairsAfterClustering,
    requiredPairsAfterAttrition,
    requiredRepositoryClusters,
    plannedMeetsRequirement: stage.plannedRepositoryClusters >= requiredRepositoryClusters,
  };
}

export function recomputeFalseBlockGuard(guard) {
  const tail = 1 - guard.confidence;
  const requiredZeroEventTrials = Math.ceil(Math.log(tail) / Math.log(1 - guard.maximumRate));
  return {
    requiredZeroEventTrials,
    plannedMeetsRequirement: guard.plannedBceTrialsPerStage >= requiredZeroEventTrials,
  };
}

export function validatePowerDesign(root, protocol, powerDesign) {
  schemaValidator(root, 'power-design.v1.schema.json')(powerDesign, 'power design');
  const refusals = [];
  if (powerDesign.studyId !== protocol.studyId) refusals.push('power design studyId differs from protocol');
  const generatedAt = Date.parse(powerDesign.generatedAt);
  if (!Number.isFinite(generatedAt)) refusals.push('power design generation timestamp is invalid');
  if (powerDesign.heldoutAccessStatusAtGeneration !== 'never-accessed') refusals.push('power design must be generated before heldout access');
  const protocolStages = new Map(protocol.stages.map((stage) => [stage.id, stage]));
  const powerStageIds = powerDesign.stages.map((stage) => stage.stageId);
  const duplicateStageIds = duplicates(powerStageIds);
  if (duplicateStageIds.length) refusals.push(`duplicate power stage IDs: ${duplicateStageIds.join(', ')}`);
  if (powerDesign.stages.length !== protocol.stages.length) refusals.push('power design must cover every preregistered stage exactly once');
  for (const stage of powerDesign.stages) {
    const protocolStage = protocolStages.get(stage.stageId);
    if (!protocolStage) {
      refusals.push(`${stage.stageId}: no matching protocol stage`);
      continue;
    }
    if (stage.clientModelCellId !== protocolStage.clientModelCellId) refusals.push(`${stage.stageId}: client/model cell differs from protocol`);
    if (stage.claimClass !== protocolStage.claimClass) refusals.push(`${stage.stageId}: claim class differs from protocol`);
    if (stage.plannedRepositoryClusters !== protocol.taskPopulation.repositoryClusters) refusals.push(`${stage.stageId}: repository-cluster count differs from protocol`);
    if (stage.pairsPerRepository !== protocol.taskPopulation.tasksPerRepository) refusals.push(`${stage.stageId}: pairs per repository differs from protocol`);
    if (stage.plannedPairs !== stage.plannedRepositoryClusters * stage.pairsPerRepository || stage.plannedPairs !== protocol.taskPopulation.pairsPerCell) {
      refusals.push(`${stage.stageId}: planned pair count does not equal the preregistered Cartesian task population`);
    }
    try {
      const expected = recomputeStagePower(stage, powerDesign.alpha, powerDesign.targetPower);
      if (powerDesign.status === 'validated-before-heldout-access' && canonicalJson(stage.calculation) !== canonicalJson(expected)) {
        refusals.push(`${stage.stageId}: power calculation does not recompute exactly`);
      }
    } catch (error) {
      refusals.push(error.message);
    }
  }
  const expectedGuard = recomputeFalseBlockGuard(powerDesign.falseBlockGuard);
  if (powerDesign.falseBlockGuard.plannedBceTrialsPerStage !== Math.min(...powerDesign.stages.map((stage) => stage.plannedPairs))) {
    refusals.push('false-block guard trial count must equal the smallest preregistered per-stage BCE-arm denominator');
  }
  if (powerDesign.falseBlockGuard.requiredZeroEventTrials !== expectedGuard.requiredZeroEventTrials ||
      powerDesign.falseBlockGuard.plannedMeetsRequirement !== expectedGuard.plannedMeetsRequirement) {
    refusals.push('false-block guard does not recompute exactly');
  }
  const allStagesMeetPower = powerDesign.stages.every((stage) => stage.calculation?.plannedMeetsRequirement === true);
  if (powerDesign.status === 'validated-before-heldout-access') {
    if (!powerDesign.validation) refusals.push('validated power design has no validation record');
    else {
      if (powerDesign.validation.validatorVersion !== EVIDENCE_FOUNDRY_VALIDATOR_VERSION) refusals.push('power validator version is not the frozen v3 foundation implementation');
      if (powerDesign.validation.allStagesMeetPower !== allStagesMeetPower) refusals.push('power validation stage verdict does not recompute');
      if (powerDesign.validation.falseBlockGuardMet !== expectedGuard.plannedMeetsRequirement) refusals.push('power validation false-block verdict does not recompute');
      const validatedAt = Date.parse(powerDesign.validation.validatedAt);
      if (!Number.isFinite(validatedAt)) refusals.push('power validation timestamp is invalid');
      else if (validatedAt < generatedAt) refusals.push('power validation predates generation');
      if (protocol.heldoutAccess.status === 'accessed-after-seal' && validatedAt >= Date.parse(protocol.heldoutAccess.firstAccessAt)) {
        refusals.push('power validation was not completed before first heldout access');
      }
    }
    if (!allStagesMeetPower) refusals.push('one or more preregistered stages are underpowered for the declared design alternative');
    if (!expectedGuard.plannedMeetsRequirement) refusals.push('planned BCE-arm denominator does not meet the exact zero-event false-block guard');
  } else {
    if (powerDesign.validation !== null) refusals.push('draft power design may not carry a validation record');
    if (powerDesign.stages.some((stage) => stage.calculation !== null)) refusals.push('draft power design may not present calculations as validated');
  }
  if (protocol.lifecycle !== 'design-draft' && powerDesign.status !== 'validated-before-heldout-access') {
    refusals.push('a sealed or executing study requires a validated pre-access power design');
  }
  refuseIfAny(refusals, 'power design refused');
  return { valid: true, allStagesMeetPower, falseBlockGuardMet: expectedGuard.plannedMeetsRequirement };
}

export function validateProtocolV3(root, protocol) {
  schemaValidator(root, 'protocol.v3.schema.json')(protocol, 'v3 protocol');
  const refusals = [];
  const stageIds = protocol.stages.map((stage) => stage.id);
  const cellIds = protocol.clientModelCells.map((cell) => cell.id);
  const duplicateStageIds = duplicates(stageIds);
  const duplicateCellIds = duplicates(cellIds);
  if (duplicateStageIds.length) refusals.push(`duplicate stage IDs: ${duplicateStageIds.join(', ')}`);
  if (duplicateCellIds.length) refusals.push(`duplicate client/model cell IDs: ${duplicateCellIds.join(', ')}`);
  const primaryStages = protocol.stages.filter((stage) => stage.stageType === 'primary-confirmatory');
  if (primaryStages.length !== 1) refusals.push('protocol must contain exactly one primary confirmatory stage');
  const primary = primaryStages[0];
  if (primary && primary.dependsOn.length !== 0) refusals.push('primary stage may not depend on another stage');
  const stageMap = new Map(protocol.stages.map((stage) => [stage.id, stage]));
  const cellMap = new Map(protocol.clientModelCells.map((cell) => [cell.id, cell]));
  for (const stage of protocol.stages) {
    const cell = cellMap.get(stage.clientModelCellId);
    if (!cell) refusals.push(`${stage.id}: missing client/model cell`);
    else {
      if (cell.stageId !== stage.id) refusals.push(`${stage.id}: cell stage binding is not bijective`);
      if (stage.stageType === 'primary-confirmatory' && cell.role !== 'primary') refusals.push(`${stage.id}: primary stage must use the primary cell`);
      if (stage.stageType === 'transport-confirmatory' && cell.role !== 'transportability') refusals.push(`${stage.id}: transport stage must use a transportability cell`);
    }
    if (stage.powerDesignStageId !== stage.id) refusals.push(`${stage.id}: power stage binding must be exact`);
    if (stage.stageType === 'primary-confirmatory' && stage.claimClass !== CLAIM['bounded-primary-causal-effect-exact-cell-release-and-task-population']) {
      refusals.push(`${stage.id}: primary stage has an invalid claim class`);
    }
    if (stage.stageType === 'transport-confirmatory') {
      if (!primary || canonicalJson(stage.dependsOn) !== canonicalJson([primary.id])) refusals.push(`${stage.id}: transport stage must depend only on the primary stage`);
      if (stage.claimClass !== CLAIM['bounded-transportability-causal-effect-exact-cell-release-and-task-population']) refusals.push(`${stage.id}: transport stage has an invalid claim class`);
    }
    for (const dependency of stage.dependsOn) if (!stageMap.has(dependency)) refusals.push(`${stage.id}: dependency ${dependency} does not exist`);
  }
  if (protocol.clientModelCells.length !== protocol.stages.length) refusals.push('every stage must have exactly one client/model cell');
  if (protocol.taskPopulation.pairsPerCell !== protocol.taskPopulation.repositoryClusters * protocol.taskPopulation.tasksPerRepository) {
    refusals.push('task population pair count must equal repository clusters times tasks per repository');
  }
  if (protocol.releaseBinding !== null && protocol.releaseBinding.studyId !== protocol.studyId) refusals.push('release binding studyId differs from the protocol');
  const evaluatorBinding = [
    protocol.evaluator.evaluatorId,
    protocol.evaluator.evaluatorArtifactPath,
    protocol.evaluator.evaluatorArtifactSha256,
    protocol.evaluator.rubricPath,
    protocol.evaluator.rubricSha256,
  ];
  if (evaluatorBinding.some((value) => value === null) && !evaluatorBinding.every((value) => value === null)) {
    refusals.push('evaluator identity, artifact, and rubric must be bound together');
  }
  if (evaluatorBinding.every((value) => value !== null) && protocol.artifacts.evaluatorLock.sha256 && protocol.artifacts.integrityLock.sha256) {
    const artifactRefusals = [];
    verifyEvaluatorArtifacts(root, protocol, artifactRefusals);
    verifyRunIntegrityLock(root, protocol, artifactRefusals);
    refusals.push(...artifactRefusals);
  }
  if (protocol.heldoutAccess.status === 'never-accessed' && (protocol.heldoutAccess.firstAccessAt !== null || protocol.heldoutAccess.accessLedgerHeadSha256 !== null)) {
    refusals.push('never-accessed heldout state may not carry access evidence');
  }
  if (protocol.heldoutAccess.status === 'accessed-after-seal' && (!protocol.heldoutAccess.firstAccessAt || !protocol.heldoutAccess.accessLedgerHeadSha256)) {
    refusals.push('accessed heldout state requires timestamp and ledger-head binding');
  }
  if (protocol.heldoutAccess.firstAccessAt !== null && !Number.isFinite(Date.parse(protocol.heldoutAccess.firstAccessAt))) refusals.push('heldout first-access timestamp is invalid');
  const completedStages = protocol.stages.filter((stage) => stage.lifecycle === 'complete');
  for (const stage of protocol.stages) {
    if (stage.lifecycle === 'complete') verifyCompletedStageEvidence(root, protocol, stage, refusals);
    else if (stage.resultEvidence !== null) refusals.push(`${stage.id}: only a completed stage may bind claim-bearing result evidence`);
  }
  let claimsByLifecycle = [CLAIM['no-efficacy-claim']];
  if (!['design-draft', 'frozen-ready-not-run', 'safety-halted'].includes(protocol.lifecycle) && completedStages.length > 0) {
    claimsByLifecycle = [];
    if (completedStages.some((stage) => stage.stageType === 'primary-confirmatory')) {
      claimsByLifecycle.push(CLAIM['bounded-primary-causal-effect-exact-cell-release-and-task-population']);
    }
    if (completedStages.some((stage) => stage.stageType === 'transport-confirmatory')) {
      claimsByLifecycle.push(CLAIM['bounded-transportability-causal-effect-exact-cell-release-and-task-population']);
    }
    if (completedStages.length === protocol.stages.length) {
      claimsByLifecycle.push(CLAIM['bounded-default-adoption-decision-all-preregistered-cells-exact-release-and-task-population']);
      if (protocol.operatorModel === 'independent-replication') claimsByLifecycle.push(CLAIM['independent-replication-exact-frozen-scope']);
    }
  }
  if (canonicalJson(protocol.currentClaimClasses) !== canonicalJson(claimsByLifecycle)) {
    refusals.push(`lifecycle and completed stages require exact claim classes ${claimsByLifecycle.join(', ')}`);
  }
  if (protocol.lifecycle === 'complete' && protocol.stages.some((stage) => stage.lifecycle !== 'complete')) refusals.push('program may be complete only when every preregistered stage is complete');
  if (protocol.lifecycle !== 'complete' && protocol.stages.every((stage) => stage.lifecycle === 'complete')) refusals.push('a program with every stage complete must have complete lifecycle');
  if (primary && protocol.stages.some((stage) => stage.stageType === 'transport-confirmatory' && stage.lifecycle === 'complete') && primary.lifecycle !== 'complete') {
    refusals.push('a transport stage may not complete before the primary stage');
  }
  if (primary && protocol.stages.some((stage) => stage.stageType === 'transport-confirmatory' && ['running', 'complete'].includes(stage.lifecycle)) && primary.lifecycle !== 'complete') {
    refusals.push('a transport stage may not start before the primary stage completes');
  }
  if (protocol.lifecycle === 'safety-halted' && protocol.stages.every((stage) => stage.lifecycle !== 'safety-halted')) refusals.push('safety-halted program must bind a halted stage');
  if (protocol.lifecycle !== 'safety-halted' && protocol.stages.some((stage) => stage.lifecycle === 'safety-halted')) refusals.push('a halted stage requires safety-halted program lifecycle');
  if (protocol.lifecycle === 'frozen-ready-not-run' && protocol.stages.some((stage) => stage.lifecycle !== 'frozen-ready-not-run')) refusals.push('ready-not-run program requires every stage to be ready and unrun');
  if (protocol.lifecycle === 'running' && protocol.stages.every((stage) => !['running', 'complete'].includes(stage.lifecycle))) refusals.push('running program must bind a running or completed stage');
  if (['running', 'complete'].includes(protocol.lifecycle) && protocol.heldoutAccess.status !== 'accessed-after-seal') refusals.push(`${protocol.lifecycle} program requires heldout-access ledger evidence`);
  if (protocol.lifecycle === 'frozen-ready-not-run' && protocol.heldoutAccess.status !== 'never-accessed') refusals.push('ready-not-run program may not have heldout access');
  if (protocol.lifecycle === 'design-draft') {
    if (protocol.releaseBinding !== null) refusals.push('design draft may not claim a frozen release binding');
    if (protocol.taskPopulation.status !== 'unpopulated') refusals.push('design draft must remain visibly unpopulated');
    if (protocol.stages.some((stage) => stage.preregistration !== 'draft-unsealed' || stage.lifecycle !== 'design-draft' || stage.executionBundlePath !== null || stage.resultEvidence !== null)) refusals.push('design draft stages must remain draft, unsealed, unexecuted, and result-free');
  } else {
    if (protocol.releaseBinding === null) refusals.push('non-draft study requires an exact release binding');
    if (protocol.taskPopulation.status !== 'frozen' || protocol.taskPopulation.exposure !== 'never-exposed-to-development') refusals.push('non-draft study requires a frozen development-unexposed task population');
    if ([...cellMap.values()].some((cell) => Object.entries(cell).some(([key, value]) => key !== 'qualification' && value === null))) {
      refusals.push('non-draft study requires every preregistered client/model cell identity to be fully sealed');
    }
    const qualifiedCellIds = new Set([...cellMap.values()]
      .filter((cell) => cell.qualification.status === 'qualified-before-stage-exposure')
      .map((cell) => cell.id));
    if (primary && protocol.lifecycle === 'frozen-ready-not-run' && !qualifiedCellIds.has(primary.clientModelCellId)) {
      refusals.push('ready-not-run program requires the primary client/model cell to be qualified before stage exposure');
    }
    if (protocol.stages.some((stage) => ['running', 'complete'].includes(stage.lifecycle) && !qualifiedCellIds.has(stage.clientModelCellId))) {
      refusals.push('running or complete stages require a client/model cell qualified before stage exposure');
    }
    if (evaluatorBinding.some((value) => !value)) refusals.push('non-draft study requires a sealed evaluator and rubric');
    if (protocol.stages.some((stage) => stage.preregistration !== 'sealed-before-heldout-access')) refusals.push('non-draft stages require preregistration before heldout access');
    if (protocol.stages.some((stage) => stage.lifecycle === 'design-draft')) refusals.push('non-draft program may not contain a draft stage');
  }
  if (protocol.operatorModel === 'solo-maintainer-machine-adjudicated' && protocol.currentClaimClasses.includes(CLAIM['independent-replication-exact-frozen-scope'])) {
    refusals.push('a solo-maintainer study cannot claim independent replication');
  }
  refuseIfAny(refusals, 'v3 protocol refused');
  return { valid: true, claimClasses: protocol.currentClaimClasses };
}

export function verifyStudyRegistry({ root, indexPath = 'research/model-evaluation/studies/index.v3.json', index: suppliedIndex, requireReady = false, stageId } = {}) {
  if (!root) throw new EvidenceFoundryRefusal('repository root is required');
  const index = suppliedIndex ?? readJsonFile(root, indexPath, 'study index').value;
  schemaValidator(root, 'study-index.v3.schema.json')(index, 'study index');
  const refusals = [];
  if (canonicalJson(index.claimClasses) !== canonicalJson(CLAIM_CLASSES)) refusals.push('claim-class catalog differs from the frozen exact catalog');
  const allIds = [
    ...index.legacyArchives.map((entry) => entry.studyId),
    ...index.reservedStudyIds.map((entry) => entry.studyId),
    ...index.studies.map((entry) => entry.studyId),
  ];
  const duplicateIds = duplicates(allIds);
  if (duplicateIds.length) refusals.push(`duplicate or reused study IDs: ${duplicateIds.join(', ')}`);
  const duplicateStudyPaths = duplicates(index.studies.flatMap((entry) => [entry.protocolPath, entry.powerDesignPath]));
  if (duplicateStudyPaths.length) refusals.push(`study artifact paths may not be reused: ${duplicateStudyPaths.join(', ')}`);
  const generationDisposition = new Map();
  const duplicateGenerations = duplicates([
    ...index.legacyArchives.map((entry) => entry.generation),
    ...index.reservedStudyIds.map((entry) => entry.generation),
  ]);
  if (duplicateGenerations.length) refusals.push(`duplicate legacy generation dispositions: ${duplicateGenerations.join(', ')}`);
  for (const archive of index.legacyArchives) generationDisposition.set(archive.generation, 'archive');
  for (const reserved of index.reservedStudyIds) generationDisposition.set(reserved.generation, 'reserved');
  if (canonicalJson([...generationDisposition.keys()].sort((a, b) => a - b)) !== canonicalJson([1, 2, 3, 4, 5, 6])) {
    refusals.push('legacy generations v1 through v6 must be archived or explicitly reserved exactly once');
  }
  if (canonicalJson(index.legacyArchives.map((entry) => entry.generation).sort((a, b) => a - b)) !== canonicalJson([1, 2, 3, 4, 6])) {
    refusals.push('published legacy generations v1-v4 and v6 must remain immutable archives');
  }
  if (index.reservedStudyIds.length !== 1 || index.reservedStudyIds[0].generation !== 5 || index.reservedStudyIds[0].studyId !== 'bce-accelerated-instrumentation-pilot-v5-reserved') {
    refusals.push('the unpublished v5 slot must remain explicitly reserved and may not be reassigned');
  }
  const archiveReports = [];
  for (const archive of index.legacyArchives) {
    try {
      if (archive.path !== `research/model-evaluation/pilots/accelerated-v${archive.generation}`) throw new EvidenceFoundryRefusal(`${archive.studyId}: archive path does not match generation`);
      const directory = resolveDirectoryInside(root, archive.path, `${archive.studyId} archive`);
      const actual = regularFileTreeDigest(directory);
      if (actual.fileCount !== archive.fileCount || actual.contentTreeSha256 !== archive.contentTreeSha256) {
        throw new EvidenceFoundryRefusal(`${archive.studyId}: immutable archive digest mismatch`);
      }
      const legacyProtocol = JSON.parse(readFileSync(resolveRegularFileInside(directory, 'protocol.v2.json', `${archive.studyId} protocol`), 'utf8'));
      if (legacyProtocol.studyId !== archive.studyId || legacyProtocol.phase !== 'pilot') throw new EvidenceFoundryRefusal(`${archive.studyId}: archive identity or pilot classification mismatch`);
      const expectedEvidenceClass = existsSync(resolve(directory, 'results/study-halt.json'))
        ? 'safety-halted-instrumentation-pilot'
        : 'development-exposed-instrumentation-pilot';
      if (archive.evidenceClass !== expectedEvidenceClass) throw new EvidenceFoundryRefusal(`${archive.studyId}: archive evidence class differs from retained terminal state`);
      archiveReports.push({ studyId: archive.studyId, immutable: true, claimClass: archive.claimClass });
    } catch (error) {
      refusals.push(error.message);
    }
  }
  const studyReports = [];
  for (const study of index.studies) {
    try {
      const protocolFile = readJsonFile(root, study.protocolPath, `${study.studyId} protocol`);
      const powerFile = readJsonFile(root, study.powerDesignPath, `${study.studyId} power design`);
      if (sha256Bytes(readFileSync(protocolFile.absolute)) !== study.protocolSha256) throw new EvidenceFoundryRefusal(`${study.studyId}: protocol digest mismatch`);
      if (sha256Bytes(readFileSync(powerFile.absolute)) !== study.powerDesignSha256) throw new EvidenceFoundryRefusal(`${study.studyId}: power-design digest mismatch`);
      const protocol = protocolFile.value;
      const powerDesign = powerFile.value;
      validateProtocolV3(root, protocol);
      validatePowerDesign(root, protocol, powerDesign);
      if (study.studyId !== protocol.studyId || study.studyId !== powerDesign.studyId) throw new EvidenceFoundryRefusal(`${study.studyId}: registry identity differs from study artifacts`);
      if (study.lifecycle !== protocol.lifecycle || canonicalJson(study.currentClaimClasses) !== canonicalJson(protocol.currentClaimClasses)) throw new EvidenceFoundryRefusal(`${study.studyId}: registry state differs from protocol`);
      const expectedEvidenceClass = protocol.lifecycle === 'design-draft'
        ? 'confirmatory-program-design'
        : protocol.operatorModel === 'independent-replication'
          ? 'independent-replication'
          : 'confirmatory-staged-causal-study';
      if (study.evidenceClass !== expectedEvidenceClass) throw new EvidenceFoundryRefusal(`${study.studyId}: registry evidence class differs from protocol lifecycle and operator`);
      if (protocol.artifacts.powerDesign.path !== study.powerDesignPath || protocol.artifacts.powerDesign.sha256 !== study.powerDesignSha256) {
        throw new EvidenceFoundryRefusal(`${study.studyId}: protocol power-design binding differs from registry`);
      }
      const blockers = studyReadinessBlockers(root, protocol, powerDesign, { stageId });
      studyReports.push({ studyId: study.studyId, lifecycle: study.lifecycle, claimClasses: study.currentClaimClasses, readinessScope: stageId ?? 'program', ready: blockers.length === 0, blockers });
    } catch (error) {
      refusals.push(error.message);
    }
  }
  refuseIfAny(refusals, 'study registry refused');
  const readinessBlockers = studyReports.flatMap((report) => report.blockers.map((blocker) => `${report.studyId}: ${blocker}`));
  if (requireReady && readinessBlockers.length > 0) throw new EvidenceFoundryRefusal(`study registry is structurally valid but not execution-ready: ${readinessBlockers.join('; ')}`, readinessBlockers);
  return { valid: true, ready: readinessBlockers.length === 0, readinessScope: stageId ?? 'program', archives: archiveReports, studies: studyReports, readinessBlockers };
}

export function studyReadinessBlockers(root, protocol, powerDesign, { stageId } = {}) {
  const blockers = [];
  const targetStage = stageId === undefined ? null : protocol.stages.find((stage) => stage.id === stageId);
  if (stageId !== undefined && !targetStage) throw new EvidenceFoundryRefusal(`unknown stage: ${stageId}`);
  const targetStages = targetStage ? [targetStage] : protocol.stages;
  const targetCellIds = new Set(targetStages.map((stage) => stage.clientModelCellId));
  if (targetStage) {
    const expectedLifecycle = targetStage.stageType === 'primary-confirmatory' ? 'frozen-ready-not-run' : 'running';
    if (protocol.lifecycle !== expectedLifecycle) blockers.push(`program lifecycle is ${protocol.lifecycle}, expected ${expectedLifecycle} for ${targetStage.id} readiness`);
    if (targetStage.lifecycle !== 'frozen-ready-not-run') blockers.push(`${targetStage.id} lifecycle is ${targetStage.lifecycle}, expected frozen-ready-not-run`);
    for (const dependency of targetStage.dependsOn) {
      const dependencyStage = protocol.stages.find((stage) => stage.id === dependency);
      if (dependencyStage?.lifecycle !== 'complete') blockers.push(`${targetStage.id} dependency ${dependency} is not complete`);
    }
    if (targetStage.stageType === 'primary-confirmatory' && canonicalJson(protocol.currentClaimClasses) !== canonicalJson([CLAIM['no-efficacy-claim']])) {
      blockers.push('a not-yet-run primary stage must have only the no-efficacy-claim class');
    }
  } else {
    if (protocol.lifecycle !== 'frozen-ready-not-run') blockers.push(`lifecycle is ${protocol.lifecycle}, expected frozen-ready-not-run`);
    if (canonicalJson(protocol.currentClaimClasses) !== canonicalJson([CLAIM['no-efficacy-claim']])) blockers.push('a not-yet-run study must have only the no-efficacy-claim class');
  }
  verifyReleaseBinding(root, protocol.releaseBinding, blockers);
  if (protocol.taskPopulation.status !== 'frozen') blockers.push('task manifest is not frozen');
  if (protocol.taskPopulation.exposure !== 'never-exposed-to-development') blockers.push('task population is development-exposed');
  const expectedHeldoutStatus = targetStage?.stageType === 'transport-confirmatory' ? 'accessed-after-seal' : 'never-accessed';
  if (protocol.heldoutAccess.status !== expectedHeldoutStatus) blockers.push(`heldout task status is ${protocol.heldoutAccess.status}, expected ${expectedHeldoutStatus}`);
  requireArtifactDigest(root, protocol.taskPopulation.manifestPath, protocol.taskPopulation.manifestSha256, 'task manifest', blockers);
  requireArtifactDigest(root, protocol.artifacts.powerDesign.path, protocol.artifacts.powerDesign.sha256, 'power design', blockers);
  requireArtifactDigest(root, protocol.artifacts.assignmentSeal.path, protocol.artifacts.assignmentSeal.sha256, 'assignment seal', blockers);
  verifyEvaluatorArtifacts(root, protocol, blockers);
  verifyRunIntegrityLock(root, protocol, blockers);
  for (const stage of targetStages) verifyStageExecutionBundle(root, protocol, stage, blockers);
  if (!targetStage || targetStage.stageType === 'primary-confirmatory') {
    if (protocol.artifacts.rawLedger.headSha256 !== null) blockers.push('not-yet-run primary study may not bind a raw-ledger head');
    if (protocol.artifacts.results.sha256 !== null) blockers.push('not-yet-run primary study may not bind results');
  }
  for (const cell of protocol.clientModelCells.filter((cell) => targetCellIds.has(cell.id))) {
    if (cell.qualification.status !== 'qualified-before-stage-exposure') blockers.push(`${cell.id} is not qualified before stage exposure`);
    for (const key of ['client', 'executable', 'clientVersion', 'clientArtifactSha256', 'adapterArtifactSha256', 'requestedModel', 'resolvedModel', 'modelIdentitySource', 'modelIdentityEvidenceSha256', 'reasoningEffort']) {
      if (cell[key] === null) blockers.push(`${cell.id}.${key} is unset`);
    }
    if (cell.qualification.attestationPath) {
      requireArtifactDigest(root, cell.qualification.attestationPath, cell.qualification.attestationSha256, `${cell.id} qualification attestation`, blockers);
    }
  }
  if (targetStages.some((stage) => stage.lifecycle !== 'frozen-ready-not-run' || stage.preregistration !== 'sealed-before-heldout-access')) blockers.push('one or more target stages are not sealed and ready');
  const targetPowerStages = powerDesign.stages.filter((stage) => targetStages.some((target) => target.id === stage.stageId));
  if (powerDesign.status !== 'validated-before-heldout-access' || targetPowerStages.length !== targetStages.length || targetPowerStages.some((stage) => !stage.calculation?.plannedMeetsRequirement) || !powerDesign.validation?.falseBlockGuardMet) {
    blockers.push('power design is not a passing pre-access validation for the target stage scope');
  }
  return blockers;
}
