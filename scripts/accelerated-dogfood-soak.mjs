#!/usr/bin/env node
/**
 * Repeat the black-box onboarding journey in fresh consumers and emit one closed,
 * commit-bound record. This is a compressed reliability soak, not elapsed-time or
 * independent evidence.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const value = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const die = (message) => { console.error(`accelerated-dogfood-soak: ${message}`); process.exit(1); };
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function validate(record) {
  const errors = [];
  if (record.schemaVersion !== '1') errors.push('schemaVersion must be 1');
  if (record.evidenceClass !== 'author-operated-accelerated-soak') errors.push('unexpected evidenceClass');
  if (record.claims?.temporalStability !== false) errors.push('temporalStability must be false');
  if (record.claims?.independentValidation !== false) errors.push('independentValidation must be false');
  if (!Number.isInteger(record.plan?.trials) || record.plan.trials < 1) errors.push('plan.trials must be positive');
  if (!Array.isArray(record.attempts) || record.attempts.length !== record.plan?.trials) errors.push('attempt count mismatch');
  const passed = record.attempts?.filter((a) => a.outcome === 'pass').length ?? 0;
  const failed = record.attempts?.filter((a) => a.outcome === 'fail').length ?? 0;
  if (record.summary?.passed !== passed || record.summary?.failed !== failed) errors.push('summary arithmetic mismatch');
  for (const [index, attempt] of (record.attempts ?? []).entries()) {
    if (attempt.trial !== index + 1) errors.push(`attempt ${index + 1} has wrong trial number`);
    if (!['pass', 'fail'].includes(attempt.outcome)) errors.push(`attempt ${index + 1} has invalid outcome`);
    if (!/^[a-f0-9]{64}$/.test(attempt.stdoutSha256 ?? '')) errors.push(`attempt ${index + 1} stdout digest invalid`);
    if (!/^[a-f0-9]{64}$/.test(attempt.stderrSha256 ?? '')) errors.push(`attempt ${index + 1} stderr digest invalid`);
  }
  if (JSON.stringify(record).includes(root)) errors.push('record leaks the local repository path');
  return errors;
}

if (argv.includes('--check')) {
  const target = value('--check');
  if (!target) die('--check requires a record path');
  const record = JSON.parse(readFileSync(resolve(root, target), 'utf8'));
  const errors = validate(record);
  if (errors.length) die(errors.join('; '));
  console.log(`accelerated-dogfood-soak: valid (${record.summary.passed}/${record.plan.trials} pass)`);
  process.exit(0);
}

const trials = Number(value('--trials') ?? '20');
const outArg = value('--out');
if (!Number.isInteger(trials) || trials < 1 || trials > 100) die('--trials must be an integer from 1 to 100');
if (!outArg) die('--out is required');
const out = resolve(root, outArg);
if (existsSync(out) && !argv.includes('--overwrite')) die(`${outArg} exists; pass --overwrite deliberately`);
const dirty = git('status', '--porcelain', '--untracked-files=all');
if (dirty && !argv.includes('--allow-dirty')) die('working tree is dirty; commit the candidate before producing evidence');

const source = {
  commit: git('rev-parse', 'HEAD'),
  tree: git('rev-parse', 'HEAD^{tree}'),
  dirtyAtStart: Boolean(dirty),
};
const startedAt = new Date().toISOString();
const attempts = [];
for (let trial = 1; trial <= trials; trial++) {
  const start = process.hrtime.bigint();
  const result = spawnSync(process.execPath, ['scripts/onboarding-consumer-proof.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const outcome = result.status === 0 ? 'pass' : 'fail';
  const terminalMarkers = stdout.split(/\r?\n/).filter((line) => /PASS$/.test(line)).slice(-6);
  const diagnosticTail = outcome === 'fail'
    ? `${stdout}\n${stderr}`.replaceAll(root, '<repo>').split(/\r?\n/).slice(-30).join('\n')
        .replace(/\S*bce-onboarding-consumer-proof-\S*/g, '<proof-scratch>')
    : undefined;
  attempts.push({
    trial,
    outcome,
    exitCode: result.status ?? 1,
    durationMs,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    terminalMarkers,
    ...(diagnosticTail ? { diagnosticTail } : {}),
  });
  console.log(`trial ${trial}/${trials}: ${outcome.toUpperCase()} (${durationMs} ms)`);
}

const passed = attempts.filter((a) => a.outcome === 'pass').length;
const durations = attempts.map((a) => a.durationMs).sort((a, b) => a - b);
const record = {
  schemaVersion: '1',
  evidenceClass: 'author-operated-accelerated-soak',
  generatedBy: 'scripts/accelerated-dogfood-soak.mjs',
  startedAt,
  finishedAt: new Date().toISOString(),
  source,
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  plan: {
    trials,
    journey: 'fresh packed consumer + demo + author + onboard + RED + advisory + fix + GREEN + bundle verification + MCP + immutable Git install',
    isolation: 'a new mkdtemp-owned consumer tree per trial',
  },
  claims: {
    repeatedJourneyReliability: true,
    temporalStability: false,
    independentValidation: false,
    productionValidation: false,
    note: 'Compressed repetitions detect nondeterminism and lifecycle failures. They do not simulate elapsed days, independent operators, or production tenants.',
  },
  summary: {
    passed,
    failed: trials - passed,
    passRatePct: Number(((passed / trials) * 100).toFixed(1)),
    totalDurationMs: attempts.reduce((sum, a) => sum + a.durationMs, 0),
    medianDurationMs: durations[Math.floor(durations.length / 2)],
  },
  attempts,
};
const errors = validate(record);
if (errors.length) die(errors.join('; '));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
console.log(`wrote ${outArg}: ${passed}/${trials} passed`);
if (passed !== trials) process.exit(1);
