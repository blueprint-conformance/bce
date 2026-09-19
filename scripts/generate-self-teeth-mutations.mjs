#!/usr/bin/env node
/** Generate the digest-preconditioned per-constraint source mutation map for BCE's own blueprint. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
// Optional: `--blueprint <path> --out <path>` generates the manifest for a CANDIDATE blueprint
// (an amendment under review) without touching the installed policy.
const argValue = (flag) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
};
const blueprintPath = resolve(root, argValue('--blueprint') ?? '.blueprints/engine.blueprint.json');
const outputPath = resolve(root, argValue('--out') ?? '.blueprints/engine.teeth-mutations.json');
// A glob-path row covers a whole plane; its real source mutation needs ONE concrete file in it.
const STACK_PLANE_TARGET = 'src/stack/stack-extractor.ts';
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
  if (constraint.id === 'only-python-module-graph-may-import-lezer') {
    return appendCase(constraint, 'src/cli.ts', "\nimport { parser as __BceMutationParser } from '@lezer/python';\n");
  }
  if (constraint.id === 'runtime-dep-allowlist-approved-parsers') {
    return appendCase(constraint, 'src/cli.ts', "\nimport __bceMutationRuntimeDependency from 'ajv';\n");
  }
  if (constraint.id === 'schema-imports-only-zod-and-safe-regex') {
    return appendCase(constraint, 'src/schema.ts', "\nimport __bceMutationSchemaDependency from 'ajv';\n", ['runtime-dep-allowlist-approved-parsers']);
  }
  if (constraint.id === 'evaluator-pure--report-imports-only-crypto-and-relative') {
    return appendCase(constraint, 'src/report.ts', "\nimport __bceMutationReportDependency from 'ajv';\n", ['runtime-dep-allowlist-approved-parsers']);
  }
  if (constraint.id === 'evaluator-pure--score-imports-relative-only') {
    return appendCase(constraint, 'src/score.ts', "\nimport { randomBytes as __bceMutationRandomBytes } from 'node:crypto';\n");
  }
  if (constraint.id === 'evaluator-pure--teeth-imports-relative-only') {
    return appendCase(constraint, 'src/teeth.ts', "\nimport { randomBytes as __bceMutationRandomBytes } from 'node:crypto';\n");
  }
  if (constraint.id === 'review-core-no-io-imports') {
    return appendCase(constraint, 'src/review.ts', "\nimport * as __bceMutationFs from 'node:fs';\n");
  }
  if (constraint.id === 'only-cli-may-call-process-exit--stack') {
    return appendCase(constraint, STACK_PLANE_TARGET, '\nexport function __bceExtractorTeethMutationProbe(): void { process.exit(99); }\n');
  }
  if (constraint.id === 'stack-plane-no-network-no-subprocess') {
    return appendCase(constraint, STACK_PLANE_TARGET, "\nimport * as __bceMutationHttps from 'node:https';\n");
  }
  if (constraint.id === 'stack-plane-no-global-network-api') {
    return appendCase(constraint, STACK_PLANE_TARGET, "\nexport async function __bceMutationFetch(): Promise<unknown> { return fetch('https://example.invalid/'); }\n");
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
