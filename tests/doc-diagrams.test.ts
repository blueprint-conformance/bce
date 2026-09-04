/**
 * The documentation diagrams are executable documentation: generated from one
 * source, published in responsive pairs, accessible without color, and wired
 * into the page that owns each claim.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ASSETS = join(ROOT, 'assets', 'diagrams');

const concepts = [
  ['c1-required-component', 'docs/constraint-guide.md'],
  ['c2-required-dependency', 'docs/constraint-guide.md'],
  ['c3-forbidden-dependency', 'docs/constraint-guide.md'],
  ['c4-forbidden-path', 'docs/constraint-guide.md'],
  ['source-to-verdict', 'docs/quickstart.md'],
  ['exit-code-contract', 'docs/exit-codes.md'],
  ['deterministic-report', 'docs/report-contract.md'],
  ['evidence-hash-chain', 'docs/evidence-format.md'],
  ['ai-review-authority', 'docs/ai-first-review.md'],
  ['brownfield-adoption', 'docs/adopt-existing-repo.md'],
] as const;

describe('documentation diagram curriculum', () => {
  it('contains at least ten responsive concepts generated from one source', () => {
    expect(concepts.length).toBeGreaterThanOrEqual(10);
    expect(readdirSync(ASSETS).filter((name) => name.endsWith('.svg'))).toHaveLength(concepts.length * 2);

    const result = spawnSync(process.execPath, ['scripts/generate-doc-diagrams.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  it('keeps every desktop/mobile pair accessible and self-contained', () => {
    for (const [slug] of concepts) {
      for (const suffix of ['', '-mobile']) {
        const file = join(ASSETS, `${slug}${suffix}.svg`);
        const svg = readFileSync(file, 'utf8');
        expect(svg, file).toContain('role="img" aria-labelledby=');
        expect(svg, file).toContain('<title id=');
        expect(svg, file).toContain('<desc id=');
        expect(svg, file).not.toContain('<script');
        expect(svg, file).not.toContain('<foreignObject');
        expect(svg, file).not.toContain('<image');
        expect(svg, file).toContain(suffix ? 'width="760"' : 'width="1280"');
      }
    }
  });

  it('publishes each pair exactly where its explanation lives', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { files?: string[] };
    expect(packageJson.files, 'packed docs would contain broken diagram links').toContain('assets/diagrams');

    for (const [slug, source] of concepts) {
      const markdown = readFileSync(join(ROOT, source), 'utf8');
      expect(markdown, `${source} lacks ${slug}`).toContain(`../assets/diagrams/${slug}.svg`);
      expect(markdown, `${source} lacks responsive ${slug}`).toContain(`../assets/diagrams/${slug}-mobile.svg`);
      expect(markdown, `${source} lacks alt text for ${slug}`).toMatch(
        new RegExp(`<img src="\\.\\./assets/diagrams/${slug}\\.svg" alt="[^"]+">`),
      );
    }
  });

  it('preserves the normative distinctions in the C1–C4 close-ups', () => {
    const guide = readFileSync(join(ROOT, 'docs', 'constraint-guide.md'), 'utf8');
    for (const term of [
      'C1 `requiredComponent`',
      'C2 `requiredDependency`',
      'C3 `forbiddenDependency`',
      'C4 `forbiddenPath`',
      'empty target set also',
      'Every matching edge',
      'extracted components',
      'C5\n`forbiddenFile`',
    ]) expect(guide).toContain(term);
  });
});
