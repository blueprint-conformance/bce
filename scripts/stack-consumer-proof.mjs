#!/usr/bin/env node
/** Offline snapshot-to-diff proof against built CLI bytes; no source fallback. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist/cli.js');
assert.ok(existsSync(cli), 'Build first: dist/cli.js is required (no source fallback)');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer is required');
const scratch = mkdtempSync(join(tmpdir(), 'bce-stack-consumer-'));
const cases = [];
function run(name, args, expected) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: scratch, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${name}: ${result.stderr}\n${result.stdout}`);
  cases.push({ name, exit: result.status });
  return result;
}
try {
  const tree = join(scratch, 'tree');
  cpSync(join(root, 'fixtures/stack/pnpm-v9-synth-tree'), tree, { recursive: true });
  const baseline = join(scratch, 'baseline.json');
  const repeated = join(scratch, 'repeated.json');
  const updated = join(scratch, 'updated.json');
  const snapshot = (name, out, exit = 0) => run(name, ['stack', 'snapshot', '--ct-repo', tree, '--no-pin', '--out', out], exit);
  snapshot('snapshot', baseline);
  snapshot('snapshot-repeat', repeated);
  assert.deepEqual(readFileSync(baseline), readFileSync(repeated), 'snapshot bytes must be deterministic');
  const lockPath = join(tree, 'pnpm-lock.yaml');
  const original = readFileSync(lockPath, 'utf8');
  const bumped = original.replace(/^ {2}is-number@7\.0\.0:/gm, '  is-number@7.0.1:')
    .replace("        specifier: 'catalog:'\n        version: 7.0.0\n", "        specifier: 'catalog:'\n        version: 7.0.1\n");
  assert.notEqual(bumped, original);
  writeFileSync(lockPath, bumped);
  snapshot('snapshot-bumped', updated);
  for (const [name, from, to, exit, before, after] of [
    ['forward', baseline, updated, 0, '7.0.0', '7.0.1'],
    ['backward', updated, baseline, 2, '7.0.1', '7.0.0'],
  ]) {
    const out = join(scratch, `${name}.json`);
    run(name, ['stack', 'diff', '--from', from, '--to', to, '--out', out], exit);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(report.classification, name);
    assert.equal(report.moves.length, 1);
    assert.deepEqual(report.unexplained, []);
    const move = report.moves[0];
    assert.equal(move.name, 'is-number');
    assert.equal(move.view, 'nodes');
    assert.equal(move.class, name);
    assert.equal(move.from, before);
    assert.equal(move.to, after);
    Object.assign(cases.at(-1), { classification: report.classification, move: { name: move.name, from: move.from, to: move.to } });
  }
  const tampered = join(scratch, 'tampered.json');
  const manifest = JSON.parse(readFileSync(updated, 'utf8'));
  manifest.stackDigest = manifest.stackDigest === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
  writeFileSync(tampered, JSON.stringify(manifest));
  const refusedReport = join(scratch, 'refused.json');
  run('tampered-manifest', ['stack', 'diff', '--from', baseline, '--to', tampered, '--out', refusedReport], 2);
  assert.equal(existsSync(refusedReport), false, 'tampered input must not produce a report');
  for (const [flag, input] of [['from', baseline], ['to', updated]]) {
    const before = [readFileSync(baseline), readFileSync(updated)];
    const out = join(scratch, `hardlink-${flag}.json`);
    linkSync(input, out);
    const result = run(`hardlink-${flag}`, ['stack', 'diff', '--from', baseline, '--to', updated, '--out', out], 2);
    assert.ok(result.stderr.includes(`it resolves to the --${flag} manifest`));
    assert.deepEqual(readFileSync(baseline), before[0]);
    assert.deepEqual(readFileSync(updated), before[1]);
    assert.deepEqual(readFileSync(out), flag === 'from' ? before[0] : before[1]);
  }
  for (const [label, ref] of [['moving', 'node:22'], ['pinned', `node:22@sha256:${'ab'.repeat(32)}`]]) {
    const single = join(scratch, `image-${label}-single.json`);
    const duplicate = join(scratch, `image-${label}-duplicate.json`);
    const copy = join(tree, 'Dockerfile.copy');
    rmSync(copy, { force: true });
    writeFileSync(join(tree, 'Dockerfile'), `FROM ${ref}\n`);
    snapshot(`image-${label}-single`, single);
    writeFileSync(copy, `FROM ${ref}\n`);
    snapshot(`image-${label}-duplicate`, duplicate);
    const a = JSON.parse(readFileSync(single, 'utf8'));
    const b = JSON.parse(readFileSync(duplicate, 'utf8'));
    assert.equal(a.stackDigest, b.stackDigest);
    assert.notEqual(a.manifestDigest, b.manifestDigest);
    for (const [direction, from, to] of [['add', single, duplicate], ['remove', duplicate, single]]) {
      const out = join(scratch, `image-${label}-${direction}.json`);
      run(`image-${label}-${direction}`, ['stack', 'diff', '--from', from, '--to', to, '--out', out], 0);
      const report = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(report.classification, 'identical');
      assert.deepEqual(report.moves, []);
      assert.deepEqual(report.unexplained, []);
      Object.assign(cases.at(-1), { classification: report.classification, digestEqual: true });
    }
  }
  writeFileSync(lockPath, "lockfileVersion: '9.0'\n");
  const hollow = join(scratch, 'hollow.json');
  const result = snapshot('hollow-pnpm', hollow, 2);
  assert.ok(result.stderr.includes("no 'importers' mapping"));
  assert.equal(existsSync(hollow), false, 'hollow lockfile must not produce a manifest');
  console.log(JSON.stringify({ kind: 'built-stack-consumer-proof', passed: true, node: process.version, cases }, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
