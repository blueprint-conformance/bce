#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registryReleaseEvidenceRefusals, sha256Bytes } from './lib/evidence-foundry-v3.mjs';

const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const version = valueAfter('--version');
const sourceCommit = valueAfter('--source-commit');
const outInput = valueAfter('--out-dir');

function refuse(message) {
  throw new Error(message);
}

let scratch;
let stagingRoot;
const runNpm = (args, label) => {
  const result = spawnSync('corepack', ['npm@11.19.1', '--registry=https://registry.npmjs.org/', ...args], {
    cwd: scratch,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
  });
  if (result.status !== 0) refuse(`${label} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout;
};

try {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version ?? '') ||
      !/^[0-9a-f]{40}$/.test(sourceCommit ?? '') || !outInput) {
    refuse('usage: node scripts/capture-evidence-foundry-registry.mjs --version X.Y.Z --source-commit 40_HEX --out-dir REPOSITORY_RELATIVE_DIRECTORY');
  }
  if (isAbsolute(outInput) || outInput.includes('\\') || outInput.split('/').includes('..')) refuse('out-dir must be repository-relative and traversal-free');
  const outDir = resolve(root, outInput);
  if (!outDir.startsWith(`${root}${sep}`)) refuse('out-dir escapes the repository');
  const outParent = realpathSync(dirname(outDir));
  if (outParent !== root && !outParent.startsWith(`${root}${sep}`)) refuse('out-dir parent escapes the repository');
  if (existsSync(outDir)) refuse('out-dir already exists; registry evidence is immutable and may not be replaced');

  scratch = mkdtempSync(join(tmpdir(), 'bce-registry-capture-'));
  stagingRoot = mkdtempSync(join(root, '.registry-capture-stage-'));
  const stagedOutDir = resolve(stagingRoot, outInput);
  mkdirSync(stagedOutDir, { recursive: true });

  const packOutput = JSON.parse(runNpm([
    'pack', `bce-engine@${version}`, '--pack-destination', scratch, '--json', '--ignore-scripts',
  ], 'exact registry tarball download'));
  if (!Array.isArray(packOutput) || packOutput.length !== 1 || packOutput[0].name !== 'bce-engine' || packOutput[0].version !== version) {
    refuse('npm pack did not return exactly the requested bce-engine release');
  }
  const packed = packOutput[0];
  const downloaded = join(scratch, packed.filename);
  const packageBytes = readFileSync(downloaded);
  const computedIntegrity = `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`;
  if (packed.integrity !== computedIntegrity) refuse('npm pack integrity differs from the downloaded tarball bytes');
  const registryMetadata = JSON.parse(runNpm(['view', `bce-engine@${version}`, 'dist', '--json'], 'registry release metadata'));
  const expectedTarballUrl = `https://registry.npmjs.org/bce-engine/-/bce-engine-${version}.tgz`;
  const expectedAttestationsUrl = `https://registry.npmjs.org/-/npm/v1/attestations/bce-engine@${version}`;
  if (registryMetadata.tarball !== expectedTarballUrl || registryMetadata.integrity !== computedIntegrity ||
      registryMetadata.attestations?.url !== expectedAttestationsUrl ||
      registryMetadata.attestations?.provenance?.predicateType !== 'https://slsa.dev/provenance/v1') {
    refuse('registry metadata does not bind the downloaded tarball and canonical provenance endpoint');
  }

  writeFileSync(join(scratch, 'package.json'), `${JSON.stringify({
    name: 'bce-registry-verification',
    version: '0.0.0',
    private: true,
    dependencies: { 'bce-engine': version },
  }, null, 2)}\n`);
  runNpm(['install', '--ignore-scripts', '--package-lock=true'], 'exact registry installation');
  const audit = JSON.parse(runNpm(['audit', 'signatures', '--json', '--include-attestations'], 'npm registry signature and provenance verification'));
  if ((audit.invalid?.length ?? 0) !== 0 || (audit.missing?.length ?? 0) !== 0) refuse('npm audit signatures reported missing or invalid evidence');
  const verified = audit.verified?.filter((entry) => entry.name === 'bce-engine' && entry.version === version);
  if (!verified || verified.length !== 1) refuse('npm audit signatures did not verify exactly one requested bce-engine release');
  const bundles = verified[0].attestationBundles ?? [];
  const provenance = bundles.filter((entry) => entry.predicateType === 'https://slsa.dev/provenance/v1');
  if (provenance.length !== 1) refuse('npm audit signatures did not return exactly one provenance attestation');

  const packagePath = join(stagedOutDir, `bce-engine-${version}.tgz`);
  const provenancePath = join(stagedOutDir, 'npm-provenance.sigstore');
  const recordPath = join(stagedOutDir, 'registry-verification.json');
  copyFileSync(downloaded, packagePath, constants.COPYFILE_EXCL);
  writeFileSync(provenancePath, `${JSON.stringify(provenance[0].bundle)}\n`, { flag: 'wx' });
  const repositoryPath = (name) => `${outInput.replace(/\/$/, '')}/${name}`;
  const record = {
    schemaVersion: '1',
    packageName: 'bce-engine',
    version,
    registry: 'https://registry.npmjs.org/',
    tarballUrl: expectedTarballUrl,
    npmIntegrity: computedIntegrity,
    downloadedTarballSha256: sha256Bytes(packageBytes),
    attestationsUrl: expectedAttestationsUrl,
    capturedAt: new Date().toISOString(),
    provenanceAttestation: {
      path: repositoryPath('npm-provenance.sigstore'),
      sha256: sha256Bytes(readFileSync(provenancePath)),
      predicateType: provenance[0].predicateType,
      certificateIssuer: 'https://token.actions.githubusercontent.com',
      certificateIdentityURI: `https://github.com/blueprint-conformance/bce/.github/workflows/release.yml@refs/tags/v${version}`,
    },
  };
  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
  const releaseBinding = {
    packageName: 'bce-engine',
    version,
    gitCommit: sourceCommit,
    packageArtifactPath: repositoryPath(`bce-engine-${version}.tgz`),
    packageArtifactSha256: record.downloadedTarballSha256,
    npmIntegrity: computedIntegrity,
    registryTarballUrl: record.tarballUrl,
    registryVerification: { recordPath: repositoryPath('registry-verification.json'), recordSha256: sha256Bytes(readFileSync(recordPath)) },
  };
  const verifySigstore = (_verificationRoot, bundlePath, { issuer, identity }) => {
    const cli = resolve(root, 'node_modules', '@sigstore', 'cli', 'bin', 'run');
    const result = spawnSync(process.execPath, [cli, 'verify', bundlePath,
      '--certificate-issuer', issuer, '--certificate-identity-uri', identity,
    ], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) refuse(`npm provenance cryptographic verification failed: ${String(result.stderr || result.stdout).trim()}`);
  };
  const refusals = registryReleaseEvidenceRefusals(stagingRoot, releaseBinding, { verifySigstore });
  if (refusals.length > 0) refuse(`captured evidence did not reverify: ${refusals.join('; ')}`);
  if (existsSync(outDir)) refuse('out-dir appeared during capture; refusing to replace it');
  renameSync(stagedOutDir, outDir);
  process.stdout.write(`${JSON.stringify({
    packageArtifactPath: releaseBinding.packageArtifactPath,
    packageArtifactSha256: releaseBinding.packageArtifactSha256,
    npmIntegrity: releaseBinding.npmIntegrity,
    registryTarballUrl: releaseBinding.registryTarballUrl,
    registryVerification: releaseBinding.registryVerification,
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`registry-capture: REFUSED — ${error.message}\n`);
  process.exitCode = 2;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (stagingRoot) rmSync(stagingRoot, { recursive: true, force: true });
}
