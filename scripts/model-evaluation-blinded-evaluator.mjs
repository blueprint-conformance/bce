#!/usr/bin/env node
/**
 * Deterministic, arm-blind evaluator for a neutral model-evaluation tree.
 *
 * The controller prepares an opaque request directory containing only the
 * neutral tree, copied oracle programs, and task-scoped commands. This process
 * refuses arm/treatment markers and never receives the study bundle, client
 * transcript, credentials, or controller state.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const canonicalJson = (value) => JSON.stringify(canonical(value));
const sha256Bytes = (value) => createHash('sha256').update(value).digest('hex');
const sha256Json = (value) => sha256Bytes(canonicalJson(value));
const posixRelative = (root, path) => relative(root, path).split(sep).join('/');

function assertInside(root, path, label) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${label} must be an absolute path`);
  const base = realpathSync(root);
  const target = realpathSync(path);
  if (target !== base && !target.startsWith(`${base}${sep}`)) throw new Error(`${label} escapes the opaque evaluation root`);
  return target;
}

function hashTree(root) {
  const base = realpathSync(root);
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === '.git' || name === 'node_modules' || name === 'coverage') continue;
      const absolute = resolve(dir, name);
      const path = posixRelative(base, absolute);
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) {
        entries.push({ path: `${path}/`, type: 'directory', mode: stat.mode & 0o777 });
        walk(absolute);
      } else if (stat.isSymbolicLink()) {
        entries.push({ path, type: 'symlink', mode: stat.mode & 0o777, target: readlinkSync(absolute) });
      } else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({ path, type: 'file', mode: stat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
      } else throw new Error(`neutral tree contains unsupported entry type: ${path}`);
    }
  };
  walk(base);
  return sha256Json(entries);
}

function assertClosedObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length) throw new Error(`${label} contains unrecognized fields: ${unexpected.join(', ')}`);
}

function assertArmBlind(request) {
  const text = canonicalJson(request);
  if (/baseline-no-bce|bce-enabled|treatmentConfig|treatmentDelta|assignment|\"arm\"/i.test(text)) {
    throw new Error('evaluation request contains an arm or treatment marker');
  }
}

function minimalEnvironment(extra = {}) {
  const environment = { ...extra };
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  return environment;
}

function execute(command, workspace, timeoutMs, environment = minimalEnvironment()) {
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
    throw new Error('evaluation command must be a non-empty string array');
  }
  const [file, ...args] = command;
  const result = spawnSync(file, args, {
    cwd: workspace,
    env: environment,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const clean = (text) => String(text ?? '').split(workspace).join('<EVALUATION_WORKSPACE>');
  return { exitCode: result.status, signal: result.signal, stdout: clean(result.stdout), stderr: clean(result.stderr) };
}

function parseOracle(result, request, treeSha256, kind) {
  let document = null;
  try { document = JSON.parse(result.stdout); } catch {}
  const keys = document && typeof document === 'object' ? Object.keys(document).sort() : [];
  const allowed = kind === 'functional'
    ? ['collateralRegression', 'inputTreeSha256', 'locations', 'passed', 'schemaVersion', 'taskId']
    : ['inputTreeSha256', 'locations', 'passed', 'schemaVersion', 'taskId'];
  const valid = document !== null && keys.every((key) => allowed.includes(key)) &&
    document.schemaVersion === '1' && document.taskId === request.taskId && document.inputTreeSha256 === treeSha256 &&
    typeof document.passed === 'boolean' && Array.isArray(document.locations) && document.locations.every((item) => typeof item === 'string') &&
    (kind !== 'functional' || typeof document.collateralRegression === 'boolean');
  return {
    passed: result.exitCode === 0 && valid && document.passed === true,
    collateralRegression: kind === 'functional' && valid ? document.collateralRegression === true : false,
    locations: valid ? document.locations : [],
    valid,
    ...result,
    document,
  };
}

function runOracleTwice(request, workspace, treeSha256, kind, oraclePath) {
  const environment = minimalEnvironment({
    BCE_EVAL_WORKSPACE: workspace,
    BCE_EVAL_TASK_ID: request.taskId,
    BCE_EVAL_INPUT_TREE_SHA256: treeSha256,
  });
  const first = parseOracle(execute([process.execPath, oraclePath], workspace, request.timeoutMs, environment), request, treeSha256, kind);
  const second = parseOracle(execute([process.execPath, oraclePath], workspace, request.timeoutMs, environment), request, treeSha256, kind);
  const deterministic = canonicalJson(first.document) === canonicalJson(second.document) && first.exitCode === second.exitCode;
  return {
    passed: deterministic && first.passed && second.passed,
    collateralRegression: kind === 'functional' && (first.collateralRegression || second.collateralRegression),
    locations: first.locations,
    deterministic,
    executed: true,
    inputTreeSha256: treeSha256,
    runs: [first, second],
  };
}

try {
  const requestPath = valueAfter('--request');
  if (!requestPath) throw new Error('usage: node scripts/model-evaluation-blinded-evaluator.mjs --request ABSOLUTE_PATH');
  const requestRoot = dirname(resolve(requestPath));
  const request = JSON.parse(readFileSync(assertInside(requestRoot, resolve(requestPath), 'request'), 'utf8'));
  assertClosedObject(request, [
    'schemaVersion', 'evaluationId', 'taskId', 'neutralTree', 'neutralTreeSha256', 'visibleCommands',
    'functionalOracle', 'architectureOracle', 'timeoutMs', 'requestSha256',
  ], 'evaluation request');
  if (request.schemaVersion !== '1' || !/^[0-9a-f]{64}$/.test(request.evaluationId ?? '') ||
      typeof request.taskId !== 'string' || request.taskId.length < 3 || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1 ||
      request.requestSha256 !== sha256Json({ ...request, requestSha256: null })) {
    throw new Error('evaluation request identity or self-digest is invalid');
  }
  assertArmBlind(request);
  const workspace = assertInside(requestRoot, request.neutralTree, 'neutral tree');
  const functionalOracle = assertInside(requestRoot, request.functionalOracle, 'functional oracle');
  const architectureOracle = assertInside(requestRoot, request.architectureOracle, 'architecture oracle');
  const treeSha256 = hashTree(workspace);
  if (treeSha256 !== request.neutralTreeSha256) throw new Error('neutral tree differs from the committed evaluation input');
  const visibleStarted = performance.now();
  const visibleRuns = request.visibleCommands.map((command) => ({ command, ...execute(command, workspace, request.timeoutMs) }));
  const visibleMs = Math.round(performance.now() - visibleStarted);
  const visible = {
    nonBceAccepted: visibleRuns.every((entry) => entry.exitCode === 0),
    nonBceRuns: visibleRuns,
  };
  const oracleStarted = performance.now();
  const functional = runOracleTwice(request, workspace, treeSha256, 'functional', functionalOracle);
  const architecture = runOracleTwice(request, workspace, treeSha256, 'architecture', architectureOracle);
  const oracleMs = Math.round(performance.now() - oracleStarted);
  const result = {
    schemaVersion: '1',
    evaluationId: request.evaluationId,
    requestSha256: request.requestSha256,
    neutralTreeSha256: treeSha256,
    armBlind: true,
    visible,
    functional,
    architecture,
    timing: { visibleMs, oracleMs },
    resultSha256: null,
  };
  result.resultSha256 = sha256Json(result);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`blinded evaluation refused: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
