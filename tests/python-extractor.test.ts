/**
 * Quality matrix for the `python-import-surface` profile — the first non-TypeScript language
 * provider behind the extractor registry. Covers: the import-statement parser (absolute /
 * aliased / multi-clause / from-import / relative / parenthesized / backslash-continued forms),
 * the comment+string exclusion state machine, the HONEST MISSES (dynamic imports asserted as
 * NOT detected — a capability note that cannot fail is a bug), module-component identity,
 * green→red discrimination on the real fixtures, and determinism.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import { resolveExtraction } from '../src/extractors.js';
import {
  PythonImportExtractor,
  parsePythonImports,
  pythonModuleId,
  resolveRelativeModule,
  stripPythonNoise,
} from '../src/python-extractor.js';
import { evaluate } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'python-service.blueprint.json');
const blueprint: EngineeringBlueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));
const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
const surface = (name: string): string => path.join(FIXROOT, 'python-surface', name);

const specsOf = (source: string, rel = 'service/mod.py'): string[] =>
  parsePythonImports(source, rel).flatMap((s) => s.candidates);

/* -------------------------------------------------------------------------- */
describe('import statement parser — detected forms', () => {
  it('absolute dotted import', () => {
    expect(specsOf('import openai\n')).toEqual(['openai']);
    expect(specsOf('import a.b.c\n')).toEqual(['a.b.c']);
  });

  it('aliased and multi-clause imports', () => {
    expect(specsOf('import openai as oa\n')).toEqual(['openai']);
    expect(specsOf('import json, openai, os\n').sort()).toEqual(['json', 'openai', 'os']);
  });

  it('from-import emits the module AND each candidate submodule', () => {
    expect(specsOf('from a.b import c, d as e\n').sort()).toEqual(['a.b', 'a.b.c', 'a.b.d']);
  });

  it('from-import star emits only the module', () => {
    expect(specsOf('from a.b import *\n')).toEqual(['a.b']);
  });

  it('relative imports resolve against the importing package', () => {
    expect(specsOf('from .util import x\n', 'pkg/sub/mod.py').sort()).toEqual([
      'pkg.sub.util',
      'pkg.sub.util.x',
    ]);
    expect(specsOf('from ..shared import y\n', 'pkg/sub/mod.py').sort()).toEqual([
      'pkg.shared',
      'pkg.shared.y',
    ]);
    // over-dotted relative escapes the tree — unresolvable, NO candidate (never a guess)
    expect(specsOf('from ....nowhere import z\n', 'pkg/mod.py')).toEqual([]);
  });

  it('parenthesized multi-line and backslash continuations fold to one statement', () => {
    const paren = 'from a.b import (\n    c,\n    d,\n)\n';
    expect(specsOf(paren).sort()).toEqual(['a.b', 'a.b.c', 'a.b.d']);
    const backslash = 'import \\\n    openai\n';
    expect(specsOf(backslash)).toEqual(['openai']);
  });

  it('an indented (function-local / conditional / try) import is still reported — reach-is-drift', () => {
    const src = 'def f():\n    try:\n        import openai\n    except ImportError:\n        pass\n';
    expect(specsOf(src)).toEqual(['openai']);
  });
});

describe('comment + string exclusion (an import token in prose is not an import)', () => {
  it('comments are excluded', () => {
    expect(specsOf('# import openai\n')).toEqual([]);
    expect(specsOf('import json  # not: import openai\n')).toEqual(['json']);
  });

  it('single- and triple-quoted strings are excluded', () => {
    expect(specsOf('x = "import openai"\n')).toEqual([]);
    expect(specsOf('"""docstring\nimport openai\n"""\nimport json\n')).toEqual(['json']);
  });

  it('stripPythonNoise tracks a block string across lines', () => {
    const a = stripPythonNoise('x = """start', null);
    expect(a.openBlock).toBe('"""');
    const b = stripPythonNoise('import openai', a.openBlock);
    expect(b.text).toBe('');
    const c = stripPythonNoise('end""" + y', b.openBlock);
    expect(c.openBlock).toBeNull();
  });
});

describe('HONEST MISSES — dynamic forms are NOT detected (the capability note must be true)', () => {
  it('__import__ and importlib are not reported as imports', () => {
    expect(specsOf('m = __import__("openai")\n')).toEqual([]);
    expect(specsOf('import importlib\nm = importlib.import_module("openai")\n')).toEqual([
      'importlib',
    ]);
  });

  it('the emitted graph discloses exactly these limits in coverage.unsupported', () => {
    const graph = new PythonImportExtractor(cfg).extract(surface('conformant'), 'test');
    const notes = graph.coverage.unsupported.join(' | ');
    expect(notes).toContain('__import__');
    expect(notes).toContain('importlib');
    expect(notes).toContain('context-insensitive');
  });
});

describe('module components + fixture discrimination', () => {
  it('pythonModuleId maps files to dotted module ids (__init__ names the package)', () => {
    expect(pythonModuleId('service/app.py')).toBe('service.app');
    expect(pythonModuleId('service/__init__.py')).toBe('service');
    expect(pythonModuleId('main.py')).toBe('main');
  });

  it('resolveRelativeModule handles package boundaries', () => {
    expect(resolveRelativeModule('pkg/sub/mod.py', 1, 'util')).toBe('pkg.sub.util');
    expect(resolveRelativeModule('pkg/sub/mod.py', 2, 'util')).toBe('pkg.util');
    expect(resolveRelativeModule('pkg/mod.py', 4, 'x')).toBeNull();
  });

  it('GREEN: the conformant tree scores 100 with pythonModule components and no violations', () => {
    const graph = new PythonImportExtractor(cfg).extract(surface('conformant'), 'test');
    expect(graph.components.length).toBeGreaterThanOrEqual(2);
    for (const c of graph.components) expect(c.type).toBe('pythonModule');
    const report = evaluate(blueprint, graph, cfg.profile);
    expect(report.verdict).toBe('pass');
    expect(report.score).toBe(100);
  });

  it('RED: the drift tree emits the forbidden openai edge and fails on no-direct-provider-sdk', () => {
    const graph = new PythonImportExtractor(cfg).extract(surface('drift-forbidden-import'), 'test');
    const forbidden = graph.guardEdges.filter((e) => e.type === 'imports' && e.to === 'openai');
    expect(forbidden.length).toBe(1);
    expect(forbidden[0]!.from).toBe('module:service.client');
    const report = evaluate(blueprint, graph, cfg.profile);
    expect(report.verdict).toBe('fail');
    expect(report.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
  });

  it('determinism: two extracts of the same tree are deeply identical', () => {
    const ex = new PythonImportExtractor(cfg);
    expect(ex.extract(surface('conformant'), 'r1')).toEqual(ex.extract(surface('conformant'), 'r1'));
  });
});
