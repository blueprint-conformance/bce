#!/usr/bin/env node
/**
 * Cross-OS golden-byte-identity proof for the stack plane (WO-BSTACK-03, SO-01 T-01).
 *
 * `bce stack snapshot --no-pin` over the committed, revision-free fixture tree
 * `fixtures/stack/a949557-tree/` must reproduce `fixtures/stack/a949557.stack.json` byte for byte
 * on ubuntu-latest, macos-latest AND windows-latest — except the two fields the format itself
 * quarantines out of the digest: `ctRepoRevision` (this fixture tree carries no `.git`, so
 * `--no-pin` records `"unpinned"` where the golden's own `--ref` extraction recorded the real
 * revision) and `manifestDigest` (which hashes `ctRepoRevision` along with everything else, so it
 * necessarily moves in lockstep with it). Everything the digest actually covers — nodes, runtime,
 * images, unmodeled — plus the un-hashed `coverage`/`sources` lists, must be IDENTICAL across all
 * three runners: the golden was generated once, on one OS; this proof is what turns "the other two
 * reproduce it" from a council prediction into a running fact (see ROADMAP.md's stack-plane
 * [DESIGN] -> [RUNS] note and docs/pin-ceremony.md's determinism framing).
 *
 * Comparing ONLY `stackDigest` would be necessary but not sufficient: `stackDigest` is computed
 * over a canonicalized, semver-lite VIEW of the manifest (`stackHashedView` in
 * src/stack/stack-manifest.ts), so it would stay equal even if a CRLF/binary-read regression
 * corrupted a raw source-file hash recorded under `sources[]` — that field feeds `manifestDigest`,
 * never `stackDigest`. Diffing the WHOLE manifest (minus exactly the two quarantined fields) closes
 * that gap: a divergence anywhere is caught even when it happens not to move the hashed view.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const FIXTURE_TREE = join(ROOT, 'fixtures', 'stack', 'a949557-tree');
const GOLDEN_PATH = join(ROOT, 'fixtures', 'stack', 'a949557.stack.json');
const CLI = join(ROOT, 'dist', 'cli.js');

const tmp = mkdtempSync(join(tmpdir(), 'bce-stack-cross-os-'));
const outPath = join(tmp, 'a949557.stack.json');

execFileSync(
  process.execPath,
  [CLI, 'stack', 'snapshot', '--ct-repo', FIXTURE_TREE, '--no-pin', '--out', outPath],
  { stdio: 'inherit' },
);

const got = JSON.parse(readFileSync(outPath, 'utf8'));
const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

// The only two fields the format quarantines from the digest, and which legitimately differ
// between an unpinned tree read (no git identity available) and a pinned `--ref` extraction.
const QUARANTINED = new Set(['ctRepoRevision', 'manifestDigest']);
const withoutQuarantined = (manifest) => Object.fromEntries(Object.entries(manifest).filter(([k]) => !QUARANTINED.has(k)));

assert.deepStrictEqual(
  withoutQuarantined(got),
  withoutQuarantined(golden),
  `stack manifest diverged from the golden on ${process.platform} outside the two quarantined ` +
    'fields (ctRepoRevision, manifestDigest) — a CRLF/binary-read or platform-specific extraction regression',
);
assert.equal(got.stackDigest, golden.stackDigest, `stackDigest diverged on ${process.platform}`);
assert.equal(got.stackId, golden.stackId, `stackId diverged on ${process.platform}`);

console.log(`Stack manifest cross-OS golden-byte-identity: PROVEN on ${process.platform} (${got.stackDigest}).`);
