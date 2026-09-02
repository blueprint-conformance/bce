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

writeFileSync(fixture, source.replace('--certificate-issuer https://token.actions.githubusercontent.com', '--certificate-issuer https://example.invalid'));
try {
  execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  throw new Error('release policy accepted an unconstrained Sigstore issuer');
} catch (error) {
  if (error.status !== 1 || !String(error.stderr).includes('Sigstore issuer constraint')) throw error;
}

writeFileSync(fixture, source);
const accepted = execFileSync(process.execPath, [checker, '--workflow', fixture], { encoding: 'utf8' });
if (!accepted.includes('PASS')) throw new Error(`intact release policy did not pass:\n${accepted}`);

process.stdout.write('release-proof-policy self-test: PASS (missing deterministic proof and wrong signing issuer rejected; intact gate accepted)\n');
