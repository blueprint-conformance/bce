#!/usr/bin/env node
/** Generate the digest-preconditioned per-constraint source mutation map for BCE's own blueprint. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const blueprintPath = resolve(root, '.blueprints', 'engine.blueprint.json');
const outputPath = resolve(root, '.blueprints', 'engine.teeth-mutations.json');
const blueprint = JSON.parse(readFileSync(blueprintPath, 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

function appendCase(constraint, target, content, allowedCollateralConstraints = []) {
  return {
    id: `source-mutant-${constraint.id}`,
    constraintId: constraint.id,
    operation: {
      kind: 'appendText',
      target,
      preconditionSha256: sha(readFileSync(resolve(root, target))),
      content,
    },
    expectedEvidencePath: target,
    allowedCollateralConstraints,
  };
}

const cases = blueprint.constraints.map((constraint) => {
  if (constraint.id === 'only-extractors-may-import-ts-morph') {
    return appendCase(constraint, 'src/cli.ts', "\nimport { Project as __BceMutationProject } from 'ts-morph';\n");
  }
  if (constraint.id === 'runtime-dep-allowlist-zod-and-ts-morph') {
    return appendCase(constraint, 'src/cli.ts', "\nimport __bceMutationRuntimeDependency from 'ajv';\n");
  }
  if (constraint.id === 'schema-imports-only-zod-and-safe-regex') {
    return appendCase(constraint, 'src/schema.ts', "\nimport __bceMutationSchemaDependency from 'ajv';\n", ['runtime-dep-allowlist-zod-and-ts-morph']);
  }
  if (constraint.id === 'evaluator-pure--report-imports-only-crypto-and-relative') {
    return appendCase(constraint, 'src/report.ts', "\nimport __bceMutationReportDependency from 'ajv';\n", ['runtime-dep-allowlist-zod-and-ts-morph']);
  }
  if (constraint.id === 'evaluator-pure--score-imports-relative-only') {
    return appendCase(constraint, 'src/score.ts', "\nimport { randomBytes as __bceMutationRandomBytes } from 'node:crypto';\n");
  }
  if (constraint.id === 'evaluator-pure--teeth-imports-relative-only') {
    return appendCase(constraint, 'src/teeth.ts', "\nimport { randomBytes as __bceMutationRandomBytes } from 'node:crypto';\n");
  }
  if (constraint.id.startsWith('only-cli-may-call-process-exit--') && constraint.type === 'forbiddenPattern' && constraint.path) {
    return appendCase(constraint, constraint.path, '\nexport function __bceExtractorTeethMutationProbe(): void { process.exit(99); }\n');
  }
  throw new Error(`no real source mutation is defined for ${constraint.id}/${constraint.type}`);
}).sort((a, b) => a.constraintId.localeCompare(b.constraintId));

const manifest = {
  schemaVersion: '1',
  blueprintRef: `${blueprint.metadata.id}@${blueprint.metadata.version}`,
  allowedMutationRoots: ['src'],
  cases,
};
const expected = `${JSON.stringify(manifest, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const actual = readFileSync(outputPath, 'utf8');
  if (actual !== expected) {
    process.stderr.write('self-teeth mutation manifest is stale; run npm run generate:self-teeth-mutations\n');
    process.exit(1);
  }
  process.stdout.write(`self-teeth mutation manifest fresh: ${cases.length}/${blueprint.constraints.length} mappings\n`);
} else {
  writeFileSync(outputPath, expected);
  process.stdout.write(`wrote ${outputPath} with ${cases.length} real source mutations\n`);
}
