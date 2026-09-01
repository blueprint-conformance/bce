import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const read = (name: string): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(root, 'research', name), 'utf8')) as Record<string, unknown>;
const phase = process.argv.includes('--study') ? 'study' : 'benchmark';
const refusals: string[] = [];

if (phase === 'benchmark') {
  const prereg = read('benchmark-preregistration.json');
  const heldout = read('heldout-manifest.template.json');
  if (prereg.frozenBeforeHeldoutAccess !== true) refusals.push('benchmark preregistration is not frozen before held-out access');
  if (heldout.sealed !== true) refusals.push('held-out manifest is not sealed');
  if (typeof heldout.corpusDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(heldout.corpusDigest)) refusals.push('held-out corpus SHA-256 digest is absent');
  if (!Array.isArray(heldout.cases) || heldout.cases.length === 0) refusals.push('held-out manifest has zero cases');
} else {
  const study = read('study-preregistration.json');
  if (study.status !== 'frozen-not-run') refusals.push('study preregistration status must be frozen-not-run');
  if ((study as { results?: unknown }).results !== null) refusals.push('study input must not contain results');
  const families = study.modelFamilies as { minimum?: number; versionsFrozen?: boolean } | undefined;
  if (!families || (families.minimum ?? 0) < 2 || families.versionsFrozen !== true) refusals.push('at least two frozen model families are required');
  if (!String(study.blinding ?? '').includes('blinded')) refusals.push('outcome-assessor blinding is required');
}

if (refusals.length) {
  process.stderr.write(`research readiness REFUSED (${phase}):\n${refusals.map((x) => `- ${x}`).join('\n')}\n`);
  process.exit(2);
}
process.stdout.write(`research readiness: ${phase} inputs are frozen and structurally ready; this is not a result\n`);
