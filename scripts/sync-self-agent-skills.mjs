#!/usr/bin/env node
/** Install/check this repository's project-discoverable copies of its published skills. */
import { cpSync, existsSync, readdirSync, readFileSync, lstatSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check') || process.argv[1]?.endsWith('self-agent-proof.mjs');
const inventory = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { recursive: true }).map(String).filter((name) => {
    const stat = lstatSync(join(directory, name));
    if (stat.isSymbolicLink()) throw new Error(`skill symlink refused: ${name}`);
    return stat.isFile();
  }).sort();
};
for (const name of ['bce', 'skill-tuning']) {
  const source = join(root, 'skills', name);
  const target = join(root, '.agents', 'skills', name);
  if (!check) cpSync(source, target, { recursive: true });
  const files = inventory(source);
  if (JSON.stringify(files) !== JSON.stringify(inventory(target)) || files.some((file) => !readFileSync(join(source, file)).equals(readFileSync(join(target, file))))) {
    throw new Error(`installed skill differs from canonical source: ${relative(root, target)}`);
  }
}
console.log('Self-agent skills: canonical copies verified');
