import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const cleanup: string[] = [];

function fixtureRepo(): { root: string; preload: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-propose-cli-'));
  cleanup.push(root);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'intent.md'), 'Keep dynamic evaluation out of the extension.\n');
  fs.writeFileSync(path.join(root, 'docs', 'rationale.md'), 'The packet matches the intended static safety boundary.\n');
  fs.writeFileSync(path.join(root, 'src', 'index.ts'), 'export default function GatewayExtension() { return 1; }\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '.bce/\nignored.ts\n');
  execFileSync('git', ['init', '-q', '-b', 'main', root]);
  execFileSync('git', ['-C', root, 'remote', 'add', 'origin', 'https://github.com/example/repo.git']);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture']);
  const base = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', root, 'update-ref', 'refs/remotes/origin/main', base]);
  execFileSync('git', ['-C', root, 'switch', '-qc', 'feature/review']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'proposal head']);

  const preloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-fake-responses-'));
  cleanup.push(preloadRoot);
  const preload = path.join(preloadRoot, 'fake-responses.mjs');
  // The preload replaces native fetch in the child process; the production adapter still uses
  // its fixed HTTPS endpoint and exact request contract end-to-end.
  fs.writeFileSync(preload, `
globalThis.fetch = async (_url, init) => {
  const request = JSON.parse(String(init.body));
  const envelope = JSON.parse(request.input);
  const context = envelope.proposalContext;
  const source = context.files.find((file) => file.path === 'src/index.ts');
  const intent = context.authoritativeIntentRefs[0];
  const assertion = {
    claim: 'A real extension surface is required.',
    basis: 'source-backed-intent',
    anchors: [{ kind: 'intent-reference', ref: intent.ref, sha256: intent.sha256, lineStart: 1 }],
    uncertainty: { level: 'low', reason: 'The disclosed intent states the boundary.' },
    alternatives: ['Use statically declared behavior.'],
    knownBlindSpots: ['Runtime-generated source is not observed.']
  };
  const plan = {
    schemaVersion: '1', kind: 'BlueprintDraftPlan', proposalId: 'ai-first-boundary',
    contextDigest: context.contextDigest,
    metadata: { id: 'ai-first-boundary', name: 'AI-first boundary', version: '0.1.0' },
    scope: {
      repositories: [context.repository.identity], paths: ['src/**/*.ts'],
      assertions: [{
        claim: 'The proposal inspects the extension source.', basis: 'observed-fact',
        anchors: [{ kind: 'repository-file', ref: source.path, sha256: source.sha256, lineStart: 1 }],
        uncertainty: { level: 'none', reason: 'The source file is in the disclosed manifest.' },
        alternatives: [], knownBlindSpots: []
      }]
    },
    architecture: { components: [], relationships: [] },
    clauses: [{
      constraint: { id: 'extension-exists', type: 'requiredComponent', severity: 'critical', component: 'pluginSurface' },
      assertions: [assertion]
    }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
    knownBlindSpots: ['Runtime-generated source is not observed.']
  };
  return new Response(JSON.stringify({
    id: 'resp_fixture', status: 'completed', model: 'fixture-model-snapshot',
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    output_text: JSON.stringify(plan)
  }), { status: 200 });
};
`);
  return { root, preload };
}

function githubPreload(
  root: string,
  packetPath: string,
  decision: 'approve' | 'reject' | 'request-changes',
  mutateDuringAuthentication = false,
): string {
  const packet = JSON.parse(fs.readFileSync(packetPath, 'utf8')) as {
    packetDigest: string;
    provenance: { candidateDigest: string };
    identity: { repository: { revision: string } };
    artifacts: { repositoryPolicyDiff: { baseRef: string; baseHeadRevision: string } };
  };
  const preloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-fake-github-'));
  cleanup.push(preloadRoot);
  const preload = path.join(preloadRoot, 'fake-github.mjs');
  const state = decision === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED';
  const reviewedBase = packet.artifacts.repositoryPolicyDiff;
  const body = [
    `BCE-Review-Packet: sha256:${packet.packetDigest}`,
    `BCE-Candidate: sha256:${packet.provenance.candidateDigest}`,
    `BCE-Decision: ${decision}`,
    ...(decision === 'approve' ? ['BCE-Approval-Role: blueprint-steward', 'BCE-Approval-Stage: ratify'] : []),
    '',
    'The packet matches the intended static safety boundary.',
  ].join('\n');
  fs.writeFileSync(preload, `
import * as fs from 'node:fs';
globalThis.fetch = async (url) => {
  const value = String(url);
  if (value.endsWith('/reviews/456')) return new Response(JSON.stringify({
    id: 456,
    user: { login: 'maintainer', id: 2, type: 'User' },
    body: ${JSON.stringify(body)},
    state: ${JSON.stringify(state)},
    html_url: 'https://github.com/example/repo/pull/123#pullrequestreview-456',
    submitted_at: '2026-09-03T20:00:00.000Z',
    commit_id: ${JSON.stringify(packet.identity.repository.revision)},
    author_association: 'MEMBER',
    pull_request_url: 'https://api.github.com/repos/example/repo/pulls/123'
  }), { status: 200 });
  if (value.endsWith('/reviews?per_page=100')) return new Response(JSON.stringify([{
    id: 456, user: { login: 'maintainer', id: 2 }, state: ${JSON.stringify(state)}
  }]), { status: 200 });
  if (value.endsWith('/pulls/123')) return new Response(JSON.stringify({
    state: 'open', head: { sha: ${JSON.stringify(packet.identity.repository.revision)} }, user: { id: 1 },
    base: { ref: ${JSON.stringify(reviewedBase.baseRef)}, sha: ${JSON.stringify(reviewedBase.baseHeadRevision)}, repo: { id: 99, full_name: 'example/repo' } }
  }), { status: 200 });
  if (value.endsWith('/collaborators/maintainer/permission')) {
    ${mutateDuringAuthentication ? `fs.writeFileSync(${JSON.stringify(path.join(root, 'src', 'index.ts'))}, 'export default function ChangedDuringAuthentication() { return 2; }\\n');` : ''}
    return new Response(JSON.stringify({
      permission: 'maintain', user: { login: 'maintainer', id: 2, type: 'User' }
    }), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};
`);
  return preload;
}

function cli(root: string, args: string[], preload?: string) {
  const imports = preload ? ['--import', preload] : [];
  return spawnSync(process.execPath, [...imports, '--import', 'tsx', CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: 'test-only-key', BCE_GITHUB_TOKEN: 'test-only-github-token' },
  });
}

afterEach(() => {
  for (const target of cleanup.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

describe('AI-first proposal/review CLI', () => {
  it('emits a reviewable draft, renders/verifies it, and records a bound decision without policy mutation', () => {
    const { root, preload } = fixtureRepo();
    const proposed = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new', '--out', '.bce/proposals',
    ], preload);
    expect(proposed.status, proposed.stderr).toBe(0);
    expect(proposed.stdout).toContain('BCE disclosure preview');
    expect(proposed.stdout).toContain('REVIEWABLE draft');

    const dir = path.join(root, '.bce', 'proposals', 'ai-first-boundary');
    for (const file of [
      'context.json', 'disclosure.json', 'generation.json', 'raw-response.txt', 'draft-plan.json',
      'ai-first-boundary.blueprint.json', 'proposal.json', 'review-packet.json', 'review.txt', 'review.html',
    ]) expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
    const candidate = JSON.parse(fs.readFileSync(path.join(dir, 'ai-first-boundary.blueprint.json'), 'utf8')) as { metadata: { status: string } };
    expect(candidate.metadata.status).toBe('draft');
    expect(fs.existsSync(path.join(root, '.blueprints'))).toBe(false);
    const generation = JSON.parse(fs.readFileSync(path.join(dir, 'generation.json'), 'utf8')) as Record<string, any>;
    expect(generation.provider).toMatchObject({ requestId: 'resp_fixture', modelIdentity: 'fixture-model-snapshot' });
    expect(generation.telemetry).toMatchObject({ inputTokens: 10, outputTokens: 20, totalTokens: 30, cost: 'unknown' });

    const packet = path.relative(root, path.join(dir, 'review-packet.json'));
    const github = githubPreload(root, path.join(root, packet), 'approve');
    const shown = cli(root, ['review', 'show', '--repo', root, '--packet', packet, '--format', 'text']);
    expect(shown.status, shown.stderr).toBe(0);
    for (const label of ['Promise:', 'Lens:', 'Proof:', 'Limits:']) expect(shown.stdout).toContain(label);
    const verified = cli(root, ['review', 'verify', '--repo', root, '--packet', packet]);
    expect(verified.status, verified.stderr).toBe(0);

    const decided = cli(root, [
      'review', 'decide', '--repo', root, '--packet', packet, '--decision', 'approve',
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ], github);
    expect(decided.status, decided.stderr).toBe(0);
    expect(decided.stdout).toContain('no policy files changed');
    const decision = fs.readdirSync(path.join(dir, 'decisions')).find((file) => file.endsWith('.json'))!;
    const decisionRel = path.relative(root, path.join(dir, 'decisions', decision));
    const decisionVerified = cli(root, ['review', 'verify', '--repo', root, '--packet', packet, '--decision', decisionRel]);
    expect(decisionVerified.status, decisionVerified.stderr).toBe(0);
    const landed = cli(root, [
      'ratify', '--repo', root,
      '--blueprint', path.relative(root, path.join(dir, 'ai-first-boundary.blueprint.json')),
      '--packet', packet, '--decision', decisionRel,
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ], github);
    expect(landed.status, landed.stderr).toBe(0);
    const governed = JSON.parse(fs.readFileSync(path.join(root, '.blueprints', 'ai-first-boundary.blueprint.json'), 'utf8')) as { metadata: { status: string } };
    expect(governed.metadata.status).toBe('approved');
  }, 30_000);

  it('rejects non-canonical packet byte tampering', () => {
    const { root, preload } = fixtureRepo();
    const proposed = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new',
    ], preload);
    expect(proposed.status, proposed.stderr).toBe(0);
    const packet = path.join(root, '.bce', 'proposals', 'ai-first-boundary', 'review-packet.json');
    fs.appendFileSync(packet, '\n');
    const shown = cli(root, ['review', 'show', '--repo', root, '--packet', path.relative(root, packet)]);
    expect(shown.status).toBe(2);
    expect(shown.stderr).toContain('not canonical or were tampered');
  }, 30_000);

  it('refuses stale ignored inputs, noncanonical candidates, and noncanonical packet locations', () => {
    const { root, preload } = fixtureRepo();
    const alternateOut = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new', '--out', 'proposals',
    ], preload);
    expect(alternateOut.status).toBe(2);
    expect(alternateOut.stderr).toContain('canonical quarantine root');
    const proposed = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new',
    ], preload);
    expect(proposed.status, proposed.stderr).toBe(0);
    const dir = path.join(root, '.bce', 'proposals', 'ai-first-boundary');
    const packet = path.join(dir, 'review-packet.json');
    const copied = path.join(root, 'copied-packet.json');
    fs.copyFileSync(packet, copied);
    const misplaced = cli(root, ['review', 'show', '--repo', root, '--packet', 'copied-packet.json']);
    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain('canonical proposal location');
    fs.unlinkSync(copied);

    const candidate = path.join(dir, 'ai-first-boundary.blueprint.json');
    const copiedCandidate = path.join(root, 'copied-candidate.blueprint.json');
    fs.copyFileSync(candidate, copiedCandidate);
    const misplacedCandidate = cli(root, [
      'ratify', '--repo', root, '--blueprint', path.relative(root, copiedCandidate),
      '--packet', path.relative(root, packet), '--decision', 'missing.json',
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ]);
    expect(misplacedCandidate.status).toBe(2);
    expect(misplacedCandidate.stderr).toContain('canonical proposal location');
    fs.unlinkSync(copiedCandidate);

    fs.writeFileSync(path.join(root, 'ignored.ts'), 'export const ignored = true;\n');
    const stale = cli(root, ['review', 'show', '--repo', root, '--packet', path.relative(root, packet)]);
    expect(stale.status).toBe(2);
    expect(stale.stderr).toMatch(/worktree bytes changed|live repository extraction changed/);

    fs.appendFileSync(candidate, '\n');
    const landing = cli(root, [
      'ratify', '--repo', root, '--blueprint', path.relative(root, candidate),
      '--packet', path.relative(root, packet), '--decision', 'missing.json',
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ]);
    expect(landing.status).toBe(2);
    expect(landing.stderr).toContain('candidate bytes are not canonical');
  }, 30_000);

  it('rechecks all repository evidence after SCM authentication and before the first policy write', () => {
    const { root, preload } = fixtureRepo();
    const proposed = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new',
    ], preload);
    expect(proposed.status, proposed.stderr).toBe(0);
    const dir = path.join(root, '.bce', 'proposals', 'ai-first-boundary');
    const packetPath = path.join(dir, 'review-packet.json');
    const packet = path.relative(root, packetPath);
    const normalGithub = githubPreload(root, packetPath, 'approve');
    const decided = cli(root, [
      'review', 'decide', '--repo', root, '--packet', packet, '--decision', 'approve',
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ], normalGithub);
    expect(decided.status, decided.stderr).toBe(0);
    const decision = fs.readdirSync(path.join(dir, 'decisions')).find((file) => file.endsWith('.json'))!;
    const mutatingGithub = githubPreload(root, packetPath, 'approve', true);
    const landed = cli(root, [
      'ratify', '--repo', root,
      '--blueprint', path.relative(root, path.join(dir, 'ai-first-boundary.blueprint.json')),
      '--packet', packet, '--decision', path.relative(root, path.join(dir, 'decisions', decision)),
      '--github-repo', 'example/repo', '--github-pull', '123', '--github-review', '456',
    ], mutatingGithub);
    expect(landed.status).toBe(2);
    expect(landed.stderr).toContain('repository evidence changed during authenticated landing');
    expect(fs.existsSync(path.join(root, '.blueprints', 'ai-first-boundary.blueprint.json'))).toBe(false);
  }, 30_000);

  it('retains a truthful failed attempt and raw first refusal without presenting a blueprint', () => {
    const { root, preload } = fixtureRepo();
    fs.writeFileSync(preload, `
globalThis.fetch = async () => new Response(JSON.stringify({
  id: 'resp_refusal', status: 'completed',
  output: [{ content: [{ type: 'refusal', refusal: 'Provider policy refusal.' }] }]
}), { status: 200 });
`);
    const proposed = cli(root, [
      'propose', '--repo', root, '--intent-file', 'docs/intent.md', '--assistant', 'openai-responses',
      '--assistant-model', 'fixture-model-requested', '--new',
    ], preload);
    expect(proposed.status).toBe(2);
    expect(proposed.stderr).toContain('failed proposal retained');
    const quarantine = path.join(root, '.bce', 'proposals');
    const failed = fs.readdirSync(quarantine).find((entry) => entry.startsWith('failed-'))!;
    const dir = path.join(quarantine, failed);
    expect(fs.readFileSync(path.join(dir, 'raw-response.txt'), 'utf8')).toBe('Provider policy refusal.');
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'generation.json'), 'utf8'))).toMatchObject({
      status: 'refusal',
      provider: { requestId: 'resp_refusal', modelIdentity: 'unknown' },
      telemetry: { inputTokens: 'unknown', outputTokens: 'unknown', totalTokens: 'unknown', cost: 'unknown' },
    });
    expect(fs.readdirSync(dir).some((entry) => entry.endsWith('.blueprint.json'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'review-packet.json'))).toBe(false);
  }, 30_000);
});
