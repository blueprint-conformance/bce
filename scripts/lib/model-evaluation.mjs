import Ajv from 'ajv';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localProviderProofMatches,
  localProviderProofWellFormed,
} from './model-evaluation-provider.mjs';
import { verifyOllamaClientEvents } from './model-evaluation-client-events.mjs';

export const ARMS = ['baseline-no-bce', 'bce-enabled'];
export const ASSIGNMENT_ALGORITHM = 'bce-sha256-rank-paired-v1';
const TREATMENT_DELTA_CONTRACT = {
  onlyAllowedArmDifferences: [
    'exact BCE engine artifact installed in the trial workspace',
    'task-specific EngineeringBlueprint encoding the same written policy both arms receive',
    'project-scoped BCE Agent Skill',
    'project-scoped BCE MCP configuration',
    'visible pipeline includes the BCE done-check',
  ],
  mustRemainByteIdentical: [
    'base task tree before treatment materialization',
    'task prompt and written architecture rule',
    'client executable and client version',
    'requested and resolved model identity',
    'reasoning effort and model parameters',
    'non-BCE tools and permissions',
    'network policy',
    'time, token, turn, and cost ceilings',
    'visible functional tests',
    'hidden functional oracle',
    'independent architecture oracle',
    'protected-path classifier',
  ],
  forbiddenTreatmentDifferences: [
    'additional architecture facts unavailable to baseline',
    'different task wording',
    'different resource budgets',
    'different repository revision',
    'different non-BCE tools',
    'outcome-dependent retry or stopping',
  ],
};
export const CONFIRMATORY_SIGSTORE_ISSUER = 'https://token.actions.githubusercontent.com';
export const CONFIRMATORY_SIGSTORE_IDENTITY = 'https://github.com/blueprint-conformance/bce/.github/workflows/model-evaluation-confirmatory-seal.yml@refs/heads/main';

export const FROZEN_IMPLEMENTATIONS = {
  verifierSha256: fileURLToPath(import.meta.url),
  assignmentGeneratorSha256: fileURLToPath(new URL('../generate-model-evaluation-assignments.mjs', import.meta.url)),
  runnerSha256: fileURLToPath(new URL('../run-model-evaluation.mjs', import.meta.url)),
  analyzerSha256: fileURLToPath(new URL('../analyze-model-evaluation.mjs', import.meta.url)),
  analysisCoreSha256: fileURLToPath(new URL('./model-evaluation-analysis.mjs', import.meta.url)),
  referenceVerifierSha256: fileURLToPath(new URL('../verify-model-evaluation-reference-patches.mjs', import.meta.url)),
  providerVerifierSha256: fileURLToPath(new URL('./model-evaluation-provider.mjs', import.meta.url)),
  haltVerifierSha256: fileURLToPath(new URL('./model-evaluation-halt.mjs', import.meta.url)),
  publicExporterSha256: fileURLToPath(new URL('../export-model-evaluation-public.mjs', import.meta.url)),
  publicVerifierSha256: fileURLToPath(new URL('../verify-model-evaluation-public.mjs', import.meta.url)),
  blindedEvaluatorSha256: fileURLToPath(new URL('../model-evaluation-blinded-evaluator.mjs', import.meta.url)),
  studyHaltSchemaSha256: fileURLToPath(new URL('../../research/model-evaluation/schemas/study-halt.schema.json', import.meta.url)),
  safetyHaltArchiveSchemaSha256: fileURLToPath(new URL('../../research/model-evaluation/schemas/safety-halt-archive.schema.json', import.meta.url)),
  canaryRunnerSha256: fileURLToPath(new URL('../run-model-evaluation-canary.mjs', import.meta.url)),
  ollamaToolClientSha256: fileURLToPath(new URL('../model-evaluation-ollama-tool-client.mjs', import.meta.url)),
  ollamaToolClientEventVerifierSha256: fileURLToPath(new URL('./model-evaluation-client-events.mjs', import.meta.url)),
  ollamaSystemPromptSha256: fileURLToPath(new URL('../../research/model-evaluation/client/ollama-system-prompt.v1.txt', import.meta.url)),
  ollamaCommonToolsSha256: fileURLToPath(new URL('../../research/model-evaluation/client/ollama-common-tools.v1.json', import.meta.url)),
  ollamaClientEventSchemaSha256: fileURLToPath(new URL('../../research/model-evaluation/schemas/client-event.schema.json', import.meta.url)),
  capabilityCanaryAttestationSchemaSha256: fileURLToPath(new URL('../../research/model-evaluation/schemas/capability-canary-attestation.schema.json', import.meta.url)),
};

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

function globMatches(path, glob) {
  const marker = '__DOUBLE_STAR__';
  const escaped = glob.replace(/\*\*/g, marker).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replaceAll(marker, '.*');
  return new RegExp(`^${escaped}$`).test(path);
}

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value) {
  return sha256Bytes(canonicalJson(value));
}

export function verifyRunRegistration(runsRoot, bundle) {
  const path = resolve(runsRoot, 'run-registration.json');
  const registration = JSON.parse(readFileSync(path, 'utf8'));
  const identity = {
    studyId: bundle.protocol.studyId,
    sealRootSha256: bundle.seal.rootSha256,
    protocolSha256: sha256Bytes(readFileSync(resolve(bundle.root, 'protocol.v2.json'))),
    manifestSha256: sha256Bytes(readFileSync(resolve(bundle.root, 'task-manifest.json'))),
    runnerSha256: bundle.protocol.implementation.runnerSha256,
    plannedTrials: bundle.manifest.assignments.length,
  };
  const expectedRunId = sha256Json({ schemaVersion: 'bce-model-evaluation-run/v1', ...identity });
  const keys = ['schemaVersion', 'runId', 'registeredAt', ...Object.keys(identity), 'registrationSha256'].sort();
  if (canonicalJson(Object.keys(registration).sort()) !== canonicalJson(keys) || registration.schemaVersion !== '1' ||
      registration.runId !== expectedRunId || !Number.isFinite(Date.parse(registration.registeredAt ?? '')) ||
      registration.registrationSha256 !== sha256Json({ ...registration, registrationSha256: null }) ||
      canonicalJson(Object.fromEntries(Object.keys(identity).map((key) => [key, registration[key]]))) !== canonicalJson(identity)) {
    throw new Error('run registration does not bind the exact sealed study');
  }
  return registration;
}

export function fileArtifact(path, root, mediaType = 'application/octet-stream') {
  const bytes = readFileSync(path);
  return {
    path: posixRelative(root, path),
    sha256: sha256Bytes(bytes),
    bytes: bytes.byteLength,
    mediaType,
  };
}

function posixRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function assertRelativePath(path, label) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error(`${label}: path must be non-empty, relative, and traversal-free (${String(path)})`);
  }
}

export function resolveInside(root, path, label = 'artifact') {
  assertRelativePath(path, label);
  const base = resolve(root);
  const target = resolve(base, path);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`${label}: path escapes bundle root`);
  return target;
}

function resolveSealedFile(root, path, label) {
  const base = realpathSync(root);
  const target = resolveInside(base, path, label);
  let cursor = base;
  for (const segment of posixRelative(base, target).split('/')) {
    cursor = resolve(cursor, segment);
    if (lstatSync(cursor).isSymbolicLink()) throw new Error(`${label}: symbolic-link bundle artifacts are refused`);
  }
  const canonical = realpathSync(target);
  if (canonical !== base && !canonical.startsWith(`${base}${sep}`)) throw new Error(`${label}: real path escapes bundle root`);
  return canonical;
}

function resolveSealedDirectory(root, path, label) {
  const directory = resolveSealedFile(root, path, label);
  if (!statSync(directory).isDirectory()) throw new Error(`${label}: not a directory`);
  return directory;
}

export function hashTree(root, { includeNodeModules = false } = {}) {
  const base = realpathSync(root);
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git' || (!includeNodeModules && name === 'node_modules') || name === 'coverage') continue;
      const absolute = resolve(dir, name);
      const rel = posixRelative(base, absolute);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ path: `${rel}/`, type: 'directory', mode: stat.mode & 0o777 });
        walk(absolute);
      } else if (stat.isSymbolicLink()) {
        entries.push({ path: rel, type: 'symlink', mode: stat.mode & 0o777, target: readlinkSync(absolute) });
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({ path: rel, type: 'file', mode: stat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
      } else {
        throw new Error(`tree contains unsupported entry type: ${rel}`);
      }
    }
  };
  walk(base);
  return sha256Json(entries);
}

function compileSchema(schemaPath) {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateFormats: false });
  return { ajv, validate: ajv.compile(schema) };
}

function validateOrThrow(value, schemaPath, label) {
  const { ajv, validate } = compileSchema(schemaPath);
  if (!validate(value)) throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

export function validateCapabilityCanaryAttestation(attestation, schemaPath, { requirePublicReplay = false } = {}) {
  validateOrThrow(attestation, schemaPath, 'capability canary attestation');
  if (attestation.attestationSha256 !== sha256Json({ ...attestation, attestationSha256: null })) {
    throw new Error('capability canary attestation self-digest does not recompute');
  }
  if (requirePublicReplay && attestation.schemaVersion !== '2') {
    throw new Error('confirmatory qualification requires a v2 attestation with retained public replay evidence');
  }
  return true;
}

export function validateConfirmatorySealSigner(attestation) {
  if (attestation?.kind !== 'sigstore-github-oidc' || attestation.eligibleForProductClaim !== true ||
      attestation.certificateIssuer !== CONFIRMATORY_SIGSTORE_ISSUER ||
      attestation.certificateIdentityURI !== CONFIRMATORY_SIGSTORE_IDENTITY ||
      attestation.identity !== CONFIRMATORY_SIGSTORE_IDENTITY) {
    throw new Error(`confirmatory seal requires exact signer ${CONFIRMATORY_SIGSTORE_IDENTITY} issued by ${CONFIRMATORY_SIGSTORE_ISSUER}`);
  }
  return true;
}

export function verifyConfirmatorySigstoreSubject(subjectInput, bundleInput, signatureVerifier) {
  const subjectBytes = Buffer.isBuffer(subjectInput) ? subjectInput : Buffer.from(subjectInput);
  const bundleBytes = Buffer.isBuffer(bundleInput) ? bundleInput : Buffer.from(bundleInput);
  let bundle;
  try {
    bundle = JSON.parse(bundleBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`confirmatory Sigstore bundle is not JSON: ${error.message}`);
  }
  const encoded = bundle?.dsseEnvelope?.payload;
  if (typeof encoded !== 'string' || encoded.length === 0 || encoded.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('confirmatory Sigstore DSSE payload is not canonical base64');
  }
  const payloadBytes = Buffer.from(encoded, 'base64');
  if (payloadBytes.toString('base64') !== encoded) {
    throw new Error('confirmatory Sigstore DSSE payload is not canonical base64');
  }
  if (!payloadBytes.equals(subjectBytes)) {
    throw new Error('confirmatory Sigstore DSSE payload does not equal the exact seal subject bytes');
  }
  if (typeof signatureVerifier !== 'function') throw new Error('confirmatory Sigstore signature verifier is unavailable');
  signatureVerifier();
  return true;
}

function qualificationExactCell(protocol, cell, configuration) {
  return {
    client: cell.client,
    clientVersion: cell.clientVersion,
    clientArtifactSha256: cell.clientArtifactSha256,
    reasoningEffort: cell.reasoningEffort,
    requestedModel: cell.requestedModel,
    resolvedModel: cell.resolvedModel,
    provider: cell.localProvider,
    runtimeVersion: protocol.isolation.runtimeVersion,
    runtimeArtifactSha256: protocol.isolation.runtimeArtifactSha256,
    controllerSha256: protocol.implementation.runnerSha256,
    implementation: protocol.implementation,
    treatmentArtifactSha256: protocol.treatment.engineArtifactSha256,
    treatmentInstalledTreeSha256: protocol.treatment.installedTreeSha256,
    toolLoop: configuration ? { ...configuration, qualificationAttestation: null } : null,
  };
}

function rank(seed, domain, id) {
  return sha256Bytes(`${seed}\0${domain}\0${id}`);
}

export function regenerateAssignments(protocol, manifest) {
  const cells = protocol.clientModelCells.map((cell) => cell.id).sort();
  const tasks = manifest.tasks.map((task) => ({ id: task.id, repositoryId: task.repositoryId })).sort((a, b) => a.id.localeCompare(b.id));
  const input = {
    algorithm: ASSIGNMENT_ALGORITHM,
    seed: protocol.randomization.seed,
    cells,
    tasks,
    arms: ARMS,
    replicate: 0,
  };
  const pairs = [];
  for (const cellId of cells) {
    for (const task of tasks) {
      const pairId = `${cellId}-${task.id}-r0`;
      const bceFirst = Number.parseInt(rank(protocol.randomization.seed, 'arm-order', pairId).slice(-2), 16) % 2 === 0;
      const armOrder = bceFirst ? ['bce-enabled', 'baseline-no-bce'] : ['baseline-no-bce', 'bce-enabled'];
      pairs.push({
        pairId,
        cellId,
        repositoryId: task.repositoryId,
        taskId: task.id,
        replicate: 0,
        armOrder,
        rank: rank(protocol.randomization.seed, 'pair-order', pairId),
      });
    }
  }
  pairs.sort((a, b) => a.rank.localeCompare(b.rank) || a.pairId.localeCompare(b.pairId));
  const assignments = [];
  for (const pair of pairs) {
    for (let withinPairOrder = 0; withinPairOrder < pair.armOrder.length; withinPairOrder += 1) {
      const arm = pair.armOrder[withinPairOrder];
      assignments.push({
        trialId: `${pair.pairId}-${arm === 'bce-enabled' ? 'bce' : 'base'}`,
        pairId: pair.pairId,
        cellId: pair.cellId,
        repositoryId: pair.repositoryId,
        taskId: pair.taskId,
        replicate: 0,
        arm,
        withinPairOrder,
        orderIndex: assignments.length,
      });
    }
  }
  return {
    assignments,
    assignmentProof: {
      algorithm: ASSIGNMENT_ALGORITHM,
      seed: protocol.randomization.seed,
      inputSha256: sha256Json(input),
      assignmentsSha256: sha256Json(assignments),
    },
  };
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function artifactRefs(task) {
  return [
    task.prompt, task.writtenPolicy, task.invariant, task.functionalOracle.artifact,
    task.architectureOracle.artifact, task.blueprint, task.referencePatch, task.shortcutPatch,
  ].filter(Boolean);
}

function findSymlinks(root) {
  const base = realpathSync(root);
  const findings = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const path = posixRelative(base, absolute);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) findings.push(path);
      else if (stat.isDirectory()) walk(absolute);
    }
  };
  walk(base);
  return findings;
}

function verifyArtifact(root, artifact, label, refusals) {
  try {
    const path = resolveSealedFile(root, artifact.path, label);
    const stat = statSync(path);
    if (!stat.isFile()) return refusals.push(`${label}: not a regular file`);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== artifact.bytes) refusals.push(`${label}: byte count mismatch`);
    if (sha256Bytes(bytes) !== artifact.sha256) refusals.push(`${label}: SHA-256 mismatch`);
  } catch (error) {
    refusals.push(`${label}: ${error.message}`);
  }
}

function addSealedTreePaths(paths, root, relativeRoot, label) {
  const directory = resolveSealedDirectory(root, relativeRoot, label);
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const absolute = resolve(current, name);
      const stat = lstatSync(absolute);
      const path = posixRelative(root, absolute);
      if (stat.isSymbolicLink()) throw new Error(`${label}: symbolic-link public replay artifacts are refused (${path})`);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) paths.add(path);
      else throw new Error(`${label}: unsupported public replay entry (${path})`);
    }
  };
  walk(directory);
}

function collectExpectedSealEntries(bundleDir, protocol, manifest) {
  const paths = new Set([
    'protocol.v2.json',
    'task-manifest.json',
    'treatment-delta.v1.json',
    'protected-paths.v1.json',
    'protocol-amendments.jsonl',
    'schemas/protocol.schema.json',
    'schemas/task-manifest.schema.json',
    'schemas/terminal-record.schema.json',
    'schemas/seal.schema.json',
    'schemas/treatment-delta.schema.json',
    'schemas/protected-paths.schema.json',
  ]);
  for (const optionalSchema of ['schemas/study-halt.schema.json', 'schemas/safety-halt-archive.schema.json', 'schemas/client-event.schema.json', 'schemas/capability-canary-attestation.schema.json']) {
    if (existsSync(resolve(bundleDir, optionalSchema))) paths.add(optionalSchema);
  }
  if (protocol.treatment.engineArtifact) paths.add(protocol.treatment.engineArtifact);
  for (const cell of protocol.clientModelCells ?? []) {
    for (const artifact of [cell.toolLoop?.systemPrompt, cell.toolLoop?.commonToolContract, cell.toolLoop?.clientEventSchema, cell.toolLoop?.qualificationAttestation].filter(Boolean)) paths.add(artifact.path);
    const qualificationArtifact = cell.toolLoop?.qualificationAttestation;
    if (qualificationArtifact) {
      const attestation = JSON.parse(readFileSync(resolveSealedFile(bundleDir, qualificationArtifact.path, `${cell.id} qualification attestation`), 'utf8'));
      if (attestation.schemaVersion === '2') {
        addSealedTreePaths(paths, bundleDir, attestation.publicReplay.bundlePath, `${cell.id} public qualification bundle`);
        addSealedTreePaths(paths, bundleDir, attestation.publicReplay.runsPath, `${cell.id} public qualification runs`);
        paths.add(attestation.publicReplay.terminalRecordsPath);
        paths.add(attestation.publicReplay.ledgerPath);
      }
    }
  }
  for (const task of manifest.tasks) for (const artifact of artifactRefs(task)) paths.add(artifact.path);
  const entries = [...paths].sort().map((path) => {
    const absolute = resolveSealedFile(bundleDir, path, 'seal entry');
    const bytes = readFileSync(absolute);
    return { path, sha256: sha256Bytes(bytes), bytes: bytes.byteLength };
  });
  return entries;
}

export function expectedSeal(bundleDir, protocol, manifest) {
  const entries = collectExpectedSealEntries(bundleDir, protocol, manifest);
  return { entries, rootSha256: sha256Json(entries) };
}

const QUALIFICATION_REQUIREMENTS = [
  'retained-sealed-fixture-bundle', 'independent-terminal-replay-all-attempts', 'successful-command-completion-each-arm',
  'exact-single-allowed-file-edit-each-arm', 'usable-token-and-turn-telemetry-each-arm',
  'zero-tool-router-errors-each-arm', 'stable-provider-name-and-digest',
  'bce-enabled-exact-successful-mcp-run-gate', 'bce-enabled-last-exact-mcp-verdict-pass',
  'sealed-client-event-chain-each-arm', 'controller-bijective-exec-broker-evidence-each-arm',
];
const PUBLIC_QUALIFICATION_REQUIREMENT = 'public-replayable-sealed-fixture-terminal-records-and-ledger';

function deriveQualificationObservation(record, replay) {
  const task = replay.bundle.manifest.tasks.find((entry) => entry.id === record.assignment.taskId);
  const transcript = readJsonArtifact(replay.runsRoot, record.evidence.transcript, `${record.trialId}/qualification transcript`);
  const patch = readJsonArtifact(replay.runsRoot, record.evidence.patch, `${record.trialId}/qualification patch`);
  const isolation = readJsonArtifact(replay.runsRoot, record.evidence.isolationProof, `${record.trialId}/qualification isolation`);
  const documents = transcript.rawUsage ?? [];
  const successfulCommands = documents.filter((node) =>
    node?.type === 'tool.result' && node.payload?.name === 'exec' &&
    node.payload?.ok === true && node.payload?.result?.exitCode === 0).length;
  const exactAllowedFileEdit = patch.changes?.length === 1 && task.allowedPaths.length === 1 && patch.changes[0].path === task.allowedPaths[0] &&
    record.derived.policyAssessmentComplete === true && record.derived.policyMutationObserved === false;
  return {
    trialId: record.trialId,
    arm: record.assignment.arm,
    status: record.status,
    recordSha256: record.recordSha256,
    successfulCommands,
    exactAllowedFileEdit,
    telemetryUsable: Number.isInteger(record.telemetry.agentTurns) && record.telemetry.agentTurns > 0 &&
      Number.isInteger(record.telemetry.inputTokens) && record.telemetry.inputTokens > 0 &&
      Number.isInteger(record.telemetry.outputTokens) && record.telemetry.outputTokens > 0,
    toolRouterErrors: documents.filter((node) => node?.type === 'tool.rejected').length,
    bceMcpRunGate: record.assignment.arm === 'bce-enabled' ? record.mechanism.mcpToolCalls >= 1 && record.mechanism.bceGateCalls >= 1 : null,
    bceLastVerifiedVerdict: record.assignment.arm === 'bce-enabled' ? record.mechanism.bceVerdictSequence?.at(-1) ?? null : null,
    clientEventChainVerified: transcript.sealedClientEventVerification?.passed === true && typeof transcript.sealedClientEventVerification?.eventChainHeadSha256 === 'string',
    execBrokerControllerVerified: transcript.sealedClientEventVerification?.passed === true && transcript.sealedClientEventVerification?.execBrokerError === null &&
      Array.isArray(transcript.sealedClientEventVerification?.execBrokerControllerEvidence) && transcript.sealedClientEventVerification.execBrokerControllerEvidence.length > 0,
    providerIdentityStable: isolation.providerIdentityStable === true,
    safeSuccessfulCompletion: record.derived.safeSuccessfulCompletion,
  };
}

export function verifyCapabilityQualificationReplay(rootInput, attestation, schemaPath) {
  const root = resolve(rootInput);
  validateCapabilityCanaryAttestation(attestation, schemaPath, { requirePublicReplay: true });
  const publicReplay = attestation.publicReplay;
  const bundleRoot = resolveSealedDirectory(root, publicReplay.bundlePath, 'public qualification bundle');
  const runsRoot = resolveSealedDirectory(root, publicReplay.runsPath, 'public qualification runs');
  const protocolBytes = readFileSync(resolveSealedFile(bundleRoot, 'protocol.v2.json', 'public qualification protocol'));
  const manifestBytes = readFileSync(resolveSealedFile(bundleRoot, 'task-manifest.json', 'public qualification manifest'));
  if (sha256Bytes(protocolBytes) !== publicReplay.protocolSha256 || sha256Bytes(protocolBytes) !== attestation.sealedFixtureProtocolSha256) {
    throw new Error('public qualification protocol digest mismatch');
  }
  if (sha256Bytes(manifestBytes) !== publicReplay.manifestSha256 || sha256Bytes(manifestBytes) !== attestation.sealedFixtureManifestSha256) {
    throw new Error('public qualification manifest digest mismatch');
  }
  const replay = loadVerifiedRecords(bundleRoot, runsRoot, { verifyHostArtifacts: false });
  replay.runsRoot = runsRoot;
  if (replay.bundle.seal.rootSha256 !== publicReplay.sealRootSha256 || replay.bundle.seal.rootSha256 !== attestation.sealedFixtureRootSha256) {
    throw new Error('public qualification seal root digest mismatch');
  }
  if (replay.bundle.protocol.studyId !== attestation.studyId || replay.bundle.protocol.phase !== 'pilot' ||
      replay.bundle.protocol.claimScope !== 'sacrificial-apparatus-capability-only-no-product-efficacy-cost-latency-safety-or-adoption-claim' ||
      replay.bundle.manifest.repositories.length !== 1 || replay.bundle.manifest.tasks.length !== 1 || replay.records.length !== 2 ||
      replay.bundle.manifest.assignments.length !== 2) {
    throw new Error('public qualification replay is not the exact two-arm sacrificial canary fixture');
  }
  const [qualificationRepository] = replay.bundle.manifest.repositories;
  const [qualificationTask] = replay.bundle.manifest.tasks;
  if (qualificationRepository.developmentExposed !== true || qualificationTask.repositoryId !== qualificationRepository.id ||
      qualificationTask.classification !== 'pilot-development-only' || qualificationTask.constraintClass !== 'apparatus-capability' ||
      qualificationTask.provenance?.developmentExposed !== true ||
      qualificationTask.provenance?.source !== 'dedicated sacrificial apparatus fixture' ||
      qualificationTask.provenance?.selectionRule !== 'fixed capability proof unrelated to evaluation tasks') {
    throw new Error('public qualification replay is not permanently scoped to development-exposed apparatus evidence');
  }
  const qualificationCell = replay.bundle.protocol.clientModelCells[0];
  if (replay.bundle.protocol.clientModelCells.length !== 1 || qualificationCell.client !== 'bce-ollama-tool-client' ||
      canonicalJson(attestation.exactCell) !== canonicalJson(qualificationExactCell(replay.bundle.protocol, qualificationCell, qualificationCell.toolLoop))) {
    throw new Error('public qualification replay does not bind the attested exact client/model/provider/runtime/controller/treatment/tool-loop cell');
  }
  if (attestation.sourceCommit !== replay.bundle.protocol.treatment.artifactProvenance.sourceCommit ||
      attestation.sourceTreeState !== replay.bundle.protocol.treatment.artifactProvenance.sourceTreeState ||
      attestation.canaryRunnerSha256 !== replay.bundle.protocol.implementation.canaryRunnerSha256) {
    throw new Error('public qualification replay source or canary-runner identity mismatch');
  }
  const terminalBytes = readFileSync(resolveSealedFile(root, publicReplay.terminalRecordsPath, 'public qualification terminal records'));
  const publishedRecords = terminalBytes.toString('utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (sha256Bytes(terminalBytes) !== publicReplay.terminalRecordsSha256 || publicReplay.recordCount !== replay.records.length ||
      canonicalJson(publishedRecords) !== canonicalJson(replay.records)) {
    throw new Error('public qualification terminal records do not match the fully replayed attempts');
  }
  const ledgerBytes = readFileSync(resolveSealedFile(root, publicReplay.ledgerPath, 'public qualification ledger'));
  const retainedLedgerBytes = readFileSync(resolveSealedFile(runsRoot, 'ledger.jsonl', 'retained qualification ledger'));
  const ledger = ledgerBytes.toString('utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  if (!ledgerBytes.equals(retainedLedgerBytes) || sha256Bytes(ledgerBytes) !== publicReplay.ledgerSha256 ||
      ledger.at(-1)?.entrySha256 !== publicReplay.ledgerHeadSha256 ||
      attestation.restrictedEvidence.ledgerHeadSha256 !== publicReplay.ledgerHeadSha256) {
    throw new Error('public qualification ledger digest or head mismatch');
  }
  const observed = [...attestation.observations].sort((left, right) => left.trialId.localeCompare(right.trialId));
  const derived = replay.records.map((record) => deriveQualificationObservation(record, replay)).sort((left, right) => left.trialId.localeCompare(right.trialId));
  if (canonicalJson(observed) !== canonicalJson(derived)) {
    throw new Error('public qualification observations do not rederive from the retained terminal evidence');
  }
  if (attestation.qualified !== true || attestation.refusalReasons.length !== 0 ||
      QUALIFICATION_REQUIREMENTS.some((requirement) => !attestation.requirements.includes(requirement)) ||
      !attestation.requirements.includes(PUBLIC_QUALIFICATION_REQUIREMENT)) {
    throw new Error('public qualification replay does not prove the complete clean two-arm capability contract');
  }
  return { bundle: replay.bundle, records: replay.records, observations: derived };
}

function verifyQualificationAttestation(root, protocol, seal, cell, configuration, refusals) {
  const artifact = configuration.qualificationAttestation;
  if (!artifact) {
    refusals.push(`${cell.id}: first-party Ollama client has no sealed qualified canary attestation artifact`);
    return;
  }
  let attestation;
  try {
    const path = resolveSealedFile(root, artifact.path, `${cell.id} qualification attestation`);
    const bytes = readFileSync(path);
    if (sha256Bytes(bytes) !== artifact.sha256) throw new Error('artifact digest mismatch');
    attestation = JSON.parse(bytes);
    validateOrThrow(attestation, resolve(root, 'schemas', 'capability-canary-attestation.schema.json'), `${cell.id} qualification attestation`);
  } catch (error) {
    refusals.push(`${cell.id}: qualification attestation: ${error.message}`);
    return;
  }
  if (attestation.attestationSha256 !== sha256Json({ ...attestation, attestationSha256: null })) {
    refusals.push(`${cell.id}: qualification attestation self-digest does not recompute`);
  }
  const expectedExactCell = qualificationExactCell(protocol, cell, configuration);
  if (canonicalJson(attestation.exactCell) !== canonicalJson(expectedExactCell)) {
    refusals.push(`${cell.id}: qualification attestation does not bind the exact client/model/provider/runtime/controller/treatment/tool-loop cell`);
  }
  if (attestation.canaryRunnerSha256 !== protocol.implementation.canaryRunnerSha256) {
    refusals.push(`${cell.id}: qualification attestation runner differs from the frozen implementation`);
  }
  const arms = attestation.observations.map((observation) => observation.arm).sort();
  const requiredArms = [...ARMS].sort();
  const observationEligible = attestation.observations.length === 2 && canonicalJson(arms) === canonicalJson(requiredArms) &&
    new Set(attestation.observations.map((observation) => observation.trialId)).size === 2 &&
    attestation.observations.every((observation) => observation.status === 'completed' && observation.successfulCommands >= 1 &&
      observation.exactAllowedFileEdit === true && observation.telemetryUsable === true && observation.toolRouterErrors === 0 &&
      observation.clientEventChainVerified === true && observation.execBrokerControllerVerified === true &&
      observation.providerIdentityStable === true && observation.safeSuccessfulCompletion === true) &&
    attestation.observations.find((observation) => observation.arm === 'baseline-no-bce')?.bceMcpRunGate === null &&
    attestation.observations.find((observation) => observation.arm === 'baseline-no-bce')?.bceLastVerifiedVerdict === null &&
    attestation.observations.find((observation) => observation.arm === 'bce-enabled')?.bceMcpRunGate === true &&
    attestation.observations.find((observation) => observation.arm === 'bce-enabled')?.bceLastVerifiedVerdict === 'pass';
  if (attestation.qualified !== true || attestation.sourceTreeState !== 'clean' || attestation.refusalReasons.length !== 0 ||
      attestation.restrictedEvidence.retained !== true || attestation.restrictedEvidence.bundleRetained !== true || !/^[0-9a-f]{64}$/.test(attestation.restrictedEvidence.ledgerHeadSha256 ?? '') ||
      !observationEligible || QUALIFICATION_REQUIREMENTS.some((requirement) => !attestation.requirements.includes(requirement))) {
    refusals.push(`${cell.id}: qualification attestation does not prove the complete clean two-arm capability contract`);
  }
  if (protocol.phase === 'confirmatory') {
    try {
      verifyCapabilityQualificationReplay(root, attestation, resolve(root, 'schemas', 'capability-canary-attestation.schema.json'));
    } catch (error) {
      refusals.push(`${cell.id}: confirmatory qualification replay: ${error.message}`);
    }
  }
}

export function loadBundle(bundleDir) {
  const root = resolve(bundleDir);
  const protocol = JSON.parse(readFileSync(resolve(root, 'protocol.v2.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, 'task-manifest.json'), 'utf8'));
  const seal = JSON.parse(readFileSync(resolve(root, 'seal.json'), 'utf8'));
  const treatmentDelta = JSON.parse(readFileSync(resolve(root, protocol.treatment.allowedDeltaManifest), 'utf8'));
  const protectedPaths = JSON.parse(readFileSync(resolve(root, protocol.protectedPaths), 'utf8'));
  return { root, protocol, manifest, seal, treatmentDelta, protectedPaths };
}

export function verifyBundle(bundleDir, { requireSealed = true, verifyHostArtifacts = true } = {}) {
  const { root, protocol, manifest, seal, treatmentDelta, protectedPaths } = loadBundle(bundleDir);
  const refusals = [];
  const historicalImplementations = [];
  try { validateOrThrow(protocol, resolve(root, 'schemas/protocol.schema.json'), 'protocol'); }
  catch (error) { refusals.push(error.message); }
  try { validateOrThrow(manifest, resolve(root, 'schemas/task-manifest.schema.json'), 'task manifest'); }
  catch (error) { refusals.push(error.message); }
  try { validateOrThrow(seal, resolve(root, 'schemas/seal.schema.json'), 'seal'); }
  catch (error) { refusals.push(error.message); }
  try { validateOrThrow(treatmentDelta, resolve(root, 'schemas/treatment-delta.schema.json'), 'treatment delta'); }
  catch (error) { refusals.push(error.message); }
  try { validateOrThrow(protectedPaths, resolve(root, 'schemas/protected-paths.schema.json'), 'protected paths'); }
  catch (error) { refusals.push(error.message); }
  if (protocol.studyId !== manifest.studyId || protocol.studyId !== seal.studyId) refusals.push('studyId differs across protocol, manifest, and seal');
  if (protocol.studyId !== treatmentDelta.studyId || protocol.studyId !== protectedPaths.studyId) refusals.push('treatment/protected-path studyId differs from protocol');
  for (const required of ['.bce-runtime/**', '.blueprints/**', '.bce-mode.json']) {
    if (!treatmentDelta.allowedPathPatterns?.includes(required)) refusals.push(`treatment delta omits required materialization surface ${required}`);
  }
  for (const [field, expected] of Object.entries(TREATMENT_DELTA_CONTRACT)) {
    if (canonicalJson(treatmentDelta[field]) !== canonicalJson(expected)) refusals.push(`treatment delta ${field} differs from the executable v1 arm-parity contract`);
  }
  for (const required of ['.blueprints/**', '.bce-runtime/**', '.github/**', 'tests/**']) {
    if (!protectedPaths.patterns?.includes(required)) refusals.push(`protected paths omit required policy/evaluator surface ${required}`);
  }
  if (protocol.phase !== manifest.phase) refusals.push('protocol and manifest phase differ');
  if (protocol.results !== null || manifest.results !== null) refusals.push('pre-run inputs may not contain results');
  const cellIds = protocol.clientModelCells.map((cell) => cell.id);
  const repoIds = manifest.repositories.map((repo) => repo.id);
  const taskIds = manifest.tasks.map((task) => task.id);
  for (const [label, values] of [['client cell', cellIds], ['repository', repoIds], ['task', taskIds]]) {
    const duplicates = duplicateValues(values);
    if (duplicates.length) refusals.push(`duplicate ${label} IDs: ${duplicates.join(', ')}`);
  }
  const primaryCells = protocol.clientModelCells.filter((cell) => cell.role === 'primary');
  if (primaryCells.length !== 1) refusals.push(`exactly one primary client/model cell is required; found ${primaryCells.length}`);
  for (const [name, digest] of Object.entries(protocol.implementation ?? {})) {
    if (!/^[0-9a-f]{64}$/.test(digest ?? '')) refusals.push(`implementation ${name} is not frozen`);
  }
  for (const [name, implementationPath] of Object.entries(FROZEN_IMPLEMENTATIONS)) {
    const runningDigest = sha256Bytes(readFileSync(implementationPath));
    if (protocol.implementation?.[name] && protocol.implementation[name] !== runningDigest) {
      const commit = seal.attestation?.kind === 'local-git-commit' ? seal.attestation.gitCommit : null;
      let historicalDigest = null;
      if (/^[0-9a-f]{40}$/.test(commit ?? '')) {
        const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
        if (top.status === 0) {
          const repositoryRoot = top.stdout.trim();
          const repositoryPath = posixRelative(repositoryRoot, implementationPath);
          if (repositoryPath !== '..' && !repositoryPath.startsWith('../')) {
            const blob = spawnSync('git', ['show', `${commit}:${repositoryPath}`], { cwd: repositoryRoot, encoding: null, maxBuffer: 64 * 1024 * 1024 });
            if (blob.status === 0) historicalDigest = sha256Bytes(blob.stdout);
          }
        }
      }
      if (historicalDigest === protocol.implementation[name]) historicalImplementations.push({ name, commit });
      else refusals.push(`running ${name.replace(/Sha256$/, '')} digest differs from the frozen protocol implementation and the attested historical bytes are unavailable`);
    }
  }
  if (protocol.status === 'frozen-ready-not-run') {
    if (typeof protocol.isolation.executionDriver !== 'string' || !/^[0-9a-f]{64}$/.test(protocol.isolation.executionDriverSha256 ?? '')) {
      refusals.push('execution isolation driver and digest are not frozen');
    }
    for (const field of ['runtimeExecutable', 'runtimeVersion', 'runtimeArtifactSha256']) {
      if (typeof protocol.isolation[field] !== 'string' || protocol.isolation[field].length === 0) refusals.push(`execution isolation ${field} is not frozen`);
    }
    if (protocol.isolation.clientSandboxMode !== undefined && protocol.isolation.clientSandboxMode !== 'outer-controller-profile-only') {
      refusals.push('execution client sandbox ownership is not frozen to the outer controller profile');
    }
    if (verifyHostArtifacts) {
      try {
        if (sha256Bytes(readFileSync(protocol.isolation.runtimeExecutable)) !== protocol.isolation.runtimeArtifactSha256) refusals.push('execution runtime artifact digest mismatch');
      } catch (error) { refusals.push(`execution runtime artifact: ${error.message}`); }
    }
  }
  if (protocol.matrix.clientModelCells !== protocol.clientModelCells.length) refusals.push('matrix clientModelCells does not equal declared cell count');
  if (protocol.matrix.repositories !== manifest.repositories.length) refusals.push('matrix repository count does not equal manifest');
  if (protocol.matrix.trialsPerArmPerCell !== manifest.tasks.length) refusals.push('trialsPerArmPerCell must equal exact task count');
  if (protocol.matrix.totalRandomizedTrials !== manifest.tasks.length * protocol.clientModelCells.length * 2) refusals.push('totalRandomizedTrials is not the exact task × cell × arm matrix');
  const repos = new Map(manifest.repositories.map((repo) => [repo.id, repo]));
  for (const repo of manifest.repositories) {
    try {
      const tree = resolveSealedFile(root, repo.treePath, `repository ${repo.id}`);
      const symlinks = findSymlinks(tree);
      if (symlinks.length) refusals.push(`repository ${repo.id}: symbolic links are refused (${symlinks.join(', ')})`);
      if (hashTree(tree) !== repo.treeSha256) refusals.push(`repository ${repo.id}: tree digest mismatch`);
    } catch (error) { refusals.push(`repository ${repo.id}: ${error.message}`); }
    if (repo.setupCommands.length === 0 && repo.preparedTreeSha256 !== repo.treeSha256) {
      refusals.push(`repository ${repo.id}: no-op preparation must preserve the frozen tree digest`);
    }
    if (protocol.phase === 'confirmatory' && repo.developmentExposed) refusals.push(`repository ${repo.id}: confirmatory repository is marked development-exposed`);
  }
  const shortcutCalibrationRequired = protocol.phase === 'pilot' && protocol.claimScope.includes('directional-apparatus-calibration');
  for (const task of manifest.tasks) {
    if (!repos.has(task.repositoryId)) refusals.push(`task ${task.id}: unknown repositoryId ${task.repositoryId}`);
    for (const artifact of artifactRefs(task)) verifyArtifact(root, artifact, `task ${task.id}/${basename(artifact.path)}`, refusals);
    if (task.functionalOracle.implementation !== 'functional') refusals.push(`task ${task.id}: functional oracle has wrong implementation class`);
    if (task.architectureOracle.implementation !== 'bce-independent') refusals.push(`task ${task.id}: architecture oracle is not declared BCE-independent`);
    for (const [label, oracle] of [['functional', task.functionalOracle], ['architecture', task.architectureOracle]]) {
      if (!oracle.command.includes(oracle.artifact.path)) {
        refusals.push(`task ${task.id}: ${label} oracle command does not execute its sealed oracle artifact`);
      }
    }
    try {
      const blueprint = JSON.parse(readFileSync(resolveInside(root, task.blueprint.path, `task ${task.id} blueprint`), 'utf8'));
      if (blueprint.kind !== 'EngineeringBlueprint' || blueprint.metadata?.status !== 'approved' || !Array.isArray(blueprint.constraints) || blueprint.constraints.length === 0) {
        refusals.push(`task ${task.id}: treatment blueprint is not an approved, non-empty EngineeringBlueprint`);
      }
      const invariant = JSON.parse(readFileSync(resolveInside(root, task.invariant.path, `task ${task.id} invariant`), 'utf8'));
      const writtenPolicy = readFileSync(resolveInside(root, task.writtenPolicy.path, `task ${task.id} written policy`), 'utf8').trim();
      if (invariant.schemaVersion !== '1' || typeof invariant.writtenPolicyText !== 'string' || !invariant.constraint) {
        refusals.push(`task ${task.id}: invariant artifact is not the normalized v1 policy contract`);
      } else {
        if (writtenPolicy !== invariant.writtenPolicyText.trim()) refusals.push(`task ${task.id}: written policy is not byte-equivalent to the normalized invariant text`);
        if (!blueprint.constraints.some((constraint) => canonicalJson(constraint) === canonicalJson(invariant.constraint))) {
          refusals.push(`task ${task.id}: treatment blueprint contains operative facts not derived from the normalized invariant`);
        }
      }
    } catch (error) {
      refusals.push(`task ${task.id}: blueprint/invariant equivalence check failed (${error.message})`);
    }
    try {
      const architectureOracle = readFileSync(resolveInside(root, task.architectureOracle.artifact.path, `task ${task.id} architecture oracle`), 'utf8');
      if (/\bbce-engine\b|\bblueprint-conformance\b|\bbce\s+(?:gate|run|scan|teeth)\b|@[^'"\s]*bce[^'"\s]*/i.test(architectureOracle)) {
        refusals.push(`task ${task.id}: architecture oracle contains a BCE dependency or invocation and is not independent`);
      }
    } catch (error) {
      refusals.push(`task ${task.id}: architecture oracle independence scan failed (${error.message})`);
    }
    if (task.allowedPaths.some((path) => task.protectedPaths.includes(path))) refusals.push(`task ${task.id}: allowed and protected paths overlap exactly`);
    const hasReferenceArtifact = task.referencePatch !== undefined && task.referencePatch !== null;
    const hasReferenceDigest = task.referencePatchSha256 !== null;
    if (hasReferenceArtifact !== hasReferenceDigest) refusals.push(`task ${task.id}: reference patch artifact and digest must be present together`);
    if (hasReferenceArtifact && task.referencePatch.sha256 !== task.referencePatchSha256) refusals.push(`task ${task.id}: reference patch artifact digest does not match referencePatchSha256`);
    const hasShortcutArtifact = task.shortcutPatch !== undefined && task.shortcutPatch !== null;
    const hasShortcutDigest = task.shortcutPatchSha256 !== undefined && task.shortcutPatchSha256 !== null;
    if (hasShortcutArtifact !== hasShortcutDigest) refusals.push(`task ${task.id}: shortcut patch artifact and digest must be present together`);
    if (hasShortcutArtifact && task.shortcutPatch.sha256 !== task.shortcutPatchSha256) refusals.push(`task ${task.id}: shortcut patch artifact digest does not match shortcutPatchSha256`);
    if (shortcutCalibrationRequired && !hasShortcutArtifact) refusals.push(`task ${task.id}: directional apparatus-calibration pilot has no frozen shortcut witness`);
    if (protocol.phase === 'confirmatory') {
      if (task.classification !== 'confirmatory-held-out' || task.provenance.developmentExposed) refusals.push(`task ${task.id}: confirmatory task is development-exposed or misclassified`);
      if (!hasReferenceArtifact || !/^[0-9a-f]{64}$/.test(task.referencePatchSha256 ?? '')) refusals.push(`task ${task.id}: confirmatory task has no frozen reference patch artifact and digest`);
    } else if (task.classification !== 'pilot-development-only') refusals.push(`task ${task.id}: pilot task must be permanently classified pilot-development-only`);
  }
  for (const repoId of repoIds) {
    const repoTasks = manifest.tasks.filter((task) => task.repositoryId === repoId);
    if (repoTasks.length !== protocol.matrix.tasksPerRepository) refusals.push(`${repoId}: expected ${protocol.matrix.tasksPerRepository} tasks, found ${repoTasks.length}`);
    for (const type of protocol.matrix.taskTypes) {
      if (!repoTasks.some((task) => task.taskType === type)) refusals.push(`${repoId}: missing task type ${type}`);
    }
  }
  for (const cell of protocol.clientModelCells) {
    for (const field of ['executable', 'clientVersion', 'clientArtifactSha256', 'adapterSha256', 'requestedModel', 'resolvedModel', 'modelIdentitySource', 'modelIdentityEvidence', 'reasoningEffort']) {
      if (typeof cell[field] !== 'string' || cell[field].length === 0) refusals.push(`${cell.id}: ${field} is not frozen`);
    }
    if (protocol.phase === 'confirmatory' && cell.modelIdentityEvidence !== 'provider-response') {
      refusals.push(`${cell.id}: confirmatory model identity must come from a provider response`);
    }
    if (cell.client === 'bce-ollama-tool-client') {
      const configuration = cell.toolLoop;
      if (!configuration) refusals.push(`${cell.id}: first-party Ollama client lacks frozen toolLoop configuration`);
      else {
        const canarySchemaPath = resolve(root, 'schemas', 'capability-canary-attestation.schema.json');
        if (!existsSync(canarySchemaPath) || protocol.implementation.capabilityCanaryAttestationSchemaSha256 !== sha256Bytes(readFileSync(canarySchemaPath))) {
          refusals.push(`${cell.id}: capability-canary attestation schema is not sealed and implementation-bound`);
        }
        if (cell.clientArtifactSha256 !== protocol.implementation.ollamaToolClientSha256 ||
            configuration.clientImplementationSha256 !== cell.clientArtifactSha256 ||
            configuration.eventProtocol !== 'bce-ollama-tool-client-events/v1') {
          refusals.push(`${cell.id}: first-party Ollama client implementation is not bound consistently`);
        }
        for (const [label, artifact, implementationField] of [
          ['system prompt', configuration.systemPrompt, 'ollamaSystemPromptSha256'],
          ['common tools', configuration.commonToolContract, 'ollamaCommonToolsSha256'],
          ['client event schema', configuration.clientEventSchema, 'ollamaClientEventSchemaSha256'],
        ]) {
          try {
            const bytes = readFileSync(resolveSealedFile(root, artifact.path, `${cell.id} ${label}`));
            if (sha256Bytes(bytes) !== artifact.sha256 || artifact.sha256 !== protocol.implementation[implementationField]) refusals.push(`${cell.id}: ${label} digest is not bound consistently`);
          } catch (error) { refusals.push(`${cell.id}: ${label}: ${error.message}`); }
        }
        if (configuration.execSandbox?.driver !== '/usr/bin/sandbox-exec' ||
            configuration.execSandbox?.driverSha256 !== protocol.isolation.executionDriverSha256) {
          refusals.push(`${cell.id}: exec broker driver is not the exact frozen study isolation driver`);
        }
        if (manifest.tasks.some((task) => task.budget.maxTurns > configuration.limits.maximumTurns)) refusals.push(`${cell.id}: a task exceeds the frozen tool-loop turn cap`);
        if (seal.attestation?.kind !== 'synthetic-self-test') verifyQualificationAttestation(root, protocol, seal, cell, configuration, refusals);
      }
      if (!cell.localProvider) refusals.push(`${cell.id}: first-party Ollama client lacks an exact frozen local provider`);
    } else if (cell.toolLoop != null) refusals.push(`${cell.id}: non-reference client unexpectedly declares toolLoop configuration`);
    if (cell.localProvider) {
      let endpoint = null;
      try { endpoint = new URL(cell.localProvider.endpoint); }
      catch { refusals.push(`${cell.id}: local provider endpoint is not a valid URL`); }
      if (endpoint && (endpoint.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(endpoint.hostname) || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname))) {
        refusals.push(`${cell.id}: local provider endpoint must be credential-free HTTP on one explicit loopback port with no path, query, or fragment`);
      }
      const qualifiedFirstPartyConfirmatoryCell = protocol.phase === 'confirmatory' &&
        cell.client === 'bce-ollama-tool-client' && cell.toolLoop?.qualificationAttestation != null;
      if (protocol.phase !== 'pilot' && !qualifiedFirstPartyConfirmatoryCell) {
        refusals.push(`${cell.id}: confirmatory local-provider cells require the first-party tool client and its exact sealed capability qualification`);
      }
      if (!['codex', 'bce-ollama-tool-client'].includes(cell.client) && seal.attestation?.kind !== 'synthetic-self-test') refusals.push(`${cell.id}: no sealed local-provider adapter exists for ${cell.client}`);
      if (cell.localProvider.kind !== 'ollama' || cell.localProvider.authentication !== 'none') refusals.push(`${cell.id}: local provider must be unauthenticated Ollama`);
      if (protocol.isolation.modelNetworkPolicy !== 'loopback-only-single-endpoint') refusals.push(`${cell.id}: local provider requires loopback-only-single-endpoint isolation`);
      if (cell.requestedModel !== cell.localProvider.modelName || cell.resolvedModel !== `${cell.localProvider.modelName}@sha256:${cell.localProvider.modelDigest}` || cell.modelIdentityEvidence !== 'provider-response') {
        refusals.push(`${cell.id}: local provider model name, content digest, and provider-response identity are not bound consistently`);
      }
      if (manifest.tasks.some((task) => task.budget.maxCostUsd !== null)) refusals.push(`${cell.id}: local provider tasks must record USD cost as unavailable (maxCostUsd=null)`);
    }
  }
  if (protocol.isolation.modelNetworkPolicy === 'loopback-only-single-endpoint' && !protocol.clientModelCells.some((cell) => cell.localProvider)) {
    refusals.push('loopback-only model network policy has no local-provider cell');
  }
  if (typeof protocol.treatment.engineArtifact !== 'string' || !/^[0-9a-f]{64}$/.test(protocol.treatment.engineArtifactSha256 ?? '')) {
    refusals.push('exact BCE treatment artifact and digest are not frozen');
  } else {
    try {
      const bytes = readFileSync(resolveSealedFile(root, protocol.treatment.engineArtifact, 'BCE engine artifact'));
      if (sha256Bytes(bytes) !== protocol.treatment.engineArtifactSha256) refusals.push('BCE treatment artifact digest mismatch');
    } catch (error) { refusals.push(`BCE treatment artifact: ${error.message}`); }
  }
  if (!/^[0-9a-f]{64}$/.test(protocol.treatment.installedTreeSha256 ?? '') || !protocol.treatment.artifactProvenance) {
    refusals.push('BCE treatment offline installed tree and source provenance are not frozen');
  }
  if (protocol.phase === 'confirmatory' && protocol.treatment.artifactProvenance?.publishedPackageByteMatch !== true) {
    refusals.push('confirmatory treatment must prove an exact published-package byte match');
  }
  if (requireSealed && protocol.treatment.artifactProvenance?.sourceTreeState !== 'clean') {
    refusals.push('sealed execution requires a treatment artifact built from a clean source tree');
  }
  const generated = regenerateAssignments(protocol, manifest);
  if (canonicalJson(manifest.assignments) !== canonicalJson(generated.assignments)) refusals.push('assignments do not regenerate exactly from the frozen seed and task/cell inventory');
  if (canonicalJson(manifest.assignmentProof) !== canonicalJson(generated.assignmentProof)) refusals.push('assignment proof does not match regenerated assignments');
  const order = manifest.assignments.map((assignment) => assignment.orderIndex);
  if (order.some((value, index) => value !== index)) refusals.push('assignment orderIndex values are not unique and contiguous from zero');
  const assignmentIds = manifest.assignments.map((assignment) => assignment.trialId);
  if (duplicateValues(assignmentIds).length) refusals.push('trial IDs are not unique');
  for (const cellId of cellIds) {
    for (const taskId of taskIds) {
      const rows = manifest.assignments.filter((row) => row.cellId === cellId && row.taskId === taskId);
      if (rows.length !== 2 || !ARMS.every((arm) => rows.some((row) => row.arm === arm))) refusals.push(`${cellId}/${taskId}: exact paired arms missing`);
    }
  }
  if (requireSealed) {
    if (protocol.status !== 'frozen-ready-not-run' || manifest.status !== 'frozen-ready-not-run' || manifest.sealed !== true) refusals.push('protocol and manifest are not frozen-ready-not-run');
    if (seal.status !== 'sealed-before-first-trial' || !seal.sealedAt || !seal.publicTimestamp || !seal.attestation) refusals.push('study has no complete pre-run public seal/attestation');
    try {
      const expected = expectedSeal(root, protocol, manifest);
      if (canonicalJson(seal.entries) !== canonicalJson(expected.entries)) refusals.push('seal entries do not exactly match all required bundle inputs');
      if (seal.rootSha256 !== expected.rootSha256) refusals.push('seal root digest mismatch');
      if (seal.attestation?.subjectRootSha256 !== expected.rootSha256) refusals.push('seal attestation subject does not bind the computed root digest');
      if (protocol.phase === 'pilot' && seal.attestation?.eligibleForProductClaim !== false) refusals.push('pilot seal must be permanently ineligible for product claims');
      if (protocol.phase === 'pilot' && seal.attestation?.kind === 'local-git-commit' &&
          (!/^[0-9a-f]{40}$/.test(seal.attestation.gitCommit ?? '') || !seal.publicTimestamp.includes(seal.attestation.gitCommit))) {
        refusals.push('pilot local-git seal does not bind its exact public commit URL');
      }
      if (protocol.phase === 'confirmatory') {
        try {
          validateConfirmatorySealSigner(seal.attestation);
        } catch (error) {
          refusals.push(error.message);
        }
        if (seal.attestation?.kind === 'sigstore-github-oidc' && seal.attestation?.eligibleForProductClaim === true &&
            seal.attestation.certificateIssuer === CONFIRMATORY_SIGSTORE_ISSUER &&
            seal.attestation.certificateIdentityURI === CONFIRMATORY_SIGSTORE_IDENTITY &&
            seal.attestation.identity === CONFIRMATORY_SIGSTORE_IDENTITY) {
          try {
            const subjectPath = resolveSealedFile(root, seal.attestation.subjectPath, 'Sigstore subject');
            const bundlePath = resolveSealedFile(root, seal.attestation.bundlePath, 'Sigstore bundle');
            const subjectBytes = readFileSync(subjectPath);
            const subject = JSON.parse(subjectBytes.toString('utf8'));
            if (canonicalJson(subject) !== canonicalJson({ schemaVersion: '1', rootSha256: expected.rootSha256 })) throw new Error('subject file does not contain the computed seal root');
            const cli = resolve(fileURLToPath(new URL('../..', import.meta.url)), 'node_modules', '@sigstore', 'cli', 'bin', 'run');
            verifyConfirmatorySigstoreSubject(subjectBytes, readFileSync(bundlePath), () => {
              const result = spawnSync(process.execPath, [cli, 'verify', bundlePath, '--certificate-issuer', seal.attestation.certificateIssuer, '--certificate-identity-uri', seal.attestation.certificateIdentityURI], { encoding: 'utf8' });
              if (result.status !== 0) throw new Error(`Sigstore verification failed: ${String(result.stderr).trim()}`);
            });
          } catch (error) { refusals.push(`confirmatory attestation verification: ${error.message}`); }
        }
      }
    } catch (error) { refusals.push(`seal verification: ${error.message}`); }
  }
  return { ok: refusals.length === 0, refusals, root, protocol, manifest, seal, treatmentDelta, protectedPaths, hostArtifactsVerified: verifyHostArtifacts, historicalImplementations };
}

function verifyEventChain(path) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  let previous = null;
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    const event = JSON.parse(lines[index]);
    if (event.sequence !== index) throw new Error(`event sequence ${event.sequence} at line ${index + 1}`);
    if (event.previousEventSha256 !== previous) throw new Error(`event ${index}: predecessor mismatch`);
    const expected = sha256Json({ ...event, eventSha256: null });
    if (event.eventSha256 !== expected) throw new Error(`event ${index}: digest mismatch`);
    previous = event.eventSha256;
    events.push(event);
  }
  if (!events.length) throw new Error('empty event journal');
  return events;
}

function verifyRunArtifact(runsRoot, artifact, label) {
  const path = resolveInside(runsRoot, artifact.path, label);
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label}: not a regular file`);
  const bytes = readFileSync(path);
  if (bytes.byteLength !== artifact.bytes) throw new Error(`${label}: byte count mismatch`);
  if (sha256Bytes(bytes) !== artifact.sha256) throw new Error(`${label}: digest mismatch`);
  return path;
}

function readJsonArtifact(runsRoot, artifact, label) {
  return JSON.parse(readFileSync(verifyRunArtifact(runsRoot, artifact, label), 'utf8'));
}

export function verifyTerminalRecord(record, { bundle, runsRoot, terminalPath = 'terminal record' }) {
  validateOrThrow(record, resolve(bundle.root, 'schemas/terminal-record.schema.json'), terminalPath);
  const expectedRecordSha = sha256Json({ ...record, recordSha256: null });
  if (record.recordSha256 !== expectedRecordSha) throw new Error(`${terminalPath}: record digest mismatch`);
  if (record.studyId !== bundle.protocol.studyId) throw new Error(`${terminalPath}: studyId mismatch`);
  const assignment = bundle.manifest.assignments.find((row) => row.trialId === record.trialId);
  if (!assignment) throw new Error(`${terminalPath}: trial not in sealed assignment manifest`);
  for (const key of ['pairId', 'cellId', 'repositoryId', 'taskId', 'arm', 'orderIndex']) {
    const actual = key === 'pairId' ? record.pairId : record.assignment[key];
    if (actual !== assignment[key]) throw new Error(`${terminalPath}: ${key} differs from sealed assignment`);
  }
  if (!record.primaryAttempt || record.retryOf !== null) throw new Error(`${terminalPath}: randomized denominator must use the immutable primary attempt`);
  if (record.bindings.sealRootSha256 !== bundle.seal.rootSha256) throw new Error(`${terminalPath}: seal binding mismatch`);
  if (record.bindings.runId !== undefined && record.bindings.runId !== null) {
    const registration = verifyRunRegistration(runsRoot, bundle);
    if (record.bindings.runId !== registration.runId) throw new Error(`${terminalPath}: run binding differs from the registered run`);
  }
  if (record.bindings.protocolSha256 !== sha256Bytes(readFileSync(resolve(bundle.root, 'protocol.v2.json')))) throw new Error(`${terminalPath}: protocol binding mismatch`);
  if (record.bindings.manifestSha256 !== sha256Bytes(readFileSync(resolve(bundle.root, 'task-manifest.json')))) throw new Error(`${terminalPath}: manifest binding mismatch`);
  if (record.bindings.runnerSha256 !== bundle.protocol.implementation.runnerSha256) throw new Error(`${terminalPath}: runner binding differs from protocol`);
  const cell = bundle.protocol.clientModelCells.find((entry) => entry.id === assignment.cellId);
  const repo = bundle.manifest.repositories.find((entry) => entry.id === assignment.repositoryId);
  if (record.bindings.clientArtifactSha256 !== cell.clientArtifactSha256 || record.bindings.adapterSha256 !== cell.adapterSha256 ||
      record.bindings.requestedModel !== cell.requestedModel ||
      record.bindings.modelIdentitySource !== cell.modelIdentitySource) {
    throw new Error(`${terminalPath}: client/model binding differs from protocol`);
  }
  if (record.bindings.baseTreeSha256 !== repo.treeSha256) throw new Error(`${terminalPath}: base tree binding mismatch`);
  if (record.bindings.preparedTreeSha256 !== repo.preparedTreeSha256) throw new Error(`${terminalPath}: prepared tree binding mismatch`);
  for (const [label, artifact] of Object.entries(record.evidence)) verifyRunArtifact(runsRoot, artifact, `${terminalPath}/${label}`);
  const events = verifyEventChain(resolveInside(runsRoot, record.evidence.events.path, `${terminalPath}/events`));
  if (!events.some((event) => event.type === 'assignment-leased')) throw new Error(`${terminalPath}: journal has no assignment lease`);
  if (record.exposure.modelRequestExposed !== events.some((event) => event.type === 'model-request-exposed')) throw new Error(`${terminalPath}: exposure does not agree with journal`);
  const visible = readJsonArtifact(runsRoot, record.evidence.visiblePipeline, `${terminalPath}/visible`);
  const preparation = readJsonArtifact(runsRoot, record.evidence.preparation, `${terminalPath}/preparation`);
  const isolation = readJsonArtifact(runsRoot, record.evidence.isolationProof, `${terminalPath}/isolation proof`);
  const functional = readJsonArtifact(runsRoot, record.evidence.functionalOracle, `${terminalPath}/functional oracle`);
  const architecture = readJsonArtifact(runsRoot, record.evidence.architectureOracle, `${terminalPath}/architecture oracle`);
  const policy = readJsonArtifact(runsRoot, record.evidence.policyDiff, `${terminalPath}/policy diff`);
  const finalTree = readJsonArtifact(runsRoot, record.evidence.finalTree, `${terminalPath}/final tree`);
  const patch = record.evidence.patch.mediaType === 'application/json'
    ? readJsonArtifact(runsRoot, record.evidence.patch, `${terminalPath}/replay patch`)
    : null;
  const transcript = readJsonArtifact(runsRoot, record.evidence.transcript, `${terminalPath}/transcript`);
  const evaluation = record.evidence.evaluation
    ? readJsonArtifact(runsRoot, record.evidence.evaluation, `${terminalPath}/blinded evaluation`)
    : null;
  const task = bundle.manifest.tasks.find((entry) => entry.id === assignment.taskId);
  const hardenedEvidenceRequired = typeof bundle.protocol.implementation.referenceVerifierSha256 === 'string';
  if (preparation.successful !== true || preparation.preparedTreeSha256 !== repo.preparedTreeSha256) throw new Error(`${terminalPath}: preparation evidence does not match frozen prepared tree`);
  if (preparation.treatmentDelta) {
    if (preparation.treatmentConfigSha256 !== sha256Json(preparation.treatmentDelta)) throw new Error(`${terminalPath}: treatment preparation self-binding mismatch`);
    if (preparation.treatmentDelta.arm !== assignment.arm || !Array.isArray(preparation.treatmentDelta.changes)) throw new Error(`${terminalPath}: treatment preparation arm or changes are invalid`);
    if (assignment.arm === 'baseline-no-bce' && preparation.treatmentDelta.changes.length !== 0) throw new Error(`${terminalPath}: baseline preparation contains treatment changes`);
    if (assignment.arm === 'bce-enabled') {
      const paths = preparation.treatmentDelta.changes.map((change) => change.path);
      if (duplicateValues(paths).length || paths.some((path) => !bundle.treatmentDelta.allowedPathPatterns.some((pattern) => globMatches(path, pattern)))) {
        throw new Error(`${terminalPath}: BCE treatment changed a duplicated or undeclared path`);
      }
      if (!paths.includes('.bce-mode.json') || !paths.includes(`.blueprints/${task.id}.blueprint.json`) ||
          !paths.some((path) => ['AGENTS.md', 'CLAUDE.md', '.cursorrules'].includes(path)) ||
          !paths.some((path) => ['.mcp.json', '.codex/config.toml', '.cursor/mcp.json'].includes(path))) {
        throw new Error(`${terminalPath}: BCE treatment omits a required mode, blueprint, agent-context, or MCP surface`);
      }
    }
  } else if (record.status === 'completed' && record.bindings.runId) throw new Error(`${terminalPath}: registered completed attempt lacks executable treatment preparation evidence`);
  if (bundle.protocol.phase === 'confirmatory' && record.status === 'completed' && evaluation === null) throw new Error(`${terminalPath}: completed confirmatory outcome lacks a blinded evaluation artifact`);
  if (evaluation === null && (functional.executed !== false || architecture.executed !== false) && bundle.protocol.phase === 'confirmatory') {
    throw new Error(`${terminalPath}: confirmatory oracle outcomes were produced outside the blinded evaluator`);
  }
  if (evaluation !== null) {
    if (evaluation.armBlind !== true || !/^[0-9a-f]{64}$/.test(evaluation.evaluationId ?? '') ||
        evaluation.resultSha256 !== sha256Json({ ...evaluation, resultSha256: null }) ||
        evaluation.neutralTreeSha256 !== finalTree.neutralTreeSha256 ||
        canonicalJson(evaluation.visible) !== canonicalJson({ nonBceAccepted: visible.nonBceAccepted, nonBceRuns: visible.nonBceRuns }) ||
        canonicalJson(evaluation.functional) !== canonicalJson(functional) || canonicalJson(evaluation.architecture) !== canonicalJson(architecture)) {
      throw new Error(`${terminalPath}: blinded evaluation does not bind the published neutral-tree outcomes`);
    }
  }
  if (patch?.format === 'bce-replay-patch/v1') {
    if (patch.schemaVersion !== '2' || !Array.isArray(patch.changes)) throw new Error(`${terminalPath}: replay patch shape is invalid`);
    const replayPaths = patch.changes.map((change) => change.path);
    if (duplicateValues(replayPaths).length || replayPaths.some((path) => typeof path !== 'string' || path.length === 0 || isAbsolute(path) || path.split(/[\\/]/).includes('..')) ||
        canonicalJson([...replayPaths].sort()) !== canonicalJson([...(finalTree.changedPaths ?? [])].sort())) {
      throw new Error(`${terminalPath}: replay patch paths are duplicated, unsafe, or differ from the final-tree inventory`);
    }
    for (const change of patch.changes) {
      const expectedOperation = change.after === null ? 'delete' : change.after?.type === 'file' ? 'write' : 'unsupported';
      if (change.operation !== expectedOperation) throw new Error(`${terminalPath}: replay operation disagrees with inventory for ${String(change.path)}`);
      if (change.operation === 'write') {
        let bytes;
        try { bytes = Buffer.from(change.contentBase64, 'base64'); }
        catch { throw new Error(`${terminalPath}: replay content is not base64 for ${String(change.path)}`); }
        if (bytes.toString('base64') !== change.contentBase64 || bytes.byteLength !== change.after.bytes || sha256Bytes(bytes) !== change.after.sha256) {
          throw new Error(`${terminalPath}: replay content does not match final inventory for ${String(change.path)}`);
        }
      } else if (change.contentBase64 !== null) throw new Error(`${terminalPath}: non-write replay operation carries content for ${String(change.path)}`);
    }
  } else if (bundle.protocol.phase === 'confirmatory' && patch?.available !== false) {
    throw new Error(`${terminalPath}: confirmatory output lacks an exact replay patch`);
  }
  if (record.bindings.treatmentConfigSha256 !== preparation.treatmentConfigSha256) throw new Error(`${terminalPath}: treatment binding differs from preparation evidence`);
  if (assignment.arm === 'baseline-no-bce' && record.bindings.treatmentConfigSha256 !== sha256Json({ arm: 'baseline-no-bce', changes: [] })) {
    throw new Error(`${terminalPath}: baseline treatment binding is not the frozen no-BCE configuration`);
  }
  if (cell.client === 'bce-ollama-tool-client') {
    if (record.mechanism.eventEvidenceAvailable === true) {
      const brokerEvidence = transcript.sealedClientEventVerification?.execBrokerControllerEvidence;
      const clientEvidence = verifyOllamaClientEvents(transcript.stdout, { cell, arm: assignment.arm, task, execBrokerEvidence: brokerEvidence });
      if (canonicalJson(record.mechanism) !== canonicalJson(clientEvidence.mechanism) ||
          transcript.sealedClientEventVerification?.passed !== true ||
          transcript.sealedClientEventVerification?.error !== null ||
          transcript.sealedClientEventVerification?.execBrokerError !== null ||
          transcript.sealedClientEventVerification?.eventChainHeadSha256 !== clientEvidence.eventChainHeadSha256) {
        throw new Error(`${terminalPath}: sealed Ollama mechanism evidence does not rederive from the client event chain`);
      }
    } else if (record.status !== 'infrastructure-error' || transcript.sealedClientEventVerification?.passed !== false ||
        typeof transcript.sealedClientEventVerification?.error !== 'string') {
      throw new Error(`${terminalPath}: unavailable sealed Ollama event evidence is not an explicit infrastructure failure`);
    }
  }
  if (isolation.driver !== bundle.protocol.isolation.executionDriver || isolation.driverSha256 !== bundle.protocol.isolation.executionDriverSha256 || isolation.oracleReadDenied !== true || isolation.protectedWriteDenied !== true || isolation.clientExecutableStagedSha256 !== cell.clientArtifactSha256 ||
      (bundle.protocol.isolation.clientSandboxMode !== undefined && isolation.clientSandboxMode !== bundle.protocol.isolation.clientSandboxMode) ||
      (bundle.protocol.isolation.runtimeExecutableStagingRequired === true && isolation.runtimeExecutableStagedSha256 !== bundle.protocol.isolation.runtimeArtifactSha256) ||
      (bundle.protocol.isolation.readDefaultDeny === true && (isolation.readDefaultDeny !== true || isolation.hostCanaryReadDenied !== true || isolation.hostCanaryWriteDenied !== true)) ||
      (bundle.protocol.isolation.positiveCapabilityProofRequired === true && (isolation.workspaceReadWriteAllowed !== true || isolation.stagedRuntimeVersionVerified !== true || isolation.stagedClientVersionVerified !== true)) ||
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
          isolation.stagedToolchainAfterExecution?.runtimeArtifactSha256 !== bundle.protocol.isolation.runtimeArtifactSha256 ||
          isolation.stagedToolchainAfterExecution?.systemPromptSha256 !== cell.toolLoop.systemPrompt.sha256 ||
          isolation.stagedToolchainAfterExecution?.commonToolContractSha256 !== cell.toolLoop.commonToolContract.sha256)) ||
      (assignment.arm === 'bce-enabled' && bundle.protocol.isolation.positiveCapabilityProofRequired === true && (isolation.mcpHandshakePassed !== true || !Array.isArray(isolation.mcpToolNames) || isolation.mcpToolNames.length === 0 || (hardenedEvidenceRequired && (isolation.mcpDoneCheckAvailable !== true || !isolation.mcpToolNames.includes('run_gate'))))) ||
      (cell.localProvider && (isolation.authenticationAbsent !== true || isolation.providerReachable !== true || isolation.externalNetworkDenied !== true || isolation.nonProviderLoopbackDenied !== true ||
        !localProviderProofMatches(isolation.providerIdentityBefore, cell.localProvider) || !localProviderProofWellFormed(isolation.providerIdentityAfter, cell.localProvider) ||
        (record.status === 'completed' && (isolation.providerIdentityStable !== true || !localProviderProofMatches(isolation.providerIdentityAfter, cell.localProvider, { requireActiveModel: true }) || isolation.providerIdentityBefore.responseSha256 !== isolation.providerIdentityAfter.responseSha256)) ||
        (isolation.providerIdentityStable !== true && record.status !== 'infrastructure-error'))) ||
      (cell.client === 'codex' && isolation.clientSessionObserved === true && (isolation.credentialRetiredBeforeModelToolExecution !== true || isolation.modelToolExecutionObservedBeforeCredentialRetirement !== false)) ||
      (cell.client === 'codex' && record.status === 'completed' && isolation.clientSessionObserved !== true)) {
    throw new Error(`${terminalPath}: OS isolation proof does not match the frozen driver or did not deny oracle reads and protected writes`);
  }
  if (hardenedEvidenceRequired && assignment.arm === 'bce-enabled') {
    const gateMissingAfterFailure = visible.bceRun == null && record.status !== 'completed' && typeof visible.failure === 'string';
    if (!gateMissingAfterFailure && (canonicalJson(visible.bceRun?.command) !== canonicalJson(['bce', 'gate']) || typeof visible.bceRun?.exitCode !== 'number' || visible.bceGateAccepted !== (visible.bceRun.exitCode === 0))) {
      throw new Error(`${terminalPath}: BCE arm lacks the exact controller-run visible gate evidence`);
    }
  } else if (hardenedEvidenceRequired && ((visible.bceRun ?? null) !== null || visible.bceGateAccepted !== null)) {
    throw new Error(`${terminalPath}: baseline arm contains BCE gate evidence`);
  }
  if (functional.deterministic !== true || architecture.deterministic !== true) throw new Error(`${terminalPath}: hidden oracles were not repeat-deterministic`);
  for (const [label, oracle] of [['functional', functional], ['architecture', architecture]]) {
    if (oracle.executed === true && (!Array.isArray(oracle.runs) || oracle.runs.length !== 2 || oracle.runs.some((run) =>
      run.isolationProof?.driver !== bundle.protocol.isolation.executionDriver ||
      run.isolationProof?.driverSha256 !== bundle.protocol.isolation.executionDriverSha256 ||
      run.isolationProof?.controllerReadDenied !== true || run.isolationProof?.networkDenied !== true))) {
      throw new Error(`${terminalPath}: ${label} oracle lacks two successful filesystem/network isolation proofs`);
    }
  }
  const withinTime = record.telemetry.endToEndVisibleMs !== null && record.telemetry.endToEndVisibleMs <= task.budget.timeoutMs;
  const withinTurns = record.telemetry.agentTurns !== null && record.telemetry.agentTurns <= task.budget.maxTurns;
  const withinCost = task.budget.maxCostUsd === null || (record.telemetry.costUsd !== null && record.telemetry.costUsd <= task.budget.maxCostUsd);
  const triStatePolicy = record.schemaVersion === '3';
  const policyAssessmentComplete = triStatePolicy ? policy.assessmentComplete === true : true;
  const policyMutationObserved = triStatePolicy ? policy.mutationObserved === true : policy.mutation === true;
  const policyFailClosedForOutcome = triStatePolicy ? policy.failClosedForOutcome === true : policyMutationObserved;
  if (triStatePolicy && (
    typeof policy.assessmentComplete !== 'boolean' || typeof policy.mutationObserved !== 'boolean' || typeof policy.failClosedForOutcome !== 'boolean' ||
    policy.mutation !== policy.mutationObserved || policy.failClosedForOutcome !== (!policy.assessmentComplete || policy.mutationObserved)
  )) {
    throw new Error(`${terminalPath}: policy tri-state is incomplete or internally inconsistent`);
  }
  const expected = {
    modelIdentityVerified: record.bindings.resolvedModel === cell.resolvedModel && ['provider-response', 'synthetic-response'].includes(cell.modelIdentityEvidence),
    nonBcePipelineAccepted: visible.nonBceAccepted === true,
    bceGateAccepted: assignment.arm === 'bce-enabled' ? visible.bceGateAccepted === true : null,
    visiblePipelineAccepted: visible.accepted === true,
    hiddenFunctionalPassed: functional.passed === true,
    independentArchitecturePassed: architecture.passed === true,
    policyMutation: policyMutationObserved,
    withinBudget: withinTime && withinTurns && withinCost,
  };
  if (triStatePolicy) Object.assign(expected, { policyAssessmentComplete, policyMutationObserved, policyFailClosedForOutcome });
  const visibleShouldAccept = expected.nonBcePipelineAccepted && (assignment.arm === 'baseline-no-bce' || expected.bceGateAccepted === true);
  if (expected.visiblePipelineAccepted !== visibleShouldAccept) throw new Error(`${terminalPath}: visible pipeline aggregate disagrees with its non-BCE/BCE components`);
  expected.safeSuccessfulCompletion = record.status === 'completed' && expected.modelIdentityVerified && expected.visiblePipelineAccepted && expected.hiddenFunctionalPassed && expected.independentArchitecturePassed && !policyFailClosedForOutcome && expected.withinBudget;
  expected.escapedDefect = expected.visiblePipelineAccepted && !expected.independentArchitecturePassed;
  expected.productiveBlock = assignment.arm === 'bce-enabled' && expected.nonBcePipelineAccepted && expected.bceGateAccepted === false && (!expected.independentArchitecturePassed || expected.policyMutation);
  expected.falseBlock = assignment.arm === 'bce-enabled' && expected.nonBcePipelineAccepted && expected.bceGateAccepted === false && policyAssessmentComplete && expected.hiddenFunctionalPassed && expected.independentArchitecturePassed && !expected.policyMutation;
  expected.collateralRegression = functional.collateralRegression === true;
  if (canonicalJson(record.derived) !== canonicalJson(expected)) throw new Error(`${terminalPath}: derived outcomes are not reproducible from controller/oracle evidence`);
  for (const metric of ['latencyMs', 'nonBcePipelineMs', 'bceGateMs', 'endToEndVisibleMs', 'oracleMs', 'agentTurns', 'inputTokens', 'outputTokens', 'cachedTokens', 'costUsd']) {
    if (record.telemetry[metric] === null && typeof record.telemetry.missingReasons[metric] !== 'string') throw new Error(`${terminalPath}: null ${metric} lacks a reason`);
    if (record.telemetry[metric] !== null && Object.hasOwn(record.telemetry.missingReasons, metric)) throw new Error(`${terminalPath}: observed ${metric} also claims missingness`);
  }
  return record;
}

export function loadVerifiedRecords(bundleDir, runsDir, { verifyHostArtifacts = true } = {}) {
  const bundle = verifyBundle(bundleDir, { requireSealed: true, verifyHostArtifacts });
  if (!bundle.ok) throw new Error(`bundle verification refused:\n${bundle.refusals.map((item) => `- ${item}`).join('\n')}`);
  const runsRoot = resolve(runsDir);
  const terminalFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name === 'terminal.json') terminalFiles.push(path);
    }
  };
  walk(runsRoot);
  const records = terminalFiles.map((path) => verifyTerminalRecord(JSON.parse(readFileSync(path, 'utf8')), {
    bundle,
    runsRoot,
    terminalPath: posixRelative(runsRoot, path),
  }));
  const primary = records.filter((record) => record.primaryAttempt);
  const ids = primary.map((record) => record.trialId);
  const duplicates = duplicateValues(ids);
  if (duplicates.length) throw new Error(`duplicate primary terminal records: ${duplicates.join(', ')}`);
  const expectedIds = new Set(bundle.manifest.assignments.map((row) => row.trialId));
  const actualIds = new Set(ids);
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  const extra = [...actualIds].filter((id) => !expectedIds.has(id));
  if (missing.length || extra.length) throw new Error(`denominator mismatch: ${missing.length} missing, ${extra.length} extra`);
  const ledgerPath = resolve(runsRoot, 'ledger.jsonl');
  const ledgerLines = readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  let previousEntrySha256 = null;
  const ledger = ledgerLines.map((line, index) => {
    const entry = JSON.parse(line);
    if (entry.sequence !== index) throw new Error(`trial ledger line ${index + 1}: non-contiguous sequence`);
    const sealedAssignment = bundle.manifest.assignments[index];
    if (!sealedAssignment || entry.trialId !== sealedAssignment.trialId || entry.orderIndex !== sealedAssignment.orderIndex) {
      throw new Error(`trial ledger line ${index + 1}: execution differs from frozen global assignment order`);
    }
    if (entry.previousEntrySha256 !== previousEntrySha256) throw new Error(`trial ledger line ${index + 1}: predecessor mismatch`);
    const expected = sha256Json({ ...entry, entrySha256: null });
    if (entry.entrySha256 !== expected) throw new Error(`trial ledger line ${index + 1}: digest mismatch`);
    previousEntrySha256 = entry.entrySha256;
    return entry;
  });
  if (ledger.length !== primary.length) throw new Error(`trial ledger/terminal mismatch: ${ledger.length} ledger entries, ${primary.length} primary records`);
  const registeredLedger = ledger.some((entry) => entry.runId !== undefined && entry.runId !== null);
  if (registeredLedger) {
    const registration = verifyRunRegistration(runsRoot, bundle);
    if (ledger.some((entry) => entry.schemaVersion !== '2' || entry.runId !== registration.runId)) {
      throw new Error('trial ledger mixes registered and legacy entries');
    }
    const checkpointPath = resolve(runsRoot, 'checkpoints.jsonl');
    const checkpoints = readFileSync(checkpointPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (checkpoints.length !== ledger.length) throw new Error('checkpoint/ledger denominator mismatch');
    let previousCheckpointSha256 = null;
    for (let index = 0; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index];
      if (checkpoint.schemaVersion !== '1' || checkpoint.runId !== registration.runId || checkpoint.sequence !== index ||
          checkpoint.committedTrials !== index + 1 || checkpoint.ledgerHeadSha256 !== ledger[index].entrySha256 ||
          checkpoint.terminalRecordSha256 !== ledger[index].recordSha256 || checkpoint.previousCheckpointSha256 !== previousCheckpointSha256 ||
          checkpoint.checkpointSha256 !== sha256Json({ ...checkpoint, checkpointSha256: null })) {
        throw new Error(`checkpoint ${index} does not bind the registered ledger prefix`);
      }
      previousCheckpointSha256 = checkpoint.checkpointSha256;
    }
  }
  const ledgerByTrial = new Map(ledger.map((entry) => [entry.trialId, entry]));
  for (const record of primary) {
    const entry = ledgerByTrial.get(record.trialId);
    if (!entry || entry.attemptId !== record.attemptId || entry.recordSha256 !== record.recordSha256) {
      throw new Error(`${record.trialId}: terminal record is absent from or differs from the append-only trial ledger`);
    }
  }
  return { bundle, records: primary.sort((a, b) => a.assignment.orderIndex - b.assignment.orderIndex) };
}

export function makeEvent(previousEventSha256, sequence, source, type, payload, monotonicMs = sequence) {
  const event = {
    schemaVersion: '1',
    sequence,
    source,
    type,
    timestamp: new Date(sequence * 1000).toISOString(),
    monotonicMs,
    previousEventSha256,
    payload,
    eventSha256: null,
  };
  event.eventSha256 = sha256Json(event);
  return event;
}

export function runArtifact(path, runsRoot, mediaType, redaction = 'none', sensitivity = 'public') {
  const bytes = readFileSync(path);
  return {
    path: posixRelative(runsRoot, path),
    sha256: sha256Bytes(bytes),
    bytes: bytes.byteLength,
    mediaType,
    redaction,
    sensitivity,
  };
}
