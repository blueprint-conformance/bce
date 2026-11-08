/**
 * Frozen-source reads exclude the caller's global Git configuration through GIT_CONFIG_GLOBAL,
 * which Git first honours in 2.32. Older Git silently reads ~/.gitconfig instead, so the engine
 * refuses there with a named floor rather than grading with mutable configuration in scope.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalGitEnvironment, gitIsolatesGlobalConfig } from '../src/pin.js';

describe('Git global-configuration isolation floor', () => {
  it.each([
    ['git version 2.29.2.windows.2', false],
    ['git version 2.31.1', false],
    ['git version 2.32.0', true],
    ['git version 2.51.0\n', true],
    ['git version 3.0.0', true],
    ['not git', false],
  ])('%j isolates global config: %s', (line, expected) => {
    expect(gitIsolatesGlobalConfig(line)).toBe(expected);
  });

  it('refuses on Git without GIT_CONFIG_GLOBAL and isolates global config otherwise', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bce-git-floor-'));
    try {
      const emptyConfig = join(dir, 'empty.config');
      writeFileSync(emptyConfig, '');
      const local = execFileSync('git', ['--version'], { encoding: 'utf8' });
      if (gitIsolatesGlobalConfig(local)) {
        const env = canonicalGitEnvironment(emptyConfig);
        expect(execFileSync('git', ['config', '--global', '--list'], { env, encoding: 'utf8', cwd: dir })).toBe('');
      } else {
        expect(() => canonicalGitEnvironment(emptyConfig)).toThrow(/need Git 2\.32 or newer/);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
