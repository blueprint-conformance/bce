#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checker = join(root, 'scripts', 'check-release-proof-policy.mjs');
const original = join(root, '.github', 'workflows', 'release.yml');
const fixture = join(mkdtempSync(join(tmpdir(), 'bce-release-policy-selftest-')), 'release.yml');
const source = readFileSync(original, 'utf8');

writeFileSync(fixture, source.replace(/^\s*run:\s*npm run test:ai-adoption\s*$/m, '        run: npm run test:onboarding'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted a gate without deterministic AI adoption proof');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('deterministic Agent Skills + MCP adoption proof')) throw error;
}

writeFileSync(fixture, source.replace('          corepack install --global npm@11.19.1\n', '          echo exact npm bootstrap removed\n'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted a gate without an exact isolated npm bootstrap');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('exact Corepack npm bootstrap')) throw error;
}

writeFileSync(fixture, source.replace('      - name: Resolve release mode (tag push = real; dispatch = dry_run input)', '      - run: npm install -g npm@11.19.1\n\n      - name: Resolve release mode (tag push = real; dispatch = dry_run input)'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted an in-place npm self-upgrade');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('in-place npm self-upgrade is forbidden')) throw error;
}

writeFileSync(fixture, source.replace('--certificate-issuer https://token.actions.githubusercontent.com', '--certificate-issuer https://example.invalid'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted an unconstrained Sigstore issuer');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('Sigstore issuer constraint')) throw error;
}

writeFileSync(fixture, source.replace('          npm run test:self-teeth-mutations\n', '          echo source mutation proof removed\n'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted a gate without extractor-real self teeth');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('extractor-real self-blueprint source mutations')) throw error;
}

writeFileSync(fixture, source.replace(/^\s*run:\s*npm run test:model-eval-controller\s*$/m, '        run: npm run test:model-eval-protocol'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted a release without the macOS real-controller rehearsal');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('macOS real-controller rehearsal')) throw error;
}

const publishBlock = source.match(/      - name: npm publish --provenance --access public \(only after evidence verifies\)[\s\S]*?(?=\n      - name: Attach the evidence record)/)?.[0];
if (!publishBlock) throw new Error('could not isolate npm publish block for ordering negative control');
writeFileSync(fixture, source.replace(publishBlock, '').replace('      - name: Generate the evidence record of THIS release gate-run before publish', `${publishBlock}\n\n      - name: Generate the evidence record of THIS release gate-run before publish`));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted npm publish before evidence verification');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('verified release evidence before npm publish')) throw error;
}

writeFileSync(fixture, source);
const accepted = execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8' });
if (!accepted.includes('PASS')) throw new Error(`intact release policy did not pass:\n${accepted}`);

process.stdout.write('release-proof-policy self-test: PASS (missing adoption/source-mutation/controller/toolchain proof, in-place npm upgrade, wrong issuer, and publish-before-evidence ordering rejected; intact gate accepted)\n');
