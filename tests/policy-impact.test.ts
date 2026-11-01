import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import { reviewPolicyImpact, reviewArchitectureChange } from '../src/proposal-io.js';
import { buildPolicyImpactReview, policyImpactExitCode, type ArchitectureReviewSnapshot } from '../src/review.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { resolveExtraction } from '../src/extractors.js';
import { resolveToolchainIdentity } from '../src/runtime-identity.js';
import { resolveEngineVersion } from '../src/gate.js';
import { canonicalGitEnvironment } from '../src/pin.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const repoName = 'example-org/storefront';
const policy = () => parseBlueprint(JSON.parse(fs.readFileSync('fixtures/typescript-module-layering.blueprint.json', 'utf8')));
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-policy-impact-')); roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const write = (file: string, content: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); };
  git('init'); git('config', 'user.name', 'Policy fixture'); git('config', 'user.email', 'fixture@example.test');
  write('packages/app/api.ts', 'export const api = 1;\n');
  write('packages/domain/model.ts', "import { api } from '../app/api';\nexport const model = api;\n");
  const commit = () => { git('add', '.'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  return { root, git, write, commit, revision: commit() };
}
function policies() {
  const candidate = policy(), base = structuredClone(candidate);
  base.constraints[1]!.scopePaths = ['packages/app/**'];
  return { base, candidate };
}
const compare = (f: ReturnType<typeof fixture>, base: EngineeringBlueprint, candidate: EngineeringBlueprint, revision = f.revision) =>
  reviewPolicyImpact({ repoDir: f.root, revision, repoName, baseBlueprint: base, candidateBlueprint: candidate });

describe('frozen-source policy impact', () => {
  it('reports introduced, removed and retained findings with semantic changes and raw verdicts', () => {
    const f = fixture(), { base, candidate } = policies();
    const result = compare(f, base, candidate);
    expect(result.status).toBe('compared');
    expect(result.reports?.base.verdict).toBe('pass'); expect(result.reports?.candidate.verdict).toBe('fail');
    expect(result.delta?.introduced).toHaveLength(1); expect(result.delta?.removed).toEqual([]);
    expect(result.semanticDiff.changes.length).toBeGreaterThan(0); expect(policyImpactExitCode(result)).toBe(1);
    const reverse = compare(f, candidate, base);
    expect(reverse.delta?.removed).toHaveLength(1); expect(policyImpactExitCode(reverse)).toBe(0);
    expect(compare(f, candidate, candidate).delta?.retained).toHaveLength(1);
    expect(compare(f, base, candidate)).toEqual(result);
    expect(result.source?.coverage.scannedFiles).toEqual(['packages/app/api.ts', 'packages/domain/model.ts']);
    expect(result.policyDigests.base).not.toBe(result.policyDigests.candidate);
    f.write('packages/domain/model.ts', 'void import(unknownTarget);\n');
    expect(compare(f, base, candidate)).toEqual(result);
  });

  it.each(['id', 'severity'] as const)('preserves %s changes as removed and introduced findings', field => {
    const f = fixture(), base = policy(), candidate = structuredClone(base);
    if (field === 'id') candidate.constraints[1]!.id = 'renamed-boundary';
    else candidate.constraints[1]!.severity = 'low';
    const result = compare(f, base, candidate);
    expect(result.status).toBe('compared'); expect(result.delta?.introduced).toHaveLength(1);
    expect(result.delta?.removed).toHaveLength(1); expect(result.delta?.retained).toEqual([]);
  });

  it.each([
    ['minFiles', (bp: EngineeringBlueprint) => { bp.extraction!.minFiles = 3; }],
    ['paths', (bp: EngineeringBlueprint) => { bp.extraction!.paths = ['packages/domain/**']; }],
    ['constraint-derived settings', (bp: EngineeringBlueprint) => { bp.constraints[1]!.to = 'package:other'; }],
    ['scope', (bp: EngineeringBlueprint) => { bp.scope.paths = ['packages/domain/**']; }],
    ['evidence', (bp: EngineeringBlueprint) => { bp.evidenceRequirements[0]!.freshnessSeconds = 30; }],
    ['unknown evidence', (bp: EngineeringBlueprint) => { bp.evidenceRequirements[0]!.futureRequirement = true; }],
    ['constraint qualifier', (bp: EngineeringBlueprint) => { bp.constraints[1]!.futureQualifier = 'unknown'; }],
    ['engine', (bp: EngineeringBlueprint) => { bp.minEngineVersion = '999.0.0'; }],
    ['profile', (bp: EngineeringBlueprint) => { bp.extraction!.profile = 'plugin-surface'; }],
  ] as const)('refuses incompatible %s without a finding delta', (_name, mutate) => {
    const f = fixture(), base = policy(), candidate = structuredClone(base); mutate(candidate);
    const result = compare(f, base, candidate);
    expect(result.status).toBe('refused'); expect(result.delta).toBeNull(); expect(result.reports).toBeNull();
    expect(result.refusals.length).toBeGreaterThan(0); expect(policyImpactExitCode(result)).toBe(2);
  });

  it('supports valid required module dependencies and rejects duplicate constraint IDs', () => {
    const f = fixture(), bp = policy();
    bp.constraints = [{ id: 'requires-app', type: 'requiredDependency', severity: 'high', component: 'typescriptModule', to: 'module:packages/app/**', scopePaths: ['packages/domain/**'] }];
    expect(compare(f, bp, bp).reports?.candidate.verdict).toBe('pass');
    bp.constraints.push({ ...bp.constraints[0]!, severity: 'low' });
    expect(compare(f, bp, bp).refusals.join(' ')).toMatch(/duplicate constraint/);
  });

  it('ignores Git replacement objects in both frozen review flows', () => {
    const f = fixture(), { base, candidate } = policies();
    const before = compare(f, base, candidate);
    const architecture = () => reviewArchitectureChange({ repoDir: f.root, blueprint: candidate, baseRevision: f.revision, headRevision: f.revision });
    const architectureBefore = architecture();
    f.write('packages/domain/model.ts', 'export const model = 1;\n'); const different = f.commit();
    f.git('replace', f.revision, different);
    expect(compare(f, base, candidate)).toEqual(before);
    expect(architecture()).toEqual(architectureBefore);
  });

  it('removes mixed-case Git and tar environment overrides without changing the caller environment', () => {
    const keys = ['GiT_CONFIG_COUNT', 'TaR_OpTiOnS'] as const;
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      process.env[keys[0]] = '1'; process.env[keys[1]] = '--exclude=*';
      const env = canonicalGitEnvironment();
      expect(Object.keys(env).filter(key => key.toUpperCase() === 'GIT_CONFIG_COUNT' || key.toUpperCase() === 'TAR_OPTIONS')).toEqual([]);
      expect(env.HOME).toBe(process.env.HOME);
      expect(process.env[keys[0]]).toBe('1'); expect(process.env[keys[1]]).toBe('--exclude=*');
    } finally {
      for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  });

  it('ignores mutable local/global attributes and injected Git configuration at a fixed SHA', () => {
    const f = fixture(), bp = policy();
    f.write('packages/domain/model.ts', "import { api } from '../app/$Format:%s$';\nexport const model = api;\n");
    f.git('add', '.'); f.git('commit', '-qm', 'api'); const revision = f.git('rev-parse', 'HEAD');
    const preview = () => compare(f, bp, bp, revision);
    const architecture = () => reviewArchitectureChange({ repoDir: f.root, blueprint: bp, baseRevision: revision, headRevision: revision });
    const before = preview(), architectureBefore = architecture();
    expect(before.status).toBe('refused'); expect(before.refusals.join(' ')).toMatch(/unresolved imports/);
    f.write('.git/info/attributes', 'packages/domain/model.ts export-subst\n');
    expect(preview()).toEqual(before); expect(architecture()).toEqual(architectureBefore);
    fs.unlinkSync(path.join(f.root, '.git/info/attributes'));
    f.write('outside.attributes', 'packages/domain/model.ts export-subst\n');
    f.git('config', 'core.attributesFile', path.join(f.root, 'outside.attributes'));
    expect(preview()).toEqual(before); expect(architecture()).toEqual(architectureBefore);
    f.git('config', '--unset', 'core.attributesFile');
    f.write('global.gitconfig', `[core]\nattributesFile = ${path.join(f.root, 'outside.attributes').replaceAll('\\', '/')}\n`);
    const keys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'TAR_OPTIONS'] as const;
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    try {
      process.env.GIT_CONFIG_GLOBAL = path.join(f.root, 'global.gitconfig');
      expect(preview()).toEqual(before); expect(architecture()).toEqual(architectureBefore);
      process.env.GIT_CONFIG_COUNT = '1'; process.env.GIT_CONFIG_KEY_0 = 'core.attributesFile';
      process.env.GIT_CONFIG_VALUE_0 = path.join(f.root, 'outside.attributes');
      expect(preview()).toEqual(before); expect(architecture()).toEqual(architectureBefore);
      process.env.TAR_OPTIONS = '--exclude=packages/**';
      expect(preview()).toEqual(before); expect(architecture()).toEqual(architectureBefore);
    } finally {
      for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    }
  });

  it('honors immutable committed attributes while excluding mutable overrides', () => {
    const f = fixture(), bp = policy();
    f.write('packages/domain/model.ts', "import { api } from '../app/$Format:%s$';\nexport const model = api;\n");
    f.write('.gitattributes', 'packages/domain/model.ts export-subst\n');
    f.git('add', '.'); f.git('commit', '-qm', 'api'); const revision = f.git('rev-parse', 'HEAD');
    const before = compare(f, bp, bp, revision);
    expect(before.status).toBe('compared'); expect(before.reports?.candidate.verdict).toBe('fail');
    f.write('.git/info/attributes', 'packages/domain/model.ts -export-subst\n');
    expect(compare(f, bp, bp, revision)).toEqual(before);
  });

  it('refuses equally unsupported evidence and repository exclusions', () => {
    const f = fixture(), bp = policy(); bp.evidenceRequirements[0]!.type = 'runtimeProbe';
    expect(compare(f, bp, bp).refusals.join(' ')).toMatch(/staticAst/);
    const excluded = reviewPolicyImpact({ repoDir: f.root, revision: f.revision, repoName: 'other/repo', baseBlueprint: policy(), candidateBlueprint: policy() });
    expect(excluded.status).toBe('refused'); expect(excluded.refusals.join(' ')).toMatch(/excluded/);
  });

  it('refuses moving, missing and non-commit identities', () => {
    const f = fixture(), bp = policy();
    for (const revision of ['HEAD', '0'.repeat(40), f.git('rev-parse', 'HEAD^{tree}')]) {
      expect(compare(f, bp, bp, revision).status).toBe('refused');
    }
  });

  it('refuses malformed source, unresolved imports and indistinguishable dependencies', () => {
    const f = fixture(), bp = policy();
    for (const source of ['export const broken = ;\n', 'void import(unknownTarget);\n', "import { api } from '../app/api';\nexport { api } from '../app/api';\n"]) {
      f.write('packages/domain/model.ts', source);
      const result = compare(f, bp, bp, f.commit());
      expect(result.status).toBe('refused'); expect(result.delta).toBeNull();
    }
  });

  it('allows repeated dependencies outside the findings compared on the one acquired graph', () => {
    const f = fixture(), bp = policy();
    bp.constraints[1]!.scopePaths = ['packages/app/**'];
    f.write('packages/domain/model.ts', "import { api } from '../app/api';\nexport { api } from '../app/api';\n");
    const result = compare(f, bp, bp, f.commit());
    expect(result.status).toBe('compared'); expect(result.delta?.introduced).toEqual([]);
    expect(result.reports?.candidate.verdict).toBe('pass');
  });

  it('refuses submodules and tracked symlinks without following them', () => {
    const f = fixture(), bp = policy();
    f.git('update-index', '--add', '--cacheinfo', `160000,${f.revision},vendor`);
    f.git('commit', '-qm', 'gitlink');
    expect(compare(f, bp, bp, f.git('rev-parse', 'HEAD')).refusals.join(' ')).toMatch(/submodules/);
    // Build a symlink in the Git tree through its blob, portable even on hosts without symlink privileges.
    const blob = execFileSync('git', ['-C', f.root, 'hash-object', '-w', '--stdin'], { input: 'packages/app/api.ts', encoding: 'utf8' }).trim();
    f.git('update-index', '--force-remove', 'vendor');
    f.git('update-index', '--add', '--cacheinfo', `120000,${blob},link.ts`); f.git('commit', '-qm', 'symlink');
    expect(compare(f, bp, bp, f.git('rev-parse', 'HEAD')).status).toBe('refused');
  });

  it('refuses missing coverage and mismatched identities in the private projection', () => {
    const f = fixture(), bp = policy();
    const toolchain = resolveToolchainIdentity({ engineVersion: resolveEngineVersion(), extractorKind: 'ast', extractionProfile: 'typescript-module-graph' });
    const graph = makeExtractor('ast', resolveExtraction(bp.extraction, bp.constraints)).extract(f.root, f.revision);
    const snapshot: ArchitectureReviewSnapshot = { blueprint: bp, graph, toolchain, trackedFiles: [...graph.coverage.scannedFiles!], resolverInputsDigest: 'a'.repeat(64) };
    const input = { baseBlueprint: bp, candidateBlueprint: bp, revision: f.revision, repo: repoName, toolchain, acquisitionRefusals: [] };
    expect(buildPolicyImpactReview({ ...input, snapshot }).status).toBe('compared');
    snapshot.graph.components.pop();
    expect(buildPolicyImpactReview({ ...input, snapshot }).refusals.join(' ')).toMatch(/coverage/);
    snapshot.graph.ctRepoRevision = 'b'.repeat(40);
    expect(buildPolicyImpactReview({ ...input, snapshot }).refusals.join(' ')).toMatch(/identity mismatch/);
  });

  it('CLI preserves raw 0/1/2 outcomes and never overwrites inputs or prior artifacts', () => {
    const f = fixture(), { base, candidate } = policies();
    f.write('base.json', JSON.stringify(base)); f.write('candidate.json', JSON.stringify(candidate));
    const cli = path.resolve('dist/cli.js');
    const invoke = (revision = f.revision, basePath = 'base.json', candidatePath = 'candidate.json', out?: string) => spawnSync(process.execPath,
      [cli, 'policy-impact', '--repo', f.root, '--repo-name', repoName, '--revision', revision, '--base-blueprint', basePath, '--candidate-blueprint', candidatePath, ...(out ? ['--out', out] : [])],
      { cwd: f.root, encoding: 'utf8', timeout: 30_000 });
    const failed = invoke(); expect(failed.status, failed.stderr).toBe(1); expect(JSON.parse(failed.stdout).delta.introduced).toHaveLength(1);
    expect(invoke(f.revision, 'candidate.json', 'base.json').status).toBe(0);
    expect(invoke('HEAD').status).toBe(2);
    const before = fs.readFileSync(path.join(f.root, 'base.json'), 'utf8');
    expect(invoke(f.revision, 'base.json', 'candidate.json', 'base.json').status).toBe(2);
    expect(fs.readFileSync(path.join(f.root, 'base.json'), 'utf8')).toBe(before);
    expect(invoke(f.revision, 'base.json', 'candidate.json', 'impact.json').status).toBe(1);
    expect(invoke(f.revision, 'base.json', 'candidate.json', 'impact.json').status).toBe(2);
  });
});
