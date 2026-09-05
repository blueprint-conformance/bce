#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixture = mkdtempSync(join(tmpdir(), 'bce-evidence-claims-'));
const checker = join(root, 'scripts/check-evidence-claims.mjs');
const matrixPath = 'research/claim-evidence-matrix.json';
const matrix = JSON.parse(readFileSync(join(root, matrixPath), 'utf8'));
const paths = new Set([
  matrixPath,
  'llms.txt',
  ...matrix.publicBoundaries.map((entry) => entry.path),
  ...matrix.studies.flatMap((study) => [study.summary, study.protocol, study.manifest]),
  ...matrix.claims.flatMap((claim) => claim.evidence ?? []),
]);
for (const path of paths) {
  const target = join(fixture, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(root, path), target);
}
const originals = new Map([...paths].map((path) => [path, readFileSync(join(fixture, path), 'utf8')]));
const restore = () => { for (const [path, value] of originals) writeFileSync(join(fixture, path), value); };

function reject(label, mutate, marker) {
  restore();
  mutate();
  try {
    execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error(`${label}: evidence checker accepted the contradiction`);
  } catch (error) {
    if (error.status !== 1 || !String(error.stderr).includes(marker)) throw error;
  }
}

reject('directional evidence promoted to product claim', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.claims.find((claim) => claim.id === 'accelerated-v6-directional-observation').status = 'product-test-supported';
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'product-test-supported requires first-party-mechanism-test evidence');

reject('product eligibility fabricated', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies[0].eligibility.productEfficacy = true;
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'ineligible for every product claim class');

reject('result anchor drift', () => {
  const value = JSON.parse(originals.get(matrixPath));
  value.studies[0].resultSha256 = '0'.repeat(64);
  writeFileSync(join(fixture, matrixPath), `${JSON.stringify(value, null, 2)}\n`);
}, 'result or seal anchor differs');

reject('attempt denominator rewritten', () => {
  const path = matrix.studies[0].summary;
  const value = JSON.parse(originals.get(path));
  value.verifiedTrials = 15;
  writeFileSync(join(fixture, path), `${JSON.stringify(value, null, 2)}\n`);
}, 'summary or analysis self-digest is invalid');

reject('public boundary removed', () => {
  const boundary = matrix.publicBoundaries[0];
  writeFileSync(join(fixture, boundary.path), originals.get(boundary.path).replace(boundary.required, 'Evidence is promising.'));
}, 'missing its required claim boundary');

reject('unqualified efficacy prose introduced', () => {
  const boundary = matrix.publicBoundaries[0];
  writeFileSync(join(fixture, boundary.path), `${originals.get(boundary.path)}\nBCE improves\ncoding-agent outcomes.\n`);
}, 'unqualified product-efficacy claim');

restore();
const accepted = execFileSync(process.execPath, [checker, '--root', fixture], { encoding: 'utf8' });
if (!accepted.includes('PASS')) throw new Error(`clean evidence claim set did not pass:\n${accepted}`);
process.stdout.write('evidence-claim-policy self-test: PASS (promotion, eligibility, anchor, denominator, boundary, and prose contradictions rejected)\n');
