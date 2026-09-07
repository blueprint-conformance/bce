import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { doctorRepository, checkEngineUpgrade } from '../src/lifecycle.js';
import { amendBlueprint, ratifyBlueprint, readPolicyHistory, auditAdoption, transitionAdoptionMode } from '../src/policy-history.js';
import { stableStringify } from '../src/report.js';
import { writeModeConfig, readGraduationRecord, resolveMode } from '../src/mode.js';
import { reviewDigest } from '../src/review.js';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const CHECKOUT_SHA = '3d3c42e5aac5ba805825da76410c181273ba90b1';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';

function cli(args: string[], cwd = ROOT) {
  const loader = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(loader).href, CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('CLI discovery is read-only', () => {
  it('short-circuits subcommand help and version before a mutating command runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-help-'));
    fs.mkdirSync(path.join(dir, '.blueprints'));
    const before = fs.readdirSync(path.join(dir, '.blueprints'));
    const help = cli(['baseline', '--help'], dir);
    expect(help.status, help.out).toBe(0);
    expect(help.out).toContain('bce — Blueprint Conformance Engine');
    expect(help.out).toContain('bce baseline');
    expect(help.out).not.toContain('  bce propose');
    expect(fs.readdirSync(path.join(dir, '.blueprints'))).toEqual(before);
    const version = cli(['gate', '--version'], dir);
    expect(version.status, version.out).toBe(0);
    expect(version.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fs.readdirSync(path.join(dir, '.blueprints'))).toEqual(before);
    const unknown = cli(['author', '--harness', 'nonsense'], dir);
    expect(unknown.status).toBe(1);
    expect(unknown.out).toContain('unknown option for bce author: --harness');
    const authorHelp = cli(['help', 'author'], dir);
    expect(authorHelp.status, authorHelp.out).toBe(0);
    expect(authorHelp.out).toContain('--scope-paths');
    expect(authorHelp.out).not.toContain('  bce baseline');
    const unknownHelp = cli(['help', 'imaginary'], dir);
    expect(unknownHelp.status).toBe(1);
    expect(unknownHelp.out).toContain("unknown help topic 'imaginary'");
  });
});

describe('doctor — read-only lifecycle readiness', () => {
  it(
    'audits this candidate without structural refusal and exposes typed checks',
    () => {
      const report = doctorRepository(ROOT);
      expect(report.checks.length).toBeGreaterThan(10);
      expect(report.checks.some((c) => c.id === 'agents/mcp' && c.status === 'pass')).toBe(true);
      expect(report.checks.some((c) => c.id === 'gate/full-sweep' && c.status === 'pass')).toBe(true);
      const proofs = report.checks.filter((c) => c.id.endsWith('/proof'));
      expect(proofs).toHaveLength(2);
      for (const proof of proofs) {
        expect(proof.status, proof.detail).toBe('pass');
        expect(proof.detail).toMatch(/^extractor-real-proven: ([1-9]\d*)\/\1 source mutants killed$/);
      }
      // The development shell may itself be below the package's Node >=22 contract; doctor must
      // report that honestly while the repository's lifecycle surfaces remain structurally sound.
      expect(report.checks.filter((c) => c.status === 'refusal' && c.id !== 'runtime/node')).toEqual([]);
    },
    // This functional integration proof executes all 60 source mutants, plus the full gate.
    // Post-merge run 34052319358 took 121.4s on Windows/Node 22 and 114.3s on Node 24
    // under parallel suite load. Give this one test a finite 5-minute budget; runtime
    // performance assertions and the global test timeout remain separate and unchanged.
    300_000,
  );

  it('a repo with zero blueprints is a typed refusal', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-doctor-empty-'));
    const report = doctorRepository(dir);
    expect(report.outcome).toBe('refusal');
    expect(report.exitCode).toBe(2);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'blueprints/discovery', status: 'refusal' }));
  });
});

describe('engine upgrade preflight', () => {
  it('accepts exact compatible candidates and refuses ranges or versions below blueprint floors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-upgrade-'));
    fs.mkdirSync(path.join(dir, '.blueprints'));
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/luna-chat-extension.blueprint.json'), 'utf8'));
    raw.minEngineVersion = '2.0.0';
    fs.writeFileSync(path.join(dir, '.blueprints', 'a.blueprint.json'), JSON.stringify(raw));
    expect(checkEngineUpgrade(path.join(dir, '.blueprints'), '2.1.0').outcome).toBe('compatible');
    expect(checkEngineUpgrade(path.join(dir, '.blueprints'), '1.9.9')).toMatchObject({ outcome: 'refusal', exitCode: 2 });
    expect(checkEngineUpgrade(path.join(dir, '.blueprints'), 'latest').outcome).toBe('refusal');
  });
});

describe('adopt — safe proposal, never ratification', () => {
  it('writes draft/advisory/least-privilege files and refuses overwrite', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-adopt-'));
    const draftPath = path.join(dir, 'draft.json');
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    source.metadata.status = 'draft';
    fs.writeFileSync(draftPath, JSON.stringify(source));
    const first = cli(['adopt', '--repo', dir, '--blueprint', draftPath, '--engine', 'bce-engine@1.2.3']);
    expect(first.status, first.out).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.bce-mode.json'), 'utf8'))).toEqual({ mode: 'advisory' });
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.bce-adoption.json'), 'utf8'))).toMatchObject({ state: 'proposed', ratified: false });
    const workflow = fs.readFileSync(path.join(dir, '.github', 'workflows', 'blueprint-conformance.yml'), 'utf8');
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('bce-engine@1.2.3');
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`);
    expect(workflow).toContain(`uses: actions/setup-node@${SETUP_NODE_SHA} # v4`);
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
    expect(workflow).not.toContain('pull-requests: write');
    const second = cli(['adopt', '--repo', dir, '--blueprint', draftPath, '--engine', 'bce-engine@1.2.3']);
    expect(second.status).toBe(2);
    expect(second.out).toContain('refuses to overwrite');
  });

  it('refuses an already-approved blueprint and non-exact engine pins', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-adopt-refuse-'));
    const approved = path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json');
    expect(cli(['adopt', '--repo', dir, '--blueprint', approved, '--engine', 'bce-engine@1.2.3']).status).toBe(2);
    const raw = JSON.parse(fs.readFileSync(approved, 'utf8'));
    raw.metadata.status = 'draft';
    const draft = path.join(dir, 'draft.json');
    fs.writeFileSync(draft, JSON.stringify(raw));
    expect(cli(['adopt', '--repo', dir, '--blueprint', draft, '--engine', 'bce-engine@latest']).status).toBe(2);
  });
});

describe('onboard — full repository wiring', () => {
  it('wires an immutable pre-release Action, existing agent context, and MCP without overwriting', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-onboard-'));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Existing rules\n');
    fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { existing: { command: 'existing' } } }));
    const draftPath = path.join(dir, 'draft.json');
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    source.metadata.status = 'draft';
    fs.writeFileSync(draftPath, JSON.stringify(source));
    const sha = 'a'.repeat(40);
    const result = cli(['onboard', '--repo', dir, '--blueprint', draftPath,
      '--engine', `blueprint-conformance/bce@${sha}`, '--harness', 'agents']);
    expect(result.status, result.out).toBe(0);
    const workflow = fs.readFileSync(path.join(dir, '.github/workflows/blueprint-conformance.yml'), 'utf8');
    expect(workflow).toContain(`uses: blueprint-conformance/bce@${sha}`);
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1`);
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
    expect(workflow).toContain('engine: local');
    expect(workflow).toContain('fetch-depth: 0');
    const context = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
    expect(context).toContain('# Existing rules');
    expect(context).toContain('<!-- bce-agent-context -->');
    expect(context).toContain('Prefer MCP `run_gate {}`');
    expect(context).toContain('advisory mode can exit 0 while reports remain RED');
    const mcp = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    expect(mcp.mcpServers.existing).toEqual({ command: 'existing' });
    expect(mcp.mcpServers.bce).toEqual({ command: 'npx', args: ['--no-install', 'bce-mcp'] });
    expect(fs.existsSync(path.join(dir, '.agents/skills/bce/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.agents/skills/skill-tuning/SKILL.md'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, '.bce-adoption.json'), 'utf8'));
    expect(manifest).toMatchObject({
      state: 'proposed', ratified: false, harness: 'agents', engine: `blueprint-conformance/bce@${sha}`,
    });
    expect(manifest.generatedFiles).toEqual(expect.arrayContaining([
      '.agents/skills/bce/SKILL.md',
      '.agents/skills/skill-tuning/SKILL.md',
      '.agents/skills/skill-tuning/references/portability-matrix.md',
    ]));
    const doctor = doctorRepository(dir);
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: 'agents/project-skills', status: 'pass' }));
    expect(doctor.checks).toContainEqual(expect.objectContaining({ id: 'agents/mcp-config', status: 'pass' }));
  });

  it('writes project-local Codex MCP + skills, preserves config, and refuses unsafe output paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-onboard-codex-'));
    fs.mkdirSync(path.join(dir, '.codex'));
    fs.writeFileSync(path.join(dir, '.codex/config.toml'), 'model = "gpt-5"\n');
    const draftPath = path.join(dir, 'draft.json');
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    source.metadata.status = 'draft';
    fs.writeFileSync(draftPath, JSON.stringify(source));
    const base = ['onboard', '--repo', dir, '--blueprint', draftPath,
      '--engine', `blueprint-conformance/bce@${'b'.repeat(40)}`, '--harness', 'codex'];
    const escaped = cli([...base, '--agent-file', '../AGENTS.md']);
    expect(escaped.status).toBe(2);
    expect(escaped.out).toContain('escapes --repo');
    expect(fs.existsSync(path.join(dir, '.bce-adoption.json'))).toBe(false);
    const ok = cli(base);
    expect(ok.status, ok.out).toBe(0);
    expect(ok.out).toContain('MCP config: .codex/config.toml');
    expect(ok.out).toContain('skills: .agents/skills/bce, .agents/skills/skill-tuning');
    const codexConfig = fs.readFileSync(path.join(dir, '.codex/config.toml'), 'utf8');
    expect(codexConfig).toContain('model = "gpt-5"');
    expect(codexConfig).toContain('[mcp_servers.bce]');
    expect(codexConfig).toContain('args = ["--no-install", "bce-mcp"]');
    expect(fs.existsSync(path.join(dir, '.agents/skills/bce/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.agents/skills/skill-tuning/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '.mcp.json'))).toBe(false);
  });

  it('refuses a skill collision before writing any policy artifact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-onboard-skill-collision-'));
    fs.mkdirSync(path.join(dir, '.agents/skills/bce'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.agents/skills/bce/SKILL.md'), 'existing');
    const draftPath = path.join(dir, 'draft.json');
    const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    source.metadata.status = 'draft';
    fs.writeFileSync(draftPath, JSON.stringify(source));
    const result = cli(['onboard', '--repo', dir, '--blueprint', draftPath,
      '--engine', `blueprint-conformance/bce@${'c'.repeat(40)}`, '--harness', 'agents']);
    expect(result.status).toBe(2);
    expect(result.out).toContain('refuses to overwrite existing skills');
    expect(fs.existsSync(path.join(dir, '.bce-adoption.json'))).toBe(false);
    expect(fs.readFileSync(path.join(dir, '.agents/skills/bce/SKILL.md'), 'utf8')).toBe('existing');
  });
});

describe('ratify/amend — attended policy ceremonies', () => {
  function governedRepo(): { dir: string; blueprint: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-policy-'));
    fs.cpSync(path.join(ROOT, 'fixtures', 'extension-surface', 'conformant'), dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    raw.metadata.status = 'draft';
    const blueprint = path.join(dir, '.blueprints', 'luna-chat-extension.blueprint.json');
    fs.writeFileSync(blueprint, stableStringify(raw));
    return { dir, blueprint };
  }

  const review = (candidateDigest: string, baseDigest: string | null) => ({
    reviewer: 'release-steward',
    rationale: 'Reviewed the candidate policy and its falsification proof.',
    recordedAt: '2026-09-01T12:00:00Z',
    authentication: {
      method: 'scm' as const,
      issuer: 'https://github.com',
      subject: 'github:user:42',
      assertionDigest: 'a'.repeat(64),
      reference: 'https://github.com/example/repo/pull/1#pullrequestreview-1',
    },
    evidence: {
      packetDigest: 'b'.repeat(64), decisionDigest: 'c'.repeat(64), candidateDigest, baseDigest,
      repositoryRevision: 'revision-1', worktreeDigest: 'd'.repeat(64),
    },
  });

  it('ratifies only with explicit human attestation, proof, version bump, and append-only history', () => {
    const { dir, blueprint } = governedRepo();
    const candidate = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    const candidateDigest = reviewDigest(candidate);
    expect(() => ratifyBlueprint({
      repoDir: dir,
      blueprintPath: blueprint,
      review: { ...review(candidateDigest, null), authentication: { ...review(candidateDigest, null).authentication, subject: '' } },
      proof: 'extractor-real',
      assertFresh: () => {},
      expectedCandidateDigest: candidateDigest,
      expectedBaseDigest: null,
    })).toThrow(/authentication metadata/);

    ratifyBlueprint({ repoDir: dir, blueprintPath: blueprint, review: review(candidateDigest, null), proof: 'extractor-real', assertFresh: () => {}, expectedCandidateDigest: candidateDigest, expectedBaseDigest: null });
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata).toMatchObject({ status: 'approved', version: '0.1.1' });
    expect(readPolicyHistory(dir)).toEqual([
      expect.objectContaining({ operation: 'ratify', fromRef: 'luna-chat-extension@0.1.0', toRef: 'luna-chat-extension@0.1.1', proof: 'extractor-real' }),
    ]);
  });

  it('runs the final repository-freshness assertion under the transition lock before writing policy', () => {
    const { dir, blueprint } = governedRepo();
    const candidate = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    const candidateDigest = reviewDigest(candidate);
    expect(() => ratifyBlueprint({
      repoDir: dir,
      blueprintPath: blueprint,
      review: review(candidateDigest, null),
      proof: 'extractor-real',
      assertFresh: () => {
        expect(fs.existsSync(path.join(dir, '.blueprints', '.bce-policy-transition.lock'))).toBe(true);
        throw new Error('repository changed after authentication');
      },
      expectedCandidateDigest: candidateDigest,
      expectedBaseDigest: null,
    })).toThrow(/repository changed after authentication/);
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata.status).toBe('draft');
    expect(fs.existsSync(path.join(dir, '.blueprints', 'POLICY-HISTORY.jsonl'))).toBe(false);
    expect(fs.existsSync(path.join(dir, '.blueprints', '.bce-policy-transition.lock'))).toBe(false);
  });

  it('retains the transition lock when a visible policy target cannot be proven rolled back', () => {
    const { dir, blueprint } = governedRepo();
    const candidate = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    const candidateDigest = reviewDigest(candidate);
    const displaced = `${blueprint}.displaced`;
    expect(() => ratifyBlueprint({
      repoDir: dir,
      blueprintPath: blueprint,
      review: review(candidateDigest, null),
      proof: 'extractor-real',
      assertFresh: () => {
        fs.renameSync(blueprint, displaced);
        fs.writeFileSync(blueprint, stableStringify({
          ...candidate,
          metadata: { ...candidate.metadata, status: 'approved' },
        }));
      },
      expectedCandidateDigest: candidateDigest,
      expectedBaseDigest: null,
    })).toThrow(/rollback is incomplete.*lock retained/);
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata.status).toBe('approved');
    expect(fs.existsSync(path.join(dir, '.blueprints', '.bce-policy-transition.lock'))).toBe(true);
  });

  it('amends only to a higher approved same-id version and records compatibility', () => {
    const { dir, blueprint } = governedRepo();
    const draftDigest = reviewDigest(JSON.parse(fs.readFileSync(blueprint, 'utf8')));
    ratifyBlueprint({ repoDir: dir, blueprintPath: blueprint, review: review(draftDigest, null), proof: 'extractor-real', assertFresh: () => {}, expectedCandidateDigest: draftDigest, expectedBaseDigest: null });
    const replacement = path.join(dir, 'replacement.json');
    const raw = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    raw.metadata.version = '0.2.0';
    fs.writeFileSync(replacement, stableStringify(raw));
    const baseDigest = reviewDigest(JSON.parse(fs.readFileSync(blueprint, 'utf8')));
    const replacementDigest = reviewDigest(raw);
    amendBlueprint({
      repoDir: dir,
      blueprintPath: blueprint,
      replacementPath: replacement,
      compatibility: 'tightening',
      review: review(replacementDigest, baseDigest),
      proof: 'extractor-real',
      assertFresh: () => {},
      expectedCandidateDigest: replacementDigest,
      expectedBaseDigest: baseDigest,
    });
    expect(readPolicyHistory(dir).at(-1)).toMatchObject({ operation: 'amend', compatibility: 'tightening', toRef: 'luna-chat-extension@0.2.0' });
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata.version).toBe('0.2.0');
  });

  it('keeps ratify → graduate → amend coherent, including explicit self-ratification', () => {
    const { dir, blueprint } = governedRepo();
    writeModeConfig(dir, 'advisory');
    const candidate = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    const candidateDigest = reviewDigest(candidate);
    const authenticated = review(candidateDigest, null);
    ratifyBlueprint({ repoDir: dir, blueprintPath: blueprint,
      review: { ...authenticated, authentication: { ...authenticated.authentication, reviewMode: 'self-ratified' } },
      proof: 'extractor-real', assertFresh: () => {}, expectedCandidateDigest: candidateDigest, expectedBaseDigest: null });
    expect(auditAdoption(dir)).toContain('ratified-advisory');
    expect(transitionAdoptionMode(dir, 'enforced', 'The approved policy now blocks violations.')).toBe(true);
    expect(auditAdoption(dir)).toContain('ratified-enforced');
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.bce-adoption.json'), 'utf8'))).toMatchObject({
      ratified: true, reviewMode: 'self-ratified', state: 'ratified-enforced', blueprintRef: 'luna-chat-extension@0.1.1', mode: 'enforced',
    });
    expect(transitionAdoptionMode(dir, 'enforced', 'already enforced')).toBe(false);
    expect(readGraduationRecord(dir)).toHaveLength(1);
    const current = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    const replacement = { ...current, metadata: { ...current.metadata, version: '0.2.0', status: 'draft' } };
    const replacementPath = path.join(dir, 'replacement.json');
    fs.writeFileSync(replacementPath, stableStringify(replacement));
    amendBlueprint({ repoDir: dir, blueprintPath: blueprint, replacementPath,
      review: review(reviewDigest(replacement), reviewDigest(current)), compatibility: 'compatible', proof: 'extractor-real',
      assertFresh: () => {}, expectedCandidateDigest: reviewDigest(replacement), expectedBaseDigest: reviewDigest(current) });
    expect(auditAdoption(dir)).toContain('luna-chat-extension@0.2.0');
    expect(auditAdoption(dir)).toContain('non-author-reviewed');
    const manifestPath = path.join(dir, '.bce-adoption.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const change of [{ mode: 'advisory' }, { ratified: false }, { blueprintRef: 'luna-chat-extension@9.0.0' }, { reviewMode: 'self-ratified' }]) {
      fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, ...change }));
      expect(() => auditAdoption(dir)).toThrow();
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    fs.writeFileSync(blueprint, JSON.stringify({ ...replacement, metadata: { ...replacement.metadata, status: 'approved' }, intentRefs: ['changed'] }));
    expect(() => auditAdoption(dir)).toThrow(/matching authenticated policy history/);
  });

  it('graduation records unratified enforcement truthfully and refuses symlink or contradictory records before writes', () => {
    const { dir } = governedRepo();
    writeModeConfig(dir, 'advisory');
    const manifestPath = path.join(dir, '.bce-adoption.json');
    const proposed = { schemaVersion: '1', state: 'proposed', ratified: false, mode: 'advisory', blueprintRef: 'luna-chat-extension@0.1.0' };
    fs.writeFileSync(manifestPath, JSON.stringify(proposed));
    transitionAdoptionMode(dir, 'enforced', 'Block even while steward ratification is pending.');
    expect(auditAdoption(dir)).toContain('enforced-unratified');
    fs.writeFileSync(manifestPath, JSON.stringify(proposed));
    expect(() => transitionAdoptionMode(dir, 'enforced', 'no-op')).toThrow(/contradicts/);
    expect(readGraduationRecord(dir)).toHaveLength(1);
    expect(resolveMode(dir).mode).toBe('enforced');
    fs.unlinkSync(manifestPath);
    const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bce-outside-')), 'manifest.json');
    fs.writeFileSync(outside, JSON.stringify(proposed));
    fs.symlinkSync(outside, manifestPath);
    expect(() => transitionAdoptionMode(dir, 'advisory', 'Deliberate recorded downgrade.')).toThrow(/symbolic link/);
    expect(JSON.parse(fs.readFileSync(outside, 'utf8'))).toEqual(proposed);
    expect(readGraduationRecord(dir)).toHaveLength(1);
  });

  it('refuses a symlinked governed directory without writing outside the repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-policy-link-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-policy-outside-'));
    fs.symlinkSync(outside, path.join(dir, '.blueprints'), 'dir');
    const proposalDir = path.join(dir, '.bce', 'proposals', 'candidate');
    fs.mkdirSync(proposalDir, { recursive: true });
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'luna-chat-extension.blueprint.json'), 'utf8'));
    raw.metadata.status = 'draft';
    const candidate = path.join(proposalDir, 'candidate.blueprint.json');
    fs.writeFileSync(candidate, stableStringify(raw));
    const candidateDigest = reviewDigest(raw);
    expect(() => ratifyBlueprint({
      repoDir: dir, blueprintPath: candidate, review: review(candidateDigest, null), proof: 'extractor-real',
      assertFresh: () => {},
      expectedCandidateDigest: candidateDigest, expectedBaseDigest: null,
    })).toThrow(/symbolic link|real in-repository/);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('authored CLI review entrypoint', () => {
  it('prepares and verifies an eligible packet from a committed local contract without an assistant', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-authored-cli-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.mkdirSync(path.join(dir, '.blueprints'));
    fs.writeFileSync(path.join(dir, 'src/service.ts'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(dir, 'docs/intent.md'), 'All dependencies must avoid axios.\n');
    fs.writeFileSync(path.join(dir, 'docs/unrelated.md'), 'UNRELATED_SOURCE_NOT_SELECTED_FOR_REVIEW\n');
    const candidate = {
      apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
      metadata: { id: 'authored-boundary', version: '0.1.0', status: 'draft' },
      intentRefs: ['docs/intent.md'], scope: { repositories: ['example/repo'] },
      architecture: { components: [], relationships: [] },
      constraints: [{ id: 'no-axios', type: 'forbiddenDependency', from: '*', to: 'axios', severity: 'high' }],
      evidenceRequirements: [], approvals: [], extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
    };
    fs.writeFileSync(path.join(dir, '.blueprints/authored.blueprint.json'), stableStringify(candidate));
    fs.writeFileSync(path.join(dir, '.blueprints/authored.teeth-mutations.json'), stableStringify({
      schemaVersion: '1', blueprintRef: 'authored-boundary@0.1.0', allowedMutationRoots: ['src'],
      cases: [{ id: 'plant-axios-import', constraintId: 'no-axios', expectedEvidencePath: 'src/service.ts',
        operation: { kind: 'appendText', target: 'src/service.ts',
          preconditionSha256: createHash('sha256').update('export const value = 1;\n').digest('hex'),
          content: '\nimport axios from "axios";\n' } }],
    }));
    const git = (args: string[]) => {
      const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    git(['init', '-b', 'main']);
    git(['add', 'src', 'docs', '.blueprints']);
    git(['-c', 'user.name=Test Steward', '-c', 'user.email=steward@example.com', 'commit', '-m', 'test: authored contract']);
    git(['remote', 'add', 'origin', 'https://github.com/example/repo.git']);
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const prepared = cli(['review', 'prepare', '--repo', dir, '--blueprint', '.blueprints/authored.blueprint.json', '--new', '--proposal-id', 'first-ceremony']);
    expect(prepared.status, prepared.out).toBe(0);
    expect(prepared.out).toContain('approval eligible');
    const packet = '.bce/proposals/first-ceremony/review-packet.json';
    expect(fs.readFileSync(path.join(dir, packet), 'utf8')).not.toContain('UNRELATED_SOURCE_NOT_SELECTED_FOR_REVIEW');
    const verified = cli(['review', 'verify', '--repo', dir, '--packet', packet]);
    expect(verified.status, verified.out).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, '.blueprints/authored.blueprint.json'), 'utf8'))).toEqual(candidate);
    fs.appendFileSync(path.join(dir, 'src/service.ts'), 'export const newValue = 2;\n');
    expect(cli(['review', 'verify', '--repo', dir, '--packet', packet]).status).toBe(2);
  });
});
