#!/usr/bin/env node
/** Independently plant every published skill-standard defect in temporary source copies. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const blueprint = JSON.parse(readFileSync('.blueprints/skill-standard.blueprint.json', 'utf8'));
const target = 'skills/bce/SKILL.md';
const preconditionSha256 = createHash('sha256').update(readFileSync(target)).digest('hex');
const probes = [
  'user_invocable: true',
  'name: Invalid Name',
  'description: TODO',
  `description: ${'a'.repeat(1026)}`,
  'description: This skill provides an example.',
  'model: claude-example',
  'sk-ant-EXAMPLE_NOT_A_REAL_CREDENTIAL',
  '/Users/fixture/probe.md',
  '<system-reminder>',
  'lorem ipsum',
];
const files = ['skills/bce/.env.fixture', 'skills/bce/fixture.pem', 'skills/bce/id_rsa_fixture'];
const manifest = {
  schemaVersion: '1', blueprintRef: `${blueprint.metadata.id}@${blueprint.metadata.version}`,
  allowedMutationRoots: ['skills'],
  cases: blueprint.constraints.map((constraint, index) => ({
    id: `skill-mutant-${index + 1}`,
    constraintId: constraint.id,
    operation: index < probes.length
      ? { kind: 'appendText', target, preconditionSha256, content: `\n${probes[index]}\n` }
      : { kind: 'createFile', target: files[index - probes.length], preconditionSha256: null, content: 'Inert source-mutation fixture.\n' },
    expectedEvidencePath: index < probes.length ? target : files[index - probes.length],
    allowedCollateralConstraints: [],
  })),
};
const output = '.blueprints/skill-standard.teeth-mutations.json';
const bytes = JSON.stringify(manifest, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf8') !== bytes) throw new Error('skill-standard mutation manifest is stale');
} else writeFileSync(output, bytes);
console.log(`Skill-standard source mutations: ${manifest.cases.length} mapped`);
