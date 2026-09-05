/**
 * Adversarial contract for the structured `python-module-graph` profile (WO-04).
 *
 * The old `python-import-surface` remains a deliberately bounded line scanner. This suite pins
 * the opt-in graph profile's materially stronger contract: policy-independent direct edges,
 * explicit source roots, C2/C3 scope semantics, and located uncertainty that reddens a relevant
 * boundary rather than becoming a false GREEN. Every hostile form below is valid Python unless
 * the test explicitly expects a syntax refusal.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { makeExtractor } from '../src/extractor-registry.js';
import { resolveExtraction } from '../src/extractors.js';
import type { ArchitectureGraph } from '../src/graph.js';
import { evaluate } from '../src/report.js';
import { parseBlueprint, type Constraint, type EngineeringBlueprint } from '../src/schema.js';
import { runGate } from '../src/gate.js';
import { resolveToolchainIdentity } from '../src/runtime-identity.js';

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures');
const SURFACE = path.join(FIXTURES, 'python-module-graph-surface');
const BLUEPRINT_PATH = path.join(FIXTURES, 'python-module-layering.blueprint.json');
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function tempTree(files: Record<string, string>): string {
  const dir = tempDir('bce-python-graph-');
  for (const [relative, source] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source);
  }
  return dir;
}

function blueprint(
  constraints: Constraint[],
  options: {
    paths?: string[];
    pythonRoots?: string[];
    minFiles?: number;
    includePythonRoots?: boolean;
    minEngineVersion?: string;
  } = {},
): EngineeringBlueprint {
  const paths = options.paths ?? ['src/**/*.py'];
  const includePythonRoots = options.includePythonRoots ?? true;
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: {
      id: 'python-module-test',
      version: '0.1.0',
      status: 'approved',
      ownerRole: 'test-maintainer',
      stewardRole: 'test-steward',
    },
    intentRefs: ['policy/python-module-test'],
    scope: { repositories: ['fixture'], paths },
    architecture: {
      components: [{ id: 'pythonModules', type: 'pythonModule' }],
      relationships: [],
    },
    constraints,
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'test-steward', stage: 'ratify' }],
    extraction: {
      profile: 'python-module-graph',
      paths,
      ...(includePythonRoots ? { pythonRoots: options.pythonRoots ?? ['src'] } : {}),
      minFiles: options.minFiles ?? 1,
    },
    minEngineVersion: options.minEngineVersion ?? '0.3.0',
  });
}

function extract(repo: string, bp: EngineeringBlueprint): ArchitectureGraph {
  const cfg = resolveExtraction(bp.extraction, bp.constraints);
  return makeExtractor('ast', cfg).extract(repo, 'test-revision');
}

function c1(): Constraint {
  return {
    id: 'python-module-surface-exists',
    type: 'requiredComponent',
    severity: 'high',
    component: 'pythonModule',
    policyRef: 'policy/python-module-test',
  };
}

function dependencyConstraints(source = 'src/service/feature.py'): Constraint[] {
  return [
    c1(),
    {
      id: 'feature-requires-domain',
      type: 'requiredDependency',
      severity: 'high',
      component: 'pythonModule',
      to: 'module:src/service/domain/orders.py',
      scopePaths: [source],
      policyRef: 'policy/python-module-test',
    },
    {
      id: 'feature-cannot-load-provider',
      type: 'forbiddenDependency',
      severity: 'critical',
      from: '*',
      to: 'package:openai',
      scopePaths: [source],
      policyRef: 'policy/python-module-test',
    },
  ];
}

function loadFixtureBlueprint(): EngineeringBlueprint {
  return parseBlueprint(JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')));
}

function fixtureBlueprintDir(): string {
  const dir = tempDir('bce-python-graph-blueprint-');
  fs.copyFileSync(BLUEPRINT_PATH, path.join(dir, 'python-module-layering.blueprint.json'));
  return dir;
}

describe('profile authoring contract', () => {
  it('accepts the approved 0.3.0 fixture with explicit paths, roots, and scan floor', () => {
    const bp = loadFixtureBlueprint();
    expect(bp.metadata.status).toBe('approved');
    expect(bp.minEngineVersion).toBe('0.3.0');
    expect(bp.extraction).toMatchObject({
      profile: 'python-module-graph',
      paths: ['src/**/*.py'],
      pythonRoots: ['src'],
      minFiles: 4,
    });
  });

  it('requires explicit non-empty pythonRoots and rejects escaping roots', () => {
    expect(() => blueprint([c1()], { includePythonRoots: false })).toThrow(/pythonRoots|required|root/i);
    expect(() => blueprint([c1()], { pythonRoots: [] })).toThrow(/pythonRoots|required|root/i);
    expect(() => blueprint([c1()], { pythonRoots: ['../outside'] })).toThrow(/pythonRoots|traversal|root/i);
  });

  it('is structured-provider only: requesting line-scan refuses instead of downgrading', () => {
    const bp = loadFixtureBlueprint();
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    expect(() => makeExtractor('line-scan', cfg)).toThrow(/python-module-graph.*(?:ast|structured)|(?:ast|structured).*python-module-graph/i);
  });

  it('records the structured provider identity as python-lezer', () => {
    const identity = resolveToolchainIdentity({
      engineVersion: '0.3.0',
      extractorKind: 'ast',
      extractionProfile: 'python-module-graph',
    });
    expect(identity.extractor).toMatchObject({
      kind: 'ast',
      profile: 'python-module-graph',
      provider: 'python-lezer',
      version: '0.3.0',
    });
  });
});

describe('real Python layering fixture — graph, C2, and C3', () => {
  it('GREEN: src-root imports resolve to repo paths and every policy-independent import is emitted', () => {
    const bp = loadFixtureBlueprint();
    const repo = path.join(SURFACE, 'conformant');
    const graph = extract(repo, bp);

    expect(graph.coverage.extractor).toBe('ast');
    expect(graph.coverage.filesScanned).toBe(4);
    expect(graph.coverage.unresolvedImports ?? []).toEqual([]);
    expect(graph.components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'module:src/service/api.py', type: 'pythonModule', path: 'src/service/api.py' }),
        expect.objectContaining({ id: 'module:src/service/domain/orders.py', type: 'pythonModule', path: 'src/service/domain/orders.py' }),
      ]),
    );
    for (const component of graph.components) expect(component.type).toBe('pythonModule');

    expect(graph.guardEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'module:src/service/api.py',
          to: 'module:src/service/domain/orders.py',
          type: 'imports',
          evidenceRef: 'src/service/api.py#L5',
        }),
        // `json` is not named by either dependency constraint. Its presence proves extraction
        // produces facts first and applies policy later, rather than emitting only forbidden hits.
        expect.objectContaining({
          from: 'module:src/service/api.py',
          to: 'package:json',
          type: 'imports',
          evidenceRef: 'src/service/api.py#L3',
        }),
      ]),
    );

    const report = evaluate(bp, graph, 'python-module-graph');
    expect(report.verdict).toBe('pass');
    expect(report.score).toBe(100);
  });

  it('RED: one reverse domain-to-API import produces the scoped C3 violation at its real line', () => {
    const bp = loadFixtureBlueprint();
    const repo = path.join(SURFACE, 'drift-reverse-layer');
    const graph = extract(repo, bp);
    expect(graph.guardEdges).toContainEqual(expect.objectContaining({
      from: 'module:src/service/domain/orders.py',
      to: 'module:src/service/api.py',
      type: 'imports',
      evidenceRef: 'src/service/domain/orders.py#L3',
    }));

    const report = evaluate(bp, graph, 'python-module-graph');
    expect(report.verdict).toBe('fail');
    expect(report.violations).toContainEqual(expect.objectContaining({
      constraintId: 'domain-cannot-import-api',
      component: 'module:src/service/domain/orders.py',
      evidenceRef: 'src/service/domain/orders.py#L3',
    }));
  });

  it('runs the same fixture pair through the real gate path with opposite verdicts', () => {
    const blueprintDir = fixtureBlueprintDir();
    const green = runGate(path.join(SURFACE, 'conformant'), blueprintDir, null, 'ast');
    expect(green.failed).toBe(false);
    expect(green.reports[0]).toMatchObject({ verdict: 'pass', score: 100 });

    const red = runGate(path.join(SURFACE, 'drift-reverse-layer'), blueprintDir, null, 'ast');
    expect(red.failed).toBe(true);
    expect(red.reports[0]!.violations).toContainEqual(expect.objectContaining({
      constraintId: 'domain-cannot-import-api',
      evidenceRef: 'src/service/domain/orders.py#L3',
    }));
  });

  it('is deterministic over the complete fixture graph', () => {
    const bp = loadFixtureBlueprint();
    const repo = path.join(SURFACE, 'conformant');
    expect(extract(repo, bp)).toEqual(extract(repo, bp));
  });
});

describe('structured import coverage — hostile valid syntax and non-facts', () => {
  it('detects semicolon, inline-suite, nested, aliased, parenthesized, and relative imports', () => {
    const repo = tempTree({
      'src/service/__init__.py': '',
      'src/service/domain/__init__.py': '',
      'src/service/domain/orders.py': 'def price_order(total: int) -> int:\n    return total\n',
      'src/service/feature.py': [
        'import requests as http; import flask',
        'if True: import pydantic',
        'def load_yaml():',
        '    import yaml as yaml_impl',
        '    return yaml_impl',
        'from service.domain import (',
        '    orders as absolute_orders,',
        ')',
        'from .domain import (',
        '    orders as relative_orders,',
        ')',
        '',
      ].join('\n'),
    });
    const graph = extract(repo, blueprint([c1()], { minFiles: 4 }));
    const targets = new Set(
      graph.guardEdges
        .filter((edge) => edge.from === 'module:src/service/feature.py' && edge.type === 'imports')
        .map((edge) => edge.to),
    );
    for (const target of ['package:requests', 'package:flask', 'package:pydantic', 'package:yaml']) {
      expect(targets, `missing structured import edge ${target}`).toContain(target);
    }
    expect(targets).toContain('module:src/service/domain/orders.py');
  });

  it('does not mint edges from comments or ordinary/raw/f/triple-quoted string content', () => {
    const repo = tempTree({
      'src/service/feature.py': [
        '# import openai',
        'ordinary = "import anthropic"',
        'raw = r"from boto3 import client"',
        'formatted = f"import mistralai as m"',
        'documentation = """',
        'import cohere',
        'from google import genai',
        '"""',
        'import requests',
        '',
      ].join('\n'),
    });
    const graph = extract(repo, blueprint([c1()]));
    const targets = graph.guardEdges.map((edge) => edge.to);
    expect(targets).toContain('package:requests');
    for (const decoy of ['package:openai', 'package:anthropic', 'package:boto3', 'package:mistralai', 'package:cohere', 'package:google']) {
      expect(targets).not.toContain(decoy);
    }
  });

  it('distinguishes an imported symbol from a real candidate submodule', () => {
    const repo = tempTree({
      'src/service/__init__.py': '',
      'src/service/domain/__init__.py': 'class Order:\n    pass\n',
      'src/service/domain/orders.py': 'class Order:\n    pass\n',
      'src/service/feature.py': [
        'from service.domain import Order',
        'from service.domain import orders',
        '',
      ].join('\n'),
    });
    const graph = extract(repo, blueprint([c1()], { minFiles: 4 }));
    const targets = graph.guardEdges.map((edge) => edge.to);
    expect(targets).toContain('module:src/service/domain/__init__.py');
    expect(targets).toContain('module:src/service/domain/orders.py');
    expect(targets).not.toContain('module:src/service/domain/Order.py');
    expect(graph.coverage.unresolvedImports ?? []).toEqual([]);
  });
});

describe('located uncertainty reddens relevant C2/C3 boundaries', () => {
  it('records computed __import__ and importlib.import_module calls and fails both boundaries closed', () => {
    const repo = tempTree({
      'src/service/feature.py': [
        'import importlib',
        'provider = "openai"',
        'first = __import__(provider)',
        'second = importlib.import_module(provider)',
        '',
      ].join('\n'),
      'src/service/domain/orders.py': 'def price_order(total: int) -> int:\n    return total\n',
    });
    const bp = blueprint(dependencyConstraints(), { minFiles: 2 });
    const graph = extract(repo, bp);
    const unresolved = graph.coverage.unresolvedImports ?? [];
    expect(unresolved).toHaveLength(2);
    expect(unresolved).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'module:src/service/feature.py', ref: 'src/service/feature.py#L3' }),
      expect.objectContaining({ from: 'module:src/service/feature.py', ref: 'src/service/feature.py#L4' }),
    ]));
    expect(unresolved.map((item) => `${item.kind} ${item.specifier} ${item.reason}`).join(' | ')).toMatch(
      /__import__|import_module|dynamic/i,
    );

    const report = evaluate(bp, graph, 'python-module-graph');
    const ids = new Set(report.violations.map((violation) => violation.constraintId));
    expect(ids).toContain('feature-requires-domain');
    expect(ids).toContain('feature-cannot-load-provider');
    expect(report.verdict).toBe('fail');
  });

  it('records sys.path mutation as resolution uncertainty and fails a scoped C3 closed', () => {
    const repo = tempTree({
      'src/service/feature.py': [
        'import sys',
        'plugin_root = "/runtime/plugins"',
        'sys.path.insert(0, plugin_root)',
        'import harmless_name',
        '',
      ].join('\n'),
    });
    const constraints: Constraint[] = [
      c1(),
      {
        id: 'feature-cannot-load-provider',
        type: 'forbiddenDependency',
        severity: 'critical',
        from: '*',
        to: 'package:openai',
        scopePaths: ['src/service/feature.py'],
        policyRef: 'policy/python-module-test',
      },
    ];
    const bp = blueprint(constraints);
    const graph = extract(repo, bp);
    const unresolved = graph.coverage.unresolvedImports ?? [];
    expect(unresolved).toContainEqual(expect.objectContaining({
      from: 'module:src/service/feature.py',
      ref: 'src/service/feature.py#L3',
    }));
    expect(unresolved.map((item) => `${item.kind} ${item.reason}`).join(' | ')).toMatch(/sys\.path|search path/i);

    const report = evaluate(bp, graph, 'python-module-graph');
    expect(report.violations).toContainEqual(expect.objectContaining({
      constraintId: 'feature-cannot-load-provider',
      evidenceRef: 'src/service/feature.py#L3',
    }));
  });
});

describe('hard refusals — an ungradeable graph is never returned', () => {
  it('accepts a UTF-8 BOM and CRLF while preserving the real import line', () => {
    const repo = tempTree({
      'src/service/feature.py': '',
    });
    fs.writeFileSync(
      path.join(repo, 'src/service/feature.py'),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# header\r\nimport requests\r\n', 'utf8')]),
    );
    const graph = extract(repo, blueprint([c1()]));
    expect(graph.guardEdges).toContainEqual(expect.objectContaining({
      to: 'package:requests',
      evidenceRef: 'src/service/feature.py#L2',
    }));
  });

  it('refuses non-UTF-8 coding contracts and invalid UTF-8 bytes', () => {
    const cookieRepo = tempTree({
      'src/service/legacy.py': '# -*- coding: latin-1 -*-\nVALUE = 1\n',
    });
    expect(() => extract(cookieRepo, blueprint([c1()]))).toThrow(/non-UTF-8 coding cookie|latin-1/i);

    const byteRepo = tempTree({ 'src/service/bad.py': '' });
    fs.writeFileSync(path.join(byteRepo, 'src/service/bad.py'), Buffer.from([0xff, 0xfe, 0x00]));
    expect(() => extract(byteRepo, blueprint([c1()]))).toThrow(/decode.*UTF-8|UTF-8.*decode/i);
  });

  it('refuses import names that differ only by case', () => {
    const repo = tempTree({
      'src/service/API.py': 'VALUE = 1\n',
      'src/service/api.py': 'VALUE = 2\n',
    });
    // A case-insensitive filesystem aliases the second write to the first, so it cannot
    // materialize the hostile tree. Linux CI exercises the actual two-entry refusal.
    if (fs.readdirSync(path.join(repo, 'src/service')).filter((name) => /^(?:API|api)\.py$/.test(name)).length < 2) return;
    expect(() => extract(repo, blueprint([c1()], { minFiles: 2 }))).toThrow(/case-fold collision/i);
  });

  it('refuses invalid Python syntax', () => {
    const repo = tempTree({
      'src/service/broken.py': 'from service import (\n',
    });
    const bp = blueprint([c1()]);
    expect(() => extract(repo, bp)).toThrow(/syntax|parse|invalid/i);
  });

  it('refuses an over-dotted relative import that escapes the declared source root', () => {
    const repo = tempTree({
      'src/service/feature.py': 'from ...outside import value\n',
    });
    const bp = blueprint([c1()]);
    expect(() => extract(repo, bp)).toThrow(/relative|root|escape|dots/i);
  });

  it('refuses the same import identity mapped by two Python roots', () => {
    const repo = tempTree({
      'src/service/api.py': 'VALUE = "src"\n',
      'lib/service/api.py': 'VALUE = "lib"\n',
    });
    const bp = blueprint([c1()], {
      paths: ['src/**/*.py', 'lib/**/*.py'],
      pythonRoots: ['src', 'lib'],
      minFiles: 2,
    });
    expect(() => extract(repo, bp)).toThrow(/ambiguous|collision|duplicate|service\.api/i);
  });

  it('refuses an extraction path whose real directory escapes through a symlink or junction', () => {
    const repo = tempTree({ 'src/service/inside.py': 'VALUE = 1\n' });
    const outside = tempTree({ 'escape.py': 'import openai\n' });
    const link = path.join(repo, 'src', 'service', 'linked-outside');
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    const bp = blueprint([c1()], {
      paths: ['src/service/linked-outside/**/*.py'],
      minFiles: 1,
    });
    expect(() => extract(repo, bp)).toThrow(/escape|outside|repository root|symlink/i);
  });
});
