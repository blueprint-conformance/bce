#!/usr/bin/env node
// Self-test for check-ship-blockers.mjs.
//
// A guard nobody has watched REFUSE is indistinguishable from one that cannot
// refuse. Every case below plants a condition in a throwaway git repo and asserts
// the guard's exit code, so "0 blockers found" on the real tree means the scan
// ran and found nothing — not that the scan silently did nothing.
//
// Exit: 0 all cases passed | 1 an assertion failed

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-ship-blockers.mjs', import.meta.url));
let pass = 0;
let fail = 0;

const ok = (m) => { console.log(`  ok   ${m}`); pass += 1; };
const bad = (m, d) => { console.error(`  FAIL ${m}${d ? ` — ${d}` : ''}`); fail += 1; };

function scratch(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ship-blockers-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'selftest@example.invalid']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'selftest']);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'fixture']);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD, dir], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function check(name, files, wantCode, wantSubstr) {
  const dir = scratch(files);
  try {
    const { code, out } = run(dir);
    if (code !== wantCode) return bad(name, `exit ${code}, wanted ${wantCode}\n${out}`);
    if (wantSubstr && !out.includes(wantSubstr)) return bad(name, `output lacked "${wantSubstr}"\n${out}`);
    ok(name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('check-ship-blockers self-test\n');

console.log('-- the guard must REFUSE (these are the cases it exists for) --');
check('a bare placeholder token is refused',
  { 'CITATION.cff': 'doi: DOI_PENDING_DO_NOT_SHIP\n' }, 1, 'REFUSED');

check('a placeholder in a nested path is refused',
  { 'docs/a/b/page.md': 'see ARXIV_ID_PENDING_DO_NOT_SHIP\n' }, 1, 'docs/a/b/page.md');

check('an UNKNOWN new token is refused too (suffix match, not an allowlist)',
  { 'README.md': 'url: ZENODO_URL_PENDING_DO_NOT_SHIP\n' }, 1, 'REFUSED');

check('the refusal NAMES file and line so it is actionable',
  { 'README.md': 'clean line\nsecond\ndoi: DOI_PENDING_DO_NOT_SHIP\n' }, 1, 'README.md:3');

check('every occurrence is reported, not just the first',
  {
    'a.md': 'x DOI_PENDING_DO_NOT_SHIP\n',
    'b.md': 'y ARXIV_ID_PENDING_DO_NOT_SHIP\n',
  }, 1, '2 unreplaced placeholder(s)');

console.log('\n-- the guard must PASS (a gate that always fails is equally useless) --');
check('a clean tree passes',
  { 'README.md': '# real content\n', 'CITATION.cff': 'doi: 10.5281/zenodo.1234567\n' }, 0, 'clean');

check('near-miss wording does NOT trip it (no false refusal)',
  { 'README.md': 'this DOI is pending; do not ship until ready\n' }, 0, 'clean');

console.log('\n-- fail-CLOSED: cannot-measure must never read as clean --');
{
  const dir = mkdtempSync(path.join(tmpdir(), 'ship-blockers-nogit-'));
  try {
    writeFileSync(path.join(dir, 'README.md'), 'doi: DOI_PENDING_DO_NOT_SHIP\n');
    const { code, out } = run(dir); // not a git repo -> enumeration fails
    if (code === 1 && /FAILED|REFUSED/.test(out)) ok('a non-git directory exits 1, never 0');
    else bad('non-git directory', `exit ${code} out=${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\n-- the DISCRIMINATING NEGATIVE: the guard is not merely always-1 --');
{
  // Same tree, one token added. If exit codes did not differ, every "REFUSED"
  // above would be worthless — a guard stuck at 1 refuses correct trees too.
  const cleanDir = scratch({ 'README.md': '# fine\n' });
  const dirtyDir = scratch({ 'README.md': '# fine\nDOI_PENDING_DO_NOT_SHIP\n' });
  try {
    const c = run(cleanDir).code;
    const d = run(dirtyDir).code;
    if (c === 0 && d === 1) ok(`one added token flips the verdict (${c} -> ${d})`);
    else bad('verdict does not move', `clean=${c} dirty=${d}`);
  } finally {
    rmSync(cleanDir, { recursive: true, force: true });
    rmSync(dirtyDir, { recursive: true, force: true });
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
