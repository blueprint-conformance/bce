/**
 * The portfolio → per-repo overlay compiler.
 *
 * Proves: byte-stable determinism (compile twice → identical canonical bytes), the committed
 * GOLDEN files match a fresh compile (phantom-diff prevention — a compiler change that moves a
 * byte fails here loudly), every overlay strict-validates, and the SUBDIR-MEMBER fixture: the
 * emitted overlay's paths are NOT repoDir-prefixed (the F-L2-5 hazard) and match real files when
 * the gate is evaluated AT the member's repoDir — exactly where a member's gate runs.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compilePortfolio,
  serializeBlueprintCanonical,
  slugifyRepo,
} from '../src/portfolio-compile.js';
import { parsePortfolioBlueprint, EngineeringBlueprintSchema, type PortfolioBlueprint } from '../src/schema.js';
import { runGate } from '../src/gate.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const PORTFOLIO_PATH = path.join(FIXROOT, 'portfolio', 'demo-fleet.portfolio-blueprint.json');
const GOLDEN_DIR = path.join(FIXROOT, 'portfolio', 'golden');

/** Re-parse fresh from disk each time — re-derivability includes the parse (determinism-proof pattern). */
const readPortfolio = (): PortfolioBlueprint =>
  parsePortfolioBlueprint(JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')));

describe('slugifyRepo', () => {
  it('is deterministic and filesystem-safe', () => {
    expect(slugifyRepo('example-org/service-alpha')).toBe('example-org-service-alpha');
    expect(slugifyRepo('Example-Org/Local_Agents')).toBe('example-org-local-agents');
    expect(slugifyRepo('/weird//repo/')).toBe('weird-repo');
  });
});

describe('compilePortfolio — determinism + golden fixtures', () => {
  it('emits one overlay per member, each STRICT-valid, id = <portfolioId>--<slug(repo)>', () => {
    const portfolio = readPortfolio();
    const overlays = compilePortfolio(portfolio);
    expect(overlays).toHaveLength(portfolio.members.length);
    for (const { member, blueprint } of overlays) {
      expect(() => EngineeringBlueprintSchema.parse(blueprint)).not.toThrow();
      expect(blueprint.metadata.id).toBe(`${portfolio.metadata.id}--${slugifyRepo(member.repo)}`);
      // the fleet governance version — NOT the portfolio's own metadata.version.
      expect(blueprint.metadata.version).toBe(portfolio.governance.version);
      expect(blueprint.scope.repositories).toEqual([member.repo]);
      expect(blueprint.intentRefs).toEqual(portfolio.intentRefs);
      expect(blueprint.constraints).toEqual(portfolio.fleetConstraints);
    }
  });

  it('compiling TWICE from two independent parses is BYTE-IDENTICAL (canonical serializer)', () => {
    const a = compilePortfolio(readPortfolio());
    const b = compilePortfolio(readPortfolio());
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(serializeBlueprintCanonical(a[i].blueprint)).toBe(serializeBlueprintCanonical(b[i].blueprint));
    }
  });

  it('matches the COMMITTED golden files byte-for-byte (phantom-diff prevention)', () => {
    const overlays = compilePortfolio(readPortfolio());
    for (const { blueprint } of overlays) {
      const goldenPath = path.join(GOLDEN_DIR, `${blueprint.metadata.id}.blueprint.json`);
      expect(fs.existsSync(goldenPath)).toBe(true);
      expect(serializeBlueprintCanonical(blueprint)).toBe(fs.readFileSync(goldenPath, 'utf8'));
    }
  });
});

describe('compilePortfolio — subdir member (repoDir-aware, the F-L2-5 hazard)', () => {
  const portfolio = readPortfolio();
  const subdirMember = portfolio.members.find((m) => m.repoDir !== '.');
  if (!subdirMember) throw new Error('fixture must carry a subdir member (repoDir !== ".")');
  const overlay = compilePortfolio(portfolio).find((o) => o.member.repo === subdirMember.repo)!.blueprint;

  it("does NOT prefix the overlay's paths with the member repoDir (the hazard is a compiler that prefixes)", () => {
    for (const p of overlay.extraction?.paths ?? []) {
      expect(p.startsWith(`${subdirMember.repoDir}/`)).toBe(false);
    }
    // byte-equal to the portfolio's shared extraction paths — AS-IS, repoDir '.' and subdir alike.
    expect(overlay.extraction?.paths).toEqual(portfolio.extraction.paths);
  });

  it('GOLDEN: the subdir overlay validates AND its paths match real files when evaluated AT the repoDir', () => {
    // Arrange a monorepo-shaped checkout: <root>/<repoDir>/src/extensions/... — the member's gate
    // runs `bce gate --repo <root>/<repoDir>`, so the overlay's repo-root-anchored globs are
    // repoDir-relative THERE. A prefixing compiler would resolve ZERO files here and fail-closed.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-portfolio-subdir-'));
    try {
      const memberRoot = path.join(root, subdirMember.repoDir);
      fs.cpSync(path.join(FIXROOT, 'extension-surface', 'conformant', 'src'), path.join(memberRoot, 'src'), {
        recursive: true,
      });
      const bpDir = path.join(memberRoot, '.blueprints');
      fs.mkdirSync(bpDir, { recursive: true });
      fs.writeFileSync(
        path.join(bpDir, `${overlay.metadata.id}.blueprint.json`),
        serializeBlueprintCanonical(overlay),
      );
      // runGate strict-parses the overlay from disk (validates) and scans at the repoDir.
      const r = runGate(memberRoot, bpDir, null, 'ast');
      expect(r.blueprintsSelected).toBe(1);
      expect(r.failed).toBe(false);
      expect(r.reports[0].verdict).toBe('pass');
      expect(r.reports[0].coverage.filesScanned).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
