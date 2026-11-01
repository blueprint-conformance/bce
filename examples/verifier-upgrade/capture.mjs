#!/usr/bin/env node
// An explicit first-party recipe, not a package selector, downloader or sandbox.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stable = value => JSON.stringify(canonical(value), null, 2) + '\n';
const equal = (a, b) => stable(a) === stable(b);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function cleanEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_OPTIONS|NODE_PATH|GIT_.*)$/i.test(key)));
  return { ...env, GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull,
    GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.attributesFile', GIT_CONFIG_VALUE_0: os.devNull };
}
function inventory(root) {
  const entries = []; let bytes = 0;
  const walk = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const target = fs.realpathSync(file), relative = path.relative(root, target);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('inventory symlink leaves its root');
        entries.push({ path: path.relative(root, file).split(path.sep).join('/'), symlink: fs.readlinkSync(file) });
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        bytes += stat.size;
        if (bytes > 256 * 1024 * 1024 || entries.length >= 50_000) throw new Error('installation inventory exceeds recipe bounds');
        entries.push({ path: path.relative(root, file).split(path.sep).join('/'), sha256: sha(fs.readFileSync(file)) });
      } else throw new Error('inventory contains a nonregular entry');
    }
  };
  walk(root); return entries;
}

/** Read-only measurement. Its output is NOT provenance verification or permission to execute. */
export function identify(packageRootInput, tarballInput) {
  const packageRoot = fs.realpathSync(packageRootInput), tarball = fs.realpathSync(tarballInput);
  const pkg = read(path.join(packageRoot, 'package.json'));
  if (pkg.name !== 'bce-engine') throw new Error('recipe accepts only explicitly admitted first-party bce-engine artifacts');
  const dependencyRoot = path.basename(path.dirname(packageRoot)) === 'node_modules'
    ? path.dirname(packageRoot) : path.join(packageRoot, 'node_modules');
  const artifact = {
    name: pkg.name, version: pkg.version, tarballSha256: sha(fs.readFileSync(tarball)),
    distInventory: inventory(path.join(packageRoot, 'dist')),
    dependencyLockSha256: sha(fs.readFileSync(path.join(packageRoot, 'npm-shrinkwrap.json'))),
    dependencyTreeSha256: sha(stable(inventory(dependencyRoot))),
    node: process.versions.node, platform: process.platform, arch: process.arch,
  };
  return { paths: { packageRoot, tarball }, artifact };
}

/** Fixed capture processes only use this bound; no CLI accepts arbitrary commands. */
export async function boundedRun(argv, cwd, { timeoutMs = 60_000, limitBytes = 1024 * 1024 } = {}) {
  return await new Promise(resolve => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    const output = { stdout: [], stderr: [] }; let bytes = 0, reason = null, error = null;
    const kill = why => {
      if (reason) return;
      reason = why;
      if (!child.pid) return;
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
        else process.kill(-child.pid, 'SIGKILL');
      } catch { child.kill('SIGKILL'); }
    };
    const timer = setTimeout(() => kill('timeout'), timeoutMs);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', chunk => {
      const remaining = limitBytes - bytes, kept = chunk.subarray(0, Math.max(0, remaining));
      output[stream].push(kept); bytes += kept.length;
      if (chunk.length > remaining) kill('output-limit');
    });
    child.on('error', caught => { error = caught.message; });
    child.on('close', (exit, signal) => {
      clearTimeout(timer);
      resolve({ argv, exit, signal, error, timeout: reason === 'timeout', outputLimit: reason === 'output-limit', timeoutMs, limitBytes,
        stdout: Buffer.concat(output.stdout).toString('utf8'), stderr: Buffer.concat(output.stderr).toString('utf8') });
    });
  });
}

function sourceInventory(repo, revision) {
  const git = args => execFileSync('git', ['-C', repo, ...args], { env: cleanEnv(), timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  if (!/^[0-9a-f]{40}$/.test(revision) || git(['cat-file', '-t', revision]).toString().trim() !== 'commit') throw new Error('full immutable commit SHA required');
  const entries = git(['ls-tree', '-rz', '--full-tree', revision]).toString().split('\0').filter(Boolean);
  if (!entries.length || entries.length > 100) throw new Error('recipe source must contain 1–100 tracked fixture files');
  const files = entries.map(entry => {
    const match = /^(100644|100755) blob [0-9a-f]{40}\t(policy\.json|packages\/(?:[^/]+\/)*[^/]+\.ts)$/.exec(entry);
    if (!match || match[2].split('/').some(part => part === '.' || part === '..')) throw new Error('recipe supports regular policy.json and packages/**/*.ts only; no symlinks/submodules/configuration files');
    return { path: match[2], sha256: sha(git(['show', `${revision}:${match[2]}`])) };
  }).sort((a, b) => a.path < b.path ? -1 : 1);
  const policyBytes = git(['show', `${revision}:policy.json`]);
  const policy = JSON.parse(policyBytes);
  if (policy.extraction?.profile !== 'typescript-module-graph' || !equal(policy.extraction.paths, ['packages/**/*.ts']) ||
      !equal(policy.evidenceRequirements, [{ type: 'staticAst', required: true, onMissing: 'block' }])) throw new Error('unsupported recipe acquisition/evidence envelope');
  return { revision, files, policy, policyBytesSha256: sha(policyBytes), policyDigest: sha(stable(policy)),
    expectedModules: files.filter(file => file.path.startsWith('packages/')).map(file => file.path) };
}

// Copy immutable objects, not local configuration, checkout filters, attributes or hooks.
function isolateSource(repo, revision, neutral) {
  const sourceGit = args => execFileSync('git', ['-C', repo, ...args], { env: cleanEnv(), timeout: 15_000, maxBuffer: 16 * 1024 * 1024 });
  const target = path.join(neutral, 'source'), template = path.join(neutral, 'empty-template');
  fs.mkdirSync(template);
  execFileSync('git', ['init', '--quiet', '--template=' + template, target], { env: cleanEnv(), timeout: 15_000 });
  const objects = new Map([[revision, 'commit'], [sourceGit(['rev-parse', revision + '^{tree}']).toString().trim(), 'tree']]);
  for (const entry of sourceGit(['ls-tree', '-rtz', '--full-tree', revision]).toString().split('\0').filter(Boolean)) {
    const match = /^\d+ (blob|tree) ([0-9a-f]{40})\t/.exec(entry);
    if (!match) throw new Error('unsupported source object');
    objects.set(match[2], match[1]);
  }
  for (const [id, type] of objects) {
    const bytes = sourceGit(['cat-file', type, id]);
    const copied = execFileSync('git', ['-C', target, 'hash-object', '-w', '-t', type, '--stdin'], { input: bytes, env: cleanEnv(), encoding: 'utf8', timeout: 15_000 }).trim();
    if (copied !== id) throw new Error('source object identity changed during isolation');
  }
  execFileSync('git', ['-C', target, 'update-ref', 'HEAD', revision], { env: cleanEnv(), timeout: 15_000 });
  return target;
}

export async function capture(identityFile, repoInput, revision, outputInput) {
  const admitted = read(identityFile), repo = fs.realpathSync(repoInput);
  const requestedOutput = path.resolve(outputInput);
  const output = path.join(fs.realpathSync(path.dirname(requestedOutput)), path.basename(requestedOutput));
  if (!admitted.provenance || typeof admitted.provenance !== 'string') throw new Error('record the externally checked first-party provenance before explicit capture');
  const actual = identify(admitted.paths.packageRoot, admitted.paths.tarball);
  if (!equal(actual.artifact, admitted.artifact)) throw new Error('artifact bytes or toolchain differ from the reviewed identity record');
  const inside = root => { const rel = path.relative(root, output); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  if (inside(repo) || inside(actual.paths.packageRoot)) throw new Error('capture output must be outside source and package');
  const before = sourceInventory(repo, revision);
  fs.mkdirSync(output); // Exclusive: never overwrite an input or an earlier capture.
  fs.writeFileSync(path.join(output, 'policy.json'), stable(before.policy), { flag: 'wx' });
  const neutral = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-upgrade-cwd-'));
  let processResult, configuration, after, artifactAfter; const measurementErrors = [];
  try {
    const isolatedRepo = isolateSource(repo, revision, neutral);
    if (!equal(before, sourceInventory(isolatedRepo, revision))) throw new Error('isolated source inventory differs');
    processResult = await boundedRun([process.execPath, path.join(actual.paths.packageRoot, 'dist/cli.js'), 'run', '--blueprint', path.join(output, 'policy.json'),
      '--ct-repo', isolatedRepo, '--ref', revision, '--out', path.join(output, 'report.json'), '--emit-bundle', path.join(output, 'bundle.json')], neutral);
    const code = "import fs from 'node:fs';import {pathToFileURL} from 'node:url';const api=await import(pathToFileURL(process.argv[1]));const bp=api.parseBlueprint(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify(api.resolveExtraction(bp.extraction,bp.constraints)));";
    configuration = await boundedRun([process.execPath, '--input-type=module', '-e', code, path.join(actual.paths.packageRoot, 'dist/index.js'), path.join(output, 'policy.json')], neutral);
    try { after = sourceInventory(isolatedRepo, revision); } catch (error) { after = null; measurementErrors.push(error.message); }
    try { artifactAfter = identify(admitted.paths.packageRoot, admitted.paths.tarball).artifact; } catch (error) { artifactAfter = null; measurementErrors.push(error.message); }
  } finally { fs.rmSync(neutral, { recursive: true, force: true }); }
  let resolvedExtraction = null;
  if (configuration.exit === 0 && !configuration.error && !configuration.timeout && !configuration.outputLimit) {
    try { resolvedExtraction = JSON.parse(configuration.stdout); } catch { /* retained malformed output makes comparison incomparable */ }
  }
  const receipt = { artifact: actual.artifact, provenance: admitted.provenance, before, after, artifactAfter, measurementErrors,
    process: processResult, configuration, resolvedExtraction };
  fs.writeFileSync(path.join(output, 'capture.json'), stable(receipt), { flag: 'wx' });
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'identify' && args.length === 2) console.log(JSON.stringify(identify(...args), null, 2));
    else if (command === 'capture' && args.length === 4) {
      const result = await capture(...args);
      console.log(JSON.stringify({ captured: args[3], exit: result.process.exit, timeout: result.process.timeout, outputLimit: result.process.outputLimit }));
      process.exitCode = result.process.error || result.process.timeout || result.process.outputLimit ? 2 : 0;
    } else throw new Error('usage: capture.mjs identify <installed-package> <tarball> | capture <reviewed-identity.json> <fixture-repo> <commit-sha> <new-output-dir>');
  } catch (error) { console.error(`capture refused: ${error.message}`); process.exitCode = 2; }
}
