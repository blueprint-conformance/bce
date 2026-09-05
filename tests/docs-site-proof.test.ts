/**
 * docs-site-proof.test.ts — the docs-site assembly holds on EVERY pull request,
 * not only the path-filtered ones.
 *
 * Why this exists when .github/workflows/docs-site-check.yml already builds the
 * site: that workflow is path-filtered to the site's SOURCES (docs/, spec/,
 * rfcs/, prompts/, integrations/, llms.txt, README.md, the two scripts, the two
 * workflows). But the build resolves documentation links against the WHOLE
 * tree — the published docs link into `src/*.ts`, `tests/*.ts`,
 * `examples/**`, `corpus/MANIFEST.json`, `action.yml`, `.blueprints/`,
 * `.engine-pin.json`, and workflow files. A PR that renames or deletes one of
 * THOSE breaks the site build while touching none of the filtered paths, so
 * docs-site-check never runs on it and the red surfaces on some later,
 * unrelated docs PR (or on flip day). ci.yml's build-test-prove job runs the
 * full vitest suite on every push and pull request with no path filter — so
 * this file makes the site build (and its red path) part of that always-on
 * proof.
 *
 * Also proven here, as standing regression tests rather than one-time review:
 *
 *   - the published schemas under _site/schemas/ are byte-identical to
 *     spec/schemas/ — complete, nothing extra (the `$id` URLs keep naming
 *     exactly these bytes);
 *   - llms.txt is served verbatim at the site root;
 *   - the deploy dormancy is intact: publish-schemas.yml still carries the
 *     job-level `if: false` guard and both deploy steps, and the build-only
 *     docs-site-check workflow has grown no deploy machinery. The guard's
 *     removal is a deliberate flip-day ceremony
 *     (docs/launch/public-flip-checklist.md Phase 2), never a side effect.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const repoRoot = path.resolve(__dirname, '..');
const builder = path.join(repoRoot, 'scripts', 'build-docs-site.mjs');
const selftest = path.join(repoRoot, 'scripts', 'docs-site-selftest.mjs');
const probeCountResult = spawnSync(process.execPath, [selftest, '--print-probe-count'], {
  cwd: repoRoot, encoding: 'utf8',
});
if (probeCountResult.status !== 0 || !/^\d+$/.test(probeCountResult.stdout.trim())) {
  throw new Error(`docs self-test did not expose its probe count: ${probeCountResult.stderr}`);
}
// Each negative control stages and rebuilds the complete site. Keep the proof finite,
// but scale its deadline with the workload so supported slower runners remain valid.
const DOCS_SELFTEST_TIMEOUT_MS = Math.min(
  240_000,
  Math.max(60_000, Number(probeCountResult.stdout.trim()) * 8_000),
);

let out: string;
let build: ReturnType<typeof spawnSync>;

beforeAll(() => {
  out = mkdtempSync(path.join(os.tmpdir(), 'bce-docs-site-proof-'));
  build = spawnSync(process.execPath, [builder, '--out', out], {
    cwd: repoRoot, encoding: 'utf8',
  });
});

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe('docs-site build (always-on, unfiltered by CI paths)', () => {
  it('assembles green from the tree as-is — including every link into src/, examples/, workflows', () => {
    // The message on failure is the builder's own enumeration of what dangles.
    expect(build.status, `builder stderr:\n${build.stderr}\nstdout:\n${build.stdout}`).toBe(0);
  });

  it('produced the expected top-level route set', () => {
    for (const route of [
      'index.html',
      'llms.txt',
      'spec/index.html',
      'schemas/index.html',
      'guides/index.html',
      'guides/quickstart/index.html',
      'guides/faq/index.html',
      'agents/index.html',
      'rfcs/index.html',
      'paper/index.html',
    ]) {
      expect(existsSync(path.join(out, route)), `missing _site/${route}`).toBe(true);
    }
  });

  it('publishes the schemas byte-for-byte — complete, nothing extra', () => {
    const srcDir = path.join(repoRoot, 'spec', 'schemas');
    const outDir = path.join(out, 'schemas');
    const srcSchemas = readdirSync(srcDir).filter((f) => f.endsWith('.schema.json')).sort();
    const outSchemas = readdirSync(outDir).filter((f) => f.endsWith('.schema.json')).sort();
    expect(srcSchemas.length).toBeGreaterThan(0);
    expect(outSchemas).toEqual(srcSchemas);
    for (const f of srcSchemas) {
      const identical = readFileSync(path.join(srcDir, f)).equals(readFileSync(path.join(outDir, f)));
      expect(identical, `_site/schemas/${f} must be byte-identical to spec/schemas/${f}`).toBe(true);
    }
  });

  it('serves llms.txt verbatim at the site root', () => {
    const identical = readFileSync(path.join(repoRoot, 'llms.txt'))
      .equals(readFileSync(path.join(out, 'llms.txt')));
    expect(identical).toBe(true);
  });

  it('ships the BCE identity and share metadata on root and nested pages', () => {
    const root = readFileSync(path.join(out, 'index.html'), 'utf8');
    const nested = readFileSync(path.join(out, 'guides', 'quickstart', 'index.html'), 'utf8');

    expect(root).toContain('<link rel="canonical" href="https://blueprint-conformance.github.io/bce/">');
    expect(root).toContain('<link rel="icon" href="./assets/bce-avatar.svg" type="image/svg+xml">');
    expect(nested).toContain('<link rel="icon" href="../../assets/bce-avatar.svg" type="image/svg+xml">');
    expect(nested).toContain(
      '<meta property="og:url" content="https://blueprint-conformance.github.io/bce/guides/quickstart/">',
    );
    for (const html of [root, nested]) {
      expect(html).toContain('<meta name="theme-color" content="#080919">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain(
        '<meta property="og:image" content="https://blueprint-conformance.github.io/bce/assets/bce-social-card.png">',
      );
    }
  });

  it('publishes the favicon and social card byte-for-byte', () => {
    for (const asset of ['bce-avatar.svg', 'bce-social-card.png']) {
      const identical = readFileSync(path.join(repoRoot, 'assets', asset))
        .equals(readFileSync(path.join(out, 'assets', asset)));
      expect(identical, `_site/assets/${asset} must match assets/${asset}`).toBe(true);
    }

    const socialCard = readFileSync(path.join(out, 'assets', 'bce-social-card.png'));
    expect(socialCard.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(socialCard.readUInt32BE(16)).toBe(1280);
    expect(socialCard.readUInt32BE(20)).toBe(640);
    expect(socialCard.byteLength).toBeLessThan(1_000_000);
  });

  it('can go red — every builder check refuses its own planted probe', () => {
    const r = spawnSync(process.execPath, [selftest], { cwd: repoRoot, encoding: 'utf8' });
    expect(r.status, `selftest stderr:\n${r.stderr}\nstdout:\n${r.stdout}`).toBe(0);
  }, DOCS_SELFTEST_TIMEOUT_MS);
});

describe('the post-flip deploy activation is intact', () => {
  const wfDir = path.join(repoRoot, '.github', 'workflows');
  const publishWf = readFileSync(path.join(wfDir, 'publish-schemas.yml'), 'utf8');
  const checkWf = readFileSync(path.join(wfDir, 'docs-site-check.yml'), 'utf8');

  it('publish-schemas.yml carries no job-level if: false and still has both deploy steps', () => {
    // Before the flip this asserted the guard was PRESENT: publishing could not be
    // activated by accident while the $id base could not resolve. The flip happened
    // and Pages is enabled, so the assertion inverts rather than disappears — the
    // property worth holding is now that nobody silently re-dormants the publisher
    // and strands every schema $id at 404. The guard is a 4-space-indented job-level
    // key, so this matches the authored shape exactly and ignores prose mentions.
    expect(publishWf).not.toMatch(/^    if: false$/m);
    // The repo enforces actions/permissions.sha_pinning_required. Require the v5
    // family whose transitive artifact upload is also immutable, with the reviewed
    // 40-hex commit here and the release family retained as a trailing comment.
    expect(publishWf).toMatch(/uses: actions\/upload-pages-artifact@[0-9a-f]{40}\s+# v5/);
    expect(publishWf).toMatch(/uses: actions\/deploy-pages@(v4\b|[0-9a-f]{40}\s+# v4)/);
    // The deploy steps still belong to a real job with a steps block.
    const stepsAt = publishWf.indexOf('    steps:');
    expect(stepsAt).toBeGreaterThan(-1);
  });

  it('docs-site-check.yml remains build-only — no deploy machinery, no Pages permissions', () => {
    expect(checkWf).not.toContain('upload-pages-artifact');
    expect(checkWf).not.toContain('deploy-pages');
    expect(checkWf).not.toContain('pages: write');
    expect(checkWf).not.toContain('id-token: write');
  });
});
