#!/usr/bin/env node
// check-ship-blockers.mjs — refuse to ship a tree that still carries an
// unreplaced launch placeholder.
//
// WHY THIS EXISTS
// ---------------
// The post-publish flip (docs/launch/public-flip-checklist.md) is staged as one
// reviewed commit whose arXiv-id and DOI fields cannot be filled until those
// identifiers exist. Any such placeholder is, by construction, a value that is
// WRONG at the moment it is published — a reader following a `DOI_PENDING` link
// gets a 404 on the page a launch post sent them to.
//
// The failure mode this closes is SILENT SURVIVAL: a placeholder that nobody
// notices, because nothing looks broken. The tree builds, the tests pass, the
// badge is green, and the only symptom is a dead link on a public page. That is
// the same shape as a guard that cannot fail — the absence of a complaint reads
// as a pass.
//
// So the token is deliberately UGLY and SELF-DESCRIBING: `_DO_NOT_SHIP` is not a
// value anyone mistakes for real content in review, and it cannot be confused
// with prose. A neutral token (`TBD`, `XXX`, `PENDING`) is exactly the kind that
// survives, because it reads as a note rather than as a blocker.
//
// SCOPE: git-tracked files only. Untracked scratch files and node_modules are a
// developer's own business; this gate is about what SHIPS.
//
// EXIT CODES
//   0  no ship-blockers present
//   1  at least one ship-blocker found (or the scan could not run — fail CLOSED)
//
// There is deliberately no --skip / --force flag. A gate that can be waived by
// the person in a hurry is not a gate (rule 02 §"Security is a Ratchet": a check
// may tighten, never silently relax).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The token family. Any token ENDING in this marker is a ship-blocker, so a new
// placeholder (e.g. ZENODO_URL_PENDING_DO_NOT_SHIP) is caught automatically
// without editing this list — the guard widens by default rather than needing to
// be taught about each new one.
const MARKER = '_DO_NOT_SHIP';

// This file necessarily CONTAINS the marker (in prose and in the constant above),
// and so does the checklist that documents the flip. Excluding them by exact path
// is safe; excluding by pattern would let a real blocker hide behind a similar
// name.
const SELF_EXEMPT = new Set([
  'scripts/check-ship-blockers.mjs',
  'scripts/check-ship-blockers.selftest.mjs',
  'docs/launch/public-flip-checklist.md',
]);

const repoRoot = path.resolve(process.argv[2] ?? '.');

let tracked;
try {
  tracked = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
} catch (err) {
  // Fail CLOSED. "I could not look" is not "there is nothing there" — reporting
  // clean here would be the precise defect this file exists to prevent.
  console.error(`ship-blockers: FAILED — could not enumerate tracked files (${err.message})`);
  process.exit(1);
}

if (tracked.length === 0) {
  console.error('ship-blockers: FAILED — git reported ZERO tracked files, which cannot be right; refusing to report clean');
  process.exit(1);
}

const hits = [];
let scanned = 0;

for (const rel of tracked) {
  if (SELF_EXEMPT.has(rel)) continue;
  let text;
  try {
    text = readFileSync(path.join(repoRoot, rel), 'utf8');
  } catch {
    continue; // binary, symlink, or deleted-but-tracked — not a text placeholder
  }
  scanned += 1;
  if (!text.includes(MARKER)) continue;
  text.split('\n').forEach((line, i) => {
    if (line.includes(MARKER)) {
      hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}

if (hits.length > 0) {
  console.error(`ship-blockers: REFUSED — ${hits.length} unreplaced placeholder(s) across ${scanned} tracked text file(s)\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.text}`);
  }
  console.error('\nThese are placeholders that are WRONG the moment they are published.');
  console.error('Replace every one with the real value (arXiv id, DOI, URL) before the public flip.');
  console.error('See docs/launch/public-flip-checklist.md for the ordering constraint.');
  process.exit(1);
}

console.log(`ship-blockers: clean — no ${MARKER} tokens in ${scanned} tracked text file(s)`);
process.exit(0);
