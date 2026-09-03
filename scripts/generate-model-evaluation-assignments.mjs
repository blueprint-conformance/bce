#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { regenerateAssignments } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const bundleDir = resolve(valueAfter('--bundle') ?? 'research/model-evaluation');
const protocolPath = resolve(bundleDir, 'protocol.v2.json');
const manifestPath = resolve(bundleDir, 'task-manifest.json');
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.sealed || !['draft', 'template-unpopulated'].includes(manifest.status)) {
  throw new Error(`assignment generation refused: manifest status is ${manifest.status} (sealed=${manifest.sealed})`);
}
const generated = regenerateAssignments(protocol, manifest);
manifest.assignments = generated.assignments;
manifest.assignmentProof = generated.assignmentProof;
manifest.status = 'draft';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`generated ${manifest.assignments.length} paired assignments with ${generated.assignmentProof.algorithm}\n`);
