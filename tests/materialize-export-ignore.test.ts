/**
 * Pinned acquisition grades `git archive` output, which honours the commit's own `.gitattributes`.
 * A committed `export-ignore` therefore dropped a tracked file from the graded tree, so a pinned
 * `bce run` passed while `--no-pin` on the same checkout failed. Materialization now refuses when
 * any tracked file is missing from the extracted tree.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { materializeAtRevision } from '../src/pin.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function repo(attributes: string | null): { dir: string; sha: string } {
  const dir = mkdtempSync(join(tmpdir(), 'bce-export-ignore-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.email', 'bce-test@example.com');
  git('config', 'user.name', 'bce-test');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'good.ts'), 'export const good = 1;\n');
  writeFileSync(join(dir, 'src', 'bad.ts'), 'export const bad = 1;\n');
  if (attributes !== null) writeFileSync(join(dir, '.gitattributes'), attributes);
  mkdirSync(join(dir, '.blueprints'));
  writeFileSync(join(dir, '.blueprints', 'no-bad.blueprint.json'), JSON.stringify({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'no-bad-file', version: '0.1.0', status: 'draft' },
    intentRefs: ['intent/no-bad-file'],
    scope: { repositories: ['example/repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-bad', type: 'forbiddenFile', severity: 'critical', path: 'src/bad.ts' }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  }));
  git('add', '-A');
  git('commit', '-q', '-m', 'c1');
  return { dir, sha: git('rev-parse', 'HEAD') };
}

describe('pinned materialization refuses an incomplete archive', () => {
  it('materializes every tracked file when no export attribute applies', () => {
    const { dir, sha } = repo(null);
    const dest = materializeAtRevision(dir, sha);
    dirs.push(dest);
    expect(readFileSync(join(dest, 'src', 'bad.ts'), 'utf8')).toBe('export const bad = 1;\n');
  });

  it('refuses when a committed export-ignore drops a tracked file', () => {
    const { dir, sha } = repo('src/bad.ts export-ignore\n');
    expect(() => materializeAtRevision(dir, sha)).toThrow(/incomplete tree coverage: .* tracks src\/bad\.ts/);
  });

  it('makes a pinned bce run refuse (exit 2) instead of grading the trimmed tree green', () => {
    const { dir } = repo('src/bad.ts export-ignore\n');
    const out = join(dir, 'report.json');
    const run = spawnSync(process.execPath, [resolve('dist/cli.js'), 'run', '--blueprint',
      join(dir, '.blueprints', 'no-bad.blueprint.json'), '--ct-repo', dir, '--out', out], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toContain('incomplete tree coverage');
    const unpinned = spawnSync(process.execPath, [resolve('dist/cli.js'), 'run', '--blueprint',
      join(dir, '.blueprints', 'no-bad.blueprint.json'), '--ct-repo', dir, '--no-pin', '--out', out], { encoding: 'utf8' });
    expect(unpinned.status, unpinned.stderr).toBe(1);
  });
});
