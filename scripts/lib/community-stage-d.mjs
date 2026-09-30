import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const COMMUNITY_STAGE_D_RECORD = 'evidence/community-stage-d/record.json';

const SHA256 = /^[a-f0-9]{64}$/;
const EXPECTED_MATRIX = [
  ['A', 'PASS', 0, 100, 'zero findings'],
  ['B', 'FAIL', 1, 60, 'one critical closure violation'],
  ['C', 'INDETERMINATE', 2, null, 'one opacity refusal'],
  ['D', 'VALID', 0, null, 'integrity verified; authenticity not established'],
];
const EXPECTED_ESTABLISHED = [
  'The separate oracle reported a match with the recorded A-D outcome matrix from one fresh-context collection.',
  'The author reports that all 347 returned-evidence checksums passed.',
  'The author reports that each A-D replicate pair was byte-identical.',
];
const EXPECTED_LIMITS = [
  'external-human adoption',
  'independent community replication',
  'cross-platform portability',
  'source origin authenticity',
  'installed or deployed state',
  'production behavior',
  'ecosystem generality',
  'security',
  'performance',
  'causal product efficacy',
];

function refuse(message) {
  throw new Error(`community-stage-d: ${message}`);
}

export function loadCommunityStageD(root) {
  let record;
  try {
    record = JSON.parse(readFileSync(join(root, COMMUNITY_STAGE_D_RECORD), 'utf8'));
  } catch (error) {
    refuse(`record is unreadable: ${error.message}`);
  }

  if (record.schemaVersion !== 1 || record.kind !== 'BceCommunityStageDReplayRecord' ||
      record.experimentId !== 'bce-community-stage-d-author-reported-replay-2026-09-29') {
    refuse('record identity is unsupported');
  }
  if (record.classification !== 'author-controlled-fresh-context-replay') {
    refuse('classification must remain author-controlled-fresh-context-replay');
  }
  if (record.subject?.tool !== 'bce-engine@0.5.0') refuse('subject must remain bce-engine@0.5.0');
  if (record.subject?.sourceVisibility !== 'non-public') refuse('subject source visibility must remain non-public');
  if (Object.hasOwn(record.subject, 'sourceArchiveSha256')) refuse('non-public source fingerprint must not be published');
  if (record.protocol?.participant !== 'fresh-context Codex agent' ||
      record.protocol?.participantReceivedOracle !== false) {
    refuse('participant identity or oracle separation changed');
  }
  if (record.protocol?.collectorInvocationsForResult !== 1) refuse('result must bind exactly one collector invocation');
  if (record.protocol?.attestationStrength !== 'process-attestation-only') {
    refuse('execution chronology must remain labeled process-attestation-only');
  }
  if (record.protocol?.replicatePairs !== 4 || record.protocol?.executionsPerCell !== 1 ||
      record.protocol?.networkRequired !== false || record.protocol?.credentialsRequired !== false ||
      record.protocol?.collectionDate !== '2026-09-29' ||
      record.protocol?.collectorCommand !== 'shasum -a 256 -c SHA256SUMS && bash run-stage-d.sh') {
    refuse('protocol scope, prerequisites, or producing command changed');
  }

  if (!Array.isArray(record.attempts) || record.attempts.length !== 2 ||
      record.attempts[0]?.attempt !== 1 ||
      record.attempts[0]?.outcome !== 'PREREQUISITE_FAILURE' ||
      record.attempts[0]?.nodeVersion !== 'v20.20.2' ||
      record.attempts[0]?.collectorExitCode !== 1 ||
      record.attempts[0]?.resultsCreated !== false ||
      record.attempts[0]?.reason !== 'Node 22+ required' ||
      record.attempts[0]?.rawStderrRetained !== false ||
      record.attempts[1]?.attempt !== 2 ||
      record.attempts[1]?.outcome !== 'MATRIX_MATCHED' ||
      record.attempts[1]?.nodeVersion !== 'v22.22.2' ||
      record.attempts[1]?.collectorExitCode !== 0 ||
      record.attempts[1]?.resultsCreated !== true ||
      record.attempts[1]?.returnedEvidenceChecksums !== 347 ||
      record.attempts[1]?.allReturnedEvidenceChecksumsPassed !== true) {
    refuse('attempt chronology is incomplete or widened');
  }

  if (!Array.isArray(record.matrix) || record.matrix.length !== EXPECTED_MATRIX.length) {
    refuse('matrix must carry exactly A-D');
  }
  for (let index = 0; index < EXPECTED_MATRIX.length; index += 1) {
    const cell = record.matrix[index];
    const expected = EXPECTED_MATRIX[index];
    const observed = [cell?.cell, cell?.verdict, cell?.exitCode, cell?.score, cell?.finding];
    if (JSON.stringify(observed) !== JSON.stringify(expected)) {
      refuse(`matrix cell ${expected[0]} does not match the bounded record`);
    }
  }
  if (record.replicatesByteIdentical !== true ||
      record.reportedOracleVerdict !== 'REPRODUCED' ||
      record.sourceDelta !== 'one declared-stack lockfile mutation in B') {
    refuse('replicate or source-delta boundary changed');
  }

  const hashes = [
    record.subject?.toolTarballSha256,
    record.integrity?.participantArchiveSha256,
    record.integrity?.resultsManifestSha256,
    record.integrity?.resultsChecksumsSha256,
    record.integrity?.resultsArchiveSha256,
    record.integrity?.oracleVerdictSha256,
  ];
  if (!hashes.every((hash) => SHA256.test(hash ?? ''))) refuse('one or more integrity anchors are not SHA-256 values');
  if (record.integrity?.rawArchivePublished !== false) refuse('raw archive must not be presented as public');
  if (record.integrity?.rawArchiveReason !==
      'The sealed archive contains non-public subject source; this public record carries hash commitments and the bounded outcome only.') {
    refuse('raw-archive publication boundary changed');
  }
  if (record.claimBoundary?.independentWitnessLedgerContribution !== false) {
    refuse('author-controlled replay cannot increment the independent-witness ledger');
  }

  if (JSON.stringify(record.claimBoundary?.established) !== JSON.stringify(EXPECTED_ESTABLISHED) ||
      JSON.stringify(record.claimBoundary?.notEstablished) !== JSON.stringify(EXPECTED_LIMITS)) {
    refuse('public claim boundary differs from the exact bounded record');
  }
  return record;
}

export function readIndependentWitnessCount(root) {
  const ledger = readFileSync(join(root, 'ATTESTATIONS.md'), 'utf8');
  const match = /^>\s*\*\*Count:\s*(\d+)\.\*\*/m.exec(ledger);
  if (!match) refuse('ATTESTATIONS.md does not carry a readable independent-witness count');
  return Number(match[1]);
}

export function communityStageDMarkdown(record, independentWitnessCount) {
  const cell = Object.fromEntries(record.matrix.map((entry) => [entry.cell, entry]));
  const matrixCell = (entry) =>
    `**Author-reported ${entry.verdict}** — exit ${entry.exitCode}${entry.score === null ? '' : `, score ${entry.score}`}; ${entry.finding}`;
  const attempts = record.attempts.map((attempt) =>
    `| ${attempt.attempt} | \`${attempt.nodeVersion}\` | ${attempt.outcome} | ${attempt.resultsCreated ? 'yes' : 'no'} |`,
  ).join('\n');
  const established = record.claimBoundary.established.map((claim) => `- ${claim}`).join('\n');
  const notEstablished = record.claimBoundary.notEstablished.map((claim) => `- ${claim}.`).join('\n');

  return `# Stage D: an author-reported declared-stack replay

> **Recorded outcome: MATRIX_MATCHED.** The author records that a fresh-context agent received a
> sealed participant kit without the oracle, collected every cell once on Node 22, and that the
> separate oracle returned \`REPRODUCED\`. The raw evidence is withheld, so a public reader can
> validate this record's consistency but cannot independently replay or verify that outcome.

## The A–D evidence rail

| A — untouched closure | B — coherent nested seed | C — opaque aliases | D — detached bundle |
| --- | --- | --- | --- |
| ${matrixCell(cell.A)} | ${matrixCell(cell.B)} | ${matrixCell(cell.C)} | ${matrixCell(cell.D)} |

The author reports that every A–D replicate pair was byte-identical. The recorded experimental
delta was one declared-stack lockfile mutation in B.

## What happened

| Attempt | Runtime | Outcome | Results created |
| ---: | --- | --- | :---: |
${attempts}

Attempt 1 verified the archive and then failed closed because Node 20 did not satisfy the Node 22+
prerequisite. It was retained as a prerequisite failure. Attempt 2 ran the collector once, returned
an unscored result. The author reports that all 347 returned-evidence checksums passed before the
separate oracle scored it.

## What this record reports

${established}

## What remains unestablished

${notEstablished}

The public independent-witness ledger currently records **${independentWitnessCount}**. This run
does not contribute to that count. Oracle non-disclosure, the single invocation, and execution
chronology are process attestations; this run has no signed transcript or append-only invocation
log. Attempt 1 retains its structured summary, but not its original raw stderr.

## Verify the public record

From a clean checkout:

\`\`\`sh
npm ci --ignore-scripts
npm run evidence:stage-d:verify
\`\`\`

[Download the machine-readable public record](${COMMUNITY_STAGE_D_RECORD}). The verifier returns
\`RECORD_VALID\` only when the exact author-reported matrix, attempt chronology, producing command,
hash-commitment shapes, and claim boundary are present. It does not verify the withheld evidence,
rerun the private subject, or make the process attestations cryptographic.

## Integrity anchors

| Withheld artifact commitment | Author-reported SHA-256 |
| --- | --- |
| BCE 0.5.0 package | \`${record.subject.toolTarballSha256}\` |
| Sealed participant kit | \`${record.integrity.participantArchiveSha256}\` |
| Returned results manifest | \`${record.integrity.resultsManifestSha256}\` |
| Returned checksum manifest | \`${record.integrity.resultsChecksumsSha256}\` |
| Results archive | \`${record.integrity.resultsArchiveSha256}\` |
| Oracle verdict | \`${record.integrity.oracleVerdictSha256}\` |

The raw archives are not public because the sealed subject contains non-public source. Their hashes
are author-reported commitments, not proof that a visitor can independently inspect or verify the
withheld bytes.
`;
}
