/**
 * teeth-evaluator-refutable.test.ts — the Class-A/free-TOOTHED canary, as a STANDING regression.
 *
 * The measured defect (2026-08-23, external canary run against this tree at 014cf12): a
 * forbiddenPattern constraint carrying the provably-unsatisfiable regex `(?!)` — and equally any
 * matchable literal ABSENT from the scanned source — received verdict `toothed`, exit 0, because
 * the teeth mutation injects a synthetic `patternScan` hit counted by string identity; the regex
 * never runs against any content. A conformance engine whose own vacuity checker hands out free
 * TOOTHED verdicts fails its own honesty bar. This file keeps that class dead:
 *
 *  - `(?!)` canary and a matchable-but-absent literal      → EVALUATOR_REFUTABLE, never TOOTHED
 *  - already-red pattern (extractor-real evidence)          → TOOTHED survives
 *  - non-renamed class (requiredComponent / forbiddenPath)  → plain TOOTHED unchanged
 *  - the retired scoreboard: the unqualified "have teeth (a realistic change would redden them)"
 *    banner never appears; evaluator-refutable text says NOT-evidence explicitly
 *  - exit classes: evaluator-refutable stays exit-0 (not a falsification); toothless stays exit 2.
 */
import { describe, it, expect } from 'vitest';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { parseBlueprint } from '../src/schema.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

const ABSENT_LITERAL = 'ZQXJVWKPLMNBTRHGFDSA-NEVER-MATCHES-ANY-REAL-SOURCE-7f3a91';

function bp(constraints: EngineeringBlueprint['constraints']): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'evaluator-refutable-canary', version: '1.0.0', status: 'approved' },
    intentRefs: ['intent:test'],
    scope: { repositories: ['example-org/example'] },
    architecture: { components: [], relationships: [] },
    constraints,
    evidenceRequirements: [],
    approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  });
}

function graph(opts: {
  components?: ArchitectureGraph['components'];
  patterns?: string[];
  hits?: { pattern: string; file: string; line: number }[];
}): ArchitectureGraph {
  const coverage = {
    extractor: 'ast',
    filesScanned: 1,
    unsupported: [],
    scannedFiles: ['src/a.ts'],
  } as unknown as ArchitectureGraph['coverage'];
  if (opts.patterns) {
    (coverage as { patternScan?: unknown }).patternScan = {
      patterns: [...opts.patterns].sort(),
      hits: opts.hits ?? [],
    };
  }
  return {
    schemaVersion: '1',
    ctRepoRevision: 'testsha',
    components: opts.components ?? [{ id: 'p:x', type: 'pluginRegistration', path: 'src/a.ts', line: 1 }],
    guardEdges: [],
    coverage,
  };
}

describe('the Class-A / free-TOOTHED canary stays dead', () => {
  it('CANARY: the impossible regex (?!) is EVALUATOR_REFUTABLE — never TOOTHED (the measured defect at 014cf12)', () => {
    const r = assessTeeth(
      bp([{ id: 'canary', type: 'forbiddenPattern', severity: 'critical', pattern: '(?!)' }]),
      graph({ patterns: [] }),
      'plugin-surface',
    );
    expect(r.witnesses[0]?.verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    expect(r.witnesses[0]?.verdict).not.toBe(ConstraintTeeth.TOOTHED);
    expect(r.toothed).toBe(0);
    expect(r.evaluatorRefutable).toBe(1);
    expect(r.verdict).toBe('evaluator-refutable');
    expect(r.witnesses[0]?.mutation).toContain('evaluator-only');
  });

  it('CANARY: a matchable-but-absent literal is EVALUATOR_REFUTABLE too (same class, same honesty)', () => {
    const r = assessTeeth(
      bp([{ id: 'absent', type: 'forbiddenPattern', severity: 'critical', pattern: ABSENT_LITERAL }]),
      graph({ patterns: [] }),
      'plugin-surface',
    );
    expect(r.witnesses[0]?.verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    expect(r.verdict).toBe('evaluator-refutable');
  });

  it('CONTROL (the probe must discriminate): an ALREADY-RED pattern keeps its extractor-real TOOTHED', () => {
    const r = assessTeeth(
      bp([{ id: 'hot', type: 'forbiddenPattern', severity: 'critical', pattern: 'api\\.openai\\.com' }]),
      graph({
        patterns: ['api\\.openai\\.com'],
        hits: [{ pattern: 'api\\.openai\\.com', file: 'src/a.ts', line: 4 }],
      }),
      'plugin-surface',
    );
    expect(r.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(r.witnesses[0]?.mutation).toContain('already-red');
    expect(r.verdict).toBe('toothed');
  });

  it('non-renamed class CONTROL: a forbiddenPath mutation stays plain TOOTHED (no blanket condemn)', () => {
    const r = assessTeeth(
      bp([{ id: 'fp', type: 'forbiddenPath', severity: 'high', path: 'src/legacy/**' }]),
      graph({}),
      'plugin-surface',
    );
    expect(r.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(r.verdict).toBe('toothed');
  });

  it('THE RETIRED SCOREBOARD: the unqualified "have teeth (a realistic change would redden them)" banner is gone', () => {
    const r = assessTeeth(
      bp([
        { id: 'fp', type: 'forbiddenPath', severity: 'high', path: 'src/legacy/**' },
        { id: 'p', type: 'forbiddenPattern', severity: 'critical', pattern: ABSENT_LITERAL },
      ]),
      graph({ patterns: [] }),
      'plugin-surface',
    );
    expect(r.verdict).toBe('toothed');
    expect(r.toothed).toBe(1);
    expect(r.evaluatorRefutable).toBe(1);
    expect(r.summary).not.toContain('have teeth (a realistic change would redden them)');
    expect(r.summary).toContain('EXTRACTOR-REAL');
    expect(r.summary).toContain('NOT evidence of real teeth');
  });

  it('verdict ladder + counters reconcile; determinism holds through the new class', () => {
    const b = bp([
      { id: 'p', type: 'forbiddenPattern', severity: 'critical', pattern: ABSENT_LITERAL },
      { id: 'fp', type: 'forbiddenPath', severity: 'high', path: 'src/legacy/**' },
    ]);
    const g = graph({ patterns: [] });
    const r = assessTeeth(b, g, 'plugin-surface');
    expect(r.toothed + r.evaluatorRefutable + r.triviallyGreen + r.indeterminate).toBe(
      r.witnesses.length,
    );
    expect(JSON.stringify(assessTeeth(b, g, 'plugin-surface'))).toBe(
      JSON.stringify(assessTeeth(b, g, 'plugin-surface')),
    );
  });
});
