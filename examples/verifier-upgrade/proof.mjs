#!/usr/bin/env node
// Offline proof of this example against an already admitted package and its tarball.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { identify, capture, boundedRun } from './capture.mjs';
import { compare, digest, loadCapture, stable } from './compare.mjs';

const [packageRoot, tarball] = process.argv.slice(2);
if (!packageRoot || !tarball) throw new Error('usage: proof.mjs <admitted-installed-package> <admitted-tarball>');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-upgrade-proof-'));
try {
  const repo = path.join(scratch, 'fixture');
  fs.cpSync(fileURLToPath(new URL('./fixture', import.meta.url)), repo, { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=' + path.join(scratch, 'no-hooks'), '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('add', 'policy.json', 'packages');
  git('-c', 'user.name=Recipe fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'module fixture');
  const revision = git('rev-parse', 'HEAD');
  fs.mkdirSync(path.join(repo, '.git/info'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git/info/attributes'), 'packages/** export-ignore\n');
  const admission = { ...identify(packageRoot, tarball), provenance: 'Test operator explicitly admitted the package under test; this local record is not authenticated provenance.' };
  const identityFile = path.join(scratch, 'identity.json'); fs.writeFileSync(identityFile, stable(admission));
  let controls = 0;
  // Junctions exercise the same alias on Windows without requiring symlink privileges.
  const recipeAlias = path.join(scratch, 'recipe-alias');
  fs.symlinkSync(fileURLToPath(new URL('.', import.meta.url)), recipeAlias, process.platform === 'win32' ? 'junction' : 'dir');
  const identified = await boundedRun([process.execPath, path.join(recipeAlias, 'capture.mjs'), 'identify', packageRoot, tarball], scratch);
  assert.equal(identified.exit, 0, identified.stderr);
  assert.deepEqual(JSON.parse(identified.stdout), identify(packageRoot, tarball)); controls++;
  const importDriver = path.join(scratch, 'import-driver.mjs');
  fs.writeFileSync(importDriver, "import { pathToFileURL } from 'node:url'; await import(pathToFileURL(process.argv[2])); process.stdout.write('import-only\\n');\n");
  for (const module of ['capture.mjs', 'compare.mjs']) {
    const imported = await boundedRun([process.execPath, importDriver, path.join(recipeAlias, module)], scratch);
    assert.equal(imported.exit, 0, imported.stderr);
    assert.equal(imported.stdout, 'import-only\n'); assert.equal(imported.stderr, ''); controls++;
  }
  // Working-tree content must not affect either immutable extraction.
  fs.appendFileSync(path.join(repo, 'packages/domain/model.ts'), '\nvoid import(unresolvedName);\n');
  await capture(identityFile, repo, revision, path.join(scratch, 'base'));
  const captured = await boundedRun([process.execPath, path.join(recipeAlias, 'capture.mjs'), 'capture', identityFile, repo, revision, path.join(scratch, 'candidate')], scratch);
  assert.equal(captured.exit, 0, captured.stderr);
  assert.equal(JSON.parse(captured.stdout).exit, 1); controls++;
  const base = loadCapture(path.join(scratch, 'base')), candidate = loadCapture(path.join(scratch, 'candidate'));
  const result = compare(base, candidate, admission, admission);
  assert.equal(result.status, 'equivalent-observations', JSON.stringify(result));
  const compared = await boundedRun([process.execPath, path.join(recipeAlias, 'compare.mjs'), path.join(scratch, 'base'), path.join(scratch, 'candidate'), identityFile, identityFile], scratch);
  assert.equal(compared.exit, 0, compared.stderr);
  assert.deepEqual(JSON.parse(compared.stdout), result); controls++;
  assert.equal(result.baseExit, 1); assert.equal(result.candidateExit, 1);
  assert.equal(base.report.violations.length, 1);
  assert.equal(candidate.bundle.artifacts.graph.ctRepoRevision, revision);
  const rehash = value => {
    for (const key of ['blueprint', 'graph', 'report']) value.bundle.hashes[key] = digest(value.bundle.artifacts[key]);
    const { bundle: ignored, ...hashes } = value.bundle.hashes; void ignored;
    value.bundle.hashes.bundle = digest({ ...value.bundle, hashes });
    value.report = structuredClone(value.bundle.artifacts.report);
  };
  const refuse = (name, mutate) => {
    const changed = structuredClone(candidate); mutate(changed);
    assert.equal(compare(base, changed, admission, admission).status, 'incomparable', name); controls++;
  };
  refuse('lost module despite unchanged verdict', value => { value.bundle.artifacts.graph.components.pop(); rehash(value); });
  refuse('artifact mismatch', value => { value.receipt.artifact.tarballSha256 = '0'.repeat(64); });
  refuse('executed tree mutated', value => { value.receipt.artifactAfter.dependencyTreeSha256 = '0'.repeat(64); });
  refuse('source mutated', value => { value.receipt.after.files[0].sha256 = '0'.repeat(64); });
  refuse('source revision mismatch', value => { value.bundle.artifacts.graph.ctRepoRevision = '0'.repeat(40); rehash(value); });
  refuse('policy mismatch', value => { value.bundle.artifacts.blueprint.metadata.id = 'changed'; rehash(value); });
  refuse('bundle corruption', value => { value.bundle.hashes.bundle = '0'.repeat(64); });
  refuse('unsupported schema', value => { value.bundle.schemaVersion = '99'; rehash(value); });
  refuse('unsupported profile', value => { value.bundle.invocation.extractionProfile = 'python-module-graph'; rehash(value); });
  refuse('missing bundle', value => { delete value.bundle; });
  refuse('malformed report', value => { value.bundle.artifacts.report.violations = null; rehash(value); });
  // Schema-1 producers omit the empty unresolved-import list. Preserve that
  // historical representation while refusing malformed or unresolved coverage.
  for (const representation of ['omitted', 'empty-array']) {
    const complete = structuredClone(candidate);
    for (const artifact of ['graph', 'report']) {
      if (representation === 'omitted') delete complete.bundle.artifacts[artifact].coverage.unresolvedImports;
      else complete.bundle.artifacts[artifact].coverage.unresolvedImports = [];
    }
    rehash(complete);
    assert.equal(compare(complete, complete, admission, admission).status, 'equivalent-observations', representation); controls++;
  }
  for (const unresolved of [null, {}, '', 0, [{ from: 'module:packages/app/api.ts', specifier: 'unknown', kind: 'import', ref: 'packages/app/api.ts#L1', reason: 'unresolved' }]]) {
    refuse('invalid or unresolved import coverage: ' + JSON.stringify(unresolved), value => {
      value.bundle.artifacts.graph.coverage.unresolvedImports = unresolved;
      value.bundle.artifacts.report.coverage.unresolvedImports = unresolved;
      rehash(value);
    });
  }
  refuse('acquisition changed', value => { value.receipt.resolvedExtraction.minFiles++; });
  refuse('missing process receipt fields', value => { value.receipt.process = { exit: 1 }; });
  refuse('crash', value => { value.receipt.process.exit = 7; });
  refuse('timeout', value => { value.receipt.process.timeout = true; });
  refuse('output bound', value => { value.receipt.process.outputLimit = true; });
  const historical = structuredClone(candidate);
  historical.bundle.artifacts.report.violations[0].observed += ' (historical evaluator wording)'; rehash(historical);
  assert.equal(compare(base, historical, admission, admission).status, 'changed-observations'); controls++;
  const otherIdentity = structuredClone(admission), sameVersion = structuredClone(candidate);
  otherIdentity.artifact.tarballSha256 = 'a'.repeat(64);
  sameVersion.receipt.artifact = structuredClone(otherIdentity.artifact); sameVersion.receipt.artifactAfter = structuredClone(otherIdentity.artifact);
  assert.equal(compare(base, sameVersion, admission, otherIdentity).artifactIdentityChanged, true); controls++;
  await assert.rejects(capture(identityFile, repo, 'HEAD', path.join(scratch, 'moving')), /immutable/); controls++;
  await assert.rejects(capture(identityFile, repo, revision, path.join(scratch, 'base')), /exist/); controls++;
  const incomplete = await boundedRun([process.execPath, fileURLToPath(new URL('./compare.mjs', import.meta.url)), path.join(scratch, 'missing'), path.join(scratch, 'candidate'), identityFile, identityFile], scratch);
  assert.equal(incomplete.exit, 2); assert.equal(JSON.parse(incomplete.stdout).status, 'incomparable'); controls++;
  const crash = await boundedRun([process.execPath, '-e', 'process.exit(7)'], scratch);
  const timeout = await boundedRun([process.execPath, '-e', 'setInterval(()=>{},1000)'], scratch, { timeoutMs: 100 });
  const overflow = await boundedRun([process.execPath, '-e', 'process.stdout.write("x".repeat(100000))'], scratch, { limitBytes: 1024 });
  assert.equal(crash.exit, 7); assert.equal(timeout.timeout, true); assert.equal(overflow.outputLimit, true); controls += 3;
  const gitEnvironmentProbe = `
    const fs = require('node:fs'), cp = require('node:child_process');
    const file = process.env.GIT_CONFIG_GLOBAL;
    if (!fs.statSync(file).isFile() || fs.readFileSync(file, 'utf8') !== '' || process.env.GIT_CONFIG_VALUE_0 !== file) throw new Error('Git isolation requires a real empty file');
    if (Object.keys(process.env).some(key => /^(NODE_OPTIONS|NODE_PATH|TAR_OPTIONS)$/i.test(key))) throw new Error('ambient execution options were retained');
    cp.execFileSync('git', ['config', '--file', file, '--list']);
    process.stdout.write(JSON.stringify({ file }) + '\\n');
  `;
  const previousTarOptions = process.env.TAR_OPTIONS;
  let environment;
  try {
    process.env.TAR_OPTIONS = '--invalid-ambient-option';
    environment = await boundedRun([process.execPath, '-e', gitEnvironmentProbe], scratch);
  } finally {
    if (previousTarOptions === undefined) delete process.env.TAR_OPTIONS;
    else process.env.TAR_OPTIONS = previousTarOptions;
  }
  assert.equal(environment.exit, 0, environment.stderr);
  assert.equal(fs.existsSync(path.dirname(JSON.parse(environment.stdout).file)), false); controls++;
  const timedEnvironment = await boundedRun([process.execPath, '-e', gitEnvironmentProbe + 'setInterval(()=>{},1000);'], scratch, { timeoutMs: 5000 });
  assert.equal(timedEnvironment.timeout, true);
  assert.equal(fs.existsSync(path.dirname(JSON.parse(timedEnvironment.stdout).file)), false); controls++;
  const missingCommand = await boundedRun([path.join(scratch, 'missing-executable')], scratch);
  assert.ok(missingCommand.error); assert.equal(missingCommand.timeout, false); controls++;
  console.log(`verifier upgrade recipe: independent frozen captures, ${controls} controls, data-only comparison PASS`);
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
