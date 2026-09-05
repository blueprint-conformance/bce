#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, resolve } from 'node:path';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = resolve(valueAfter('--root') ?? '.');
const metadataPath = valueAfter('--metadata');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const state = readJson(join(root, 'release-state.json'));
const packageJson = readJson(join(root, 'package.json'));
const expectedVersion = state.currentVersion;

if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? '')) {
  process.stderr.write('public-release-proof: FAIL — release-state.currentVersion is not exact semver\n');
  process.exit(2);
}

const registryUrl = new URL(
  `${packageJson.name.replace('/', '%2f')}/${expectedVersion}`,
  'https://registry.npmjs.org/',
);
const packageBasename = packageJson.name.split('/').at(-1);
const expectedTarball = `https://registry.npmjs.org/${packageJson.name}/-/${packageBasename}-${expectedVersion}.tgz`;

function fetchMetadata(url) {
  return new Promise((resolvePromise, reject) => {
    const req = request(url, { method: 'GET', headers: { accept: 'application/json' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode !== 200) {
          reject(new Error(`registry returned HTTP ${response.statusCode}: ${body.slice(0, 240)}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(body));
        } catch (error) {
          reject(new Error(`registry returned invalid JSON: ${error.message}`));
        }
      });
    });
    req.setTimeout(10_000, () => req.destroy(new Error('registry request exceeded 10 seconds')));
    req.on('error', reject);
    req.end();
  });
}

let metadata;
try {
  metadata = metadataPath
    ? readJson(resolve(metadataPath))
    : await fetchMetadata(registryUrl);
} catch (error) {
  process.stderr.write(`public-release-proof: FAIL — ${error.message}\n`);
  process.exit(1);
}

const failures = [];
if (metadata.name !== packageJson.name) failures.push(`registry package is ${metadata.name ?? 'missing'}, expected ${packageJson.name}`);
if (metadata.version !== expectedVersion) failures.push(`registry version is ${metadata.version ?? 'missing'}, expected ${expectedVersion}`);
if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity ?? '')) failures.push('registry metadata has no SHA-512 integrity');
else if (metadata.dist.integrity !== state.npmIntegrity) failures.push('registry SHA-512 integrity differs from release-state trust anchor');
if (!/^[0-9a-f]{40}$/.test(metadata.dist?.shasum ?? '')) failures.push('registry metadata has no full SHA-1 shasum');
else if (metadata.dist.shasum !== state.npmShasum) failures.push('registry SHA-1 shasum differs from release-state trust anchor');
if (metadata.dist?.tarball !== expectedTarball) failures.push('registry metadata has no exact canonical HTTPS tarball URL');

if (failures.length > 0) {
  process.stderr.write(`public-release-proof: FAIL (${failures.length})\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(
  `public-release-proof: PASS — ${packageJson.name}@${expectedVersion} resolves with SHA-512 integrity (${metadataPath ? 'fixture' : registryUrl.href})\n`,
);
