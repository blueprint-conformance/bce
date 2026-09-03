/**
 * Authenticated SCM decision adapter.
 *
 * The deterministic review core accepts an already-authenticated reviewer identity. This I/O
 * boundary obtains that identity from GitHub's fixed REST origin; it never accepts reviewer,
 * rationale, timestamp, commit, or assertion digest from local CLI flags.
 */
import type { BlueprintDecisionRecord, BlueprintReviewPacket } from './review-contracts.js';
import { recordReviewDecision, reviewDigest } from './review.js';
import { stableStringify } from './report.js';

const GITHUB_API_ORIGIN = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const MAX_GITHUB_RESPONSE_BYTES = 1024 * 1024;
const GITHUB_TIMEOUT_MS = 10_000;

export interface GitHubReviewSelector {
  repository: string;
  pullRequest: number;
  reviewId: number;
}

interface GitHubReview {
  id?: unknown;
  user?: { login?: unknown; id?: unknown; type?: unknown } | null;
  body?: unknown;
  state?: unknown;
  html_url?: unknown;
  submitted_at?: unknown;
  commit_id?: unknown;
  author_association?: unknown;
  pull_request_url?: unknown;
}

interface GitHubPullRequest {
  state?: unknown;
  head?: { sha?: unknown } | null;
  user?: { id?: unknown } | null;
  base?: { ref?: unknown; sha?: unknown; repo?: { id?: unknown; full_name?: unknown } | null } | null;
}

interface GitHubPermission {
  permission?: unknown;
  user?: { login?: unknown; id?: unknown; type?: unknown } | null;
}

export interface AuthenticateGitHubDecisionInput {
  packet: BlueprintReviewPacket;
  decision: BlueprintDecisionRecord['decision'];
  selector: GitHubReviewSelector;
  token?: string;
  fetchImpl?: typeof fetch;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`);
  return value;
}

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GitHub repository must be owner/name');
  }
  return value;
}

async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_GITHUB_RESPONSE_BYTES) {
        await reader.cancel('GitHub review authentication response exceeds the 1 MiB limit');
        throw new Error('GitHub review authentication response exceeds the 1 MiB limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function githubJson(fetchImpl: typeof fetch, url: string, token: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': 'bce-engine-review-verifier',
      },
    });
    const declaredLength = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_GITHUB_RESPONSE_BYTES) {
      throw new Error('GitHub review authentication response exceeds the 1 MiB limit');
    }
    const bytes = await boundedResponseBytes(response);
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!response.ok) {
      const detail = body.slice(0, 512).replace(/[\u0000-\u001f\u007f]/g, ' ');
      throw new Error(`GitHub review authentication failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
    }
    try { return JSON.parse(body) as unknown; }
    catch { throw new Error('GitHub review authentication response is not valid UTF-8 JSON'); }
  } finally {
    clearTimeout(timer);
  }
}

function reviewRationale(
  body: string,
  packet: BlueprintReviewPacket,
  decision: BlueprintDecisionRecord['decision'],
): string {
  const expected = new Map([
    ['BCE-Review-Packet', `sha256:${packet.packetDigest}`],
    ['BCE-Candidate', `sha256:${packet.provenance.candidateDigest}`],
    ['BCE-Decision', decision],
  ]);
  const requirement = packet.approval.requirements.length === 1 ? packet.approval.requirements[0]! : null;
  if (decision === 'approve' && packet.approval.requirements.length > 1) {
    throw new Error('one GitHub review cannot satisfy multiple blueprint approval requirements');
  }
  if (decision === 'approve' && requirement) {
    expected.set('BCE-Approval-Role', requirement.role);
    expected.set('BCE-Approval-Stage', requirement.stage);
  }
  if (decision === 'approve' && packet.semanticDiff.classification === 'relaxation') {
    expected.set('BCE-Accept-Weakening', 'true');
  }
  const rationale: string[] = [];
  const seen = new Set<string>();
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^(BCE-[A-Za-z-]+):\s*(\S+)\s*$/.exec(line);
    if (!match) {
      rationale.push(line);
      continue;
    }
    const key = match[1]!;
    if (!expected.has(key)) throw new Error(`GitHub review contains unexpected ${key} binding`);
    if (seen.has(key)) throw new Error(`GitHub review contains duplicate ${key} binding`);
    seen.add(key);
    if (match[2] !== expected.get(key)) throw new Error(`GitHub review ${key} does not bind the requested packet and decision`);
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) throw new Error(`GitHub review is missing ${key}`);
  }
  const value = rationale.join('\n').trim();
  if (value.length < 20) throw new Error('GitHub review rationale must contain at least 20 characters outside BCE binding headers');
  return value;
}

/** Resolve a decision exclusively from a submitted GitHub pull-request review. */
export async function authenticateGitHubDecision(
  input: AuthenticateGitHubDecisionInput,
): Promise<BlueprintDecisionRecord> {
  const repository = repositoryName(input.selector.repository);
  const pullRequest = positiveInteger(input.selector.pullRequest, 'GitHub pull request number');
  const reviewId = positiveInteger(input.selector.reviewId, 'GitHub review id');
  const token = input.token ?? process.env.BCE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  if (!token) throw new Error('BCE_GITHUB_TOKEN or GITHUB_TOKEN is required to authenticate a GitHub review');
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('GitHub review authentication requires the Fetch API');

  const root = `${GITHUB_API_ORIGIN}/repos/${repository}/pulls/${pullRequest}`;
  const [reviewRaw, reviewsRaw, pullRaw] = await Promise.all([
    githubJson(fetchImpl, `${root}/reviews/${reviewId}`, token),
    githubJson(fetchImpl, `${root}/reviews?per_page=100`, token),
    githubJson(fetchImpl, root, token),
  ]);
  const review = reviewRaw as GitHubReview;
  if (!Array.isArray(reviewsRaw)) throw new Error('GitHub review list response is malformed');
  const pull = pullRaw as GitHubPullRequest;
  const expectedState = input.decision === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED';
  if (review.id !== reviewId) throw new Error('GitHub returned a different review id');
  if (review.state !== expectedState) {
    throw new Error(`GitHub review state must be ${expectedState} for decision ${input.decision}`);
  }
  if (pull.state !== 'open') throw new Error('GitHub pull request must still be open');
  if (review.commit_id !== input.packet.identity.repository.revision || pull.head?.sha !== input.packet.identity.repository.revision) {
    throw new Error('GitHub review and pull-request head must match the packet repository revision');
  }
  if (input.packet.identity.repository.identity.toLowerCase() !== `github.com/${repository}`.toLowerCase()) {
    throw new Error('GitHub repository does not match the packet repository identity');
  }
  if (typeof review.user?.login !== 'string' || typeof review.user.id !== 'number' || review.user.type !== 'User') {
    throw new Error('GitHub review has no authenticated user identity');
  }
  if (pull.user?.id === review.user.id) throw new Error('pull-request authors cannot authenticate their own BCE decision');
  const permission = await githubJson(
    fetchImpl,
    `${GITHUB_API_ORIGIN}/repos/${repository}/collaborators/${encodeURIComponent(review.user.login)}/permission`,
    token,
  ) as GitHubPermission;
  if (
    permission.user?.login !== review.user.login || permission.user.id !== review.user.id || permission.user.type !== 'User' ||
    !['admin', 'maintain'].includes(String(permission.permission))
  ) throw new Error('GitHub reviewer does not currently have admin or maintain repository permission');
  if (reviewsRaw.length >= 100) {
    throw new Error('GitHub review authentication refuses a truncated 100-review page');
  }
  const sameReviewer = (reviewsRaw as GitHubReview[]).filter((item) => item.user?.id === review.user!.id);
  const latest = sameReviewer.at(-1);
  if (latest?.id !== reviewId || latest.state !== review.state) {
    throw new Error('selected GitHub review is not the reviewer’s latest submitted state');
  }
  const baseRepository = pull.base?.repo;
  if (typeof baseRepository?.full_name !== 'string' || baseRepository.full_name.toLowerCase() !== repository.toLowerCase() || typeof baseRepository.id !== 'number') {
    throw new Error('GitHub pull request base repository does not match the selected repository');
  }
  const reviewedBase = input.packet.artifacts.repositoryPolicyDiff;
  if (
    !reviewedBase.complete || reviewedBase.baseRef === null || reviewedBase.baseHeadRevision === null ||
    pull.base?.ref !== reviewedBase.baseRef || pull.base.sha !== reviewedBase.baseHeadRevision
  ) {
    throw new Error('GitHub pull-request base ref and SHA must match the packet repository-policy base');
  }
  if (typeof review.body !== 'string') throw new Error('GitHub review body is required');
  if (typeof review.submitted_at !== 'string') throw new Error('GitHub review submission time is required');
  if (typeof review.html_url !== 'string' || !review.html_url.startsWith(`https://github.com/${repository}/pull/${pullRequest}#`)) {
    throw new Error('GitHub review URL does not match the selected repository and pull request');
  }
  if (review.pull_request_url !== `${root}`) throw new Error('GitHub review does not belong to the selected pull request');
  const rationale = reviewRationale(review.body, input.packet, input.decision);
  const assertion = {
    provider: 'github',
    repository,
    pullRequest,
    reviewId,
    reviewer: { login: review.user.login, id: review.user.id },
    decision: input.decision,
    state: review.state,
    commitId: review.commit_id,
    submittedAt: review.submitted_at,
    authorAssociation: review.author_association,
    permission: permission.permission,
    repositoryId: baseRepository.id,
    baseRef: pull.base.ref,
    baseSha: pull.base.sha,
    reviewUrl: review.html_url,
    packetDigest: input.packet.packetDigest,
    candidateDigest: input.packet.provenance.candidateDigest,
    rationale,
  };
  return recordReviewDecision({
    packet: input.packet,
    decision: input.decision,
    reviewer: {
      id: `${review.user.login} (${review.user.id})`,
      authentication: {
        method: 'scm',
        issuer: 'https://github.com',
        subject: `github:user:${review.user.id}`,
        assertionDigest: reviewDigest(assertion),
        reference: review.html_url,
      },
    },
    satisfiedRequirement: input.decision === 'approve' ? (input.packet.approval.requirements[0] ?? null) : null,
    weakeningAccepted: input.decision === 'approve' && input.packet.semanticDiff.classification === 'relaxation',
    rationale,
    decidedAt: review.submitted_at,
  });
}

/** Re-fetch the SCM assertion and require byte-identical decision reconstruction. */
export async function reauthenticateGitHubDecision(input: AuthenticateGitHubDecisionInput & {
  savedDecision: BlueprintDecisionRecord;
}): Promise<void> {
  const fresh = await authenticateGitHubDecision(input);
  if (stableStringify(fresh) !== stableStringify(input.savedDecision)) {
    throw new Error('saved decision does not reproduce from the current GitHub review assertion');
  }
}
