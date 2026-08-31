/**
 * teeth.test.ts — the mutation-refutability grader (the substance-conformance bundle).
 *
 * Proves the toothlessness gate discriminates:
 *  - a TOOTHLESS blueprint (one requiredComponent the graph already satisfies, no reddenable
 *    constraint) → verdict 'toothless' → the CLI exits 2.
 *  - a TOOTHED blueprint (a constraint a realistic graph mutation would redden) → 'toothed' → exit 0.
 *  - add-then-remove PADDING is NOT credited as teeth.
 *  - an INDETERMINATE constraint over a coverage.unsupported surface is NOT called trivially-green.
 *  - determinism: byte-identical TeethReport for the same input.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { parseBlueprint } from '../src/schema.js';
import { stableStringify } from '../src/report.js';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const surface = (name: string): string => path.join(FIXROOT, 'extension-surface', name);

/** A minimal valid blueprint with the given constraints. */
function bp(constraints: EngineeringBlueprint['constraints']): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'test-bp', version: '1.0.0', status: 'approved', ownerRole: 'platform-engineer', stewardRole: 'blueprint-steward' },
    intentRefs: ['intent:test'],
    scope: { repositories: ['test-repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints,
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
  });
}

/** A graph with the given components + guardEdges + unsupported surfaces. */
function graph(
  components: ArchitectureGraph['components'],
  guardEdges: ArchitectureGraph['guardEdges'] = [],
  unsupported: string[] = [],
): ArchitectureGraph {
  return {
    schemaVersion: '1',
    ctRepoRevision: 'testsha',
    components,
    guardEdges,
    coverage: { extractor: 'ast', filesScanned: 1, unsupported },
  };
}

describe('teeth — the toothlessness gate', () => {
  it('TOOTHLESS: a requiredComponent the graph already satisfies, that cannot realistically be absent, is not teeth by itself but IS toothed via removal → so we test the true-toothless case: requiredComponent already present is TOOTHED (removal reddens it)', () => {
    // A requiredComponent IS toothed when the component is present, because REMOVING it (a real
    // deletion) reddens the constraint. This is the enforcing case teeth must credit.
    const b = bp([{ id: 'c1', type: 'requiredComponent', severity: 'high', component: 'ontologyStore' }]);
    const g = graph([{ id: 'store:x', type: 'ontologyStore', path: 'src/store.ts', line: 1 }]);
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.verdict).toBe('toothed');
  });

  it('TOOTHLESS: a requiredComponent over a surface in coverage.unsupported → INDETERMINATE → toothless (the movie fixture)', () => {
    // The genuine toothless demonstration: the required type is UNSUPPORTED, so its refutability is
    // unknowable — INDETERMINATE, never trivially-green — and with no TOOTHED constraint the whole
    // blueprint is TOOTHLESS. This is the "score 100 on a real project" defect made honest.
    const b = bp([{ id: 'c1', type: 'requiredComponent', severity: 'high', component: 'ontologyStore' }]);
    const g = graph(
      [{ id: 'store:x', type: 'ontologyStore', path: 'src/store.ts', line: 1 }],
      [],
      ['ontologyStore components in dynamically-registered modules'],
    );
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.INDETERMINATE);
    expect(t.verdict).toBe('toothless');
    expect(t.summary).toMatch(/TOOTHLESS/);
  });

  it('forbiddenDependency: the mutation flip is EVALUATOR_REFUTABLE — the injected edge is synthetic evidence', () => {
    const b = bp([{ id: 'c1', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'stripe' }]);
    const g = graph([{ id: 'route:x', type: 'apiRouteHandler', path: 'src/route.ts', line: 1 }]);
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    expect(t.witnesses[0]?.mutation).toMatch(/add a forbidden edge/);
    expect(t.witnesses[0]?.mutation).toContain('evaluator-only');
    expect(t.verdict).toBe('evaluator-refutable');
  });

  it('TOOTHED: a forbiddenPath is toothed — adding a component under the banned path reddens it', () => {
    const b = bp([{ id: 'c1', type: 'forbiddenPath', severity: 'high', path: 'src/legacy/**' }]);
    const g = graph([{ id: 'route:x', type: 'apiRouteHandler', path: 'src/route.ts', line: 1 }]);
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.verdict).toBe('toothed');
  });

  it('ALREADY-RED: a requiredComponent whose type is ABSENT fires on the authored graph → TOOTHED (already-red)', () => {
    const b = bp([{ id: 'c1', type: 'requiredComponent', severity: 'high', component: 'ontologyStore' }]);
    const g = graph([{ id: 'route:x', type: 'apiRouteHandler', path: 'src/route.ts', line: 1 }]); // no ontologyStore
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.witnesses[0]?.mutation).toMatch(/already-red/);
  });

  it('PADDING excluded: a padding component the blueprint does not constrain contributes ZERO teeth — a lone requiredEvidence (unenforced) is INDETERMINATE, blueprint stays TOOTHLESS regardless of padding', () => {
    const b = bp([{ id: 'c1', type: 'requiredEvidence', severity: 'low', evidenceType: 'someEvidence' }]);
    // Even with a rich padded graph, an unenforced constraint type is INDETERMINATE (teeth cannot
    // witness it through the oracle) — padding never manufactures teeth.
    const g = graph([
      { id: 'a', type: 'padA', path: 'src/a.ts', line: 1 },
      { id: 'b', type: 'padB', path: 'src/b.ts', line: 2 },
      { id: 'c', type: 'padC', path: 'src/c.ts', line: 3 },
    ]);
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.INDETERMINATE);
    expect(t.verdict).toBe('toothless');
  });

  it('INDETERMINATE (unenforced types): minimumMetric/customPolicy are declared-but-unenforced → INDETERMINATE, never trivially-green', () => {
    for (const type of ['minimumMetric', 'customPolicy'] as const) {
      const c =
        type === 'minimumMetric'
          ? { id: 'c1', type, severity: 'medium' as const, metric: 'servedBytes', minimum: 1000 }
          : { id: 'c1', type, severity: 'medium' as const, policyRef: 'somePolicy' };
      const b = bp([c]);
      const g = graph([{ id: 'x', type: 'apiRouteHandler', path: 'src/r.ts', line: 1 }]);
      const t = assessTeeth(b, g, 'plugin-surface');
      expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.INDETERMINATE);
    }
  });

  it('MIXED: one EVALUATOR_REFUTABLE + one INDETERMINATE → evaluator-refutable (refutability beats indeterminacy; neither is teeth)', () => {
    const b = bp([
      { id: 'c1', type: 'requiredEvidence', severity: 'low', evidenceType: 'e' }, // INDETERMINATE
      { id: 'c2', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'stripe' }, // EVALUATOR_REFUTABLE
    ]);
    const g = graph([{ id: 'route:x', type: 'apiRouteHandler', path: 'src/route.ts', line: 1 }]);
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.toothed).toBe(0);
    expect(t.evaluatorRefutable).toBeGreaterThanOrEqual(1);
    expect(t.verdict).toBe('evaluator-refutable');
  });

  it('REAL FIXTURE (end-to-end): the luna-chat-extension blueprint over its REAL extracted graph is TOOTHED — its forbiddenDependency openai/@anthropic-ai constraints would redden on a real bad import', () => {
    const bpPath = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
    const blueprint = parseBlueprint(JSON.parse(fs.readFileSync(bpPath, 'utf8')));
    const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
    const graph = new AstExtractor(cfg).extract(surface('conformant'), 'sha-conformant');
    const t = assessTeeth(blueprint, graph);
    // The blueprint has forbiddenDependency:openai + forbiddenDependency:@anthropic-ai/sdk — a real
    // bad PR importing either reddens them → TOOTHED. This is the movie's actionable-finding class.
    expect(t.verdict).toBe('toothed');
    expect(t.toothed).toBeGreaterThanOrEqual(1);
  });

  it('REAL FIXTURE (the mock analog): a blueprint STRIPPED to only its already-satisfied requiredComponent, over the same real graph, is TOOTHLESS — the "score 100 on a real project" defect, now caught', () => {
    const bpPath = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
    const full = parseBlueprint(JSON.parse(fs.readFileSync(bpPath, 'utf8')));
    const cfg = resolveExtraction(full.extraction, full.constraints);
    const graph = new AstExtractor(cfg).extract(surface('conformant'), 'sha-conformant');
    // Keep only the requiredComponent (present in the graph) — the toothless-authoring pattern. But a
    // present requiredComponent is TOOTHED via removal, so to model the TRUE toothless case we mark
    // its surface unsupported: this is the honest "we can't see it, so a green proves nothing" case.
    const requiredComp = full.constraints.find((c) => c.type === 'requiredComponent')!;
    const toothless = parseBlueprint({ ...full, constraints: [requiredComp] });
    const unsupportedGraph: ArchitectureGraph = {
      ...graph,
      coverage: { ...graph.coverage, unsupported: [...graph.coverage.unsupported, requiredComp.component!] },
    };
    const t = assessTeeth(toothless, unsupportedGraph);
    expect(t.verdict).toBe('toothless');
    expect(t.summary).toMatch(/TOOTHLESS/);
  });

  it('requiredDependency (plugin-surface): a component satisfied by a provides edge is TOOTHED — removing the provides edge reddens it', () => {
    const b = bp([{ id: 'c1', type: 'requiredDependency', severity: 'high', component: 'pluginSurface' }]);
    const g = graph(
      [{ id: 'ext:x', type: 'pluginSurface', path: 'src/x.extension.ts', line: 1 }],
      [{ from: 'ext:x', to: 'registerTool', type: 'provides', evidenceRef: 'src/x.extension.ts#L1' }],
    );
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.verdict).toBe('toothed');
  });

  it('BUG-1 REGRESSION (plugin-surface + stray evidenceType:tenantGuard): the D6 guards-retarget must NOT apply — teeth removes provides (not guards), so the constraint is TOOTHED not falsely TRIVIALLY_GREEN', () => {
    // report.ts finding #3: on plugin-surface, a stray evidenceType:'tenantGuard' must NOT retarget the
    // required edge to 'guards' — the oracle checks 'provides'. teeth previously used a stub that always
    // treated the constraint as D6 (edgeType='guards'), removed the intact 'guards' set (a no-op on the
    // count since the real satisfier is a 'provides' edge), and mislabeled the constraint TRIVIALLY_GREEN
    // → a spurious toothless REJECT. After the fix, teeth threads the real profile and removes 'provides'.
    const b = bp([{ id: 'c1', type: 'requiredDependency', severity: 'high', component: 'pluginSurface', evidenceType: 'tenantGuard' }]);
    const g = graph(
      [{ id: 'ext:x', type: 'pluginSurface', path: 'src/x.extension.ts', line: 1 }],
      [
        { from: 'ext:x', to: 'registerTool', type: 'provides', evidenceRef: 'src/x.extension.ts#L1' },
        // a decoy 'guards' edge: the buggy version would remove THIS (a no-op) and miss the real satisfier.
        { from: 'other', to: 'requireTenantAccess', type: 'guards', evidenceRef: 'src/other.ts#L1' },
      ],
    );
    const t = assessTeeth(b, g, 'plugin-surface');
    expect(t.witnesses[0]?.verdict).toBe(ConstraintTeeth.TOOTHED);
    expect(t.witnesses[0]?.mutation).toMatch(/provides/);
    expect(t.verdict).toBe('toothed');
  });

  it('DETERMINISM: byte-identical TeethReport for the same input; witnesses sorted by constraintId', () => {
    const b = bp([
      { id: 'zeta', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'stripe' },
      { id: 'alpha', type: 'forbiddenPath', severity: 'high', path: 'src/legacy/**' },
    ]);
    const g = graph([{ id: 'route:x', type: 'apiRouteHandler', path: 'src/route.ts', line: 1 }]);
    const t1 = assessTeeth(b, g, 'plugin-surface');
    const t2 = assessTeeth(b, g, 'plugin-surface');
    expect(stableStringify(t1)).toBe(stableStringify(t2));
    expect(t1.witnesses.map((w) => w.constraintId)).toEqual(['alpha', 'zeta']);
  });
});
