#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = 'research/model-evaluation/pilots/accelerated-v6';

if (process.argv.length !== 2) {
  process.stderr.write('usage: npm run evidence:verify\n');
  process.exit(2);
}

function run(script, args) {
  const result = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('check-evidence-claims.mjs', ['--root', root]);
run('verify-model-evaluation-bundle.mjs', ['--bundle', bundle, '--portable-inputs']);
run('verify-model-evaluation-public.mjs', ['--bundle', bundle, '--results', `${bundle}/results`]);
process.stdout.write('public-evidence: PASS (claim boundary + sealed inputs + public result replay)\n');
