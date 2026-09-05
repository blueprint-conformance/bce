#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const root = resolve(valueAfter('--root') ?? '.');
const suppliedPackJson = valueAfter('--pack-json');
const suppliedTarball = valueAfter('--tarball');
const outArg = valueAfter('--out');
const printFilename = process.argv.includes('--print-filename');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const releaseState = JSON.parse(readFileSync(join(root, 'release-state.json'), 'utf8'));
const sourceVersion = releaseState.candidateVersion ?? releaseState.currentVersion;

let packResult;
try {
  const raw = suppliedPackJson
    ? readFileSync(resolve(suppliedPackJson), 'utf8')
    : execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--silent'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 32 * 1024 * 1024,
      });
  let parsed;
  const candidates = [raw.trim()];
  for (let index = raw.lastIndexOf('\n['); index >= 0; index = raw.lastIndexOf('\n[', index - 1)) {
    candidates.push(raw.slice(index + 1).trim());
  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if ((Array.isArray(value) ? value[0] : value)?.files) {
        parsed = value;
        break;
      }
    } catch {
      // npm may emit lifecycle output before its JSON. Keep searching from the end.
    }
  }
  if (!parsed) throw new Error('npm output contained no parseable payload JSON');
  packResult = Array.isArray(parsed) ? parsed[0] : parsed;
} catch (error) {
  process.stderr.write(`release-payload-proof: REFUSED — package payload could not be enumerated: ${error.message}\n`);
  process.exit(2);
}

const failures = [];
const files = Array.isArray(packResult?.files) ? [...packResult.files].sort((a, b) => a.path.localeCompare(b.path)) : [];
const declared = Array.isArray(packageJson.files) ? packageJson.files : [];
const automatic = new Set(['LICENSE', 'README.md', 'package.json']);
const forbiddenRoots = ['.blueprints/', '.github/', 'research/', 'evidence/dogfood/'];

if (packResult?.name !== packageJson.name) failures.push(`payload name ${packResult?.name ?? 'missing'} differs from package.json`);
if (packResult?.version !== packageJson.version) failures.push(`payload version ${packResult?.version ?? 'missing'} differs from package.json`);
if (packageJson.version !== sourceVersion) failures.push(`package.json version differs from release-state source version ${sourceVersion ?? 'missing'}`);
if (files.length === 0) failures.push('npm reported an empty payload');
if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(packResult?.integrity ?? '')) failures.push('payload has no SHA-512 integrity');
if (printFilename && !/^[A-Za-z0-9._-]+\.tgz$/.test(packResult?.filename ?? '')) {
  failures.push(`npm pack returned an unsafe filename: ${packResult?.filename ?? 'missing'}`);
}

if (suppliedTarball) {
  const tarball = resolve(root, suppliedTarball);
  const tarballRelative = relative(root, tarball);
  if (!existsSync(tarball)) {
    failures.push(`tarball does not exist: ${tarballRelative}`);
  } else {
    const actualIntegrity = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
    if (actualIntegrity !== packResult.integrity) {
      failures.push('tarball integrity differs from npm pack metadata');
    } else {
      let tarEntries = [];
      try {
        tarEntries = execFileSync('tar', ['-tzf', tarball], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
          .split('\n')
          .filter((entry) => entry && !entry.endsWith('/'));
      } catch (error) {
        failures.push(`tarball could not be enumerated independently: ${error.message}`);
      }
      const malformed = tarEntries.filter((entry) => !entry.startsWith('package/'));
      if (malformed.length > 0) failures.push(`tarball has entries outside package/: ${malformed[0]}`);
      const actualFiles = tarEntries.filter((entry) => entry.startsWith('package/')).map((entry) => entry.slice('package/'.length)).sort();
      const reportedFiles = files.map((file) => file.path).sort();
      if (new Set(actualFiles).size !== actualFiles.length) failures.push('tarball contains duplicate file paths');
      const missingFromTarball = reportedFiles.filter((path) => !actualFiles.includes(path));
      const missingFromMetadata = actualFiles.filter((path) => !reportedFiles.includes(path));
      if (missingFromTarball.length > 0) failures.push(`npm metadata names a file absent from the tarball: ${missingFromTarball[0]}`);
      if (missingFromMetadata.length > 0) failures.push(`tarball contains a file absent from npm metadata: ${missingFromMetadata[0]}`);
    }
    if (packResult.filename && basename(tarball) !== packResult.filename) {
      failures.push(`tarball filename ${basename(tarball)} differs from npm pack metadata ${packResult.filename}`);
    }
  }
}

const isDeclared = (candidate) => automatic.has(candidate) || declared.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
for (const file of files) {
  if (!isDeclared(file.path)) failures.push(`${file.path} is outside package.json files[]`);
  if (forbiddenRoots.some((prefix) => file.path.startsWith(prefix))) failures.push(`${file.path} belongs to a non-shipping evidence/governance root`);
}
for (const required of ['LICENSE', 'README.md', 'package.json', 'release-state.json', 'action.yml', 'dist/cli.js', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) {
  if (!files.some((file) => file.path === required)) failures.push(`required runtime artifact is missing: ${required}`);
}
for (const entry of declared) {
  if (!existsSync(join(root, entry))) failures.push(`package.json files[] entry does not exist: ${entry}`);
}

if (failures.length > 0) {
  process.stderr.write(`release-payload-proof: FAIL (${failures.length})\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}

const payload = {
  schemaVersion: '1',
  package: packageJson.name,
  version: packageJson.version,
  tarballFilename: packResult.filename,
  npmPackIntegrity: packResult.integrity,
  npmPackShasum: packResult.shasum,
  entryCount: files.length,
  unpackedSize: packResult.unpackedSize,
  files: files.map(({ path, size, mode }) => ({ path, size, mode })),
};
const canonical = `${JSON.stringify(payload)}\n`;
const manifest = {
  ...payload,
  manifestDigest: `sha256:${createHash('sha256').update(canonical).digest('hex')}`,
};

if (outArg) {
  const output = resolve(root, outArg);
  const rel = relative(root, output);
  if (rel.startsWith('..') || rel === '') {
    process.stderr.write('release-payload-proof: REFUSED — --out must name a file inside the repository root\n');
    process.exit(2);
  }
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (printFilename) {
  process.stdout.write(`${packResult.filename}\n`);
} else {
  process.stdout.write(
    `release-payload-proof: PASS — ${manifest.package}@${manifest.version}, ${manifest.entryCount} files, ${manifest.manifestDigest}\n`,
  );
}
