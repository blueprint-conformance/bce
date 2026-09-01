/**
 * pre-commit-hook.test.ts — the pre-commit integration (`integrations/pre-commit/bce-gate.sh`)
 * EXECUTES against real fixture trees; the snippet is proven, not just documented.
 *
 * The hook's contract:
 *   1. EXIT-CODE PASSTHROUGH (fail-closed): the hook exits with the gate's own code, both
 *      directions — a conformant tree is 0, a seeded-drift tree is 1. A hook that could not
 *      redden would be a bug (a test that cannot fail proves nothing).
 *   2. DIRECT MODE (`BCE_REPO_DIR`): gate a directory as-is, no git required — the documented
 *      env-override surface this suite drives against fixtures/extension-surface.
 *   3. GIT MODE (the real pre-commit path): gates the STAGED tree via `git checkout-index`, so
 *      an unstaged violation does NOT leak into the graded tree, and an empty index exits 0
 *      WITHOUT invoking the engine at all.
 *
 * All overrides (`BCE_BIN`, `BCE_REPO_DIR`, `BCE_BLUEPRINT_DIR`) are exercised. `BCE_BIN` points
 * at the repo's own CLI source via tsx — the same engine the `bce` bin ships.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK = join(HERE, '..', 'integrations', 'pre-commit', 'bce-gate.sh');
const CLI = join(HERE, '..', 'src', 'cli.ts');
const FIXROOT = join(HERE, '..', 'fixtures');
const BLUEPRINT = join(FIXROOT, 'luna-chat-extension.blueprint.json');
const CONFORMANT = join(FIXROOT, 'extension-surface', 'conformant');
const DRIFT = join(FIXROOT, 'extension-surface', 'drift-forbidden-import');

/** The real engine, source form — the hook word-splits BCE_BIN by design. The tsx bin is
 * addressed ABSOLUTELY so the hook works from any cwd (git mode runs inside a scratch repo). */
const TSX = join(HERE, '..', 'node_modules', '.bin', 'tsx');
const BCE_BIN = `${TSX} ${CLI}`;

function runHook(
  env: Record<string, string>,
  cwd?: string,
): { code: number; output: string } {
  try {
    const output = execFileSync('sh', [HOOK], {
      encoding: 'utf8',
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, BCE_BIN, ...env },
    });
    return { code: 0, output };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

function git(repo: string, ...args: string[]): void {
  execFileSync('git', ['-C', repo, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** A scratch git repo carrying one fixture tree + the isolated blueprint dir, fully staged. */
function makeStagedRepo(fixtureTree: string): string {
  const repo = mkdtempSync(join(tmpdir(), 'bce-hook-repo-'));
  git(repo, 'init', '-q');
  cpSync(join(fixtureTree, 'src'), join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, '.blueprints'), { recursive: true });
  writeFileSync(join(repo, '.blueprints', 'luna-chat-extension.blueprint.json'), readFileSync(BLUEPRINT, 'utf8'));
  git(repo, 'add', '-A');
  return repo;
}

let bpDir: string;

beforeAll(() => {
  // Direct mode gets an isolated blueprint dir (mirrors mcp-server.test.ts / ci.yml's RED/GREEN
  // leg) so the full sweep grades exactly the discriminating contract.
  const tmp = mkdtempSync(join(tmpdir(), 'bce-hook-'));
  bpDir = join(tmp, 'bp');
  mkdirSync(bpDir, { recursive: true });
  writeFileSync(join(bpDir, 'luna-chat-extension.blueprint.json'), readFileSync(BLUEPRINT, 'utf8'));
});

describe('pre-commit hook — DIRECT mode (BCE_REPO_DIR / BCE_BLUEPRINT_DIR overrides)', () => {
  it('GREEN: the conformant fixture tree exits 0', () => {
    const r = runHook({ BCE_REPO_DIR: CONFORMANT, BCE_BLUEPRINT_DIR: bpDir });
    expect(r.output).toContain('luna-chat-extension');
    expect(r.code).toBe(0);
  });

  it('RED: the seeded-drift tree exits 1 with the violated constraint named (passthrough can fail)', () => {
    const r = runHook({ BCE_REPO_DIR: DRIFT, BCE_BLUEPRINT_DIR: bpDir });
    expect(r.code).toBe(1);
    expect(r.output).toContain('no-direct-provider-sdk');
  });
});

describe('pre-commit hook — GIT mode (gates the STAGED tree)', () => {
  it('a staged conformant tree passes (exit 0)', () => {
    const repo = makeStagedRepo(CONFORMANT);
    const r = runHook({}, repo);
    expect(r.output).toContain('luna-chat-extension');
    expect(r.code).toBe(0);
  });

  it('a staged violation blocks the commit (exit 1, constraint named)', () => {
    const repo = makeStagedRepo(DRIFT);
    const r = runHook({}, repo);
    expect(r.code).toBe(1);
    expect(r.output).toContain('no-direct-provider-sdk');
  });

  it('an UNSTAGED violation does not leak: staged=conformant, working tree=drift → still 0', () => {
    // This is the checkout-index guarantee — the hook grades what will be committed, not the dirty
    // working tree. Overwrite the extension file on disk with the drift version WITHOUT re-staging.
    const repo = makeStagedRepo(CONFORMANT);
    const rel = join('src', 'extensions', 'luna-chat.extension.ts');
    writeFileSync(join(repo, rel), readFileSync(join(DRIFT, rel), 'utf8'));
    const r = runHook({}, repo);
    expect(r.code).toBe(0);
  });

  it('deleting the last staged blueprint is graded and refuses the commit', () => {
    const repo = makeStagedRepo(CONFORMANT);
    git(repo, '-c', 'user.name=bce-test', '-c', 'user.email=bce@example.invalid', 'commit', '-qm', 'initial');
    rmSync(join(repo, '.blueprints', 'luna-chat-extension.blueprint.json'));
    git(repo, 'add', '-A');
    const r = runHook({}, repo);
    expect(r.code).toBe(2);
    expect(r.output).toContain('0 blueprint(s) discovered');
  });

  it('an empty index exits 0 WITHOUT invoking the engine (BCE_BIN is a guaranteed-failing command)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'bce-hook-empty-'));
    git(repo, 'init', '-q');
    // If the hook invoked the engine at all, this BCE_BIN would make it fail loudly.
    const r = runHook({ BCE_BIN: '/nonexistent-bce-binary' }, repo);
    expect(r.code).toBe(0);
  });
});
