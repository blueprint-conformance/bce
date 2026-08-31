/**
 * Quality matrix for the `forbiddenEgress` constraint + raw provider-host egress AST detection.
 *
 * This closes a coverage gap one production blueprint declared about itself (its coverageNote):
 *
 *   "A raw global fetch() to a provider HTTP endpoint carries no import edge and is NOT caught by
 *    the import-graph — only SDK-import drift is."
 *
 * The engine now detects a `fetch('https://api.openai.com/…')` / `http.request` / `axios` / `got`
 * CALL to a forbidden provider host as an `egress` edge, and the `forbiddenEgress` constraint fails
 * the gate on it. The boundary is ALLOWLIST-SAFE: internal-service fetches (localhost, a private
 * telemetry host) carry NO forbidden host and never false-fire — exactly the property the
 * coverageNote requires (a pipeline's collector scripts legitimately `fetch()` internal service
 * APIs). A computed/non-literal URL is honestly surfaced in coverage.unsupported, never silently
 * passed.
 *
 * Self-contained: builds a temp .mjs tree (the shape of such a pipeline's reader scripts) — no
 * committed fixtures needed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import { evaluate } from '../src/report.js';
import { EngineeringBlueprintSchema, type EngineeringBlueprint } from '../src/schema.js';

/** A minimal agent-pipeline-shaped blueprint that forbids provider-host egress. */
const EGRESS_BLUEPRINT: EngineeringBlueprint = EngineeringBlueprintSchema.parse({
  apiVersion: 'blueprint-conformance/v1alpha1',
  kind: 'EngineeringBlueprint',
  metadata: {
    id: 'gateway-egress-test',
    name: 'Agent pipeline — raw egress test',
    version: '0.1.0',
    status: 'draft',
    ownerRole: 'platform-engineer',
    stewardRole: 'blueprint-steward',
  },
  intentRefs: ['policy/gateway-choke-point'],
  scope: { repositories: ['example-org/monorepo'], paths: ['readers/*.mjs'], environments: ['staging'] },
  architecture: { components: [], relationships: [] },
  constraints: [
    {
      id: 'no-raw-openai-egress',
      type: 'forbiddenEgress',
      severity: 'critical',
      from: '*',
      to: 'api.openai.com',
      policyRef: 'policy/gateway-choke-point',
    },
    {
      id: 'no-raw-openrouter-egress',
      type: 'forbiddenEgress',
      severity: 'critical',
      from: '*',
      to: 'openrouter.ai',
      policyRef: 'policy/zero-cost-signal-collectors',
    },
  ],
  evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
  approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
  extraction: {
    profile: 'plugin-surface',
    paths: ['readers/*.mjs'],
    forbiddenEgressHosts: ['api.openai.com', 'openrouter.ai', 'generativelanguage.googleapis.com'],
    minFiles: 1,
  },
});

const cfg = resolveExtraction(EGRESS_BLUEPRINT.extraction, EGRESS_BLUEPRINT.constraints);

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gateway-egress-'));
  mkdirSync(join(dir, 'readers'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    writeFileSync(join(dir, rel), body, 'utf8');
  }
  return dir;
}

const created: string[] = [];
function make(files: Record<string, string>): string {
  const d = tree(files);
  created.push(d);
  return d;
}
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
describe('raw provider-host egress AST detection', () => {
  it('emits an egress edge for a raw fetch() to a provider host', () => {
    const dir = make({
      'readers/leak.mjs': `export async function read() {\n  const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });\n  return r.json();\n}\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    const egress = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egress.length).toBe(1);
    expect(egress[0]!.to).toBe('api.openai.com');
  });

  it('does NOT report a violation for an internal-service fetch (allowlist-safe)', () => {
    const dir = make({
      // the real reader-script shape: fetch internal service hosts — must never false-fire.
      'readers/internal.mjs': `const BASE = 'https://telemetry.internal.example.com';\nexport async function read() {\n  const r = await fetch(BASE + '/api', {});\n  const cc = await fetch('http://localhost:3000/api/capabilities', {});\n  return [r, cc];\n}\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    // RECONCILED (pure-detector redesign): the extractor is now a PURE detector — `BASE + '/api'` is a `+`
    // string-concat (not a `||`-chain), which the resolver honestly cannot fold (unresolvable, no
    // edge); the bare `fetch('http://localhost:3000/...')` DOES resolve, and now emits a
    // `type:'egress'` edge for 'localhost' at the extractor level — the allowlist-safe property
    // (never false-fire on an internal host) is enforced at evaluate()/report.ts instead: this
    // constraint's policy (BLOCKLIST — `to`) never lists 'localhost', so no violation results.
    const egress = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egress).toHaveLength(1);
    expect(egress[0]?.to).toBe('localhost');
    const r = evaluate(EGRESS_BLUEPRINT, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
  });

  it('detects http.request / axios / got property-access + bare-identifier egress forms', () => {
    const dir = make({
      'readers/many.mjs': `import https from 'node:https';\nexport function a() { return https.request('https://api.openai.com/v1/x'); }\nexport function b() { return axios.post('https://openrouter.ai/api/v1/chat', {}); }\nexport function c() { return got('https://api.openai.com/v1/y'); }\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    const hosts = g.guardEdges.filter((e) => e.type === 'egress').map((e) => e.to).sort();
    expect(hosts).toEqual(['api.openai.com', 'api.openai.com', 'openrouter.ai']);
  });

  it('matches a subdomain of a forbidden host but not an unrelated host', () => {
    const dir = make({
      'readers/sub.mjs': `export const a = () => fetch('https://api.generativelanguage.googleapis.com/v1/models');\nexport const b = () => fetch('https://example.com/openai');\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    // RECONCILED (pure-detector redesign): the extractor is now a PURE detector, so BOTH resolved hosts emit an
    // extractor-level edge — 'api.generativelanguage.googleapis.com' (the real resolved host; NOT
    // the bare 'generativelanguage.googleapis.com' — the extractor never truncates a subdomain) and
    // 'example.com' (the path 'openai' is not part of the host). Subdomain-vs-unrelated MATCHING is
    // now a BLOCKLIST-mode report.ts concern (`isForbidden`'s `host===f || host.endsWith('.'+f)`),
    // proven directly below rather than via EGRESS_BLUEPRINT (whose two constraints only cover
    // api.openai.com/openrouter.ai — this fixture's hosts were never wired to a constraint, so the
    // original assertion only ever ran at the raw-extractor level too).
    const egress = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egress.map((e) => e.to).sort()).toEqual(['api.generativelanguage.googleapis.com', 'example.com']);

    const googleConstraint: EngineeringBlueprint = {
      ...EGRESS_BLUEPRINT,
      constraints: [
        { id: 'no-google-egress', type: 'forbiddenEgress', severity: 'critical', from: '*', to: 'generativelanguage.googleapis.com' },
      ],
    };
    const r = evaluate(googleConstraint, g, 'plugin-surface');
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.observed).toContain('api.generativelanguage.googleapis.com');
    expect(r.violations.some((v) => v.observed.includes('example.com'))).toBe(false);
  });

  it('surfaces a computed/non-literal fetch URL in coverage.unsupported (never silently passed)', () => {
    const dir = make({
      'readers/dyn.mjs': `export async function read(host) {\n  const url = \`https://\${host}/v1/x\`;\n  return fetch(url, {});\n}\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    // no egress edge (host unknown — `host` is a plain function parameter, not a resolvable
    // same-file const) BUT the limitation is honestly declared. RECONCILED (pure-detector
    // redesign): the disclosure wording is now the unified bounded-resolution phrasing ('egress
    // host resolution is bounded to N same-file const hops...' + the per-run unresolved-count
    // line) rather than the original 'raw-egress host-match' string — same honesty property,
    // unified message.
    expect(g.guardEdges.filter((e) => e.type === 'egress').length).toBe(0);
    expect(g.coverage.unsupported.some((u) => /egress host resolution is bounded/.test(u))).toBe(true);
    expect(g.coverage.unsupported.some((u) => /unresolvable host/.test(u))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('forbiddenEgress constraint scoring (green vs red discrimination)', () => {
  it('scores 100/pass on an internal-only surface', () => {
    const dir = make({
      'readers/clean.mjs': `export async function read() {\n  return fetch('http://localhost:3000/api/capabilities', {});\n}\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    const r = evaluate(EGRESS_BLUEPRINT, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.score).toBe(100);
  });

  it('scores RED (fail, <100) on a seeded raw provider-host egress', () => {
    const dir = make({
      'readers/clean.mjs': `export async function read() {\n  return fetch('http://localhost:3000/api/capabilities', {});\n}\n`,
      'readers/drift.mjs': `export async function leak() {\n  return fetch('https://api.openai.com/v1/chat/completions', {});\n}\n`,
    });
    const g = new AstExtractor(cfg).extract(dir, 'sha');
    const r = evaluate(EGRESS_BLUEPRINT, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.score).toBeLessThan(100);
    const v = r.violations.find((x) => x.constraintId === 'no-raw-openai-egress');
    expect(v).toBeTruthy();
    expect(v!.observed).toMatch(/forbidden raw egress/);
  });

  it('is deterministic — same tree in, byte-identical report out', () => {
    const files = {
      'readers/drift.mjs': `export const f = () => fetch('https://openrouter.ai/api/v1/chat', {});\n`,
    };
    const d1 = make(files);
    const d2 = make(files);
    const r1 = evaluate(EGRESS_BLUEPRINT, new AstExtractor(cfg).extract(d1, 'sha'), 'plugin-surface');
    const r2 = evaluate(EGRESS_BLUEPRINT, new AstExtractor(cfg).extract(d2, 'sha'), 'plugin-surface');
    expect(r1.verdict).toBe('fail');
    expect(JSON.stringify(r1.violations)).toBe(JSON.stringify(r2.violations));
  });
});
