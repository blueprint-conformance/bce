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

function parseOracle(result, task, treeSha256, kind) {
  const lines = String(result.stdout ?? '').split('\n').filter((line) => line.trim().startsWith('{'));
  let document = null;
  try { document = JSON.parse(lines.at(-1) ?? 'null'); } catch {}
  const valid = result.status === 0 && document?.schemaVersion === '1' && document.taskId === task.id &&
    document.inputTreeSha256 === treeSha256 && document.passed === true && Array.isArray(document.locations) &&
    (kind !== 'functional' || typeof document.collateralRegression === 'boolean');
  if (!valid) throw new Error(`${task.id}: ${kind} oracle rejected the reference solution (${result.status}): ${result.stderr}\n${result.stdout}`);
  return document;
}

function runOracleTwice(task, kind, workspace, baselineTreeSha256) {
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
  const first = parseOracle(run(executable, [artifact], workspace, task.budget.timeoutMs, env), task, baselineTreeSha256, kind);
  if (hashTree(workspace) !== baselineTreeSha256) throw new Error(`${task.id}: ${kind} oracle mutated the reference workspace`);
  const second = parseOracle(run(executable, [artifact], workspace, task.budget.timeoutMs, env), task, baselineTreeSha256, kind);
  if (hashTree(workspace) !== baselineTreeSha256) throw new Error(`${task.id}: ${kind} oracle mutated the reference workspace on replay`);
  if (canonicalJson(first) !== canonicalJson(second)) throw new Error(`${task.id}: ${kind} oracle is not deterministic on the reference solution`);
}

function proveBceGate(task, workspace, scratch) {
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
  mkdirSync(dirname(blueprint), { recursive: true });
  copyFileSync(resolveInside(bundleDir, task.blueprint.path, `${task.id} blueprint`), blueprint);
  writeFileSync(join(workspace, '.bce-mode.json'), '{\n  "mode": "enforced"\n}\n');
  const result = run(protocol.isolation.runtimeExecutable, [cli, 'gate', '--repo', '.', '--blueprint-dir', '.blueprints'], workspace, task.budget.timeoutMs, { PATH: process.env.PATH ?? '/usr/bin:/bin' });
  if (result.status !== 0) throw new Error(`${task.id}: BCE gate rejected the reference solution:\n${result.stdout}\n${result.stderr}`);
}

let proven = 0;
for (const task of manifest.tasks) {
  if (!task.referencePatch || !task.referencePatchSha256) throw new Error(`${task.id}: no sealed reference patch artifact`);
  if (task.referencePatch.sha256 !== task.referencePatchSha256) throw new Error(`${task.id}: reference patch digest binding mismatch`);
  const repository = manifest.repositories.find((entry) => entry.id === task.repositoryId);
  if (!repository) throw new Error(`${task.id}: repository missing`);
  const scratch = mkdtempSync(join(tmpdir(), `bce-reference-${task.id}-`));
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
    const patch = resolveInside(bundleDir, task.referencePatch.path, `${task.id} reference patch`);
    for (const args of [['apply', '--check', '--whitespace=error-all', patch], ['apply', '--whitespace=error-all', patch]]) {
      const result = run('git', args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: git ${args[0]} reference patch failed: ${result.stderr}`);
    }
    const after = inventory(workspace);
    const changes = changedPaths(before, after);
    if (changes.length === 0) throw new Error(`${task.id}: reference patch makes no source change`);
    const globalPatterns = [...protectedPaths.patterns, ...(protectedPaths.packagePolicy?.files ?? [])];
    const illegal = changes.filter((path) => !matchesAny(path, task.allowedPaths) || matchesAny(path, [...globalPatterns, ...task.protectedPaths]));
    if (illegal.length) throw new Error(`${task.id}: reference patch changed forbidden paths: ${illegal.join(', ')}`);
    const solutionTreeSha256 = hashTree(workspace);
    for (const command of task.visibleCommands) {
      const [file, ...args] = command;
      const result = run(file, args, workspace, task.budget.timeoutMs);
      if (result.status !== 0) throw new Error(`${task.id}: visible command rejected the reference solution: ${result.stderr}\n${result.stdout}`);
      if (hashTree(workspace) !== solutionTreeSha256) throw new Error(`${task.id}: visible command mutated the reference workspace`);
    }
    runOracleTwice(task, 'functional', workspace, solutionTreeSha256);
    runOracleTwice(task, 'architecture', workspace, solutionTreeSha256);
    proveBceGate(task, workspace, scratch);
    proven += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
process.stdout.write(`model-evaluation reference patches verified: ${proven}/${manifest.tasks.length}\n`);
