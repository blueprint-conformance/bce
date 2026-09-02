import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const ROOT = path.join(__dirname, '..');

describe('research execution halt', () => {
  it.each([{ args: [] as string[] }, { args: ['--study'] }, { args: ['--model-eval'] }])('refuses an unfrozen/unpopulated protocol ($args)', ({ args }) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/research-readiness.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('REFUSED');
  });
});
