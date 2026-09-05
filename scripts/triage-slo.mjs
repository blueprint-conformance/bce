#!/usr/bin/env node

import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY = join(HERE, '..', '.github', 'triage-policy.json');

// Numeric GitHub actor IDs survive login renames and let the policy bind a person without treating
// a mutable display handle as identity. This process has read-only inputs and never mutates GitHub.

export function parseTriagePolicy(raw) {
  if (!raw || raw.schemaVersion !== 1) throw new Error('triage policy must have schemaVersion 1');
  if (!Number.isFinite(Date.parse(raw.effectiveFrom))) throw new Error('triage policy effectiveFrom must be an ISO-8601 timestamp');
  if (!Number.isInteger(raw.maxFirstResponseHours) || raw.maxFirstResponseHours < 1) {
    throw new Error('triage policy maxFirstResponseHours must be a positive integer');
  }
  if (!Array.isArray(raw.maintainerActorIds) || raw.maintainerActorIds.length === 0 ||
      raw.maintainerActorIds.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('triage policy must bind at least one positive maintainer actor ID');
  }
  return {
    ...raw,
    maintainerActorIds: [...new Set(raw.maintainerActorIds)],
  };
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} is not a valid timestamp`);
  return parsed;
}

export function evaluateTriageSlo(policyInput, items, nowInput = new Date()) {
  const policy = parseTriagePolicy(policyInput);
  const now = nowInput instanceof Date ? nowInput.getTime() : timestamp(nowInput, 'now');
  if (!Number.isFinite(now)) throw new Error('now is not a valid timestamp');
  const effective = timestamp(policy.effectiveFrom, 'effectiveFrom');
  const maintainers = new Set(policy.maintainerActorIds);
  const result = { onTime: [], pending: [], overdue: [], late: [], ignored: [] };

  for (const item of items) {
    const created = timestamp(item.createdAt, `#${item.number} createdAt`);
    if (created < effective || maintainers.has(item.authorId)) {
      result.ignored.push(item);
      continue;
    }
    const due = created + policy.maxFirstResponseHours * 60 * 60 * 1000;
    const responses = [...(item.comments ?? []), ...(item.reviews ?? [])]
      .filter((response) => maintainers.has(response.authorId))
      .map((response) => ({ ...response, at: timestamp(response.createdAt, `#${item.number} response`) }))
      .filter((response) => response.at >= created)
      .sort((left, right) => left.at - right.at);
    const first = responses[0];
    const record = {
      ...item,
      dueAt: new Date(due).toISOString(),
      firstResponseAt: first ? new Date(first.at).toISOString() : undefined,
      responseHours: first ? Number(((first.at - created) / 3_600_000).toFixed(2)) : undefined,
    };
    if (first && first.at <= due) result.onTime.push(record);
    // A late response stops being actionable overdue debt, but is never rewritten as on-time. The
    // workflow warning plus the public thread timestamps preserve the miss.
    else if (first) result.late.push(record);
    else if (now > due) result.overdue.push(record);
    else result.pending.push(record);
  }
  return result;
}

export function renderTriageResult(result, policy) {
  const lines = [
    `triage-slo: ${result.overdue.length === 0 ? 'PASS' : 'FAIL'} — ` +
      `${result.overdue.length} overdue, ${result.late.length} late, ${result.pending.length} within window, ` +
      `${result.onTime.length} on time (${policy.maxFirstResponseHours}h first-response budget)`,
  ];
  for (const item of result.overdue) lines.push(`OVERDUE ${item.kind} #${item.number}: ${item.url} (due ${item.dueAt})`);
  for (const item of result.late) lines.push(`LATE ${item.kind} #${item.number}: first response after ${item.responseHours}h — ${item.url}`);
  for (const item of result.pending) lines.push(`PENDING ${item.kind} #${item.number}: due ${item.dueAt} — ${item.url}`);
  return `${lines.join('\n')}\n`;
}

async function githubResponse(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'bce-triage-slo-audit',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

async function githubList(path, token) {
  const rows = [];
  for (let page = 1; ; page += 1) {
    const joiner = path.includes('?') ? '&' : '?';
    const batch = await githubResponse(`${path}${joiner}per_page=100&page=${page}`, token);
    if (!Array.isArray(batch)) throw new Error(`GitHub API list for ${path} is not an array`);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

async function collectLiveItems(repository, token, policy) {
  const since = encodeURIComponent(policy.effectiveFrom);
  const issues = await githubList(`/repos/${repository}/issues?state=all&sort=created&direction=asc&since=${since}`, token);
  const maintainers = new Set(policy.maintainerActorIds);
  const relevant = issues.filter((issue) => {
    const created = Date.parse(issue.created_at);
    return created >= Date.parse(policy.effectiveFrom) && !maintainers.has(issue.user?.id);
  });
  const items = [];
  for (const issue of relevant) {
    const comments = issue.comments > 0
      ? await githubList(`/repos/${repository}/issues/${issue.number}/comments`, token)
      : [];
    const reviews = issue.pull_request
      ? await githubList(`/repos/${repository}/pulls/${issue.number}/reviews`, token)
      : [];
    items.push({
      number: issue.number,
      kind: issue.pull_request ? 'pull request' : 'issue',
      title: issue.title,
      url: issue.html_url,
      authorId: issue.user?.id,
      createdAt: issue.created_at,
      comments: comments.map((comment) => ({ authorId: comment.user?.id, createdAt: comment.created_at })),
      reviews: reviews
        .filter((review) => review.submitted_at)
        .map((review) => ({ authorId: review.user?.id, createdAt: review.submitted_at })),
    });
  }
  return items;
}

async function main() {
  const argv = process.argv.slice(2);
  const policyAt = argv.indexOf('--policy');
  const policyPath = resolve(policyAt >= 0 ? argv[policyAt + 1] ?? '' : DEFAULT_POLICY);
  const policy = parseTriagePolicy(JSON.parse(readFileSync(policyPath, 'utf8')));
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) throw new Error('GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY are required');
  const items = await collectLiveItems(repository, token, policy);
  const result = evaluateTriageSlo(policy, items, new Date());
  const output = renderTriageResult(result, policy);
  process.stdout.write(output);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Solo-maintainer triage SLO\n\n\`\`\`text\n${output}\`\`\`\n`);
  }
  for (const item of result.overdue) process.stderr.write(`::error title=Overdue contributor response::${item.url} was due ${item.dueAt}\n`);
  for (const item of result.late) process.stderr.write(`::warning title=Late contributor response::${item.url} received its first response after ${item.responseHours}h\n`);
  if (result.overdue.length > 0) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`triage-slo: REFUSED — ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  });
}
