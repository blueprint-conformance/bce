#!/usr/bin/env node
/** Adversarial proof for the arm-blind neutral-tree evaluator. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashTree, sha256Json } from './lib/model-evaluation.mjs';

const root = process.cwd();
const evaluator = resolve(root, 'scripts', 'model-evaluation-blinded-evaluator.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'bce-blinded-evaluator-selftest-'));
const workspace = join(scratch, 'workspace');
const oracles = join(scratch, 'oracles');
mkdirSync(join(workspace, 'src'), { recursive: true });
mkdirSync(oracles, { recursive: true });
writeFileSync(join(workspace, 'src', 'value.mjs'), 'export const value = 42;\n');
writeFileSync(join(workspace, 'visible.mjs'), "import { value } from './src/value.mjs'; if (value !== 42) process.exit(1);\n");
const oracleSource = (kind) => `import { value } from ${JSON.stringify(new URL(`file://${join(workspace, 'src', 'value.mjs')}`).href)};\nconst passed = value === 42;\nprocess.stdout.write(JSON.stringify({schemaVersion:'1',taskId:process.env.BCE_EVAL_TASK_ID,inputTreeSha256:process.env.BCE_EVAL_INPUT_TREE_SHA256,passed,${kind === 'functional' ? 'collateralRegression:false,' : ''}locations:[]}));\n`;
writeFileSync(join(oracles, 'functional.mjs'), oracleSource('functional'));
writeFileSync(join(oracles, 'architecture.mjs'), oracleSource('architecture'));

function request(overrides = {}) {
  const value = {
    schemaVersion: '1',
    evaluationId: 'a'.repeat(64),
    taskId: 'neutral-task',
    neutralTree: workspace,
    neutralTreeSha256: hashTree(workspace),
    visibleCommands: [[process.execPath, 'visible.mjs']],
    functionalOracle: join(oracles, 'functional.mjs'),
    architectureOracle: join(oracles, 'architecture.mjs'),
    timeoutMs: 10000,
    requestSha256: null,
    ...overrides,
  };
  value.requestSha256 = sha256Json(value);
  return value;
}

function run(value) {
  const path = join(scratch, 'request.json');
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return spawnSync(process.execPath, [evaluator, '--request', path], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

try {
  const accepted = run(request());
  if (accepted.status !== 0) throw new Error(`valid neutral evaluation refused: ${accepted.stderr}`);
  const result = JSON.parse(accepted.stdout);
  if (result.armBlind !== true || result.visible.nonBceAccepted !== true || result.functional.passed !== true ||
      result.architecture.passed !== true || result.resultSha256 !== sha256Json({ ...result, resultSha256: null })) {
    throw new Error('valid neutral evaluation did not produce a complete self-bound result');
  }

  const marked = run(request({ arm: 'bce-enabled' }));
  if (marked.status !== 2 || !marked.stderr.includes('unrecognized fields')) throw new Error('arm-bearing request was not refused');

  const stale = request();
  stale.taskId = 'mutated-after-digest';
  const staleResult = run(stale);
  if (staleResult.status !== 2 || !staleResult.stderr.includes('self-digest')) throw new Error('stale request digest was not refused');

  writeFileSync(join(workspace, 'src', 'value.mjs'), 'export const value = 41;\n');
  const treeDrift = run(request({ neutralTreeSha256: 'f'.repeat(64) }));
  if (treeDrift.status !== 2 || !treeDrift.stderr.includes('neutral tree differs')) throw new Error('neutral-tree drift was not refused');

  process.stdout.write('model-evaluation blinded evaluator self-test: PASS (closed arm-blind request, deterministic oracle replay, stale digest and tree drift refused)\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
