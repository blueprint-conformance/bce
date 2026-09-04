#!/usr/bin/env node
/** Prove every required Pages input is load-bearing in the trigger check. */
import { readFileSync } from 'node:fs';
import {
  REQUIRED_PAGES_INPUTS,
  missingPagesInputs,
  workflowPath,
} from './check-pages-publish-inputs.mjs';

const workflow = readFileSync(workflowPath, 'utf8');
const clean = missingPagesInputs(workflow);
if (clean.length > 0) {
  console.error(`pages-publish-inputs self-test: harness workflow already misses ${clean.join(', ')}`);
  process.exit(2);
}

for (const input of REQUIRED_PAGES_INPUTS) {
  const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const planted = workflow.replace(new RegExp(`^      - ['"]${escaped}['"]\\n`, 'm'), '');
  if (planted === workflow) {
    console.error(`pages-publish-inputs self-test: could not plant missing trigger ${input}`);
    process.exit(2);
  }
  const missing = missingPagesInputs(planted);
  if (missing.length !== 1 || missing[0] !== input) {
    console.error(`pages-publish-inputs self-test: removing ${input} reported ${missing.join(', ') || 'nothing'}`);
    process.exit(1);
  }
}

console.log(`pages-publish-inputs self-test: PASS — all ${REQUIRED_PAGES_INPUTS.length} trigger classes refuse when removed.`);
