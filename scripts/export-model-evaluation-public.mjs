#!/usr/bin/env node
/** Export replayable public pilot evidence while retaining restricted transcripts by digest only. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, loadVerifiedRecords, resolveInside, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';
import { loadVerifiedSafetyHalt, makeSafetyHaltArchive, SAFETY_HALT_ARCHIVE_SCHEMA_PATH } from './lib/model-evaluation-halt.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = valueAfter('--bundle');
const runsDir = valueAfter('--runs');
const outDir = valueAfter('--out');
if (!bundleDir || !runsDir || !outDir) {
  process.stderr.write('usage: node scripts/export-model-evaluation-public.mjs --bundle DIR --runs DIR --out DIR\n');
  process.exit(2);
}
const bundleRoot = resolve(bundleDir);
const runsRoot = resolve(runsDir);
const output = resolve(outDir);
const exporterSha256 = sha256Bytes(readFileSync(fileURLToPath(import.meta.url)));
const publicVerifierPath = resolve(dirname(fileURLToPath(import.meta.url)), 'verify-model-evaluation-public.mjs');
const haltHelperPath = resolve(dirname(fileURLToPath(import.meta.url)), 'lib', 'model-evaluation-halt.mjs');
if (existsSync(output)) throw new Error(`public evidence export refuses to overwrite ${output}`);
if (output === runsRoot || output.startsWith(`${runsRoot}${sep}`)) throw new Error('public evidence must not be written inside restricted run storage');

const safetyHalted = existsSync(join(runsRoot, 'study-halt.json'));
const loaded = safetyHalted ? loadVerifiedSafetyHalt(bundleRoot, runsRoot) : loadVerifiedRecords(bundleRoot, runsRoot);
const { bundle, records } = loaded;
let analysis;
let archive = null;
if (safetyHalted) {
  analysis = null;
  archive = makeSafetyHaltArchive(bundle, records, loaded.halt);
} else {
  const analyzer = resolve(dirname(fileURLToPath(import.meta.url)), 'analyze-model-evaluation.mjs');
  const analyzed = spawnSync(process.execPath, [analyzer, '--bundle', bundleRoot, '--runs', runsRoot], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (analyzed.status !== 0) throw new Error(`analysis failed before export:\n${analyzed.stderr}`);
  analysis = JSON.parse(analyzed.stdout);
}
if (safetyHalted) {
  if (archive.archiveSha256 !== sha256Json({ ...archive, archiveSha256: null })) throw new Error('safety-halt archive self-digest is invalid');
} else if (analysis.resultSha256 !== sha256Json({ ...analysis, resultSha256: null })) throw new Error('analyzer output self-digest is invalid');

const forbiddenPublicPatterns = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:sk|fk)-[A-Za-z0-9_-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~-]{12,}/i,
  /"(?:accessToken|refreshToken|apiKey|token|cookie)"\s*:\s*"(?!\[REDACTED)/i,
];
function assertPublicSafe(bytes, label) {
  const text = bytes.toString('utf8');
  if (forbiddenPublicPatterns.some((pattern) => pattern.test(text))) throw new Error(`${label}: possible credential material refused from public export`);
}
function assertArtifactPublicSafe(bytes, label) {
  assertPublicSafe(bytes, label);
  let document;
  try { document = JSON.parse(bytes.toString('utf8')); } catch { return; }
  if (document?.format !== 'bce-replay-patch/v1') return;
  for (const change of document.changes ?? []) {
    if (change.operation !== 'write') continue;
    let content;
    try { content = Buffer.from(change.contentBase64, 'base64'); }
    catch { throw new Error(`${label}/${String(change.path)}: invalid replay content`); }
    if (content.toString('base64') !== change.contentBase64) throw new Error(`${label}/${String(change.path)}: non-canonical replay content`);
    assertPublicSafe(content, `${label}/${String(change.path)}`);
  }
}
function write(relativePath, bytes) {
  const path = join(output, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

const publicArtifacts = new Map();
const restrictedArtifactCommitments = [];
const withheldPublicArtifactCommitments = [];
const failureClasses = {};
function classifyRestrictedFailure(text) {
  if (/local provider identity changed or became unavailable after model execution/i.test(text)) return 'local-provider-post-run-identity-verification-failure';
  if (/EPERM: operation not permitted[\s\S]*@openai\/codex\/bin\/codex\.js/.test(text)) return 'client-artifact-read-denied-by-outer-sandbox';
  if (/auth|credential/i.test(text)) return 'client-authentication-or-credential-failure';
  if (/network|rate.?limit|overloaded/i.test(text)) return 'client-network-or-service-failure';
  return 'unclassified-client-failure';
}
for (const record of records) {
  for (const [label, artifact] of Object.entries(record.evidence)) {
    if (artifact.sensitivity === 'restricted') {
      const restrictedBytes = readFileSync(resolveInside(runsRoot, artifact.path, `${record.trialId}/${label}`));
      if (sha256Bytes(restrictedBytes) !== artifact.sha256 || restrictedBytes.byteLength !== artifact.bytes) throw new Error(`${record.trialId}/${label}: restricted artifact commitment mismatch`);
      if (label === 'transcript' && record.status !== 'completed') {
        const classification = classifyRestrictedFailure(restrictedBytes.toString('utf8'));
        failureClasses[classification] = (failureClasses[classification] ?? 0) + 1;
      }
      restrictedArtifactCommitments.push({
        trialId: record.trialId, label, sha256: artifact.sha256, bytes: artifact.bytes,
        mediaType: artifact.mediaType, redaction: artifact.redaction,
      });
      continue;
    }
    if (artifact.sensitivity !== 'public') throw new Error(`${record.trialId}/${label}: unknown sensitivity ${artifact.sensitivity}`);
    const source = resolveInside(runsRoot, artifact.path, `${record.trialId}/${label}`);
    const bytes = readFileSync(source);
    if (sha256Bytes(bytes) !== artifact.sha256 || bytes.byteLength !== artifact.bytes) throw new Error(`${record.trialId}/${label}: artifact commitment mismatch`);
    assertArtifactPublicSafe(bytes, `${record.trialId}/${label}`);
    if (/\bfile:\/\/\/Users\/[^/\s]+\/|\/Users\/[^/\s]+\//.test(bytes.toString('utf8'))) {
      withheldPublicArtifactCommitments.push({
        trialId: record.trialId,
        label,
        sha256: artifact.sha256,
        bytes: artifact.bytes,
        mediaType: artifact.mediaType,
        redaction: artifact.redaction,
        originalSensitivity: artifact.sensitivity,
        withheldReason: 'controller-host-path-present',
      });
      continue;
    }
    publicArtifacts.set(artifact.sha256, { source, artifact });
  }
}

if (bundle.protocol.phase === 'confirmatory' && withheldPublicArtifactCommitments.length > 0) {
  throw new Error('confirmatory export refuses withheld outcome evidence; sanitize paths before the claim-bearing run, never after it');
}

mkdirSync(output, { recursive: true });
for (const [digest, { source }] of [...publicArtifacts].sort(([left], [right]) => left.localeCompare(right))) {
  const target = join(output, 'cas', 'sha256', digest);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
const terminalBytes = Buffer.from(`${records.map((record) => canonicalJson(record)).join('\n')}\n`);
assertPublicSafe(terminalBytes, 'terminal record commitments');
write('terminal-records.jsonl', terminalBytes);
const ledgerBytes = readFileSync(join(runsRoot, 'ledger.jsonl'));
assertPublicSafe(ledgerBytes, 'ledger');
write('ledger.jsonl', ledgerBytes);
const ledger = ledgerBytes.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
const registeredRun = ledger.some((entry) => entry.runId !== undefined && entry.runId !== null);
const registrationBytes = registeredRun ? readFileSync(join(runsRoot, 'run-registration.json')) : null;
const checkpointBytes = registeredRun ? readFileSync(join(runsRoot, 'checkpoints.jsonl')) : null;
if (registrationBytes && checkpointBytes) {
  assertPublicSafe(registrationBytes, 'run registration');
  assertPublicSafe(checkpointBytes, 'run checkpoints');
  write('run-registration.json', registrationBytes);
  write('checkpoints.jsonl', checkpointBytes);
}
let runDisposition = { status: 'complete', plannedTrials: bundle.manifest.assignments.length, committedTrials: records.length };
if (safetyHalted) {
  assertPublicSafe(loaded.haltBytes, 'study halt');
  write('study-halt.json', loaded.haltBytes);
  runDisposition = {
    status: 'safety-halt',
    plannedTrials: bundle.manifest.assignments.length,
    committedTrials: records.length,
    unexposedTrials: bundle.manifest.assignments.length - records.length,
    haltPath: 'study-halt.json',
    haltSha256: sha256Bytes(loaded.haltBytes),
  };
}
const summary = {
  schemaVersion: '2',
  resultKind: safetyHalted ? 'safety-halt-archive' : 'complete-study-evidence',
  studyId: bundle.protocol.studyId,
  evidenceClass: safetyHalted ? archive.evidenceClass : analysis.evidenceClass,
  claimBoundary: safetyHalted
    ? 'safety-halted apparatus record only; no efficacy estimate, arm comparison, cost/latency comparison, uplift claim, or product recommendation'
    : bundle.protocol.phase === 'confirmatory'
      ? `author-operated randomized evidence for the exact sealed task population and client/model cells in ${bundle.protocol.studyId}; not independent replication, production validation, or evidence for unrun clients, models, repositories, or releases`
      : 'instrumentation-only-development-pilot; never product-efficacy evidence and never a recommendation',
  exporterSha256,
  verifiedTrials: records.length,
  runDisposition,
  sealedInputs: {
    rootSha256: bundle.seal.rootSha256,
    publicTimestamp: bundle.seal.publicTimestamp,
    attestation: bundle.seal.attestation,
    implementation: bundle.protocol.implementation,
  },
  publicReplay: {
    ledgerSha256: sha256Bytes(ledgerBytes),
    ledgerHeadSha256: ledger.at(-1)?.entrySha256 ?? null,
    terminalRecordsSha256: sha256Bytes(terminalBytes),
    runRegistrationSha256: registrationBytes ? sha256Bytes(registrationBytes) : null,
    checkpointsSha256: checkpointBytes ? sha256Bytes(checkpointBytes) : null,
    checkpointHeadSha256: checkpointBytes ? JSON.parse(checkpointBytes.toString('utf8').trim().split('\n').at(-1)).checkpointSha256 : null,
    publicArtifactCount: publicArtifacts.size,
    publicCasPath: 'cas/sha256',
  },
  restrictedEvidence: {
    published: false,
    reason: 'model transcripts remain in access-restricted run storage; immutable digests retain integrity binding',
    sanitizedFailureClasses: Object.fromEntries(Object.entries(failureClasses).sort(([left], [right]) => left.localeCompare(right))),
    commitments: restrictedArtifactCommitments.sort((left, right) => `${left.trialId}/${left.label}`.localeCompare(`${right.trialId}/${right.label}`)),
  },
  withheldPublicEvidence: {
    published: false,
    reason: 'artifacts declared public by the frozen runner were withheld because post-hoc leakage review found controller host paths; terminal commitments remain intact',
    commitments: withheldPublicArtifactCommitments.sort((left, right) => `${left.trialId}/${left.label}`.localeCompare(`${right.trialId}/${right.label}`)),
  },
  analysis,
  archive,
  archiveTooling: safetyHalted ? {
    exporterSha256,
    publicVerifierSha256: sha256Bytes(readFileSync(publicVerifierPath)),
    haltHelperSha256: sha256Bytes(readFileSync(haltHelperPath)),
    archiveSchemaSha256: sha256Bytes(readFileSync(SAFETY_HALT_ARCHIVE_SCHEMA_PATH)),
  } : null,
  resultSha256: null,
};
summary.resultSha256 = sha256Json(summary);
const summaryBytes = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`);
assertPublicSafe(summaryBytes, 'public summary');
write('summary.json', summaryBytes);
process.stdout.write(`${JSON.stringify({
  output: relative(bundleRoot, output).split(sep).join('/'),
  verifiedTrials: records.length,
  publicArtifacts: publicArtifacts.size,
  restrictedArtifacts: restrictedArtifactCommitments.length,
  resultSha256: summary.resultSha256,
})}\n`);
