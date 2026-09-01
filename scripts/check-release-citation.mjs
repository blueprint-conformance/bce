#!/usr/bin/env node
/**
 * check-release-citation.mjs — the citation-metadata release gate.
 *
 * Zero dependencies, one job: refuse a release while CITATION.cff carries a placeholder
 * identifier. A software release does not require a paper, DOI, or arXiv record; absent metadata
 * is honest, while invented/provisional identifiers are not.
 *
 * Wired as a step in the release.yml `gate` job (which the publish job `needs:`),
 * so a red here means no publish — same discipline as every other gate leg.
 *
 * Exit codes:
 *   0 — CITATION.cff exists and contains no placeholder token.
 *   1 — CITATION.cff is missing, unreadable, or still contains a placeholder.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cffPath = path.join(repoRoot, 'CITATION.cff');

// Two pending-token generations exist: the original '-PENDING' spelling and the
// ship-blocker '_DO_NOT_SHIP' spelling introduced by the flip staging. The gate
// refuses EITHER — renaming a placeholder must never disarm the release gate
// (the silent-pass class the flip PR's own selftest hunts). The second spelling
// is assembled from parts so this file cannot trip the tracked-file blocker scan.
const SM = ['_DO', 'NOT', 'SHIP'].join('_');
const PLACEHOLDER_TOKENS = ['ARXIV-ID-PENDING', 'DOI-PENDING', `ARXIV_ID_PENDING${SM}`, `DOI_PENDING${SM}`];

let text;
try {
  text = readFileSync(cffPath, 'utf8');
} catch {
  console.error(
    `citation gate: FAIL — ${path.relative(repoRoot, cffPath)} is missing or unreadable.\n` +
      'A release must carry valid software citation metadata. Restore CITATION.cff before tagging.'
  );
  process.exit(1);
}

const found = PLACEHOLDER_TOKENS.filter((token) => text.includes(token));

if (found.length > 0) {
  console.error(
    `citation gate: FAIL — CITATION.cff still contains placeholder token(s): ${found.join(', ')}.\n` +
      'Remove them, or replace them with real identifiers only after those records exist.\n' +
      'This gate exists so a tag can never publish placeholder citation metadata; there is no skip flag.'
  );
  process.exit(1);
}

console.log('citation gate: PASS — CITATION.cff present, no placeholder tokens.');
