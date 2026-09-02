import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { doctorRepository, checkEngineUpgrade } from '../src/lifecycle.js';
import { readPolicyHistory } from '../src/policy-history.js';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const CHECKOUT_SHA = '11d5960a326750d5838078e36cf38b85af677262';
const SETUP_NODE_SHA = '49933ea5288caeca8642d1e84afbd3f7d6820020';

function cli(args: string[], cwd = ROOT) {
  const loader = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
  const r = spawnSync(process.execPath, ['--import', loader, CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

describe('CLI discovery is read-only', () => {
  it('short-circuits subcommand help and version before a mutating command runs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-help-'));
    fs.mkdirSync(path.join(dir, '.blueprints'));
    const before = fs.readdirSync(path.join(dir, '.blueprints'));
    const help = cli(['baseline', '--help'], dir);
    expect(help.status, help.out).toBe(0);
    expect(help.out).toContain('bce — Blueprint Compliance Engine');
    expect(fs.readdirSync(path.join(dir, '.blueprints'))).toEqual(before);
    const version = cli(['gate', '--version'], dir);
    expect(version.status, version.out).toBe(0);
    expect(version.out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(fs.readdirSync(path.join(dir, '.blueprints'))).toEqual(before);
    const unknown = cli(['author', '--harness', 'nonsense'], dir);
    expect(unknown.status).toBe(1);
    expect(unknown.out).toContain('unknown option for bce author: --harness');
  });
});

describe('doctor — read-only lifecycle readiness', () => {
  it('audits this candidate without structural refusal and exposes typed checks', () => {
    const report = doctorRepository(ROOT);
    expect(report.checks.length).toBeGreaterThan(10);
    expect(report.checks.some((c) => c.id === 'agents/mcp' && c.status === 'pass')).toBe(true);
    expect(report.checks.some((c) => c.id === 'gate/full-sweep' && c.status === 'pass')).toBe(true);
    // The development shell may itself be below the package's Node >=22 contract; doctor must
    // report that honestly while the repository's lifecycle surfaces remain structurally sound.
    expect(report.checks.filter((c) => c.status === 'refusal' && c.id !== 'runtime/node')).toEqual([]);
  });

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
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v4`);
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
    expect(workflow).toContain(`uses: actions/checkout@${CHECKOUT_SHA} # v4`);
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
    fs.writeFileSync(blueprint, JSON.stringify(raw));
    return { dir, blueprint };
  }

  const review = ['--human-reviewer', '--reviewer', 'release-steward', '--rationale',
    'Reviewed the candidate policy and its falsification proof.', '--recorded-at', '2026-09-01T12:00:00Z'];

  it('ratifies only with explicit human attestation, proof, version bump, and append-only history', () => {
    const { dir, blueprint } = governedRepo();
    const denied = cli(['ratify', '--repo', dir, '--blueprint', blueprint]);
    expect(denied.status).toBe(2);
    expect(denied.out).toContain('human-reviewer');

    const approved = cli(['ratify', '--repo', dir, '--blueprint', blueprint, ...review]);
    expect(approved.status, approved.out).toBe(0);
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata).toMatchObject({ status: 'approved', version: '0.1.1' });
    expect(readPolicyHistory(dir)).toEqual([
      expect.objectContaining({ operation: 'ratify', fromRef: 'luna-chat-extension@0.1.0', toRef: 'luna-chat-extension@0.1.1', proof: 'extractor-real' }),
    ]);
  });

  it('amends only to a higher approved same-id version and records compatibility', () => {
    const { dir, blueprint } = governedRepo();
    expect(cli(['ratify', '--repo', dir, '--blueprint', blueprint, ...review]).status).toBe(0);
    const replacement = path.join(dir, 'replacement.json');
    const raw = JSON.parse(fs.readFileSync(blueprint, 'utf8'));
    raw.metadata.version = '0.2.0';
    fs.writeFileSync(replacement, JSON.stringify(raw));
    const result = cli(['amend', '--repo', dir, '--blueprint', blueprint, '--replacement', replacement,
      '--compatibility', 'tightening', ...review]);
    expect(result.status, result.out).toBe(0);
    expect(readPolicyHistory(dir).at(-1)).toMatchObject({ operation: 'amend', compatibility: 'tightening', toRef: 'luna-chat-extension@0.2.0' });
    expect(JSON.parse(fs.readFileSync(blueprint, 'utf8')).metadata.version).toBe('0.2.0');
  });
});
