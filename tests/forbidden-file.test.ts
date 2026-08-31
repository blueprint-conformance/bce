/**
 * Quality matrix for the `forbiddenFile` constraint (0.8.0).
 *
 * WHY THIS CONSTRAINT EXISTS — the toothlessness `forbiddenPath` has on a named-export surface:
 * `forbiddenPath` matches its `path` glob only against EXTRACTED COMPONENTS (`graph.components[].path`).
 * The plugin-surface AST extractor mints a component ONLY for a recognized factory / default export —
 * so a plain `export class BetaProvisioner {}` file (service-beta's provisioning src shape) mints
 * ZERO components, and a `forbiddenPath` constraint against it iterates an EMPTY set → STRUCTURALLY
 * TOOTHLESS (score 100 even with the forbidden file present). `forbiddenFile` matches the SAME glob
 * against the RAW scanned-file set (`graph.coverage.scannedFiles`), so the forbidden file is caught
 * regardless of export shape.
 *
 * The steward's RED-FIRST merge gate (anti-toothlessness): this suite proves
 *   (RED)     a named-export beta-provisioner.ts (0 components) → forbiddenFile produces >=1 violation, verdict fail;
 *   (WITNESS) the SAME seed scores GREEN (score 100, 0 violations) under an equivalent forbiddenPath — the gap this closes;
 *   (GREEN)   a clean tree scores 100/pass (a green that can go red is a real tooth);
 *   (HONEST)  a graph with NO scannedFiles records the constraint as SKIPPED, never a silent pass (fail-closed).
 *
 * Self-contained: builds a temp named-export tree — no committed fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import { evaluate } from '../src/report.js';
import { EngineeringBlueprintSchema, type EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';

/** A platform-beta-cell-shaped blueprint whose no-duplicate-file tooth is a forbiddenFile. */
function blueprint(constraintType: 'forbiddenFile' | 'forbiddenPath'): EngineeringBlueprint {
  return EngineeringBlueprintSchema.parse({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: {
      id: `beta-noparallel-${constraintType}`,
      name: 'platform-beta — no parallel provisioner file',
      version: '0.1.0',
      status: 'draft',
      ownerRole: 'platform-engineer',
      stewardRole: 'blueprint-steward',
    },
    intentRefs: ['policy/blueprint-engineering-doctrine'],
    scope: { repositories: ['service-beta'], paths: ['src/**'], environments: ['beta'] },
    architecture: { components: [], relationships: [] },
    constraints: [
      {
        id: 'no-parallel-beta-provisioner',
        type: constraintType,
        severity: 'critical',
        path: 'src/**/beta-*provisioner*.ts',
        policyRef: 'policy/foundation-abstraction-not-duplicate',
      },
    ],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
  });
}

const created: string[] = [];
function make(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ff-'));
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

// The EXACT anti-pattern: a parallel beta provisioner written as a NAMED-EXPORT class (0 components).
const SEEDED_DUP = {
  'src/ecosystem/beta-provisioner.ts': `export class BetaProvisioner {\n  async provisionBetaTenant(slug: string) { return slug; }\n}\n`,
  'src/ecosystem/tenant-lifecycle.ts': `export const provisionTenant = () => {};\n`,
};
const CLEAN = {
  'src/lib/provisioning/database-provisioner.ts': `export class DatabaseProvisionerService {}\n`,
  'src/ecosystem/hub-stack-deployer.ts': `export class HubStackDeployer {}\n`,
  'src/ecosystem/tenant-lifecycle.ts': `export const provisionTenant = () => {};\n`,
};

const ffCfg = resolveExtraction(blueprint('forbiddenFile').extraction, blueprint('forbiddenFile').constraints);
const fpCfg = resolveExtraction(blueprint('forbiddenPath').extraction, blueprint('forbiddenPath').constraints);

describe('forbiddenFile constraint (0.8.0) — the raw-file tooth', () => {
  it('extractor mints 0 components on the named-export seed but DOES record it in coverage.scannedFiles', () => {
    const g = new AstExtractor(ffCfg).extract(make(SEEDED_DUP), 'sha');
    // The premise: named-export files → 0 components (why forbiddenPath is toothless here).
    expect(g.components).toHaveLength(0);
    // But the raw file IS in the scanned set — that is what forbiddenFile iterates.
    expect(g.coverage.scannedFiles).toBeDefined();
    expect(g.coverage.scannedFiles).toContain('src/ecosystem/beta-provisioner.ts');
  });

  it('RED: a named-export beta-provisioner.ts produces a forbiddenFile violation + verdict fail', () => {
    const g = new AstExtractor(ffCfg).extract(make(SEEDED_DUP), 'sha');
    const r = evaluate(blueprint('forbiddenFile'), g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.violations.length).toBeGreaterThanOrEqual(1);
    const v = r.violations.find((x) => x.constraintId === 'no-parallel-beta-provisioner');
    expect(v).toBeDefined();
    expect(v!.evidenceRef).toBe('src/ecosystem/beta-provisioner.ts');
  });

  it('WITNESS: the SAME seed scores GREEN under an equivalent forbiddenPath (the gap forbiddenFile closes)', () => {
    const g = new AstExtractor(fpCfg).extract(make(SEEDED_DUP), 'sha');
    const r = evaluate(blueprint('forbiddenPath'), g, 'plugin-surface');
    // forbiddenPath iterates graph.components (empty here) → cannot see the file → GREEN (toothless).
    expect(r.score).toBe(100);
    expect(r.violations).toHaveLength(0);
  });

  it('GREEN: a clean tree (legit database-provisioner.ts) scores 100/pass under forbiddenFile', () => {
    const g = new AstExtractor(ffCfg).extract(make(CLEAN), 'sha');
    const r = evaluate(blueprint('forbiddenFile'), g, 'plugin-surface');
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    // the legit database-provisioner.ts must NOT match beta-*provisioner* (no over-fire)
    expect(r.violations).toHaveLength(0);
  });

  it('HONEST: a graph with NO scannedFiles records forbiddenFile as SKIPPED (never a silent pass)', () => {
    // A pre-0.8.0-shaped graph: coverage without scannedFiles. The ONLY constraint is the forbiddenFile,
    // so skipped → implemented===0 → the engine emits the "enforces nothing" hard violation (fail).
    const preGraph: ArchitectureGraph = {
      schemaVersion: '1',
      ctRepoRevision: 'sha',
      components: [],
      guardEdges: [],
      coverage: { extractor: 'ast', filesScanned: 3, unsupported: [] }, // NO scannedFiles
    };
    const r = evaluate(blueprint('forbiddenFile'), preGraph, 'plugin-surface');
    // fail-closed: a blueprint that enforced nothing (the sole constraint was skipped) must NOT be green.
    expect(r.verdict).toBe('fail');
    // the "enforces nothing" hard violation fired (skipped constraint → implemented===0), NOT a silent pass.
    const noEnforce = r.violations.find((v) => v.constraintId === '__no-enforcing-constraints__');
    expect(noEnforce).toBeDefined();
    expect(noEnforce!.observed.toLowerCase()).toContain('enforces nothing');
    // and the summary honestly flags the skip.
    expect(r.summary.toLowerCase()).toContain('skipped');
  });
});
