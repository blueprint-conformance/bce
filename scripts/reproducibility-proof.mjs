#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bce-reproducibility-proof-'));
const npmBin = realpathSync(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim());
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const lockBytes = readFileSync(join(root, 'npm-shrinkwrap.json'));
const lockDigest = sha256(lockBytes);

function run(file, args, cwd) {
  return execFileSync(file, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function npm(args, cwd) {
  return run(process.execPath, [npmBin, ...args], cwd);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

npm(['run', 'build'], root);
const packOutput = npm(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root);
const jsonStart = packOutput.lastIndexOf('[\n  {\n    "id"');
if (jsonStart < 0) throw new Error(`npm pack did not emit a package result:\n${packOutput}`);
const pack = JSON.parse(packOutput.slice(jsonStart))[0];
const tarball = join(scratch, pack.filename);
if (!existsSync(tarball)) throw new Error(`packed artifact missing: ${tarball}`);
const entries = run('tar', ['-tzf', tarball], root).split('\n');
if (!entries.includes('package/npm-shrinkwrap.json')) {
  throw new Error('published artifact omits npm-shrinkwrap.json; exact BCE version would not freeze its runtime graph');
}

const attempts = [];
for (const name of ['clean-a', 'clean-b']) {
  const dir = join(scratch, name);
  mkdirSync(dir);
  npm(['init', '-y'], dir);
  npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], dir);
  const installed = join(dir, 'node_modules', 'bce-engine');
  const installedLock = readFileSync(join(installed, 'npm-shrinkwrap.json'));
  if (sha256(installedLock) !== lockDigest) throw new Error(`${name}: installed shrinkwrap digest differs from packed source`);
  const tree = JSON.parse(npm(['ls', '--all', '--omit=dev', '--json'], dir)).dependencies['bce-engine'];
  const report = join(dir, 'report.json');
  const evidence = join(dir, 'evidence.json');
  run(
    process.execPath,
    [
      join(installed, 'dist', 'cli.js'), 'run',
      '--blueprint', join(installed, 'fixtures', 'luna-chat-extension.blueprint.json'),
      '--ct-repo', join(installed, 'fixtures', 'extension-surface', 'conformant'),
      '--no-pin', '--out', report, '--emit', '--emit-evidence-out', evidence,
      '--emit-wo-out', join(dir, 'work-orders.json'),
    ],
    dir,
  );
  const record = JSON.parse(readFileSync(evidence, 'utf8'));
  if (record.toolchain?.dependencyLock?.sha256 !== lockDigest) throw new Error(`${name}: evidence omitted the installed shrinkwrap digest`);
  if (record.toolchain?.runtime?.node !== process.versions.node) throw new Error(`${name}: evidence recorded the wrong Node version`);
  if (record.toolchain?.extractor?.provider !== 'typescript-ts-morph') throw new Error(`${name}: evidence recorded the wrong extractor provider`);
  attempts.push({
    dependencyTree: JSON.stringify(canonical(tree)),
    reportHash: sha256(readFileSync(report)),
    lockDigest: record.toolchain.dependencyLock.sha256,
  });
}

if (attempts[0].dependencyTree !== attempts[1].dependencyTree) throw new Error('clean installs resolved different production dependency trees');
if (attempts[0].reportHash !== attempts[1].reportHash) throw new Error('clean installs produced different report hashes for the same fixture');

process.stdout.write(
  `reproducibility-proof: PASS (2 clean installs; lock ${lockDigest}; report ${attempts[0].reportHash})\n`,
);
