#!/usr/bin/env node
// Rewrite npm-shrinkwrap.json in place to its production-only publish form (see
// scripts/lib/publish-shrinkwrap.mjs). Release and rehearsal workflows run this on
// their ephemeral checkout after `npm ci` and before `npm pack`; locally, use
// withPublishShrinkwrap() so the repository's full lock is restored.
//
//   node scripts/publish-shrinkwrap.mjs --write     prune the dev entries
//   node scripts/publish-shrinkwrap.mjs --check     exit 1 while any dev entry remains
import { readFileSync, writeFileSync } from 'node:fs';
import { SHRINKWRAP, devEntries, publishShrinkwrap } from './lib/publish-shrinkwrap.mjs';

const mode = process.argv[2];
const text = readFileSync(SHRINKWRAP, 'utf8');
if (mode === '--write') {
  const before = devEntries(JSON.parse(text)).length;
  writeFileSync(SHRINKWRAP, publishShrinkwrap(text));
  process.stdout.write(`publish-shrinkwrap: removed ${before} development entries from ${SHRINKWRAP}\n`);
} else if (mode === '--check') {
  const remaining = devEntries(JSON.parse(text));
  if (remaining.length > 0) {
    process.stderr.write(`publish-shrinkwrap: FAIL — ${remaining.length} development entries would reach consumers (first: ${remaining[0]})\n`);
    process.exit(1);
  }
  process.stdout.write(`publish-shrinkwrap: PASS — ${SHRINKWRAP} names the runtime tree only\n`);
} else {
  process.stderr.write('usage: publish-shrinkwrap.mjs --write | --check\n');
  process.exit(2);
}
