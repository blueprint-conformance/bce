import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { doctorRepository } from '../src/lifecycle.js';
import { readPolicyHistory } from '../src/policy-history.js';

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');

function cli(args: string[], cwd = ROOT) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

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
