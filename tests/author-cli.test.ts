/**
 * Quality matrix for the `bce author` (alias `bce init`) model-agnostic authoring verb.
 * Drives the real CLI (spawn tsx on src/cli.ts — same idiom as apply-cli.test.ts) and proves:
 *   - author → validate ROUND-TRIP: the written artifact passes `bce validate` AND parseBlueprint
 *   - EVERY constraint type in ConstraintTypeSchema is authorable (both forbiddenEgress modes)
 *   - refusal paths are fail-closed: missing --id / --intent-ref (schema min 1) / --constraint
 *     (schema min 1) / unknown constraint type / malformed minimumMetric / plugin-surface without
 *     --scope-paths / missing --repository when underivable
 *   - the scaffold is born status:draft @ 0.1.0 with the severity grammar honored
 *   - scan-based sanity: --repo with a matching scope succeeds; a scope matching 0 files exits 2
 * No LLM, no network — pure CLI + filesystem.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlueprint, ConstraintTypeSchema } from '../src/schema.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.ts');

let tmp: string;

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    // `node --import tsx` not `npx tsx` — skips npx's per-invocation package-resolution walk
    // (the dominant, variable cold-start cost), byte-identical output, ~30-45% faster on CI.
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

/** minimal valid author invocation (id + 1 intent + 1 constraint + explicit repository). */
function baseArgs(out: string, extra: string[] = []): string[] {
  return [
    'author',
    '--id', 'authored-under-test',
    '--intent-ref', 'policy/gateway-choke-point',
    '--constraint', 'forbiddenDependency:@anthropic-ai/sdk',
    '--repository', 'example-org/example',
    '--out', out,
    ...extra,
  ];
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bce-author-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('bce author — model-agnostic scaffold generator', () => {
  it('author → validate ROUND-TRIP: the written draft passes bce validate + parseBlueprint', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli(baseArgs(out));
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/authored DRAFT blueprint authored-under-test@0\.1\.0/);
    expect(r.stdout).toMatch(/schema-VALID, round-tripped/);
    expect(existsSync(out)).toBe(true);
    // in-process strict parse
    const bp = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    expect(bp.metadata.status).toBe('draft');
    expect(bp.metadata.version).toBe('0.1.0');
    expect(bp.scope.repositories).toEqual(['example-org/example']);
    // the CLI validate verb agrees
    const v = runCli(['validate', '--blueprint', out]);
    expect(v.code).toBe(0);
    expect(v.stdout).toMatch(/blueprint VALID: authored-under-test@0\.1\.0/);
  }, 60000);

  it('EVERY constraint type in ConstraintTypeSchema is authorable (incl. both forbiddenEgress modes)', () => {
    const out = join(tmp, 'all.json');
    const specs = [
      'forbiddenDependency:@anthropic-ai/sdk:critical',
      'requiredDependency:pluginSurface',
      'requiredComponent:apiRouteHandler',
      'forbiddenPath:src/legacy/**',
      'forbiddenFile:src/**/beta-*provisioner*.ts',
      'forbiddenEgress:api.openai.com,api.anthropic.com',
      'forbiddenEgress:governed=api-gateway,internal.example.com:critical',
      'requiredEvidence:staticAst:medium',
      'minimumMetric:coverage=0.8:low',
      'customPolicy:policy/gateway-choke-point',
      'behavioralInvariant:dashboard-varies-with-query:critical',
      'forbiddenPattern:Math\\.random\\(:critical',
    ];
    const r = runCli([
      'author',
      '--id', 'every-type',
      '--intent-ref', 'intent-a',
      '--repository', 'example-org/example',
      '--out', out,
      ...specs.flatMap((s) => ['--constraint', s]),
    ]);
    expect(r.code).toBe(0);
    const bp = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    expect(bp.constraints).toHaveLength(specs.length);
    // every enum member is present at least once
    const authoredTypes = new Set(bp.constraints.map((c) => c.type));
    for (const t of ConstraintTypeSchema.options) expect(authoredTypes.has(t)).toBe(true);
    // spot-check type-specific field mapping + the severity grammar
    const byType = (t: string) => bp.constraints.filter((c) => c.type === t);
    expect(byType('forbiddenDependency')[0]).toMatchObject({ from: '*', to: '@anthropic-ai/sdk', severity: 'critical' });
    expect(byType('requiredDependency')[0]).toMatchObject({ component: 'pluginSurface', severity: 'high' });
    expect(byType('requiredComponent')[0]).toMatchObject({ component: 'apiRouteHandler' });
    expect(byType('forbiddenPath')[0]).toMatchObject({ path: 'src/legacy/**' });
    expect(byType('forbiddenFile')[0]).toMatchObject({ path: 'src/**/beta-*provisioner*.ts' });
    expect(byType('forbiddenEgress')[0]).toMatchObject({ forbiddenEgressHosts: ['api.openai.com', 'api.anthropic.com'] });
    expect(byType('forbiddenEgress')[1]).toMatchObject({ governedHosts: ['api-gateway', 'internal.example.com'], severity: 'critical' });
    expect(byType('requiredEvidence')[0]).toMatchObject({ evidenceType: 'staticAst', severity: 'medium' });
    expect(byType('minimumMetric')[0]).toMatchObject({ metric: 'coverage', minimum: 0.8, severity: 'low' });
    // customPolicy arg may itself contain ':' — joined back verbatim
    expect(byType('customPolicy')[0]).toMatchObject({ policyRef: 'policy/gateway-choke-point' });
    expect(byType('behavioralInvariant')[0]).toMatchObject({ behaviorRef: 'dashboard-varies-with-query', severity: 'critical' });
    // forbiddenPattern (0.9.0): internal `\(` survives the rest-join; trailing :critical is the severity
    expect(byType('forbiddenPattern')[0]).toMatchObject({ pattern: 'Math\\.random\\(', severity: 'critical' });
    // derived intended architecture is coherent with the constraints
    expect(bp.architecture.components.map((c) => c.id).sort()).toEqual(['apiRouteHandler', 'pluginSurface']);
    expect(bp.architecture.relationships.some((rel) => rel.to === '@anthropic-ai/sdk' && rel.allowed === false)).toBe(true);
    expect(bp.architecture.relationships.some((rel) => rel.to === 'api-gateway' && rel.allowed === true)).toBe(true);
  }, 60000);

  it('REFUSES with no --intent-ref (schema demands intentRefs min 1)', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli([
      'author', '--id', 'x', '--repository', 'r', '--out', out,
      '--constraint', 'forbiddenPath:src/**',
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--intent-ref/);
    expect(existsSync(out)).toBe(false); // nothing written on refusal
  }, 60000);

  it('REFUSES with zero --constraint (schema demands constraints min 1)', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli(['author', '--id', 'x', '--intent-ref', 'i', '--repository', 'r', '--out', out]);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--constraint/);
    expect(existsSync(out)).toBe(false);
  }, 60000);

  it('REFUSES an unknown constraint type, a malformed minimumMetric, and a missing --id', () => {
    const out = join(tmp, 'bp.json');
    const unknown = runCli(baseArgs(out, ['--constraint', 'noSuchType:foo']));
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/unknown constraint type 'noSuchType'/);

    const badMetric = runCli(baseArgs(out, ['--constraint', 'minimumMetric:coverage']));
    expect(badMetric.code).toBe(1);
    expect(badMetric.stderr).toMatch(/minimumMetric requires/);

    const noId = runCli(['author', '--intent-ref', 'i', '--repository', 'r', '--constraint', 'forbiddenPath:x']);
    expect(noId.code).toBe(1);
    expect(noId.stderr).toMatch(/--id/);
  }, 60000);

  // js/regex-injection (CodeQL HIGH, cli.ts:205): a `--constraint forbiddenPattern:<regex>` arg
  // is safe-compiled through the shared guard, so a ReDoS-shaped OR over-length pattern is a hard
  // refusal at parse time — never a live `new RegExp(<cli-arg>)` DoS sink, nothing written.
  it('REFUSES a forbiddenPattern with a catastrophic-backtracking (ReDoS) regex', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli(baseArgs(out, ['--constraint', 'forbiddenPattern:(a+)+']));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/forbiddenPattern/);
    expect(r.stderr).toMatch(/backtrack|redos|unsafe/i);
    expect(existsSync(out)).toBe(false); // nothing written on refusal
  }, 60000);

  it('REFUSES a forbiddenPattern with an over-length regex', () => {
    const out = join(tmp, 'bp.json');
    const overLong = 'a'.repeat(600);
    const r = runCli(baseArgs(out, ['--constraint', `forbiddenPattern:${overLong}`]));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/forbiddenPattern/);
    expect(r.stderr).toMatch(/length|cap|char/i);
    expect(existsSync(out)).toBe(false);
  }, 60000);

  it('REFUSES a forbiddenPattern with a non-compiling regex', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli(baseArgs(out, ['--constraint', 'forbiddenPattern:([unclosed']));
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/forbiddenPattern/);
    expect(r.stderr).toMatch(/compile/i);
    expect(existsSync(out)).toBe(false);
  }, 60000);

  it('REFUSES plugin-surface without --scope-paths, and a missing/underivable --repository', () => {
    const out = join(tmp, 'bp.json');
    const noPaths = runCli(baseArgs(out, ['--extraction-profile', 'plugin-surface']));
    expect(noPaths.code).toBe(1);
    expect(noPaths.stderr).toMatch(/plugin-surface requires --scope-paths/);

    const noRepo = runCli([
      'author', '--id', 'x', '--intent-ref', 'i', '--out', out,
      '--constraint', 'forbiddenPath:src/**',
    ]);
    expect(noRepo.code).toBe(1);
    expect(noRepo.stderr).toMatch(/--repository/);
  }, 60000);

  it('bce init is an alias for bce author', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli(['init', ...baseArgs(out).slice(1)]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/authored DRAFT blueprint/);
  }, 60000);

  it('scan sanity with --repo PASSES when the scope matches files (plugin-surface profile)', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(join(repo, 'src'), { recursive: true });
    writeFileSync(
      join(repo, 'src', 'sample.extension.ts'),
      "export const sampleExtension = () => ({ name: 'sample' });\n",
    );
    const out = join(tmp, 'bp.json');
    const r = runCli([
      'author',
      '--id', 'scan-ok',
      '--intent-ref', 'i',
      '--repo', repo,
      '--scope-paths', 'src/**/*.ts',
      '--extraction-profile', 'plugin-surface',
      '--constraint', 'forbiddenEgress:governed=api-gateway',
      '--out', out,
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/author sanity: scope matches 1 file\(s\)/);
    // --repository derived from the repo directory name
    const bp = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    expect(bp.scope.repositories).toEqual(['repo']);
    expect(bp.extraction?.profile).toBe('plugin-surface');
    expect(bp.extraction?.minFiles).toBe(1);
  }, 60000);

  it('authors a scoped TypeScript module boundary with an optional tsconfig', () => {
    const repo = join(tmp, 'repo');
    mkdirSync(join(repo, 'src', 'domain'), { recursive: true });
    writeFileSync(join(repo, 'src', 'domain', 'model.ts'), 'export const model = true;\n');
    writeFileSync(join(repo, 'tsconfig.json'), '{"compilerOptions":{"baseUrl":"."}}\n');
    const out = join(tmp, 'module.blueprint.json');
    const r = runCli([
      'author',
      '--id', 'domain-no-node-fs',
      '--intent-ref', 'policy/runtime-separation',
      '--repo', repo,
      '--scope-paths', 'src/**/*.ts',
      '--extraction-profile', 'typescript-module-graph',
      '--tsconfig', 'tsconfig.json',
      '--constraint', 'forbiddenDependency:builtin:fs:critical',
      '--constraint', 'requiredDependency:typescriptModule->module:src/domain/**:high',
      '--out', out,
    ]);
    expect(r.code).toBe(0);
    const bp = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    expect(bp.extraction).toMatchObject({
      profile: 'typescript-module-graph',
      paths: ['src/**/*.ts'],
      minFiles: 1,
      tsconfig: 'tsconfig.json',
    });
    expect(bp.minEngineVersion).toBe('0.3.0');
    for (const constraint of bp.constraints) expect(constraint.scopePaths).toEqual(['src/**/*.ts']);
    expect(bp.constraints[1]).toMatchObject({
      component: 'typescriptModule',
      to: 'module:src/domain/**',
    });
  }, 60000);

  it('scan sanity FAILS CLOSED (exit 2) when the scope matches 0 files — draft left for editing', () => {
    const repo = join(tmp, 'empty-repo');
    mkdirSync(repo, { recursive: true });
    const out = join(tmp, 'bp.json');
    const r = runCli([
      'author',
      '--id', 'scan-empty',
      '--intent-ref', 'i',
      '--repo', repo,
      '--scope-paths', 'src/**/*.ts',
      '--extraction-profile', 'plugin-surface',
      '--constraint', 'forbiddenPath:src/legacy/**',
      '--out', out,
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/author sanity FAILED: the blueprint scope matched 0 files/);
    expect(existsSync(out)).toBe(true); // the draft IS written — the sanity verdict is about the repo
  }, 60000);

  it('duplicate constraint fragments get deterministic positional suffixes (no silent overwrite)', () => {
    const out = join(tmp, 'bp.json');
    const r = runCli([
      'author', '--id', 'dupes', '--intent-ref', 'i', '--repository', 'r', '--out', out,
      '--constraint', 'forbiddenPath:src/legacy/**',
      '--constraint', 'forbiddenPath:src/legacy/**:critical',
    ]);
    expect(r.code).toBe(0);
    const bp = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    const ids = bp.constraints.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  }, 60000);
});
