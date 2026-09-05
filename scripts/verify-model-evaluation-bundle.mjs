#!/usr/bin/env node
import { verifyBundle } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = valueAfter('--bundle') ?? 'research/model-evaluation';
const requireSealed = !process.argv.includes('--draft');
const verifyHostArtifacts = !process.argv.includes('--portable-inputs');
const result = verifyBundle(bundleDir, { requireSealed, verifyHostArtifacts });
if (!result.ok) {
  process.stderr.write(`model-evaluation bundle REFUSED:\n${result.refusals.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(2);
}
const implementationScope = result.historicalImplementations.length > 0
  ? `; ${result.historicalImplementations.length} frozen implementation artifact(s) verified at attested Git commit ${result.historicalImplementations[0].commit}`
  : '; running implementation bytes match the seal';
const scope = verifyHostArtifacts ? `exact host artifacts replayed${implementationScope}` : `portable inputs only; external host artifacts not replayed${implementationScope}`;
process.stdout.write(`model-evaluation bundle verified: ${result.protocol.studyId} (${requireSealed ? result.seal.rootSha256 : 'draft structure only'}; ${scope})\n`);
