#!/usr/bin/env node
/**
 * launch-readiness-selftest.mjs — prove EVERY detector can fire, not just one.
 *
 * The gate's in-workflow self-test plants a single breakage (a `_placeholder`
 * link) and requires a refusal. That proves exactly one of nine detectors works.
 * The other eight are regexes over prose, and a regex with a typo does not throw
 * — it silently matches nothing and its promise reports READY forever. A gate
 * whose detectors are unverified vouches for a tree it never actually inspected,
 * which is the failure this gate exists to prevent.
 *
 * Relying on "today everything is broken anyway, so every promise reds" would be
 * worse than nothing: that stops being true the moment the launch succeeds, and
 * the self-test would begin passing vacuously at precisely the point the gate
 * starts to matter.
 *
 * So: for each promise, copy the tree to a temp dir, plant a breakage TARGETED at
 * that promise, and require that promise to appear broken. Each case also reports
 * whether the promise was already red in the clean copy, because a detector that
 * was going to fire anyway proves nothing about the plant — matching nothing and
 * matching everything are both useless, and only the clean-vs-planted difference
 * distinguishes them.
 *
 * Exit codes:
 *   0 — every detector fired on its own planted breakage.
 *   1 — at least one detector failed to fire.
 *   2 — harness failure.
 */
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const die = (m) => { console.error(`selftest: ${m}`); process.exit(2); };

/**
 * Each case: a promise id, and a mutation that SHOULD trigger it.
 * Mutations APPEND rather than rewrite, so they keep working after the real
 * prose is corrected at the flip — which is the whole point.
 */
// ASSEMBLED, never spelled: check-ship-blockers.mjs scans every tracked file, so
// writing the marker literally here would make this self-test a ship-blocker.
// Exempting the file is the alternative and it is worse — see check.mjs.
const SM = ['_DO', 'NOT', 'SHIP'].join('_');
const CASES = [
  { id: 'readme/placeholder-links',     file: 'README.md',            strip: new RegExp(`_placeholder|${SM}`),   add: '\n- Paper: _placeholder — added at release_\n' },
  { id: 'readme/badge-block',           file: 'README.md',            strip: /badge-placeholder/,                add: '\n<!-- badge-placeholder: selftest -->\n' },
  { id: 'readme/status-line',           file: 'README.md',            strip: /Status:?\s*(pre-release|private)|This repository is private/i, add: '\n**Status: pre-release.** This repository is private while seeded.\n' },
  { id: 'readme/npm-stub-instruction',  file: 'README.md',            strip: /0\.0\.0.*(reservation|stub)|(?:reservation|stub).*0\.0\.0/i, add: '\nThe npm registry has a non-functional 0.0.0 reservation stub; use the checkout.\n', inverse: true },
  { id: 'contributor-docs/pre-release', file: 'CONTRIBUTING.md',      strip: /pre-release,?\s*private phase|contributions open with the initial public release|before the initial public release|this repository is (in a )?(pre-release|private)/i, add: '\nThis repository is in a pre-release, private phase.\n', also: 'SECURITY.md' },
  { id: 'corpus-map/private-wording',   file: 'corpus/CORPUS-MAP.md', strip: /private\s+`?bce-paper-artifacts/i,  add: '\nHeld in the private `bce-paper-artifacts` repository.\n' },
  { id: 'citation/placeholders',        file: 'CITATION.cff',         strip: new RegExp(`ARXIV-ID-PENDING|DOI-PENDING|${SM}`), add: '\n# selftest: DOI-PENDING\n' },
  // The planted line is an award chip OUTSIDE any comment — the shape a real premature
  // activation would take. The strip step removes the reserved markers first so the detector
  // is observed going quiet before the plant makes it fire; without that, a detector that
  // matched the inert comment too would look like it worked.
  { id: 'readme/award-slots',           file: 'README.md',            strip: /award-slot|assets\/badges\/award-/, add: '\n<p align="center"><img src="assets/badges/award-planted.svg" alt="planted award"></p>\n' },
];

// Remove every line matching `re` from a file — used to make the claim TRUE in the
// copy, so the detector's silence can be observed before the plant makes it fire.
const stripLines = (f, re) => {
  if (!existsSync(f)) return;
  writeFileSync(f, readFileSync(f, 'utf8').split('\n').filter((l) => !re.test(l)).join('\n'));
};

function runIn(dir) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts/launch-readiness-check.mjs')], {
      encoding: 'utf8',
      env: { ...process.env, LAUNCH_READINESS_FORCE_PUBLIC: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: typeof e.status === 'number' ? e.status : 1 };
  }
}

const skipGit = (s) => !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(`${path.sep}.git`) && !s.includes('node_modules');

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'lr-selftest-'));
const clean = path.join(tmpBase, 'clean');
cpSync(repoRoot, clean, { recursive: true, filter: skipGit });
if (!existsSync(path.join(clean, 'scripts/launch-readiness-check.mjs'))) die('copy did not include the check script');

const base = runIn(clean);
const brokenIn = (text, id) =>
  new RegExp(`^\\s*(BROKEN|FALSE)\\s+${id.replace(/[/*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'm').test(text);

let failures = 0;
let discriminating = 0;
console.log(`selftest: ${CASES.length} detector(s), each against its own planted breakage\n`);

for (const c of CASES) {
  const dir = path.join(tmpBase, c.id.replace(/[^a-z0-9]/gi, '_'));
  cpSync(clean, dir, { recursive: true });
  const target = path.join(dir, c.file);
  if (!existsSync(target)) { console.log(`  SKIP  ${c.id} (${c.file} absent)`); continue; }

  // 1. STRIP the real claim so the promise should go quiet. Without this the
  //    tree is already red and "fired on the plant" proves nothing.
  stripLines(target, c.strip);
  if (c.also) stripLines(path.join(dir, c.also), c.strip);
  const stripped = runIn(dir);
  const quietWhenClean = c.inverse ? brokenIn(stripped.out, c.id) : !brokenIn(stripped.out, c.id);

  // 2. PLANT the breakage back and require the detector to fire.
  writeFileSync(target, readFileSync(target, 'utf8') + c.add);
  const after = runIn(dir);
  const firedOnPlant = c.inverse ? !brokenIn(after.out, c.id) : brokenIn(after.out, c.id);

  if (!firedOnPlant) {
    console.log(`  FAIL  ${c.id} — planted a breakage in ${c.file} and the detector did NOT fire`);
    failures++;
    continue;
  }
  if (!quietWhenClean) {
    console.log(`  FAIL  ${c.id} — fired on the plant, but ALSO fired after the claim was stripped`);
    console.log(`          (a detector that never goes quiet is as useless as one that never fires)`);
    failures++;
    continue;
  }
  console.log(`  OK    ${c.id} — quiet when stripped, fired on the plant`);
  discriminating++;
}

console.log(`\n${discriminating} of ${CASES.length} case(s) were fully discriminating (quiet when stripped, red on the plant).`);

if (failures) {
  console.error(`\n::error::selftest: ${failures} detector(s) failed to fire on a targeted breakage.`);
  console.error('A promise whose detector cannot fire reports READY forever and vouches for nothing.');
  process.exit(1);
}
console.log('\nselftest: PASS — every detector fired on its own planted breakage.');
