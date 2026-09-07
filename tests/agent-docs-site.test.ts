import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishAgentDocs } from '../scripts/lib/agent-docs-site.mjs';

const temporary: string[] = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'bce-agent-docs-'));
  temporary.push(base);
  const repoRoot = join(base, 'repo');
  const outDir = join(base, 'site');
  mkdirSync(join(repoRoot, 'docs'), { recursive: true });
  mkdirSync(outDir);
  return { repoRoot, outDir, sources: [], origin: 'https://example.com/bce', repository: 'example/bce' };
}

describe('browser-free agent documentation', () => {
  it('publishes a navigable document graph while preserving commands and example links', () => {
    const input = fixture();
    writeFileSync(join(input.repoRoot, 'llms.txt'), '# BCE\n[Start](docs/start.md#run)\n');
    writeFileSync(join(input.repoRoot, 'docs', 'start.md'),
      '# Start\n## Run\n[Back](../llms.txt)\n[Details](details.md)\n' +
      '`[example](missing.md)`\n```sh\necho "[example](missing.md)"\n```\n');
    writeFileSync(join(input.repoRoot, 'docs', 'details.md'), '# Details\n');
    const published = publishAgentDocs(input);
    expect(published).toEqual(['docs/details.md', 'docs/start.md', 'llms.txt']);
    expect(readFileSync(join(input.outDir, 'llms.txt'), 'utf8'))
      .toContain('[Start](https://example.com/bce/source/docs/start.md#run)');
    const start = readFileSync(join(input.outDir, 'source', 'docs', 'start.md'), 'utf8');
    expect(start).toContain('[Back](https://example.com/bce/source/llms.txt)');
    expect(start).toContain('[Details](https://example.com/bce/source/docs/details.md)');
    expect(start).toContain('`[example](missing.md)`');
    expect(start).toContain('```sh\necho "[example](missing.md)"\n```');
  });

  it('keeps evidence text on its source host without interpreting regexes as Markdown', () => {
    const input = fixture();
    writeFileSync(join(input.repoRoot, 'llms.txt'), '# BCE\n[Evidence](review.txt)\n[Issue](../../issues/new?template=bug.yml)\n[Security](SECURITY.md)\n');
    writeFileSync(join(input.repoRoot, 'SECURITY.md'), '# Security\nCanonical disclosure contact.\n');
    writeFileSync(join(input.repoRoot, 'review.txt'), "['\"](?!node:crypto|\\.{1,2}/)\n");
    expect(publishAgentDocs(input)).toEqual(['llms.txt']);
    const index = readFileSync(join(input.outDir, 'llms.txt'), 'utf8');
    expect(index).toContain('https://raw.githubusercontent.com/example/bce/main/review.txt');
    expect(index).toContain('https://github.com/example/bce/issues/new?template=bug.yml');
    expect(index).toContain('https://raw.githubusercontent.com/example/bce/main/SECURITY.md');
  });

  it('refuses traversal beyond the repository instead of reading or copying it', () => {
    const input = fixture();
    writeFileSync(join(input.repoRoot, 'llms.txt'), '# BCE\n[Escape](../outside.md)\n');
    writeFileSync(join(input.repoRoot, '..', 'outside.md'), 'outside fixture');
    expect(() => publishAgentDocs(input)).toThrow('link escapes repository');
  });
});
