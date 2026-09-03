#!/usr/bin/env node
/**
 * hero-demo-record.mjs — the README's hero demo is RECORDED from the engine, never typed.
 *
 * WHY THIS EXISTS. The front page is the one artifact every visitor reads and almost nobody
 * re-runs. A pasted terminal block on it is a claim with no proof attached, and it stales
 * silently: when the three-way `teeth` verdict landed, the quickstart's output block went
 * stale for weeks while every CI leg stayed green, and only a byte-proof test caught it. The
 * front page deserves the same discipline as the walkthrough, because it is read first and
 * trusted most.
 *
 * So the README does not carry a hand-written demo. It carries the OUTPUT OF THIS SCRIPT,
 * and `tests/root-readme-proof.test.ts` re-runs this same renderer on every push and asserts
 * the page still matches the engine byte-for-byte. This is `witness-kit-replay.mjs`'s
 * discipline in reverse: there, the doc is the fixture and the script grades it; here, the
 * script PRODUCES the fixture the doc carries. Same invariant either way — the page can
 * never drift from the engine without a red check.
 *
 * Direction of repair is fixed, exactly as in witness-kit-replay: if the check reds, the
 * README is regenerated to match the engine — never the engine bent to match the README.
 *
 * VISUAL-ASSET DECISION (recorded here because it is a standing constraint, not a one-off).
 * This script emits a TEXT transcript only. No GIF, no rasterized capture, no
 * terminal-rasterizing dependency. Rationale: every other proof surface in this repository is
 * dependency-free by design (`tools/verify-chain.mjs`, the leakage gate, the banned-phrase
 * gate), a rasterized asset cannot be diffed in review or asserted byte-exact by a test, and
 * an image is exactly the artifact that stales invisibly — the failure mode this script
 * exists to kill.
 *
 * AMENDED: `scripts/hero-cast-svg.mjs` now draws an animated SVG cast FROM this script's
 * `renderHero()` output. That is not the asset class refused above, and the three reasons are
 * the test it has to pass rather than a carve-out around them: the cast adds no dependency
 * (hand-shaped SVG, no rasterizer), it diffs in review because every transcript line is a
 * literal <text> node, and it cannot stale because `tests/root-readme-proof.test.ts` reads
 * those lines back out and requires them to equal a live engine run. A GIF or a screen capture
 * would still fail all three and is still refused. The rule was never "no image" — it was "no
 * artifact that can drift from the engine without a check going red", and it stands.
 *
 * Zero dependencies. Zero network. No API key. Runs the engine over the in-tree
 * `examples/quickstart` fixtures — the same two trees the walkthrough and CI already prove.
 *
 * Usage:
 *   node scripts/hero-demo-record.mjs            # regenerate docs/launch/hero-demo.txt, print the hero block
 *   node scripts/hero-demo-record.mjs --check    # verify README + transcript still match the engine
 *
 * Exit codes:
 *   0 — recorded, or (--check) the page still matches the engine.
 *   1 — (--check) drift: the README or the transcript no longer matches the engine.
 *   2 — harness failure (missing engine, missing fixtures).
 */
import { closeSync, readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quickstart = path.join(repoRoot, 'examples', 'quickstart');
const transcriptPath = path.join(repoRoot, 'docs', 'launch', 'hero-demo.txt');
const readmePath = path.join(repoRoot, 'README.md');

/**
 * The four commands the quickstart walkthrough already proves end to end
 * (`tests/examples-readme-proof.test.ts`). Nothing new is claimed here: the hero demo is a
 * re-cut of the guaranteed path, not a second set of promises to keep true.
 */
export const FULL_COMMANDS = [
  ['validate', '--blueprint', 'blueprint/no-direct-http-client.blueprint.json'],
  ['teeth', '--blueprint', 'blueprint/no-direct-http-client.blueprint.json', '--ct-repo', 'clean', '--no-pin', '--extractor', 'ast'],
  ['gate', '--repo', 'clean', '--blueprint-dir', 'blueprint', '--extractor', 'ast'],
  ['gate', '--repo', 'drift', '--blueprint-dir', 'blueprint', '--extractor', 'ast', '--all'],
];

/**
 * The subset the front page carries: the RED/GREEN discriminating pair, drift first.
 *
 * Drift-first is deliberate. The claim that has to survive a sceptical reader is "this gate
 * can actually go red and name the line" — showing the failure first, then the pass, makes
 * the discrimination the point instead of burying it under a green tick. It is the same pair
 * `ci.yml` runs as its own named step, on the same fixtures, by real exit codes.
 */
export const HERO_COMMANDS = [FULL_COMMANDS[3], FULL_COMMANDS[2]];

/**
 * Resolve the engine. Prefer the built CLI; fall back to running the source through tsx when
 * `dist/` is absent, so `npm test` works on a fresh clone without a build step (CI builds
 * first, so it takes the dist path). The two are byte-identical by construction — dist is
 * built from src — and the test asserts the README against whichever one ran.
 */
export function resolveEngine() {
  const dist = path.join(repoRoot, 'dist', 'cli.js');
  if (existsSync(dist)) return { argv: [process.execPath, dist], via: 'dist/cli.js' };
  const src = path.join(repoRoot, 'src', 'cli.ts');
  if (existsSync(src)) return { argv: [process.execPath, '--import', 'tsx', src], via: 'src/cli.ts (tsx)' };
  throw new Error('no engine found — neither dist/cli.js nor src/cli.ts exists');
}

/**
 * Merge stdout and stderr at the OS level by wiring both streams to the same file descriptor,
 * rather than concatenating two captured
 * buffers. The gate writes its summary to stdout and its failure report to stderr; a reader
 * sees them INTERLEAVED in emission order in one terminal. Concatenating the two buffers
 * reorders them and would record a transcript no human ever sees — the exact bug
 * witness-kit-replay.mjs documents having hit.
 */
function runInterleaved(engineArgv, args) {
  const scratch = mkdtempSync(path.join(tmpdir(), 'bce-hero-output-'));
  const output = path.join(scratch, 'combined.log');
  const fd = openSync(output, 'w');
  try {
    const result = spawnSync(engineArgv[0], [...engineArgv.slice(1), ...args], {
      cwd: quickstart,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    if (result.error) throw result.error;
    return { out: readFileSync(output, 'utf8'), code: result.status ?? 1 };
  } finally {
    try { closeSync(fd); } catch { /* already closed after a successful spawn */ }
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Strip ANSI so the recorded transcript is byte-identical on a developer TTY and on the CI
 * runner. Written as an explicit \u001b escape rather than a literal control byte, so the
 * pattern stays visible in review and survives copy-paste.
 */
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

/**
 * Render a transcript for the given commands.
 *
 * The prompt shows `bce …` — the installed-binary form a reader would actually type — while
 * the bytes below it come from the engine that just ran. That is the same convention the
 * quickstart walkthrough states explicitly ("Every command below is `bce …`"), and the
 * output is real either way.
 *
 * `echo $?` is included because the exit code IS the product. A gate whose verdict is a
 * coloured word but always exits 0 is decoration; showing the real 1 and the real 0 is the
 * whole claim, in the one form CI actually consumes.
 */
export function renderTranscript(commands, engine = resolveEngine()) {
  return `${commands
    .map((args) => {
      const r = runInterleaved(engine.argv, args);
      // A generated public transcript has one canonical byte representation;
      // Windows console newlines must not rewrite the proof artifact.
      const body = stripAnsi(r.out).replace(/\r\n/g, '\n').replace(/\n+$/, '');
      return `$ bce ${args.join(' ')}\n${body}\n$ echo $?\n${r.code}\n`;
    })
    .join('\n')}`;
}

export const renderHero = (engine) => renderTranscript(HERO_COMMANDS, engine);
export const renderFull = (engine) => renderTranscript(FULL_COMMANDS, engine);

// ---------------------------------------------------------------------------
// CLI entry point. Guarded so the renderer can be imported by the byte-proof test
// without executing anything.
// ---------------------------------------------------------------------------
function main() {
  const fail = (msg) => { console.error(`hero-demo-record: ${msg}`); process.exit(2); };
  if (!existsSync(quickstart)) fail('examples/quickstart missing');

  let engine;
  try {
    engine = resolveEngine();
  } catch (e) {
    fail(`${e.message} — run \`npm run build\` first`);
  }

  const check = process.argv.includes('--check');
  console.log(`hero-demo-record: recording against ${engine.via}`);

  const hero = renderHero(engine);
  const full = renderFull(engine);

  if (!check) {
    mkdirSync(path.dirname(transcriptPath), { recursive: true });
    writeFileSync(transcriptPath, full);
    console.log(`hero-demo-record: wrote ${path.relative(repoRoot, transcriptPath)} (${full.length} bytes)`);
    console.log('\n--- hero block (paste between the README fence) ---\n');
    process.stdout.write(hero);
    process.exit(0);
  }

  const drift = [];
  if (!existsSync(readmePath)) fail('README.md missing');
  if (!readFileSync(readmePath, 'utf8').includes(hero)) {
    drift.push('README.md no longer carries the engine\'s actual hero transcript');
  }
  if (!existsSync(transcriptPath)) drift.push(`${path.relative(repoRoot, transcriptPath)} is missing`);
  else if (readFileSync(transcriptPath, 'utf8') !== full) {
    drift.push(`${path.relative(repoRoot, transcriptPath)} no longer matches the engine`);
  }

  if (drift.length === 0) {
    console.log('hero-demo-record: PASS — the front page still matches the engine.');
    process.exit(0);
  }
  console.error(`\nhero-demo-record: FAIL — ${drift.length} drift(s).`);
  for (const d of drift) console.error(`  - ${d}`);
  console.error('\nThe PAGE is wrong, not the engine. Re-run `node scripts/hero-demo-record.mjs`');
  console.error('and paste the emitted block into README.md; never edit the engine to match the page.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
