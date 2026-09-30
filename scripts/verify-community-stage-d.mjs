#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loadCommunityStageD } from './lib/community-stage-d.mjs';

if (process.argv.length !== 2) {
  process.stderr.write('usage: npm run evidence:stage-d:verify\n');
  process.exit(2);
}

try {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const record = loadCommunityStageD(root);
  process.stdout.write(
    `community-stage-d-record: RECORD_VALID (author-reported ${record.matrix.map((cell) => `${cell.cell}=${cell.verdict}`).join(', ')}; ` +
    `${record.attempts[1].returnedEvidenceChecksums} checksum assertions; ` +
    'raw evidence withheld; independent-witness contribution=false)\n',
  );
} catch (error) {
  process.stderr.write(`community-stage-d: REFUSED — ${error.message}\n`);
  process.exit(2);
}
