#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bce-release-claims-selftest-'));
const checker = join(root, 'scripts', 'check-release-claims.mjs');
const paths = [
  '.engine-pin.json', 'ATTESTATIONS.md', 'README.md', 'ROADMAP.md', 'STATUS.md', 'package.json',
  'npm-shrinkwrap.json', 'release-state.json', 'docs/onboarding.md', 'docs/launch/skill-listing-drafts.md',
  'docs/launch/openai-plugin-submission.md',
  'docs/governance-enforcement.md',
  'integrations/gitlab-ci.yml', 'research/claim-evidence-matrix.json', 'src/cli.ts',
];
for (const path of paths) {
  const target = join(fixture, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, path), target);
}
const originals = new Map(paths.map((path) => [path, readFileSync(join(fixture, path), 'utf8')]));
const restore = () => { for (const [path, text] of originals) writeFileSync(join(fixture, path), text); };

function reject(label, mutate, marker) {
  restore();
  mutate();
  try {
    execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error(`${label}: claim checker accepted the contradiction`);
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes(marker)) throw error;
  }
}

reject('stale candidate version', () => {
  const state = JSON.parse(originals.get('release-state.json'));
  state.candidateVersion = '9.9.9';
  writeFileSync(join(fixture, 'release-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}, 'package version differs from release candidate');

reject('candidate collides with published version', () => {
  const state = JSON.parse(originals.get('release-state.json'));
  state.candidateVersion = state.currentVersion;
  writeFileSync(join(fixture, 'release-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}, 'candidateVersion must be newer than the released version');

reject('candidate moves backwards', () => {
  const state = JSON.parse(originals.get('release-state.json'));
  state.candidateVersion = '0.1.4';
  writeFileSync(join(fixture, 'release-state.json'), `${JSON.stringify(state, null, 2)}\n`);
}, 'candidateVersion must be newer than the released version');

reject('unpublished candidate becomes Lane-A pin', () => {
  const pin = JSON.parse(originals.get('.engine-pin.json'));
  const state = JSON.parse(originals.get('release-state.json'));
  pin.pin = state.candidateVersion;
  writeFileSync(join(fixture, '.engine-pin.json'), `${JSON.stringify(pin, null, 2)}\n`);
}, 'Lane-A pin differs from the released version');

reject('false immutability', () => {
  writeFileSync(join(fixture, 'STATUS.md'), originals.get('STATUS.md').replace('historical tag mutable', 'immutable'));
}, 'historical release immutability');

reject('false independence', () => {
  writeFileSync(join(fixture, 'ATTESTATIONS.md'), originals.get('ATTESTATIONS.md').replace('**Count: 0.**', '**Count: 1.**'));
}, 'independent witness count differs');

reject('dormant release marker', () => {
  writeFileSync(join(fixture, 'integrations/gitlab-ci.yml'), `${originals.get('integrations/gitlab-ci.yml')}\n# VERSION_NOT_PUBLISHED\n`);
}, 'pre-release marker');

restore();
const accepted = execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
if (!accepted.includes('PASS')) throw new Error(`clean claim set did not pass:\n${accepted}`);
process.stdout.write('release-claim-policy self-test: PASS (candidate drift/non-monotonicity, premature Lane-A pin, false immutability, false independence, and dormant marker rejected)\n');
