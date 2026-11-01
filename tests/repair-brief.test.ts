import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { captureRepairEvidence, buildRepairBriefs, readRepairEvidence, REPAIR_LIMITS } from '../src/proposal-io.js';
import { parseBlueprint } from '../src/schema.js';
import { toWorkOrders } from '../src/emit.js';
import { reviewDigest } from '../src/review.js';

const dirs: string[] = [];
afterEach(() => { for (const directory of dirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const repoDir = fs.mkdtempSync(path.join(tmpdir(), 'bce-repair-'));
  dirs.push(repoDir);
  fs.mkdirSync(path.join(repoDir, 'src'));
  fs.mkdirSync(path.join(repoDir, '.blueprints'));
  const blueprintPath = '.blueprints/test.blueprint.json';
  const blueprint = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'repair-test', version: '1.0.0', status: 'approved', ownerRole: 'maintainer' },
    intentRefs: ['docs/intent.md'], scope: { repositories: ['example'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-rounding', type: 'forbiddenPattern', severity: 'high', pattern: 'Math.round' }],
    extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.mjs'], minFiles: 1 },
    minEngineVersion: '0.3.0', evidenceRequirements: [], approvals: [{ role: 'maintainer', stage: 'ratify' }],
  });
  fs.writeFileSync(path.join(repoDir, blueprintPath), JSON.stringify(blueprint));
  fs.writeFileSync(path.join(repoDir, 'src/invoice.mjs'), 'export function invoice(amount) {\n  return Math.round(amount * 100);\n}\nexport function label() { return "Invoice"; }\n');
  return { repoDir, blueprintPath, blueprint };
}
function write(root: string, name: string, content: string) { fs.writeFileSync(path.join(root, name), content); }
function cli(repoDir: string, ...args: string[]) {
  return spawnSync(process.execPath, ['dist/cli.js', 'repair', ...args, '--repo', repoDir], {
    cwd: path.resolve(import.meta.dirname, '..'), encoding: 'utf8',
  });
}

describe('evidence-bound repair briefs', () => {
  it('reuses work orders and constraint explanations with deterministic, proposed-only bounded context', () => {
    const input = fixture();
    const evidence = captureRepairEvidence(input);
    const bundle = buildRepairBriefs({ ...input, evidence });
    expect(evidence.report.verdict).toBe('fail');
    expect(bundle.briefs).toHaveLength(1);
    const brief = bundle.briefs[0]!;
    expect(brief.workOrder).toEqual(toWorkOrders(evidence.report)[0]);
    expect(brief.constraint.plainLanguage).toContain('Math.round');
    expect(brief.context.excerpt).toContain('function invoice');
    expect(brief.context.neighboringDeclarations.length).toBeGreaterThan(0);
    expect(brief.context.sha256).toBe(evidence.files.find(file => file.path === 'src/invoice.mjs')?.sha256);
    expect(brief.proposedScope).toMatchObject({ authority: 'NONE', approvalState: 'PROPOSED', paths: ['src/invoice.mjs'] });
    expect(brief.verification.join(' ')).toMatch(/functional regression/);
    expect(brief.verificationCommands[0]!.args).toContain(input.blueprintPath);
    expect(brief.proposedScope.restrictions.join(' ')).toMatch(/deleting functionality is not a repair/);
    expect(buildRepairBriefs({ ...input, evidence })).toEqual(bundle);
    expect(captureRepairEvidence(input)).toEqual(evidence);
    expect(fs.readdirSync(input.repoDir).sort()).toEqual(['.blueprints', 'src']);
  });

  it('rejects dirty source bytes even when HEAD and extracted report do not change', () => {
    const input = fixture();
    execFileSync('git', ['init', '-q', input.repoDir]);
    execFileSync('git', ['-C', input.repoDir, 'add', '.']);
    execFileSync('git', ['-C', input.repoDir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture']);
    const evidence = captureRepairEvidence(input);
    fs.appendFileSync(path.join(input.repoDir, 'src/invoice.mjs'), '// harmless comment\n');
    const fresh = captureRepairEvidence(input);
    expect(fresh.revision).toBe(evidence.revision);
    expect(fresh.reportDigest).toBe(evidence.reportDigest);
    expect(fresh.repositoryDigest).not.toBe(evidence.repositoryDigest);
    expect(() => buildRepairBriefs({ ...input, evidence })).toThrow(/stale or mismatched/);
  });

  it.each(['.bce-mode.json', '.blueprints/baseline.json', 'package.json'])('rejects changed policy/config bytes: %s', name => {
    const input = fixture();
    write(input.repoDir, name, '{}');
    const evidence = captureRepairEvidence(input);
    write(input.repoDir, name, '{ }');
    expect(() => buildRepairBriefs({ ...input, evidence })).toThrow(/stale or mismatched/);
  });

  it('rejects same-version blueprint changes and tampered report identities', () => {
    const input = fixture();
    const evidence = captureRepairEvidence(input);
    const forged = structuredClone(evidence);
    forged.report.violations[0]!.evidenceRef = '../outside.mjs#L1';
    forged.reportDigest = reviewDigest(forged.report);
    const { digest: ignored, ...body } = forged;
    void ignored;
    forged.digest = reviewDigest(body);
    expect(() => buildRepairBriefs({ ...input, evidence: forged })).toThrow(/stale or mismatched/);
    fs.appendFileSync(path.join(input.repoDir, input.blueprintPath), '\n');
    expect(() => buildRepairBriefs({ ...input, evidence })).toThrow(/stale or mismatched/);
  });

  it('detects newly added scanned files and removed source bytes', () => {
    const input = fixture();
    const evidence = captureRepairEvidence(input);
    write(input.repoDir, 'src/added.mjs', 'export const added = true;');
    expect(() => buildRepairBriefs({ ...input, evidence })).toThrow(/stale or mismatched/);
    fs.unlinkSync(path.join(input.repoDir, 'src/invoice.mjs'));
    expect(() => buildRepairBriefs({ ...input, evidence })).toThrow(/stale or mismatched/);
  });

  it('refuses path traversal, symlink escape, and missing input bytes', () => {
    const input = fixture();
    expect(() => captureRepairEvidence({ ...input, blueprintPath: '../escape.json' })).toThrow(/canonical/);
    expect(() => readRepairEvidence(input.repoDir, '../escape.json')).toThrow(/canonical/);
    fs.symlinkSync(path.join(input.repoDir, input.blueprintPath), path.join(input.repoDir, 'src/link.mjs'));
    expect(() => captureRepairEvidence(input)).toThrow(/symbolic link/);
    fs.unlinkSync(path.join(input.repoDir, 'src/link.mjs'));
    expect(() => captureRepairEvidence({ ...input, blueprintPath: 'missing.json' })).toThrow(/not found/);
  });

  it('refuses oversized files, credential content, and secret-like source paths', () => {
    const input = fixture();
    write(input.repoDir, 'src/large.mjs', 'x'.repeat(REPAIR_LIMITS.fileBytes + 1));
    expect(() => captureRepairEvidence(input)).toThrow(/bounded regular file/);
    fs.unlinkSync(path.join(input.repoDir, 'src/large.mjs'));
    write(input.repoDir, 'src/credential.mjs', `export const apiKey = '${'sk' + '-' + 'x'.repeat(25)}';`);
    expect(() => captureRepairEvidence(input)).toThrow(/credential-shaped/);
    fs.unlinkSync(path.join(input.repoDir, 'src/credential.mjs'));
    write(input.repoDir, 'src/secrets.mjs', 'export const value = 1;');
    expect(() => captureRepairEvidence(input)).toThrow(/secret-like/);
  });

  it('refuses unsupported reports and tsconfig resolution explicitly', () => {
    const input = fixture();
    expect(() => buildRepairBriefs({ ...input, evidence: { schemaVersion: '2', violations: [] } })).toThrow(/unsupported/);
    const blueprint = { ...input.blueprint, extraction: { ...input.blueprint.extraction, tsconfig: 'tsconfig.json' } };
    write(input.repoDir, input.blueprintPath, JSON.stringify(blueprint));
    expect(() => captureRepairEvidence(input)).toThrow(/tsconfig resolver read-set/);
    write(input.repoDir, input.blueprintPath, JSON.stringify({ ...input.blueprint, extraction: { profile: 'python-module-graph', paths: ['src/**/*.py'], pythonRoots: ['src'], minFiles: 1 } }));
    expect(() => captureRepairEvidence(input)).toThrow(/Python module target bindings/);
  });

  it('binds the executing engine artifacts and provider/runtime/dependency identity', () => {
    const input = fixture();
    const evidence = captureRepairEvidence(input);
    expect(evidence.engineArtifactDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.toolchain.dependencyLock.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.toolchain.extractor.profile).toBe('typescript-module-graph');
    for (const forged of [
      { ...evidence, engineArtifactDigest: 'a'.repeat(64) },
      { ...evidence, toolchain: { ...evidence.toolchain, dependencyLock: { ...evidence.toolchain.dependencyLock, sha256: 'b'.repeat(64) } } },
    ]) {
      const { digest: ignored, ...body } = forged;
      void ignored;
      forged.digest = reviewDigest(body);
      expect(() => buildRepairBriefs({ ...input, evidence: forged })).toThrow(/stale or mismatched/);
    }
  });

  it('keeps functional regression evidence distinct from a conformance-only deletion', () => {
    const input = fixture();
    const original = captureRepairEvidence(input);
    const bundle = buildRepairBriefs({ ...input, evidence: original });
    const functional = () => spawnSync(process.execPath, ['--input-type=module', '-e',
      'import assert from "node:assert/strict"; import {invoice, label} from "./src/invoice.mjs"; assert.equal(invoice(1.25),125); assert.equal(invoice(1.234),123); assert.equal(invoice(1.236),124); assert.equal(invoice(0),0); assert.equal(label(),"Invoice");'],
    { cwd: input.repoDir, encoding: 'utf8' }).status;
    expect(functional()).toBe(0);
    write(input.repoDir, 'src/invoice.mjs', 'export function label() { return "Invoice"; }\n');
    expect(captureRepairEvidence(input).report.verdict).toBe('pass');
    expect(functional()).not.toBe(0);
    expect(bundle.briefs[0]!.verification.join(' ')).toContain('higher conformance score alone does not prove a repair');
    write(input.repoDir, 'src/invoice.mjs', 'export function invoice(amount) { return Math.floor(amount * 100 + 0.5); }\nexport function label() { return "Invoice"; }\n');
    expect(captureRepairEvidence(input).report.verdict).toBe('pass');
    expect(functional()).toBe(0);
    expect(() => buildRepairBriefs({ ...input, evidence: original })).toThrow(/stale or mismatched/);
    expect(buildRepairBriefs({ ...input, evidence: captureRepairEvidence(input) }).briefs).toEqual([]);
  });

  it('executes the built CLI positive path, preserves inputs, and refuses stale/unsafe writes with exit 2', () => {
    const input = fixture();
    const before = fs.readFileSync(path.join(input.repoDir, input.blueprintPath), 'utf8');
    const captured = cli(input.repoDir, 'capture', '--blueprint', input.blueprintPath);
    expect(captured.status, captured.stderr).toBe(0);
    expect(captured.stdout).toContain('Captured report: fail');
    const result = cli(input.repoDir, 'brief', '--blueprint', input.blueprintPath, '--evidence', '.bce/repair/evidence.json');
    expect(result.status, result.stderr).toBe(0);
    const artifact = JSON.parse(fs.readFileSync(path.join(input.repoDir, '.bce/repair/briefs.json'), 'utf8'));
    expect(artifact.briefs[0].proposedScope.authority).toBe('NONE');
    expect(fs.readFileSync(path.join(input.repoDir, input.blueprintPath), 'utf8')).toBe(before);
    expect(cli(input.repoDir, 'capture', '--blueprint', input.blueprintPath).status).toBe(2);
    expect(cli(input.repoDir, 'capture', '--blueprint', input.blueprintPath, '--out', input.blueprintPath).status).toBe(2);
    fs.appendFileSync(path.join(input.repoDir, 'src/invoice.mjs'), '// changed\n');
    const stale = cli(input.repoDir, 'brief', '--blueprint', input.blueprintPath, '--evidence', '.bce/repair/evidence.json', '--out', '.bce/repair/next.json');
    expect(stale.status).toBe(2);
    expect(stale.stderr).toContain('stale or mismatched');
    expect(fs.existsSync(path.join(input.repoDir, '.bce/repair/next.json'))).toBe(false);
  });
});
