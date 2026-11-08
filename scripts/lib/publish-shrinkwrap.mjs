// The npm-shrinkwrap.json a consumer receives must name the runtime tree only.
//
// npm installs every entry of a dependency's published shrinkwrap, including the
// ones marked `"dev": true`, whenever the registry packument says
// `_hasShrinkwrap: true` (npmjs.com always does for a tarball that carries one).
// bce-engine 0.6.1 shipped its full development lock: a plain
// `npm install -D bce-engine@0.6.1` pulled 184 packages / 202 MB (vitest,
// rolldown, oclif, the MCP inspector, the sigstore CLI) where the runtime needs
// 11 / 43 MB. A local-tarball install never reads the shrinkwrap, so the
// tarball-based consumer proofs could not see it.
//
// The repository keeps the full lock (`npm ci` needs it). Every place that packs
// the publishable tarball swaps in the production-only form first; the build
// bakes that form's digest, so the evidence toolchain identity names the bytes
// the consumer actually installs. The transform is deterministic and idempotent.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const SHRINKWRAP = 'npm-shrinkwrap.json';

export function devEntries(lock) {
  return Object.keys(lock.packages ?? {}).filter((key) => key !== '' && lock.packages[key]?.dev === true);
}

export function publishShrinkwrap(text) {
  const lock = JSON.parse(text);
  for (const key of devEntries(lock)) delete lock.packages[key];
  return `${JSON.stringify(lock, null, 2)}\n`;
}

export function publishShrinkwrapSha256(root = '.') {
  return createHash('sha256').update(publishShrinkwrap(readFileSync(join(root, SHRINKWRAP), 'utf8'))).digest('hex');
}

// Run `fn` (an `npm pack`) with the production-only shrinkwrap in place, then
// restore the repository's full lock byte for byte, even when `fn` throws.
export function withPublishShrinkwrap(root, fn) {
  const file = join(root, SHRINKWRAP);
  const original = readFileSync(file);
  writeFileSync(file, publishShrinkwrap(original.toString('utf8')));
  try {
    return fn();
  } finally {
    writeFileSync(file, original);
  }
}
