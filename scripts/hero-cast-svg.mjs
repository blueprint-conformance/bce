#!/usr/bin/env node
/**
 * hero-cast-svg.mjs — the animated terminal cast is DRAWN FROM THE REPLAYED TRANSCRIPT.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT THE THING scripts/hero-demo-record.mjs REFUSED.
 * That script's VISUAL-ASSET DECISION rejected a rendered hero asset, and the reasoning was
 * exact: a rasterized asset (a GIF, a PNG, an asciinema capture) cannot be diffed in review,
 * cannot be asserted byte-exact by a test, and is therefore the one artifact on the page that
 * stales invisibly — the failure mode that whole script exists to kill. Every word of that
 * still holds, and none of it is relaxed here.
 *
 * This asset is not that. It is TEXT: hand-shaped SVG whose every transcript line is a literal
 * <text> node carrying the same bytes the engine printed, emitted by this script from
 * `renderHero()` — the identical renderer `tests/root-readme-proof.test.ts` replays against a
 * live engine. So it diffs like source, adds no dependency, and — the load-bearing part —
 * `tests/root-readme-proof.test.ts` reads the lines back out of this SVG and requires them to
 * equal the live engine's output. The animation cannot go stale without turning a check red,
 * which is precisely the property the earlier decision said a rendered asset could not have.
 *
 * The motion is CSS keyframes generated per line: one @keyframes rule per transcript line, all
 * sharing a single cycle, so the reveal order is deterministic and the whole cast restarts in
 * lock-step. No SMIL timing graph to reason about, no script, no external font, no network.
 *
 * Direction of repair is fixed, exactly as in hero-demo-record: if the check reds, this ASSET
 * is regenerated to match the engine — never the engine bent to match the asset.
 *
 * Usage:
 *   node scripts/hero-cast-svg.mjs           # regenerate assets/hero-cast.svg
 *   node scripts/hero-cast-svg.mjs --check   # require the committed asset to match the engine
 *
 * Exit codes:
 *   0 — written, or (--check) the asset still matches the engine.
 *   1 — (--check) drift: the committed asset no longer matches the engine.
 *   2 — harness failure (no engine, no fixtures).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderHero, resolveEngine } from './hero-demo-record.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const castPath = path.join(repoRoot, 'assets', 'hero-cast.svg');

// ---------------------------------------------------------------------------
// Geometry. A monospace grid: every line is pinned to exactly len*ADVANCE px via
// textLength, so the cast lays out identically whether or not the reader's
// renderer resolves the first font in the stack. Without that pin, a fallback
// font silently overflows the plate on someone else's machine.
// ---------------------------------------------------------------------------
const ADVANCE = 6.9;     // px per character at FONT_SIZE
const FONT_SIZE = 11.5;
const LINE_H = 19;
const PAD_X = 22;
const CHROME_H = 38;     // title bar
const PAD_BOTTOM = 16;

// Pacing, in seconds. STEP is the gap between line reveals; TAIL is a short
// settle after the last line.
//
// The cast plays ONCE and holds the finished screen (animation-fill-mode:
// forwards), rather than looping. A loop would return the front page to an empty
// terminal every few seconds — so a reader arriving mid-cycle, a thumbnail, a
// social card, or any static capture can catch it saying nothing. Playing once
// means the asset spends all of its life except the first few seconds in its
// most informative state, and a reader who scrolls back finds the completed
// transcript rather than a rerun.
const STEP = 0.3;
const PROMPT_BEAT = 0.45;  // an extra beat before a new command, so the two runs read as two
const TAIL = 0.4;

const FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Classify a transcript line so the cast colours it the way a terminal would. */
function classOf(line, prev) {
  if (line.startsWith('$ ')) return 'cmd';
  if (line.startsWith('::error::')) return 'err';
  if (line.includes('✓')) return 'ok';
  if (prev === '$ echo $?') return line.trim() === '0' ? 'ok' : 'err';
  return 'out';
}

/**
 * Build the SVG for a transcript.
 *
 * Exported so the byte-proof test can rebuild it from a live engine run and compare, rather
 * than re-implementing the drawing here — the same "import the renderer, never copy it"
 * discipline root-readme-proof already applies to hero-demo-record.
 */
export function renderCastSvg(transcript) {
  const lines = transcript.split('\n');
  const cols = Math.max(...lines.map((l) => l.length));
  const width = Math.ceil(PAD_X * 2 + cols * ADVANCE);
  const height = CHROME_H + lines.length * LINE_H + PAD_BOTTOM;

  // Reveal schedule: a beat before each command line, one step otherwise. The
  // first line is at t=0 so the opening frame already shows the command being
  // run — an asset whose very first frame is blank is one a thumbnailer will
  // happily publish as blank.
  const at = [];
  let t = 0;
  lines.forEach((l, i) => {
    if (i > 0) t += l.startsWith('$ ') ? PROMPT_BEAT : STEP;
    at.push(t);
  });
  const total = Math.round((t + TAIL) * 100) / 100;

  // One keyframes rule per line. `p` is the moment the line appears as a
  // percentage of the single play, so the lines arrive in transcript order.
  const keyframes = at
    .map((s, i) => {
      const p = Math.round((s / total) * 10000) / 100;
      // p === 0 is written as a single 0% stop: `0%,0%` is a duplicated
      // selector in one keyframe block, which not every parser accepts.
      const hidden = p === 0 ? '0%' : `0%,${p}%`;
      return `@keyframes r${i}{${hidden}{opacity:0}${Math.round((p + 0.01) * 100) / 100}%,100%{opacity:1}}`;
    })
    .join('\n    ');
  const lineRules = at.map((_s, i) => `.l${i}{animation:r${i} ${total}s linear forwards}`).join('');

  const body = lines
    .map((l, i) => {
      const cls = classOf(l, i > 0 ? lines[i - 1] : null);
      const y = CHROME_H + 14 + i * LINE_H;
      const len = Math.round(l.length * ADVANCE * 100) / 100;
      // An empty line still gets a node: the extractor reads these back out and
      // joins them, so a dropped blank would change the transcript it rebuilds.
      const pin = l.length > 0 ? ` textLength="${len}" lengthAdjust="spacingAndGlyphs"` : '';
      return `    <text class="ln ${cls} l${i}" x="${PAD_X}" y="${y}"${pin} xml:space="preserve">${esc(l)}</text>`;
    })
    .join('\n');

  const cursorY = CHROME_H + 4 + lines.length * LINE_H - LINE_H;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="cast-title cast-desc">
  <title id="cast-title">bce refusing a forbidden import, then passing the corrected tree</title>
  <desc id="cast-desc">An animated terminal replay of the hero demo. The gate is run against a drifted tree and fails with exit code 1, naming the forbidden edge and the file and line it was found at; it is then run against the corrected tree and passes with exit code 0. The same transcript appears as selectable text in the README code block below this image.</desc>
  <style>
    /* opacity:1 is the BASE state and the animation is what hides, never the
       reverse. A renderer that does not run CSS animations — a static
       rasterizer, a feed reader, a proxy that flattens the asset — then shows
       the COMPLETE transcript instead of an empty terminal, which is the whole
       point of the image. Authored the other way round (base 0, revealed by the
       animation) this degrades to a blank plate, which is how a hero asset ends
       up silently selling nothing. */
    .ln{font-family:${FONT};font-size:${FONT_SIZE}px;opacity:1}
    .cmd{fill:#7FD3F7}.err{fill:#F0555B}.ok{fill:#3FB950}.out{fill:#C9D5E1}
    ${keyframes}
    ${lineRules}
    @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
    .cursor{animation:blink 1.06s steps(1) infinite}
    /* Reduced motion gets the same complete transcript, held still. */
    @media (prefers-reduced-motion: reduce){
      .ln{opacity:1;animation:none}
      .cursor{animation:none;opacity:0}
    }
  </style>
  <rect width="${width}" height="${height}" rx="8" fill="#0B1622"/>
  <rect width="${width}" height="${CHROME_H}" rx="8" fill="#111E2C"/>
  <rect y="${CHROME_H - 8}" width="${width}" height="8" fill="#111E2C"/>
  <line x1="0" y1="${CHROME_H}" x2="${width}" y2="${CHROME_H}" stroke="#1B3A52" stroke-width="1"/>
  <circle cx="20" cy="19" r="5" fill="#F0555B"/>
  <circle cx="38" cy="19" r="5" fill="#D9A441"/>
  <circle cx="56" cy="19" r="5" fill="#3FB950"/>
  <text x="76" y="23" font-family="ui-sans-serif, -apple-system, Segoe UI, Helvetica, Arial, sans-serif" font-size="12" fill="#5C748C">bce — one contract, two trees, real exit codes</text>
  <g id="cast-lines">
${body}
  </g>
  <rect class="cursor" x="${PAD_X}" y="${cursorY}" width="${Math.round(ADVANCE * 100) / 100}" height="13" fill="#7FD3F7"/>
</svg>
`;
}

/**
 * Read the transcript back OUT of a rendered cast — the inverse of renderCastSvg's text
 * emission. The byte-proof test uses this to compare the committed asset against a live engine
 * run, so the extraction lives beside the emission rather than being re-guessed in the test.
 */
export function extractTranscript(svg) {
  const group = /<g id="cast-lines">([\s\S]*?)<\/g>/.exec(svg);
  if (!group) throw new Error('cast SVG carries no <g id="cast-lines"> block');
  const lines = [...group[1].matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'),
  );
  return lines.join('\n');
}

function main() {
  const fail = (msg) => { console.error(`hero-cast-svg: ${msg}`); process.exit(2); };
  let engine;
  try {
    engine = resolveEngine();
  } catch (e) {
    fail(`${e.message} — run \`npm run build\` first`);
  }

  const svg = renderCastSvg(renderHero(engine));
  const check = process.argv.includes('--check');
  console.log(`hero-cast-svg: rendering against ${engine.via}`);

  if (!check) {
    mkdirSync(path.dirname(castPath), { recursive: true });
    writeFileSync(castPath, svg);
    console.log(`hero-cast-svg: wrote ${path.relative(repoRoot, castPath)} (${svg.length} bytes)`);
    process.exit(0);
  }

  if (!existsSync(castPath)) {
    console.error(`hero-cast-svg: FAIL — ${path.relative(repoRoot, castPath)} is missing.`);
    process.exit(1);
  }
  if (readFileSync(castPath, 'utf8') !== svg) {
    console.error('\nhero-cast-svg: FAIL — the committed cast no longer matches the engine.');
    console.error('The ASSET is stale, not the engine — re-run `node scripts/hero-cast-svg.mjs`.');
    process.exit(1);
  }
  console.log('hero-cast-svg: PASS — the cast still matches the engine.');
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
