#!/usr/bin/env node
/** Offline analysis over verified, artifact-backed terminal records. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyzeModelEvaluationRecords } from './lib/model-evaluation-analysis.mjs';
import { loadVerifiedRecords, sha256Bytes } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = valueAfter('--bundle');
const runsDir = valueAfter('--runs');
if (!bundleDir || !runsDir) {
  process.stderr.write('usage: node scripts/analyze-model-evaluation.mjs --bundle DIR --runs DIR\n');
  process.exit(2);
}

const { bundle, records } = loadVerifiedRecords(bundleDir, runsDir);
const runningAnalyzerSha256 = sha256Bytes(readFileSync(fileURLToPath(import.meta.url)));
if (runningAnalyzerSha256 !== bundle.protocol.implementation.analyzerSha256) {
  throw new Error('analysis refused: running analyzer digest differs from the frozen protocol implementation');
}
const analysis = analyzeModelEvaluationRecords(bundle, records, runningAnalyzerSha256);
process.stdout.write(`${JSON.stringify(analysis, null, 2)}\n`);
