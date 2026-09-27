/**
 * The fail-closed portfolio collector.
 *
 * Proves the F-L1-1 refutation clause: the board model is NEVER built over a partial or
 * fabricated denominator — a missing declared repo, an extra undeclared repo, or a consumer set
 * below the minMembers floor each REFUSE (naming the cause) rather than rolling up. The happy
 * path feeds the EXISTING `architectureScore` UNCHANGED, over REAL engine
 * reports (never fabricate data: reports come from the real pipeline, exactly as the
 * determinism-proof builds them).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { collectPortfolio, PortfolioRegistrySchema, type PortfolioRegistry } from '../src/portfolio-collect.js';
import { architectureScore } from '../src/score.js';
import { parseBlueprint } from '../src/schema.js';
import { resolveExtraction, AstExtractor } from '../src/extractors.js';
import { evaluate, type ComplianceReport } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

/** Build a REAL report the way the CLI does (determinism-proof pattern) — repo-tagged. */
function buildReport(surfaceName: string, revision: string, repoName: string): ComplianceReport {
  const blueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));
  const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
  const graph = new AstExtractor(cfg).extract(path.join(FIXROOT, 'extension-surface', surfaceName), revision);
  return evaluate(blueprint, graph, 'plugin-surface', repoName);
}

const REPO_A = 'example-org/service-alpha';
const REPO_B = 'example-org/service-beta';

const registry: PortfolioRegistry = PortfolioRegistrySchema.parse({
  consumers: [{ repo: REPO_A }, { repo: REPO_B }],
  governance: { minMembers: 2 },
});

const reportA = buildReport('conformant', 'rev-a', REPO_A); // pass
const reportB = buildReport('drift-forbidden-import', 'rev-b', REPO_B); // fail

describe('collectPortfolio — fail-closed denominator (F-L1-1)', () => {
  it('REFUSES when a declared repo delivered no report, NAMING the repo', () => {
    const r = collectPortfolio({ registry, reportsByRepo: { [REPO_A]: [reportA] } });
    expect(r.refused).toBe(true);
    if (r.refused) expect(r.reason).toContain(REPO_B);
  });

  it('REFUSES when a declared repo is present but EMPTY (0 reports = missing)', () => {
    const r = collectPortfolio({ registry, reportsByRepo: { [REPO_A]: [reportA], [REPO_B]: [] } });
    expect(r.refused).toBe(true);
    if (r.refused) expect(r.reason).toContain(REPO_B);
  });

  it('REFUSES when an UNDECLARED repo delivered reports (no fabricated denominator inflation)', () => {
    const r = collectPortfolio({
      registry,
      reportsByRepo: { [REPO_A]: [reportA], [REPO_B]: [reportB], 'rogue/repo': [reportA] },
    });
    expect(r.refused).toBe(true);
    if (r.refused) expect(r.reason).toContain('rogue/repo');
  });

  it('REFUSES below the minMembers floor', () => {
    const small = PortfolioRegistrySchema.parse({ consumers: [{ repo: REPO_A }], governance: { minMembers: 2 } });
    const r = collectPortfolio({ registry: small, reportsByRepo: { [REPO_A]: [reportA] } });
    expect(r.refused).toBe(true);
    if (r.refused) expect(r.reason).toContain('minMembers');
  });
});

describe('collectPortfolio — happy path feeds the EXISTING aggregator UNCHANGED', () => {
  const r = collectPortfolio({ registry, reportsByRepo: { [REPO_B]: [reportB], [REPO_A]: [reportA] } });

  it('rolls up: envelopes are repo-tagged and DETERMINISTICALLY sorted regardless of input order', () => {
    expect(r.refused).toBe(false);
    if (r.refused) return;
    expect(r.envelopes.map((e) => e.repo)).toEqual([REPO_B, REPO_A].sort());
    for (const e of r.envelopes) expect(e.report.repo).toBe(e.repo);
  });

  it('boardInput feeds architectureScore verbatim (2 subsystems, 1 passing — real engine numbers)', () => {
    if (r.refused) return;
    const arch = architectureScore(r.boardInput.reports);
    expect(arch.total).toBe(2);
    expect(arch.passing).toBe(1);
    expect(arch.overall).toBeGreaterThan(0);
    expect(arch.overall).toBeLessThan(100);
  });

  it('boardInput carries the registry-sourced repositories count (never guessed from reports)', () => {
    if (r.refused) return;
    expect(r.boardInput.repositories).toBe(2);
  });
});

describe('PortfolioRegistrySchema', () => {
  it('REJECTS an empty consumer set and a non-positive minMembers', () => {
    expect(PortfolioRegistrySchema.safeParse({ consumers: [], governance: { minMembers: 1 } }).success).toBe(false);
    expect(PortfolioRegistrySchema.safeParse({ consumers: [{ repo: 'a/b' }], governance: { minMembers: 0 } }).success).toBe(false);
  });
});

describe('portfolio collect CLI report parsing', () => {
  it('accepts a valid v2 null score and refuses it as indeterminate, not malformed', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-portfolio-v2-'));
    try {
      const reports = path.join(root, 'reports');
      const sink = path.join(reports, 'example-org-service-alpha');
      fs.mkdirSync(sink, { recursive: true });
      fs.writeFileSync(path.join(root, 'registry.json'), JSON.stringify({ consumers: [{ repo: REPO_A }], governance: { minMembers: 1 } }));
      fs.writeFileSync(path.join(sink, 'report.json'), JSON.stringify({
        schemaVersion: '2', blueprintRef: 'stack@1.0.0', ctRepoRevision: 'test', repo: REPO_A,
        score: null, verdict: 'indeterminate', violations: [], evidenceRef: 'n/a', summary: 'refused',
        coverage: { providers: [{ evidenceClass: 'declaredStack', filesScanned: 0, unsupported: ['missing'] }] },
        stack: null, refusals: [{ constraintId: 'stack', evidenceClass: 'declaredStack', code: 'missing-source', reason: 'missing', sources: ['package-lock.json'] }],
      }));
      const run = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('src/cli.ts'), 'portfolio', 'collect', '--registry', path.join(root, 'registry.json'), '--reports-dir', reports], { encoding: 'utf8' });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain('portfolio collect REFUSED: indeterminate report(s)');
      expect(run.stderr).not.toContain('not a ComplianceReport');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
