#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg >= 0 ? process.argv[rootArg + 1] ?? '' : '.');
const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));
const failures = [];
const requireText = (path, text, label) => {
  if (!read(path).includes(text)) failures.push(`${label}: ${path} is missing ${JSON.stringify(text)}`);
};

const state = json('release-state.json');
const packageJson = json('package.json');
const shrinkwrap = json('npm-shrinkwrap.json');
const enginePin = json('.engine-pin.json');
if (state.schemaVersion !== '2') failures.push('release-state.json has an unsupported schemaVersion');
const packageVersion = state.candidateVersion ?? state.currentVersion;
const parseExactVersion = (value) => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value ?? '');
  return match ? match.slice(1).map(Number) : null;
};
const compareVersions = (left, right) => {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
};
if (packageJson.version !== packageVersion) failures.push('package version differs from release candidate');
if (shrinkwrap.version !== packageVersion || shrinkwrap.packages?.['']?.version !== packageVersion) {
  failures.push('shrinkwrap version differs from release candidate');
}
if (enginePin.pin !== state.currentVersion || enginePin.published !== true) failures.push('Lane-A pin differs from the released version');
if (state.releaseTag !== `v${state.currentVersion}`) failures.push('releaseTag does not match currentVersion');
const releasedVersion = parseExactVersion(state.currentVersion);
if (!releasedVersion) failures.push('currentVersion is not an exact x.y.z version');
if (state.candidateVersion !== undefined && state.candidateVersion !== null) {
  const candidateVersion = parseExactVersion(state.candidateVersion);
  if (!candidateVersion) failures.push('candidateVersion is not an exact x.y.z version');
  else if (releasedVersion && compareVersions(candidateVersion, releasedVersion) <= 0) {
    failures.push('candidateVersion must be newer than the released version');
  }
  requireText('README.md', `npm view bce-engine@${state.candidateVersion} version dist.integrity`, 'candidate registry preflight');
  requireText('README.md', `registry release: v${state.currentVersion}`, 'published/candidate distinction');
}
if (!/^[0-9a-f]{40}$/.test(state.actionCommit)) failures.push('actionCommit is not a full commit SHA');

if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(state.npmIntegrity ?? '')) {
  failures.push('npmIntegrity is not an exact sha512 Subresource Integrity value');
}
if (!/^[0-9a-f]{40}$/.test(state.npmShasum ?? '')) failures.push('npmShasum is not a full SHA-1 digest');
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(state.publishedAt ?? '')) {
  failures.push('publishedAt is not an exact UTC registry timestamp');
}
if (enginePin.integrity !== state.npmIntegrity) failures.push('Lane-A integrity differs from release state');
if (enginePin.shasum !== state.npmShasum) failures.push('Lane-A shasum differs from release state');
if (enginePin.sourceCommit !== state.actionCommit) failures.push('Lane-A source commit differs from release state');
if (enginePin.provenanceRunUrl !== state.provenanceRunUrl) failures.push('Lane-A provenance run differs from release state');
if (enginePin.evidenceReleaseUrl !== state.evidenceReleaseUrl) failures.push('Lane-A evidence release differs from release state');
if (state.canonicalReleaseUrl !== `https://github.com/blueprint-conformance/bce/releases/tag/${state.releaseTag}`) {
  failures.push('canonical release URL does not match releaseTag');
}
if (!/^https:\/\/github\.com\/blueprint-conformance\/bce\/actions\/runs\/\d+\/attempts\/\d+$/.test(state.provenanceRunUrl ?? '')) {
  failures.push('provenance run URL is not an exact workflow attempt');
}
if (!/^https:\/\/github\.com\/blueprint-conformance\/bce\/releases\/tag\/.+/.test(state.evidenceReleaseUrl ?? '')) {
  failures.push('evidence release URL is not an exact repository release');
}
for (const field of ['evidenceRecordSha256', 'sigstoreBundleSha256', 'complianceReportSha256']) {
  if (!/^[0-9a-f]{64}$/.test(state[field] ?? '')) failures.push(`${field} is not a full SHA-256 digest`);
}
if (!Array.isArray(state.requiredStatusChecks) || state.requiredStatusChecks.length !== 7 ||
    new Set(state.requiredStatusChecks).size !== 7) {
  failures.push('requiredStatusChecks must name seven unique branch-protection contexts');
} else {
  for (const path of [
    'STATUS.md',
    'docs/governance-enforcement.md',
    'docs/launch/public-flip-checklist.md',
    'docs/launch/show-hn-draft.md',
  ]) {
    for (const context of state.requiredStatusChecks) requireText(path, context, 'required context inventory');
  }
}

for (const path of ['README.md', 'STATUS.md', 'docs/onboarding.md']) {
  requireText(path, state.actionCommit, 'immutable Action source');
}
if (state.githubReleaseImmutable === false) {
  requireText('STATUS.md', 'historical tag mutable', 'historical release immutability');
  requireText('README.md', 'historical tag is mutable', 'historical release immutability');
} else if (state.githubReleaseImmutable === true) {
  requireText('STATUS.md', '| Git tag / GitHub Release | Released, immutable |', 'current release immutability');
  requireText('README.md', 'Release is immutable', 'current release immutability');
} else {
  failures.push('githubReleaseImmutable must be a boolean');
}
if (state.repositoryImmutableReleasesEnabled === true) {
  if (state.githubReleaseImmutable !== true) {
    requireText('README.md', 'repository-level release immutability now', 'future release immutability');
  }
}

const releaseRecord = `docs/release-v${state.currentVersion}.md`;
if (!existsSync(join(root, releaseRecord))) {
  failures.push(`release verification record is missing: ${releaseRecord}`);
} else {
  for (const value of [
    state.npmIntegrity,
    state.npmShasum,
    state.actionCommit,
    state.provenanceRunUrl,
    state.canonicalReleaseUrl,
    state.evidenceReleaseUrl,
    state.evidenceRecordSha256,
    state.sigstoreBundleSha256,
    state.complianceReportSha256,
  ]) {
    requireText(releaseRecord, value, 'release verification identity');
  }
  requireText(releaseRecord, 'It is not independent adoption', 'release evidence firewall');
  if (state.evidenceReleaseUrl !== state.canonicalReleaseUrl) {
    requireText(releaseRecord, 'intentionally has no assets', 'supplemental evidence recovery disclosure');
  }
}

const attestation = /^>\s*\*\*Count:\s*(\d+)\.\*\*/m.exec(read('ATTESTATIONS.md'));
if (!attestation) failures.push('ATTESTATIONS.md has no machine-readable count headline');
else if (Number(attestation[1]) !== state.independentWitnesses) failures.push('independent witness count differs from ATTESTATIONS.md');
if (state.independentWitnesses === 0) {
  requireText('STATUS.md', 'No independent user witness', 'independence claim');
  const claim = json('research/claim-evidence-matrix.json').claims.find((item) => item.claim === 'BCE governance is independently enforced on GitHub');
  if (claim?.status !== 'unestablished') failures.push('independent governance claim must remain unestablished');
}
if (state.independentReview === 'unestablished-solo-maintainer') {
  if (state.requiredApprovingReviews !== 0 || state.codeOwnerReviewConfigured !== false ||
      state.releaseEnvironmentReviewerConfigured !== false || state.releaseEnvironmentPreventSelfReview !== false) {
    failures.push('solo-maintainer review state must not claim unavailable human controls');
  }
  requireText('STATUS.md', 'Independent review is not claimed', 'review independence boundary');
  requireText('docs/governance-enforcement.md', 'operable solo-safe state', 'solo-safe review boundary');
}

if (state.gitlabSupport === 'unsupported') {
  requireText('integrations/gitlab-ci.yml', 'SUPPORT STATUS: UNSUPPORTED REFERENCE TEMPLATE', 'GitLab support state');
  requireText('integrations/gitlab-ci.yml', `BCE_VERSION="${state.currentVersion}"`, 'GitLab exact engine pin');
  requireText('STATUS.md', '| GitLab template | Unsupported reference |', 'GitLab support state');
}
if (read('integrations/gitlab-ci.yml').includes('VERSION_NOT_PUBLISHED')) failures.push('GitLab template retains a pre-release marker');
if (state.listingStatus === 'unsubmitted') {
  requireText('docs/launch/skill-listing-drafts.md', 'STAGED, NOT SUBMITTED', 'listing state');
}
if (state.openaiPluginStatus === 'unsubmitted') {
  requireText('docs/launch/openai-plugin-submission.md', 'UNSUBMITTED', 'OpenAI plugin state');
  requireText('docs/launch/openai-plugin-submission.md', 'skills-only', 'OpenAI plugin architecture');
}
if (state.schemasPublished === true && /Published schema URLs[\s\S]{0,180}(future|go live)/i.test(read('ROADMAP.md'))) {
  failures.push('ROADMAP.md still describes published schemas as future');
}
for (const stale of ['first public npm publish', 'not happened yet']) {
  if (read('ROADMAP.md').includes(stale)) failures.push(`ROADMAP.md retains stale release phrase ${JSON.stringify(stale)}`);
}

function scan(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path).sort()) scan(join(path, entry));
    return;
  }
  if (!/\.(?:md|ts|js|mjs|ya?ml)$/i.test(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (/uses:\s+blueprint-conformance\/bce@v\d/.test(lines[index])) {
      failures.push(`${relative(root, path)}:${index + 1}: executable BCE Action reference uses a mutable tag`);
    }
  }
}
for (const path of ['README.md', 'STATUS.md', 'docs', 'src']) scan(join(root, path));

if (failures.length > 0) {
  process.stderr.write(`release-claim-policy: FAIL (${failures.length})\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}
const candidate = state.candidateVersion ? `; candidate v${state.candidateVersion}` : '';
process.stdout.write(`release-claim-policy: PASS (released v${state.currentVersion}${candidate}; action ${state.actionCommit}; witnesses ${state.independentWitnesses}; GitLab ${state.gitlabSupport})\n`);
