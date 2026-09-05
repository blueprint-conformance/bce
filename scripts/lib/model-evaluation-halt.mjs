import Ajv from 'ajv';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  sha256Bytes,
  sha256Json,
  verifyBundle,
  verifyTerminalRecord,
} from './model-evaluation.mjs';

export const SAFETY_HALT_ARCHIVE_SCHEMA_PATH = fileURLToPath(new URL('../../research/model-evaluation/schemas/safety-halt-archive.schema.json', import.meta.url));
export const STUDY_HALT_SCHEMA_PATH = fileURLToPath(new URL('../../research/model-evaluation/schemas/study-halt.schema.json', import.meta.url));
const ajvOptions = { allErrors: true, strict: false, formats: { 'date-time': true } };
const validateArchive = new Ajv(ajvOptions).compile(JSON.parse(readFileSync(SAFETY_HALT_ARCHIVE_SCHEMA_PATH, 'utf8')));
const validateStudyHalt = new Ajv(ajvOptions).compile(JSON.parse(readFileSync(STUDY_HALT_SCHEMA_PATH, 'utf8')));

export function assertSafetyHaltArchive(archive) {
  if (!validateArchive(archive)) throw new Error(`invalid safety-halt archive: ${JSON.stringify(validateArchive.errors)}`);
}

export function assertStudyHaltV2(halt) {
  if (!validateStudyHalt(halt)) throw new Error(`invalid study safety halt: ${JSON.stringify(validateStudyHalt.errors)}`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(halt.recordedAt) ||
      !Number.isFinite(Date.parse(halt.recordedAt))) {
    throw new Error('invalid study safety halt: recordedAt is not an RFC 3339 timestamp');
  }
}

function terminalPrefixBytes(records) {
  return Buffer.from(records.map((record) => `${canonicalJson(record)}\n`).join(''));
}

export function stoppingHaltTrigger(records, protocol) {
  let consecutive = 0;
  for (const record of [...records].reverse()) {
    if (record.status === 'infrastructure-error') consecutive += 1;
    else break;
  }
  const consecutiveThreshold = protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures;
  if (consecutive >= consecutiveThreshold) {
    const record = records.at(-1);
    return {
      rule: 'consecutive-post-exposure-infrastructure-failures',
      threshold: consecutiveThreshold,
      observed: consecutive,
      firstTriggeredOrderIndex: record.assignment.orderIndex,
      trialId: record.trialId,
      cellId: record.assignment.cellId,
      reason: `stopped after ${consecutive} consecutive post-exposure infrastructure failures`,
    };
  }
  const minimum = protocol.stopping.failureRateMinimumExposed ?? 10;
  for (const cell of protocol.clientModelCells) {
    const rows = records.filter((record) => record.assignment.cellId === cell.id);
    const failures = rows.filter((record) => record.status === 'infrastructure-error').length;
    const rate = rows.length === 0 ? 0 : failures / rows.length;
    if (rows.length >= minimum && rate > protocol.stopping.abortCellWhenInfrastructureFailureRateExceeds) {
      const record = records.at(-1);
      return {
        rule: 'cell-infrastructure-failure-rate',
        threshold: protocol.stopping.abortCellWhenInfrastructureFailureRateExceeds,
        observed: rate,
        firstTriggeredOrderIndex: record.assignment.orderIndex,
        trialId: record.trialId,
        cellId: cell.id,
        reason: `${cell.id} exceeded the frozen infrastructure-failure-rate threshold`,
      };
    }
  }
  return null;
}

export function makeStudyHaltV2(bundle, records, ledgerBytes, ledger, recordedAt = new Date().toISOString()) {
  const trigger = stoppingHaltTrigger(records, bundle.protocol);
  if (!trigger || stoppingHaltTrigger(records.slice(0, -1), bundle.protocol) !== null) {
    throw new Error('study safety halt is not the first trigger on the final committed record');
  }
  const prefixBytes = terminalPrefixBytes(records);
  const schemaPath = join(bundle.root, 'schemas', 'study-halt.schema.json');
  const halt = {
    schemaVersion: '2',
    studyId: bundle.protocol.studyId,
    status: 'safety-halt',
    bindings: {
      sealRootSha256: bundle.seal.rootSha256,
      protocolSha256: sha256Bytes(readFileSync(join(bundle.root, 'protocol.v2.json'))),
      manifestSha256: sha256Bytes(readFileSync(join(bundle.root, 'task-manifest.json'))),
      runnerSha256: bundle.protocol.implementation.runnerSha256,
      studyHaltSchemaSha256: sha256Bytes(readFileSync(schemaPath)),
    },
    evidence: {
      committedTrials: records.length,
      plannedTrials: bundle.manifest.assignments.length,
      ledger: {
        path: 'ledger.jsonl',
        sha256: sha256Bytes(ledgerBytes),
        bytes: ledgerBytes.byteLength,
        headSha256: ledger.at(-1)?.entrySha256 ?? null,
      },
      terminalPrefix: {
        encoding: 'canonical-json-lines-v1',
        sha256: sha256Bytes(prefixBytes),
        records: records.length,
      },
    },
    trigger,
    recordedAt,
    haltSha256: null,
  };
  halt.haltSha256 = sha256Json(halt);
  assertStudyHaltV2(halt);
  return halt;
}

export function verifyStudyHaltV2(halt, bundle, records, ledgerBytes, ledger) {
  assertStudyHaltV2(halt);
  if (halt.haltSha256 !== sha256Json({ ...halt, haltSha256: null })) throw new Error('study safety halt self-digest mismatch');
  const expected = makeStudyHaltV2(bundle, records, ledgerBytes, ledger, halt.recordedAt);
  if (canonicalJson(halt) !== canonicalJson(expected)) throw new Error('study safety halt does not recompute from the sealed inputs and terminal prefix');
  return halt;
}

function posixRelative(root, path) {
  return relative(root, path).split(sep).join('/');
}

function walkTerminalFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = resolve(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (name === 'terminal.json') found.push(path);
    }
  };
  walk(root);
  return found;
}

export function stoppingHaltReason(records, protocol) {
  return stoppingHaltTrigger(records, protocol)?.reason ?? null;
}

export function loadVerifiedSafetyHalt(bundleDir, runsDir) {
  const bundle = verifyBundle(bundleDir, { requireSealed: true });
  if (!bundle.ok) throw new Error(`bundle verification refused:\n${bundle.refusals.map((item) => `- ${item}`).join('\n')}`);
  const runsRoot = resolve(runsDir);
  const haltPath = join(runsRoot, 'study-halt.json');
  if (!existsSync(haltPath)) throw new Error('safety-halt export requires study-halt.json');
  if (existsSync(join(runsRoot, '.controller.lock'))) throw new Error('safety-halt export refuses an active controller lock');

  const ledgerPath = join(runsRoot, 'ledger.jsonl');
  const ledgerBytes = readFileSync(ledgerPath);
  const ledger = ledgerBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (ledger.length === 0 || ledger.length >= bundle.manifest.assignments.length) throw new Error('safety-halt ledger is not a non-empty, incomplete frozen prefix');
  let previousEntrySha256 = null;
  const records = [];
  for (const [index, entry] of ledger.entries()) {
    const assignment = bundle.manifest.assignments[index];
    if (entry.sequence !== index || entry.orderIndex !== assignment.orderIndex || entry.trialId !== assignment.trialId ||
        entry.previousEntrySha256 !== previousEntrySha256 || entry.entrySha256 !== sha256Json({ ...entry, entrySha256: null })) {
      throw new Error(`trial ledger line ${index + 1}: not an intact prefix of the frozen global order`);
    }
    const terminalPath = join(runsRoot, 'trials', entry.trialId, 'a0', 'terminal.json');
    if (!existsSync(terminalPath)) throw new Error(`${entry.trialId}: ledger entry has no terminal record`);
    const record = verifyTerminalRecord(JSON.parse(readFileSync(terminalPath, 'utf8')), {
      bundle,
      runsRoot,
      terminalPath: posixRelative(runsRoot, terminalPath),
    });
    if (record.attemptId !== entry.attemptId || record.recordSha256 !== entry.recordSha256) {
      throw new Error(`${entry.trialId}: terminal record differs from its ledger commitment`);
    }
    records.push(record);
    previousEntrySha256 = entry.entrySha256;
  }
  if (records.some((record) => record.exposure.modelRequestExposed !== true)) {
    throw new Error('safety-halt prefix contains an unexposed terminal record');
  }
  const terminalFiles = walkTerminalFiles(runsRoot);
  if (terminalFiles.length !== records.length) throw new Error('terminal records exist outside the committed frozen prefix');

  const haltBytes = readFileSync(haltPath);
  const halt = JSON.parse(haltBytes.toString('utf8'));
  const expectedReason = stoppingHaltReason(records, bundle.protocol);
  if (stoppingHaltReason(records.slice(0, -1), bundle.protocol) !== null || expectedReason === null) {
    throw new Error('frozen stopping rule did not first become true on the final committed record');
  }
  if (halt.schemaVersion === '2') verifyStudyHaltV2(halt, bundle, records, ledgerBytes, ledger);
  else if (halt.schemaVersion !== '1' || halt.studyId !== bundle.protocol.studyId || halt.status !== 'safety-halt' ||
      halt.committedTrials !== records.length || halt.ledgerHeadSha256 !== previousEntrySha256 || halt.reason !== expectedReason ||
      !Number.isFinite(Date.parse(halt.recordedAt))) {
    throw new Error('study-halt.json does not rederive from the frozen stopping rule and committed ledger prefix');
  }
  return { bundle, records, ledger, ledgerBytes, halt, haltBytes };
}

export function makeSafetyHaltArchive(bundle, records, halt) {
  const statuses = {};
  for (const record of records) {
    statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  }
  const archive = {
    schemaVersion: '1',
    studyId: bundle.protocol.studyId,
    resultKind: 'safety-halt-archive',
    evidenceClass: 'author-operated-safety-halted-instrumentation-prefix',
    archiveMethod: halt.schemaVersion === '2' ? 'sealed-controller-v2' : 'post-hoc-v1-not-preregistered',
    claimEligibility: 'none',
    efficacyEstimatesProduced: false,
    verifiedTrials: records.length,
    plannedTrials: bundle.manifest.assignments.length,
    unexposedTrials: bundle.manifest.assignments.length - records.length,
    runDisposition: {
      status: 'safety-halt',
      reason: halt.schemaVersion === '2' ? halt.trigger.reason : halt.reason,
      committedTrials: halt.schemaVersion === '2' ? halt.evidence.committedTrials : halt.committedTrials,
      ledgerHeadSha256: halt.schemaVersion === '2' ? halt.evidence.ledger.headSha256 : halt.ledgerHeadSha256,
    },
    observedPrefixStatuses: Object.fromEntries(Object.entries(statuses).sort(([left], [right]) => left.localeCompare(right))),
    claimDecision: {
      decision: 'not-evaluated-safety-halted-partial-run',
      reasons: [
        'the frozen safety rule stopped the study before the randomized denominator completed',
        'the retained prefix contains post-exposure infrastructure failures',
        'pilot tasks and repositories are development-exposed',
        'no comparative, product, cost, latency, safety, default-adoption, or transportability claim is permitted',
      ],
    },
    archiveSha256: null,
  };
  archive.archiveSha256 = sha256Json(archive);
  assertSafetyHaltArchive(archive);
  return archive;
}

export function verifyPublishedSafetyHalt(summary, bundle, records, ledger, haltBytes) {
  const halt = JSON.parse(haltBytes.toString('utf8'));
  const expectedReason = stoppingHaltReason(records, bundle.protocol);
  if (stoppingHaltReason(records.slice(0, -1), bundle.protocol) !== null || expectedReason === null) {
    throw new Error('published halt did not first trigger on the final committed record');
  }
  if (halt.schemaVersion === '2') {
    const ledgerBytes = Buffer.from(ledger.map((entry) => `${JSON.stringify(entry)}\n`).join(''));
    verifyStudyHaltV2(halt, bundle, records, ledgerBytes, ledger);
  }
  const reason = halt.schemaVersion === '2' ? halt.trigger.reason : halt.reason;
  const committedTrials = halt.schemaVersion === '2' ? halt.evidence.committedTrials : halt.committedTrials;
  const ledgerHeadSha256 = halt.schemaVersion === '2' ? halt.evidence.ledger.headSha256 : halt.ledgerHeadSha256;
  if (summary.runDisposition?.status !== 'safety-halt' || summary.runDisposition.haltPath !== 'study-halt.json' ||
      summary.runDisposition.haltSha256 !== sha256Bytes(haltBytes) || halt.studyId !== bundle.protocol.studyId ||
      halt.status !== 'safety-halt' || reason !== expectedReason || committedTrials !== records.length ||
      ledgerHeadSha256 !== ledger.at(-1)?.entrySha256) {
    throw new Error('published safety halt does not bind the recomputed stopping rule and ledger prefix');
  }
  const expectedArchive = makeSafetyHaltArchive(bundle, records, halt);
  assertSafetyHaltArchive(summary.archive);
  if (summary.analysis !== null || canonicalJson(summary.archive) !== canonicalJson(expectedArchive)) {
    throw new Error('published safety-halt archive does not recompute or improperly contains efficacy analysis');
  }
}
