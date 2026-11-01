import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startAttempt, recordUse, finishAttempt, summarizeAttempts } from '../scripts/adoption-attempts.mjs';
import { parseBlueprint, evaluate, stableStringify } from '../src/index.js';
import { assembleGateReportDoc } from '../src/gate.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/adoption-attempts.mjs');
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'bce-attempts-test-'));
  dirs.push(root);
  const store = path.join(root, '.bce/adoption-attempts');
  const blueprint = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'attempt-test', version: '1.0.0', status: 'approved', ownerRole: 'maintainer' },
    intentRefs: ['policy/no-legacy-marker'], scope: { repositories: ['test'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-legacy', type: 'forbiddenPattern', severity: 'high', pattern: 'legacy-marker' },
      { id: 'no-other', type: 'forbiddenPattern', severity: 'high', pattern: 'other-marker' }],
    extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.js'], minFiles: 1 },
    minEngineVersion: '0.3.0', evidenceRequirements: [], approvals: [{ role: 'maintainer', stage: 'ratify' }],
  });
  const blueprintFile = path.join(root, 'rule.json');
  fs.writeFileSync(blueprintFile, stableStringify(blueprint));
  const input = { attemptId: 'test-attempt', participantId: 'test-author',
    relationship: { disclosed: 'synthetic author-operated test fixture, not a participant record', authorControlledMachine: true, authorOperatedRun: true },
    source: { kind: 'git-commit', identity: 'a'.repeat(40) },
    environment: { os: process.platform, architecture: process.arch, node: process.version, installSource: 'source' },
    consent: { storeLocally: true, publishRecord: false } };
  const gate = (revision = '1'.repeat(40)) => {
    const report = evaluate(blueprint, { schemaVersion: '1', ctRepoRevision: revision, components: [], guardEdges: [],
      coverage: { extractor: 'ast', filesScanned: 1, unsupported: [], scannedFiles: ['src/a.js'], patternScan: { patterns: ['legacy-marker', 'other-marker'], hits: [] } } }, 'typescript-module-graph');
    return assembleGateReportDoc({ resolvedMode: { mode: 'enforced', explicit: false }, baseline: null,
      result: { blueprintsDiscovered: 1, blueprintsSelected: 1, reports: [report], failed: false },
      blockingBlueprints: 0, newViolationsTotal: 0, baselinedViolationsTotal: 0, gateFailed: false });
  };
  const use = (revision = '1'.repeat(40), constraintId = 'no-legacy') => {
    const gateFile = path.join(root, `gate-${revision}.json`);
    fs.writeFileSync(gateFile, stableStringify(gate(revision)));
    return { gateFile, blueprintFile, repositoryId: 'test-repository', constraintId };
  };
  return { root, store, input, blueprint, blueprintFile, gate, use };
}
function cli(...args: string[]) { return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT }); }

describe('local adoption attempts (all fixtures are synthetic, not independent participants)', () => {
  it('keeps canonical witnesses unchanged and an empty local denominator without creating records', () => {
    const f = fixture();
    const before = fs.readFileSync(path.join(ROOT, 'research/adoption-program.json'));
    const summary = summarizeAttempts({ store: f.store });
    expect(summary.localClaims).toMatchObject({ started: 0, unfinished: 0, claimedRepeatUses: 0 });
    expect(summary.acceptedIndependentAdded).toBe(0);
    expect(summary.canonicalProgram.outcomes.acceptedIndependent).toBe(JSON.parse(before.toString('utf8')).outcomes.acceptedIndependent);
    expect(fs.existsSync(f.store)).toBe(false);
    expect(fs.readFileSync(path.join(ROOT, 'research/adoption-program.json'))).toEqual(before);
  });

  it('retains unfinished, failed, and abandoned attempts in the denominator', () => {
    const f = fixture();
    for (const [attemptId, outcome] of [['test-open', null], ['test-failed', 'failure'], ['test-abandoned', 'abandoned']] as const) {
      startAttempt({ store: f.store, input: { ...f.input, attemptId } });
      if (outcome) finishAttempt({ store: f.store, attemptId, input: { outcome, reason: 'synthetic test outcome' } });
    }
    expect(summarizeAttempts({ store: f.store }).localClaims).toMatchObject({ started: 3, unfinished: 1, failure: 1, abandoned: 1, success: 0 });
    expect(() => startAttempt({ store: f.store, input: { ...f.input, attemptId: 'test-failed' } })).toThrow();
    expect(() => finishAttempt({ store: f.store, attemptId: 'test-failed', input: { outcome: 'success', reason: 'overwrite' } })).toThrow();
  });

  it('counts distinct revisions across attempts, with linkable rule/gate evidence, without same-revision inflation', () => {
    const f = fixture();
    startAttempt({ store: f.store, input: f.input });
    const one = recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use() });
    recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use('1'.repeat(40), 'no-other') });
    finishAttempt({ store: f.store, attemptId: f.input.attemptId, input: { outcome: 'success', reason: 'synthetic completion' } });
    startAttempt({ store: f.store, input: { ...f.input, attemptId: 'test-return' } });
    recordUse({ store: f.store, attemptId: 'test-return', input: f.use() });
    expect(summarizeAttempts({ store: f.store }).localClaims.claimedRepeatUses).toBe(0);
    recordUse({ store: f.store, attemptId: 'test-return', input: f.use('2'.repeat(40)) });
    const result = summarizeAttempts({ store: f.store });
    expect(result.localClaims).toMatchObject({ started: 2, success: 1, unfinished: 1, claimedRepeatUses: 1 });
    expect(result.localClaims.repeatedUse[0].distinctRevisions).toBe(2);
    for (const evidence of result.localClaims.repeatedUse[0].evidence) {
      expect(fs.existsSync(path.join(f.store, evidence.event))).toBe(true);
      expect(fs.existsSync(path.join(f.store, evidence.gate))).toBe(true);
      expect(fs.existsSync(path.join(f.store, evidence.blueprint))).toBe(true);
    }
    expect(one.payload.gate.sha256).toBe(digest(fs.readFileSync(path.join(f.store, one.payload.gate.ref))));
    expect(result.acceptedIndependentAdded).toBe(0);
    expect(result.localClaims.attempts.every(attempt => attempt.authorOperatedRun)).toBe(true);
  });

  it('does not inflate repeated revisions when a different gate artifact is supplied', () => {
    const f = fixture();
    startAttempt({ store: f.store, input: f.input });
    recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use() });
    const input = f.use();
    const changed = f.gate();
    changed.warnings.push('synthetic additional warning');
    fs.writeFileSync(input.gateFile, stableStringify(changed));
    recordUse({ store: f.store, attemptId: f.input.attemptId, input });
    expect(summarizeAttempts({ store: f.store }).localClaims.claimedRepeatUses).toBe(0);
  });

  it('refuses self-declared acceptance, publication, reserved IDs, and success without gate evidence', () => {
    const f = fixture();
    expect(() => startAttempt({ store: f.store, input: { ...f.input, adjudication: { status: 'accepted-independent' } } })).toThrow(/invalid attempt event/);
    expect(() => startAttempt({ store: f.store, input: { ...f.input, consent: { storeLocally: true, publishRecord: true } } })).toThrow(/invalid attempt event/);
    expect(() => startAttempt({ store: f.store, input: { ...f.input, attemptId: 'artifacts' } })).toThrow(/reserved/);
    startAttempt({ store: f.store, input: f.input });
    expect(() => finishAttempt({ store: f.store, attemptId: f.input.attemptId, input: { outcome: 'success', reason: 'unsupported success' } })).toThrow(/requires at least one/);
    expect(summarizeAttempts({ store: f.store }).localClaims.unfinished).toBe(1);
  });

  it('refuses unknown rules, wrong report/blueprint identity, and unpinned revisions', () => {
    const f = fixture();
    startAttempt({ store: f.store, input: f.input });
    expect(() => recordUse({ store: f.store, attemptId: f.input.attemptId, input: { ...f.use(), constraintId: 'missing' } })).toThrow(/not present/);
    const input = f.use();
    const gate = f.gate();
    gate.reports[0]!.blueprintRef = 'different@1.0.0';
    fs.writeFileSync(input.gateFile, stableStringify(gate));
    expect(() => recordUse({ store: f.store, attemptId: f.input.attemptId, input })).toThrow(/exactly one report/);
    expect(() => recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use('unpinned') })).toThrow(/exact Git revision/);
  });

  it('retains refused gate attempts without counting them as gradeable use', () => {
    const f = fixture();
    startAttempt({ store: f.store, input: f.input });
    const input = f.use();
    const gate = f.gate();
    gate.outcome = 'refusal'; gate.gateFailed = true; gate.exitCode = 2; gate.refusals.push('synthetic incomplete evidence');
    fs.writeFileSync(input.gateFile, stableStringify(gate));
    recordUse({ store: f.store, attemptId: f.input.attemptId, input });
    const result = summarizeAttempts({ store: f.store });
    expect(result.localClaims.attempts[0].recordedGateArtifacts).toBe(1);
    expect(result.localClaims.repeatedUse).toEqual([]);
    expect(() => finishAttempt({ store: f.store, attemptId: f.input.attemptId, input: { outcome: 'success', reason: 'refusal is not success' } })).toThrow();
  });

  it('detects changed artifact bytes and event records before summarizing', () => {
    const f = fixture();
    startAttempt({ store: f.store, input: f.input });
    const event = recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use() });
    const artifactPath = path.join(f.store, event.payload.gate.ref);
    const original = fs.readFileSync(artifactPath);
    fs.appendFileSync(artifactPath, '\n');
    expect(() => summarizeAttempts({ store: f.store })).toThrow(/artifact bytes changed/);
    fs.writeFileSync(artifactPath, original);
    const eventPath = path.join(f.store, f.input.attemptId, '000002.json');
    const saved = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    saved.payload.revision = '9'.repeat(40);
    fs.writeFileSync(eventPath, JSON.stringify(saved));
    expect(() => summarizeAttempts({ store: f.store })).toThrow(/digest mismatch/);
  });

  it('refuses invalid chronology, broken sequences, and unsafe stores or inputs', () => {
    const f = fixture();
    expect(() => startAttempt({ store: path.join(f.root, '.blueprints'), input: f.input })).toThrow(/store must/);
    startAttempt({ store: f.store, input: f.input });
    const next = recordUse({ store: f.store, attemptId: f.input.attemptId, input: f.use() });
    next.recordedAt = '2020-01-01T00:00:00.000Z';
    const { hash: unused, ...body } = next; void unused;
    next.hash = digest(stableStringify(body));
    fs.writeFileSync(path.join(f.store, f.input.attemptId, '000002.json'), stableStringify(next));
    expect(() => summarizeAttempts({ store: f.store })).toThrow(/time moved backwards/);
    fs.renameSync(path.join(f.store, f.input.attemptId, '000002.json'), path.join(f.store, f.input.attemptId, '000003.json'));
    expect(() => summarizeAttempts({ store: f.store })).toThrow(/sequence/);
    const input = f.use();
    fs.writeFileSync(input.gateFile, 'x'.repeat(4 * 1024 * 1024 + 1));
    expect(() => recordUse({ store: f.store, attemptId: f.input.attemptId, input })).toThrow();
  });

  it('refuses symbolic-link stores and artifact inputs', () => {
    const f = fixture();
    const outside = fixture();
    fs.symlinkSync(outside.root, path.join(f.root, '.bce'), 'dir');
    expect(() => startAttempt({ store: f.store, input: f.input })).toThrow(/symbolic links/);
    fs.unlinkSync(path.join(f.root, '.bce'));
    startAttempt({ store: f.store, input: f.input });
    const input = f.use();
    const link = path.join(f.root, 'gate-link.json');
    fs.symlinkSync(input.gateFile, link);
    expect(() => recordUse({ store: f.store, attemptId: f.input.attemptId, input: { ...input, gateFile: link } })).toThrow(/symbolic link/);
    expect(summarizeAttempts({ store: f.store }).localClaims.unfinished).toBe(1);
  });

  it('runs the real local CLI with two actual gate revisions, without changing canonical witness files', () => {
    const f = fixture();
    const canonicalPaths = ['research/adoption-program.json', 'release-state.json', 'ATTESTATIONS.md'];
    const before = canonicalPaths.map(file => digest(fs.readFileSync(path.join(ROOT, file))));
    const repo = path.join(f.root, 'consumer');
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.blueprints'));
    fs.writeFileSync(path.join(repo, '.blueprints/test.blueprint.json'), stableStringify(f.blueprint));
    fs.writeFileSync(path.join(repo, 'src/test.js'), 'export const value = 1;\n');
    execFileSync('git', ['init', '-q', repo]);
    const commit = () => { execFileSync('git', ['-C', repo, 'add', '.']); execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'synthetic local CLI fixture']); };
    commit();
    const startFile = path.join(f.root, 'start.json');
    fs.writeFileSync(startFile, JSON.stringify(f.input));
    const started = cli('start', '--store', f.store, '--input', startFile);
    expect(started.status, started.stderr).toBe(0);
    for (let index = 0; index < 2; index++) {
      if (index) { fs.appendFileSync(path.join(repo, 'src/test.js'), 'export const next = 2;\n'); commit(); }
      const gateFile = path.join(f.root, `actual-gate-${index}.json`);
      const gateRun = spawnSync(process.execPath, [path.join(ROOT, 'dist/cli.js'), 'gate', '--repo', repo, '--report-json', gateFile], { encoding: 'utf8' });
      expect(gateRun.status, gateRun.stderr).toBe(0);
      const useFile = path.join(f.root, 'use.json');
      fs.writeFileSync(useFile, JSON.stringify({ gateFile, blueprintFile: path.join(repo, '.blueprints/test.blueprint.json'), repositoryId: 'local-cli-test', constraintId: 'no-legacy' }));
      const used = cli('use', '--store', f.store, '--attempt', f.input.attemptId, '--input', useFile);
      expect(used.status, used.stderr).toBe(0);
    }
    const summary = cli('summary', '--store', f.store);
    expect(summary.status, summary.stderr).toBe(0);
    expect(JSON.parse(summary.stdout).localClaims).toMatchObject({ started: 1, unfinished: 1, claimedRepeatUses: 1 });
    expect(JSON.parse(summary.stdout).acceptedIndependentAdded).toBe(0);
    expect(canonicalPaths.map(file => digest(fs.readFileSync(path.join(ROOT, file))))).toEqual(before);
    expect(cli('start', '--store', f.store, '--input', startFile).status).toBe(2);
  });
});
