#!/usr/bin/env node

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMUNITY_STAGE_D_RECORD, loadCommunityStageD } from './lib/community-stage-d.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bce-community-stage-d-'));
  const target = join(dir, COMMUNITY_STAGE_D_RECORD);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, COMMUNITY_STAGE_D_RECORD), target);
  return { dir, target };
}

function mutate(name, change, expected) {
  const { dir, target } = fixture();
  try {
    const record = JSON.parse(readFileSync(target, 'utf8'));
    change(record);
    writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`);
    let message = '';
    try {
      loadCommunityStageD(dir);
    } catch (error) {
      message = error.message;
    }
    if (!message.includes(expected)) {
      throw new Error(`${name}: expected refusal containing "${expected}", observed "${message || 'accepted'}"`);
    }
    process.stdout.write(`  PASS  ${name} — refused for its own reason\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

loadCommunityStageD(root);
process.stdout.write('community-stage-d-selftest: clean record validates\n');

mutate(
  'independent-witness reclassification',
  (record) => { record.claimBoundary.independentWitnessLedgerContribution = true; },
  'author-controlled replay cannot increment the independent-witness ledger',
);
mutate(
  'widened established claims',
  (record) => { record.claimBoundary.established.push('Independent replication established.'); },
  'public claim boundary differs from the exact bounded record',
);
mutate(
  'changed checksum count',
  (record) => { record.attempts[1].returnedEvidenceChecksums = 0; },
  'attempt chronology is incomplete or widened',
);
mutate(
  'changed runtime identity',
  (record) => { record.attempts[1].nodeVersion = 'v18.0.0'; },
  'attempt chronology is incomplete or widened',
);
mutate(
  'changed participant identity',
  (record) => { record.protocol.participant = 'maintainer'; },
  'participant identity or oracle separation changed',
);
mutate(
  'changed attempt sequence',
  (record) => { record.attempts[0].attempt = 41; },
  'attempt chronology is incomplete or widened',
);
mutate(
  'changed prerequisite reason',
  (record) => { record.attempts[0].reason = 'unrelated failure'; },
  'attempt chronology is incomplete or widened',
);
mutate(
  'false raw-archive publication',
  (record) => { record.integrity.rawArchivePublished = true; },
  'raw archive must not be presented as public',
);
mutate(
  'non-public source fingerprint disclosure',
  (record) => { record.subject.sourceArchiveSha256 = 'a'.repeat(64); },
  'non-public source fingerprint must not be published',
);

process.stdout.write('community-stage-d-selftest: PASS — all 9 planted overclaims refuse\n');
