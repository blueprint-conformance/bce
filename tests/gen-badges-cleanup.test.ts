import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { groundTruthTests } from '../scripts/gen-badges.mjs';

it('removes the Vitest JSON report when badge ground-truth execution refuses', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'bce-badge-cleanup-'));
  const saved = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
  try {
    process.env.PATH = scratch;
    process.env.TMPDIR = process.env.TMP = process.env.TEMP = scratch;
    expect(() => groundTruthTests()).toThrow(/could not run the test suite/);
    expect(readdirSync(scratch)).toEqual([]);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  }
});
