import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Evidence Foundry v3 architecture foundation', () => {
  it('passes the registry, staged-claim, power, archive, and hostile-input self-test', () => {
    const result = spawnSync(process.execPath, [resolve(process.cwd(), 'scripts/evidence-foundry-v3.selftest.mjs')], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('Evidence Foundry v3 foundation self-test: PASS');
  });
});
