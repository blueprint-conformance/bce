#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { expectedSeal, FROZEN_IMPLEMENTATIONS, sha256Bytes, verifyBundle } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = resolve(valueAfter('--bundle') ?? 'research/model-evaluation');
const publicTimestamp = valueAfter('--public-timestamp');
const attestationPath = valueAfter('--attestation');
const gitCommit = valueAfter('--local-git-commit');
const identity = valueAfter('--identity');
if (!publicTimestamp || (!attestationPath && (!gitCommit || !identity))) {
  process.stderr.write('usage: node scripts/seal-model-evaluation-bundle.mjs --bundle DIR --public-timestamp HTTPS_URL (--attestation FILE | --local-git-commit SHA --identity ID)\n');
  process.exit(2);
}
const draft = verifyBundle(bundleDir, { requireSealed: false });
if (!draft.ok) throw new Error(`pre-seal verification refused:\n${draft.refusals.map((item) => `- ${item}`).join('\n')}`);
if (draft.protocol.status !== 'frozen-ready-not-run' || draft.manifest.status !== 'frozen-ready-not-run' || draft.manifest.sealed !== true) {
  throw new Error('seal refused: protocol and manifest must already be frozen-ready-not-run and manifest.sealed=true');
}
if (draft.seal.status !== 'unsealed' || draft.seal.rootSha256 !== null) throw new Error('seal refused: this study version is already sealed or terminated');
const expected = expectedSeal(bundleDir, draft.protocol, draft.manifest);
if (gitCommit) {
  if (draft.protocol.phase !== 'pilot') throw new Error('local-git-commit seals are permitted only for claim-ineligible pilots');
  const git = (args, encoding = 'utf8') => spawnSync('git', args, { cwd: bundleDir, encoding, maxBuffer: 64 * 1024 * 1024 });
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw new Error(`local git seal cannot resolve repository root: ${String(top.stderr).trim()}`);
  const repositoryRoot = String(top.stdout).trim();
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0 || String(head.stdout).trim() !== gitCommit) throw new Error('--local-git-commit must equal the checked-out HEAD');
  if (!publicTimestamp.endsWith(`/commit/${gitCommit}`)) throw new Error('--public-timestamp must end with the exact /commit/<SHA> anchor');
  for (const entry of expected.entries) {
    const absolute = resolve(bundleDir, entry.path);
    const repositoryPath = relative(repositoryRoot, absolute);
    if (isAbsolute(repositoryPath) || repositoryPath === '..' || repositoryPath.startsWith(`..${sep}`)) throw new Error(`${entry.path}: seal entry is outside the Git repository`);
    const committed = git(['show', `${gitCommit}:${repositoryPath.split(sep).join('/')}`], null);
    if (committed.status !== 0) throw new Error(`${entry.path}: not present in the public-anchor commit`);
    if (committed.stdout.byteLength !== entry.bytes || sha256Bytes(committed.stdout) !== entry.sha256) {
      throw new Error(`${entry.path}: working-tree bytes differ from the public-anchor commit`);
    }
  }
  for (const [digestField, implementationPath] of Object.entries(FROZEN_IMPLEMENTATIONS)) {
    if (!draft.protocol.implementation[digestField]) continue;
    const repositoryPath = relative(repositoryRoot, implementationPath);
    if (isAbsolute(repositoryPath) || repositoryPath === '..' || repositoryPath.startsWith(`..${sep}`)) throw new Error(`${digestField}: implementation is outside the Git repository`);
    const committed = git(['show', `${gitCommit}:${repositoryPath.split(sep).join('/')}`], null);
    if (committed.status !== 0) throw new Error(`${digestField}: implementation is absent from the public-anchor commit`);
    if (sha256Bytes(committed.stdout) !== draft.protocol.implementation[digestField]) {
      throw new Error(`${digestField}: public-anchor implementation bytes differ from the frozen digest`);
    }
  }
}
const attestation = attestationPath ? JSON.parse(readFileSync(resolve(attestationPath), 'utf8')) : {
  kind: 'local-git-commit',
  subjectRootSha256: expected.rootSha256,
  uri: publicTimestamp,
  identity,
  gitCommit,
  eligibleForProductClaim: false,
};
if (gitCommit && !/^[0-9a-f]{40}$/.test(gitCommit)) throw new Error('--local-git-commit must be an exact 40-character SHA');
const seal = {
  schemaVersion: '1',
  studyId: draft.protocol.studyId,
  status: 'sealed-before-first-trial',
  sealedAt: new Date().toISOString(),
  entries: expected.entries,
  rootSha256: expected.rootSha256,
  publicTimestamp,
  attestation,
};
writeFileSync(resolve(bundleDir, 'seal.json'), `${JSON.stringify(seal, null, 2)}\n`);
const sealed = verifyBundle(bundleDir, { requireSealed: true });
if (!sealed.ok) throw new Error(`post-seal verification refused:\n${sealed.refusals.map((item) => `- ${item}`).join('\n')}`);
process.stdout.write(`sealed ${seal.studyId} at sha256:${seal.rootSha256}\n`);
