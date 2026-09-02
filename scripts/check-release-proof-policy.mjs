#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflowArg = process.argv.indexOf('--workflow');
const workflow = resolve(workflowArg >= 0 ? process.argv[workflowArg + 1] ?? '' : '.github/workflows/release.yml');
const text = readFileSync(workflow, 'utf8');
const gateStart = text.indexOf('\n  gate:\n');
const publishStart = text.indexOf('\n  publish:\n');

if (gateStart < 0 || publishStart < 0 || publishStart <= gateStart) {
  process.stderr.write('release-proof-policy: FAIL — could not isolate gate and publish jobs\n');
  process.exit(1);
}

const gate = text.slice(gateStart, publishStart);
const publish = text.slice(publishStart);
const requirements = [
  ['full test suite', /^\s*run:\s*npm test\s*$/m],
  ['fresh-consumer onboarding proof', /^\s*run:\s*npm run test:onboarding\s*$/m],
  ['deterministic Agent Skills + MCP adoption proof', /^\s*run:\s*npm run test:ai-adoption\s*$/m],
  ['independent adoption denominator policy', /^\s*run:\s*npm run test:adoption-program\s*$/m],
];
const missing = requirements.filter(([, pattern]) => !pattern.test(gate)).map(([name]) => name);

const signingRequirements = [
  ['publish job OIDC permission', /^\s*id-token:\s*write\b/m],
  ['Sigstore evidence attestation', /@sigstore\/cli\/bin\/run attest[\s\\]*\n\s*release-evidence-record\.json/],
  ['Sigstore issuer constraint', /--certificate-issuer https:\/\/token\.actions\.githubusercontent\.com/],
  ['Sigstore workflow identity constraint', /--certificate-identity-uri "\$identity"/],
  ['Sigstore bundle release asset', /^\s*release-evidence-record\.sigstore \\/m],
];
missing.push(...signingRequirements.filter(([, pattern]) => !pattern.test(publish)).map(([name]) => name));

if (missing.length > 0) {
  process.stderr.write(`release-proof-policy: FAIL — release gate omits ${missing.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write('release-proof-policy: PASS (proofs rerun; evidence keyless-signed with issuer and workflow identity constraints)\n');
