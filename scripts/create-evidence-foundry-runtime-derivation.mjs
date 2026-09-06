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
import { arch, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonical,
  registryReleaseEvidenceRefusals,
  resolveRegularFileInside,
  sha256Bytes,
  validateRuntimeDerivationStatement,
} from './lib/evidence-foundry-v3.mjs';
import { hashTree } from './lib/model-evaluation.mjs';

const root = realpathSync(resolve(fileURLToPath(new URL('..', import.meta.url))));
const valueAfter = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const packageArtifactPath = valueAfter('--package');
const registryRecordPath = valueAfter('--registry-record');
const releaseSourceCommit = valueAfter('--release-source-commit');
const outInput = valueAfter('--out-dir');
const INSTALL_COMMAND =
  'corepack npm@11.19.1 --registry=https://registry.npmjs.org/ install --ignore-scripts --no-audit --no-fund --package-lock=true';

function refuse(message) {
  throw new Error(message);
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) refuse(`${options.label ?? file} failed: ${String(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

let scratch;
let stagingRoot;
try {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== 'blueprint-conformance/bce' ||
      process.env.GITHUB_REF !== 'refs/heads/main' || !/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? '') ||
      !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')) {
    refuse('runtime derivation may be produced only by the identified BCE main-branch GitHub Actions workflow');
  }
  if (!packageArtifactPath || !registryRecordPath || !/^[0-9a-f]{40}$/.test(releaseSourceCommit ?? '') || !outInput) {
    refuse('usage: --package REPOSITORY_TARBALL --registry-record RECORD.json --release-source-commit 40_HEX --out-dir REPOSITORY_RELATIVE_DIRECTORY');
  }
  if (platform() !== 'linux' || !/^v22\./.test(process.version)) refuse('runtime derivation requires the pinned Linux and Node 22 workflow environment');
  if (isAbsolute(outInput) || outInput.includes('\\') || outInput.split('/').includes('..')) refuse('out-dir must be repository-relative and traversal-free');
  const outDir = resolve(root, outInput);
  if (!outDir.startsWith(`${root}${sep}`)) refuse('out-dir escapes the repository');
  const outParent = realpathSync(dirname(outDir));
  if (outParent !== root && !outParent.startsWith(`${root}${sep}`)) refuse('out-dir parent escapes the repository');
  if (existsSync(outDir)) refuse('out-dir already exists; runtime derivation evidence is immutable and may not be replaced');

  const packageArtifact = resolveRegularFileInside(root, packageArtifactPath, 'captured registry package');
  const registryRecord = resolveRegularFileInside(root, registryRecordPath, 'registry verification record');
  const record = JSON.parse(readFileSync(registryRecord, 'utf8'));
  const packageBytes = readFileSync(packageArtifact);
  const packageSha256 = sha256Bytes(packageBytes);
  const npmIntegrity = `sha512-${createHash('sha512').update(packageBytes).digest('base64')}`;
  if (record.packageName !== 'bce-engine' || record.downloadedTarballSha256 !== packageSha256 ||
      record.npmIntegrity !== npmIntegrity || record.tarballUrl !==
        `https://registry.npmjs.org/bce-engine/-/bce-engine-${record.version}.tgz`) {
    refuse('captured package bytes differ from the exact registry verification record');
  }
  const registryRefusals = registryReleaseEvidenceRefusals(root, {
    packageName: record.packageName,
    version: record.version,
    gitCommit: releaseSourceCommit,
    packageArtifactSha256: packageSha256,
    npmIntegrity,
    registryTarballUrl: record.tarballUrl,
    registryVerification: { recordPath: registryRecordPath, recordSha256: sha256Bytes(readFileSync(registryRecord)) },
  });
  if (registryRefusals.length > 0) refuse(`registry release evidence refused: ${registryRefusals.join('; ')}`);

  const gitHead = run('git', ['rev-parse', 'HEAD'], { label: 'git HEAD probe' });
  if (gitHead !== process.env.GITHUB_SHA) refuse('workflow source commit differs from the exact checkout');
  const gitStatus = run('git', ['status', '--porcelain', '--untracked-files=all'], { label: 'git status probe' });
  if (gitStatus !== '') refuse('runtime derivation requires a clean exact workflow checkout');

  scratch = mkdtempSync(join(tmpdir(), 'bce-runtime-derivation-'));
  stagingRoot = mkdtempSync(join(root, '.runtime-derivation-stage-'));
  const stagedOutDir = resolve(stagingRoot, outInput);
  mkdirSync(stagedOutDir, { recursive: true });
  const inputDir = join(scratch, 'input');
  const runtimeDir = join(scratch, 'runtime');
  mkdirSync(inputDir);
  mkdirSync(runtimeDir);
  const stableTarballName = `bce-engine-${record.version}.tgz`;
  copyFileSync(packageArtifact, join(inputDir, stableTarballName), constants.COPYFILE_EXCL);
  writeFileSync(join(runtimeDir, 'package.json'), `${JSON.stringify({
    name: 'bce-evidence-foundry-runtime',
    version: '0.0.0',
    private: true,
    dependencies: { 'bce-engine': `file:../input/${stableTarballName}` },
  }, null, 2)}\n`, { flag: 'wx' });
  const npmVersion = run('corepack', ['npm@11.19.1', '--version'], { cwd: runtimeDir, label: 'pinned npm version probe' });
  if (npmVersion !== '11.19.1') refuse(`expected npm 11.19.1, got ${npmVersion}`);
  run('corepack', [
    'npm@11.19.1', '--registry=https://registry.npmjs.org/', 'install', '--ignore-scripts',
    '--no-audit', '--no-fund', '--package-lock=true',
  ], {
    cwd: runtimeDir,
    label: 'exact captured-package runtime installation',
    env: {
      ...process.env,
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_ignore_scripts: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    },
  });
  const installedPackage = JSON.parse(readFileSync(join(runtimeDir, 'node_modules', 'bce-engine', 'package.json'), 'utf8'));
  if (installedPackage.name !== 'bce-engine' || installedPackage.version !== record.version) {
    refuse('installed runtime does not contain the exact requested bce-engine version');
  }
  for (const metadataPath of [join(runtimeDir, 'package.json'), join(runtimeDir, 'package-lock.json')]) {
    const metadata = readFileSync(metadataPath, 'utf8');
    if (metadata.includes(root) || metadata.includes(scratch)) refuse('runtime metadata leaks an absolute build path');
  }

  const installedTreeSha256 = hashTree(runtimeDir, { includeNodeModules: true });
  const archiveName = 'bce-treatment-runtime.tgz';
  const archivePath = join(stagedOutDir, archiveName);
  run('/usr/bin/tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--format=posix', '-czf', archivePath, '-C', runtimeDir, '.',
  ], { label: 'deterministic runtime archive' });
  const runtimeArtifactSha256 = sha256Bytes(readFileSync(archivePath));
  const statement = {
    schemaVersion: '1',
    kind: 'registry-package-runtime-derivation',
    package: {
      name: record.packageName,
      version: record.version,
      sourceCommit: releaseSourceCommit,
      registryTarballUrl: record.tarballUrl,
      artifactPath: packageArtifactPath,
      artifactSha256: packageSha256,
      npmIntegrity,
      registryVerificationPath: registryRecordPath,
      registryVerificationSha256: sha256Bytes(readFileSync(registryRecord)),
    },
    builder: {
      workflowSourceCommit: process.env.GITHUB_SHA,
      workflowRunUrl: `https://github.com/blueprint-conformance/bce/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`,
      nodeVersion: process.version,
      npmVersion,
      platform: platform(),
      architecture: arch(),
      installCommand: INSTALL_COMMAND,
    },
    runtime: { archiveName, artifactSha256: runtimeArtifactSha256, installedTreeSha256 },
    createdAt: new Date().toISOString(),
    statementSha256: null,
  };
  statement.statementSha256 = sha256Bytes(JSON.stringify(canonical(statement)));
  validateRuntimeDerivationStatement(root, statement);
  writeFileSync(join(stagedOutDir, 'runtime-derivation.json'), `${JSON.stringify(statement, null, 2)}\n`, { flag: 'wx' });
  if (existsSync(outDir)) refuse('out-dir appeared during derivation; refusing to replace it');
  renameSync(stagedOutDir, outDir);
  process.stdout.write(`${JSON.stringify({
    outputDirectory: relative(root, outDir).split(sep).join('/'),
    runtimeArtifactSha256,
    installedTreeSha256,
    statementSha256: sha256Bytes(readFileSync(join(outDir, 'runtime-derivation.json'))),
  })}\n`);
} catch (error) {
  process.stderr.write(`runtime-derivation: REFUSED — ${error.message}\n`);
  process.exitCode = 2;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  if (stagingRoot) rmSync(stagingRoot, { recursive: true, force: true });
}
