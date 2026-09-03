#!/usr/bin/env node
import { verifyBundle } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = valueAfter('--bundle') ?? 'research/model-evaluation';
const requireSealed = !process.argv.includes('--draft');
const result = verifyBundle(bundleDir, { requireSealed });
if (!result.ok) {
  process.stderr.write(`model-evaluation bundle REFUSED:\n${result.refusals.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(2);
}
process.stdout.write(`model-evaluation bundle verified: ${result.protocol.studyId} (${requireSealed ? result.seal.rootSha256 : 'draft structure only'})\n`);
