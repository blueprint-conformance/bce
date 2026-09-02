/**
 * materialize-stream.test.ts — materializeAtRevision must STREAM the `git archive`
 * output, never buffer it in Node memory.
 *
 * WHY THIS EXISTS (2026-08-02 ENOBUFS regression guard): the previous implementation
 * captured the whole archive tar via execFileSync with `maxBuffer: 256MiB` and then fed
 * the buffer to `tar -x` as `input`. On 2026-07-31 the host-estate tree archive crossed
 * ~259MiB → every `bce run --ref … --emit` died with `spawnSync git ENOBUFS`, freezing
 * the estate evidence-sink hash chains at the 2026-07-23 links. The fix streams
 * archive → temp-file fd → tar (spawnSync applies maxBuffer only to 'pipe' stdio,
 * never to an fd), so tree size is bounded by disk, not by a Node buffer.
 *
 * HONESTY — what this suite does and does not prove:
 *  (functional)  a real small tree materializes byte-identically at a pinned sha,
 *                including at a NON-HEAD sha, with the temp tar cleaned up;
 *  (>1MiB)       a tree whose archive exceeds Node's DEFAULT 1MiB maxBuffer
 *                materializes fine — this discriminates against any future capture of
 *                archive stdout through a DEFAULT-bounded pipe. It does NOT reproduce
 *                the 271MB host-estate archive (a synthetic tree that size makes the
 *                suite minutes-slow), so by itself it cannot catch a re-introduced
 *                EXPLICIT large bound;
 *  (structural)  the module source contains no `maxBuffer` token at all — the ratchet
 *                that catches an explicit bound (e.g. 256MiB) being re-introduced on
 *                the archive path. Source-grep is refactor-brittle by nature; if this
 *                leg ever fires on an innocent refactor, the correct response is to
 *                keep the archive bytes off Node buffers, not to delete the assertion;
 *  (error)       a bad sha still throws (spawnSync does not throw on its own — the
 *                explicit status check preserves the old execFileSync error contract).
 * Self-contained: temp repos only — no committed fixtures, no network.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeAtRevision } from '../src/pin.js';

function git(dir: string, ...a: string[]): string {
  return execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

/** `git init -b main` + identity config (pin-default-head.test.ts idiom). */
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  // The fixture asserts exact committed bytes. Do not inherit a Windows runner's
  // global core.autocrlf and accidentally mutate the fixture while staging it.
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 'bce-test@example.com');
  git(dir, 'config', 'user.name', 'bce-test');
}

const cleanups: string[] = [];
afterAll(() => cleanups.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('materializeAtRevision — streams the archive (ENOBUFS regression guard)', () => {
  let repo: string;
  let c1 = '';
  let c2 = '';

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'bce-mat-stream-'));
    cleanups.push(root);
    repo = join(root, 'repo');
    initRepo(repo);
    // c1: small tree with a subdir.
    mkdirSync(join(repo, 'sub'), { recursive: true });
    writeFileSync(join(repo, 'a.txt'), 'alpha\n');
    writeFileSync(join(repo, 'sub', 'b.txt'), 'beta\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'c1');
    c1 = git(repo, 'rev-parse', 'HEAD');
    // c2: mutate a.txt so c1 vs c2 trees are distinguishable.
    writeFileSync(join(repo, 'a.txt'), 'alpha-v2\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'c2');
    c2 = git(repo, 'rev-parse', 'HEAD');
  });

  it('materializes a small tree byte-identically and cleans up its temp tar', () => {
    const dest = materializeAtRevision(repo, c2);
    cleanups.push(dest);
    expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('alpha-v2\n');
    expect(readFileSync(join(dest, 'sub', 'b.txt'), 'utf8')).toBe('beta\n');
    // the intermediate tar must be gone (sibling `${dest}.tar`) and must not have been
    // extracted into the tree the scanner grades.
    expect(existsSync(`${dest}.tar`)).toBe(false);
    expect(readdirSync(dest).filter((f) => f.endsWith('.tar'))).toEqual([]);
  });

  it('materializes the PINNED sha, not HEAD (revision-bound contract preserved)', () => {
    const dest = materializeAtRevision(repo, c1);
    cleanups.push(dest);
    expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('alpha\n'); // c1 content, HEAD is c2
  });

  it('materializes a tree whose archive exceeds the DEFAULT 1MiB spawnSync maxBuffer', () => {
    // ~6MiB of low-compressibility-irrelevant payload: the tar on stdout is
    // UNCOMPRESSED, so any 6MiB blob makes the archive > the 1MiB default bound a
    // 'pipe'-captured stdout would enforce. Fails on any future implementation that
    // routes archive stdout through a default-bounded Node pipe.
    const big = Buffer.alloc(6 * 1024 * 1024);
    for (let i = 0; i < big.length; i += 4) big.writeUInt32LE((i * 2654435761) >>> 0, i);
    writeFileSync(join(repo, 'big.bin'), big);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'big blob');
    const cBig = git(repo, 'rev-parse', 'HEAD');

    const dest = materializeAtRevision(repo, cBig);
    cleanups.push(dest);
    const out = readFileSync(join(dest, 'big.bin'));
    expect(out.length).toBe(big.length);
    expect(out.equals(big)).toBe(true);
  });

  it('structural ratchet: pin.ts CODE carries NO maxBuffer bound on any path', () => {
    // The 2026-07-31 sink freeze was an EXPLICIT 256MiB bound; the honest cheap guard
    // against its re-introduction is that this module's CODE never passes maxBuffer
    // again — the archive bytes belong on fds/disk, never in a bounded Node buffer.
    // Comments are stripped first (the module legitimately EXPLAINS maxBuffer in prose).
    const pinSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'pin.ts'),
      'utf8',
    );
    const codeOnly = pinSource
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, '') // whole-line comments
      .replace(/([^:'"])\/\/[^\n]*/g, '$1'); // trailing comments (spares http:// in strings)
    expect(codeOnly.includes('maxBuffer')).toBe(false);
  });

  it('still throws on an unresolvable sha (error contract preserved from execFileSync)', () => {
    expect(() => materializeAtRevision(repo, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toThrow(
      /git archive/,
    );
  });
});
