import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTreeKnowledge, materializeAtRevision } from '../src/pin.js';

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function fixture(run: (root: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'bce-knowledge-test-'));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function init(root: string) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.org');
  git(root, 'config', 'core.autocrlf', 'false');
}

describe('Git tree knowledge', () => {
  it('falls back only for a plain directory; a requested ref cannot fall back', () => fixture(root => {
    expect(listTreeKnowledge(root)).toBeNull();
    expect(() => listTreeKnowledge(root, 'HEAD')).toThrow();
  }));

  it('reads an empty tracked tree and rejects an invalid revision', () => fixture(root => {
    init(root);
    git(root, 'commit', '--allow-empty', '-qm', 'empty');
    expect(listTreeKnowledge(root)?.tracked.size).toBe(0);
    expect(listTreeKnowledge(root, 'HEAD')?.tracked.size).toBe(0);
    expect(() => listTreeKnowledge(root, 'missing-ref')).toThrow(/git tree knowledge failed/);
  }));

  it('preserves NUL-delimited filenames and indexed Gitlinks', () => fixture(root => {
    init(root);
    const names = process.platform === 'win32' ? ['unicode-é.txt'] : ['unicode-é.txt', 'tab\tfile', 'line\nfile'];
    for (const name of names) writeFileSync(join(root, name), 'bytes');
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'files');
    const sha = git(root, 'rev-parse', 'HEAD');
    git(root, 'update-index', '--add', '--cacheinfo', `160000,${sha},nested`);
    git(root, 'commit', '-qm', 'gitlink');
    for (const ref of [undefined, 'HEAD']) {
      const knowledge = listTreeKnowledge(root, ref)!;
      expect([...knowledge.tracked].sort()).toEqual(names.sort());
      expect(knowledge.gitlinks).toEqual(['nested']);
    }
  }));

  it('refuses corrupt repository markers and corrupt indexes', () => fixture(root => {
    mkdirSync(join(root, '.git'));
    expect(() => listTreeKnowledge(root)).toThrow(/discovery failed/);
    rmSync(join(root, '.git'), { recursive: true });
    init(root);
    writeFileSync(join(root, '.git/index'), 'corrupt');
    expect(() => listTreeKnowledge(root)).toThrow(/tree knowledge failed/);
  }));

  it('refuses unpinned bare repositories', () => fixture(root => {
    git(root, 'init', '--bare', '-q');
    expect(() => listTreeKnowledge(root)).toThrow(/working tree/);
  }));

  it('reads a pinned bare repository', () => fixture(root => {
    const work = join(root, 'work');
    mkdirSync(work);
    init(work);
    writeFileSync(join(work, 'tracked'), 'bytes');
    git(work, 'add', '.');
    git(work, 'commit', '-qm', 'files');
    const bare = join(root, 'bare');
    git(root, 'clone', '--bare', work, bare);
    expect([...listTreeKnowledge(bare, 'HEAD')!.tracked]).toEqual(['tracked']);
  }));

  it('refuses an unavailable Git executable instead of falling back', () => fixture(root => {
    const original = process.env.PATH;
    try {
      process.env.PATH = root;
      expect(() => listTreeKnowledge(root)).toThrow();
    } finally {
      process.env.PATH = original;
    }
  }));

  it('reads index output larger than the default subprocess capture limit', () => fixture(root => {
    init(root);
    writeFileSync(join(root, 'blob'), 'bytes');
    git(root, 'add', 'blob');
    const oid = git(root, 'rev-parse', ':blob');
    const names = Array.from({ length: 9000 }, (_, i) => `file-${i}-${'x'.repeat(100)}`);
    execFileSync('git', ['-C', root, 'update-index', '--index-info'], {
      input: names.map(name => `100644 ${oid}\t${name}\n`).join(''),
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    const known = listTreeKnowledge(root)!;
    expect(known.tracked.size).toBe(names.length + 1);
    expect(known.tracked.has(names.at(-1)!)).toBe(true);
  }));

  it('refuses unresolved index stages rather than treating them as tracked certainty', () => fixture(root => {
    init(root);
    writeFileSync(join(root, 'blob'), 'bytes');
    git(root, 'add', 'blob');
    const oid = git(root, 'rev-parse', ':blob');
    for (const mode of ['100644', '160000']) {
      execFileSync('git', ['-C', root, 'update-index', '--index-info'], {
        input: `${mode} ${oid} 1\tconflicted\n`,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      expect(() => listTreeKnowledge(root)).toThrow(/unresolved Git index/);
    }
  }));

  it('cleans a pinned materialization when extraction refuses', () => fixture(root => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    init(repo);
    git(repo, 'commit', '--allow-empty', '-qm', 'no lockfile');
    const scratch = join(root, 'scratch');
    mkdirSync(scratch);
    const project = join(dirname(fileURLToPath(import.meta.url)), '..');
    const result = spawnSync(process.execPath, [join(project, 'dist/cli.js'), 'stack', 'snapshot', '--ct-repo', repo, '--out', join(root, 'out.json')], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('stack snapshot REFUSED');
    expect(readdirSync(scratch)).toEqual([]);
  }));

  it('cleans pinned materializations before scan and declared-stack run refusals exit', () => fixture(root => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    init(repo);
    writeFileSync(join(repo, 'src/a.ts'), 'export const a = 1;\n');
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'consumer', version: '1.0.0' }));
    writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ name: 'consumer', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'consumer', version: '1.0.0' } } }));
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'fixture');
    const common = {
      apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
      metadata: { id: 'cleanup', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' },
      intentRefs: ['intent:cleanup'], scope: { repositories: ['consumer'], paths: ['src/**'] }, architecture: { components: [], relationships: [] }, approvals: [],
    };
    const scanBlueprint = join(root, 'scan.blueprint.json');
    writeFileSync(scanBlueprint, JSON.stringify({ ...common,
      extraction: { profile: 'plugin-surface', paths: ['src/**'], minFiles: 2 },
      constraints: [{ id: 'marker', type: 'forbiddenPattern', severity: 'high', path: 'src/**', pattern: 'NEVER' }], evidenceRequirements: [],
    }));
    const stackBlueprint = join(root, 'stack.blueprint.json');
    writeFileSync(stackBlueprint, JSON.stringify({ ...common, minEngineVersion: '0.5.0',
      stack: { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] },
      constraints: [{ id: 'forbid', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }],
      evidenceRequirements: [{ type: 'declaredStack', required: true, onMissing: 'block' }],
    }));
    const project = join(dirname(fileURLToPath(import.meta.url)), '..');
    for (const [label, args, message] of [
      ['scan', ['scan', '--blueprint', scanBlueprint, '--ct-repo', repo], 'fail-closed: scanned 1 file(s), expected >= 2'],
      ['run', ['run', '--blueprint', stackBlueprint, '--ct-repo', repo, '--observations'], '--observations requires a path and code evidence'],
    ] as const) {
      const scratch = join(root, `scratch-${label}`);
      mkdirSync(scratch);
      const result = spawnSync(process.execPath, [join(project, 'dist/cli.js'), ...args], {
        encoding: 'utf8', env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(message);
      expect(readdirSync(scratch)).toEqual([]);
    }
  }));

  it('cleans failed materialization and knowledge transport scratch directories', () => fixture(root => {
    init(root);
    const scratch = join(root, 'scratch');
    mkdirSync(scratch);
    const saved = { TMPDIR: process.env.TMPDIR, TEMP: process.env.TEMP, TMP: process.env.TMP };
    try {
      process.env.TMPDIR = process.env.TEMP = process.env.TMP = scratch;
      expect(() => materializeAtRevision(root, 'missing-ref')).toThrow();
      expect(() => listTreeKnowledge(root, 'missing-ref')).toThrow();
      expect(readdirSync(scratch)).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }));
});
