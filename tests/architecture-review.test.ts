import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlueprint } from '../src/schema.js';
import { resolveExtraction } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { resolveEngineVersion } from '../src/gate.js';
import { resolveToolchainIdentity } from '../src/runtime-identity.js';
import { compareArchitectureSnapshots, architectureReviewExitCode, type ArchitectureReviewSnapshot } from '../src/review.js';
import { reviewArchitectureChange } from '../src/proposal-io.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const blueprint = parseBlueprint(JSON.parse(fs.readFileSync(path.resolve('fixtures/typescript-module-layering.blueprint.json'), 'utf8')));
const toolchain = resolveToolchainIdentity({ engineVersion: resolveEngineVersion(), extractorKind: 'ast', extractionProfile: 'typescript-module-graph' });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-architecture-review-test-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Architecture fixture'); git('config', 'user.email', 'fixture@example.test');
  const write = (file: string, content: string) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), content); };
  const commit = () => { git('add', '.'); git('commit', '-m', 'fixture revision'); return git('rev-parse', 'HEAD'); };
  write('packages/app/api.ts', 'export const api = 1;\n');
  write('packages/domain/model.ts', 'export const model = 1;\n');
  const clean = commit();
  write('packages/domain/model.ts', "import { api } from '../app/api';\nexport const model = api;\n");
  const broken = commit();
  write('packages/domain/model.ts', "// line churn only\n\nimport { api } from '../app/api';\nexport const model = api;\n");
  const churn = commit();
  write('packages/domain/model.ts', 'export const model = 2;\n');
  const fixed = commit();
  return { root, write, commit, clean, broken, churn, fixed };
}
const compare = (root: string, baseRevision: string, headRevision: string) => reviewArchitectureChange({ repoDir: root, baseRevision, headRevision, blueprint });
function snapshot(root: string, revision: string): ArchitectureReviewSnapshot {
  const graph = makeExtractor('ast', resolveExtraction(blueprint.extraction, blueprint.constraints)).extract(root, revision);
  return { blueprint, toolchain, graph, trackedFiles: [...graph.coverage.scannedFiles!], resolverInputsDigest: 'a'.repeat(64) };
}

describe('observed architecture review', () => {
  it('reports a new dependency/violation, a real fix, and line-only retention from immutable commits', () => {
    const f = fixture();
    // Uncommitted source must not affect either pinned input.
    f.write('packages/domain/model.ts', "import(unknownTarget);\n");
    const added = compare(f.root, f.clean, f.broken);
    expect(added.status).toBe('compared');
    expect(added.delta?.dependencies.added).toHaveLength(1);
    expect(added.delta?.violations.added).toHaveLength(1);
    expect(architectureReviewExitCode(added)).toBe(1);
    const churn = compare(f.root, f.broken, f.churn);
    expect(churn.delta?.dependencies.added).toEqual([]);
    expect(churn.delta?.dependencies.removed).toEqual([]);
    expect(churn.delta?.violations.added).toEqual([]);
    expect(churn.delta?.violations.removed).toEqual([]);
    expect(churn.delta?.violations.retained).toHaveLength(1);
    expect(churn.delta?.violations.retained[0]?.base.evidenceRef).not.toEqual(churn.delta?.violations.retained[0]?.head.evidenceRef);
    const fixed = compare(f.root, f.broken, f.fixed);
    expect(fixed.delta?.violations.removed).toHaveLength(1);
    expect(fixed.delta?.dependencies.removed).toHaveLength(1);
    expect(architectureReviewExitCode(fixed)).toBe(0);
    expect(compare(f.root, f.broken, f.fixed)).toEqual(fixed);
  });

  it('refuses unavailable extraction and a moving ref instead of claiming a fix', () => {
    const f = fixture();
    expect(() => compare(f.root, 'HEAD', f.fixed)).toThrow(/immutable/);
    expect(() => compare(f.root, '0'.repeat(40), f.fixed)).toThrow();
    f.write('packages/domain/model.ts', 'export const broken = ;\n');
    const unavailable = f.commit();
    expect(() => compare(f.root, f.broken, unavailable)).toThrow(/could not parse/);
  });

  it('refuses unresolved imports and repeated dependencies without invented occurrence identity', () => {
    const f = fixture();
    f.write('packages/domain/model.ts', 'void import(target);\n');
    const unresolved = f.commit();
    const result = compare(f.root, f.broken, unresolved);
    expect(result.status).toBe('refused'); expect(result.delta).toBeNull();
    expect(result.refusals.join(' ')).toMatch(/unresolved imports/);
    f.write('packages/domain/model.ts', "import { api } from '../app/api';\nexport { api } from '../app/api';\n");
    const ambiguous = compare(f.root, f.broken, f.commit());
    expect(ambiguous.status).toBe('refused');
    expect(ambiguous.refusals.join(' ')).toMatch(/ambiguous/);
  });

  it('refuses changed policy/toolchain/configuration and same-count coverage replacement', () => {
    const f = fixture();
    const a = snapshot(f.root, f.clean);
    const malformed = structuredClone(a);
    malformed.blueprint.constraints.push({ id: 'missing-path', type: 'forbiddenPath', severity: 'high' });
    expect(compareArchitectureSnapshots(malformed, malformed).refusals.join(' ')).toMatch(/unsupported constraint/);
    const b = structuredClone(a); b.graph.ctRepoRevision = f.fixed;
    b.blueprint.constraints[0]!.severity = 'low';
    expect(compareArchitectureSnapshots(a, b).refusals.join(' ')).toMatch(/blueprint mismatch/);
    const c = structuredClone(a); c.toolchain.extractor.version = '999.0.0';
    expect(compareArchitectureSnapshots(a, c).refusals.join(' ')).toMatch(/identity mismatch/);
    const missingNew = structuredClone(a); missingNew.trackedFiles.push('packages/domain/new.ts');
    expect(compareArchitectureSnapshots(a, missingNew).refusals.join(' ')).toMatch(/coverage loss/);
    const d = structuredClone(a);
    const lost = d.graph.coverage.scannedFiles![0]!;
    d.graph.coverage.scannedFiles![0] = 'packages/other.ts';
    d.trackedFiles.push('packages/other.ts');
    d.graph.components = d.graph.components.filter(c => c.path !== lost);
    d.graph.components.push({ id: 'module:packages/other.ts', type: 'typescriptModule', path: 'packages/other.ts', line: 1 });
    const refused = compareArchitectureSnapshots(a, d);
    expect(refused.refusals.join(' ')).toMatch(/coverage loss/);
    expect(refused.delta).toBeNull(); expect(architectureReviewExitCode(refused)).toBe(2);
    f.write('tsconfig.json', '{"compilerOptions":{"baseUrl":"."}}');
    expect(compare(f.root, f.fixed, f.commit()).refusals.join(' ')).toMatch(/resolver inputs changed/);
  });

  it('freezes extended tsconfig inputs even without a JSON suffix', () => {
    const f = fixture();
    f.write('tsconfig.json', '{"extends":"./compiler-base","include":["packages/**/*.ts"]}');
    f.write('compiler-base', '{"compilerOptions":{"strict":true}}');
    const before = f.commit();
    f.write('compiler-base', '{"compilerOptions":{"strict":false}}');
    const after = f.commit();
    const configured = parseBlueprint({ ...blueprint, extraction: { ...blueprint.extraction, tsconfig: 'tsconfig.json' } });
    const result = reviewArchitectureChange({ repoDir: f.root, baseRevision: before, headRevision: after, blueprint: configured });
    expect(result.status).toBe('refused');
    expect(result.refusals.join(' ')).toMatch(/resolver inputs changed/);
  });

  it('distinguishes tracked deletion from coverage loss and reports a removal', () => {
    const f = fixture();
    f.write('packages/domain/extra.ts', 'export const extra = 1;\n');
    const before = f.commit();
    fs.unlinkSync(path.join(f.root, 'packages/domain/extra.ts'));
    const result = compare(f.root, before, f.commit());
    expect(result.status).toBe('compared');
    expect(result.delta?.components.removed.map(c => c.path)).toEqual(['packages/domain/extra.ts']);
  });

  it('runs the public CLI with machine output and exits 0/1/2 without overwriting policy', () => {
    const f = fixture();
    const bpPath = path.join(f.root, 'policy.json'); fs.writeFileSync(bpPath, JSON.stringify(blueprint));
    const cli = (base: string, head: string, more: string[] = []) => spawnSync(process.execPath, ['dist/cli.js', 'architecture-review', '--repo', f.root, '--blueprint', bpPath, '--base', base, '--head', head, ...more], { encoding: 'utf8' });
    const red = cli(f.clean, f.broken);
    expect(red.status, red.stderr).toBe(1);
    expect(JSON.parse(red.stdout).delta.violations.added).toHaveLength(1);
    expect(cli(f.broken, f.fixed).status).toBe(0);
    expect(cli('HEAD', f.fixed).status).toBe(2);
    expect(cli(f.broken, f.fixed, ['--out', bpPath]).status).toBe(2);
    expect(JSON.parse(fs.readFileSync(bpPath, 'utf8'))).toEqual(blueprint);
  });
});
