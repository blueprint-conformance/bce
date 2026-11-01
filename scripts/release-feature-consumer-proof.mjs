#!/usr/bin/env node
/** Exercise release features through pristine installed API/CLI bytes, never src imports. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2] || !process.argv[3] || !['esm', 'cjs'].includes(process.argv[4])) {
  throw new Error('Usage: release-feature-consumer-proof.mjs <installed-root> <published-0.6.0-root> <esm|cjs> (run from the installed consumer)');
}
const installedRoot = resolve(process.argv[2]);
const oldRoot = resolve(process.argv[3]);
const mode = process.argv[4];
assert.equal(JSON.parse(readFileSync(join(oldRoot, 'package.json'), 'utf8')).version, '0.6.0');
function installedCli(root) {
  const target = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).bin?.bce;
  assert.equal(typeof target, 'string', 'installed package must declare bin.bce');
  assert.ok(target.length > 0, 'installed bin.bce must not be empty');
  const executable = realpathSync(resolve(root, target));
  const local = relative(realpathSync(root), executable);
  assert.ok(local && !local.startsWith('..') && !isAbsolute(local), 'bin.bce must remain inside the installed package');
  return executable;
}
const cli = installedCli(installedRoot);
// The parent copies this helper into the installed consumer so both public
// conditions resolve there, not against this source checkout's own package.
const require = createRequire(import.meta.url);
const entry = mode === 'esm' ? fileURLToPath(import.meta.resolve('bce-engine')) : require.resolve('bce-engine');
assert.equal(realpathSync(entry), realpathSync(join(installedRoot, mode === 'esm' ? 'dist/index.js' : 'dist/index.cjs')));
const api = mode === 'esm' ? await import('bce-engine') : require('bce-engine');
for (const name of ['reviewArchitectureChange', 'reviewPolicyImpact', 'captureRepairEvidence', 'buildRepairBriefs',
  'extractStackManifest', 'diffStackManifests', 'computeGateReport', 'DependencyPathRefusal']) {
  assert.equal(typeof api[name], 'function', `${mode} export ${name}`);
}
assert.equal(new api.DependencyPathRefusal('incomplete', 'bounded').constraintId, 'bounded');
process.stdout.write(`packed public ${mode} feature scenarios: START\n`);
const scratch = mkdtempSync(join(tmpdir(), 'bce-release-features-'));
const tree = join(scratch, 'consumer');
const policy = '.blueprints/policy.blueprint.json';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const read = file => JSON.parse(readFileSync(file, 'utf8'));
function write(file, contents) {
  mkdirSync(dirname(join(tree, file)), { recursive: true });
  writeFileSync(join(tree, file), contents);
}
function git(...args) {
  return execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit() { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); }
function run(name, expected, args, executable = cli) {
  const result = spawnSync(process.execPath, [executable, ...args], {
    cwd: tree, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, expected, `${name}: ${result.stderr}\n${result.stdout}`);
  return result;
}
function functional() {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    'import assert from "node:assert/strict"; import {model} from "./packages/domain/model.mjs"; for (const n of [2.5,-2,0]) assert.equal(model(n), n*2);'],
  { cwd: tree, encoding: 'utf8', timeout: 60_000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
}
try {
  mkdirSync(tree);
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  const bp = read(join(installedRoot, 'fixtures/typescript-module-layering.blueprint.json'));
  bp.extraction.paths = ['packages/**/*.mjs']; bp.scope.paths = ['packages/**/*.mjs'];
  const runtimePolicy = api.parseBlueprint({ ...bp,
    constraints: [{ id: 'runtime-distinct', type: 'behavioralInvariant', severity: 'critical', behaviorRef: 'runtime' }],
    evidenceRequirements: [{ type: 'runtimeProbe', required: true, onMissing: 'block' }],
  });
  const observation = (id, hash, ok = true, ref = 'runtime') => ({
    id: `behavior:${ref}:${id}`, type: 'behaviorObservation', path: `${hash}|${ok ? '1' : '0'}`, line: 1,
  });
  const runtime = components => api.evaluate(runtimePolicy, {
    schemaVersion: '1', ctRepoRevision: 'fixture', components, guardEdges: [],
    coverage: { extractor: 'ast', filesScanned: 2, unsupported: [] },
  }, 'plugin-surface');
  assert.equal(runtime([observation('a', 'one'), observation('b', 'two')]).verdict, 'pass');
  for (const components of [
    [observation('a', 'one'), observation('a', 'two')],
    [observation('a', 'one'), observation('b', 'one'), observation('a', 'two')],
  ]) {
    const report = runtime(components);
    assert.equal(report.verdict, 'fail');
    assert.ok(report.violations.some(v => /duplicate/.test(v.observed)));
  }
  for (const duplicates of [[observation('a', 'one'), observation('a', 'one', false)],
    [observation('a', 'one', false), observation('a', 'one')]]) {
    const report = runtime([...duplicates, observation('b', 'two')]);
    assert.equal(report.verdict, 'fail');
    assert.ok(report.violations.some(v => /duplicate/.test(v.observed)));
    assert.ok(report.violations.some(v => /oracle/.test(v.observed)));
  }
  assert.equal(runtime([observation('a', 'one'), observation('b', 'two'),
    observation('x', 'one', true, 'other'), observation('x', 'two', false, 'other')]).verdict, 'pass');
  process.stdout.write(`packed public ${mode} runtime: distinct-ID control, duplicate refusals and oracle preservation PASS\n`);

  write('.gitignore', '.bce/\n');
  write(policy, json(bp));
  write('packages/app/api.mjs', 'export const twice = n => n * 2;\n');
  write('packages/domain/model.mjs', 'export const model = n => n * 2;\n');
  const base = commit();
  write('packages/domain/model.mjs', "import {twice} from '../app/api.mjs';\nexport const model = n => twice(n);\n");
  const head = commit();
  const input = { repoDir: tree, blueprintPath: policy };
  const reviewInput = { repoDir: tree, baseRevision: base, headRevision: head, blueprint: bp };
  const review = api.reviewArchitectureChange(reviewInput);
  assert.equal(review.status, 'compared'); assert.equal(review.delta.violations.added.length, 1);
  const basePolicy = structuredClone(bp);
  basePolicy.constraints[1].scopePaths = ['packages/app/**'];
  const policyInput = { repoDir: tree, revision: head, repoName: 'example-org/storefront', baseBlueprint: basePolicy, candidateBlueprint: bp };
  const impact = api.reviewPolicyImpact(policyInput);
  assert.equal(impact.status, 'compared'); assert.equal(impact.delta.introduced.length, 1);
  assert.equal(impact.reports.base.verdict, 'pass'); assert.equal(impact.reports.candidate.verdict, 'fail');
  write('.bce/base-policy.json', json(basePolicy));
  const impactArgs = ['policy-impact', '--repo', tree, '--repo-name', 'example-org/storefront', '--revision', head,
    '--base-blueprint', '.bce/base-policy.json', '--candidate-blueprint', policy];
  assert.deepEqual(JSON.parse(run('policy impact CLI', 1, impactArgs).stdout), impact);
  const incompatible = structuredClone(bp); incompatible.extraction.minFiles += 1;
  assert.equal(api.reviewPolicyImpact({ ...policyInput, candidateBlueprint: incompatible }).status, 'refused');
  write('.bce/incompatible-policy.json', json(incompatible));
  const rejectedImpact = run('incompatible policy impact', 2, [...impactArgs.slice(0, -1), '.bce/incompatible-policy.json']);
  assert.equal(JSON.parse(rejectedImpact.stdout).delta, null);
  process.stdout.write(`packed public ${mode} policy impact: frozen source, raw findings and incompatible acquisition refusal PASS\n`);
  const evidence = api.captureRepairEvidence(input);
  const briefs = api.buildRepairBriefs({ ...input, evidence });
  assert.equal(briefs.briefs.length, 1);
  assert.equal(briefs.briefs[0].workOrder.constraintId, review.delta.violations.added[0].constraintId);
  write('.bce/repair/api-evidence.json', json(evidence));
  run('API evidence accepted by CLI brief', 0, ['repair', 'brief', '--repo', tree, '--blueprint', policy, '--evidence', '.bce/repair/api-evidence.json']);
  const captured = join(tree, '.bce/repair/cli-evidence.json');
  run('CLI capture', 0, ['repair', 'capture', '--repo', tree, '--blueprint', policy, '--out', '.bce/repair/cli-evidence.json']);
  assert.equal(api.buildRepairBriefs({ ...input, evidence: read(captured) }).briefs.length, 1);
  write('packages/domain/model.mjs', readFileSync(join(tree, 'packages/domain/model.mjs'), 'utf8') + '// live-only change\n');
  assert.throws(() => api.buildRepairBriefs({ ...input, evidence }), /stale or mismatched/);
  const stale = run('stale repair refusal', 2, ['repair', 'brief', '--repo', tree, '--blueprint', policy, '--evidence', '.bce/repair/api-evidence.json']);
  assert.match(stale.stderr, /stale or mismatched/);
  assert.deepEqual(api.reviewArchitectureChange(reviewInput), review, 'frozen review must ignore live-tree changes');
  write('packages/domain/model.mjs', 'export const model = n => n * 2;\n');
  functional();
  const repaired = api.captureRepairEvidence(input);
  assert.equal(repaired.report.verdict, 'pass');
  assert.equal(api.buildRepairBriefs({ ...input, evidence: repaired }).briefs.length, 0);
  const fixed = commit();
  const fixedReview = run('fixed architecture CLI review', 0, ['architecture-review', '--repo', tree, '--blueprint', join(tree, policy), '--base', head, '--head', fixed]);
  assert.equal(JSON.parse(fixedReview.stdout).delta.violations.removed.length, 1);
  process.stdout.write('packed architecture/repair: frozen revision delta, cross-entry evidence, stale refusal and functional fix PASS\n');

  bp.constraints = [{ id: 'bounded', type: 'forbiddenDependencyPath', maxHops: 2, severity: 'critical', to: 'module:packages/app/**', scopePaths: ['packages/domain/**'] }];
  bp.minEngineVersion = '0.6.1';
  write(policy, json(bp));
  write('packages/bridge.mjs', "import {twice} from './app/api.mjs';\nexport const helper = n => twice(n);\n");
  write('packages/domain/model.mjs', "import {helper} from '../bridge.mjs';\nexport {helper} from '../bridge.mjs';\nexport const model = n => helper(n);\n");
  const boundedHead = commit();
  const unsupported = api.reviewArchitectureChange({ ...reviewInput, blueprint: bp, baseRevision: boundedHead, headRevision: boundedHead });
  assert.equal(unsupported.status, 'refused'); assert.equal(unsupported.delta, null);
  assert.match(unsupported.refusals.join(' '), /unsupported constraint/);
  const refused = run('bounded architecture refusal', 2, ['architecture-review', '--repo', tree, '--blueprint', join(tree, policy), '--base', boundedHead, '--head', boundedHead]);
  assert.deepEqual(JSON.parse(refused.stdout), unsupported, 'CLI must preserve the API unsupported-constraint refusal');
  assert.match(refused.stderr, /unsupported constraint/);
  const boundedEvidence = api.captureRepairEvidence(input);
  const boundedBriefs = api.buildRepairBriefs({ ...input, evidence: boundedEvidence }).briefs;
  assert.equal(boundedBriefs.length, 2);
  assert.equal(new Set(boundedBriefs.map(b => b.workOrder.id)).size, 2);
  assert.match(boundedEvidence.report.violations[0].observed, /2 hops/);
  for (const brief of boundedBriefs) {
    assert.equal(brief.context.path, 'packages/bridge.mjs'); assert.equal(brief.proposedScope.authority, 'NONE');
  }
  run('bounded RED', 1, ['gate', '--repo', tree]);
  const old = run('published predecessor refuses new floor', 2, ['gate', '--repo', tree], installedCli(oldRoot));
  assert.match(old.stderr, /0\.6\.1/);
  assert.match(old.stderr, /requires|upgrade|minimum/i);
  const policyBytes = readFileSync(join(tree, policy), 'utf8');
  write('packages/bridge.mjs', 'export const helper = n => n * 2;\n');
  assert.throws(() => api.buildRepairBriefs({ ...input, evidence: boundedEvidence }), /stale or mismatched/);
  functional();
  run('bounded GREEN', 0, ['gate', '--repo', tree]);
  assert.equal(api.captureRepairEvidence(input).report.verdict, 'pass');
  assert.equal(readFileSync(join(tree, policy), 'utf8'), policyBytes, 'repair must preserve the policy');
  write('packages/bridge.mjs', 'void import(process.env.TARGET);\nexport const helper = n => n * 2;\n');
  const incomplete = run('bounded incomplete refusal', 2, ['gate', '--repo', tree]);
  assert.match(incomplete.stderr, /unresolved|incomplete/i);
  process.stdout.write('packed bounded paths: anchored RED, functional GREEN, incomplete/unsupported and published predecessor refusals PASS\n');

  bp.constraints.push({ id: 'no-legacy-package', type: 'forbiddenStackPackage', severity: 'critical', packageName: 'legacy' });
  bp.evidenceRequirements = [{ type: 'staticAst', required: true, onMissing: 'block' }, { type: 'declaredStack', required: true, onMissing: 'block' }];
  bp.stack = { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] };
  write(policy, json(bp));
  write('package.json', json({ name: 'consumer-proof', version: '1.0.0' }));
  write('package-lock.json', json({ name: 'consumer-proof', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'consumer-proof', version: '1.0.0' } } }));
  const mixed = api.computeGateReport(tree, join(tree, '.blueprints'), null, 'ast').doc;
  assert.equal(mixed.exitCode, 2); assert.equal(mixed.outcome, 'refusal');
  function assertMixed(report) {
    assert.equal(report.schemaVersion, '2'); assert.equal(report.score, null); assert.equal(report.verdict, 'indeterminate');
    assert.ok(report.refusals.some(r => r.code === 'dependency-path-incomplete'));
  }
  assertMixed(mixed.reports[0]);
  assert.throws(() => api.captureRepairEvidence(input), /unsupported repair report type/);
  for (const mode of ['enforced', 'advisory']) {
    write('.bce-mode.json', json({ mode }));
    const gateReport = join(tree, `.bce/repair/mixed-${mode}.json`);
    run(`mixed ${mode} gate refuses`, 2, ['gate', '--repo', tree, '--report-json', gateReport]);
    assertMixed(read(gateReport).reports[0]);
    const runReport = join(tree, `.bce/repair/mixed-run-${mode}.json`);
    run(`mixed ${mode} run refuses`, 2, ['run', '--blueprint', join(tree, policy), '--ct-repo', tree, '--no-pin', '--out', runReport]);
    assertMixed(read(runReport));
  }
  process.stdout.write('packed mixed evidence: API/CLI gate/run preserve schema-2 null-score refusal in enforced/advisory modes PASS\n');

  const fixture = join(installedRoot, 'fixtures/stack/pnpm-v9-workspace-review');
  const snapshot = (repo, aware = true) => {
    const result = api.extractStackManifest(repo, 'fixture', 'npm-lockfile', undefined, aware);
    assert.deepEqual(result.refusals, []); return result.manifest;
  };
  const legacy = snapshot(fixture, false), aware = snapshot(fixture);
  assert.equal(aware.schemaVersion, '2'); assert.equal(legacy.schemaVersion, '1');
  assert.equal(legacy.stackDigest, aware.stackDigest);
  assert.equal(api.stackDiffExitCode(api.diffStackManifests(legacy, aware)), 2);
  assert.equal(api.stackDiffExitCode(api.diffStackManifests(aware, aware)), 0);
  const down = join(scratch, 'downgraded'), removed = join(scratch, 'removed');
  cpSync(fixture, down, { recursive: true }); cpSync(fixture, removed, { recursive: true });
  const lock = readFileSync(join(fixture, 'pnpm-lock.yaml'), 'utf8');
  const importer = /  packages\/lib:[\s\S]*?(?=\n  packages\/svc:)/;
  assert.match(lock, importer);
  writeFileSync(join(down, 'pnpm-lock.yaml'), lock.replace(importer, m => m.replaceAll('7.0.0', '6.0.0')));
  const pkg = join(down, 'packages/lib/package.json');
  writeFileSync(pkg, readFileSync(pkg, 'utf8').replace('7.0.0', '6.0.0'));
  writeFileSync(join(removed, 'pnpm-lock.yaml'), lock.replace(importer, ''));
  rmSync(join(removed, 'packages/lib'), { recursive: true });
  const downgraded = snapshot(down), dropped = snapshot(removed);
  assert.equal(aware.stackDigest, downgraded.stackDigest);
  assert.notEqual(aware.manifestDigest, downgraded.manifestDigest);
  const diff = api.diffStackManifests(aware, downgraded);
  assert.equal(api.stackDiffExitCode(diff), 2);
  assert.ok(diff.moves.some(m => m.class === 'backward' && m.from === '7.0.0' && m.to === '6.0.0' && m.declaredBy === 'importer:["packages/lib","is-number"]'));
  assert.equal(api.stackDiffExitCode(api.diffStackManifests(aware, dropped)), 0);
  const out = join(scratch, 'snapshots'); mkdirSync(out);
  for (const [name, repo, workspace] of [['base', fixture, true], ['legacy', fixture, false], ['down', down, true], ['removed', removed, true]]) {
    run(`${name} snapshot`, 0, ['stack', 'snapshot', '--ct-repo', repo, '--no-pin', ...(workspace ? ['--workspace-aware'] : []), '--out', join(out, `${name}.json`)]);
  }
  for (const [from, to, exit] of [['base', 'base', 0], ['base', 'down', 2], ['base', 'removed', 0], ['legacy', 'base', 2]]) {
    const report = join(out, `${from}-${to}.json`);
    run(`${from}/${to} stack diff`, exit, ['stack', 'diff', '--from', join(out, `${from}.json`), '--to', join(out, `${to}.json`), '--out', report]);
    if (to === 'down') assert.ok(read(report).moves.some(m => m.class === 'backward' && m.declaredBy === 'importer:["packages/lib","is-number"]'));
  }
  const npmRefusal = run('npm workspace opt-in refuses', 2, ['stack', 'snapshot', '--ct-repo', tree, '--no-pin', '--workspace-aware', '--out', join(out, 'npm.json')]);
  assert.match(npmRefusal.stderr, /require a validated pnpm/);
  process.stdout.write('packed workspace stack: importer downgrade/removal, closure identity, opt-in and mixed-schema refusal PASS\n');
  assert.equal(existsSync(join(installedRoot, 'scripts/adoption-attempts.mjs')), false);
  assert.match(readFileSync(join(installedRoot, 'docs/adoption-lifecycle.md'), 'utf8'), /opt-in source-checkout workflow/);
  process.stdout.write(`packed public ${mode} release features: PASS (adoption collection remains source-checkout-only)\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
