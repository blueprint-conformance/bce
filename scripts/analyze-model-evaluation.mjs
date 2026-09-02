#!/usr/bin/env node
/** Confirmatory, intention-to-treat analysis for the frozen cross-harness protocol. */
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const valueAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? null : process.argv[i + 1] ?? null;
};
const trialsDir = valueAfter('--trials');
const preregPath = valueAfter('--prereg') ?? 'research/model-evaluation-preregistration.json';
const manifestPath = valueAfter('--manifest') ?? 'research/model-evaluation-task-manifest.json';
if (!trialsDir) {
  process.stderr.write('usage: node scripts/analyze-model-evaluation.mjs --trials DIR [--prereg FILE --manifest FILE]\n');
  process.exit(2);
}
const prereg = JSON.parse(readFileSync(resolve(preregPath), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(manifestPath), 'utf8'));
if (prereg.status !== 'frozen-ready-not-run' || manifest.status !== 'sealed-ready' || manifest.sealed !== true) {
  throw new Error('analysis refused: preregistration and task manifest must be frozen-ready before trials');
}
const expectedManifestDigest = `sha256:${createHash('sha256').update(JSON.stringify({ ...manifest, manifestSha256: null })).digest('hex')}`;
if (manifest.manifestSha256 !== expectedManifestDigest) throw new Error('analysis refused: task manifest digest does not match frozen content');
const schema = JSON.parse(readFileSync(resolve('research/model-evaluation-trial.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
const files = readdirSync(resolve(trialsDir)).filter((file) => file.endsWith('.json')).sort();
const rows = files.map((file) => {
  const row = JSON.parse(readFileSync(resolve(trialsDir, file), 'utf8'));
  if (!validate(row)) throw new Error(`${file}: ${ajv.errorsText(validate.errors)}`);
  return row;
});
const byId = new Map(rows.map((row) => [row.trialId, row]));
if (byId.size !== rows.length) throw new Error('analysis refused: duplicate trialId');
const planned = manifest.randomizedTrials;
if (!Array.isArray(planned) || planned.length === 0) throw new Error('analysis refused: randomized trial manifest is empty');
const plannedIds = new Set(planned.map((trial) => trial.trialId));
const missing = [...plannedIds].filter((id) => !byId.has(id));
const extra = rows.filter((row) => !plannedIds.has(row.trialId)).map((row) => row.trialId);
if (missing.length || extra.length) throw new Error(`analysis refused: denominator mismatch (${missing.length} missing, ${extra.length} extra)`);

const harnessSpecs = new Map(prereg.harnesses.map((harness) => [harness.id, harness]));
for (const row of rows) {
  const expected = planned.find((trial) => trial.trialId === row.trialId);
  for (const key of ['harness', 'arm', 'repositoryId', 'taskId', 'orderIndex']) {
    if (row[key] !== expected[key]) throw new Error(`${row.trialId}: ${key} differs from frozen assignment`);
  }
  const identity = harnessSpecs.get(row.harness);
  if (!identity || row.identity.clientVersion !== identity.clientVersion ||
      row.identity.clientArtifactSha256 !== identity.clientArtifactSha256 ||
      row.identity.modelSnapshot !== identity.modelSnapshot) {
    throw new Error(`${row.trialId}: client/model identity differs from preregistration`);
  }
}

const z = 1.959963984540054;
const wilson = (successes, total) => {
  if (!total) return { estimate: null, low: null, high: null, successes, total };
  const p = successes / total;
  const den = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / den;
  return { estimate: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin), successes, total };
};
const rate = (subset, predicate) => wilson(subset.filter(predicate).length, subset.length);
const quantile = (values, p) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(p * values.length))];
const seed = Number.parseInt(prereg.randomization.seed.slice(7, 15), 16) >>> 0;
let randomState = seed;
const random = () => {
  randomState |= 0; randomState = randomState + 0x6D2B79F5 | 0;
  let t = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const clusteredDifference = (subset, predicate) => {
  const repositories = [...new Set(subset.map((row) => row.repositoryId))].sort();
  const point = (arm) => {
    const armRows = subset.filter((row) => row.arm === arm);
    return armRows.filter(predicate).length / armRows.length;
  };
  const draws = [];
  for (let iteration = 0; iteration < 2000; iteration += 1) {
    const sampled = [];
    for (let i = 0; i < repositories.length; i += 1) {
      const repository = repositories[Math.floor(random() * repositories.length)];
      sampled.push(...subset.filter((row) => row.repositoryId === repository));
    }
    const armRate = (arm) => {
      const armRows = sampled.filter((row) => row.arm === arm);
      return armRows.filter(predicate).length / armRows.length;
    };
    draws.push(armRate('bce-enabled') - armRate('baseline-no-bce'));
  }
  return { estimate: point('bce-enabled') - point('baseline-no-bce'), low: quantile(draws, 0.025), high: quantile(draws, 0.975), method: '2000-draw repository-cluster bootstrap' };
};
const summarizeArm = (subset) => ({
  trials: subset.length,
  statuses: Object.fromEntries(prereg.failurePolicy.statuses.map((status) => [status, subset.filter((row) => row.status === status).length])),
  architectureConformance: rate(subset, (row) => row.outcomes.architectureConformant === true),
  taskSuccess: rate(subset, (row) => row.outcomes.taskSuccessful === true),
  policyMutation: rate(subset, (row) => row.outcomes.policyMutation),
  skillLoaded: rate(subset, (row) => row.outcomes.skillLoaded),
  mcpSelected: rate(subset, (row) => row.outcomes.mcpSelected),
  gateUsed: rate(subset, (row) => row.outcomes.gateCalls > 0),
  latencyMs: { median: quantile(subset.map((row) => row.telemetry.latencyMs), 0.5), total: subset.reduce((sum, row) => sum + row.telemetry.latencyMs, 0) },
  telemetryUnavailable: subset.filter((row) => Object.keys(row.telemetry.unavailableReasons).length > 0).length,
  tokens: Object.fromEntries(['inputTokens', 'outputTokens', 'cachedTokens'].map((key) => [key, subset.reduce((sum, row) => sum + (row.telemetry[key] ?? 0), 0)])),
  costUsd: subset.reduce((sum, row) => sum + (row.telemetry.costUsd ?? 0), 0),
});

const harnesses = {};
for (const harness of [...harnessSpecs.keys()].sort()) {
  const subset = rows.filter((row) => row.harness === harness);
  for (const repository of [...new Set(subset.map((row) => row.repositoryId))]) {
    for (const arm of prereg.arms) {
      if (!subset.some((row) => row.repositoryId === repository && row.arm === arm)) {
        throw new Error(`${harness}/${repository}: cluster has no ${arm} observation`);
      }
    }
  }
  const minimum = harnessSpecs.get(harness).minimumTrialsPerArm;
  const arms = Object.fromEntries(prereg.arms.map((arm) => {
    const armRows = subset.filter((row) => row.arm === arm);
    if (armRows.length < minimum) throw new Error(`${harness}/${arm}: ${armRows.length}/${minimum} trials`);
    return [arm, summarizeArm(armRows)];
  }));
  harnesses[harness] = {
    arms,
    differences: {
      architectureConformance: clusteredDifference(subset, (row) => row.outcomes.architectureConformant === true),
      taskSuccess: clusteredDifference(subset, (row) => row.outcomes.taskSuccessful === true),
      policyMutation: clusteredDifference(subset, (row) => row.outcomes.policyMutation),
    },
  };
}
process.stdout.write(`${JSON.stringify({ schemaVersion: '1', analysis: 'intention-to-treat', pooledConfirmatoryEstimate: null, trials: rows.length, harnesses }, null, 2)}\n`);
