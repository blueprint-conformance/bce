#!/usr/bin/env node
import Ajv from 'ajv';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path));
const vectorsBytes = read('spec/conformance-vectors/vectors.json');
const vectors = JSON.parse(vectorsBytes);
const vectorSet = JSON.parse(read('spec/conformance-vectors/vector-set.json'));
const digest = createHash('sha256').update(vectorsBytes).digest('hex');
if (vectorSet.vectorsSha256 !== digest) throw new Error(`vector-set digest drift: declared ${vectorSet.vectorsSha256}, actual ${digest}`);
if (process.argv.length < 3) {
  console.log(`external-implementation contract: PASS (${vectors.vectors.length} vectors; sha256:${digest}; accepted ${vectorSet.externalImplementationsAccepted})`);
  process.exit(0);
}

const report = JSON.parse(readFileSync(resolve(process.argv[2]), 'utf8'));
const schema = JSON.parse(read('spec/conformance-vectors/implementation-report.schema.json'));
const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
if (!validate(report)) throw new Error(`invalid implementation report: ${new Ajv().errorsText(validate.errors)}`);
if (report.implementation.repository.includes('github.com/blueprint-conformance/bce')) throw new Error('the BCE repository is not an external implementation');
if (report.vectorSet.sha256 !== digest) throw new Error('report targets a different vector-set digest');
const expected = new Map(vectors.vectors.map((vector) => [vector.id, vector]));
const seen = new Set();
for (const assessment of report.assessments) {
  if (seen.has(assessment.id)) throw new Error(`duplicate assessment ${assessment.id}`);
  seen.add(assessment.id);
  const vector = expected.get(assessment.id);
  if (!vector) throw new Error(`unknown assessment ${assessment.id}`);
  if (assessment.actualVerdict !== vector.expectedVerdict || assessment.actualExitCode !== vector.expectedExitCode) {
    throw new Error(`${assessment.id} differs: got ${assessment.actualVerdict}/${assessment.actualExitCode}, expected ${vector.expectedVerdict}/${vector.expectedExitCode}`);
  }
}
if (seen.size !== expected.size) throw new Error(`report assessed ${seen.size}/${expected.size} vectors`);
console.log(`external implementation report: PASS (${seen.size}/${expected.size} vectors; adjudication ${report.adjudication.status})`);
