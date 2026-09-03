#!/usr/bin/env node
import Ajv from 'ajv';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const schema = readJson('research/adoption-record.schema.json');
const program = readJson('research/adoption-program.json');
const release = readJson('release-state.json');
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
const recordsDir = join(root, 'research', 'adoption-records');
const files = existsSync(recordsDir) ? readdirSync(recordsDir).filter((name) => name.endsWith('.json')).sort() : [];
const records = [];
const failures = [];

for (const file of files) {
  const record = JSON.parse(readFileSync(join(recordsDir, file), 'utf8'));
  if (!validate(record)) failures.push(`${file}: ${new Ajv().errorsText(validate.errors)}`);
  if (record.adjudication?.status === 'accepted-independent' &&
      (record.relationship?.authorControlledMachine || record.relationship?.authorOperatedRun)) {
    failures.push(`${file}: author-controlled or author-operated evidence cannot be accepted-independent`);
  }
  records.push(record);
}

const ids = records.map((record) => record.participantId);
if (new Set(ids).size !== ids.length) failures.push('participantId values must be unique');
const count = (outcome) => records.filter((record) => record.journey?.outcome === outcome).length;
const accepted = records.filter((record) => record.adjudication?.status === 'accepted-independent').length;
const expected = { started: records.length, success: count('success'), failure: count('failure'), abandoned: count('abandoned'), acceptedIndependent: accepted };
for (const [key, value] of Object.entries(expected)) {
  if (program.outcomes?.[key] !== value) failures.push(`adoption-program outcomes.${key}=${program.outcomes?.[key]} but records require ${value}`);
}
if (accepted > expected.success) failures.push('accepted-independent count cannot exceed successful journeys');
if (release.independentWitnesses !== accepted) failures.push(`release-state witnesses ${release.independentWitnesses} != accepted-independent records ${accepted}`);
const attestations = readFileSync(join(root, 'ATTESTATIONS.md'), 'utf8');
const ledgerCount = Number(/^>\s*\*\*Count:\s*(\d+)\.\*\*/m.exec(attestations)?.[1] ?? NaN);
if (ledgerCount !== accepted) failures.push(`ATTESTATIONS count ${ledgerCount} != accepted-independent records ${accepted}`);

if (failures.length) {
  process.stderr.write(`adoption-program: FAIL\n- ${failures.join('\n- ')}\n`);
  process.exit(1);
}
process.stdout.write(`adoption-program: PASS (${records.length} started; ${accepted} accepted independent; target ${program.targetIndependentSuccesses})\n`);
