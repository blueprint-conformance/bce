/**
 * Spec-pack schema generator — the SINGLE mechanical bridge from the engine's source-of-truth
 * type definitions to the published JSON Schemas under `spec/schemas/`.
 *
 * Two derivation classes, both anchored to REAL code (never a prose re-description):
 *
 *  1. ZOD-DERIVED — the authored artifacts (`EngineeringBlueprint`, `PortfolioBlueprint`) have
 *     Zod schemas in `src/schema.ts` as their single source of truth. These are converted
 *     mechanically via `zod-to-json-schema` (draft-07). NOTE (honest limit): Zod refinements
 *     (`superRefine` — e.g. "a forbiddenPattern constraint MUST carry a compiling, non-ReDoS
 *     `pattern`") are NOT expressible in the mechanical conversion, so the JSON Schema is the
 *     STRUCTURAL floor; the Zod schema remains normative where the two diverge (see
 *     spec/SPEC.md §"Schema publication"). The schema-parity test keeps the two from drifting
 *     structurally: regeneration must be byte-identical, and both validators must agree on the
 *     accept/reject matrix for structural cases.
 *
 *  2. INTERFACE-DERIVED — the ENGINE-EMITTED artifacts (`ComplianceReport`, `EvidenceRecord`,
 *     `ArchitectureGraph`, `RemediationWorkOrder`) are TypeScript interfaces (`src/report.ts`,
 *     `src/emit.ts`, `src/graph.ts`), not Zod. Their JSON Schemas are authored HERE, field-for-
 *     field against those interfaces, and the parity test proves every schema against REAL
 *     engine output (an actual `evaluate()` report, an actual `emitRun()` emission) — so a
 *     drift between the code's output shape and the published schema is a red test, not a
 *     silent lie.
 *
 * Output discipline: files are serialized with the engine's own `stableStringify` (sorted keys,
 * 2-space indent, trailing newline) so regeneration is byte-stable and the parity test can
 * compare bytes, not semantics.
 *
 * $id base: https://blueprint-conformance.github.io/bce/schemas/ (org GitHub Pages). These URLs
 * resolve once the public flip enabled the org Pages site — documented, not hidden; see
 * `.github/workflows/publish-schemas.yml` (dormant by design until then; active since the flip).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  EngineeringBlueprintSchema,
  PortfolioBlueprintSchema,
  SeveritySchema,
  ExtractionProfileSchema,
} from '../src/schema.js';
import { stableStringify, SEVERITY_WEIGHT } from '../src/report.js';
import { APPROVAL_FLOOR } from '../src/emit.js';
import { TeethMutationManifestSchema } from '../src/extractor-teeth.js';

export const SCHEMA_ID_BASE = 'https://blueprint-conformance.github.io/bce/schemas/';
const DRAFT = 'http://json-schema.org/draft-07/schema#';

const SEVERITIES = SeveritySchema.options;
const EXTRACTION_PROFILES = ExtractionProfileSchema.options;
const HEX64 = '^[0-9a-f]{64}$';

/** Wrap a zod-derived or hand-authored body with the published-schema envelope. */
function envelope(
  file: string,
  title: string,
  description: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return {
    $schema: DRAFT,
    $id: `${SCHEMA_ID_BASE}${file}`,
    title,
    description,
    ...body,
  };
}

/* -------------------------------------------------------------------------- */
/* 1. Zod-derived (authored artifacts)                                        */
/* -------------------------------------------------------------------------- */

function engineeringBlueprintSchema(): Record<string, unknown> {
  const body = zodToJsonSchema(EngineeringBlueprintSchema, {
    name: 'EngineeringBlueprint',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete body.$schema;
  return envelope(
    'engineering-blueprint.schema.json',
    'EngineeringBlueprint',
    'The authored per-repository blueprint artifact (apiVersion blueprint-conformance/v1alpha1). ' +
      'Mechanically derived from the normative Zod schema in src/schema.ts. STRUCTURAL floor only: ' +
      'Zod refinements (e.g. forbiddenPattern constraints MUST declare a compiling, non-catastrophic ' +
      'regex `pattern`) are enforced by the engine but not expressible here — where the two diverge, ' +
      'the engine schema is normative (spec/SPEC.md).',
    body,
  );
}

function portfolioBlueprintSchema(): Record<string, unknown> {
  const body = zodToJsonSchema(PortfolioBlueprintSchema, {
    name: 'PortfolioBlueprint',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete body.$schema;
  return envelope(
    'portfolio-blueprint.schema.json',
    'PortfolioBlueprint',
    'The authored fleet-level blueprint artifact (apiVersion blueprint-conformance/v1alpha1), ' +
      'lowered by `bce portfolio compile` into per-member EngineeringBlueprint overlays. ' +
      'Mechanically derived from the normative Zod schema in src/schema.ts.',
    body,
  );
}

function teethMutationManifestSchema(): Record<string, unknown> {
  const body = zodToJsonSchema(TeethMutationManifestSchema, {
    name: 'TeethMutationManifest',
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  delete body.$schema;
  return envelope(
    'teeth-mutation-manifest.schema.json',
    'TeethMutationManifest',
    'A closed, digest-preconditioned set of real repository source mutations. The extractor-real teeth runner materializes every case in a fresh copy and requires the mapped constraint to redden at the mutated file.',
    body,
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Interface-derived (engine-emitted artifacts)                            */
/* -------------------------------------------------------------------------- */

/** `Violation` — field-for-field against src/report.ts. */
const violationSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['constraintId', 'severity', 'component', 'evidenceType', 'evidenceRef', 'observed', 'expected'],
  properties: {
    constraintId: { type: 'string' },
    severity: { type: 'string', enum: [...SEVERITIES] },
    component: { type: 'string' },
    evidenceType: { type: 'string' },
    evidenceRef: { type: 'string' },
    observed: { type: 'string' },
    expected: { type: 'string' },
  },
};

function complianceReportSchema(): Record<string, unknown> {
  return envelope(
    'compliance-report.schema.json',
    'ComplianceReport',
    'The deterministic conformance report `bce run` / `bce gate` emit (src/report.ts). ' +
      `score = max(0, 100 − Σ severity weight per violation) with weights ${JSON.stringify(SEVERITY_WEIGHT)}; ` +
      'verdict is pass iff the violation set is EMPTY (zero-violations-pass — an info-only violation set ' +
      'scores 100 yet fails). Canonical serialization: sorted keys, 2-space indent, trailing newline. ' +
      'This schema describes the CURRENT engine version’s canonical output; per the widen-only policy, ' +
      'consumers reading reports from other engine versions SHOULD read tolerantly (unknown fields ignored).',
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'blueprintRef',
        'ctRepoRevision',
        'score',
        'verdict',
        'violations',
        'evidenceRef',
        'summary',
        'coverage',
      ],
      properties: {
        schemaVersion: { const: '1' },
        blueprintRef: {
          type: 'string',
          description: 'blueprint identity `<id>@<version>` (or the file basename for a parse-failed blueprint)',
        },
        ctRepoRevision: {
          type: 'string',
          description: 'the target-repo revision the observed graph was extracted at (40-hex sha, or `unpinned`)',
        },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        violations: { type: 'array', items: violationSchema },
        evidenceRef: {
          type: 'string',
          description: 'content-addressed pointer to the observed graph (`architecture-graph.json@sha256:<hex>`), or `n/a` on a fail-closed report that never scanned',
        },
        summary: { type: 'string' },
        coverage: {
          type: 'object',
          additionalProperties: false,
          required: ['extractor', 'filesScanned', 'unsupported'],
          properties: {
            extractor: { type: 'string', enum: ['ast', 'line-scan'] },
            filesScanned: { type: 'integer', minimum: 0 },
            unsupported: { type: 'array', items: { type: 'string' } },
          },
        },
        repo: {
          type: 'string',
          description: 'OPTIONAL repo identity stamp (omit-not-empty: absent unless the producer passed one)',
        },
      },
    },
  );
}

function evidenceRecordSchema(): Record<string, unknown> {
  return envelope(
    'evidence-record.schema.json',
    'EvidenceRecord',
    'One immutable link of the append-only, tamper-evident evidence hash-chain (src/emit.ts). ' +
      '`hash` is the SHA-256 of the record’s canonical body (previousHash included); `previousHash` ' +
      'links to the prior record’s `hash`, or the 64-zero genesis sentinel for the first record. ' +
      'Content-derived, deterministic: no wall-clock anywhere in the body.',
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'id',
        'traceId',
        'blueprintRef',
        'ctRepoRevision',
        'score',
        'verdict',
        'violationCount',
        'reportEvidenceRef',
        'previousHash',
        'hash',
      ],
      properties: {
        schemaVersion: { const: '1' },
        id: {
          type: 'string',
          description: 'content-derived stable id: `evidence:<blueprintRef>:<hash[0..16]>`',
        },
        traceId: { type: 'string', description: 'the chain key (blueprint id — one chain per subsystem)' },
        blueprintRef: { type: 'string' },
        ctRepoRevision: { type: 'string' },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        verdict: { type: 'string', enum: ['pass', 'fail'] },
        violationCount: { type: 'integer', minimum: 0 },
        reportEvidenceRef: { type: 'string' },
        toolchain: {
          type: 'object',
          additionalProperties: false,
          description: 'Producer/parser identity. Optional only for compatibility with historical pre-0.1.6 records; current CLI emissions always include it.',
          required: ['engine', 'dependencyLock', 'runtime', 'extractor'],
          properties: {
            engine: {
              type: 'object', additionalProperties: false, required: ['name', 'version'],
              properties: { name: { const: 'bce-engine' }, version: { type: 'string' } },
            },
            dependencyLock: {
              type: 'object', additionalProperties: false, required: ['file', 'sha256'],
              properties: { file: { const: 'npm-shrinkwrap.json' }, sha256: { type: 'string', pattern: HEX64 } },
            },
            runtime: {
              type: 'object', additionalProperties: false, required: ['node', 'npm', 'platform', 'arch'],
              properties: {
                node: { type: 'string' }, npm: { type: 'string' }, platform: { type: 'string' }, arch: { type: 'string' },
              },
            },
            extractor: {
              type: 'object', additionalProperties: false, required: ['kind', 'profile', 'provider', 'version'],
              properties: {
                kind: { type: 'string', enum: ['ast', 'line-scan'] },
                profile: { type: 'string', enum: [...EXTRACTION_PROFILES] },
                provider: { type: 'string', enum: ['typescript-ts-morph', 'typescript-line-scan', 'python-line-scan'] },
                version: { type: 'string' },
              },
            },
          },
        },
        previousHash: { type: 'string', pattern: HEX64 },
        hash: { type: 'string', pattern: HEX64 },
      },
    },
  );
}

function architectureGraphSchema(): Record<string, unknown> {
  return envelope(
    'architecture-graph.schema.json',
    'ArchitectureGraph',
    'The observed architecture graph `bce scan` persists (src/graph.ts): components + real ' +
      'call/dependency edges extracted from source, plus the mandatory coverage honesty envelope ' +
      '(every extractor MUST declare what it cannot see). Deterministic-by-construction: provenance ' +
      'is a content revision, never wall-clock; all arrays sorted before serialization.',
    {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'ctRepoRevision', 'components', 'guardEdges', 'coverage'],
      properties: {
        schemaVersion: { const: '1' },
        ctRepoRevision: { type: 'string' },
        components: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'type', 'path', 'line'],
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              path: { type: 'string' },
              line: { type: 'integer', minimum: 0 },
            },
          },
        },
        guardEdges: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['from', 'to', 'type', 'evidenceRef'],
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              type: { type: 'string' },
              evidenceRef: { type: 'string' },
            },
          },
        },
        coverage: {
          type: 'object',
          additionalProperties: false,
          required: ['extractor', 'filesScanned', 'unsupported'],
          properties: {
            extractor: { type: 'string', enum: ['ast', 'line-scan'] },
            filesScanned: { type: 'integer', minimum: 0 },
            unsupported: { type: 'array', items: { type: 'string' } },
            scannedFiles: {
              type: 'array',
              items: { type: 'string' },
              description: 'OPTIONAL (widen-only addition): the raw sorted scanned-file set a forbiddenFile constraint iterates; absent on older graphs',
            },
            patternScan: {
              type: 'object',
              additionalProperties: false,
              required: ['patterns', 'hits'],
              properties: {
                patterns: { type: 'array', items: { type: 'string' } },
                hits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['pattern', 'file', 'line'],
                    properties: {
                      pattern: { type: 'string' },
                      file: { type: 'string' },
                      line: { type: 'integer', minimum: 1 },
                    },
                  },
                },
              },
              description: 'OPTIONAL (widen-only addition): the deterministic content-pattern scan a forbiddenPattern constraint evaluates; absent when no forbiddenPattern constraint is declared',
            },
          },
        },
      },
    },
  );
}

function remediationWorkOrderSchema(): Record<string, unknown> {
  return envelope(
    'remediation-work-order.schema.json',
    'RemediationWorkOrder',
    'One structured remediation proposal auto-generated per violation (src/emit.ts). Every ' +
      'auto-generated order starts PROPOSED and advances only through the governed approval ' +
      'transition matrix (propose-not-apply: nothing auto-advances).',
    {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion',
        'id',
        'traceId',
        'blueprintRef',
        'constraintId',
        'severity',
        'component',
        'evidenceRef',
        'title',
        'body',
        'approvalState',
      ],
      properties: {
        schemaVersion: { const: '1' },
        id: { type: 'string', description: 'deterministic id: `wo:<blueprintRef>:<sha256(key)[0..16]>`' },
        traceId: { type: 'string' },
        blueprintRef: { type: 'string' },
        constraintId: { type: 'string' },
        severity: { type: 'string', enum: [...SEVERITIES] },
        component: { type: 'string' },
        evidenceRef: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        approvalState: { type: 'string', enum: [...APPROVAL_FLOOR] },
      },
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Assembly + main                                                            */
/* -------------------------------------------------------------------------- */

/** filename → schema object, for every published schema. */
export function generateSchemas(): Record<string, Record<string, unknown>> {
  return {
    'engineering-blueprint.schema.json': engineeringBlueprintSchema(),
    'portfolio-blueprint.schema.json': portfolioBlueprintSchema(),
    'compliance-report.schema.json': complianceReportSchema(),
    'evidence-record.schema.json': evidenceRecordSchema(),
    'architecture-graph.schema.json': architectureGraphSchema(),
    'remediation-work-order.schema.json': remediationWorkOrderSchema(),
    'teeth-mutation-manifest.schema.json': teethMutationManifestSchema(),
  };
}

/** Serialize one schema to its canonical published bytes (sorted keys, 2-space, trailing \n). */
export function serializeSchema(schema: Record<string, unknown>): string {
  return stableStringify(schema);
}

function main(): void {
  // cwd-anchored (run from the repo root: `npm run generate:schemas`) so the emitted files land
  // in `spec/schemas/` regardless of whether this module executes from source or a build dir.
  const outDir = path.join(process.cwd(), 'spec', 'schemas');
  fs.mkdirSync(outDir, { recursive: true });
  const schemas = generateSchemas();
  for (const [file, schema] of Object.entries(schemas)) {
    fs.writeFileSync(path.join(outDir, file), serializeSchema(schema));
    process.stdout.write(`wrote spec/schemas/${file}\n`);
  }
}

// Run only when executed directly (`npm run generate:schemas`), not when imported by the parity test.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
