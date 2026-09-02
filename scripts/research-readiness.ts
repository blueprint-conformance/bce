import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const read = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(root, 'research', name), 'utf8')) as Record<string, unknown>;
const phase = process.argv.includes('--model-eval') ? 'model-eval' : process.argv.includes('--study') ? 'study' : 'benchmark';
const refusals: string[] = [];
const manifestDigest = (manifest: Record<string, unknown>): string => {
  const payload = { ...manifest, manifestSha256: null };
  return `sha256:${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
};

if (phase === 'benchmark') {
  const prereg = read('benchmark-preregistration.json');
  const heldout = read('heldout-manifest.template.json');
  if (prereg.frozenBeforeHeldoutAccess !== true) refusals.push('benchmark preregistration is not frozen before held-out access');
  if (heldout.sealed !== true) refusals.push('held-out manifest is not sealed');
  if (typeof heldout.corpusDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(heldout.corpusDigest)) refusals.push('held-out corpus SHA-256 digest is absent');
  if (!Array.isArray(heldout.cases) || heldout.cases.length === 0) refusals.push('held-out manifest has zero cases');
} else if (phase === 'study') {
  const study = read('study-preregistration.json');
  if (study.status !== 'frozen-not-run') refusals.push('study preregistration status must be frozen-not-run');
  if ((study as { results?: unknown }).results !== null) refusals.push('study input must not contain results');
  const families = study.modelFamilies as { minimum?: number; versionsFrozen?: boolean } | undefined;
  if (!families || (families.minimum ?? 0) < 2 || families.versionsFrozen !== true) refusals.push('at least two frozen model families are required');
  if (!String(study.blinding ?? '').includes('blinded')) refusals.push('outcome-assessor blinding is required');
} else {
  const prereg = read('model-evaluation-preregistration.json');
  const manifest = read('model-evaluation-task-manifest.json');
  if (prereg.status !== 'frozen-ready-not-run') refusals.push('model evaluation status must be frozen-ready-not-run');
  if ((prereg as { results?: unknown }).results !== null) refusals.push('model evaluation preregistration must not contain results');
  const harnesses = prereg.harnesses as Array<Record<string, unknown>> | undefined;
  const expectedHarnesses = ['agents-generic', 'claude', 'codex', 'cursor'];
  if (!Array.isArray(harnesses) || harnesses.map((h) => String(h.id)).sort().join(',') !== expectedHarnesses.join(',')) {
    refusals.push('all four named harnesses must be present exactly once');
  } else {
    for (const harness of harnesses) {
      if ((harness.minimumTrialsPerArm as number | undefined ?? 0) < 30) refusals.push(`${harness.id}: fewer than 30 trials per arm`);
      if (typeof harness.clientVersion !== 'string' || harness.clientVersion.length === 0) refusals.push(`${harness.id}: exact client version is not frozen`);
      if (typeof harness.modelSnapshot !== 'string' || harness.modelSnapshot.length === 0) refusals.push(`${harness.id}: exact model snapshot is not frozen`);
      if (typeof harness.clientArtifactSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(harness.clientArtifactSha256)) refusals.push(`${harness.id}: client artifact digest is not frozen`);
    }
  }
  const isolation = prereg.configurationIsolation as Record<string, unknown> | undefined;
  if (!isolation || isolation.freshTemporaryHomePerTrial !== true || isolation.userConfigurationImported !== false || isolation.sharedCachesDisabled !== true) {
    refusals.push('fresh-home, no-user-config, cache-disabled isolation is required');
  }
  if (manifest.sealed !== true || manifest.status !== 'sealed-ready') refusals.push('model evaluation task manifest is not sealed-ready');
  if (typeof manifest.manifestSha256 !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(manifest.manifestSha256)) refusals.push('model evaluation task manifest digest is absent');
  else if (manifest.manifestSha256 !== manifestDigest(manifest)) refusals.push('model evaluation task manifest digest does not match its frozen content');
  const repositories = manifest.repositories as unknown[] | undefined;
  const tasks = manifest.tasks as Array<Record<string, unknown>> | undefined;
  const trials = manifest.randomizedTrials as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(repositories) || repositories.length < 6) refusals.push('model evaluation requires at least six frozen repositories');
  if (!Array.isArray(tasks) || tasks.length < 12) refusals.push('model evaluation requires at least twelve frozen tasks');
  if (!Array.isArray(trials) || trials.length < 240) {
    refusals.push('model evaluation randomized matrix requires at least 240 trials (4 harnesses × 2 arms × 30)');
  } else {
    const ids = trials.map((trial) => String(trial.trialId));
    if (new Set(ids).size !== ids.length) refusals.push('model evaluation trial IDs must be unique');
    for (const harness of expectedHarnesses) {
      for (const arm of ['baseline-no-bce', 'bce-enabled']) {
        const n = trials.filter((trial) => trial.harness === harness && trial.arm === arm).length;
        if (n < 30) refusals.push(`${harness}/${arm}: randomized manifest has ${n}/30 trials`);
      }
    }
  }
}

if (refusals.length) {
  process.stderr.write(`research readiness REFUSED (${phase}):\n${refusals.map((x) => `- ${x}`).join('\n')}\n`);
  process.exit(2);
}
process.stdout.write(`research readiness: ${phase} inputs are frozen and structurally ready; this is not a result\n`);
