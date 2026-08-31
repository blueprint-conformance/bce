#!/usr/bin/env node
/**
 * check-release-citation.mjs — the citation-metadata release gate.
 *
 * Zero dependencies, one job: refuse a release while CITATION.cff still carries
 * a placeholder identifier. CITATION.cff ships with explicit ARXIV-ID-PENDING /
 * DOI-PENDING tokens until the paper is posted and the artifact archive is
 * deposited; this script is the fail-closed wall that keeps a v* tag from ever
 * publishing those placeholders as if they were real citation metadata.
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

const PLACEHOLDER_TOKENS = ['ARXIV-ID-PENDING', 'DOI-PENDING'];

let text;
try {
  text = readFileSync(cffPath, 'utf8');
} catch {
  console.error(
    `citation gate: FAIL — ${path.relative(repoRoot, cffPath)} is missing or unreadable.\n` +
      'A release must carry citation metadata. Restore CITATION.cff (with real, non-placeholder\n' +
      'identifiers) before tagging.'
  );
  process.exit(1);
}

const found = PLACEHOLDER_TOKENS.filter((token) => text.includes(token));

if (found.length > 0) {
  console.error(
    `citation gate: FAIL — CITATION.cff still contains placeholder token(s): ${found.join(', ')}.\n` +
      'Replace them with the real arXiv identifier and DOI before tagging a release.\n' +
      'This gate exists so a tag can never publish placeholder citation metadata; there is no skip flag.'
  );
  process.exit(1);
}

console.log('citation gate: PASS — CITATION.cff present, no placeholder tokens.');
