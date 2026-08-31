/**
 * self-blueprint.test.ts — self-hosting v0: the engine's OWN blueprint stays true.
 *
 * `.blueprints/engine.blueprint.json` declares the engine's real architecture
 * (extraction-seam isolation, pure evaluator, single exit point, runtime-dep
 * allowlist). Three properties are proven here:
 *
 *  1. SYNC — the blueprint's per-file constraint coverage tracks the ACTUAL
 *     `src/*.ts` file set. Several constraints are per-file because a
 *     `forbiddenPattern` carries ONE `path` glob and glob negation ("every file
 *     EXCEPT cli.ts") is deliberately unsupported. Adding a src file without
 *     extending the blueprint fails THIS test — the new-file gap is closed by
 *     construction, not by convention.
 *  2. GREEN + TOOTHED — the gate passes on the authored tree AND `assessTeeth`
 *     proves every constraint refutable (a realistic change would redden it).
 *     A green that cannot fail proves nothing (the toothless trap).
 *  3. TEETH scopePaths REGRESSION — the forbiddenDependency reddening mutation
 *     must inject its synthetic edge INSIDE the constraint's scopePaths (found
 *     by self-hosting: the historical `teeth:injected` evidenceRef matches no
 *     real glob, so a scoped, genuinely-toothed constraint was spuriously
 *     labeled TRIVIALLY_GREEN).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint } from '../src/schema.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import { runGate } from '../src/gate.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { makeExtractor, resolveExtraction } from '../src/extractors.js';
import type { ArchitectureGraph } from '../src/graph.js';

const ROOT = path.join(__dirname, '..');
const BLUEPRINT_PATH = path.join(ROOT, '.blueprints', 'engine.blueprint.json');

function loadBlueprint(): EngineeringBlueprint {
  return parseBlueprint(JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')));
}

function srcFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

// The sanctioned process-owning ENTRYPOINTS (bins). These are the ONLY src files that may call
// `process.exit` — a bin owns its own process lifecycle; a library module never does. cli.ts is the
// `bce` bin; mcp-server.ts is the `bce-mcp` stdio server bin. Both are deliberately EXCLUDED from
// the per-file `only-cli-may-call-process-exit--*` coverage, exactly as cli.ts always has been.
// A new entrypoint bin is added here (one line) the same way a new library file is added to the
// blueprint — the new-file gap is closed by construction, not convention.
const ENTRYPOINTS = ['cli.ts', 'mcp-server.ts'];

describe('self-blueprint: the engine gates its own architecture', () => {
  it('parses STRICTLY as an EngineeringBlueprint (typos are hard errors)', () => {
    const bp = loadBlueprint();
    expect(bp.metadata.id).toBe('bce-engine-architecture');
    expect(bp.extraction?.profile).toBe('plugin-surface');
  });

  it('SYNC: every non-entrypoint src file carries a no-process-exit constraint', () => {
    const bp = loadBlueprint();
    const libraryFiles = srcFiles().filter((f) => !ENTRYPOINTS.includes(f));
    for (const f of libraryFiles) {
      const id = `only-cli-may-call-process-exit--${f.replace(/\.ts$/, '')}`;
      const c = bp.constraints.find((x) => x.id === id);
      expect(c, `missing constraint '${id}' — a new src file must be added to the self-blueprint`).toBeDefined();
      expect(c?.type).toBe('forbiddenPattern');
      expect(c?.path).toBe(`src/${f}`);
    }
    // and the ENTRYPOINT bins themselves are deliberately NOT covered — each owns its own process
    // lifecycle (cli.ts is the `bce` bin, mcp-server.ts is the `bce-mcp` bin). The library-modules-
    // never-exit policy applies to everything else.
    for (const ep of ENTRYPOINTS) {
      const id = `only-cli-may-call-process-exit--${ep.replace(/\.ts$/, '')}`;
      expect(bp.constraints.find((x) => x.id === id), `entrypoint '${ep}' must NOT carry a no-exit constraint`).toBeUndefined();
    }
  });

  it('SYNC: the ts-morph seam constraint scopes EVERY src file except extractors.ts', () => {
    const bp = loadBlueprint();
    const c = bp.constraints.find((x) => x.id === 'only-extractors-may-import-ts-morph');
    expect(c).toBeDefined();
    const expected = srcFiles()
      .filter((f) => f !== 'extractors.ts')
      .map((f) => `src/${f}`);
    expect([...(c?.scopePaths ?? [])].sort()).toEqual(expected);
  });

  it('SYNC: extraction.minFiles equals the actual src file count (fail-closed scan floor)', () => {
    const bp = loadBlueprint();
    expect(bp.extraction?.minFiles).toBe(srcFiles().length);
  });

  it('GATE: the engine gates its own tree GREEN (full sweep, AST extractor)', () => {
    const result = runGate(ROOT, path.join(ROOT, '.blueprints'), null, 'ast', 'blueprint-conformance/bce');
    expect(result.blueprintsDiscovered).toBeGreaterThanOrEqual(1);
    expect(result.blueprintsSelected).toBe(result.blueprintsDiscovered);
    expect(result.failed, JSON.stringify(result.reports.flatMap((r) => r.violations), null, 2)).toBe(false);
    for (const r of result.reports) expect(r.score).toBe(100);
  });

  it('TEETH: every self-blueprint constraint is refutable — no trivially-green, no indeterminate', () => {
    const bp = loadBlueprint();
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    const graph = makeExtractor('ast', cfg).extract(ROOT, 'selftest');
    const teeth = assessTeeth(bp, graph, 'plugin-surface');
    // The self-blueprint is 29 forbiddenPattern + 1 forbiddenDependency — all synthetic-evidence
    // classes, so with zero extractor-real teeth its honest verdict is `evaluator-refutable`
    // (refutable in principle, exit-0 class). The property this test guards is unchanged: NOTHING
    // is trivially-green or indeterminate.
    expect(teeth.verdict).toBe('evaluator-refutable');
    const nonRefutable = teeth.witnesses.filter(
      (w) => w.verdict !== ConstraintTeeth.TOOTHED && w.verdict !== ConstraintTeeth.EVALUATOR_REFUTABLE,
    );
    expect(nonRefutable, JSON.stringify(nonRefutable, null, 2)).toEqual([]);
  });
});

describe('teeth: forbiddenDependency reddening mutation respects scopePaths (self-hosting regression)', () => {
  const emptyGraph: ArchitectureGraph = {
    schemaVersion: '1',
    ctRepoRevision: 'test',
    components: [],
    guardEdges: [],
    coverage: { scannedFiles: [], unsupported: [] } as ArchitectureGraph['coverage'],
  };

  function scopedBp(scopePaths: string[]): EngineeringBlueprint {
    return parseBlueprint({
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'EngineeringBlueprint',
      metadata: { id: 'scoped-dep', version: '1.0.0', status: 'approved' },
      intentRefs: ['test'],
      scope: { repositories: ['example-org/example'] },
      architecture: { components: [], relationships: [] },
      constraints: [
        {
          id: 'scoped-forbidden-dep',
          type: 'forbiddenDependency',
          severity: 'critical',
          from: '*',
          to: 'forbidden-module',
          scopePaths,
        },
      ],
      evidenceRequirements: [],
      approvals: [],
      extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
    });
  }

  it('a scopePaths-narrowed forbiddenDependency is refutable — EVALUATOR_REFUTABLE, never TRIVIALLY_GREEN (the historical regression)', () => {
    // Discriminating: with the historical 'teeth:injected' evidenceRef this witness was
    // TRIVIALLY_GREEN (the synthetic edge's from-file matched no scope glob, so the oracle
    // never reddened) — the fix injects at a concrete in-scope path instead. The honesty split
    // grades the flip EVALUATOR_REFUTABLE (synthetic evidence); the regression this guards is
    // the false TRIVIALLY_GREEN, which must never return.
    const teeth = assessTeeth(scopedBp(['src/deep/**/*.ts', 'src/other.ts']), emptyGraph, 'plugin-surface');
    expect(teeth.witnesses[0].verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    expect(teeth.witnesses[0].verdict).not.toBe(ConstraintTeeth.TRIVIALLY_GREEN);
  });

  it('an unscoped forbiddenDependency grades the same class (no behavior change on the historical path)', () => {
    const teeth = assessTeeth(scopedBp([]), emptyGraph, 'plugin-surface');
    expect(teeth.witnesses[0].verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
  });
});
