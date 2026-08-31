import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineeringBlueprintSchema, parseBlueprint } from '../src/schema.js';
import { AstExtractor, LineScanExtractor } from '../src/extractors.js';
import { evaluate, stableStringify, SEVERITY_WEIGHT } from '../src/report.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'control-tower-ontology.blueprint.json');
const blueprint: EngineeringBlueprint = parseBlueprint(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));

/** A tiny synthetic CT-shaped tree: one guarded route + one UNGUARDED route. */
function synthTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-test-'));
  const guarded = path.join(dir, 'src/app/api/tenants/[id]/objects');
  fs.mkdirSync(guarded, { recursive: true });
  // objects/route.ts — GET is guarded; note the JSDoc mentions requireTenantWriteAccess
  // (the false-positive an AST must NOT count as a call).
  fs.writeFileSync(
    path.join(guarded, 'route.ts'),
    [
      '/**',
      ' * GET reads via requireTenantAccess; POST writes via requireTenantWriteAccess.',
      ' */',
      "import { requireTenantAccess } from '@/lib/auth-middleware';",
      '',
      'export async function GET(req: Request, ctx: unknown): Promise<Response> {',
      '  const auth = await requireTenantAccess("id");',
      '  return new Response(JSON.stringify({ ok: auth }));',
      '}',
      '',
      '// POST intentionally has NO guard call — a D6 violation the diff must catch.',
      'export async function POST(req: Request, ctx: unknown): Promise<Response> {',
      '  return new Response("created");',
      '}',
      '',
    ].join('\n'),
  );
  return dir;
}

describe('EngineeringBlueprintSchema', () => {
  it('accepts the authored control-tower-ontology blueprint', () => {
    expect(() => parseBlueprint(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')))).not.toThrow();
  });

  it('REJECTS a blueprint missing the required intentRefs (v0.9 requires min 1)', () => {
    const bad = { ...blueprint } as Record<string, unknown>;
    delete bad.intentRefs;
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS an unknown top-level key (.strict mirrors additionalProperties:false)', () => {
    const bad = { ...blueprint, bogusField: true };
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS a non-semver metadata.version', () => {
    const bad = { ...blueprint, metadata: { ...blueprint.metadata, version: 'v1' } };
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });
});

describe('AstExtractor', () => {
  it('detects the GET guard call and does NOT count the JSDoc mention as a call', () => {
    const dir = synthTree();
    try {
      const g = new AstExtractor().extract(dir, 'testsha');
      // two handlers (GET, POST); exactly ONE guard edge (GET), NOT counting JSDoc text.
      expect(g.components.map((c) => c.id).sort()).toEqual(['route:objects:GET', 'route:objects:POST']);
      expect(g.guardEdges.map((e) => e.from)).toEqual(['route:objects:GET']);
      expect(g.guardEdges[0].to).toBe('requireTenantAccess');
      expect(g.coverage.extractor).toBe('ast');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT credit a PROPERTY-ACCESS look-alike (svc.requireTenantWriteAccess) as a guard', () => {
    // Security-critical: a member call on some object is NOT the imported guard middleware.
    // A handler that only calls `svc.requireTenantWriteAccess(id)` must score as UNGUARDED.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-prop-'));
    const routeDir = path.join(dir, 'src/app/api/tenants/[id]/objects');
    fs.mkdirSync(routeDir, { recursive: true });
    fs.writeFileSync(
      path.join(routeDir, 'route.ts'),
      [
        "const svc = { requireTenantWriteAccess: (_: string) => true };",
        'export async function POST(req: Request): Promise<Response> {',
        '  const ok = svc.requireTenantWriteAccess("id"); // NOT the real guard',
        '  return new Response(String(ok));',
        '}',
        '',
      ].join('\n'),
    );
    try {
      const g = new AstExtractor().extract(dir, 'testsha');
      expect(g.components.map((c) => c.id)).toEqual(['route:objects:POST']);
      // the property-access call must produce ZERO guard edges -> the handler is a D6 violation.
      expect(g.guardEdges).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('LineScanExtractor', () => {
  it('agrees with the AST extractor on the synthetic tree (same 2 handlers, 1 guard edge)', () => {
    const dir = synthTree();
    try {
      const ast = new AstExtractor().extract(dir, 'testsha');
      const line = new LineScanExtractor().extract(dir, 'testsha');
      expect(line.components.map((c) => c.id).sort()).toEqual(ast.components.map((c) => c.id).sort());
      expect(line.guardEdges.map((e) => e.from).sort()).toEqual(ast.guardEdges.map((e) => e.from).sort());
      expect(line.coverage.extractor).toBe('line-scan');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('evaluate + score', () => {
  it('scores 60 (100 - critical 40) for exactly one D6 violation, verdict fail', () => {
    const dir = synthTree();
    try {
      const graph = new AstExtractor().extract(dir, 'testsha');
      const report = evaluate(blueprint, graph);
      // POST is unguarded → one critical d6 violation.
      const d6 = report.violations.filter((v) => v.constraintId === 'd6-tenant-guard');
      expect(d6.length).toBe(1);
      expect(d6[0].component).toBe('route:objects:POST');
      expect(report.score).toBe(100 - SEVERITY_WEIGHT.critical);
      expect(report.score).toBe(60);
      expect(report.verdict).toBe('fail');
      expect(d6[0].evidenceRef).toContain('objects/route.ts#L');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scores 100 pass when every handler is guarded', () => {
    const graph: ArchitectureGraph = {
      schemaVersion: '1',
      ctRepoRevision: 'abc',
      components: [{ id: 'route:objects:GET', type: 'apiRouteHandler', path: 'p', line: 1 }],
      guardEdges: [{ from: 'route:objects:GET', to: 'requireTenantAccess', type: 'guards', evidenceRef: 'p#L2' }],
      coverage: { extractor: 'ast', filesScanned: 4, unsupported: [] },
    };
    const report = evaluate(blueprint, graph);
    expect(report.score).toBe(100);
    expect(report.verdict).toBe('pass');
    expect(report.violations).toEqual([]);
  });
});

describe('determinism', () => {
  it('serializes byte-identically across two evaluations of the same graph', () => {
    const graph: ArchitectureGraph = {
      schemaVersion: '1',
      ctRepoRevision: 'abc',
      components: [{ id: 'route:objects:GET', type: 'apiRouteHandler', path: 'p', line: 1 }],
      guardEdges: [{ from: 'route:objects:GET', to: 'requireTenantAccess', type: 'guards', evidenceRef: 'p#L2' }],
      coverage: { extractor: 'ast', filesScanned: 4, unsupported: [] },
    };
    const a = stableStringify(evaluate(blueprint, graph));
    const b = stableStringify(evaluate(blueprint, graph));
    expect(a).toBe(b);
    // the report body carries NO wall-clock — same input, same bytes.
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no ISO timestamp leaked into the body
  });
});
