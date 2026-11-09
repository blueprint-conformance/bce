#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  if (entry.startsWith('!')) continue; // an exclusion names no path to create
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
// package.json files[] excludes the JS source maps and the bin-only CJS builds; a payload that
// still carries them must be refused.
reject('source map in payload', { ...valid, files: [...valid.files, { path: 'dist/cli.js.map', size: 1, mode: 420 }] }, 'files[] exclusion !dist/*.js.map');
reject('bin-only CJS build in payload', { ...valid, files: [...valid.files, { path: 'dist/cli.cjs', size: 1, mode: 420 }] }, 'files[] exclusion !dist/cli.cjs');
reject('version drift', { ...valid, version: '9.9.9' }, 'differs from package.json');
const releaseStatePath = join(fixture, 'release-state.json');
const releaseState = JSON.parse(readFileSync(releaseStatePath, 'utf8'));
writeFileSync(releaseStatePath, `${JSON.stringify({ ...releaseState, currentVersion: '9.9.9', candidateVersion: null })}\n`);
reject('release-state drift', valid, 'differs from release-state source version');
writeFileSync(releaseStatePath, `${JSON.stringify(releaseState)}\n`);
const fakeTarball = join(fixture, 'bce-engine-0.2.0.tgz');
writeFileSync(fakeTarball, 'not the bytes described by npm pack metadata');
reject('tarball substitution', { ...valid, filename: 'bce-engine-0.2.0.tgz' }, 'tarball integrity differs', ['--tarball', fakeTarball]);

// A real tarball whose shrinkwrap still carries a dev entry must be refused; its
// production-only form must pass.
function tarballWithLock(name, lock) {
  const stage = join(fixture, `stage-${name}`);
  const paths = [...required, 'npm-shrinkwrap.json'];
  for (const path of paths) {
    mkdirSync(dirname(join(stage, 'package', path)), { recursive: true });
    writeFileSync(join(stage, 'package', path), path === 'npm-shrinkwrap.json' ? `${JSON.stringify(lock, null, 2)}\n` : 'fixture\n');
  }
  const tarball = join(fixture, `bce-engine-${name}.tgz`);
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'package']);
  const integrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  const result = { ...valid, filename: `bce-engine-${name}.tgz`, integrity, files: paths.map((path) => ({ path, size: 1, mode: 420 })) };
  return { tarball, result };
}
const runtimeLock = { lockfileVersion: 3, packages: { '': { name: 'bce-engine' }, 'node_modules/zod': { version: '4.6.7' } } };
const leaky = tarballWithLock('leaky', { ...runtimeLock, packages: { ...runtimeLock.packages, 'node_modules/vitest': { version: '5.0.0', dev: true } } });
reject('dev toolchain in published shrinkwrap', leaky.result, 'development entries consumers would install', ['--tarball', leaky.tarball]);
const clean = tarballWithLock('clean', runtimeLock);
if (!run(clean.result, ['--tarball', clean.tarball]).includes('PASS')) throw new Error('production-only shrinkwrap tarball did not pass');

const accepted = run(valid);
if (!accepted.includes('PASS')) throw new Error(`valid payload did not pass:\n${accepted}`);
process.stdout.write('release-payload-proof self-test: PASS — research leakage, excluded source maps and CJS bin builds, missing runtime, source/version drift, tarball substitution, and a dev-carrying shrinkwrap were rejected\n');
