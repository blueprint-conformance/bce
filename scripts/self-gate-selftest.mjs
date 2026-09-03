#!/usr/bin/env node
/**
 * self-gate-selftest.mjs — prove the engine's self-gate can actually refuse.
 *
 * self-gate is the project's central claim made operational: "bce gates its own
 * repository on every push with the same verdict users get." If that gate cannot
 * go red on this tree, the claim is empty — and nothing had ever demonstrated it
 * going red HERE. The corpus measures recall on seeded fixtures; the RED/GREEN
 * pair in release.yml discriminates on a toy quickstart tree. Neither shows the
 * SELF-blueprint refusing the SELF-repository.
 *
 * Three properties, each proven by a targeted violation in a throwaway copy:
 *
 *   1. gate refuses a real violation of the self-blueprint
 *   2. source-mutation teeth proves every clean constraint and refuses vacuity
 *   3. the sync test refuses a new src file with no blueprint coverage
 *
 * A baseline asserts the unmutated copy passes all three first, so a refusal
 * cannot be inherited from pre-existing drift.
 *
 * The repository is never mutated: every case runs in a `git archive` copy with
 * node_modules symlinked (read-only) so the built CLI can resolve its imports.
 *
 * Exit codes:
 *   0 — all three refused their own planted violation, and the clean copy passed.
 *   1 — a property failed to refuse.
 *   2 — harness failure.
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const die = (m) => { console.error(`self-gate-selftest: ${m}`); process.exit(2); };
const BP = '.blueprints/engine.blueprint.json';
const MUTATIONS = '.blueprints/engine.teeth-mutations.json';

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'sg-selftest-'));
const mkCopy = (name) => {
  const d = path.join(tmpBase, name);
  mkdirSync(d, { recursive: true });
  execSync(`git -C ${JSON.stringify(repoRoot)} archive HEAD | tar -x -C ${JSON.stringify(d)}`);
  const nm = path.join(repoRoot, 'node_modules');
  if (existsSync(nm)) { try { symlinkSync(nm, path.join(d, 'node_modules'), 'dir'); } catch {} }
  // dist/ is gitignored but required — copy the built CLI in.
  execSync(`cp -R ${JSON.stringify(path.join(repoRoot, 'dist'))} ${JSON.stringify(path.join(d, 'dist'))}`);
  // `teeth` shells out to git, so a bare archive copy fails with "not a git
  // repository" — a harness failure that looks exactly like a gate refusing.
  // The copy gets its own throwaway history; the real repository is untouched.
  execSync('git init -q . && git add -A && git -c user.email=s@s -c user.name=s commit -qm selftest',
    { cwd: d, stdio: 'ignore' });
  return d;
};

function run(dir, args) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'dist/cli.js'), ...args],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { out, code: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: typeof e.status === 'number' ? e.status : 1 };
  }
}
function runCmd(dir, cmd) {
  try { return { out: execSync(cmd, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }; }
  catch (e) { return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, code: typeof e.status === 'number' ? e.status : 1 }; }
}

if (!existsSync(path.join(repoRoot, 'dist/cli.js'))) die('dist/cli.js missing — run `npm run build` first');

// ---------------------------------------------------------------------------
// BASELINE — the clean copy must pass, or every refusal below proves nothing.
// ---------------------------------------------------------------------------
const clean = mkCopy('clean');
const baseGate = run(clean, ['gate', '--repo', '.', '--repo-name', 'blueprint-conformance/bce']);
const baseTeeth = run(clean, ['teeth', '--blueprint', BP, '--ct-repo', '.', '--mutation-manifest', MUTATIONS, '--require-all-extractor-real']);
if (baseGate.code !== 0 || baseTeeth.code !== 0) {
  console.error(baseGate.out.slice(0, 1200));
  die(`clean copy does not pass (gate=${baseGate.code} teeth=${baseTeeth.code}) — fix real drift before trusting a control`);
}
console.log('baseline: clean copy passes gate and teeth\n');

let failures = 0;
const report = (ok, label, detail) => {
  if (ok) console.log(`  OK    ${label} — ${detail}`);
  else { console.log(`  FAIL  ${label} — ${detail}`); failures++; }
};

// ---------------------------------------------------------------------------
// 1. GATE refuses a real violation. The self-blueprint forbids non-CLI modules
//    calling process.exit — a constraint with a dedicated rule per module, so a
//    single planted call is unambiguous rather than incidentally allowed.
// ---------------------------------------------------------------------------
{
  const d = mkCopy('gate_violation');
  const target = path.join(d, 'src/score.ts');
  if (!existsSync(target)) die('src/score.ts not found — update this probe to a module the blueprint covers');
  writeFileSync(target, `${readFileSync(target, 'utf8')}\nexport function __selftestViolation() { process.exit(1); }\n`);
  const r = run(d, ['gate', '--repo', '.', '--repo-name', 'blueprint-conformance/bce']);
  report(r.code !== 0, '1 gate refuses a self-blueprint violation',
    `planted process.exit in src/score.ts -> exit ${r.code}`);
}

// ---------------------------------------------------------------------------
// 2. TEETH refuses vacuity. Strip the constraints so nothing could ever fail;
//    a blueprint that cannot go red must be rejected (documented: exit 2).
// ---------------------------------------------------------------------------
{
  const d = mkCopy('teeth_vacuous');
  const p = path.join(d, BP);
  const bp = JSON.parse(readFileSync(p, 'utf8'));
  bp.constraints = [];
  writeFileSync(p, JSON.stringify(bp, null, 2));
  const r = run(d, ['teeth', '--blueprint', BP, '--ct-repo', '.', '--mutation-manifest', MUTATIONS, '--require-all-extractor-real']);
  report(r.code !== 0, '2 source-mutation teeth refuses a vacuous blueprint',
    `constraints emptied -> exit ${r.code}`);
}

// ---------------------------------------------------------------------------
// 3. The SYNC TEST refuses an uncovered module. The workflow step says "new src
//    file without blueprint coverage fails here" — asserted, never demonstrated.
// ---------------------------------------------------------------------------
{
  const d = mkCopy('sync_uncovered');
  writeFileSync(path.join(d, 'src/selftest-orphan.ts'), 'export const orphan = 1;\n');
  const r = runCmd(d, 'npx vitest run tests/self-blueprint.test.ts 2>&1');
  report(r.code !== 0, '3 sync test refuses an uncovered src module',
    `added src/selftest-orphan.ts -> exit ${r.code}`);
}

console.log('');
if (failures) {
  console.error(`::error::self-gate-selftest: ${failures} propert(y/ies) did not refuse their planted violation.`);
  console.error('The claim "bce gates its own repository" is only worth what these refusals prove.');
  process.exit(1);
}
console.log('self-gate-selftest: PASS — gate, all-constraint source-mutation teeth, and the sync test refused their controls.');
