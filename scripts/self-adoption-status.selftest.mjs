#!/usr/bin/env node
/** Negative controls for the public pipeline's claims; no network, credentials, or repository writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeRuns, readPipeline, WORKFLOWS, REPOSITORY } from '../assets/site/self-adoption-status.mjs';
import { selfAdoptionHtml } from './lib/self-adoption-site.mjs';

const head = 'a'.repeat(40);
const other = 'b'.repeat(40);
const run = (workflow, overrides = {}) => ({ id: 100 + WORKFLOWS.indexOf(workflow), run_number: 1, run_attempt: 1,
  head_sha: head, head_branch: 'main', event: 'push', repository: { full_name: REPOSITORY },
  path: workflow.path, status: 'completed', conclusion: 'success', ...overrides });
const payload = runs => ({ total_count: runs.length, workflow_runs: runs });
const successful = WORKFLOWS.map(workflow => run(workflow));
assert(summarizeRuns(head, payload(successful)).every(stage => stage.state === 'passed'));
for (const overrides of [{ head_sha: other }, { head_branch: 'feature' }, { event: 'pull_request' },
  { repository: { full_name: 'example/other' } }, { path: '.github/workflows/unrelated.yml' }]) {
  assert(summarizeRuns(head, payload(WORKFLOWS.map(w => run(w, overrides)))).every(stage => stage.state === 'unknown'));
}
assert(summarizeRuns(other, payload(successful)).every(stage => stage.state === 'unknown'));
for (const [overrides, expected] of [
  [{ conclusion: 'failure' }, 'failed'], [{ conclusion: 'timed_out' }, 'failed'],
  [{ conclusion: 'cancelled' }, 'unknown'], [{ conclusion: 'skipped' }, 'unknown'],
  [{ conclusion: 'neutral' }, 'unknown'], [{ conclusion: null }, 'unknown'],
  [{ status: 'in_progress', conclusion: 'success' }, 'running'], [{ status: 'queued', conclusion: null }, 'running'],
  [{ status: 'unrecognized', conclusion: 'success' }, 'unknown'],
]) assert.equal(summarizeRuns(head, payload([run(WORKFLOWS[0], overrides)]))[0].state, expected);
assert.equal(summarizeRuns(head, payload([...successful, run(WORKFLOWS[0], {
  id: 200, run_number: 2, status: 'queued', conclusion: null,
})]))[0].state, 'running');
assert.equal(summarizeRuns(head, payload([...successful, run(WORKFLOWS[0], {
  run_attempt: 2, status: 'completed', conclusion: 'failure',
})]))[0].state, 'failed');
assert.equal(summarizeRuns(head, payload([run(WORKFLOWS[0], { path: WORKFLOWS[0].path + '@main', html_url: 'https://example.test/untrusted' })]))[0].url,
  `https://github.com/${REPOSITORY}/actions/runs/100`);
assert.throws(() => summarizeRuns(head, { total_count: 101, workflow_runs: successful }), /incomplete/);
assert.throws(() => summarizeRuns('invalid', payload([])), /invalid/);
assert.throws(() => summarizeRuns(head, payload([run(WORKFLOWS[0], { id: 'injected' })])), /identity/);
const requests = [];
const observation = await readPipeline(async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => requests.length === 1 ? { sha: head } : payload(successful) };
});
assert.equal(observation.head, head);
assert.equal(requests.length, 2);
assert(requests[1].url.includes('head_sha=' + head));
assert(requests.every(r => r.options.credentials === 'omit' && r.options.referrerPolicy === 'no-referrer' && !r.options.headers.Authorization));
for (const status of [403, 429, 500]) await assert.rejects(readPipeline(async () => ({ ok: false, status })), /GitHub/);
await assert.rejects(readPipeline(async () => ({ ok: true, json: async () => ({ sha: 'invalid' }) })), /invalid main/);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-status-record-'));
try {
  fs.mkdirSync(path.join(temporary, '.blueprints'));
  for (const file of ['.bce-adoption.json', '.blueprints/POLICY-HISTORY.jsonl']) fs.copyFileSync(path.join(repoRoot, file), path.join(temporary, file));
  assert(selfAdoptionHtml(temporary, '../../guides/live-self-adoption/').includes('Live checks not loaded'));
  const adoptionPath = path.join(temporary, '.bce-adoption.json');
  const original = fs.readFileSync(adoptionPath, 'utf8');
  for (const change of [{ mode: 'advisory' }, { ratified: false }, { blueprintRef: 'other@0.1.0' }, { reviewMode: 'invented' }]) {
    fs.writeFileSync(adoptionPath, JSON.stringify({ ...JSON.parse(original), ...change }));
    assert.throws(() => selfAdoptionHtml(temporary, '../guide/'), /contradictory/);
  }
  fs.writeFileSync(adoptionPath, original);
  const historyPath = path.join(temporary, '.blueprints/POLICY-HISTORY.jsonl');
  const entries = fs.readFileSync(historyPath, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  entries.at(-1).reviewerAuthentication.reference = 'javascript:alert(1)';
  fs.writeFileSync(historyPath, entries.map(entry => JSON.stringify(entry)).join('\n'));
  assert.throws(() => selfAdoptionHtml(temporary, '../guide/'), /contradictory/);
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
console.log('Self-adoption status: same-commit success, stale/missing/failed/rerun controls, read-only fetch, and contradictory record refusals passed.');
