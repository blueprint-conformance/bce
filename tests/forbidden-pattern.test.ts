/**
 * Quality matrix for the `forbiddenPattern` constraint (0.9.0).
 *
 * WHY THIS CONSTRAINT EXISTS — the content-blindness every 0.8.0 tooth shares:
 * `forbiddenFile` matches a FILENAME glob against `graph.coverage.scannedFiles`;
 * `forbiddenDependency` an IMPORT edge; `forbiddenEgress` a CALL-egress edge. None of them can
 * see mocked-data-in-an-otherwise-legit-file: a `Math.random()` metric planted in a REAL route,
 * a hardcoded `uptime: 99.9` constant in a REAL service. `forbiddenPattern` is the content-grep
 * tooth: a regex evaluated per-line over the SAME raw scanned-file set (`coverage.patternScan`),
 * so a mock literal is caught regardless of filename, export shape, or import graph.
 *
 * The steward's RED-FIRST merge gate (anti-toothlessness): this suite proves
 *   (RED)      a real route file with a planted `Math.random()` → forbiddenPattern produces a
 *              violation with `<file>#L<line>` evidence, verdict fail, score 60 (100−40 critical);
 *   (WITNESS)  the SAME seeded repo scores GREEN under an 0.8.0-era blueprint (forbiddenFile on a
 *              non-matching glob) — proving forbiddenPattern is the discriminator;
 *   (GREEN)    a clean tree (real computation, no mock literal) scores 100/pass;
 *   (HONEST)   a graph with NO patternScan records the constraint SKIPPED — and a pattern-only
 *              blueprint against it fails via `__no-enforcing-constraints__` (fail-closed);
 *   (TEETH)    a forbiddenPattern-only AND a forbiddenFile-only blueprint each grade TOOTHED
 *              (closing the grounded teeth.ts `default → TRIVIALLY_GREEN` gap for forbiddenFile);
 *   (FAIL-CLOSED) a non-compiling pattern hard-errors at validate time, never a silent skip-pass.
 *
 * Self-contained: builds a temp tree — no committed fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstExtractor, LineScanExtractor, resolveExtraction } from '../src/extractors.js';
import { evaluate, stableStringify } from '../src/report.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { EngineeringBlueprintSchema, type Constraint, type EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

/** The mock-literal content tooth: no `Math.random(` anywhere in the scanned surface. */
const MOCK_PATTERN = 'Math\\.random\\(';

/** A ct-surface-truth-shaped blueprint with caller-supplied constraints. */
function blueprint(constraints: Constraint[], id = 'ct-surface-truth-shape'): EngineeringBlueprint {
  return EngineeringBlueprintSchema.parse({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: {
      id,
      name: 'ct de-theatre — no mocked metric literals',
      version: '0.1.0',
      status: 'draft',
      ownerRole: 'platform-engineer',
      stewardRole: 'blueprint-steward',
    },
    intentRefs: ['policy/truth-foundation'],
    scope: { repositories: ['service-beta'], paths: ['src/**'], environments: ['staging'] },
    architecture: { components: [], relationships: [] },
    constraints,
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  });
}

const PATTERN_CONSTRAINT: Constraint = {
  id: 'no-mock-random-metric',
  type: 'forbiddenPattern',
  severity: 'critical',
  pattern: MOCK_PATTERN,
};

/** The 0.8.0-era witness blueprint: a forbiddenFile on a glob the seeded repo does NOT match. */
const FILE_CONSTRAINT_NON_MATCHING: Constraint = {
  id: 'no-parallel-beta-provisioner',
  type: 'forbiddenFile',
  severity: 'critical',
  path: 'src/**/beta-*provisioner*.ts',
};

const created: string[] = [];
function make(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'fpat-'));
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

// The EXACT anti-pattern: an otherwise-legit route file with ONE planted mock literal (line 3).
const SEEDED_MOCK = {
  'src/api/metrics-route.ts': `export function getMetrics() {\n  const uptime = 99.9;\n  return { cpu: Math.random() * 100, uptime };\n}\n`,
  'src/lib/real-service.ts': `export const sum = (a: number, b: number) => a + b;\n`,
};
const CLEAN = {
  'src/api/metrics-route.ts': `import { readCpu } from '../lib/real-service.js';\nexport function getMetrics() {\n  return { cpu: readCpu() };\n}\n`,
  'src/lib/real-service.ts': `export const readCpu = () => process.cpuUsage().user;\n`,
};

const patternBp = (): EngineeringBlueprint => blueprint([PATTERN_CONSTRAINT]);
const witnessBp = (): EngineeringBlueprint => blueprint([FILE_CONSTRAINT_NON_MATCHING], 'witness-0-8-0-era');
const patternCfg = () => resolveExtraction(patternBp().extraction, patternBp().constraints);

describe('forbiddenPattern constraint (0.9.0) — the content-grep tooth', () => {
  it('extractor records a deterministic coverage.patternScan (sorted, repo-relative) on the seeded repo', () => {
    const g = new AstExtractor(patternCfg()).extract(make(SEEDED_MOCK), 'sha');
    expect(g.coverage.patternScan).toBeDefined();
    expect(g.coverage.patternScan!.patterns).toEqual([MOCK_PATTERN]);
    expect(g.coverage.patternScan!.hits).toEqual([
      { pattern: MOCK_PATTERN, file: 'src/api/metrics-route.ts', line: 3 },
    ]);
  });

  it('both extractors yield the IDENTICAL patternScan (ast/line-scan parity — content grep needs no AST)', () => {
    const dir = make(SEEDED_MOCK);
    const ast = new AstExtractor(patternCfg()).extract(dir, 'sha');
    const line = new LineScanExtractor(patternCfg()).extract(dir, 'sha');
    expect(stableStringify(line.coverage.patternScan)).toBe(stableStringify(ast.coverage.patternScan));
  });

  it('RED: a planted Math.random() mock literal produces a forbiddenPattern violation + verdict fail + score 60', () => {
    const g = new AstExtractor(patternCfg()).extract(make(SEEDED_MOCK), 'sha');
    const r = evaluate(patternBp(), g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    const v = r.violations.find((x) => x.constraintId === 'no-mock-random-metric');
    expect(v).toBeDefined();
    expect(v!.evidenceRef).toMatch(/#L\d+$/);
    expect(v!.evidenceRef).toBe('src/api/metrics-route.ts#L3');
    // one critical violation: 100 − 40 (SEVERITY_WEIGHT.critical) = 60.
    expect(r.score).toBe(60);
  });

  it('WITNESS: the SAME seeded repo scores 100/pass under an 0.8.0-era blueprint (forbiddenFile on a non-matching glob) — forbiddenPattern is the discriminator', () => {
    const cfg = resolveExtraction(witnessBp().extraction, witnessBp().constraints);
    const g = new AstExtractor(cfg).extract(make(SEEDED_MOCK), 'sha');
    const r = evaluate(witnessBp(), g, 'plugin-surface');
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });

  it('GREEN: a clean tree (real computation, no mock literal) scores 100/pass under forbiddenPattern', () => {
    const g = new AstExtractor(patternCfg()).extract(make(CLEAN), 'sha');
    const r = evaluate(patternBp(), g, 'plugin-surface');
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });

  it('PATH-NARROWED: an optional `path` glob restricts which files the pattern reddens', () => {
    const narrowed: Constraint = { ...PATTERN_CONSTRAINT, id: 'no-mock-in-lib', path: 'src/lib/**' };
    const bp = blueprint([narrowed], 'narrowed');
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    // the seeded hit lives under src/api/** — a src/lib/** narrowing must NOT fire on it.
    const g = new AstExtractor(cfg).extract(make(SEEDED_MOCK), 'sha');
    const r = evaluate(bp, g, 'plugin-surface');
    expect(r.violations).toHaveLength(0);
    expect(r.verdict).toBe('pass');
  });

  it('HONEST: a graph with NO patternScan records forbiddenPattern as SKIPPED — a pattern-only blueprint fails via __no-enforcing-constraints__ (never a silent pass)', () => {
    // A pre-0.9.0-shaped graph: coverage without patternScan (scannedFiles may exist — 0.8.0 shape).
    const preGraph: ArchitectureGraph = {
      schemaVersion: '1',
      ctRepoRevision: 'sha',
      components: [],
      guardEdges: [],
      coverage: {
        extractor: 'ast',
        filesScanned: 2,
        unsupported: [],
        scannedFiles: ['src/api/metrics-route.ts', 'src/lib/real-service.ts'],
      }, // NO patternScan
    };
    const r = evaluate(patternBp(), preGraph, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    const noEnforce = r.violations.find((v) => v.constraintId === '__no-enforcing-constraints__');
    expect(noEnforce).toBeDefined();
    expect(noEnforce!.observed.toLowerCase()).toContain('enforces nothing');
    expect(r.summary.toLowerCase()).toContain('skipped');
  });

  it('BACK-COMPAT: a blueprint with NO forbiddenPattern constraint yields a graph WITHOUT patternScan (pre-0.9.0 graphs serialize byte-unchanged)', () => {
    const cfg = resolveExtraction(witnessBp().extraction, witnessBp().constraints);
    const g = new AstExtractor(cfg).extract(make(SEEDED_MOCK), 'sha');
    expect(g.coverage.patternScan).toBeUndefined();
    expect(stableStringify(g)).not.toContain('patternScan');
  });

  it('DETERMINISM: two independent scan+evaluate runs produce byte-identical reports', () => {
    const dir = make(SEEDED_MOCK);
    const r1 = evaluate(patternBp(), new AstExtractor(patternCfg()).extract(dir, 'sha'), 'plugin-surface');
    const r2 = evaluate(patternBp(), new AstExtractor(patternCfg()).extract(dir, 'sha'), 'plugin-surface');
    expect(stableStringify(r1)).toBe(stableStringify(r2));
  });
});

describe('teeth — forbiddenPattern AND forbiddenFile are provably TOOTHED (the grounded default→TRIVIALLY_GREEN gap)', () => {
  it('a forbiddenPattern-only blueprint over a GREEN graph grades EVALUATOR_REFUTABLE (the injected hit is synthetic evidence)', () => {
    const g = new AstExtractor(patternCfg()).extract(make(CLEAN), 'sha');
    const teeth = assessTeeth(patternBp(), g, 'plugin-surface');
    expect(teeth.verdict).toBe('evaluator-refutable');
    const w = teeth.witnesses.find((x) => x.constraintId === 'no-mock-random-metric');
    expect(w).toBeDefined();
    expect(w!.verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
  });

  it('a forbiddenFile-only blueprint over a GREEN graph grades TOOTHED (was: default → TRIVIALLY_GREEN)', () => {
    const cfg = resolveExtraction(witnessBp().extraction, witnessBp().constraints);
    const g = new AstExtractor(cfg).extract(make(CLEAN), 'sha');
    const teeth = assessTeeth(witnessBp(), g, 'plugin-surface');
    expect(teeth.verdict).toBe('toothed');
    const w = teeth.witnesses.find((x) => x.constraintId === 'no-parallel-beta-provisioner');
    expect(w).toBeDefined();
    expect(w!.verdict).toBe(ConstraintTeeth.TOOTHED);
  });
});

describe('fail-closed validation — an invalid forbiddenPattern is a HARD authoring error', () => {
  it('a forbiddenPattern with a valid pattern parses', () => {
    expect(() => blueprint([PATTERN_CONSTRAINT])).not.toThrow();
  });

  it('a forbiddenPattern MISSING its pattern is rejected at validate time', () => {
    expect(() =>
      blueprint([{ id: 'refless', type: 'forbiddenPattern', severity: 'critical' } as Constraint]),
    ).toThrow(/pattern/i);
  });

  it('a forbiddenPattern with a NON-COMPILING regex is rejected at validate time (never a silent evaluate-time skip)', () => {
    expect(() =>
      blueprint([
        { id: 'bad-regex', type: 'forbiddenPattern', severity: 'critical', pattern: '([unclosed' } as Constraint,
      ]),
    ).toThrow(/regex|pattern/i);
  });

  // js/regex-injection (CodeQL HIGH): the schema superRefine safe-compiles author-supplied
  // `pattern` through the shared guard, so a ReDoS-shaped or over-length pattern is a HARD
  // validation error — never a live-DoS sink and never a silent skip.
  it('a forbiddenPattern with a catastrophic-backtracking regex is REFUSED at validate time (ReDoS fail-closed)', () => {
    expect(() =>
      blueprint([
        { id: 'redos-bomb', type: 'forbiddenPattern', severity: 'critical', pattern: '(a+)+' } as Constraint,
      ]),
    ).toThrow(/unsafe|backtrack|redos|regex|pattern/i);
  });

  it('a forbiddenPattern with an over-length regex is REFUSED at validate time (fail-closed)', () => {
    const overLong = 'a'.repeat(600);
    expect(() =>
      blueprint([
        { id: 'over-length', type: 'forbiddenPattern', severity: 'critical', pattern: overLong } as Constraint,
      ]),
    ).toThrow(/unsafe|length|cap|regex|pattern/i);
  });
});
