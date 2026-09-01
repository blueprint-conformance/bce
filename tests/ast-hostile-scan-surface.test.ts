/**
 * 0.12.1 hostile-scan regression suite.
 *
 * DEFECT RECORD (published 0.12.0, reproduced live on a host-estate blueprint):
 * `AstExtractor.extract()` feeds EVERY file matched by `extraction.paths` — including `.sh`
 * and `.yml` (the legitimate patternScan surface of a gate-estate blueprint) — to
 * `project.addSourceFileAtPath()` (a TypeScript parse). A TS-hostile line in such a file
 * (`import x from $SOME_MODULE`, `export * from ${SOMEWHERE}`) lexes into an
 * ImportDeclaration/ExportDeclaration whose module specifier is NOT a string literal;
 * `getModuleSpecifierValue()` then THROWS `InvalidOperationError: Expected the module
 * specifier to be a string literal.` — uncaught at three walk sites (static-import walk,
 * export-declaration walk, dynamic-import walk) — crashing the whole run.
 *
 * The 0.12.1 fix is catch-and-skip at those three sites (fail toward under-detection, the
 * extractor's own documented philosophy) + a `walkFiles` hardening for the sibling defect
 * (dirty-tree `RangeError: Maximum call stack size exceeded`): depth bound, explicit
 * symlink skip, loop-append instead of spread-push.
 *
 * RED-FIRST proof: every `does NOT throw` assertion here CRASHED at 0.12.0 (verified via a
 * ts-morph repro before the fix landed — the exact hostile shapes below throw
 * InvalidOperationError from both the import and export walks at 0.12.0).
 *
 * Self-contained: builds temp trees — no committed fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstExtractor, LineScanExtractor, resolveExtraction, resolveFiles } from '../src/extractors.js';
import { stableStringify } from '../src/report.js';
import type { Constraint, EngineeringBlueprint } from '../src/schema.js';
import { EngineeringBlueprintSchema } from '../src/schema.js';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const created: string[] = [];
function make(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'asthostile-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body, 'utf8');
  }
  created.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

/** A gate-estate-shaped blueprint: mixed TS + shell + workflow scan surface. */
function blueprint(constraints: Constraint[]): EngineeringBlueprint {
  return EngineeringBlueprintSchema.parse({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: {
      id: 'ast-hostile-scan-surface-shape',
      name: 'estate-shaped mixed scan surface (.ts + .sh + .yml)',
      version: '0.1.0',
      status: 'draft',
      ownerRole: 'platform-engineer',
      stewardRole: 'blueprint-steward',
    },
    intentRefs: ['policy/hostile-scan-regression'],
    scope: { repositories: ['example-org/monorepo'], paths: ['**'], environments: ['staging'] },
    architecture: { components: [], relationships: [] },
    constraints,
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
    extraction: {
      profile: 'plugin-surface',
      paths: ['src/**/*.ts', 'scripts/**/*.sh', 'workflows/**/*.yml'],
      minFiles: 1,
    },
  });
}

const PATTERN_CONSTRAINT: Constraint = {
  id: 'no-bypass-flag-usage',
  type: 'forbiddenPattern',
  severity: 'critical',
  pattern: 'continue-on-error:\\s*true',
};

const DEP_CONSTRAINT: Constraint = {
  id: 'no-openai-direct',
  type: 'forbiddenDependency',
  severity: 'critical',
  from: 'any',
  to: 'openai',
};

/**
 * The hostile estate tree: one REAL .ts file (with a real forbidden import — detection must
 * survive the guard) + .sh/.yml files whose content mis-lexes into non-literal import/export
 * declarations (the EXACT 0.12.0 crash shapes, repro-verified) + a real pattern hit in the
 * .yml so patternScan parity is assertable across extractors.
 */
const HOSTILE_TREE = {
  'src/ext.ts': `import OpenAI from 'openai';\nexport function factory() { return OpenAI; }\n`,
  // static-import walk crash shape: ImportDeclaration with a non-literal specifier
  'scripts/deploy.sh': `#!/usr/bin/env bash\nimport x from $SOME_MODULE\necho "deploy done"\n`,
  // export-declaration walk crash shape: ExportDeclaration with a non-literal specifier
  'workflows/gate.yml': `jobs:\n  import: from ../scripts\nexport * from \${SOMEWHERE}\nsteps:\n  continue-on-error: true\n`,
  // dynamic-import walk hostile shape: computed require/import-looking call in shell
  'scripts/loop.sh': `#!/usr/bin/env bash\nimport { a, b } from $(dirname "$0")\nexport { thing } from $HOME/mod\nrequire($DYNAMIC)\n`,
};

const cfg = () => resolveExtraction(blueprint([PATTERN_CONSTRAINT, DEP_CONSTRAINT]).extraction, blueprint([PATTERN_CONSTRAINT, DEP_CONSTRAINT]).constraints);

/* -------------------------------------------------------------------------- */
/* 1. the 0.12.0 crash regression                                             */
/* -------------------------------------------------------------------------- */

describe('AstExtractor on a TS-hostile mixed scan surface (.sh/.yml in extraction.paths) — 0.12.1 catch-and-skip', () => {
  it('CRASH-REGRESSION: extract() completes on the hostile tree (threw InvalidOperationError at 0.12.0)', () => {
    const dir = make(HOSTILE_TREE);
    // At published 0.12.0 this line crashed:
    //   InvalidOperationError: Expected the module specifier to be a string literal.
    const g = new AstExtractor(cfg()).extract(dir, 'testsha');
    expect(g.coverage.extractor).toBe('ast');
    expect(g.coverage.filesScanned).toBe(4);
  });

  it('under-detection is bounded: the REAL forbidden import in the REAL .ts file is still detected', () => {
    const dir = make(HOSTILE_TREE);
    const g = new AstExtractor(cfg()).extract(dir, 'testsha');
    const forbidden = g.guardEdges.filter((e) => e.type === 'imports' && e.to === 'openai');
    expect(forbidden).toHaveLength(1);
    expect(forbidden[0].evidenceRef).toBe('src/ext.ts#L1');
  });

  it('patternScan parity: ast and line-scan yield the IDENTICAL patternScan on the hostile tree (the §4 extractor-parity shape)', () => {
    const dir = make(HOSTILE_TREE);
    const ast = new AstExtractor(cfg()).extract(dir, 'testsha');
    const line = new LineScanExtractor(cfg()).extract(dir, 'testsha');
    expect(ast.coverage.patternScan).toBeDefined();
    expect(stableStringify(line.coverage.patternScan)).toBe(stableStringify(ast.coverage.patternScan));
    // and the pattern hit in the hostile .yml IS found (the whole point of scanning .sh/.yml)
    expect(ast.coverage.patternScan!.hits).toEqual([
      { pattern: 'continue-on-error:\\s*true', file: 'workflows/gate.yml', line: 5 },
    ]);
  });

  it('a hostile-only tree (no TS at all) extracts to an empty-but-valid graph, never a crash', () => {
    const dir = make({
      'scripts/only.sh': `#!/usr/bin/env bash\nimport x from $VAR\nexport * from \${OTHER}\n`,
    });
    const c = resolveExtraction(
      { profile: 'plugin-surface', paths: ['scripts/**/*.sh'], minFiles: 1 },
      [DEP_CONSTRAINT],
    );
    const g = new AstExtractor(c).extract(dir, 'testsha');
    expect(g.coverage.filesScanned).toBe(1);
    expect(g.guardEdges.filter((e) => e.type === 'imports')).toHaveLength(0); // skipped, not crashed
  });
});

/* -------------------------------------------------------------------------- */
/* 2. walkFiles hardening (dirty-tree RangeError sibling defect)              */
/* -------------------------------------------------------------------------- */

describe('walkFiles hardening (via resolveFiles) — depth bound + symlink skip (0.12.1)', () => {
  it('depth bound: a file nested deeper than MAX_WALK_DEPTH(64) is SKIPPED (under-detection), shallow files still found, no throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astdepth-'));
    created.push(dir);
    // shallow file at depth 2
    mkdirSync(join(dir, 'deep', 'a'), { recursive: true });
    writeFileSync(join(dir, 'deep', 'a', 'shallow.ts'), 'export {};\n', 'utf8');
    // pathological nest: 70 segments below repo root
    const segs = Array.from({ length: 70 }, (_, i) => `d${i}`);
    const deepDir = join(dir, 'deep', ...segs);
    mkdirSync(deepDir, { recursive: true });
    writeFileSync(join(deepDir, 'toodeep.ts'), 'export {};\n', 'utf8');
    const files = resolveFiles(dir, ['deep/**/*.ts']);
    const rels = files.map((f) => f.slice(dir.length + 1));
    expect(rels).toContain(join('deep', 'a', 'shallow.ts'));
    expect(rels.some((r) => r.endsWith('toodeep.ts'))).toBe(false);
  });

  it('symlink guard: a symlink cycle inside the walked tree neither loops nor throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astsym-'));
    created.push(dir);
    mkdirSync(join(dir, 'tree', 'sub'), { recursive: true });
    writeFileSync(join(dir, 'tree', 'sub', 'real.ts'), 'export {};\n', 'utf8');
    // cycle: tree/sub/back -> tree (ancestor)
    symlinkSync(join(dir, 'tree'), join(dir, 'tree', 'sub', 'back'), 'dir');
    const files = resolveFiles(dir, ['tree/**/*.ts']);
    const rels = files.map((f) => f.slice(dir.length + 1));
    expect(rels).toEqual([join('tree', 'sub', 'real.ts')]);
  });

  it('exact-path symlink escaping the repository is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astsym-escape-'));
    const outside = mkdtempSync(join(tmpdir(), 'astsym-outside-'));
    created.push(dir, outside);
    writeFileSync(join(outside, 'outside.ts'), 'export {};\n', 'utf8');
    symlinkSync(join(outside, 'outside.ts'), join(dir, 'outside-link.ts'), 'file');
    expect(() => resolveFiles(dir, ['outside-link.ts'])).toThrow(/escapes repository root/);
  });

  it('glob base symlink escaping the repository is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astsym-glob-escape-'));
    const outside = mkdtempSync(join(tmpdir(), 'astsym-glob-outside-'));
    created.push(dir, outside);
    writeFileSync(join(outside, 'outside.ts'), 'export {};\n', 'utf8');
    symlinkSync(outside, join(dir, 'linked'), 'dir');
    expect(() => resolveFiles(dir, ['linked/**/*.ts'])).toThrow(/escapes repository root/);
  });
});
