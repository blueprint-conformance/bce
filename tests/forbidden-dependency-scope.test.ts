/**
 * forbidden-dependency-scope.test.ts — the `forbiddenDependency.scopePaths` narrowing (0.9.0).
 *
 * WHY THIS EXISTS: a `forbiddenDependency` fires on EVERY importer of the forbidden module,
 * because its from-matching includes an `e.from.startsWith('file:')` catch-all for unattributable
 * (component-less) files. So a tooth like "a ROUTE must not import ./session-attach.js directly"
 * ALSO fires on the legitimate barrel (index.ts) and the factory file that import the same module —
 * making it impossible to scope to just the re-implementation seam. `scopePaths` restricts the
 * forbidden-import hit to edges whose from-FILE glob-matches one of the scope globs.
 *
 * This suite proves, on ONE extracted seed tree with THREE importers of the forbidden module:
 *   (UNSCOPED)  no scopePaths → all three importers reddened (today's behavior, unchanged);
 *   (SCOPED)    scopePaths:[the two "route" files] → ONLY those two reddened, the barrel EXEMPT;
 *   (ADDITIVE)  a constraint omitting scopePaths is byte-identical to pre-0.9.0.
 *
 * Self-contained: builds a temp tree — no committed fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import { evaluate } from '../src/report.js';
import { EngineeringBlueprintSchema, type EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A tree with a forbidden module (`./attach.js`) imported by THREE files:
 *  two "route" files (the re-implementation seam) + one legit "barrel" (index.ts). */
function seedTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'bce-scope-'));
  dirs.push(root);
  const tui = join(root, 'src', 'tui');
  mkdirSync(tui, { recursive: true });
  writeFileSync(join(tui, 'attach.js'), 'export function attachToSession() {}\n');
  // the two ROUTE files re-implementing attach (value-import of the forbidden module)
  writeFileSync(join(tui, 'route-a.tsx'), "import { attachToSession } from './attach.js';\nexport function RouteA() { attachToSession(); }\n");
  writeFileSync(join(tui, 'route-b.tsx'), "import { attachToSession } from './attach.js';\nexport function RouteB() { attachToSession(); }\n");
  // the LEGIT barrel that also imports the module (must be EXEMPT when scoped)
  writeFileSync(join(tui, 'index.ts'), "export { attachToSession } from './attach.js';\n");
  return root;
}

function blueprint(scopePaths?: string[]): EngineeringBlueprint {
  return EngineeringBlueprintSchema.parse({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'scope-bp', name: 'scope', version: '0.1.0', status: 'draft', ownerRole: 'platform-engineer', stewardRole: 'blueprint-steward' },
    intentRefs: ['t'],
    scope: { repositories: ['repo'], paths: ['src/**'], environments: ['staging'] },
    extraction: { profile: 'plugin-surface', paths: ['src/tui/**/*.ts', 'src/tui/**/*.tsx'], guardSymbols: ['on'], governedModules: [], forbiddenImports: [], minFiles: 1 },
    architecture: { components: [], relationships: [] },
    constraints: [
      {
        id: 'route-no-direct-attach',
        type: 'forbiddenDependency',
        severity: 'high',
        from: '*',
        to: './attach.js',
        ...(scopePaths ? { scopePaths } : {}),
      },
    ],
    evidenceRequirements: [],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
  });
}

function scoreEdges(bp: EngineeringBlueprint, root: string): string[] {
  const cfg = resolveExtraction(bp.extraction, bp.constraints);
  const graph: ArchitectureGraph = new AstExtractor(cfg).extract(root, 'testsha');
  const report = evaluate(bp, graph, cfg.profile);
  return report.violations
    .filter((v) => v.constraintId === 'route-no-direct-attach')
    .map((v) => v.evidenceRef ?? v.component ?? '')
    .sort();
}

describe('forbiddenDependency.scopePaths — narrowing the from-file set', () => {
  it('UNSCOPED: no scopePaths → all three importers (both routes + barrel) reddened', () => {
    const root = seedTree();
    const hits = scoreEdges(blueprint(), root);
    // all three files import ./attach.js → three violations
    expect(hits.length).toBe(3);
    expect(hits.some((h) => h.includes('route-a.tsx'))).toBe(true);
    expect(hits.some((h) => h.includes('route-b.tsx'))).toBe(true);
    expect(hits.some((h) => h.includes('index.ts'))).toBe(true);
  });

  it('SCOPED: scopePaths:[the two routes] → ONLY the routes reddened, the barrel EXEMPT', () => {
    const root = seedTree();
    const hits = scoreEdges(blueprint(['src/tui/route-a.tsx', 'src/tui/route-b.tsx']), root);
    expect(hits.length).toBe(2);
    expect(hits.some((h) => h.includes('route-a.tsx'))).toBe(true);
    expect(hits.some((h) => h.includes('route-b.tsx'))).toBe(true);
    // the barrel is OUT of scope → NOT a violation (the whole point)
    expect(hits.some((h) => h.includes('index.ts'))).toBe(false);
  });

  it('SCOPED with a glob: scopePaths:["src/tui/route-*.tsx"] → both routes, barrel exempt', () => {
    const root = seedTree();
    const hits = scoreEdges(blueprint(['src/tui/route-*.tsx']), root);
    expect(hits.length).toBe(2);
    expect(hits.some((h) => h.includes('index.ts'))).toBe(false);
  });

  it('SCOPED to a non-matching path → zero violations (fully narrowed away)', () => {
    const root = seedTree();
    const hits = scoreEdges(blueprint(['src/tui/nonexistent.tsx']), root);
    expect(hits.length).toBe(0);
  });
});
