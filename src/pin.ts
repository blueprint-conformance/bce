/**
 * Revision pinning — materialize a clean, frozen tree of the target repo at a resolved
 * SHA via `git archive`, so the scan is (a) revision-bound and (b) immune to the
 * multi-worktree feature-branch trap (the CT working tree is often on a branch where
 * the object routes are ABSENT — the scanner must read the pinned commit, never the
 * working tree). A git-archive tree at a fixed SHA is byte-stable → deterministic input.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function git(repoDir: string, args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();
}

/**
 * Resolve a ref (default HEAD — per-worktree) to a 40-char SHA.
 *
 * WHY the default is HEAD, not origin/main: `git -C <worktreeDir> rev-parse HEAD` is
 * WORKTREE-scoped, while `origin/main` lives in the SHARED object DB every worktree of a
 * repo reads. In a multi-worktree repo, defaulting the pin to origin/main made a pinned
 * run grade the shared remote-tracking commit while `--no-pin` graded the feature
 * worktree's files — a pinned-vs---no-pin DISAGREEMENT on the very same directory (the
 * multi-worktree failure mode). HEAD makes both paths grade the same commit; a caller
 * that wants the remote state says `origin/main` EXPLICITLY (explicit-over-implicit).
 *
 * Local refs (HEAD, a branch, a tag) take NO remote round-trip — a local commit needs no
 * fetch. Only origin/* remote-tracking refs fetch first for freshness, and via the
 * EXPLICIT refspec form (+refs/heads/<branch>:refs/remotes/origin/<branch>): a plain
 * `git fetch origin <name>` is tag-shadow-vulnerable — a tag named `main` shadows the
 * branch (a REAL trap in this very monorepo) and silently updates the wrong ref.
 */
export function resolveRevision(repoDir: string, ref = 'HEAD'): string {
  if (/^origin\//.test(ref)) {
    const branch = ref.replace(/^origin\//, '');
    // fetch is best-effort — an offline run still resolves a cached ref.
    try {
      git(repoDir, ['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`, '--quiet']);
    } catch {
      /* offline: resolve against the cached ref */
    }
  }
  const sha = git(repoDir, ['rev-parse', ref]);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`could not resolve ${ref} to a SHA (got: ${sha})`);
  return sha;
}

/**
 * Materialize the repo at `sha` into a fresh temp dir via `git archive | tar -x`.
 * Returns the temp dir path (caller cleans up). The tree is a frozen snapshot of the
 * commit — no working-tree contamination, byte-stable across runs on the same SHA.
 *
 * STREAMING, NEVER BUFFERED (2026-08-02 ENOBUFS fix): the previous implementation
 * captured the whole `git archive` tar into a Node Buffer via execFileSync with
 * `maxBuffer: 256MiB`, then fed that buffer to `tar -x` as `input`. The host-estate
 * tree archive crossed ~259MiB on 2026-07-31 → every archive spawn died with
 * `spawnSync git ENOBUFS`, which froze the estate evidence-sink hash chains (no new
 * chain links after 2026-07-31T13:54Z). ANY in-memory bound re-creates that cliff for
 * a sufficiently large tree, so the archive bytes must NEVER transit a bounded Node
 * buffer: `git archive` stdout is written straight to a temp-file fd (an OS-level
 * write — spawnSync applies maxBuffer only to 'pipe' stdio, not to an fd), and
 * `tar -x` reads the same fd as stdin. Tree size is now bounded by disk, not memory.
 */
export function materializeAtRevision(repoDir: string, sha: string): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-ct-'));
  // Sibling to dest (NOT inside it — the tar must never appear in the materialized
  // tree the scanner grades). mkdtemp guarantees dest is unique, so `${dest}.tar` is too.
  const tarPath = `${dest}.tar`;
  try {
    // Hop 1: git archive <sha> → temp file, stdout streamed to the fd (no Node buffer).
    const outFd = fs.openSync(tarPath, 'w');
    let archive;
    try {
      archive = spawnSync('git', ['-C', repoDir, 'archive', sha], {
        stdio: ['ignore', outFd, 'pipe'],
      });
    } finally {
      fs.closeSync(outFd);
    }
    if (archive.error) throw archive.error;
    if (archive.status !== 0) {
      throw new Error(
        `git archive ${sha} failed (exit ${archive.status}): ${archive.stderr?.toString().trim() ?? ''}`,
      );
    }
    // Hop 2: tar -x reads the temp file as stdin (fd again — still no Node buffer).
    const inFd = fs.openSync(tarPath, 'r');
    let extract;
    try {
      extract = spawnSync('tar', ['-x', '-C', dest], {
        stdio: [inFd, 'ignore', 'pipe'],
      });
    } finally {
      fs.closeSync(inFd);
    }
    if (extract.error) throw extract.error;
    if (extract.status !== 0) {
      throw new Error(
        `tar -x failed (exit ${extract.status}): ${extract.stderr?.toString().trim() ?? ''}`,
      );
    }
  } finally {
    fs.rmSync(tarPath, { force: true });
  }
  return dest;
}
