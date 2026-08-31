/**
 * Schema-parity gate — the published JSON Schemas under `spec/schemas/` MUST stay in lockstep
 * with the engine's source-of-truth definitions (`src/schema.ts` Zod for the authored kinds;
 * the `src/report.ts` / `src/emit.ts` / `src/graph.ts` interfaces for the emitted kinds).
 *
 * Three parity planes, all red on drift:
 *
 *  1. BYTE PARITY — regenerating every schema in-memory (the same `generateSchemas()` the
 *     committed files came from) must be byte-identical to the committed files. Editing
 *     `src/schema.ts` without re-running `npm run generate:schemas` (or hand-editing a
 *     published schema) is a red test, not a silent divergence.
 *
 *  2. VALIDATOR AGREEMENT (authored kinds) — Zod and the generated JSON Schema must agree on
 *     the accept/reject verdict for every committed authored artifact AND for a matrix of
 *     structural mutations. The ONE known, deliberate divergence (Zod refinements are not
 *     mechanically expressible — a `forbiddenPattern` constraint with a missing/unsafe
 *     `pattern` is Zod-rejected but structurally schema-valid) is pinned as an explicit
 *     assertion so it can never silently widen.
 *
 *  3. OUTPUT CONFORMANCE (emitted kinds) — REAL engine output (an actual `evaluate()` report,
 *     an actual `emitRun()` evidence record + work orders, a graph in the persisted shape)
 *     must validate against the published schemas. The schema describes what the code DOES,
 *     never a prose wish.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { generateSchemas, serializeSchema, SCHEMA_ID_BASE } from '../scripts/generate-schemas.js';
import { EngineeringBlueprintSchema, PortfolioBlueprintSchema, parseBlueprint } from '../src/schema.js';
import { evaluate } from '../src/report.js';
import { emitRun, verifyEvidenceChain } from '../src/emit.js';
import type { ArchitectureGraph } from '../src/graph.js';

const ROOT = path.join(__dirname, '..');
const SCHEMA_DIR = path.join(ROOT, 'spec', 'schemas');

const generated = generateSchemas();
const filenames = Object.keys(generated).sort();

const ajv = new Ajv({ strict: false, allowUnionTypes: true });
const compiled: Record<string, ValidateFunction> = {};
for (const f of filenames) compiled[f] = ajv.compile(generated[f]!);

const ebValidate = compiled['engineering-blueprint.schema.json']!;
const pbValidate = compiled['portfolio-blueprint.schema.json']!;

/** Every committed authored EngineeringBlueprint artifact (fixtures + the self-gate lane). */
const engineeringArtifacts = (): string[] => {
  const out: string[] = [];
  for (const dir of ['fixtures', '.blueprints']) {
    const abs = path.join(ROOT, dir);
    for (const f of fs.readdirSync(abs).filter((n) => n.endsWith('.blueprint.json')).sort()) {
      out.push(path.join(abs, f));
    }
  }
  return out;
};

const readJson = (p: string): unknown => JSON.parse(fs.readFileSync(p, 'utf8'));

describe('byte parity — committed spec/schemas/ vs in-memory regeneration', () => {
  it('the committed schema set is exactly the generated set (no missing, no stray files)', () => {
    const committed = fs.readdirSync(SCHEMA_DIR).filter((n) => n.endsWith('.json')).sort();
    expect(committed).toEqual(filenames);
  });

  for (const f of filenames) {
    it(`${f} is byte-identical to regeneration (drift = re-run npm run generate:schemas)`, () => {
      const committedBytes = fs.readFileSync(path.join(SCHEMA_DIR, f), 'utf8');
      expect(committedBytes).toBe(serializeSchema(generated[f]!));
    });
  }

  it('every schema carries the published $id base + draft-07 $schema', () => {
    for (const f of filenames) {
      expect(generated[f]!.$id).toBe(`${SCHEMA_ID_BASE}${f}`);
      expect(generated[f]!.$schema).toBe('http://json-schema.org/draft-07/schema#');
    }
  });
});

describe('validator agreement — Zod and the generated schema on authored artifacts', () => {
  it('every committed EngineeringBlueprint artifact is accepted by BOTH validators', () => {
    const artifacts = engineeringArtifacts();
    expect(artifacts.length).toBeGreaterThan(0);
    for (const p of artifacts) {
      const raw = readJson(p);
      expect(EngineeringBlueprintSchema.safeParse(raw).success, `zod rejects ${p}`).toBe(true);
      expect(ebValidate(raw), `json-schema rejects ${p}: ${ajv.errorsText(ebValidate.errors)}`).toBe(true);
    }
  });

  it('the committed PortfolioBlueprint fixture is accepted by BOTH validators', () => {
    const raw = readJson(path.join(ROOT, 'fixtures', 'portfolio', 'demo-fleet.portfolio-blueprint.json'));
    expect(PortfolioBlueprintSchema.safeParse(raw).success).toBe(true);
    expect(pbValidate(raw), ajv.errorsText(pbValidate.errors)).toBe(true);
  });

  const base = (): Record<string, unknown> =>
    readJson(path.join(ROOT, 'fixtures', 'route-guard.blueprint.json')) as Record<string, unknown>;

  const bothReject = (mutant: unknown, label: string): void => {
    expect(EngineeringBlueprintSchema.safeParse(mutant).success, `zod ACCEPTS ${label}`).toBe(false);
    expect(ebValidate(mutant), `json-schema ACCEPTS ${label}`).toBe(false);
  };

  it('both validators reject an unknown top-level key (strict / additionalProperties:false)', () => {
    bothReject({ ...base(), zzUnknownKey: true }, 'unknown top-level key');
  });

  it('both validators reject a wrong apiVersion', () => {
    bothReject({ ...base(), apiVersion: 'blueprint-conformance/v999' }, 'wrong apiVersion');
  });

  it('both validators reject an empty constraints array (a blueprint enforcing nothing)', () => {
    bothReject({ ...base(), constraints: [] }, 'constraints: []');
  });

  it('both validators reject an empty intentRefs array (every blueprint traces to an intent)', () => {
    bothReject({ ...base(), intentRefs: [] }, 'intentRefs: []');
  });

  it('both validators reject a non-semver metadata.version', () => {
    const b = base();
    const metadata = { ...(b.metadata as Record<string, unknown>), version: 'not-semver' };
    bothReject({ ...b, metadata }, 'metadata.version not x.y.z');
  });

  it('PINNED DIVERGENCE: a forbiddenPattern constraint with no pattern is Zod-REJECTED but ' +
     'structurally schema-valid (refinements are not mechanically expressible — the engine schema ' +
     'is normative where they diverge, per spec/SPEC.md)', () => {
    const b = base();
    const mutant = {
      ...b,
      constraints: [{ id: 'p1', type: 'forbiddenPattern', severity: 'high' }],
    };
    expect(EngineeringBlueprintSchema.safeParse(mutant).success).toBe(false); // superRefine: pattern REQUIRED
    expect(ebValidate(mutant)).toBe(true); // structural floor only — documented, deliberate
  });
});

describe('output conformance — real engine output validates against the published schemas', () => {
  const bp = parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'spec-demo', version: '0.1.0', status: 'draft' },
    intentRefs: ['intent/spec-demo'],
    scope: { repositories: ['example-org/demo'] },
    architecture: { components: [], relationships: [] },
    constraints: [
      { id: 'no-forbidden-module', type: 'forbiddenDependency', severity: 'high', from: '*', to: 'forbidden-module' },
    ],
    evidenceRequirements: [],
    approvals: [],
  });

  const graph: ArchitectureGraph = {
    schemaVersion: '1',
    ctRepoRevision: 'a'.repeat(40),
    components: [{ id: 'plugin:demo', type: 'pluginSurface', path: 'src/demo.ts', line: 1 }],
    guardEdges: [
      { from: 'plugin:demo', to: 'forbidden-module', type: 'imports', evidenceRef: 'src/demo.ts#L3' },
    ],
    coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
  };

  it('the persisted-graph shape validates against architecture-graph.schema.json', () => {
    const v = compiled['architecture-graph.schema.json']!;
    expect(v(graph), ajv.errorsText(v.errors)).toBe(true);
  });

  it('a REAL failing evaluate() report validates against compliance-report.schema.json', () => {
    const report = evaluate(bp, graph, 'plugin-surface');
    expect(report.verdict).toBe('fail');
    expect(report.score).toBe(80); // 100 − 20 (one high violation)
    const v = compiled['compliance-report.schema.json']!;
    expect(v(report), ajv.errorsText(v.errors)).toBe(true);
  });

  it('a REAL passing report (with the additive repo stamp) validates too', () => {
    const clean: ArchitectureGraph = { ...graph, guardEdges: [] };
    const report = evaluate(bp, clean, 'plugin-surface', 'example-org/demo');
    expect(report.verdict).toBe('pass');
    expect(report.repo).toBe('example-org/demo');
    const v = compiled['compliance-report.schema.json']!;
    expect(v(report), ajv.errorsText(v.errors)).toBe(true);
  });

  it('a REAL emitRun() evidence record + work orders validate, and the chain verifies', () => {
    const report = evaluate(bp, graph, 'plugin-surface');
    const emission = emitRun(report);
    const ev = compiled['evidence-record.schema.json']!;
    expect(ev(emission.evidence), ajv.errorsText(ev.errors)).toBe(true);
    expect(verifyEvidenceChain([emission.evidence])).toBe(-1);
    const wo = compiled['remediation-work-order.schema.json']!;
    expect(emission.workOrders.length).toBe(1);
    for (const order of emission.workOrders) {
      expect(wo(order), ajv.errorsText(wo.errors)).toBe(true);
      expect(order.approvalState).toBe('PROPOSED');
    }
  });
});
