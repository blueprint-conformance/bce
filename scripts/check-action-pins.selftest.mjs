#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checker = join(root, 'scripts', 'check-action-pins.mjs');
const fixture = mkdtempSync(join(tmpdir(), 'bce-action-pin-selftest-'));
const workflows = join(fixture, '.github', 'workflows');
mkdirSync(workflows, { recursive: true });
const workflow = join(workflows, 'probe.yml');

function run(expectSuccess) {
  try {
    return execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (!expectSuccess && error.status === 1) return String(error.stderr);
    throw error;
  }
}

writeFileSync(workflow, 'jobs:\n  probe:\n    steps:\n      - uses: actions/checkout@v4\n');
const rejected = run(false);
if (!rejected.includes('not pinned to a full commit SHA')) {
  throw new Error(`mutable-tag probe failed for the wrong reason:\n${rejected}`);
}

writeFileSync(workflow, 'jobs:\n  probe:\n    steps:\n      - uses: untrusted/example@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n');
const unknownOwner = run(false);
if (!unknownOwner.includes("owner 'untrusted' is not in the repository allowlist")) {
  throw new Error(`unknown-owner probe failed for the wrong reason:\n${unknownOwner}`);
}

writeFileSync(
  workflow,
  'jobs:\n  probe:\n    steps:\n      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4\n      - uses: ./\n',
);
const accepted = run(true);
if (!accepted.includes('PASS (2 executable references, all immutable)')) {
  throw new Error(`immutable/local control did not pass:\n${accepted}`);
}

process.stdout.write('action-pin-policy self-test: PASS (mutable tag and unknown owner rejected; SHA and local action accepted)\n');
