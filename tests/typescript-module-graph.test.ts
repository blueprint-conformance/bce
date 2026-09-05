import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  LineScanExtractor,
  TypeScriptModuleGraphExtractor,
  resolveExtraction,
} from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { evaluate, stableStringify } from '../src/report.js';
import {
  parseBlueprint,
  parsePortfolioBlueprint,
  type EngineeringBlueprint,
} from '../src/schema.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');

function fixtureBlueprint(): EngineeringBlueprint {
  return parseBlueprint(
    JSON.parse(fs.readFileSync(path.join(FIXTURES, 'typescript-module-layering.blueprint.json'), 'utf8')),
  );
}

function tempTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-module-graph-'));
  for (const [rel, text] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  }
  return root;
}

function moduleBlueprint(overrides: Partial<EngineeringBlueprint['extraction']> = {}): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'module-test', version: '0.1.0', status: 'draft' },
    intentRefs: ['intent/module-boundary'],
    scope: { repositories: ['example/repo'], paths: ['src/**/*.*'] },
    architecture: { components: [], relationships: [] },
    constraints: [
      {
        id: 'no-sdk-from-domain',
        type: 'forbiddenDependency',
        severity: 'critical',
        to: 'package:openai',
        scopePaths: ['src/**'],
      },
    ],
    evidenceRequirements: [],
    approvals: [],
    minEngineVersion: '0.3.0',
    extraction: {
      profile: 'typescript-module-graph',
      paths: ['src/**/*.*'],
      minFiles: 1,
      ...overrides,
    },
  });
}

describe('typescript-module-graph extractor', () => {
  it('emits policy-independent direct edges for every supported static import form', () => {
    const root = tempTree({
      'package.json': JSON.stringify({ dependencies: { openai: '1.0.0' } }),
      'src/main.ts': [
        "import type { Shape } from './types.js';",
        "export { value } from './dep';",
        "import fs from 'node:fs';",
        "import type { TestContext } from 'node:test';",
        "import sqlite from 'node:sqlite';",
        "import OpenAI from 'openai/resources';",
        "type OpenAIClient = import('openai').OpenAI;",
        "import Legacy = require('./legacy');",
        "const common = require('./common');",
        "const found = require.resolve('./common');",
        'void import(`./lazy`);',
        'export { fs, OpenAI, Legacy, common, found };',
      ].join('\n'),
      'src/types.ts': 'export interface Shape { n: number }\n',
      'src/dep.ts': 'export const value = 1;\n',
      'src/legacy.ts': 'export = { legacy: true };\n',
      'src/common.ts': 'export const common = true;\n',
      'src/lazy.ts': 'export const lazy = true;\n',
      'src/typed.js': '/** @import { OpenAI } from "openai" */\nexport const typed = true;\n',
    });
    try {
      const bp = moduleBlueprint();
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = new TypeScriptModuleGraphExtractor(cfg).extract(root, 'module-forms');
      expect(graph.components).toHaveLength(7);
      const mainEdges = graph.guardEdges.filter((edge) => edge.from === 'module:src/main.ts');
      expect(mainEdges.map((edge) => edge.to)).toEqual(expect.arrayContaining([
        'module:src/types.ts',
        'module:src/dep.ts',
        'builtin:fs',
        'builtin:test',
        'builtin:sqlite',
        'package:openai',
        'module:src/legacy.ts',
        'module:src/common.ts',
        'module:src/lazy.ts',
      ]));
      expect(mainEdges.filter((edge) => edge.to === 'module:src/common.ts')).toHaveLength(2);
      expect(graph.guardEdges).toContainEqual({
        from: 'module:src/typed.js',
        to: 'package:openai',
        type: 'imports',
        evidenceRef: 'src/typed.js#L1',
      });
      expect(graph.coverage.unresolvedImports).toBeUndefined();
      expect(graph.coverage.unsupported.join(' ')).toContain('no transitive reachability');
      const required = parseBlueprint({
        ...bp,
        constraints: [{
          id: 'main-imports-types',
          type: 'requiredDependency',
          severity: 'high',
          component: 'typescriptModule',
          to: 'module:src/types.ts',
          scopePaths: ['src/main.ts'],
        }],
      });
      expect(evaluate(required, graph, cfg.profile)).toMatchObject({ verdict: 'pass', violations: [] });
      expect(assessTeeth(required, graph, cfg.profile).witnesses).toContainEqual(expect.objectContaining({
        constraintId: 'main-imports-types',
        verdict: ConstraintTeeth.TOOTHED,
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not credit shadowed require and locates computed imports as fail-closed uncertainty', () => {
    const root = tempTree({
      'src/main.ts': [
        "function local(require: (s: string) => unknown) { return require('openai'); }",
        "const target = './lazy';",
        'void import(target);',
        "type Ambiguous = import('openai' | 'zod').Client;",
        'import Computed = require(target);',
        'namespace Known { export type Client = string; }',
        'import Local = Known.Client;',
      ].join('\n'),
    });
    try {
      const bp = moduleBlueprint();
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = makeExtractor('ast', cfg).extract(root, 'computed');
      expect(graph.guardEdges).toEqual([]);
      expect(graph.coverage.unresolvedImports).toEqual([
        expect.objectContaining({
          from: 'module:src/main.ts',
          specifier: '<computed>',
          kind: 'dynamic-import',
          ref: 'src/main.ts#L3',
        }),
        expect.objectContaining({
          from: 'module:src/main.ts',
          specifier: '<computed>',
          kind: 'import-type',
          ref: 'src/main.ts#L4',
        }),
        expect.objectContaining({
          from: 'module:src/main.ts',
          specifier: '<computed>',
          kind: 'import-equals',
          ref: 'src/main.ts#L5',
        }),
      ]);
      const report = evaluate(bp, graph, cfg.profile);
      expect(report.verdict).toBe('fail');
      expect(report.violations[0]?.observed).toContain('absence of a forbidden target cannot be proven');
      expect(report.coverage.unresolvedImports).toEqual(graph.coverage.unresolvedImports);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses an explicit tsconfig to resolve internal path aliases', () => {
    const root = tempTree({
      'tsconfig.json': JSON.stringify({ extends: './config/base.json' }),
      'config/base.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@domain/*': ['src/domain/*'] } } }),
      'src/app.ts': "import { value } from '@domain/value';\nexport { value };\n",
      'src/domain/value.ts': 'export const value = 1;\n',
    });
    try {
      const bp = moduleBlueprint({ tsconfig: 'tsconfig.json' });
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = makeExtractor('ast', cfg).extract(root, 'tsconfig-alias');
      expect(graph.guardEdges).toContainEqual({
        from: 'module:src/app.ts',
        to: 'module:src/domain/value.ts',
        type: 'imports',
        evidenceRef: 'src/app.ts#L1',
      });
      expect(graph.coverage.unresolvedImports).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not guess whether an undeclared bare specifier is a package or project alias', () => {
    const root = tempTree({
      'src/main.ts': "import { value } from 'domain/value';\nexport { value };\n",
    });
    try {
      const bp = moduleBlueprint();
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = makeExtractor('ast', cfg).extract(root, 'ambiguous-bare');
      expect(graph.guardEdges).toEqual([]);
      expect(graph.coverage.unresolvedImports).toEqual([
        expect.objectContaining({
          from: 'module:src/main.ts',
          specifier: 'domain/value',
          reason: expect.stringContaining('not declared in an enclosing package.json'),
        }),
      ]);
      expect(evaluate(bp, graph, cfg.profile).verdict).toBe('fail');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses invalid syntax, escaping imports, invalid tsconfig, unsupported files, and line-scan', () => {
    const cases: Array<{ files: Record<string, string>; overrides?: Partial<EngineeringBlueprint['extraction']>; message: RegExp }> = [
      { files: { 'src/bad.ts': 'export const = ;\n' }, message: /could not parse/ },
      { files: { 'src/escape.ts': "import '../../outside.js';\n" }, message: /escapes repository root/ },
      { files: { 'src/absolute.ts': "import 'C:\\\\outside\\\\mod.js';\n" }, message: /escapes repository root/ },
      {
        files: { 'src/main.ts': 'export const value = 1;\n', 'tsconfig.json': '{"extends":"../outside.json"}' },
        overrides: { tsconfig: 'tsconfig.json' },
        message: /tsconfig extends .*escapes repository root/,
      },
      {
        files: { 'src/main.ts': 'export const value = 1;\n', 'tsconfig.json': '{ bad json' },
        overrides: { tsconfig: 'tsconfig.json' },
        message: /tsconfig is invalid/,
      },
      { files: { 'src/config.json': '{}\n' }, message: /only scans TS\/JS module files/ },
    ];
    for (const testCase of cases) {
      const root = tempTree(testCase.files);
      try {
        const bp = moduleBlueprint(testCase.overrides);
        const cfg = resolveExtraction(bp.extraction, bp.constraints);
        expect(() => makeExtractor('ast', cfg).extract(root, 'refusal')).toThrow(testCase.message);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    const cfg = resolveExtraction(fixtureBlueprint().extraction, fixtureBlueprint().constraints);
    expect(() => makeExtractor('line-scan', cfg)).toThrow(/requires --extractor ast/);
    expect(() => new LineScanExtractor(cfg)).toThrow(/requires --extractor ast/);

    const outside = tempTree({ 'package.json': '{"dependencies":{"openai":"1.0.0"}}' });
    const symlinked = tempTree({ 'src/main.ts': "import OpenAI from 'openai';\nexport { OpenAI };\n" });
    try {
      fs.symlinkSync(path.join(outside, 'package.json'), path.join(symlinked, 'package.json'));
      const bp = moduleBlueprint();
      const symlinkCfg = resolveExtraction(bp.extraction, bp.constraints);
      expect(() => makeExtractor('ast', symlinkCfg).extract(symlinked, 'symlink-manifest')).toThrow(
        /package manifest resolves outside repository root/,
      );
    } finally {
      fs.rmSync(symlinked, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }

    const outsideConfig = tempTree({ 'base': '{"compilerOptions":{"baseUrl":"."}}' });
    const symlinkedConfig = tempTree({
      'src/main.ts': 'export const value = 1;\n',
      'tsconfig.json': '{"extends":"./config/base"}',
    });
    try {
      fs.mkdirSync(path.join(symlinkedConfig, 'config'));
      fs.symlinkSync(path.join(outsideConfig, 'base'), path.join(symlinkedConfig, 'config', 'base'));
      const bp = moduleBlueprint({ tsconfig: 'tsconfig.json' });
      const symlinkCfg = resolveExtraction(bp.extraction, bp.constraints);
      expect(() => makeExtractor('ast', symlinkCfg).extract(symlinkedConfig, 'symlink-tsconfig')).toThrow(
        /tsconfig extends resolves outside repository root/,
      );
    } finally {
      fs.rmSync(symlinkedConfig, { recursive: true, force: true });
      fs.rmSync(outsideConfig, { recursive: true, force: true });
    }
  });

  it('is deterministic and discriminates clean layering from reverse-layer drift', () => {
    const bp = fixtureBlueprint();
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    const extractor = makeExtractor('ast', cfg);
    const clean = extractor.extract(path.join(FIXTURES, 'typescript-module-surface', 'conformant'), 'layering');
    const drift = extractor.extract(path.join(FIXTURES, 'typescript-module-surface', 'drift-reverse-layer'), 'layering');
    expect(stableStringify(clean)).toBe(stableStringify(makeExtractor('ast', cfg).extract(
      path.join(FIXTURES, 'typescript-module-surface', 'conformant'),
      'layering',
    )));
    expect(evaluate(bp, clean, cfg.profile)).toMatchObject({ verdict: 'pass', score: 100, violations: [] });
    expect(assessTeeth(bp, clean, cfg.profile).witnesses).toContainEqual(expect.objectContaining({
      constraintId: 'domain-cannot-import-app',
      verdict: ConstraintTeeth.EVALUATOR_REFUTABLE,
    }));
    const report = evaluate(bp, drift, cfg.profile);
    expect(report.verdict).toBe('fail');
    expect(report.violations).toContainEqual(expect.objectContaining({
      constraintId: 'domain-cannot-import-app',
      component: 'module:packages/domain/order.ts',
      evidenceRef: 'packages/domain/order.ts#L1',
    }));
  });
});

describe('typescript-module-graph blueprint contract', () => {
  it('requires paths, minFiles, source scopes, canonical targets, and no component-profile knobs', () => {
    const good = fixtureBlueprint();
    const raw = JSON.parse(JSON.stringify(good));
    delete raw.extraction.minFiles;
    expect(() => parseBlueprint(raw)).toThrow(/explicit floor/);

    const missingEngineFloor = JSON.parse(JSON.stringify(good));
    delete missingEngineFloor.minEngineVersion;
    expect(() => parseBlueprint(missingEngineFloor)).toThrow(/minEngineVersion >=0\.3\.0/);

    const staleEngineFloor = JSON.parse(JSON.stringify(good));
    staleEngineFloor.minEngineVersion = '0.2.0';
    expect(() => parseBlueprint(staleEngineFloor)).toThrow(/minEngineVersion >=0\.3\.0/);

    const missingScope = JSON.parse(JSON.stringify(good));
    delete missingScope.constraints[1].scopePaths;
    expect(() => parseBlueprint(missingScope)).toThrow(/non-empty source paths/);

    const nonCanonical = JSON.parse(JSON.stringify(good));
    nonCanonical.constraints[1].to = 'packages/app/**';
    expect(() => parseBlueprint(nonCanonical)).toThrow(/target must be module:/);

    const componentPolicy = JSON.parse(JSON.stringify(good));
    componentPolicy.extraction.guardSymbols = ['pretendGuard'];
    expect(() => parseBlueprint(componentPolicy)).toThrow(/component-profile policy/);

    const unsupportedEgress = JSON.parse(JSON.stringify(good));
    unsupportedEgress.constraints.push({
      id: 'no-egress',
      type: 'forbiddenEgress',
      severity: 'critical',
      governedHosts: ['gateway.example.com'],
    });
    expect(() => parseBlueprint(unsupportedEgress)).toThrow(/forbiddenEgress is not supported/);

    const explicitFrom = JSON.parse(JSON.stringify(good));
    explicitFrom.constraints[1].from = 'module:packages/domain/order.ts';
    expect(() => parseBlueprint(explicitFrom)).toThrow(/from must be absent or '\*'/);

    const nonCanonicalPackage = JSON.parse(JSON.stringify(good));
    nonCanonicalPackage.constraints[1].to = 'package:OpenAI';
    expect(() => parseBlueprint(nonCanonicalPackage)).toThrow(/target must be module:/);

    const foreignTsconfig = JSON.parse(JSON.stringify(good));
    foreignTsconfig.extraction.profile = 'plugin-surface';
    foreignTsconfig.extraction.tsconfig = 'tsconfig.json';
    expect(() => parseBlueprint(foreignTsconfig)).toThrow(/tsconfig is only valid/);

    const directSchema = JSON.parse(JSON.stringify(good));
    delete directSchema.constraints[1].scopePaths;
    expect(() => parseBlueprint(directSchema)).toThrow(/non-empty source paths/);
  });

  it('applies the same profile rules to fleet constraints', () => {
    const good = fixtureBlueprint();
    const portfolio = {
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'PortfolioBlueprint',
      metadata: { id: 'module-fleet', version: '0.1.0', status: 'draft' },
      intentRefs: ['intent/module-boundary'],
      governance: { version: '0.1.0', skewGraceDays: 7, minMembers: 1 },
      members: [{
        repo: 'example/repo',
        checkContext: 'bce',
        enginePin: '0.3.0',
        pinEncoding: 'lockfile',
        extractor: 'ast',
      }],
      fleetConstraints: good.constraints,
      extraction: good.extraction,
      coverage: { unsupported: ['transitive reachability'] },
    };
    expect(() => parsePortfolioBlueprint(portfolio)).not.toThrow();
    const oldEngine = JSON.parse(JSON.stringify(portfolio));
    oldEngine.members[0].enginePin = '0.2.0';
    expect(() => parsePortfolioBlueprint(oldEngine)).toThrow(/member enginePin >=0\.3\.0/);
    delete (portfolio.fleetConstraints[1] as { scopePaths?: string[] }).scopePaths;
    expect(() => parsePortfolioBlueprint(portfolio)).toThrow(/non-empty source paths/);
  });
});
