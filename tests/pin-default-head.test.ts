/**
 * pin-default-head.test.ts — resolveRevision's per-worktree HEAD default + origin/* fetch hardening.
 *
 * WHY THIS EXISTS: the pin default used to be `origin/main` — a SHARED-object-DB
 * remote-tracking ref. In a multi-worktree repo that made a pinned `bce run` grade the
 * shared remote-tracking commit while `--no-pin` graded the feature worktree — a
 * pinned-vs---no-pin DISAGREEMENT on the very same directory (the multi-worktree failure
 * mode; the CLI-level agreement ratchet lives in run-two-path-agreement.test.ts).
 * This suite proves the pin primitive itself:
 *   (HEAD-scoped)  resolveRevision(dir, 'HEAD') is WORKTREE-scoped — each worktree
 *                  resolves its OWN HEAD, never the sibling's, never origin/main;
 *   (default)      the unspecified-ref default IS 'HEAD' (per-worktree), not origin/main;
 *   (explicit)     an explicit 'origin/main' still resolves the remote-tracking sha —
 *                  offline fallback preserved (no `origin` remote configured → the
 *                  best-effort fetch fails and the cached ref answers);
 *   (local-ref)    a non-origin/* local ref (a tag) resolves with NO remote required;
 *   (tag-shadow)   for origin/* refs the fetch uses the EXPLICIT refspec form
 *                  `+refs/heads/<b>:refs/remotes/origin/<b>` — a tag literally named
 *                  `main` (a REAL trap in this very monorepo) can no longer shadow the
 *                  branch and leave the remote-tracking ref silently stale.
 * Self-contained: temp repos only — no committed fixtures, no network (origin is a local path).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRevision } from '../src/pin.js';

function git(dir: string, ...a: string[]): string {
  return execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

/** `git init -b main` + identity config (gate-honesty.test.ts idiom, branch pinned for determinism). */
function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(dir, 'config', 'user.email', 'bce-test@example.com');
  git(dir, 'config', 'user.name', 'bce-test');
}

function commitFile(dir: string, file: string, content: string, msg: string): string {
  writeFileSync(join(dir, file), content);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', msg);
  return git(dir, 'rev-parse', 'HEAD');
}

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('resolveRevision — per-worktree HEAD default (the multi-worktree fix)', () => {
  let repo: string;
  let wtOld: string;
  let c1 = '';
  let c2 = '';

  beforeAll(() => {
    const root = mkdtempSync(join(tmpdir(), 'bce-pin-head-'));
    dirs.push(root);
    repo = join(root, 'repo');
    initRepo(repo);
    c1 = commitFile(repo, 'a.txt', 'one\n', 'c1');
    c2 = commitFile(repo, 'a.txt', 'two\n', 'c2');
    // a SECOND worktree of the SAME repo, detached at the OLDER commit — the shape in
    // which the old origin/main default graded the wrong tree.
    wtOld = join(root, 'wt-old');
    git(repo, 'worktree', 'add', '--detach', wtOld, c1);
    // plant the shared remote-tracking ref at the OLD commit (git update-ref — no remote
    // needed): the sha the RETIRED default would have resolved from EVERY worktree.
    git(repo, 'update-ref', 'refs/remotes/origin/main', c1);
  });

  it("resolves each worktree's OWN HEAD — never the sibling's, never origin/main", () => {
    expect(c1).toMatch(/^[0-9a-f]{40}$/);
    expect(c2).toMatch(/^[0-9a-f]{40}$/);
    expect(c1).not.toBe(c2);
    expect(resolveRevision(repo, 'HEAD')).toBe(c2); // main worktree: its own HEAD
    expect(resolveRevision(wtOld, 'HEAD')).toBe(c1); // sibling worktree: ITS own HEAD
  });

  it("the unspecified-ref default IS 'HEAD' (per-worktree), not the planted origin/main", () => {
    // origin/main is planted at c1 — the old default would return c1 from BOTH worktrees.
    expect(resolveRevision(repo)).toBe(c2);
    expect(resolveRevision(wtOld)).toBe(c1);
  });

  it("an EXPLICIT 'origin/main' still resolves the remote-tracking sha (offline fallback preserved)", () => {
    // no `origin` remote is configured → the best-effort fetch fails → cached ref answers.
    expect(resolveRevision(repo, 'origin/main')).toBe(c1);
  });

  it('a non-origin/* local ref (a tag) resolves with NO remote round-trip', () => {
    git(repo, 'tag', 'pin-test-tag', c1);
    expect(resolveRevision(repo, 'pin-test-tag')).toBe(c1);
  });

  it('a garbage ref still throws LOUDLY (fail-closed resolution unchanged)', () => {
    expect(() => resolveRevision(repo, 'no-such-ref-xyz')).toThrow();
  });
});

describe('resolveRevision — origin/* explicit-refspec fetch (tag-shadow hardening)', () => {
  it("a tag literally named 'main' on the remote cannot shadow the branch — origin/main resolves the BRANCH head", () => {
    const root = mkdtempSync(join(tmpdir(), 'bce-pin-shadow-'));
    dirs.push(root);
    // a real (local-path) origin with BOTH refs/heads/main and refs/tags/main.
    const bare = join(root, 'origin.git');
    mkdirSync(bare, { recursive: true });
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare], { stdio: ['ignore', 'pipe', 'pipe'] });
    const work = join(root, 'work');
    initRepo(work);
    const c1 = commitFile(work, 'a.txt', 'one\n', 'c1');
    git(work, 'remote', 'add', 'origin', bare);
    git(work, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
    // clone NOW — the clone's refs/remotes/origin/main is cached at c1.
    const clone = join(root, 'clone');
    execFileSync('git', ['clone', '-q', bare, clone], { stdio: ['ignore', 'pipe', 'pipe'] });
    // the trap: a TAG named `main` at the old commit, while the BRANCH advances to c2.
    git(work, 'tag', 'main', c1);
    git(work, 'push', '-q', 'origin', 'refs/tags/main:refs/tags/main');
    const c2 = commitFile(work, 'a.txt', 'two\n', 'c2');
    git(work, 'push', '-q', 'origin', 'refs/heads/main:refs/heads/main');
    // The retired plain `git fetch origin main` resolves the bare name to refs/tags/main
    // (gitrevisions order: tags BEFORE heads) → the remote-tracking ref stays STALE at c1.
    // The explicit refspec fetch (+refs/heads/main:refs/remotes/origin/main) force-updates
    // it to the real branch head — resolveRevision must return c2, never the shadowed c1.
    expect(resolveRevision(clone, 'origin/main')).toBe(c2);
  });
});
