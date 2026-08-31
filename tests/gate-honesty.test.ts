/**
 * Repo-tagged reports + gate revision honesty.
 *
 * Proves: (a) `report.repo` is an OMIT-NOT-EMPTY additive passthrough — ABSENT unless the caller
 * provides one, so every pre-B2 report is byte-identical (the widen-only proof at the byte level);
 * (b) gate-mode revision honesty — a git tree reports its real HEAD sha, a non-git tree keeps the
 * historical 'unpinned' label; (c) the repo-identity check is WARN-only, never a failure
 * (`scope.repositories` was display-only in 0.2.x — failing would be a behavior change).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runGate, resolveTreeRevision } from '../src/gate.js';
import { parseBlueprint } from '../src/schema.js';
import { resolveExtraction, AstExtractor } from '../src/extractors.js';
import { evaluate, stableStringify } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
const blueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));

/** Arrange a throwaway contributor repo (gate.test.ts pattern). */
function arrangeRepo(sourceVariant: 'conformant'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-honesty-'));
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  fs.copyFileSync(BP_PATH, path.join(dir, '.blueprints', path.basename(BP_PATH)));
  const srcFrom = path.join(FIXROOT, 'extension-surface', sourceVariant, 'src');
  fs.cpSync(srcFrom, path.join(dir, 'src'), { recursive: true });
  return dir;
}

function gitInitCommit(dir: string): string {
  const git = (...a: string[]) =>
    execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.email', 'bce-test@example.com');
  git('config', 'user.name', 'bce-test');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return git('rev-parse', 'HEAD');
}

describe('evaluate — report.repo passthrough (omit-not-empty)', () => {
  const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
  const graph = new AstExtractor(cfg).extract(path.join(FIXROOT, 'extension-surface', 'conformant'), 'rev-x');

  it('ABSENT repoName → the repo key is OMITTED entirely (pre-B2 bytes unchanged)', () => {
    const report = evaluate(blueprint, graph, 'plugin-surface');
    expect('repo' in report).toBe(false);
    // byte-level widen-only proof: two no-repoName runs are byte-identical AND carry no repo key.
    expect(stableStringify(report)).toBe(stableStringify(evaluate(blueprint, graph, 'plugin-surface')));
    expect(stableStringify(report)).not.toContain('"repo"');
  });

  it('provided repoName → stamped verbatim', () => {
    const report = evaluate(blueprint, graph, 'plugin-surface', 'example-org/service-alpha');
    expect(report.repo).toBe('example-org/service-alpha');
  });
});

describe('runGate — revision honesty', () => {
  it("a NON-git tree keeps the historical 'unpinned' label (0.2.x behavior preserved)", () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.reports[0].ctRepoRevision).toBe('unpinned');
  });

  it('a GIT tree reports its real HEAD sha (a fact of the tree — determinism holds)', () => {
    const dir = arrangeRepo('conformant');
    const sha = gitInitCommit(dir);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect(r.reports[0].ctRepoRevision).toBe(sha);
    expect(r.failed).toBe(false);
  });

  it("resolveTreeRevision falls back to 'unpinned' on a non-git dir (never throws)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-nogit-'));
    expect(resolveTreeRevision(dir)).toBe('unpinned');
    expect(resolveTreeRevision('/nonexistent/dir/xyz')).toBe('unpinned');
  });
});

describe('runGate — repo-identity (WARN-only, never a failure)', () => {
  it('mismatched --repo-name → WARN naming both identities, gate still passes', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast', 'example-org/some-other-repo');
    expect(r.failed).toBe(false); // WARN-only — scope.repositories was display-only in 0.2.x
    expect(r.warnings).toBeDefined();
    expect(r.warnings![0]).toContain('example-org/some-other-repo');
    expect(r.warnings![0]).toContain('agent-host'); // the blueprint's declared scope
    // and the repo tag is stamped on the report regardless of the mismatch (an honest fact).
    expect(r.reports[0].repo).toBe('example-org/some-other-repo');
  });

  it('matching --repo-name → no warnings, repo stamped', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast', 'agent-host');
    expect(r.warnings).toBeUndefined();
    expect(r.reports[0].repo).toBe('agent-host');
  });

  it('ABSENT repoName → no warnings key, no repo key (the pre-B2 GateResult shape)', () => {
    const dir = arrangeRepo('conformant');
    const r = runGate(dir, path.join(dir, '.blueprints'), null, 'ast');
    expect('warnings' in r).toBe(false);
    expect('repo' in r.reports[0]).toBe(false);
  });
});
