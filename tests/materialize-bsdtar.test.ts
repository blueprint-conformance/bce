/**
 * Windows ships bsdtar as `System32\tar.exe`. Without `-f -` it opens its default tape device
 * (`\\.\tape0`) instead of stdin, so pinned materialization failed whenever it was the `tar` found
 * first. CI's Windows runners resolve GNU tar from Git for Windows, which accepts stdin implicitly,
 * so this test puts System32 first on PATH to exercise the stock Windows tar on purpose.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeAtRevision } from '../src/pin.js';

const systemTar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
const cleanups: string[] = [];
afterAll(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('materializeAtRevision with Windows bsdtar first on PATH', () => {
  it.skipIf(process.platform !== 'win32' || !existsSync(systemTar))('extracts the pinned tree through System32 tar', () => {
    const repo = mkdtempSync(join(tmpdir(), 'bce-bsdtar-'));
    cleanups.push(repo);
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'core.autocrlf', 'false');
    git('config', 'user.email', 'bce-test@example.com');
    git('config', 'user.name', 'bce-test');
    writeFileSync(join(repo, 'a.txt'), 'alpha\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'c1');
    const sha = git('rev-parse', 'HEAD');

    const savedPath = process.env.PATH;
    process.env.PATH = `${join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')};${savedPath ?? ''}`;
    try {
      const dest = materializeAtRevision(repo, sha);
      cleanups.push(dest);
      expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('alpha\n');
    } finally {
      process.env.PATH = savedPath;
    }
  });
});
