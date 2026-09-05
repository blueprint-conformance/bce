#!/usr/bin/env node
/** Deterministically prove every sealed task has a safe, conforming reference solution. */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, hashTree, resolveInside, sha256Bytes, verifyBundle,
} from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = resolve(valueAfter('--bundle') ?? 'research/model-evaluation');
const requireSealed = process.argv.includes('--require-sealed');
const verified = verifyBundle(bundleDir, { requireSealed });
if (!verified.ok) throw new Error(`reference verification refused by bundle verifier:\n${verified.refusals.map((item) => `- ${item}`).join('\n')}`);
const { protocol, manifest, protectedPaths } = verified;
const selfPath = fileURLToPath(import.meta.url);
if (protocol.implementation.referenceVerifierSha256 && sha256Bytes(readFileSync(selfPath)) !== protocol.implementation.referenceVerifierSha256) {
  throw new Error('running reference verifier differs from the protocol-frozen implementation');
}

function run(file, args, cwd, timeout = 120000, env = process.env) {
  return spawnSync(file, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
}

function globToRegExp(glob) {
  const marker = '__DOUBLE_STAR__';
  const escaped = glob.replace(/\*\*/g, marker).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replaceAll(marker, '.*');
  return new RegExp(`^${escaped}$`);
}
const matchesAny = (path, patterns) => patterns.some((pattern) => globToRegExp(pattern).test(path));

function inventory(root) {
  const base = realpathSync(root);
  const entries = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      if (['.git', 'node_modules', 'coverage'].includes(name)) continue;
      const absolute = join(directory, name);
      const path = relative(base, absolute).split(sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`symbolic link refused in reference workspace: ${path}`);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isFile()) entries.push({ path, mode: stat.mode & 0o777, sha256: sha256Bytes(readFileSync(absolute)) });
      else throw new Error(`unsupported reference-workspace entry: ${path}`);
    }
  };
  walk(base);
  return entries;
}

function changedPaths(before, after) {
  const left = new Map(before.map((entry) => [entry.path, entry]));
  const right = new Map(after.map((entry) => [entry.path, entry]));
  return [...new Set([...left.keys(), ...right.keys()])].sort()
    .filter((path) => canonicalJson(left.get(path) ?? null) !== canonicalJson(right.get(path) ?? null));
}

function parseOracle(result, task, treeSha256, kind, label) {
  const lines = String(result.stdout ?? '').split('\n').filter((line) => line.trim().startsWith('{'));
  let document = null;
  try { document = JSON.parse(lines.at(-1) ?? 'null'); } catch {}
  const valid = result.status === 0 && document?.schemaVersion === '1' && document.taskId === task.id &&
    document.inputTreeSha256 === treeSha256 && typeof document.passed === 'boolean' && Array.isArray(document.locations) &&
    (kind !== 'functional' || typeof document.collateralRegression === 'boolean');
  if (!valid) throw new Error(`${task.id}: ${kind} oracle emitted invalid ${label} evidence (${result.status}): ${result.stderr}\n${result.stdout}`);
  return document;
}

function runOracleTwice(task, kind, workspace, baselineTreeSha256, expectedPassed, label) {
  const oracle = kind === 'functional' ? task.functionalOracle : task.architectureOracle;
  if (oracle.command.length !== 2 || oracle.command[0] !== 'node' || oracle.command[1] !== oracle.artifact.path) {
    throw new Error(`${task.id}: ${kind} oracle is not the sealed node + artifact form`);
  }
  const executable = protocol.isolation.runtimeExecutable;
  const artifact = resolveInside(bundleDir, oracle.artifact.path, `${task.id} ${kind} oracle`);
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    BCE_EVAL_WORKSPACE: workspace,
    BCE_EVAL_TASK_ID: task.id,
    BCE_EVAL_INPUT_TREE_SHA256: baselineTreeSha256,
  };
  const first = parseOracle(run(executable, [artifact], workspace, task.budget.timeoutMs, env), task, baselineTreeSha256, kind, label);
  if (hashTree(workspace) !== baselineTreeSha256) throw new Error(`${task.id}: ${kind} oracle mutated the ${label} workspace`);
  const second = parseOracle(run(executable, [artifact], workspace, task.budget.timeoutMs, env), task, baselineTreeSha256, kind, label);
  if (hashTree(workspace) !== baselineTreeSha256) throw new Error(`${task.id}: ${kind} oracle mutated the ${label} workspace on replay`);
  if (canonicalJson(first) !== canonicalJson(second)) throw new Error(`${task.id}: ${kind} oracle is not deterministic on the ${label}`);
  if (first.passed !== expectedPassed) throw new Error(`${task.id}: ${kind} oracle did not produce expected ${label} verdict ${expectedPassed}`);
}

function proveBceGate(task, workspace, scratch, expectedPassed, label) {
  const runtime = join(scratch, 'treatment');
  mkdirSync(runtime, { recursive: true });
  const archive = resolveInside(bundleDir, protocol.treatment.engineArtifact, 'treatment archive');
  const extracted = run('/usr/bin/tar', ['-xzf', archive, '-C', runtime], workspace, task.budget.timeoutMs, { ...process.env, COPYFILE_DISABLE: '1' });
  if (extracted.status !== 0) throw new Error(`${task.id}: treatment extraction failed: ${extracted.stderr}`);
  if (hashTree(runtime, { includeNodeModules: true }) !== protocol.treatment.installedTreeSha256) throw new Error(`${task.id}: extracted treatment digest mismatch`);
  const engine = join(runtime, 'node_modules', 'bce-engine');
  const cli = join(engine, 'dist', 'cli.js');
  if (!statSync(cli).isFile()) throw new Error(`${task.id}: treatment has no built CLI`);
  const blueprint = join(workspace, '.blueprints', `${task.id}.blueprint.json`);
  const invariant = JSON.parse(readFileSync(resolveInside(bundleDir, task.invariant.path, `${task.id} invariant`), 'utf8'));
  const constraintId = invariant.constraint?.id;
  if (typeof constraintId !== 'string') throw new Error(`${task.id}: normalized invariant has no constraint id`);
  mkdirSync(dirname(blueprint), { recursive: true });
  copyFileSync(resolveInside(bundleDir, task.blueprint.path, `${task.id} blueprint`), blueprint);
  writeFileSync(join(workspace, '.bce-mode.json'), '{\n  "mode": "enforced"\n}\n');
  const reportPath = join(scratch, 'gate-report.json');
  const result = run(protocol.isolation.runtimeExecutable, [cli, 'gate', '--repo', '.', '--blueprint-dir', '.blueprints', '--extractor', 'ast', '--report-json', reportPath], workspace, task.budget.timeoutMs, { PATH: process.env.PATH ?? '/usr/bin:/bin' });
  let report = null;
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch {}
  const commonValid = report?.schemaVersion === '1' && Array.isArray(report.refusals) && report.refusals.length === 0 &&
    Array.isArray(report.reports) && report.reports.length === 1 && report.exitCode === result.status;
  const namedViolation = report?.reports?.[0]?.violations?.some((violation) => violation.constraintId === constraintId) === true;
  const valid = expectedPassed
    ? commonValid && result.status === 0 && report.gateFailed === false && report.outcome === 'pass' && report.reports[0].verdict === 'pass'
    : commonValid && result.status === 1 && report.gateFailed === true && report.outcome === 'violation' && report.reports[0].verdict === 'fail' && namedViolation;
  if (!valid) throw new Error(`${task.id}: BCE gate did not produce the exact expected ${label} verdict ${expectedPassed}:\n${result.stdout}\n${result.stderr}\n${JSON.stringify(report)}`);
}

function runVisibleCommands(task, workspace, baselineTreeSha256, expectedPassed, label) {
  const results = task.visibleCommands.map(([file, ...args]) => run(file, args, workspace, task.budget.timeoutMs));
  const passed = results.every((result) => result.status === 0);
  if (passed !== expectedPassed) {
    const evidence = results.map((result) => `exit=${result.status}\n${result.stdout}\n${result.stderr}`).join('\n');
    throw new Error(`${task.id}: visible commands did not produce expected ${label} verdict ${expectedPassed}:\n${evidence}`);
  }
  if (hashTree(workspace) !== baselineTreeSha256) throw new Error(`${task.id}: visible command mutated the ${label} workspace`);
}

function proveTaskBase(task, repository) {
  const expected = {
    repair: { functional: false, architecture: false, gate: false },
    feature: { functional: false, architecture: true, gate: true },
    refactor: { functional: true, architecture: false, gate: false },
  }[task.taskType];
  const scratch = mkdtempSync(join(tmpdir(), `bce-base-${task.id}-`));
  try {
    const workspace = join(scratch, 'workspace');
    cpSync(resolveInside(bundleDir, repository.treePath, `${repository.id} tree`), workspace, { recursive: true });
    for (const command of repository.setupCommands) {
      const [file, ...args] = command;
      const result = run(file, args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: base setup command failed: ${result.stderr}`);
    }
    const treeSha256 = hashTree(workspace);
    if (treeSha256 !== repository.preparedTreeSha256) throw new Error(`${task.id}: prepared base tree digest mismatch`);
    inventory(workspace);
    runVisibleCommands(task, workspace, treeSha256, expected.functional, `${task.taskType} base`);
    runOracleTwice(task, 'functional', workspace, treeSha256, expected.functional, `${task.taskType} base`);
    runOracleTwice(task, 'architecture', workspace, treeSha256, expected.architecture, `${task.taskType} base`);
    proveBceGate(task, workspace, scratch, expected.gate, `${task.taskType} base`);
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function proveTaskPatch(task, repository, patchArtifact, label, expectedArchitecturePassed, expectedGatePassed) {
  const scratch = mkdtempSync(join(tmpdir(), `bce-${label}-${task.id}-`));
  try {
    const workspace = join(scratch, 'workspace');
    cpSync(resolveInside(bundleDir, repository.treePath, `${repository.id} tree`), workspace, { recursive: true });
    for (const command of repository.setupCommands) {
      const [file, ...args] = command;
      const result = run(file, args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: setup command failed: ${result.stderr}`);
    }
    if (hashTree(workspace) !== repository.preparedTreeSha256) throw new Error(`${task.id}: prepared reference tree digest mismatch`);
    inventory(workspace);
    for (const args of [
      ['init', '-q'], ['add', '-A'],
      ['-c', 'user.name=BCE reference verifier', '-c', 'user.email=reference@invalid.example', 'commit', '-q', '-m', 'prepared task'],
    ]) {
      const result = run('git', args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: git preparation failed: ${result.stderr}`);
    }
    const before = inventory(workspace);
    const patch = resolveInside(bundleDir, patchArtifact.path, `${task.id} ${label} patch`);
    for (const args of [['apply', '--check', '--whitespace=error-all', patch], ['apply', '--whitespace=error-all', patch]]) {
      const result = run('git', args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: git ${args[0]} ${label} patch failed: ${result.stderr}`);
    }
    const after = inventory(workspace);
    const changes = changedPaths(before, after);
    if (changes.length === 0) throw new Error(`${task.id}: ${label} patch makes no source change`);
    const globalPatterns = [...protectedPaths.patterns, ...(protectedPaths.packagePolicy?.files ?? [])];
    const illegal = changes.filter((path) => !matchesAny(path, task.allowedPaths) || matchesAny(path, [...globalPatterns, ...task.protectedPaths]));
    if (illegal.length) throw new Error(`${task.id}: ${label} patch changed forbidden paths: ${illegal.join(', ')}`);
    const solutionTreeSha256 = hashTree(workspace);
    runVisibleCommands(task, workspace, solutionTreeSha256, true, label);
    runOracleTwice(task, 'functional', workspace, solutionTreeSha256, true, label);
    runOracleTwice(task, 'architecture', workspace, solutionTreeSha256, expectedArchitecturePassed, label);
    proveBceGate(task, workspace, scratch, expectedGatePassed, label);
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

let referencesProven = 0;
let shortcutsProven = 0;
let basesProven = 0;
for (const task of manifest.tasks) {
  if (!task.referencePatch || !task.referencePatchSha256) throw new Error(`${task.id}: no sealed reference patch artifact`);
  if (task.referencePatch.sha256 !== task.referencePatchSha256) throw new Error(`${task.id}: reference patch digest binding mismatch`);
  const repository = manifest.repositories.find((entry) => entry.id === task.repositoryId);
  if (!repository) throw new Error(`${task.id}: repository missing`);
  if (task.shortcutPatch) {
    proveTaskBase(task, repository);
    basesProven += 1;
  }
  proveTaskPatch(task, repository, task.referencePatch, 'reference solution', true, true);
  referencesProven += 1;
  if (task.shortcutPatch || task.shortcutPatchSha256) {
    if (!task.shortcutPatch || task.shortcutPatch.sha256 !== task.shortcutPatchSha256) throw new Error(`${task.id}: shortcut patch digest binding mismatch`);
    proveTaskPatch(task, repository, task.shortcutPatch, 'shortcut witness', false, false);
    shortcutsProven += 1;
  }
}
process.stdout.write(`model-evaluation task apparatus verified: ${basesProven}/${manifest.tasks.length} base truth tables; ${referencesProven}/${manifest.tasks.length} references; ${shortcutsProven}/${manifest.tasks.length} shortcut witnesses\n`);
