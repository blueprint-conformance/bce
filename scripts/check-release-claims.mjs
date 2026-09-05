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

for (const path of ['README.md', 'STATUS.md', 'docs/onboarding.md']) {
  requireText(path, state.actionCommit, 'immutable Action source');
}
if (state.githubReleaseImmutable === false) {
  requireText('STATUS.md', 'historical tag mutable', 'historical release immutability');
  requireText('README.md', 'historical tag is mutable', 'historical release immutability');
}
if (state.repositoryImmutableReleasesEnabled === true) {
  requireText('README.md', 'repository-level release immutability now', 'future release immutability');
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
