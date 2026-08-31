/**
 * PortfolioBlueprint schema accept/reject matrix + the discriminated
 * `parseAnyBlueprint` fail-closed contract. Widen-only: the EngineeringBlueprint cases here
 * only prove the OLD kind still parses through the NEW discriminator unchanged.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PortfolioBlueprintSchema,
  parsePortfolioBlueprint,
  parseAnyBlueprint,
  type PortfolioBlueprint,
} from '../src/schema.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const PORTFOLIO_PATH = path.join(FIXROOT, 'portfolio', 'demo-fleet.portfolio-blueprint.json');
const EB_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

const readPortfolio = (): unknown => JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8'));
const portfolio: PortfolioBlueprint = parsePortfolioBlueprint(readPortfolio());

describe('PortfolioBlueprintSchema', () => {
  it('accepts the authored demo-fleet portfolio fixture', () => {
    expect(() => parsePortfolioBlueprint(readPortfolio())).not.toThrow();
  });

  it('REJECTS a portfolio missing coverage entirely (declared-honest-envelope invariant)', () => {
    const bad = { ...(readPortfolio() as Record<string, unknown>) };
    delete bad.coverage;
    expect(PortfolioBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS an EMPTY coverage.unsupported (min 1 — a blanket-coverage claim is refused at authoring time)', () => {
    const bad = { ...portfolio, coverage: { unsupported: [] } };
    expect(PortfolioBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS zero members (min 1)', () => {
    const bad = { ...portfolio, members: [] };
    expect(PortfolioBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS zero fleetConstraints (min 1 — a portfolio that enforces nothing)', () => {
    const bad = { ...portfolio, fleetConstraints: [] };
    expect(PortfolioBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS an unknown top-level key (.strict, same discipline as EngineeringBlueprint)', () => {
    const bad = { ...portfolio, bogusField: true };
    expect(PortfolioBlueprintSchema.safeParse(bad).success).toBe(false);
  });

  it('REJECTS a non-semver governance.version and a non-positive minMembers', () => {
    expect(
      PortfolioBlueprintSchema.safeParse({ ...portfolio, governance: { ...portfolio.governance, version: 'v1' } }).success,
    ).toBe(false);
    expect(
      PortfolioBlueprintSchema.safeParse({ ...portfolio, governance: { ...portfolio.governance, minMembers: 0 } }).success,
    ).toBe(false);
    expect(
      PortfolioBlueprintSchema.safeParse({ ...portfolio, governance: { ...portfolio.governance, skewGraceDays: -1 } }).success,
    ).toBe(false);
  });

  it('REJECTS an invalid member pinEncoding / extractor', () => {
    const withMember = (patch: Record<string, unknown>) => ({
      ...portfolio,
      members: [{ ...portfolio.members[0], ...patch }],
    });
    expect(PortfolioBlueprintSchema.safeParse(withMember({ pinEncoding: 'env-var' })).success).toBe(false);
    expect(PortfolioBlueprintSchema.safeParse(withMember({ extractor: 'regex' })).success).toBe(false);
  });

  it("defaults an absent member repoDir to '.'", () => {
    const raw = readPortfolio() as { members: Array<Record<string, unknown>> };
    delete raw.members[1].repoDir;
    const parsed = parsePortfolioBlueprint(raw);
    expect(parsed.members[1].repoDir).toBe('.');
  });
});

describe('parseAnyBlueprint (discriminated, fail-closed)', () => {
  it('discriminates an EngineeringBlueprint (the 0.2.x kind, byte-unchanged)', () => {
    const r = parseAnyBlueprint(JSON.parse(fs.readFileSync(EB_PATH, 'utf8')));
    expect(r.kind).toBe('EngineeringBlueprint');
    if (r.kind === 'EngineeringBlueprint') expect(r.value.metadata.id).toBe('luna-chat-extension');
  });

  it('discriminates a PortfolioBlueprint', () => {
    const r = parseAnyBlueprint(readPortfolio());
    expect(r.kind).toBe('PortfolioBlueprint');
    if (r.kind === 'PortfolioBlueprint') expect(r.value.members).toHaveLength(2);
  });

  it('THROWS on an unknown kind (fail closed — never a silent no-op)', () => {
    expect(() => parseAnyBlueprint({ ...portfolio, kind: 'MysteryBlueprint' })).toThrow(/unknown blueprint kind/);
  });

  it('THROWS on a kind-less / non-object input (fail closed)', () => {
    expect(() => parseAnyBlueprint({})).toThrow(/unknown blueprint kind/);
    expect(() => parseAnyBlueprint(null)).toThrow(/unknown blueprint kind/);
    expect(() => parseAnyBlueprint('EngineeringBlueprint')).toThrow(/unknown blueprint kind/);
  });

  it('still STRICT-validates the matched kind (a known kind with a bad body throws)', () => {
    expect(() => parseAnyBlueprint({ kind: 'PortfolioBlueprint' })).toThrow();
  });
});
