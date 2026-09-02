#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg >= 0 ? process.argv[rootArg + 1] ?? '' : '.');
const candidates = [];
const allowedOwners = new Set(['actions']);

function collect(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) collect(join(path, entry));
    return;
  }
  if (/\.ya?ml$/i.test(path)) candidates.push(path);
}

collect(join(root, '.github', 'workflows'));
if (existsSync(join(root, 'action.yml'))) candidates.push(join(root, 'action.yml'));
if (existsSync(join(root, 'action.yaml'))) candidates.push(join(root, 'action.yaml'));

const failures = [];
let references = 0;
for (const file of [...new Set(candidates)].sort()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?/);
    if (!match) continue;
    references += 1;
    const ref = match[1];
    if (ref.startsWith('./')) continue;
    if (ref.startsWith('docker://')) {
      if (!/@sha256:[0-9a-f]{64}$/i.test(ref)) {
        failures.push(`${relative(root, file)}:${index + 1}: Docker action '${ref}' is not digest-pinned`);
      }
      continue;
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^@\s]+)?@[0-9a-f]{40}$/.test(ref)) {
      failures.push(`${relative(root, file)}:${index + 1}: Action '${ref}' is not pinned to a full commit SHA`);
      continue;
    }
    const owner = ref.split('/', 1)[0].toLowerCase();
    if (!allowedOwners.has(owner)) {
      failures.push(`${relative(root, file)}:${index + 1}: Action owner '${owner}' is not in the repository allowlist`);
    }
  }
}

if (references === 0) failures.push('no Action references found; the checker is not grading the expected surface');

if (failures.length > 0) {
  process.stderr.write(`action-pin-policy: FAIL (${failures.length})\n${failures.map((x) => `- ${x}`).join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`action-pin-policy: PASS (${references} executable references, all immutable)\n`);
