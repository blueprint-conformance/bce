import { toWorkOrders } from '../src/emit.js';
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseBlueprint, parsePortfolioBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { resolveExtraction } from '../src/extractors.js';
import { evaluate, DependencyPathRefusal, stableStringify } from '../src/report.js';
import { runGate } from '../src/gate.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { assessExtractorTeethCorpus } from '../src/extractor-teeth.js';
import { compilePortfolio } from '../src/portfolio-compile.js';
import { classifyPolicyChanges } from '../src/policy-change.js';
import { explainConstraint } from '../src/review.js';
import { violationIdentity } from '../src/baseline.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'bce-dependency-path-')); dirs.push(dir);
  for (const [p, content] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); writeFileSync(path.join(dir, p), content); }
  return dir;
}
function blueprint(): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'bounded-module-boundary', version: '0.1.0', status: 'draft' },
    intentRefs: ['intent/bounded-layering'], scope: { repositories: ['example/repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'domain-cannot-reach-app', type: 'forbiddenDependencyPath', severity: 'critical', maxHops: 2, to: 'module:src/app/**', scopePaths: ['src/domain/**'] }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }], approvals: [],
    minEngineVersion: '0.6.1', extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.ts'], minFiles: 1 },
  });
}
const greenFiles = { 'src/domain/order.ts': "import { helper } from '../bridge.js';\nexport const order = helper;\n", 'src/bridge.ts': 'export const helper = 1;\n', 'src/app/view.ts': 'export const view = 1;\n' };
function graph(dir: string, bp = blueprint()) { const cfg = resolveExtraction(bp.extraction, bp.constraints); return makeExtractor('ast', cfg).extract(dir, 'revision'); }
function grade(dir: string, bp = blueprint()) { return evaluate(bp, graph(dir, bp), 'typescript-module-graph'); }
function saveBlueprint(dir: string, bp = blueprint()) { mkdirSync(path.join(dir, '.blueprints'), { recursive: true }); writeFileSync(path.join(dir, '.blueprints/policy.blueprint.json'), stableStringify(bp)); }
function cli(...args: string[]) { return spawnSync(process.execPath, [path.resolve('dist/cli.js'), ...args], { encoding: 'utf8' }); }

describe('proposed explicit two-hop dependency boundary', () => {
  it('proves RED for a real two-hop path, GREEN after correction, and unchanged direct semantics', () => {
    const dir = tree({ ...greenFiles, 'src/bridge.ts': "import { view } from './app/view.js';\nexport const helper = view;\n" });
    const report = grade(dir);
    expect(report.schemaVersion).toBe('1'); expect(report.verdict).toBe('fail');
    expect(report.violations).toMatchObject([{ component: 'module:src/domain/order.ts', evidenceRef: 'src/bridge.ts#L1' }]);
    expect(report.violations[0]!.observed).toBe('forbidden dependency path (2 hops): module:src/domain/order.ts --[src/domain/order.ts#L1]--> module:src/bridge.ts --[src/bridge.ts#L1]--> module:src/app/view.ts');
    const direct = blueprint(); direct.constraints[0]!.type = 'forbiddenDependency'; delete direct.constraints[0]!.maxHops;
    expect(grade(dir, parseBlueprint(direct)).verdict).toBe('pass');
    writeFileSync(path.join(dir, 'src/bridge.ts'), greenFiles['src/bridge.ts']);
    expect(grade(dir).verdict).toBe('pass');
  });
  it('emits distinct work orders when two source paths converge on the same final import', () => {
    const dir = tree({ ...greenFiles,
      'src/domain/order.ts': "import { helper } from '../bridge.js';\nexport { helper } from '../bridge.js';\nexport const order = helper;\n",
      'src/bridge.ts': "import { view } from './app/view.js';\nexport const helper = view;\n",
    });
    const report = grade(dir);
    expect(report.violations).toHaveLength(2);
    expect(new Set(report.violations.map(v => v.evidenceRef)).size).toBe(1);
    const orders = toWorkOrders(report);
    expect(new Set(orders.map(order => order.id)).size).toBe(2);
    expect(orders.map(order => order.body)).toEqual(expect.arrayContaining([
      expect.stringContaining('src/domain/order.ts#L1'),
      expect.stringContaining('src/domain/order.ts#L2'),
    ]));
  });
  it('includes direct paths and type-only/re-export edges from the real provider', () => {
    const direct = tree({ ...greenFiles, 'src/domain/order.ts': "import type { View } from '../app/view.js';\nexport type Order = View;\n", 'src/app/view.ts': 'export interface View { id: string }\n' });
    expect(grade(direct).violations[0]!.observed).toContain('(1 hop)');
    const two = tree({ ...greenFiles, 'src/domain/order.ts': "import type { View } from '../bridge.js';\nexport type Order = View;\n", 'src/bridge.ts': "export type { View } from './app/view.js';\n", 'src/app/view.ts': 'export interface View { id: string }\n' });
    expect(grade(two).violations[0]!.observed).toContain('(2 hops)');
  });
  it('stops at the explicit bound; third-hop-only reachability is outside the contract', () => {
    const dir = tree({ ...greenFiles, 'src/bridge.ts': "import { helper } from './far.js';\nexport { helper };\n", 'src/far.ts': "import { view } from './app/view.js';\nexport const helper = view;\n" });
    expect(grade(dir).verdict).toBe('pass');
  });
  it('refuses unresolved roots/intermediates, deleted intermediates, and unscanned intermediates', () => {
    const unresolved = tree({ ...greenFiles, 'src/bridge.ts': 'export const helper = import(process.env.TARGET);\n' });
    expect(() => grade(unresolved)).toThrow(DependencyPathRefusal);
    expect(() => grade(unresolved)).toThrow('src/bridge.ts#L1');
    const missing = tree(greenFiles); rmSync(path.join(missing, 'src/bridge.ts'));
    expect(() => grade(missing)).toThrow('unresolved imports');
    const unscanned = tree(greenFiles), bp = blueprint(); bp.extraction!.paths = ['src/domain/**/*.ts'];
    expect(() => grade(unscanned, bp)).toThrow('not a scanned TypeScript module');
    const rootUnknown = tree({ ...greenFiles, 'src/domain/order.ts': "import './missing.js';\n" });
    expect(() => grade(rootUnknown)).toThrow('unresolved imports');
  });
  it('refuses zero roots or missing scan coverage; irrelevant uncertainty stays outside the bound', () => {
    const dir = tree({ ...greenFiles, 'src/unrelated.ts': 'void import(process.env.UNRELATED);\n' });
    expect(grade(dir).verdict).toBe('pass');
    const bp = blueprint(); bp.constraints[0]!.scopePaths = ['src/absent/**'];
    expect(() => grade(dir, bp)).toThrow('no source modules match');
    const g = graph(dir); delete g.coverage.scannedFiles;
    expect(() => evaluate(blueprint(), g, 'typescript-module-graph')).toThrow('scannedFiles coverage is absent');
  });
  it('handles package/builtin terminal endpoints without inferring external adjacency', () => {
    const dir = tree({ ...greenFiles, 'src/bridge.ts': "import fs from 'node:fs';\nexport const helper = fs;\n" });
    const bp = blueprint(); bp.constraints[0]!.to = 'builtin:fs';
    expect(grade(dir, bp).violations[0]!.observed).toContain('builtin:fs');
    const pkg = tree({ ...greenFiles, 'package.json': '{"dependencies":{"zod":"1.0.0"}}', 'src/bridge.ts': "import { z } from 'zod';\nexport const helper = z;\n" });
    bp.constraints[0]!.to = 'package:zod';
    expect(grade(pkg, bp).verdict).toBe('fail');
    bp.constraints[0]!.to = 'package:other'; expect(grade(pkg, bp).verdict).toBe('pass');
  });
  it('keeps witness choice deterministic and violation identity stable under line churn', () => {
    const dir = tree({ ...greenFiles, 'src/bridge.ts': "import { view } from './app/view.js';\nexport const helper = view;\n" });
    const bp = blueprint(), g = graph(dir), a = evaluate(bp, g, 'typescript-module-graph');
    const reversed = { ...g, components: [...g.components].reverse(), guardEdges: [...g.guardEdges].reverse() };
    expect(evaluate(bp, reversed, 'typescript-module-graph').violations).toEqual(a.violations);
    writeFileSync(path.join(dir, 'src/domain/order.ts'), '\n\n' + greenFiles['src/domain/order.ts']);
    writeFileSync(path.join(dir, 'src/bridge.ts'), "\nimport { view } from './app/view.js';\nexport const helper = view;\n");
    const b = grade(dir);
    expect(b.violations[0]!.observed).toContain('order.ts#L3'); expect(b.violations[0]!.evidenceRef).toBe('src/bridge.ts#L2');
    expect(violationIdentity(a.blueprintRef, a.violations[0]!)).toBe(violationIdentity(b.blueprintRef, b.violations[0]!));
  });
  it('validates explicit scope/bound/provider and an engine floor above the released tolerant gate', () => {
    for (const change of [
      (b: EngineeringBlueprint) => { delete b.constraints[0]!.maxHops; },
      (b: EngineeringBlueprint) => { b.constraints[0]!.scopePaths = []; },
      (b: EngineeringBlueprint) => { b.constraints[0]!.scopePaths = ['../outside/**']; },
      (b: EngineeringBlueprint) => { b.constraints[0]!.to = 'unqualified'; },
      (b: EngineeringBlueprint) => { b.extraction!.profile = 'plugin-surface'; },
      (b: EngineeringBlueprint) => { b.minEngineVersion = '0.6.0'; },
      (b: EngineeringBlueprint) => { b.constraints[0]!.type = 'forbiddenDependency'; },
    ]) { const b = blueprint(); change(b); expect(() => parseBlueprint(b)).toThrow(); }
    expect(() => parseBlueprint({ ...blueprint(), constraints: [{ ...blueprint().constraints[0], maxHops: 3 }] })).toThrow();
  });
  it('propagates the candidate floor through portfolio validation and compilation', () => {
    const raw = JSON.parse(readFileSync('fixtures/portfolio/demo-fleet.portfolio-blueprint.json', 'utf8'));
    raw.fleetConstraints = blueprint().constraints; raw.extraction = blueprint().extraction;
    expect(() => parsePortfolioBlueprint(raw)).toThrow('enginePin >=0.6.1');
    for (const member of raw.members) member.enginePin = '0.6.1';
    const portfolio = parsePortfolioBlueprint(raw);
    expect(compilePortfolio(portfolio).every(o => o.blueprint.minEngineVersion === '0.6.1')).toBe(true);
  });
  it('keeps policy review and readiness honest for the new enforcing arm', () => {
    const before = blueprint(), after = blueprint(); after.constraints[0]!.scopePaths = ['src/domain/order.ts'];
    const compare = (b: EngineeringBlueprint) => classifyPolicyChanges([{ path: '.blueprints/policy.blueprint.json', before: stableStringify(before), after: stableStringify(b) }]);
    expect(compare(after).classification).toBe('relaxation');
    after.constraints = []; expect(compare(after).classification).toBe('relaxation');
    const dir = tree(greenFiles), g = graph(dir);
    const review = explainConstraint({ constraint: before.constraints[0]!, blueprint: before, graph: g, teethWitness: assessTeeth(before, g).witnesses[0]! });
    expect(review.proof.gradeability).toBe('graded');
    expect(review.plainLanguage ?? JSON.stringify(review)).toContain('two');
  });
  it('requires extractor-real source mutation proof; synthetic paths are only evaluator-refutable', () => {
    const dir = tree(greenFiles), bp = blueprint();
    expect(assessTeeth(bp, graph(dir)).witnesses[0]!.verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    const proof = assessExtractorTeethCorpus({ blueprint: bp, repoDir: dir, manifest: {
      schemaVersion: '1', blueprintRef: 'bounded-module-boundary@0.1.0', allowedMutationRoots: ['src'],
      cases: [{ id: 'append-forbidden-second-hop', constraintId: 'domain-cannot-reach-app', operation: {
        kind: 'appendText', target: 'src/bridge.ts', preconditionSha256: createHash('sha256').update(greenFiles['src/bridge.ts']).digest('hex'), content: "\nimport './app/view.js';\n",
      }, expectedEvidencePath: 'src/bridge.ts', allowedCollateralConstraints: [] }],
    } });
    expect(proof.verdict).toBe('extractor-real-proven'); expect(proof.killed).toBe(1);
  });
  it('runs the built gate/API refusal path and CLI author scaffold with real 0/1/2 outcomes', () => {
    const clean = tree(greenFiles), bad = tree({ ...greenFiles, 'src/bridge.ts': "import './app/view.js';\nexport const helper = 1;\n" }), unknown = tree({ ...greenFiles, 'src/bridge.ts': 'export const helper = import(process.env.TARGET);\n' });
    for (const [dir, code, outcome] of [[clean, 0, 'pass'], [bad, 1, 'violation'], [unknown, 2, 'refusal']] as const) {
      saveBlueprint(dir); const file = path.join(dir, 'report.json');
      const result = cli('gate', '--repo', dir, '--report-json', file);
      expect(result.status, result.stderr).toBe(code);
      expect(JSON.parse(readFileSync(file, 'utf8')).outcome).toBe(outcome);
    }
    expect(runGate(unknown, path.join(unknown, '.blueprints'), null, 'ast').refusals?.[0]).toContain('forbiddenDependencyPath');
    writeFileSync(path.join(unknown, '.bce-mode.json'), '{"mode":"advisory"}\n');
    expect(cli('gate', '--repo', unknown).status).toBe(2);
    const out = path.join(clean, 'authored.json');
    const result = cli('author', '--id', 'bounded-authored', '--intent-ref', 'intent/bounded', '--repository', 'example/repo', '--scope-paths', 'src/**', '--extraction-profile', 'typescript-module-graph', '--constraint', 'forbiddenDependencyPath:module:src/app/**:critical', '--out', out);
    expect(result.status, result.stderr).toBe(0);
    const authored = parseBlueprint(JSON.parse(readFileSync(out, 'utf8')));
    expect(authored.minEngineVersion).toBe('0.6.1'); expect(authored.constraints[0]!.maxHops).toBe(2);
    expect(cli('gate', '--repo', clean, '--extractor', 'line-scan').status).not.toBe(0);
  });
});
