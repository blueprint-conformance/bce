#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

function readJson(path, label, failures) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    failures.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function validateLabelCatalog(raw) {
  const failures = [];
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.labels)) {
    return ['.github/labels.json must have schemaVersion 1 and a labels array'];
  }
  const seen = new Set();
  for (const [index, label] of raw.labels.entries()) {
    const at = `.github/labels.json labels[${index}]`;
    if (!label || typeof label.name !== 'string' || label.name.trim() !== label.name || label.name.length === 0) {
      failures.push(`${at}.name must be a non-empty trimmed string`);
      continue;
    }
    const key = label.name.toLowerCase();
    if (seen.has(key)) failures.push(`${at}.name duplicates '${label.name}'`);
    seen.add(key);
    if (typeof label.color !== 'string' || !/^[0-9a-f]{6}$/i.test(label.color)) {
      failures.push(`${at}.color must be six hexadecimal characters without '#'`);
    }
    if (typeof label.description !== 'string' || label.description.trim().length < 8) {
      failures.push(`${at}.description must explain the label in at least 8 characters`);
    }
  }
  return failures;
}

function issueFormLabels(path, displayPath, failures) {
  const text = readFileSync(path, 'utf8');
  const match = /^labels:\s*(\[[^\n]+\])\s*$/m.exec(text);
  if (!match) {
    failures.push(`${displayPath} must declare one inline labels array`);
    return [];
  }
  try {
    const labels = JSON.parse(match[1]);
    if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string')) throw new Error('not a string array');
    return labels;
  } catch (error) {
    failures.push(`${displayPath} labels must be a JSON-compatible string array: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

function dependabotLabels(path, displayPath, failures) {
  const text = readFileSync(path, 'utf8');
  const labels = [];
  const blocks = [...text.matchAll(/^\s{4}labels:\s*\n((?:\s{6}-\s+[^\n]+\n?)+)/gm)];
  if (blocks.length === 0) failures.push(`${displayPath} has no update labels to verify`);
  for (const block of blocks) {
    for (const line of block[1].split(/\r?\n/)) {
      const match = /^\s*-\s+["']?([^"'\s][^"']*?)["']?\s*$/.exec(line);
      if (match) labels.push(match[1].trim());
    }
  }
  return labels;
}

export function findMissingLabels(catalogNames, referencedLabels) {
  const known = new Set([...catalogNames].map((name) => name.toLowerCase()));
  return [...new Set(referencedLabels)].filter((name) => !known.has(name.toLowerCase())).sort();
}

export function inspectContributorOperations(root = DEFAULT_ROOT) {
  const failures = [];
  const labelPath = join(root, '.github', 'labels.json');
  const policyPath = join(root, '.github', 'triage-policy.json');
  const issueTemplateDir = join(root, '.github', 'ISSUE_TEMPLATE');
  const dependabotPath = join(root, '.github', 'dependabot.yml');
  const prTemplatePath = join(root, '.github', 'PULL_REQUEST_TEMPLATE.md');
  const workflowPath = join(root, '.github', 'workflows', 'maintainer-operations.yml');

  const catalog = readJson(labelPath, '.github/labels.json', failures);
  failures.push(...validateLabelCatalog(catalog));
  const catalogNames = new Set(Array.isArray(catalog?.labels) ? catalog.labels.map((label) => label.name) : []);

  const policy = readJson(policyPath, '.github/triage-policy.json', failures);
  if (!policy || policy.schemaVersion !== 1) failures.push('.github/triage-policy.json must have schemaVersion 1');
  if (!Number.isInteger(policy?.maxFirstResponseHours) || policy.maxFirstResponseHours < 1) {
    failures.push('triage policy maxFirstResponseHours must be a positive integer');
  }
  if (!Array.isArray(policy?.maintainerActorIds) || policy.maintainerActorIds.length === 0 ||
      policy.maintainerActorIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    failures.push('triage policy must bind at least one positive GitHub maintainer actor ID');
  }
  if (!Number.isFinite(Date.parse(policy?.effectiveFrom ?? ''))) {
    failures.push('triage policy effectiveFrom must be an ISO-8601 timestamp');
  }
  if (typeof policy?.responseDefinition !== 'string' || !policy.responseDefinition.includes('public issue comment')) {
    failures.push('triage policy must state the public-response definition');
  }

  const referenced = [];
  if (!existsSync(issueTemplateDir)) {
    failures.push('.github/ISSUE_TEMPLATE is missing');
  } else {
    for (const name of readdirSync(issueTemplateDir).filter((entry) => /\.ya?ml$/i.test(entry) && entry !== 'config.yml').sort()) {
      const path = join(issueTemplateDir, name);
      const displayPath = relative(root, path);
      const labels = issueFormLabels(path, displayPath, failures);
      referenced.push(...labels);
      if (!labels.includes(policy?.queueLabels?.new)) {
        failures.push(`${displayPath} must enter the declared new-item queue '${policy?.queueLabels?.new ?? '<missing>'}'`);
      }
    }
  }
  if (existsSync(dependabotPath)) referenced.push(...dependabotLabels(dependabotPath, relative(root, dependabotPath), failures));
  else failures.push('.github/dependabot.yml is missing');
  if (policy?.queueLabels && typeof policy.queueLabels === 'object') referenced.push(...Object.values(policy.queueLabels));

  const missing = findMissingLabels(catalogNames, referenced);
  for (const label of missing) failures.push(`referenced label '${label}' is absent from .github/labels.json`);

  if (!existsSync(prTemplatePath)) {
    failures.push('.github/PULL_REQUEST_TEMPLATE.md is missing');
  } else {
    const template = readFileSync(prTemplatePath, 'utf8');
    for (const heading of ['## Summary', '## Change class', '## Verification', '## Public claims and limits', '## Contribution declaration']) {
      if (!template.includes(heading)) failures.push(`pull-request template is missing '${heading}'`);
    }
    if (!template.includes('do not claim independent review')) {
      failures.push('pull-request template must preserve the solo-maintainer review boundary');
    }
  }

  if (!existsSync(workflowPath)) {
    failures.push('.github/workflows/maintainer-operations.yml is missing');
  } else {
    const workflow = readFileSync(workflowPath, 'utf8');
    for (const marker of [
      'schedule:',
      'workflow_dispatch:',
      'contents: read',
      'issues: read',
      'pull-requests: read',
      'node scripts/verify-contributor-operations.mjs --live',
      'node scripts/triage-slo.mjs',
    ]) {
      if (!workflow.includes(marker)) failures.push(`maintainer-operations workflow is missing '${marker}'`);
    }
    if (/\b(?:contents|issues|pull-requests|actions):\s*write\b/.test(workflow)) {
      failures.push('maintainer-operations workflow must remain read-only');
    }
    if (/^  pull_request:\s*$/m.test(workflow)) {
      failures.push('maintainer-operations must not attach unrelated queue debt to every pull request');
    }
  }

  return { failures, catalog, referencedLabels: [...new Set(referenced)].sort() };
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'bce-contributor-operations-audit',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

async function verifyLiveLabels(catalog, repository, token) {
  const live = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`/repos/${repository}/labels?per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error('GitHub labels response is not an array');
    live.push(...batch);
    if (batch.length < 100) break;
  }
  const byName = new Map(live.map((label) => [String(label.name).toLowerCase(), label]));
  const failures = [];
  for (const expected of catalog.labels) {
    const actual = byName.get(expected.name.toLowerCase());
    if (!actual) {
      failures.push(`live label '${expected.name}' is missing`);
      continue;
    }
    if (String(actual.color).toLowerCase() !== expected.color.toLowerCase()) {
      failures.push(`live label '${expected.name}' color is ${actual.color}, expected ${expected.color}`);
    }
    if (String(actual.description ?? '') !== expected.description) {
      failures.push(`live label '${expected.name}' description differs from .github/labels.json`);
    }
  }
  return failures;
}

async function main() {
  const argv = process.argv.slice(2);
  const rootAt = argv.indexOf('--root');
  const root = resolve(rootAt >= 0 ? argv[rootAt + 1] ?? '' : DEFAULT_ROOT);
  const result = inspectContributorOperations(root);
  if (argv.includes('--live') && result.failures.length === 0) {
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY;
    if (!token || !repository) {
      result.failures.push('--live requires GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY');
    } else {
      result.failures.push(...await verifyLiveLabels(result.catalog, repository, token));
    }
  }
  if (result.failures.length > 0) {
    process.stderr.write(`contributor-operations: FAIL (${result.failures.length})\n${result.failures.map((failure) => `- ${failure}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `contributor-operations: PASS (${result.catalog.labels.length} canonical labels; ` +
      `${result.referencedLabels.length} referenced by live intake)${argv.includes('--live') ? '; live labels match' : ''}\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`contributor-operations: REFUSED — ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}
