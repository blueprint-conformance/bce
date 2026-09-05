#!/usr/bin/env node
/** Deterministic no-model fixture client. It is accepted only by synthetic-self-test seals. */
import { existsSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.argv.includes('--version')) {
  process.stdout.write('fixture-agent 1.0.0\n');
  process.exit(0);
}
const prompt = process.argv.at(-1) ?? '';
const codexLifecycleFixture = process.argv.includes('exec');
if (codexLifecycleFixture) {
  const sandboxIndex = process.argv.indexOf('--sandbox');
  if (process.argv[sandboxIndex + 1] !== 'danger-full-access') {
    process.stderr.write('nested client sandbox was not disabled inside the outer controller profile\n');
    process.exit(10);
  }
  process.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: 'credential-retirement-fixture' })}\n`);
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (existsSync(`${process.env.CODEX_HOME}/auth.json`)) {
    process.stderr.write('credential remained readable after client initialization\n');
    process.exit(9);
  }
  process.stdout.write(`${JSON.stringify({ type: 'turn.started' })}\n`);
}
let target;
let content;
let symlinkTarget = null;
if (prompt.includes('Create a symbolic-link output fixture')) {
  target = 'src/service.mjs';
  symlinkTarget = 'gateway.mjs';
} else if (prompt.includes('Implement summarize')) {
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
const targetPath = join(process.cwd(), target);
if (symlinkTarget) {
  rmSync(targetPath);
  symlinkSync(symlinkTarget, targetPath);
} else writeFileSync(targetPath, content);
if (codexLifecycleFixture) process.stdout.write(`${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 20, cached_input_tokens: 0 } })}\n`);
else process.stdout.write(`${JSON.stringify({ model: 'fixture-model-v1', num_turns: 1, input_tokens: 100, output_tokens: 20, cached_tokens: 0, cost_usd: 0 })}\n`);
