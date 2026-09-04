/**
 * root-readme-proof — the FRONT PAGE's terminal output is proven against the engine, not typed.
 *
 * WHY THIS EXISTS. `tests/examples-readme-proof.test.ts` closed this class for the two
 * walkthrough READMEs after #29's three-way `teeth` verdict silently staled the quickstart's
 * step-1 output block while every CI leg stayed green. The repo-root README had no such proof:
 * its only embedded technical content was the Action-usage YAML, so there was nothing to
 * stale — and the moment the landing page grew a hero demo, it inherited exactly the failure
 * mode its sibling had just been hardened against, on the one page read first and re-run least.
 *
 * So the page does not carry a hand-written demo. It carries the output of
 * `scripts/hero-demo-record.mjs`, and this suite re-runs THAT SAME RENDERER against a live
 * engine and asserts the page still matches it byte-for-byte. The renderer is imported, not
 * re-implemented: a second copy of the command list here could drift from the script's copy
 * independently of the engine, which would put a third thing to keep in sync on the page whose
 * whole point is that nothing has to be kept in sync by hand.
 *
 * Direction of repair is fixed (the witness-kit-replay rule): if this reds, the PAGE is
 * regenerated to match the engine — never the engine bent to match the page.
 *
 * The last front-page case is the one that keeps this honest over time: the page must carry
 * exactly one ```console fence, and its bytes must equal the excerpt derived from the live run.
 * Without that cardinality check, someone could add a second unproven output block beside the
 * proven one and leave a byte-proof with a hole in it.
 *
 * No LLM, no network — pure CLI + filesystem, over the in-tree quickstart fixtures.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderHero,
  renderFull,
  renderReadmeExcerpt,
  resolveEngine,
  HERO_COMMANDS,
  FULL_COMMANDS,
} from '../scripts/hero-demo-record.mjs';
import { renderCastSvg, extractTranscript } from '../scripts/hero-cast-svg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const README = join(ROOT, 'README.md');
const TRANSCRIPT = join(ROOT, 'docs', 'launch', 'hero-demo.txt');
const CAST = join(ROOT, 'assets', 'hero-cast.svg');

let readme: string;
let hero: string;
let full: string;
let excerpt: string;

beforeAll(() => {
  readme = readFileSync(README, 'utf8');
  // Rendered ONCE and shared: each render spawns a real engine process per command, and the
  // cases below assert different properties of the SAME live run rather than re-paying for it.
  const engine = resolveEngine();
  hero = renderHero(engine);
  full = renderFull(engine);
  excerpt = renderReadmeExcerpt(hero);
});

/** Every fenced block tagged `console` on the page — the blocks that claim to be engine output. */
function consoleBlocks(md: string): string[] {
  const out: string[] = [];
  const re = /^```console\n([\s\S]*?)^```$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push(m[1] as string);
  return out;
}

describe('root README — the compact demo is byte-exact against a live engine run', () => {
  it('carries the engine-derived excerpt verbatim', () => {
    expect(
      readme.includes(excerpt),
      'README.md does not carry the engine-derived compact excerpt.\n' +
        'The PAGE is stale, not the engine — re-run `node scripts/hero-demo-record.mjs`\n' +
        'and paste the emitted block into the README fence.\n\n' +
        `--- ENGINE-DERIVED EXCERPT ---\n${excerpt}`,
    ).toBe(true);
  });

  it('the checked-in full transcript still matches the engine', () => {
    expect(existsSync(TRANSCRIPT), `${TRANSCRIPT} is missing — run \`node scripts/hero-demo-record.mjs\``).toBe(true);
    expect(readFileSync(TRANSCRIPT, 'utf8')).toBe(full);
  });

  it('the page carries one console block and it is exactly the proven excerpt', () => {
    const blocks = consoleBlocks(readme);
    expect(blocks, 'README console proof drifted from the engine-derived excerpt').toEqual([excerpt]);
  });

  it('the hero demo claims nothing the quickstart walkthrough does not already prove', () => {
    // HERO_COMMANDS must be a subset of the four commands tests/examples-readme-proof.test.ts
    // already asserts end-to-end. The landing page re-cuts the guaranteed path; it never opens
    // a second set of promises that would have to be kept true separately.
    const proven = new Set(FULL_COMMANDS.map((c: string[]) => c.join(' ')));
    for (const c of HERO_COMMANDS as string[][]) {
      expect(proven.has(c.join(' ')), `hero command is not one the walkthrough proves: bce ${c.join(' ')}`).toBe(true);
    }
  });

  // The archived animation is the one proof artifact a reader cannot copy out and re-run,
  // which makes it the one thing that could quietly disagree with the engine. It carries the
  // transcript as literal <text> nodes, so those are read back out and compared to the same
  // live run the excerpt above is cut from. An image that cannot be proven does not belong in
  // this proof set (see the amended VISUAL-ASSET DECISION in scripts/hero-demo-record.mjs).
  it('the animated cast carries the engine\'s transcript, line for line', () => {
    expect(existsSync(CAST), `${CAST} is missing — run \`node scripts/hero-cast-svg.mjs\``).toBe(true);
    const embedded = extractTranscript(readFileSync(CAST, 'utf8'));
    expect(
      embedded,
      'assets/hero-cast.svg no longer carries the engine\'s actual transcript.\n' +
        'The ASSET is stale, not the engine — re-run `node scripts/hero-cast-svg.mjs`.',
    ).toBe(hero);
  });

  it('the committed cast is byte-identical to a fresh render', () => {
    // Stronger than the line comparison above: catches a change to the DRAWING (geometry,
    // colours, timing) that leaves the text intact but was never regenerated, so the
    // committed asset and the generator cannot drift apart either.
    expect(readFileSync(CAST, 'utf8')).toBe(renderCastSvg(hero));
  });

  it('keeps the complete proof off-page but directly linked from the excerpt', () => {
    expect(readme, 'README no longer links the complete transcript').toContain('docs/launch/hero-demo.txt');
    expect(readFileSync(TRANSCRIPT, 'utf8')).toBe(full);
  });

  it('the recorded transcript leaks no local filesystem chrome', () => {
    // The recording runs on a maintainer's machine and on CI. A transcript that captured an
    // absolute path would publish the recorder's directory layout on the front page — and
    // leakage-gate scans for banned strings, not for "this looks like somebody's home dir".
    for (const [label, text] of [['hero', hero], ['full', full]] as const) {
      expect(text, `${label} transcript leaked an absolute path`).not.toMatch(/(^|\s)\/(Users|home|root|private|tmp)\//);
      expect(text, `${label} transcript leaked the repository root path`).not.toContain(ROOT);
    }
  });
});
