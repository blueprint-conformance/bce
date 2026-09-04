#!/usr/bin/env node
/**
 * check-pages-publish-inputs.mjs — keep the Pages trigger honest about what it deploys.
 *
 * publish-schemas.yml assembles the complete documentation site, but its historical trigger
 * watched only schema files. A README, docs, trust-ledger, renderer, or referenced-asset change
 * could therefore merge green while Pages kept serving an older tree. This zero-dependency check
 * binds every source class consumed by build-docs-site.mjs to the publisher's push.paths filter.
 *
 * Exit 0: every required input class is present.
 * Exit 1: at least one input class cannot trigger the publisher.
 * Exit 2: the workflow cannot be read or its paths block cannot be identified.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const workflowPath = path.join(repoRoot, '.github', 'workflows', 'publish-schemas.yml');

export const REQUIRED_PAGES_INPUTS = [
  'README.md',
  'docs/**',
  'spec/**',
  'rfcs/**',
  'prompts/**',
  'integrations/**',
  'skills/README.md',
  'llms.txt',
  'assets/**',
  'ATTESTATIONS.md',
  'CITATION.cff',
  'scripts/build-docs-site.mjs',
  'scripts/gen-fleet-evidence.mjs',
  'evidence/fleet/**',
  '.github/workflows/publish-schemas.yml',
];

/** Extract the single on.push.paths list using its deliberate six-space item indentation. */
export function publishPaths(workflow) {
  const lines = workflow.replace(/\r\n/g, '\n').split('\n');
  const pathsLine = lines.findIndex((line, index) =>
    line === '    paths:' && lines.slice(Math.max(0, index - 3), index).includes('  push:'),
  );
  if (pathsLine < 0) throw new Error('on.push.paths block not found');

  const out = [];
  for (let index = pathsLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const item = /^      - ['"]([^'"]+)['"]$/.exec(line);
    if (item) {
      out.push(item[1]);
      continue;
    }
    if (!line.startsWith('      ')) break;
    throw new Error(`unrecognized on.push.paths entry at line ${index + 1}: ${line.trim()}`);
  }
  if (out.length === 0) throw new Error('on.push.paths contains no entries');
  return out;
}

export function missingPagesInputs(workflow) {
  const declared = new Set(publishPaths(workflow));
  return REQUIRED_PAGES_INPUTS.filter((input) => !declared.has(input));
}

function main() {
  if (!existsSync(workflowPath)) {
    console.error('pages-publish-inputs: REFUSED — .github/workflows/publish-schemas.yml is missing.');
    process.exit(2);
  }

  let missing;
  try {
    missing = missingPagesInputs(readFileSync(workflowPath, 'utf8'));
  } catch (error) {
    console.error(`pages-publish-inputs: REFUSED — ${error.message}`);
    process.exit(2);
  }

  if (missing.length > 0) {
    console.error(`pages-publish-inputs: FAIL — ${missing.length} site input(s) cannot trigger deployment:`);
    for (const input of missing) console.error(`  - ${input}`);
    process.exit(1);
  }

  console.log(`pages-publish-inputs: PASS — all ${REQUIRED_PAGES_INPUTS.length} site input classes trigger deployment.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
