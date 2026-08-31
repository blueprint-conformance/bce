#!/usr/bin/env node
/**
 * witness-kit-selftest.mjs — prove the replay can catch drift in EVERY command,
 * not just the one the workflow plants.
 *
 * witness-kit-freshness plants a single mutation (the drifted tree's score, 60 ->
 * 61) and requires a refusal. That proves command 2's comparison works. Commands
 * 1, 3, 4 and 5 have never been shown to catch anything.
 *
 * The replay is structurally safer than a prose-regex gate — it compares actual
 * output against blocks parsed out of the doc, and its parser already fails closed
 * (fewer than three Expected blocks, or a missing prose promise, exits 2). But
 * "safer" is not "proven". A comparison that is never exercised is a comparison
 * nobody has watched fail, and this kit is the one artefact the project asks a
 * stranger to run.
 *
 * Blocks 1 and 3 are BYTE-IDENTICAL in the doc (both are the green verdict), so
 * mutation is by block INDEX, never by text match — a text-based mutation would
 * silently alter both and prove neither.
 *
 * Exit codes:
 *   0 — every command's comparison caught its own planted drift.
 *   1 — at least one comparison did not.
 *   2 — harness failure.
 */
import { readFileSync, writeFileSync, mkdtempSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const die = (m) => { console.error(`witness-selftest: ${m}`); process.exit(2); };

const DOC = 'docs/launch/witness-kit.md';
const FENCE_RE = /^Expected[^\n]*:\s*\n\s*\n```\n([\s\S]*?)```/gm;

/** Replace the Nth Expected-block's body via a transform, by INDEX not by text. */
function mutateBlock(md, index, transform) {
  let i = 0, out = md, offset = 0;
  for (const m of md.matchAll(FENCE_RE)) {
    if (i++ !== index) continue;
    const body = m[1];
    const start = m.index + m[0].length - body.length - 3; // body starts before the closing fence
    const mutated = transform(body);
    out = out.slice(0, start + offset) + mutated + out.slice(start + offset + body.length);
    return { out, changed: mutated !== body };
  }
  return { out, changed: false };
}

const CASES = [
  { label: '1 clean tree GREEN', kind: 'block', index: 0, transform: (b) => b.replace('score 100', 'score 99') },
  { label: '2 drift tree RED',   kind: 'block', index: 1, transform: (b) => b.replace('score 60', 'score 61') },
  { label: '3 post-fix GREEN',   kind: 'block', index: 2, transform: (b) => b.replace('0 failing', '7 failing') },
  { label: '4 validate',         kind: 'prose', find: /`blueprint VALID: ([^`]+)`/, repl: '`blueprint VALID: NOT-THE-REAL-ID`' },
  // The mutation must keep the promise EXTRACTABLE. Removing the word the
  // extractor keys on ("evaluator-refutable") breaks parsing and yields a harness
  // exit 2 -- still a refusal, but it proves the parser fails closed, not that
  // command 5's comparison works. Change what the promise SAYS while leaving it
  // findable.
  { label: '5 teeth',            kind: 'prose', find: /`(TeethReport[^`]*evaluator-refutable)`/, repl: '`TeethReport … -> definitely evaluator-refutable`' },
];

function runReplay(dir) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts/witness-kit-replay.mjs')], {
      encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: typeof e.status === 'number' ? e.status : 1 };
  }
}

const skipHeavy = (s) =>
  !s.includes(`${path.sep}.git${path.sep}`) && !s.endsWith(`${path.sep}.git`) &&
  !s.includes(`${path.sep}node_modules`);

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'wk-selftest-'));
const clean = path.join(tmpBase, 'clean');
cpSync(repoRoot, clean, { recursive: true, filter: skipHeavy });
// dist/cli.js resolves its imports at runtime, so the copy needs node_modules.
// SYMLINK rather than copy: a real copy of the install is slow enough to make this
// harness unpleasant to run, and it is read-only here.
const linkNodeModules = (dir) => {
  const src = path.join(repoRoot, 'node_modules');
  if (existsSync(src) && !existsSync(path.join(dir, 'node_modules'))) {
    try { symlinkSync(src, path.join(dir, 'node_modules'), 'dir'); } catch { /* best effort */ }
  }
};
linkNodeModules(clean);
// dist/ is required by the replay; node_modules is not (the replay spawns dist/cli.js).
if (!existsSync(path.join(clean, 'dist/cli.js'))) die('dist/cli.js missing — run `npm run build` first');
if (!existsSync(path.join(clean, DOC))) die(`${DOC} missing from the copy`);

// Baseline: the unmutated copy MUST pass, or every "caught it" below is meaningless.
const base = runReplay(clean);
if (base.code !== 0) {
  console.error(base.out);
  die('the UNMUTATED copy does not pass — fix the real drift before trusting any negative control');
}
console.log('baseline: unmutated copy PASSES\n');

let failures = 0;
for (const c of CASES) {
  const dir = path.join(tmpBase, c.label.replace(/[^a-z0-9]/gi, '_'));
  cpSync(clean, dir, { recursive: true, filter: skipHeavy });
  linkNodeModules(dir);
  const docPath = path.join(dir, DOC);
  const md = readFileSync(docPath, 'utf8');

  let next, changed;
  if (c.kind === 'block') {
    ({ out: next, changed } = mutateBlock(md, c.index, c.transform));
  } else {
    changed = c.find.test(md);
    next = md.replace(c.find, c.repl);
  }
  if (!changed) { console.log(`  FAIL  ${c.label} — could not plant a mutation (doc shape changed?)`); failures++; continue; }
  writeFileSync(docPath, next);

  const r = runReplay(dir);
  const named = new RegExp(`DRIFT\\s+${c.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(r.out);
  if (r.code === 0) { console.log(`  FAIL  ${c.label} — mutated its expectation and the replay still PASSED`); failures++; continue; }
  if (!named)      { console.log(`  FAIL  ${c.label} — replay failed, but did not name this command`); failures++; continue; }
  console.log(`  OK    ${c.label} — mutation caught, and named`);
}

if (failures) {
  console.error(`\n::error::witness-selftest: ${failures} command comparison(s) did not catch their own planted drift.`);
  console.error('An unexercised comparison is one nobody has watched fail.');
  process.exit(1);
}
console.log(`\nwitness-selftest: PASS — all ${CASES.length} command comparisons caught their own drift.`);
