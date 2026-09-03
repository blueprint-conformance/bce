#!/usr/bin/env node
/** Deterministic no-model fixture client. It is accepted only by synthetic-self-test seals. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write('fixture-agent 1.0.0\n');
  process.exit(0);
}
const prompt = process.argv.at(-1) ?? '';
let target;
let content;
if (prompt.includes('Implement summarize')) {
  target = 'src/service.mjs';
  content = "import { callProvider } from './gateway.mjs';\nexport async function summarize(name) { return callProvider(String(name).trim()); }\n";
} else if (prompt.includes('Implement formatTitle')) {
  target = 'src/title.mjs';
  content = "export function formatTitle(value) { return String(value).trim().split(/\\s+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' '); }\n";
} else if (prompt.includes('Implement runJob')) {
  target = 'src/worker.mjs';
  content = "import { getRegion } from './config.mjs';\nexport function runJob(id) { return `job:${String(id).trim()}:${getRegion()}`; }\n";
} else if (prompt.includes('Implement cacheKey')) {
  target = 'src/cache.mjs';
  content = "export function cacheKey(value) { return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }\n";
} else {
  process.stderr.write('unknown fixture prompt\n');
  process.exit(3);
}
writeFileSync(join(process.cwd(), target), content);
process.stdout.write(`${JSON.stringify({ model: 'fixture-model-v1', num_turns: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, cost_usd: 0 })}\n`);
