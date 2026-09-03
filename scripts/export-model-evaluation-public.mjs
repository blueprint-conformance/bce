#!/usr/bin/env node
/** Export replayable public pilot evidence while retaining restricted transcripts by digest only. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, loadVerifiedRecords, resolveInside, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';

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
if (existsSync(output)) throw new Error(`public evidence export refuses to overwrite ${output}`);
if (output === runsRoot || output.startsWith(`${runsRoot}${sep}`)) throw new Error('public evidence must not be written inside restricted run storage');

const { bundle, records } = loadVerifiedRecords(bundleRoot, runsRoot);
const analyzer = resolve(dirname(fileURLToPath(import.meta.url)), 'analyze-model-evaluation.mjs');
const analyzed = spawnSync(process.execPath, [analyzer, '--bundle', bundleRoot, '--runs', runsRoot], {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
if (analyzed.status !== 0) throw new Error(`analysis failed before export:\n${analyzed.stderr}`);
const analysis = JSON.parse(analyzed.stdout);
if (analysis.resultSha256 !== sha256Json({ ...analysis, resultSha256: null })) throw new Error('analyzer output self-digest is invalid');

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
function write(relativePath, bytes) {
  const path = join(output, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

const publicArtifacts = new Map();
const restrictedArtifactCommitments = [];
for (const record of records) {
  for (const [label, artifact] of Object.entries(record.evidence)) {
    if (artifact.sensitivity === 'restricted') {
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
    assertPublicSafe(bytes, `${record.trialId}/${label}`);
    publicArtifacts.set(artifact.sha256, { source, artifact });
  }
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
const summary = {
  schemaVersion: '1',
  studyId: bundle.protocol.studyId,
  evidenceClass: analysis.evidenceClass,
  claimBoundary: 'instrumentation-only-development-pilot; never product-efficacy evidence and never a recommendation',
  exporterSha256,
  verifiedTrials: records.length,
  sealedInputs: {
    rootSha256: bundle.seal.rootSha256,
    publicTimestamp: bundle.seal.publicTimestamp,
    attestation: bundle.seal.attestation,
  },
  publicReplay: {
    ledgerSha256: sha256Bytes(ledgerBytes),
    ledgerHeadSha256: ledger.at(-1)?.entrySha256 ?? null,
    terminalRecordsSha256: sha256Bytes(terminalBytes),
    publicArtifactCount: publicArtifacts.size,
    publicCasPath: 'cas/sha256',
  },
  restrictedEvidence: {
    published: false,
    reason: 'model transcripts remain in access-restricted run storage; immutable digests retain integrity binding',
    commitments: restrictedArtifactCommitments.sort((left, right) => `${left.trialId}/${left.label}`.localeCompare(`${right.trialId}/${right.label}`)),
  },
  analysis,
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
