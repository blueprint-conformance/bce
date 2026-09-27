#!/usr/bin/env node
/** Installed-byte gate/replay proof. No imports from src/, network, or policy relaxation. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = process.argv[2] ? resolve(process.argv[2]) : resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'dist/cli.js');
const oldRoot = process.argv[3] ? resolve(process.argv[3]) : null;
const oldCli = oldRoot ? join(oldRoot, 'dist/cli.js') : null;
const oldVersion = oldRoot ? JSON.parse(readFileSync(join(oldRoot, 'package.json'), 'utf8')).version : null;
assert.ok(existsSync(cli), 'Build first: installed dist/cli.js is required');
if (oldCli) assert.ok(existsSync(oldCli), 'Published old-engine dist/cli.js is required');
if (oldCli) assert.match(oldVersion, /^\d+\.\d+\.\d+$/, 'Published old-engine version is required');
assert.ok(Number(process.versions.node.split('.')[0]) >= 22, 'Node 22 or newer required');
const scratch = mkdtempSync(join(tmpdir(), 'bce-declared-consumer-'));
const tree = join(scratch, 'consumer');
const verifier = join(scratch, 'independent-verifier');
const cases = [];
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const stable = (value) => {
  const sort = (item) => item === null || typeof item !== 'object' ? item : Array.isArray(item) ? item.map(sort) : Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
  return `${JSON.stringify(sort(value), null, 2)}\n`;
};
const canonicalHash = (value) => hash(stable(value));
function run(name, args, expected, cwd = scratch) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${name}: ${result.stderr}\n${result.stdout}`);
  cases.push({ name, exit: result.status });
  return result;
}
function mcp(name, expected) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_gate', arguments: { repoDir: tree, blueprintDir: join(tree, '.blueprints'), extractor: 'ast' } } },
  ].map(JSON.stringify).join('\n') + '\n';
  const result = spawnSync(process.execPath, [join(root, 'dist/mcp-server.js')], { cwd: verifier, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
  const response = result.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((r) => r.id === 2);
  assert.ok(response && !response.error && !response.result?.isError, JSON.stringify(response));
  assert.equal(response.result.structuredContent.exitCode, expected, JSON.stringify(response));
  assert.equal(response.result.structuredContent.gateFailed, expected !== 0);
  cases.push({ name: `${name}:mcp`, exit: expected });
}
const lock = (version = '7.0.0', name = 'is-number') => json({ name: 'consumer', version: '1.0.0', lockfileVersion: 3,
  packages: { '': { name: 'consumer', version: '1.0.0', dependencies: { bridge: '1.0.0' } }, 'node_modules/bridge': { version: '1.0.0', dependencies: { [name]: version } }, [`node_modules/${name}`]: { version } } });
const original = {
  'package.json': json({ name: 'consumer', version: '1.0.0', dependencies: { bridge: '1.0.0' } }), 'package-lock.json': lock(), '.nvmrc': '22.22.2\n',
  Dockerfile: `FROM node@sha256:${'a'.repeat(64)}\n`, 'src/clean.ts': 'export const answer = 42;\n',
};
function restore() {
  for (const [file, bytes] of Object.entries(original)) { mkdirSync(dirname(join(tree, file)), { recursive: true }); writeFileSync(join(tree, file), bytes); }
  rmSync(join(tree, '.node-version'), { force: true });
}
function blueprint(constraint, mixed = false) {
  const stackConstraints = Array.isArray(constraint) ? constraint : [constraint];
  return { apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'declared-stack', version: '1.0.0', status: 'approved', ownerRole: 'owner', stewardRole: 'steward' },
    minEngineVersion: '0.5.0', intentRefs: ['intent:consumer'], scope: { repositories: ['consumer'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    stack: { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: ['Dockerfile'], runtimeFiles: ['.nvmrc'] },
    constraints: [...stackConstraints, ...(mixed ? [{ id: 'no-secret', type: 'forbiddenPattern', severity: 'high', pattern: 'UNSAFE_TOKEN', path: 'src/**' }] : [])],
    ...(mixed ? { extraction: { profile: 'typescript-module-graph', paths: ['src/**'], minFiles: 1 } } : {}),
    evidenceRequirements: [
      { type: 'declaredStack', required: true, onMissing: 'block' },
      ...(mixed ? [{ type: 'staticAst', required: true, onMissing: 'block' }] : []),
    ], approvals: [{ role: 'owner', stage: 'ratify' }],
  };
}
const policy = join(tree, '.blueprints/stack.blueprint.json');
function check(name, expected, policyBytes, replay = false) {
  assert.equal(readFileSync(policy, 'utf8'), policyBytes, 'policy must remain immutable through repair');
  run(`${name}:gate`, ['gate', '--repo', tree], expected);
  const reportPath = join(scratch, `${name}.report.json`);
  const bundle = join(scratch, `${name}.bundle.json`);
  run(`${name}:run`, ['run', '--blueprint', policy, '--ct-repo', tree, '--no-pin', '--out', reportPath, ...(replay ? ['--emit-bundle', bundle] : [])], expected);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  assert.equal(report.schemaVersion, '2');
  assert.equal(report.verdict, expected === 0 ? 'pass' : expected === 1 ? 'fail' : 'indeterminate');
  assert.equal(report.score === null, expected === 2);
  if (replay) {
    const detached = join(verifier, `${name}.bundle.json`);
    cpSync(bundle, detached);
    run(`${name}:offline-replay`, ['verify-bundle', '--bundle', detached], 0, verifier);
    const tampered = JSON.parse(readFileSync(detached, 'utf8'));
    tampered.artifacts.report.score = 17;
    writeFileSync(detached, json(tampered));
    run(`${name}:tampered-replay`, ['verify-bundle', '--bundle', detached], 2, verifier);
    cpSync(bundle, detached);
    const hashTampered = JSON.parse(readFileSync(detached, 'utf8'));
    hashTampered.artifacts.stackManifest.stackDigest = 'f'.repeat(64);
    writeFileSync(detached, json(hashTampered));
    run(`${name}:stack-manifest-hash-tamper`, ['verify-bundle', '--bundle', detached], 2, verifier);
    const alternateBundle = join(scratch, `${name}.alternate.bundle.json`);
    writeFileSync(join(tree, 'Dockerfile'), `${original.Dockerfile}${original.Dockerfile}`);
    run(`${name}:alternate-valid-bundle`, ['run', '--blueprint', policy, '--ct-repo', tree, '--no-pin', '--out', join(scratch, `${name}.alternate.report.json`), '--emit-bundle', alternateBundle], expected);
    const primary = JSON.parse(readFileSync(bundle, 'utf8'));
    const alternate = JSON.parse(readFileSync(alternateBundle, 'utf8'));
    assert.notEqual(alternate.artifacts.stackManifest.manifestDigest, primary.artifacts.stackManifest.manifestDigest);
    primary.artifacts.stackManifest = alternate.artifacts.stackManifest;
    primary.hashes.stackManifest = canonicalHash(primary.artifacts.stackManifest);
    const { bundle: ignored, ...artifactHashes } = primary.hashes;
    void ignored;
    primary.hashes.bundle = canonicalHash({ ...primary, hashes: artifactHashes });
    writeFileSync(detached, stable(primary));
    const substitution = run(`${name}:valid-manifest-substitution`, ['verify-bundle', '--bundle', detached], 2, verifier);
    const verification = JSON.parse(substitution.stdout);
    assert.ok(verification.failures.some((failure) => /manifest|facts|source|revision/i.test(failure)), JSON.stringify(verification));
    restore();
  }
  assert.equal(hash(readFileSync(policy)), hash(policyBytes));
  return report;
}
try {
  mkdirSync(join(tree, '.blueprints'), { recursive: true }); mkdirSync(verifier);
  restore();
  const manifestPath = join(scratch, 'selected-snapshot.json');
  run('closure-target', ['stack', 'snapshot', '--ct-repo', tree, '--no-pin', '--out', manifestPath], 0);
  const digest = JSON.parse(readFileSync(manifestPath, 'utf8')).stackDigest;
  for (const [label, imageRef] of [['moving-tag', 'node:22'], ['digest-pinned', `node:22@sha256:${'a'.repeat(64)}`]]) {
    const singlePath = join(scratch, `${label}-single.stack.json`);
    const duplicatePath = join(scratch, `${label}-duplicate.stack.json`);
    writeFileSync(join(tree, 'Dockerfile'), `FROM ${imageRef}\n`);
    run(`${label}-single-snapshot`, ['stack', 'snapshot', '--ct-repo', tree, '--no-pin', '--out', singlePath], 0);
    writeFileSync(join(tree, 'Dockerfile'), `FROM ${imageRef}\nFROM ${imageRef}\n`);
    run(`${label}-duplicate-snapshot`, ['stack', 'snapshot', '--ct-repo', tree, '--no-pin', '--out', duplicatePath], 0);
    const single = JSON.parse(readFileSync(singlePath, 'utf8'));
    const duplicate = JSON.parse(readFileSync(duplicatePath, 'utf8'));
    assert.equal(single.images.length, 1);
    assert.equal(duplicate.images.length, 2);
    assert.equal(duplicate.stackDigest, single.stackDigest, `${label}: duplicate evidence must not alter closure identity`);
    assert.notEqual(duplicate.manifestDigest, single.manifestDigest, `${label}: provenance-bearing manifest bytes must remain distinct`);
    for (const [direction, from, to] of [['forward', singlePath, duplicatePath], ['reverse', duplicatePath, singlePath]]) {
      const reportPath = join(scratch, `${label}-${direction}.diff.json`);
      run(`${label}-duplicate-identity-${direction}`, ['stack', 'diff', '--from', from, '--to', to, '--out', reportPath], 0);
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      assert.equal(report.classification, 'identical');
      assert.deepEqual(report.moves, []);
    }
    for (const [flag, input] of [['from', singlePath], ['to', duplicatePath]]) {
      const bytesSingle = readFileSync(singlePath);
      const bytesDuplicate = readFileSync(duplicatePath);
      const out = join(scratch, `${label}-hardlink-${flag}.json`);
      linkSync(input, out);
      const result = run(`${label}-hardlink-${flag}`, ['stack', 'diff', '--from', singlePath, '--to', duplicatePath, '--out', out], 2);
      assert.ok(result.stderr.includes(`it resolves to the --${flag} manifest`));
      assert.deepEqual(readFileSync(singlePath), bytesSingle);
      assert.deepEqual(readFileSync(duplicatePath), bytesDuplicate);
      assert.deepEqual(readFileSync(out), flag === 'from' ? bytesSingle : bytesDuplicate);
    }
  }
  restore();
  const oldPolicy = json(blueprint({ id: 'old-engine-refusal', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }));
  writeFileSync(policy, oldPolicy);
  if (oldCli) {
    const oldReport = join(scratch, 'published-old-engine.report.json');
    const old = spawnSync(process.execPath, [oldCli, 'gate', '--repo', tree, '--report-json', oldReport], { cwd: scratch, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    assert.ifError(old.error);
    assert.equal(old.signal, null, `published old engine terminated by signal ${old.signal}`);
    assert.equal(old.status, 2, `published old engine did not take the expected refusal path:\n${old.stdout}\n${old.stderr}`);
    const oldDoc = JSON.parse(readFileSync(oldReport, 'utf8'));
    assert.equal(oldDoc.exitCode, 2);
    assert.equal(oldDoc.outcome, 'refusal');
    assert.equal(oldDoc.gateFailed, true);
    assert.ok(JSON.stringify(oldDoc).includes(`blueprint requires engine >= 0.5.0, gate is running ${oldVersion}`));
    cases.push({ name: 'published-old-engine-refusal', exit: old.status });
  }
  restore();
  const aggregateRules = [
    { id: 'aggregate-package-pin', type: 'pinnedVersion', severity: 'high', stackTarget: { kind: 'npm', name: 'is-number' }, expectedVersion: '7.0.0' },
    { id: 'aggregate-images', type: 'requirePinnedImages', severity: 'high' },
    { id: 'aggregate-runtime', type: 'allowedNodeVersions', severity: 'high', versions: ['22.22.2'] },
  ];
  const aggregateBytes = json(blueprint(aggregateRules));
  writeFileSync(policy, aggregateBytes);
  writeFileSync(join(tree, 'package-lock.json'), lock('8.0.0'));
  writeFileSync(join(tree, 'Dockerfile'), 'FROM node:22\n');
  writeFileSync(join(tree, '.nvmrc'), '24.8.0\n');
  const aggregate = check('three-independent-violations', 1, aggregateBytes);
  assert.deepEqual(aggregate.violations.map((v) => v.constraintId).sort(), aggregateRules.map((r) => r.id).sort());
  restore(); check('three-independent-fixed', 0, aggregateBytes, true);
  const scenarios = [
    ['package-pin', { id: 'pin', type: 'pinnedVersion', stackTarget: { kind: 'npm', name: 'is-number' }, expectedVersion: '7.0.0' }, 'package-lock.json', lock('8.0.0')],
    ['closure', { id: 'closure', type: 'stackClosureMatch', expectedStackDigest: digest }, 'package-lock.json', lock('8.0.0')],
    ['forbidden-transitive', { id: 'forbid', type: 'forbiddenStackPackage', packageName: 'legacy-package' }, 'package-lock.json', lock('7.0.0', 'legacy-package')],
    ['image-pin', { id: 'image', type: 'requirePinnedImages' }, 'Dockerfile', 'FROM node:22\n'],
    ['runtime-allowlist', { id: 'runtime', type: 'allowedNodeVersions', versions: ['22.22.2'] }, '.nvmrc', '24.8.0\n'],
  ];
  for (const [name, rule, file, drift] of scenarios) {
    restore(); const bytes = json(blueprint({ ...rule, severity: 'high' })); writeFileSync(policy, bytes);
    writeFileSync(join(tree, file), drift); check(`${name}-red`, 1, bytes);
    if (name === 'forbidden-transitive') {
      mcp('forbidden-transitive', 1);
      run('forbidden-transitive-lockfile-only:gate', ['gate', '--repo', tree, '--changed', 'package-lock.json'], 1);
    }
    restore(); check(`${name}-fixed`, 0, bytes, true);
    if (name === 'forbidden-transitive') mcp('fixed', 0);
  }
  const bytes = json(blueprint({ id: 'forbid', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }));
  writeFileSync(policy, bytes); rmSync(join(tree, 'package-lock.json')); check('missing-source', 2, bytes); mcp('missing-source', 2);
  restore(); writeFileSync(join(tree, 'package-lock.json'), lock('file:../opaque')); check('opaque-package', 2, bytes); mcp('opaque-package', 2);
  restore(); const imageBytes = json(blueprint({ id: 'image', type: 'requirePinnedImages', severity: 'high' }));
  writeFileSync(policy, imageBytes); writeFileSync(join(tree, 'Dockerfile'), 'FROM ${BASE}\n'); check('variable-image', 2, imageBytes);
  restore(); const runtimeBytes = json(blueprint({ id: 'runtime', type: 'allowedNodeVersions', severity: 'high', versions: ['22.22.2'] }));
  writeFileSync(policy, runtimeBytes); writeFileSync(join(tree, '.node-version'), '24.8.0\n'); check('runtime-conflict', 2, runtimeBytes);
  restore(); const mixedBytes = json(blueprint({ id: 'forbid', type: 'forbiddenStackPackage', severity: 'high', packageName: 'legacy-package' }, true));
  writeFileSync(policy, mixedBytes); writeFileSync(join(tree, 'src/clean.ts'), "export const marker = 'UNSAFE_TOKEN';\n");
  const mixed = check('mixed-code-violation', 1, mixedBytes);
  assert.ok(mixed.violations.some((v) => v.constraintId === 'no-secret'));
  restore(); check('mixed-fixed', 0, mixedBytes, true);
  process.stdout.write(`${JSON.stringify({ proof: 'declared-stack-installed-consumer', cases, claims: ['selected-declarations', 'offline-integrity-replay'], originAuthenticity: 'not-established' }, null, 2)}\n`);
} finally { rmSync(scratch, { recursive: true, force: true }); }
