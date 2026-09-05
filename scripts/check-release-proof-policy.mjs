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
  ['exact Corepack npm bootstrap', /corepack install --global npm@11\.19\.1/],
  ['temporary Corepack npm shim', /corepack enable npm --install-directory "\$npm_bin"/],
  ['Corepack latest-resolution disabled', /COREPACK_DEFAULT_TO_LATEST:\s*"0"/],
  ['full test suite', /^\s*run:\s*npm test\s*$/m],
  ['fresh-consumer onboarding proof', /^\s*run:\s*npm run test:onboarding\s*$/m],
  ['deterministic Agent Skills + MCP adoption proof', /^\s*run:\s*npm run test:ai-adoption\s*$/m],
  ['independent adoption denominator policy', /^\s*run:\s*npm run test:adoption-program\s*$/m],
  ['extractor-real self-blueprint source mutations', /npm run test:self-teeth-mutations/],
  ['canonical leakage scanner negative controls', /^\s*run:\s*bash scripts\/leakage-gate-selftest\.sh\s*$/m],
  ['single-source leakage scan', /^\s*run:\s*bash scripts\/leakage-scan\.sh \.\s*$/m],
  ['release payload boundary proof', /node scripts\/verify-release-payload\.selftest\.mjs && node scripts\/verify-release-payload\.mjs --out release-payload-manifest\.json/],
  ['current public registry proof', /^\s*run:\s*node scripts\/verify-public-release\.selftest\.mjs && node scripts\/verify-public-release\.mjs\s*$/m],
];
const missing = requirements.filter(([, pattern]) => !pattern.test(gate)).map(([name]) => name);

const signingRequirements = [
  ['publish exact Corepack npm bootstrap', /corepack install --global npm@11\.19\.1/],
  ['publish temporary Corepack npm shim', /corepack enable npm --install-directory "\$npm_bin"/],
  ['publish Corepack latest-resolution disabled', /COREPACK_DEFAULT_TO_LATEST:\s*"0"/],
  ['publish job OIDC permission', /^\s*id-token:\s*write\b/m],
  ['Sigstore evidence attestation', /@sigstore\/cli\/bin\/run attest[\s\\]*\n\s*release-evidence-record\.json/],
  ['Sigstore bundle release asset', /^\s*release-evidence-record\.sigstore \\/m],
  ['release payload manifest asset', /^\s*release-payload-manifest\.json \\/m],
  ['signed release payload manifest asset', /^\s*release-payload-manifest\.sigstore \\/m],
  ['exact published tarball release asset', /^\s*"\$RELEASE_TARBALL" \\/m],
  ['Sigstore payload-boundary attestation', /@sigstore\/cli\/bin\/run attest[\s\\]*\n\s*release-payload-manifest\.json/],
  ['single npm tarball creation', /npm pack --ignore-scripts --json --silent > release-pack-output\.txt/],
  ['canonical npm pack result parsing', /verify-release-payload\.mjs --pack-json release-pack-output\.txt --print-filename/],
  ['exact npm tarball verification', /verify-release-payload\.mjs[\s\\]*\n\s*--pack-json release-pack-output\.txt[\s\\]*\n\s*--tarball "\$tarball"[\s\\]*\n\s*--out release-payload-manifest\.json/],
  ['publish of the verified npm tarball', /npm publish "\$RELEASE_TARBALL" --provenance --access public/],
  ['draft Release created before asset staging', /gh release create "\$tag" --verify-tag --draft/],
  ['prepared Release assets are uploaded', /gh release upload "\$tag"[\s\S]*release-evidence-record\.json[\s\\]*\n[\s\S]*release-evidence-record\.sigstore[\s\\]*\n[\s\S]*release-compliance-report\.json[\s\\]*\n[\s\S]*release-payload-manifest\.json[\s\\]*\n[\s\S]*release-payload-manifest\.sigstore[\s\\]*\n[\s\S]*"\$RELEASE_TARBALL"/],
  ['GitHub Release finalizer job', /^  finalize-github-release:\s*$/m],
  ['GitHub Release finalizer depends only on successful npm publication', /^\s*needs:\s*publish\s*$/m],
  ['staged asset digests cross the job boundary', /EXPECTED_EVIDENCE_SHA256:\s*\$\{\{ needs\.publish\.outputs\.evidence_sha256 \}\}/],
  ['staged payload digests cross the job boundary', /EXPECTED_PAYLOAD_SHA256:\s*\$\{\{ needs\.publish\.outputs\.payload_sha256 \}\}/],
  ['staged tarball digest crosses the job boundary', /EXPECTED_TARBALL_SHA256:\s*\$\{\{ needs\.publish\.outputs\.tarball_sha256 \}\}/],
  ['staged tarball name crosses the job boundary', /EXPECTED_TARBALL_NAME:\s*\$\{\{ needs\.publish\.outputs\.tarball_name \}\}/],
  ['finalizer requires exact staged asset digests', /\.digest == \$digest/],
  ['finalizer validates the tarball asset name', /EXPECTED_TARBALL_NAME" =~ \^\[A-Za-z0-9\._-\]\+\\\.tgz\$/],
  ['finalizer safely retries an ambiguous publish response', /if \[ "\$is_draft" = "true" \]; then[\s\S]*gh release edit "\$tag" --draft=false --latest/],
  ['published Release immutability assertion', /gh api "repos\/\$\{GITHUB_REPOSITORY\}\/releases\/tags\/\$\{tag\}" --jq \.immutable/],
];
missing.push(...signingRequirements.filter(([, pattern]) => !pattern.test(publish)).map(([name]) => name));
if ((publish.match(/--certificate-issuer https:\/\/token\.actions\.githubusercontent\.com/g) ?? []).length < 2) {
  missing.push('Sigstore issuer constraints for evidence and payload');
}
if ((publish.match(/--certificate-identity-uri "\$identity"/g) ?? []).length < 2) {
  missing.push('Sigstore workflow identity constraints for evidence and payload');
}
if (/npm install (?:--global|-g) npm@/.test(text)) missing.push('in-place npm self-upgrade is forbidden');
if (/scan body begin|CRED_PATTERNS=\(|STEWARD_ALLOWLIST=\(/.test(gate)) {
  missing.push('release gate carries a divergent embedded leakage policy');
}

if (!/^  model-evaluation-controller-macos:\s*$/m.test(text) || !/^\s*run:\s*npm run test:model-eval-controller\s*$/m.test(text)) {
  missing.push('macOS real-controller rehearsal');
}
if (!/^\s*needs:\s*\[gate, model-evaluation-controller-macos\]\s*$/m.test(publish)) {
  missing.push('publish depends on macOS real-controller rehearsal');
}

const generateIndex = publish.indexOf('Generate the evidence record of THIS release gate-run before publish');
const verifyIndex = publish.indexOf('release evidence and payload-boundary signatures verify');
const stageIndex = publish.indexOf('Stage the evidence assets on a draft GitHub Release');
const npmPublishIndex = publish.indexOf('npm publish "$RELEASE_TARBALL" --provenance --access public\n');
const finalizerIndex = publish.indexOf('\n  finalize-github-release:\n');
const freezeIndex = publish.indexOf('gh release edit "$tag" --draft=false --latest');
if (
  [generateIndex, verifyIndex, stageIndex, npmPublishIndex, finalizerIndex, freezeIndex].some((index) => index < 0) ||
  !(generateIndex < verifyIndex && verifyIndex < stageIndex && stageIndex < npmPublishIndex && npmPublishIndex < finalizerIndex && finalizerIndex < freezeIndex)
) {
  missing.push('verified evidence and payload staged on a draft before exact-tarball npm publish and frozen only afterward');
}

if (missing.length > 0) {
  process.stderr.write(`release-proof-policy: FAIL — release gate omits ${missing.join(', ')}\n`);
  process.exit(1);
}

process.stdout.write('release-proof-policy: PASS (proofs rerun; canonical leakage and exact payload proven; evidence and payload staged on a draft; verified tarball published; prepared Release frozen afterward in a retry-isolated finalizer)\n');
