#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checker = join(repoRoot, 'scripts', 'verify-release-payload.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'bce-release-payload-proof-'));
cpSync(join(repoRoot, 'package.json'), join(fixture, 'package.json'));
const packageJson = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
for (const entry of packageJson.files) {
  const target = join(fixture, entry);
  if (/\.[a-z0-9]+$/i.test(entry)) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'fixture\n');
  } else {
    mkdirSync(target, { recursive: true });
  }
}
cpSync(join(repoRoot, 'release-state.json'), join(fixture, 'release-state.json'));

const required = ['LICENSE', 'README.md', 'package.json', 'release-state.json', 'action.yml', 'dist/cli.js', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'];
const valid = {
  name: packageJson.name,
  version: packageJson.version,
  integrity: 'sha512-QUJDRA==',
  shasum: '0123456789012345678901234567890123456789',
  unpackedSize: 8,
  files: required.map((path) => ({ path, size: 1, mode: 420 })),
};
const packJson = join(fixture, 'pack.json');

function run(result, extraArgs = []) {
  writeFileSync(packJson, `${JSON.stringify([result])}\n`);
  return execFileSync(process.execPath, [checker, '--root', fixture, '--pack-json', packJson, ...extraArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function reject(label, result, marker, extraArgs = []) {
  try {
    run(result, extraArgs);
    throw new Error(`${label}: payload verifier accepted the planted defect`);
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes(marker)) throw error;
  }
}

reject('research leakage', { ...valid, files: [...valid.files, { path: 'research/private.json', size: 1, mode: 420 }] }, 'non-shipping evidence/governance root');
reject('missing CLI', { ...valid, files: valid.files.filter((file) => file.path !== 'dist/cli.js') }, 'required runtime artifact is missing');
reject('version drift', { ...valid, version: '9.9.9' }, 'differs from package.json');
const releaseStatePath = join(fixture, 'release-state.json');
const releaseState = JSON.parse(readFileSync(releaseStatePath, 'utf8'));
writeFileSync(releaseStatePath, `${JSON.stringify({ ...releaseState, currentVersion: '9.9.9', candidateVersion: null })}\n`);
reject('release-state drift', valid, 'differs from release-state source version');
writeFileSync(releaseStatePath, `${JSON.stringify(releaseState)}\n`);
const fakeTarball = join(fixture, 'bce-engine-0.2.0.tgz');
writeFileSync(fakeTarball, 'not the bytes described by npm pack metadata');
reject('tarball substitution', { ...valid, filename: 'bce-engine-0.2.0.tgz' }, 'tarball integrity differs', ['--tarball', fakeTarball]);

const accepted = run(valid);
if (!accepted.includes('PASS')) throw new Error(`valid payload did not pass:\n${accepted}`);
process.stdout.write('release-payload-proof self-test: PASS — research leakage, missing runtime, source/version drift, and tarball substitution were rejected\n');
