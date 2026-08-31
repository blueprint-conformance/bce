/**
 * Quality matrix for the BLUEPRINT-DRIVEN extension surface — the generalization that lets
 * an operator author a blueprint (e.g. for a Luna chat extension) and gate a contributor's PR
 * on it. Covers: the `extraction` schema, the plugin-surface extractor (AST + line-scan),
 * the generalized `evaluate()` (requiredComponent / requiredDependency / forbiddenDependency /
 * forbiddenPath), the green→red discrimination on the real fixtures, determinism, extractor
 * parity, and the fail-closed floor.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EngineeringBlueprintSchema, parseBlueprint } from '../src/schema.js';
import {
  AstExtractor,
  LineScanExtractor,
  resolveExtraction,
  resolveFiles,
} from '../src/extractors.js';
import { evaluate } from '../src/report.js';
import type { EngineeringBlueprint } from '../src/schema.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
const blueprint: EngineeringBlueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));

const surface = (name: string): string => path.join(FIXROOT, 'extension-surface', name);
const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);

/* -------------------------------------------------------------------------- */
describe('extraction schema', () => {
  it('accepts the authored luna-chat-extension blueprint (with an extraction block)', () => {
    expect(() => parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')))).not.toThrow();
    expect(blueprint.extraction?.profile).toBe('plugin-surface');
  });

  it('REJECTS an unknown key inside the extraction block (.strict)', () => {
    const bad = {
      ...blueprint,
      extraction: { ...(blueprint.extraction ?? {}), bogus: true },
    };
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS an unknown extraction.profile enum value', () => {
    const bad = {
      ...blueprint,
      extraction: { ...(blueprint.extraction ?? {}), profile: 'not-a-profile' },
    };
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('a blueprint with NO extraction block resolves to the historical CT default (ratchet)', () => {
    const def = resolveExtraction(undefined);
    expect(def.profile).toBe('next-route-handler');
    expect(def.guardSymbols).toContain('requireTenantAccess');
    expect(def.minFiles).toBe(4);
  });
});

/* -------------------------------------------------------------------------- */
describe('resolveFiles glob resolution', () => {
  it('resolves an exact path (historical behavior)', () => {
    const files = resolveFiles(surface('conformant'), ['src/extensions/luna-chat.extension.ts']);
    expect(files).toHaveLength(1);
  });

  it('resolves a ** glob deterministically (sorted)', () => {
    const files = resolveFiles(surface('conformant'), ['src/extensions/**/*.ts']);
    expect(files.length).toBeGreaterThanOrEqual(1);
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it('a non-matching glob resolves to zero files (fail-closed input)', () => {
    expect(resolveFiles(surface('conformant'), ['src/nonexistent/**/*.ts'])).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('plugin-surface AST extractor', () => {
  it('recognizes the extension factory + a governed registerTool call (provides edge)', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant'), 'sha');
    expect(g.components.map((c) => c.id)).toContain('extension:luna-chat');
    expect(g.components.find((c) => c.id === 'extension:luna-chat')?.type).toBe('pluginSurface');
    const provides = g.guardEdges.filter((e) => e.type === 'provides');
    expect(provides).toHaveLength(1);
    expect(provides[0].to).toBe('registerTool');
  });

  it('detects a forbidden `openai` import as a forbidden imports edge', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-forbidden-import'), 'sha');
    const imports = g.guardEdges.filter((e) => e.type === 'imports');
    expect(imports.map((e) => e.to)).toContain('openai');
  });

  it('the drifted extension (no register) yields NO provides edge', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-no-register'), 'sha');
    expect(g.guardEdges.filter((e) => e.type === 'provides')).toHaveLength(0);
    // it is still a recognized extension component (so requiredComponent passes; the
    // requiredDependency is what fails).
    expect(g.components.map((c) => c.id)).toContain('extension:luna-chat');
  });

  // CURRIED-FACTORY FIX (2026-07-19): the REAL agent-host extensions are curried —
  //   export function createXxxExtension(deps): ExtensionFactory { return async (pi) => { pi.registerTool(...) } }
  // Pre-fix the extractor captured the OUTER factory's first param (`deps`) as the harness, so the
  // `pi.registerTool` inside the RETURNED arrow was never credited → all 56 real extensions scored 0.
  // The fix descends one level into the returned function. This test locks that in.
  it('CURRIED factory (create…Extension returns (pi) => {…}) credits the returned-arrow registerTool', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant-curried'), 'sha');
    // the factory is still recognized as an pluginSurface component
    expect(g.components.map((c) => c.id)).toContain('extension:luna-chat');
    // and the pi.registerTool inside the RETURNED arrow is credited as a provides edge (the fix)
    const provides = g.guardEdges.filter((e) => e.type === 'provides');
    expect(provides).toHaveLength(1);
    expect(provides[0].to).toBe('registerTool');
  });

  it('CURRIED conformant → score 100, pass (the real agent-host shape is now GREEN)', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant-curried'), 'sha');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
describe('bce run — green/red discrimination on the extension surface', () => {
  it('CONFORMANT → score 100, verdict pass, 0 violations', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant'), 'conformant');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });

  it('DRIFT (no governed registration) → fail, the ungoverned-registration constraint fires', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-no-register'), 'd1');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.score).toBe(60); // 100 - critical 40
    expect(r.violations.map((v) => v.constraintId)).toContain('ext-registers-through-governed-path');
  });

  it('DRIFT (direct provider SDK) → fail, the no-direct-provider-sdk constraint fires', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-forbidden-import'), 'd2');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.violations.map((v) => v.constraintId)).toContain('no-direct-provider-sdk');
    const v = r.violations.find((x) => x.constraintId === 'no-direct-provider-sdk');
    expect(v?.observed).toContain('openai');
  });
});

/* -------------------------------------------------------------------------- */
/* ADVERSARIAL REGRESSIONS — each closes a hole the adversarial-verify pass found.
 * Every drift variant MUST fail on BOTH the ast and line-scan extractors (a security
 * detector that only catches drift on the non-default extractor is a false sense of safety). */
describe('adversarial drift regressions (verify findings #1–#4)', () => {
  const extractors: ('ast' | 'line-scan')[] = ['ast', 'line-scan'];

  for (const ext of extractors) {
    const E = ext === 'ast' ? AstExtractor : LineScanExtractor;

    it(`[${ext}] #1 forbidden import in a file with an UNRECOGNIZED factory still fails`, () => {
      const g = new E(cfg).extract(surface('drift-unrecognized-factory'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      // the forbidden-import edge must be attributed even without a recognized component.
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });

    it(`[${ext}] #2 forbidden DYNAMIC import('openai') fails`, () => {
      const g = new E(cfg).extract(surface('drift-dynamic-import'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });

    it(`[${ext}] #4 forbidden require('openai') fails`, () => {
      const g = new E(cfg).extract(surface('drift-require'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });

    it(`[${ext}] #3 a DECOY .registerTool / local registerTool is NOT credited as governed`, () => {
      const g = new E(cfg).extract(surface('drift-decoy-register'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      // no provides edge → the ungoverned-registration constraint fires.
      expect(r.violations.some((v) => v.constraintId === 'ext-registers-through-governed-path')).toBe(true);
      expect(g.guardEdges.filter((e) => e.type === 'provides')).toHaveLength(0);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* SECOND-PASS adversarial regressions — holes the re-verify found in my first fix.
 * Every one MUST fail on BOTH extractors (no AST/line-scan disagreement). */
describe('adversarial drift regressions — round 2 (re-verify findings)', () => {
  const extractors: ('ast' | 'line-scan')[] = ['ast', 'line-scan'];
  for (const ext of extractors) {
    const E = ext === 'ast' ? AstExtractor : LineScanExtractor;

    it(`[${ext}] a STRAY governed register OUTSIDE the factory body does NOT satisfy provides`, () => {
      const g = new E(cfg).extract(surface('drift-stray-register'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'ext-registers-through-governed-path')).toBe(true);
    });

    it(`[${ext}] a RE-EXPORT of a forbidden module (export … from 'openai') fails`, () => {
      const g = new E(cfg).extract(surface('drift-reexport'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });

    it(`[${ext}] a bare registerTool imported from an UNGOVERNED module is not credited`, () => {
      const g = new E(cfg).extract(surface('drift-ungoverned-import'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'ext-registers-through-governed-path')).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
describe('forbidden-import / constraint sync (verify finding #5)', () => {
  it('a forbiddenDependency.to absent from extraction.forbiddenImports STILL fires (union is SoT)', () => {
    // blueprint whose extraction.forbiddenImports is EMPTY, but a constraint forbids openai.
    const bp = {
      ...blueprint,
      extraction: { ...(blueprint.extraction ?? {}), forbiddenImports: [] as string[] },
      constraints: [
        {
          id: 'no-openai',
          type: 'forbiddenDependency' as const,
          severity: 'critical' as const,
          from: '*',
          to: 'openai',
        },
      ],
    };
    const parsed = parseBlueprint(bp);
    const c2 = resolveExtraction(parsed.extraction, parsed.constraints);
    // the union picked up openai from the constraint, even though extraction.forbiddenImports was [].
    expect(c2.forbiddenImports).toContain('openai');
    const g = new AstExtractor(c2).extract(surface('drift-forbidden-import'), 'x');
    const r = evaluate(parsed, g);
    expect(r.verdict).toBe('fail');
    expect(r.violations.some((v) => v.constraintId === 'no-openai')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* THIRD-PASS regressions — fail-closed-on-vacuous-enforcement (re-verify round 3). */
describe('fail-closed on vacuous enforcement (re-verify round 3)', () => {
  it('#1 a blueprint whose constraints are ALL not-yet-implemented types FAILS (not vacuous pass)', () => {
    const bp = parseBlueprint({
      ...blueprint,
      constraints: [{ id: 'only-skipped', type: 'requiredEvidence', severity: 'high', evidenceType: 'x' }],
    });
    const g = new AstExtractor(resolveExtraction(bp.extraction, bp.constraints)).extract(surface('drift-forbidden-import'), 'x');
    const r = evaluate(bp, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.violations.some((v) => v.constraintId === '__no-enforcing-constraints__')).toBe(true);
  });

  it('#1 the schema REJECTS an empty constraints array at authoring time (.min(1))', () => {
    expect(EngineeringBlueprintSchema.safeParse({ ...blueprint, constraints: [] }).success).toBe(false);
  });

  it('#2 a requiredDependency over ZERO target components FAILS (not vacuous pass)', () => {
    const bp = parseBlueprint({
      ...blueprint,
      constraints: [{ id: 'wrong-target', type: 'requiredDependency', severity: 'critical', component: 'nonexistentType' }],
    });
    const g = new AstExtractor(resolveExtraction(bp.extraction, bp.constraints)).extract(surface('conformant'), 'x');
    const r = evaluate(bp, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.violations.some((v) => v.constraintId === 'wrong-target')).toBe(true);
  });

  it('#3 evidenceType:tenantGuard on an plugin-surface constraint does NOT retarget it to route semantics', () => {
    const bp = parseBlueprint({
      ...blueprint,
      constraints: blueprint.constraints.map((c) =>
        c.id === 'ext-registers-through-governed-path' ? { ...c, evidenceType: 'tenantGuard' } : c,
      ),
    });
    const g = new AstExtractor(resolveExtraction(bp.extraction, bp.constraints)).extract(surface('drift-no-register'), 'x');
    const r = evaluate(bp, g, 'plugin-surface');
    expect(r.verdict).toBe('fail'); // the governed-registration constraint still fires
    expect(r.violations.some((v) => v.constraintId === 'ext-registers-through-governed-path')).toBe(true);
  });

  it('#4 a forbidden module name in a TRAILING COMMENT does not phantom-fail (both extractors)', () => {
    for (const E of [AstExtractor, LineScanExtractor]) {
      const g = new E(cfg).extract(surface('conformant-comment'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('pass');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* FOURTH-PASS regressions — same-name harness shadowing + type-only-import. */
describe('adversarial round 4', () => {
  for (const ext of ['ast', 'line-scan'] as const) {
    const E = ext === 'ast' ? AstExtractor : LineScanExtractor;
    it(`[${ext}] a same-name shadowed harness decoy (const pi = {registerTool}) FAILS`, () => {
      const g = new E(cfg).extract(surface('drift-shadow-harness'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'ext-registers-through-governed-path')).toBe(true);
    });
    it(`[${ext}] a TYPE-ONLY forbidden import (import type … from 'openai') does NOT false-fail`, () => {
      const g = new E(cfg).extract(surface('conformant-typeimport'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('pass');
    });
  }
});

/* -------------------------------------------------------------------------- */
/* FIFTH-PASS regression — template-literal (backtick) module specifier bypass. */
describe('adversarial round 5 — template-literal specifiers', () => {
  for (const ext of ['ast', 'line-scan'] as const) {
    const E = ext === 'ast' ? AstExtractor : LineScanExtractor;
    it(`[${ext}] require(\`openai\`) (backtick) is caught`, () => {
      const g = new E(cfg).extract(surface('drift-require-template'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });
    it(`[${ext}] import(\`openai\`) (backtick dynamic) is caught`, () => {
      const g = new E(cfg).extract(surface('drift-dynamic-template'), 'x');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('fail');
      expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
describe('from-specific forbiddenDependency on an unattributable file (re-verify round 6)', () => {
  it('a from-specific forbiddenDependency STILL catches a forbidden import in an unrecognized-factory file', () => {
    const bp = parseBlueprint({
      ...blueprint,
      constraints: [
        { id: 'no-openai-from-specific', type: 'forbiddenDependency', severity: 'critical', from: 'extension:luna-chat', to: 'openai' },
      ],
    });
    const g = new AstExtractor(resolveExtraction(bp.extraction, bp.constraints)).extract(surface('drift-unrecognized-factory'), 'x');
    const r = evaluate(bp, g, 'plugin-surface');
    // the `file:` pseudo-id edge must match the named `from` — the forbidden import is not dropped.
    expect(r.verdict).toBe('fail');
    expect(r.violations.some((v) => v.constraintId === 'no-openai-from-specific')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('coverage honesty envelope (verify finding #6)', () => {
  it('the ComplianceReport surfaces the coverage envelope to a gate consumer', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant'), 'x');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.coverage).toBeDefined();
    expect(r.coverage.extractor).toBe('ast');
    expect(Array.isArray(r.coverage.unsupported)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('generalized evaluate — constraint types', () => {
  it('requiredComponent fires when the scanned surface has no component of the type', () => {
    // an empty observed graph → requiredComponent(pluginSurface) must fail.
    const emptyGraph = {
      schemaVersion: '1' as const,
      ctRepoRevision: 'x',
      components: [],
      guardEdges: [],
      coverage: { extractor: 'ast' as const, filesScanned: 1, unsupported: [] },
    };
    const r = evaluate(blueprint, emptyGraph);
    expect(r.violations.map((v) => v.constraintId)).toContain('ext-must-be-recognizable');
  });
});

/* -------------------------------------------------------------------------- */
describe('determinism + extractor parity', () => {
  it('AST is byte-deterministic on the conformant surface', () => {
    const a = evaluate(blueprint, new AstExtractor(cfg).extract(surface('conformant'), 'c'));
    const b = evaluate(blueprint, new AstExtractor(cfg).extract(surface('conformant'), 'c'));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('line-scan AGREES with AST on the forbidden-import verdict', () => {
    const ast = evaluate(blueprint, new AstExtractor(cfg).extract(surface('drift-forbidden-import'), 'd'));
    const line = evaluate(blueprint, new LineScanExtractor(cfg).extract(surface('drift-forbidden-import'), 'd'));
    expect(ast.verdict).toBe('fail');
    expect(line.verdict).toBe('fail');
    // both must catch the forbidden openai import
    expect(ast.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
    expect(line.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
  });
});
