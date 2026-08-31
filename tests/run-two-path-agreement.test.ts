/**
 * run-two-path-agreement.test.ts — the multi-worktree pinned-vs---no-pin agreement ratchet.
 *
 * THE DEFECT THIS PINS DOWN: `bce run` (pinned, no --ref) used to default the revision to
 * `origin/main` — a SHARED-object-DB remote-tracking ref. In a multi-worktree repo the
 * feature worktree's HEAD and origin/main are DIFFERENT commits, so the pinned path graded
 * a tree the operator was NOT looking at while `--no-pin` graded the real one: the two
 * paths DISAGREED on the very same --ct-repo (the multi-worktree failure mode). The fix
 * defaults the unspecified ref to HEAD (worktree-scoped); an explicit --ref (origin/main,
 * any ref, or a 40-hex sha) is honored verbatim.
 *
 * Fixture (self-contained temp git repo — no committed fixtures, no network): HEAD (the
 * feature state) carries a barrel index.ts + attach-route.ts (both legitimately importing
 * './session-attach.js') + cycles-route.tsx/dashboard-route.tsx (the re-implementation
 * seam, also importing it), with refs/remotes/origin/main planted (git update-ref) at an
 * OLDER commit lacking ALL of those files. One forbiddenDependency scoped (scopePaths) to
 * the 2 route files — the attach-planner shape this defect was found on.
 *
 * Proves, driving the REAL CLI (author-cli.test.ts spawn idiom):
 *   (AGREEMENT)   pinned (no --ref) and --no-pin produce BYTE-IDENTICAL violations —
 *                 both graded on HEAD (exactly the 2 routes; barrel + attach-route exempt);
 *   (REVISION)    the pinned report's ctRepoRevision IS the worktree HEAD sha;
 *   (EXPLICIT)    --ref origin/main still resolves the origin/main sha and grades THAT
 *                 older tree (0 violations — a genuinely different commit was graded);
 *   (PASSTHROUGH) an explicit 40-hex sha is honored verbatim as the revision.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComplianceReport } from '../src/report.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.ts');

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    // `node --import tsx` not `npx tsx` — skips npx's per-invocation package-resolution walk
    // (the dominant, variable cold-start cost), byte-identical output, ~30-45% faster on CI.
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function git(dir: string, ...a: string[]): string {
  return execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
}

let tmp: string;
let repo: string;
let bp: string;
let oldSha = '';
let headSha = '';

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bce-two-path-'));
  repo = join(tmp, 'repo');
  const tui = join(repo, 'src', 'tui');
  mkdirSync(tui, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: ['ignore', 'pipe', 'pipe'] });
  git(repo, 'config', 'user.email', 'bce-test@example.com');
  git(repo, 'config', 'user.name', 'bce-test');

  // OLDER commit — the state origin/main will point at: NONE of the feature files exist,
  // just one in-scope placeholder so an explicit --ref origin/main run scans >= minFiles.
  writeFileSync(join(tui, 'other.ts'), 'export const placeholder = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'old: pre-feature state');
  oldSha = git(repo, 'rev-parse', 'HEAD');

  // HEAD (feature state): the barrel + factory-route import legitimately; the two ROUTE
  // files re-implement attach (the seam the blueprint reddens via scopePaths).
  writeFileSync(join(tui, 'session-attach.ts'), 'export function attachToSession() {}\n');
  writeFileSync(join(tui, 'index.ts'), "export { attachToSession } from './session-attach.js';\n");
  writeFileSync(join(tui, 'attach-route.ts'), "import { attachToSession } from './session-attach.js';\nexport function attachRoute() { attachToSession(); }\n");
  writeFileSync(join(tui, 'cycles-route.tsx'), "import { attachToSession } from './session-attach.js';\nexport function CyclesRoute() { attachToSession(); }\n");
  writeFileSync(join(tui, 'dashboard-route.tsx'), "import { attachToSession } from './session-attach.js';\nexport function DashboardRoute() { attachToSession(); }\n");
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'feature: attach routes + barrel');
  headSha = git(repo, 'rev-parse', 'HEAD');

  // plant the shared remote-tracking ref at the OLDER commit (no remote needed) — the sha
  // the RETIRED origin/main default would silently have graded.
  git(repo, 'update-ref', 'refs/remotes/origin/main', oldSha);

  // the blueprint lives OUTSIDE the repo (it grades the repo, it is not part of it).
  bp = join(tmp, 'two-path.blueprint.json');
  writeFileSync(
    bp,
    JSON.stringify({
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'EngineeringBlueprint',
      metadata: { id: 'two-path-bp', name: 'two-path', version: '0.1.0', status: 'draft', ownerRole: 'platform-engineer', stewardRole: 'blueprint-steward' },
      intentRefs: ['multi-worktree-pinned-vs-no-pin-agreement'],
      scope: { repositories: ['repo'], paths: ['src/**'], environments: ['staging'] },
      extraction: { profile: 'plugin-surface', paths: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'], guardSymbols: ['on'], governedModules: [], forbiddenImports: [], minFiles: 1 },
      architecture: { components: [], relationships: [] },
      constraints: [
        {
          id: 'route-no-direct-session-attach',
          type: 'forbiddenDependency',
          severity: 'high',
          from: '*',
          to: './session-attach.js',
          scopePaths: ['src/tui/cycles-route.tsx', 'src/tui/dashboard-route.tsx'],
        },
      ],
      evidenceRequirements: [],
      approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
    }),
  );
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('bce run — pinned/--no-pin two-path agreement (multi-worktree)', () => {
  it('AGREEMENT: pinned (no --ref) and --no-pin BOTH grade HEAD — byte-identical violations, revision = HEAD sha', () => {
    const pinnedOut = join(tmp, 'pinned.json');
    const r1 = runCli(['run', '--blueprint', bp, '--ct-repo', repo, '--out', pinnedOut]);
    const pinned = JSON.parse(readFileSync(pinnedOut, 'utf8')) as ComplianceReport;
    // the load-bearing revision assert: the pinned default is THIS worktree's HEAD, not
    // the planted origin/main (which would have graded oldSha's route-less tree).
    expect(pinned.ctRepoRevision).toBe(headSha);
    expect(r1.code).toBe(1); // scoped routes redden → failing verdict gates CI

    const noPinOut = join(tmp, 'nopin.json');
    const r2 = runCli(['run', '--blueprint', bp, '--ct-repo', repo, '--no-pin', '--out', noPinOut]);
    const noPin = JSON.parse(readFileSync(noPinOut, 'utf8')) as ComplianceReport;
    expect(r2.code).toBe(1);

    // the agreement ratchet: BYTE-IDENTICAL violations across the two paths.
    expect(JSON.stringify(pinned.violations)).toBe(JSON.stringify(noPin.violations));
    // and they are the RIGHT violations: exactly the 2 scoped route files —
    // barrel (index.ts) + attach-route.ts import the same module and stay EXEMPT.
    const hits = pinned.violations
      .filter((v) => v.constraintId === 'route-no-direct-session-attach')
      .map((v) => `${v.evidenceRef ?? ''} ${v.component ?? ''}`);
    expect(hits).toHaveLength(2);
    expect(hits.some((h) => h.includes('cycles-route.tsx'))).toBe(true);
    expect(hits.some((h) => h.includes('dashboard-route.tsx'))).toBe(true);
    expect(hits.some((h) => h.includes('index.ts'))).toBe(false);
    expect(hits.some((h) => h.includes('attach-route.ts'))).toBe(false);
  }, 60000);

  it('EXPLICIT: --ref origin/main still resolves the origin/main sha and grades THAT older tree', () => {
    const out = join(tmp, 'explicit-origin-main.json');
    const r = runCli(['run', '--blueprint', bp, '--ct-repo', repo, '--ref', 'origin/main', '--out', out]);
    const report = JSON.parse(readFileSync(out, 'utf8')) as ComplianceReport;
    expect(report.ctRepoRevision).toBe(oldSha); // resolved the REMOTE-TRACKING ref, verbatim
    expect(report.violations).toHaveLength(0); // the older tree has no routes to redden
    expect(r.code).toBe(0);
  }, 60000);

  it('PASSTHROUGH: an explicit 40-hex sha is honored verbatim as the revision', () => {
    const out = join(tmp, 'explicit-sha.json');
    const r = runCli(['run', '--blueprint', bp, '--ct-repo', repo, '--ref', headSha, '--out', out]);
    const report = JSON.parse(readFileSync(out, 'utf8')) as ComplianceReport;
    expect(report.ctRepoRevision).toBe(headSha);
    expect(report.violations).toHaveLength(2);
    expect(r.code).toBe(1);
  }, 60000);
});
