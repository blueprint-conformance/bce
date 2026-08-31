#!/usr/bin/env node
/**
 * witness-kit-replay.mjs — replay docs/launch/witness-kit.md and assert the doc still
 * describes the engine.
 *
 * The witness kit is the one page this project asks a stranger to run before trusting a
 * green verdict. Nothing had ever executed it: ci.yml's single job never touches
 * examples/quickstart, and a code search for "attestation" returns zero. A walkthrough
 * that drifts from the engine wastes the goodwill of the exact person whose independence
 * makes the attestation worth anything -- they hit a mismatch, and the honest conclusion
 * available to them is "this project's own instructions do not work".
 *
 * So this runs the kit's commands VERBATIM and diffs actual output against the Expected
 * blocks parsed OUT OF THE DOC ITSELF. The doc is the fixture; nothing is duplicated here
 * that could drift independently of it.
 *
 * Direction of repair is fixed: if this reds, the DOC is corrected to match the engine --
 * never the engine bent to match the doc. The engine's behaviour is what the corpus and
 * the self-gate measure; the doc is a description of it.
 *
 * Zero dependencies, same discipline as tools/verify-chain.mjs.
 *
 * Exit codes:
 *   0 — every command matched the doc.
 *   1 — at least one mismatch (drift), enumerated on stderr.
 *   2 — harness failure (missing doc, missing build, unparseable Expected blocks).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docPath = path.join(repoRoot, 'docs/launch/witness-kit.md');
const quickstart = path.join(repoRoot, 'examples/quickstart');
const cli = path.join(repoRoot, 'dist/cli.js');

const fail = (msg) => { console.error(`witness-kit-replay: ${msg}`); process.exit(2); };
if (!existsSync(docPath)) fail(`missing ${path.relative(repoRoot, docPath)}`);
if (!existsSync(cli)) fail('dist/cli.js missing — run `npm run build` first');
if (!existsSync(quickstart)) fail('examples/quickstart missing');

const doc = readFileSync(docPath, 'utf8');

/**
 * Pull every fenced block that immediately follows an "Expected" lead-in. The doc writes
 * these as `Expected:` or `Expected (a real gate failure — ...):`, so match the lead-in
 * loosely and the fence strictly.
 */
function expectedBlocks(md) {
  const out = [];
  const re = /^Expected[^\n]*:\s*\n\s*\n```\n([\s\S]*?)```/gm;
  let m;
  while ((m = re.exec(md)) !== null) out.push(m[1].replace(/\n+$/, ''));
  return out;
}

const blocks = expectedBlocks(doc);
if (blocks.length < 3) {
  fail(`parsed ${blocks.length} Expected block(s) from the doc, need >= 3 — the doc's shape changed; fix this parser, do not weaken the assertion`);
}

const strip = (s) => s.replace(/\[[0-9;]*m/g, '');
const norm = (s) => strip(s).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');

/**
 * Merge stdout and stderr AT THE OS LEVEL (`2>&1`), not by concatenating two captured
 * buffers. The gate writes its summary to stdout and its failure report to stderr, and a
 * witness sees them INTERLEAVED in emission order in one terminal. Concatenating
 * `stdout + stderr` reorders them and manufactures a mismatch against a doc that is
 * actually correct -- which is exactly what the first version of this script did. The doc
 * is the fixture; the harness must observe what a human observes.
 */
const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function runBoth(args) {
  const cmd = `${[process.execPath, cli, ...args].map(shellQuote).join(' ')} 2>&1`;
  try {
    return { out: execSync(cmd, { cwd: quickstart, encoding: 'utf8' }), code: 0 };
  } catch (e) {
    return { out: e.stdout ?? '', code: typeof e.status === 'number' ? e.status : 1 };
  }
}

const failures = [];
const check = (label, actual, expected, note) => {
  if (norm(actual) === norm(expected)) { console.log(`  OK   ${label}`); return; }
  failures.push({ label, actual: norm(actual), expected: norm(expected), note });
  console.log(`  DRIFT ${label}`);
};

console.log('witness-kit-replay: running the kit\'s commands verbatim against the built CLI');

// The doc appends `echo $?` output to each fenced block, so the comparison target is
// "command output + exit code on its own line" -- exactly what a witness sees.
const withCode = (r) => `${r.out}${r.code}`;

// 1. clean tree is GREEN
const c1 = runBoth(['gate', '--repo', 'clean', '--blueprint-dir', 'blueprint', '--extractor', 'ast']);
check('1 clean tree GREEN', withCode(c1), blocks[0]);

// 2. drifted tree is RED and names the line
const c2 = runBoth(['gate', '--repo', 'drift', '--blueprint-dir', 'blueprint', '--extractor', 'ast', '--all']);
check('2 drift tree RED (names src/greeting.plugin.ts#L16)', withCode(c2), blocks[1]);

// 3. the witness's own fix -> GREEN. Applied in a temp copy so the repo tree is untouched.
const driftFile = path.join(quickstart, 'drift/src/greeting.plugin.ts');
const cleanFile = path.join(quickstart, 'clean/src/greeting.plugin.ts');
const original = readFileSync(driftFile, 'utf8');
let c3;
try {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(driftFile, readFileSync(cleanFile, 'utf8'));
  c3 = runBoth(['gate', '--repo', 'drift', '--blueprint-dir', 'blueprint', '--extractor', 'ast']);
} finally {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(driftFile, original); // always restore — the fixture must survive the replay
}
check('3 post-fix GREEN', withCode(c3), blocks[2]);

// 4 + 5 are described in prose with backticked fragments, not fenced blocks. Assert the
// fragments the doc actually promises, and read them OUT OF THE DOC so a reworded promise
// reds here instead of silently diverging.
const promise4 = /`(blueprint VALID: [^`]+)`/.exec(doc);
const promise5 = /`(TeethReport[^`]*evaluator-refutable)`/.exec(doc);
if (!promise4 || !promise5) fail('could not locate the doc\'s prose promises for validate/teeth');

const c4 = runBoth(['validate', '--blueprint', 'blueprint/no-direct-http-client.blueprint.json']);
if (c4.code === 0 && strip(c4.out).includes(promise4[1])) console.log('  OK   4 validate');
else { failures.push({ label: '4 validate', actual: `exit ${c4.code}\n${norm(c4.out)}`, expected: `exit 0, output containing: ${promise4[1]}` }); console.log('  DRIFT 4 validate'); }

const c5 = runBoth(['teeth', '--blueprint', 'blueprint/no-direct-http-client.blueprint.json', '--ct-repo', 'clean', '--no-pin', '--extractor', 'ast']);
// Build the matcher FROM the doc's promise rather than hard-coding it. Command 4
// already derived its expectation from the doc; this one did not, which made the
// doc's teeth promise decorative — reword it and nothing here noticed. The doc is
// the fixture for every other command; it is the fixture for this one too now.
// The promise reads like "TeethReport … -> evaluator-refutable", so the ellipsis
// is the wildcard: every segment must appear, in order.
const teethSegments = promise5[1].split('…').map((x) => x.trim()).filter(Boolean);
let cursor = 0;
const teethOrdered = teethSegments.every((seg) => {
  const at = strip(c5.out).indexOf(seg, cursor);
  if (at < 0) return false;
  cursor = at + seg.length;
  return true;
});
const teethOk = c5.code === 0 && teethOrdered;
if (teethOk) console.log('  OK   5 teeth');
else { failures.push({ label: '5 teeth', actual: `exit ${c5.code}\n${norm(c5.out)}`, expected: `exit 0, output containing (in order): ${teethSegments.join('  …  ')}` }); console.log('  DRIFT 5 teeth'); }

if (failures.length === 0) {
  console.log(`witness-kit-replay: PASS — all 5 commands match docs/launch/witness-kit.md`);
  process.exit(0);
}

console.error('');
console.error(`witness-kit-replay: FAIL — ${failures.length} command(s) drifted from the doc.`);
console.error('The DOC is wrong, not the engine. Correct docs/launch/witness-kit.md to match');
console.error('the output below; never edit the engine to match the doc.');
for (const f of failures) {
  console.error(`\n--- ${f.label}`);
  console.error('EXPECTED (from the doc):');
  console.error(f.expected.split('\n').map((l) => `  | ${l}`).join('\n'));
  console.error('ACTUAL (from the built CLI):');
  console.error(f.actual.split('\n').map((l) => `  | ${l}`).join('\n'));
}
process.exit(1);
