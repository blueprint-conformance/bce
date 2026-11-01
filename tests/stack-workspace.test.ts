import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extractStackManifest } from '../src/stack/stack-extractor.js';
import { diffStackManifests, stackDiffExitCode } from '../src/stack/stack-diff.js';
import { finalizeStackManifest, parseStackManifest, StackManifestSchema, verifyStackManifest, type StackManifest } from '../src/stack/stack-manifest.js';
import { validateSelectedStack } from '../src/stack/selected-stack.js';
import type { StackSourceConfig } from '../src/schema.js';
import type { DeclaredStackFacts } from '../src/stack/selected-stack.js';
import { stableStringify } from '../src/report.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));
function temp(): string { const d = mkdtempSync(path.join(tmpdir(), 'bce-workspace-')); dirs.push(d); return d; }
/** Complete materialized pnpm v9 tree, not hand-assembled StackManifests. */
function tree(importers: Record<string, string | null>, versions = ['1.0.0', '2.0.0', '5.0.0', '9.0.0'], reverse = false): string {
  const dir = temp();
  writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'workspace', version: '1.0.0', packageManager: 'pnpm@10.11.1' }));
  const lines = ["lockfileVersion: '9.0'", 'settings:', '  autoInstallPeers: true', '  excludeLinksFromLockfile: false', 'importers:', '  .: {}'];
  const entries = Object.entries(importers);
  for (const [name, version] of reverse ? entries.reverse() : entries) {
    const folder = path.join(dir, name); mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: path.basename(name), version: '1.0.0', ...(version ? { dependencies: { x: version } } : {}) }));
    lines.push(version ? `  ${name}:\n    dependencies:\n      x:\n        specifier: ${version}\n        version: ${version}` : `  ${name}: {}`);
  }
  lines.push('packages:');
  for (const v of versions) lines.push(`  x@${v}:\n    resolution: {integrity: sha512-${createHash('sha512').update(v).digest('base64')}}`);
  lines.push('snapshots:');
  for (const v of versions) lines.push(`  x@${v}: {}`);
  writeFileSync(path.join(dir, 'pnpm-lock.yaml'), lines.join('\n') + '\n');
  return dir;
}
function snapshot(dir: string, aware = true): StackManifest {
  const result = extractStackManifest(dir, 'revision', 'npm-lockfile', undefined, aware);
  expect(result.refusals).toEqual([]);
  return result.manifest;
}
function moves(a: StackManifest, b: StackManifest) { return diffStackManifests(a, b).moves.filter(m => m.name === 'x' && m.declaredBy?.startsWith('importer:')); }
const cli = path.resolve('dist/cli.js');
function run(...args: string[]) { return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' }); }

describe('proposed workspace-aware stack snapshots and existing diff flow', () => {
  it('replays a real pnpm 10.11.1 multi-importer lockfile: retained-root downgrade versus importer deletion', () => {
    const original = path.resolve('fixtures/stack/pnpm-v9-workspace-review');
    const down = temp(), removed = temp();
    cpSync(original, down, { recursive: true }); cpSync(original, removed, { recursive: true });
    const lock = readFileSync(path.join(original, 'pnpm-lock.yaml'), 'utf8');
    const block = /  packages\/lib:[\s\S]*?(?=\n  packages\/svc:)/;
    writeFileSync(path.join(down, 'pnpm-lock.yaml'), lock.replace(block, m => m.replaceAll('7.0.0', '6.0.0')));
    const pkg = path.join(down, 'packages/lib/package.json');
    writeFileSync(pkg, readFileSync(pkg, 'utf8').replace('7.0.0', '6.0.0'));
    rmSync(path.join(removed, 'packages/lib'), { recursive: true });
    writeFileSync(path.join(removed, 'pnpm-lock.yaml'), lock.replace(block, ''));
    const base = snapshot(original), head = snapshot(down), drop = snapshot(removed);
    expect(base.stackDigest).toBe(head.stackDigest);
    expect(stackDiffExitCode(diffStackManifests(base, head))).toBe(2);
    expect(diffStackManifests(base, head).moves).toContainEqual(expect.objectContaining({ name: 'is-number', class: 'backward', from: '7.0.0', to: '6.0.0', declaredBy: 'importer:["packages/lib","is-number"]' }));
    expect(stackDiffExitCode(diffStackManifests(base, drop))).toBe(0);
  });
  it('pairs importer moves even when the closure and root resolution set are unchanged', () => {
    const a = snapshot(tree({ 'packages/app': '9.0.0', 'packages/lib': '9.0.0', 'packages/svc': '2.0.0' }));
    const b = snapshot(tree({ 'packages/app': '9.0.0', 'packages/lib': '2.0.0', 'packages/svc': '2.0.0' }));
    expect(a.stackDigest).toBe(b.stackDigest);
    expect(a.manifestDigest).not.toBe(b.manifestDigest);
    expect(moves(a, b)).toMatchObject([{ class: 'backward', from: '9.0.0', to: '2.0.0', declaredBy: 'importer:["packages/lib","x"]' }]);
    expect(stackDiffExitCode(diffStackManifests(a, b))).toBe(2);
  });
  it('distinguishes importer removal and dependency drop from downgrade onto a retained sibling version', () => {
    const a = snapshot(tree({ 'packages/app': '5.0.0', 'packages/lib': '1.0.0' }));
    const removed = snapshot(tree({ 'packages/lib': '1.0.0' }));
    const dropped = snapshot(tree({ 'packages/app': null, 'packages/lib': '1.0.0' }));
    const down = snapshot(tree({ 'packages/app': '1.0.0', 'packages/lib': '1.0.0' }));
    for (const b of [removed, dropped]) {
      expect(stackDiffExitCode(diffStackManifests(a, b))).toBe(0);
      expect(moves(a, b)).toMatchObject([{ class: 'removed', from: '5.0.0', to: null }]);
    }
    expect(diffStackManifests(a, removed).moves.some(m => m.name === 'importer:packages/app' && m.class === 'removed')).toBe(true);
    expect(moves(a, down)).toMatchObject([{ class: 'backward', from: '5.0.0', to: '1.0.0' }]);
  });
  it('does not manufacture a downgrade when a departing importer removes a closure copy', () => {
    const a = snapshot(tree({ 'packages/app': '5.0.0', 'packages/lib': '1.0.0' }, ['1.0.0', '5.0.0']));
    const b = snapshot(tree({ 'packages/lib': '1.0.0' }, ['1.0.0']));
    const report = diffStackManifests(a, b);
    expect(a.stackDigest).not.toBe(b.stackDigest);
    expect(report.unexplained).toEqual([]);
    expect(stackDiffExitCode(report)).toBe(0);
    expect(moves(a, b)).toMatchObject([{ class: 'removed', from: '5.0.0', to: null }]);
  });
  it('tracks a downgrade across a dependency-group move, not a fabricated drop/add', () => {
    const a = snapshot(tree({ 'packages/app': '5.0.0', 'packages/lib': '1.0.0' }));
    const dir = tree({ 'packages/app': '2.0.0', 'packages/lib': '1.0.0' });
    const lock = path.join(dir, 'pnpm-lock.yaml'), pkg = path.join(dir, 'packages/app/package.json');
    writeFileSync(lock, readFileSync(lock, 'utf8').replace('  packages/app:\n    dependencies:', '  packages/app:\n    devDependencies:'));
    writeFileSync(pkg, readFileSync(pkg, 'utf8').replace('dependencies', 'devDependencies'));
    expect(moves(a, snapshot(dir))).toMatchObject([{ class: 'backward', from: '5.0.0', to: '2.0.0' }]);
  });
  it('handles crossing upgrades/downgrades and closure copies without assignment guessing', () => {
    const a = snapshot(tree({ 'packages/app': '2.0.0', 'packages/lib': '9.0.0' }));
    const b = snapshot(tree({ 'packages/app': '9.0.0', 'packages/lib': '5.0.0' }));
    expect(moves(a, b).map(m => [m.class, m.from, m.to]).sort()).toEqual([['backward', '9.0.0', '5.0.0'], ['forward', '2.0.0', '9.0.0']]);
  });
  it('preserves strict schema-1 semantics and refuses ambiguous legacy changes and mixed migration', () => {
    const base = tree({ 'packages/app': '2.0.0', 'packages/lib': '9.0.0' });
    const head = tree({ 'packages/app': '5.0.0', 'packages/lib': '9.0.0' });
    expect(stackDiffExitCode(diffStackManifests(snapshot(base, false), snapshot(head, false)))).toBe(2);
    expect(stackDiffExitCode(diffStackManifests(snapshot(base, false), snapshot(head)))).toBe(2);
    expect(snapshot(base).stackDigest).toBe(snapshot(base, false).stackDigest);
    expect(StackManifestSchema.safeParse(snapshot(base)).success).toBe(false);
    expect(validateSelectedStack({} as StackSourceConfig, snapshot(base), {} as DeclaredStackFacts)).toEqual(['selected-stack-v1 requires a schema-1 manifest; workspace-aware snapshots support standalone stack review only']);
  });
  it('canonicalizes importer/dependency order independently of source byte order', () => {
    const a = snapshot(tree({ 'packages/app': '2.0.0', 'packages/lib': '9.0.0' }));
    const b = snapshot(tree({ 'packages/app': '5.0.0', 'packages/lib': '9.0.0' }));
    if (a.schemaVersion !== '2' || b.schemaVersion !== '2') throw Error('schema 2 required');
    const permuted = { ...a, importers: [...a.importers].reverse().map(i => ({ ...i, dependencies: [...i.dependencies].reverse() })), edges: [...a.edges].reverse() };
    expect(stableStringify(diffStackManifests(permuted, b))).toBe(stableStringify(diffStackManifests(a, b)));
    const reordered = snapshot(tree({ 'packages/app': '2.0.0', 'packages/lib': '9.0.0' }, undefined, true));
    expect(reordered.importers).toEqual(a.importers);
    expect(reordered.stackDigest).toBe(a.stackDigest);
    expect(reordered.manifestDigest).not.toBe(a.manifestDigest); // source bytes remain evidence
  });
  it('rejects duplicate identities, missing targets, topology/edge mismatch, and noncanonical paths even if rehashed', () => {
    const a = snapshot(tree({ 'packages/app': '2.0.0' }));
    if (a.schemaVersion !== '2') throw Error('schema 2 required');
    const invalid = [
      { ...a, importers: [...a.importers, a.importers[1]!] },
      { ...a, importers: a.importers.map(i => ({ ...i, dependencies: [] })) },
      { ...a, importers: a.importers.map(i => ({ ...i, path: i.path === '.' ? '.' : '../app' })) },
      { ...a, importers: a.importers.map(i => ({ ...i, dependencies: i.dependencies.map(d => ({ ...d, to: 'npm:missing@2.0.0' })) })) },
    ];
    for (const raw of invalid) {
      expect(() => finalizeStackManifest(raw)).toThrow();
      expect(() => parseStackManifest(raw)).toThrow();
      expect(verifyStackManifest(raw).valid).toBe(false);
    }
  });
  it('checks real workspace membership and refuses a cut lockfile instead of mistaking it for importer deletion', () => {
    const dir = tree({ 'packages/app': '2.0.0', 'packages/lib': '9.0.0' });
    let lock = readFileSync(path.join(dir, 'pnpm-lock.yaml'), 'utf8');
    lock = lock.replace(/  packages\/app:\n    dependencies:\n      x:\n        specifier: 2.0.0\n        version: 2.0.0\n/, '');
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), lock);
    expect(extractStackManifest(dir, 'revision', 'npm-lockfile', undefined, true).refusals.join(' ')).toContain('no importer');
    const outside = tree({ 'other/app': '2.0.0' });
    expect(extractStackManifest(outside, 'revision', 'npm-lockfile', undefined, true).refusals.join(' ')).toContain('outside');
  });
  it('exercises built snapshot -> diff with actual exit codes; opt-in refuses npm', () => {
    const aDir = tree({ 'packages/app': '5.0.0', 'packages/lib': '1.0.0' });
    const downDir = tree({ 'packages/app': '1.0.0', 'packages/lib': '1.0.0' });
    const dropDir = tree({ 'packages/app': null, 'packages/lib': '1.0.0' });
    const output = temp();
    for (const [label, dir] of [['a', aDir], ['down', downDir], ['drop', dropDir]]) {
      const result = run('stack', 'snapshot', '--ct-repo', dir!, '--no-pin', '--workspace-aware', '--out', path.join(output, `${label}.json`));
      expect(result.stderr).not.toContain('REFUSED'); expect(result.status).toBe(0);
    }
    for (const [label, status] of [['down', 2], ['drop', 0]] as const) {
      expect(run('stack', 'diff', '--from', path.join(output, 'a.json'), '--to', path.join(output, `${label}.json`), '--out', path.join(output, 'diff.json')).status).toBe(status);
      const report = JSON.parse(readFileSync(path.join(output, 'diff.json'), 'utf8'));
      expect(report.moves.some((m: { declaredBy: string | null }) => m.declaredBy?.includes('packages/app'))).toBe(true);
    }
    const refused = run('stack', 'snapshot', '--ct-repo', 'fixtures/stack/a949557-tree', '--no-pin', '--workspace-aware', '--out', path.join(output, 'npm.json'));
    expect(refused.status).toBe(2); expect(refused.stderr).toContain('require a validated pnpm');
  });
});
