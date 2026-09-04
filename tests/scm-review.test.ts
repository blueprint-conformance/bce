import { describe, expect, it } from 'vitest';
import { authenticateGitHubDecision, reauthenticateGitHubDecision } from '../src/scm-review.js';
import { makeReviewFixture } from './review-fixture.js';

const selector = { repository: 'example/repo', pullRequest: 123, reviewId: 456 };

function githubFetch(
  overrides: Record<string, unknown> = {},
  packet = makeReviewFixture().packet,
  pullOverrides: Record<string, unknown> = {},
): typeof fetch {
  const body = [
    `BCE-Review-Packet: sha256:${packet.packetDigest}`,
    `BCE-Candidate: sha256:${packet.provenance.candidateDigest}`,
    'BCE-Decision: approve',
    'BCE-Approval-Role: platform-owner',
    'BCE-Approval-Stage: ratify',
    '',
    'The reviewed packet matches the intended architecture boundary.',
  ].join('\n');
  return (async (url: string | URL | Request) => {
    const value = String(url);
    if (value.endsWith('/reviews/456')) {
      return new Response(JSON.stringify({
        id: 456,
        user: { login: 'maintainer', id: 2, type: 'User' },
        body,
        state: 'APPROVED',
        html_url: 'https://github.com/example/repo/pull/123#pullrequestreview-456',
        submitted_at: '2026-09-03T20:00:00.000Z',
        commit_id: 'revision-1',
        author_association: 'MEMBER',
        pull_request_url: 'https://api.github.com/repos/example/repo/pulls/123',
        ...overrides,
      }), { status: 200 });
    }
    if (value.endsWith('/reviews?per_page=100')) {
      return new Response(JSON.stringify([{
        id: 456,
        user: { login: 'maintainer', id: 2 },
        state: overrides.state ?? 'APPROVED',
      }]), { status: 200 });
    }
    if (value.endsWith('/pulls/123')) {
      return new Response(JSON.stringify({
        state: 'open', head: { sha: 'revision-1' }, user: { id: 1 },
        base: {
          ref: packet.artifacts.repositoryPolicyDiff.baseRef,
          sha: packet.artifacts.repositoryPolicyDiff.baseHeadRevision,
          repo: { id: 99, full_name: 'example/repo' },
        },
        ...pullOverrides,
      }), { status: 200 });
    }
    if (value.endsWith('/collaborators/maintainer/permission')) return new Response(JSON.stringify({
      permission: 'maintain', user: { login: 'maintainer', id: 2, type: 'User' },
    }), { status: 200 });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('GitHub SCM review authentication', () => {
  it('derives every reviewer and decision field from the fixed-origin forge response', async () => {
    const packet = makeReviewFixture().packet;
    const record = await authenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl: githubFetch(),
    });
    expect(record).toMatchObject({
      decision: 'approve',
      reviewer: {
        id: 'maintainer (2)',
        authentication: {
          method: 'scm',
          issuer: 'https://github.com',
          subject: 'github:user:2',
          reference: 'https://github.com/example/repo/pull/123#pullrequestreview-456',
        },
      },
      decidedAt: '2026-09-03T20:00:00.000Z',
      rationale: 'The reviewed packet matches the intended architecture boundary.',
    });
    await expect(reauthenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl: githubFetch(),
      savedDecision: record,
    })).resolves.toBeUndefined();
    for (const decision of ['reject', 'request-changes'] as const) {
      const body = [
        `BCE-Review-Packet: sha256:${packet.packetDigest}`,
        `BCE-Candidate: sha256:${packet.provenance.candidateDigest}`,
        `BCE-Decision: ${decision}`,
        '',
        'The reviewed packet needs a substantive correction before landing.',
      ].join('\n');
      await expect(authenticateGitHubDecision({
        packet,
        decision,
        selector,
        token: 'test-token',
        fetchImpl: githubFetch({ body, state: 'CHANGES_REQUESTED' }),
      })).resolves.toMatchObject({ decision, weakeningAccepted: false, satisfiedRequirement: null });
    }
  });

  it('refuses stale, self-authored, untrusted, or under-specified reviews', async () => {
    const packet = makeReviewFixture().packet;
    const attempt = (overrides: Record<string, unknown>) => authenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl: githubFetch(overrides),
    });
    await expect(attempt({ commit_id: 'other-revision' })).rejects.toThrow(/must match/);
    await expect(attempt({ user: { login: 'author', id: 1, type: 'User' } })).rejects.toThrow(/permission|authors cannot/);
    await expect(attempt({ user: { login: 'automation', id: 3, type: 'Bot' } })).rejects.toThrow(/authenticated user identity/);
    await expect(attempt({ body: 'Looks fine to me.' })).rejects.toThrow(/missing BCE-Review-Packet/);
    await expect(attempt({ state: 'DISMISSED' })).rejects.toThrow(/must be APPROVED/);
    await expect(authenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl: githubFetch({}, packet, {
        base: { ref: 'release', sha: 'other-base', repo: { id: 99, full_name: 'example/repo' } },
      }),
    })).rejects.toThrow(/base ref and SHA/);
  });

  it('stops reading a chunked GitHub response at the 1 MiB cap', async () => {
    const packet = makeReviewFixture().packet;
    const fetchImpl = (async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(700_000));
        controller.enqueue(new Uint8Array(400_000));
        controller.close();
      },
    }), { status: 200 })) as typeof fetch;
    await expect(authenticateGitHubDecision({
      packet, decision: 'approve', selector, token: 'test-token', fetchImpl,
    })).rejects.toThrow(/exceeds the 1 MiB limit/);
  });

  it('never follows a caller-selected API origin and refuses missing credentials', async () => {
    const packet = makeReviewFixture().packet;
    const seen: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response('denied', { status: 403 });
    }) as typeof fetch;
    await expect(authenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl,
    })).rejects.toThrow(/HTTP 403/);
    expect(seen).toHaveLength(3);
    expect(seen.every((url) => url.startsWith('https://api.github.com/repos/example/repo/pulls/123'))).toBe(true);
    await expect(authenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: '',
      fetchImpl,
    })).rejects.toThrow(/TOKEN/);
  });

  it('invalidates a saved decision when the submitted SCM assertion changes', async () => {
    const packet = makeReviewFixture().packet;
    const savedDecision = await authenticateGitHubDecision({
      packet, decision: 'approve', selector, token: 'test-token', fetchImpl: githubFetch(),
    });
    await expect(reauthenticateGitHubDecision({
      packet,
      decision: 'approve',
      selector,
      token: 'test-token',
      fetchImpl: githubFetch({ body: [
        `BCE-Review-Packet: sha256:${packet.packetDigest}`,
        `BCE-Candidate: sha256:${packet.provenance.candidateDigest}`,
        'BCE-Decision: approve',
        'BCE-Approval-Role: platform-owner',
        'BCE-Approval-Stage: ratify',
        '',
        'A materially different rationale now replaces the reviewed assertion.',
      ].join('\n') }),
      savedDecision,
    })).rejects.toThrow(/does not reproduce/);
  });

  it('requires the reviewer to explicitly acknowledge a deterministic weakening', async () => {
    const proposal = makeReviewFixture().packet.artifacts.proposal;
    const base = structuredClone(proposal.candidate);
    base.metadata.status = 'approved';
    base.constraints[0]!.severity = 'critical';
    const packet = makeReviewFixture({ proposal, baseBlueprint: base }).packet;
    expect(packet.semanticDiff.classification).toBe('relaxation');
    await expect(authenticateGitHubDecision({
      packet, decision: 'approve', selector, token: 'test-token', fetchImpl: githubFetch({}, packet),
    })).rejects.toThrow(/BCE-Accept-Weakening/);
    const body = [
      `BCE-Review-Packet: sha256:${packet.packetDigest}`,
      `BCE-Candidate: sha256:${packet.provenance.candidateDigest}`,
      'BCE-Decision: approve',
      'BCE-Approval-Role: platform-owner',
      'BCE-Approval-Stage: ratify',
      'BCE-Accept-Weakening: true',
      '',
      'The reviewer knowingly accepts this explicit policy weakening.',
    ].join('\n');
    await expect(authenticateGitHubDecision({
      packet, decision: 'approve', selector, token: 'test-token', fetchImpl: githubFetch({ body }, packet),
    })).resolves.toMatchObject({ decision: 'approve', weakeningAccepted: true });
  });
});
