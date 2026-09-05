#!/usr/bin/env node
/** Replays the real v4 safety-halt archive and rejects self-rehashed claim/integrity tampering. */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';

const root = process.cwd();
const bundle = join(root, 'research', 'model-evaluation', 'pilots', 'accelerated-v4');
const sourceResults = join(bundle, 'results');
const verifier = join(root, 'scripts', 'verify-model-evaluation-public.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'bce-safety-halt-selftest-'));

function run(results) {
  return spawnSync(process.execPath, [verifier, '--bundle', bundle, '--results', results], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function rewriteSummary(results, mutate) {
  const path = join(results, 'summary.json');
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  mutate(summary);
  summary.resultSha256 = sha256Json({ ...summary, resultSha256: null });
  writeFileSync(path, `${JSON.stringify(summary, null, 2)}\n`);
}

function expectRefusal(name, mutate, pattern) {
  const results = join(scratch, name);
  cpSync(sourceResults, results, { recursive: true });
  mutate(results);
  const checked = run(results);
  if (checked.status === 0 || !pattern.test(checked.stderr)) {
    throw new Error(`${name}: verifier did not produce the expected refusal\nstdout:\n${checked.stdout}\nstderr:\n${checked.stderr}`);
  }
}

try {
  const valid = run(sourceResults);
  if (valid.status !== 0) throw new Error(`valid safety-halt archive failed replay:\n${valid.stderr}`);
  const summary = JSON.parse(readFileSync(join(sourceResults, 'summary.json'), 'utf8'));
  if (summary.resultKind !== 'safety-halt-archive' || summary.analysis !== null ||
      summary.archive?.efficacyEstimatesProduced !== false || summary.archive?.verifiedTrials !== 6 ||
      summary.archive?.plannedTrials !== 24 || summary.archive?.unexposedTrials !== 18 ||
      summary.archive?.claimDecision?.decision !== 'not-evaluated-safety-halted-partial-run') {
    throw new Error('v4 public archive widened or misstated the halted evidence boundary');
  }

  expectRefusal('injected-efficacy', (results) => rewriteSummary(results, (document) => {
    document.archive.armComparison = { uplift: 1 };
    document.archive.archiveSha256 = sha256Json({ ...document.archive, archiveSha256: null });
  }), /invalid safety-halt archive|archive does not recompute/);

  expectRefusal('analysis-type-confusion', (results) => rewriteSummary(results, (document) => {
    document.analysis = { productDecision: { decision: 'recommend' } };
  }), /contains an analysis/);

  expectRefusal('halt-count', (results) => {
    const haltPath = join(results, 'study-halt.json');
    const halt = JSON.parse(readFileSync(haltPath, 'utf8'));
    halt.committedTrials = 5;
    const bytes = Buffer.from(`${JSON.stringify(halt, null, 2)}\n`);
    writeFileSync(haltPath, bytes);
    rewriteSummary(results, (document) => { document.runDisposition.haltSha256 = sha256Bytes(bytes); });
  }, /does not bind the recomputed stopping rule/);

  expectRefusal('truncated-ledger', (results) => {
    const ledgerPath = join(results, 'ledger.jsonl');
    const lines = readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
    const bytes = Buffer.from(`${lines.slice(0, -1).join('\n')}\n`);
    writeFileSync(ledgerPath, bytes);
    rewriteSummary(results, (document) => { document.publicReplay.ledgerSha256 = sha256Bytes(bytes); });
  }, /denominator or safety-halt prefix mismatch/);

  process.stdout.write('model-evaluation safety-halt archive self-test: PASS (real 6/24 prefix replayed; efficacy injection, result-type confusion, halt tamper, and ledger truncation refused)\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
