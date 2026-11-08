import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { devEntries, publishShrinkwrap, withPublishShrinkwrap } from '../scripts/lib/publish-shrinkwrap.mjs';

const repoLock = fs.readFileSync(path.join(__dirname, '..', 'npm-shrinkwrap.json'), 'utf8');

describe('published npm-shrinkwrap.json', () => {
  it('drops every development entry and keeps the runtime tree, including the brace-expansion pin', () => {
    const full = JSON.parse(repoLock);
    expect(devEntries(full).length).toBeGreaterThan(0);
    const published = JSON.parse(publishShrinkwrap(repoLock));
    expect(devEntries(published)).toEqual([]);
    const runtime = Object.keys(full.packages).filter((key) => key === '' || full.packages[key].dev !== true);
    expect(Object.keys(published.packages).sort()).toEqual(runtime.sort());
    expect(published.packages['node_modules/brace-expansion'].version).toBe(full.packages['node_modules/brace-expansion'].version);
    expect(published.packages['node_modules/ts-morph']).toBeDefined();
    expect(published.packages['node_modules/vitest']).toBeUndefined();
  });

  it('is idempotent, so the baked digest equals the digest of the packed file', () => {
    const once = publishShrinkwrap(repoLock);
    expect(publishShrinkwrap(once)).toBe(once);
  });

  it('restores the full lock byte for byte, even when packing throws', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-publish-shrinkwrap-'));
    try {
      const file = path.join(root, 'npm-shrinkwrap.json');
      fs.writeFileSync(file, repoLock);
      const seen = withPublishShrinkwrap(root, () => devEntries(JSON.parse(fs.readFileSync(file, 'utf8'))).length);
      expect(seen).toBe(0);
      expect(fs.readFileSync(file, 'utf8')).toBe(repoLock);
      expect(() => withPublishShrinkwrap(root, () => { throw new Error('pack failed'); })).toThrow('pack failed');
      expect(fs.readFileSync(file, 'utf8')).toBe(repoLock);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
