/**
 * Native Zod 4 contract — the engine's schemas run on Zod 4's own core, never the bundled
 * `zod/v3` compatibility copy (which a Zod 4 patch release does not necessarily touch), and the
 * migration kept every rejection the v3 schemas made.
 *
 * Each case discriminates: it names an input the schema MUST refuse (and a control it must
 * accept), so a schema that silently loosened during the move would turn this file red.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, ComponentSchema, EngineeringBlueprintSchema } from '../src/schema.js';
import { AuthenticatedReviewerSchema, BlueprintDecisionRecordSchema } from '../src/review-contracts.js';

const ROOT = path.join(__dirname, '..');
const fixture = (): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'egress-reader.blueprint.json'), 'utf8'));

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(abs) : e.name.endsWith('.ts') ? [abs] : [];
  });

describe('native Zod 4 — no compatibility subpath', () => {
  it('no engine source file imports a zod subpath (zod/v3, zod/v4, zod/mini, …)', () => {
    const offenders = sourceFiles(path.join(ROOT, 'src')).filter((f) =>
      /from\s+['"]zod\/[^'"]+['"]|import\(\s*['"]zod\/[^'"]+['"]\s*\)|require\(\s*['"]zod\/[^'"]+['"]\s*\)/.test(fs.readFileSync(f, 'utf8')),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });

  it('the schemas are Zod 4 core instances (a v3 schema carries no `_zod` internals)', () => {
    expect('_zod' in EngineeringBlueprintSchema).toBe(true);
    expect('_zod' in AuthenticatedReviewerSchema).toBe(true);
  });
});

describe('native Zod 4 — rejections preserved', () => {
  it('a strict object still rejects an unknown key (control: the fixture parses)', () => {
    expect(() => parseBlueprint(fixture())).not.toThrow();
    expect(() => parseBlueprint({ ...fixture(), unexpected: true })).toThrow(/unexpected/);
  });

  it('a passthrough object still keeps unknown keys instead of stripping them', () => {
    const parsed = ComponentSchema.parse({ id: 'a', type: 'service', vendorNote: 'kept' }) as Record<string, unknown>;
    expect(parsed.vendorNote).toBe('kept');
  });

  it('cross-field refinements still fire: a forbiddenPattern without a pattern is refused', () => {
    const bp = fixture();
    bp.constraints = [{ id: 'no-mock', type: 'forbiddenPattern', severity: 'high', paths: ['src/**/*.ts'] }];
    expect(() => parseBlueprint(bp)).toThrow(/MUST declare a non-empty 'pattern'/);
  });

  it('the record field keeps a string key schema and rejects a non-object value', () => {
    const shape = EngineeringBlueprintSchema.shape.evolution;
    expect(shape.safeParse({ note: 1 }).success).toBe(true);
    expect(shape.safeParse(['note']).success).toBe(false);
    expect(shape.safeParse('note').success).toBe(false);
  });

  it('a reviewer authentication reference must be an HTTPS URL', () => {
    const reviewer = (reference: string) => ({
      id: 'steward',
      authentication: { method: 'scm', issuer: 'github', subject: 'steward', assertionDigest: 'a'.repeat(64), reference },
    });
    expect(AuthenticatedReviewerSchema.safeParse(reviewer('https://example.com/review/1')).success).toBe(true);
    expect(AuthenticatedReviewerSchema.safeParse(reviewer('http://example.com/review/1')).success).toBe(false);
    expect(AuthenticatedReviewerSchema.safeParse(reviewer('https://exa mple.com/')).success).toBe(false);
    expect(AuthenticatedReviewerSchema.safeParse(reviewer('https://')).success).toBe(false);
  });

  it('a decision timestamp must be an ISO datetime with seconds and a Z or ±HH:MM offset', () => {
    const decidedAt = BlueprintDecisionRecordSchema.shape.decidedAt;
    expect(decidedAt.safeParse('2026-10-24T10:00:00Z').success).toBe(true);
    expect(decidedAt.safeParse('2026-10-24T10:00:00.123+01:00').success).toBe(true);
    for (const bad of ['2026-10-24', '2026-10-24 10:00:00Z', '2026-10-24T10:00:00', '2026-10-24T10:00:00+01', '2026-10-24T10:00Z', '2026-10-24T10:00:00+0100']) {
      expect(decidedAt.safeParse(bad).success, bad).toBe(false);
    }
  });
});
