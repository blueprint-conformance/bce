#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bce-public-release-proof-'));
for (const file of ['package.json', 'release-state.json']) cpSync(join(repoRoot, file), join(fixture, file));
const state = JSON.parse(readFileSync(join(fixture, 'release-state.json'), 'utf8'));
const packageJson = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'));
const metadataPath = join(fixture, 'metadata.json');
const checker = join(repoRoot, 'scripts', 'verify-public-release.mjs');

const valid = {
  name: packageJson.name,
  version: state.currentVersion,
  dist: {
    integrity: state.npmIntegrity,
    shasum: state.npmShasum,
    tarball: `https://registry.npmjs.org/${packageJson.name}/-/${packageJson.name}-${state.currentVersion}.tgz`,
  },
};

function run(metadata) {
  writeFileSync(metadataPath, `${JSON.stringify(metadata)}\n`);
  return execFileSync(process.execPath, [checker, '--root', fixture, '--metadata', metadataPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function reject(label, metadata, marker) {
  try {
    run(metadata);
    throw new Error(`${label}: verifier accepted invalid public metadata`);
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes(marker)) throw error;
  }
}

reject('wrong version', { ...valid, version: '9.9.9' }, 'registry version');
reject('missing integrity', { ...valid, dist: { tarball: valid.dist.tarball } }, 'SHA-512 integrity');
reject('integrity drift', { ...valid, dist: { ...valid.dist, integrity: 'sha512-QUJDRA==' } }, 'differs from release-state trust anchor');
reject('shasum drift', { ...valid, dist: { ...valid.dist, shasum: '0000000000000000000000000000000000000000' } }, 'differs from release-state trust anchor');
reject('non-canonical tarball', { ...valid, dist: { ...valid.dist, tarball: 'http://example.invalid/package.tgz' } }, 'canonical HTTPS tarball');
reject('wrong registry tarball', { ...valid, dist: { ...valid.dist, tarball: 'https://registry.npmjs.org/bce-engine/-/other-0.1.5.tgz' } }, 'canonical HTTPS tarball');

const accepted = run(valid);
if (!accepted.includes('PASS')) throw new Error(`valid registry metadata did not pass:\n${accepted}`);
process.stdout.write('public-release-proof self-test: PASS — version/digest drift and non-canonical or substituted tarballs were rejected\n');
