/**
 * The portfolio COLLECTOR — per-repo ComplianceReports → ONE honest fleet rollup.
 *
 * `collectPortfolio()` joins a consumer REGISTRY (the declared fleet membership) against the
 * per-repo report sinks and feeds the EXISTING aggregator — `architectureScore()` —
 * UNCHANGED. It adds NO scoring of its own: every number in the rollup is
 * the engine's own re-derivable output (a rollup of real reports, never a dashboard
 * over nothing).
 *
 * FAIL-CLOSED DENOMINATOR (refutation F-L1-1): the board model is NEVER built over a partial or
 * fabricated denominator. The collector REFUSES (never partially rolls up) unless
 *   (a) the set of repos with >= 1 report EXACTLY equals the declared consumer set, AND
 *   (b) the declared consumer count >= governance.minMembers.
 * A missing repo names the repo in the refusal reason; an EXTRA repo (reports for a repo the
 * registry never declared) is equally a refusal — an undeclared member inflating the fleet score
 * is fabrication, not coverage.
 *
 * CONSUME-AND-RETIRE: an adopting estate's interim sweep-side rollup script is retired by this
 * collector — the estate's sweep consumes `bce portfolio collect` instead of re-deriving its own
 * verdict.
 * One rollup implementation, package-owned (consume-don't-duplicate).
 */
import { z } from 'zod';
import type { ComplianceReport } from './report.js';
import type { ScoreSample } from './score.js';
import type { EvidenceItemsCount } from './evidence-store.js';

/**
 * The aggregator input shape the collector produces (inlined verbatim from the retired
 * board aggregator; every referenced type lives in this package). `architectureScore()`
 * consumes `boardInput.reports` UNCHANGED.
 */
export interface BoardInput {
  reports: readonly ComplianceReport[];
  series?: readonly ScoreSample[];
  evidence?: EvidenceItemsCount;
  workOrders?: number;
  repositories?: number;
  topLimit?: number;
}

/** The declared fleet membership the collector joins reports against. */
export const PortfolioRegistrySchema = z
  .object({
    consumers: z
      .array(
        z
          .object({
            repo: z.string().min(1),
          })
          .passthrough(),
      )
      .min(1),
    governance: z
      .object({
        minMembers: z.number().int().positive(),
      })
      .passthrough(),
  })
  .passthrough();
export type PortfolioRegistry = z.infer<typeof PortfolioRegistrySchema>;

/** One repo's report envelope in the rollup (one entry per report, repo-tagged). */
export interface CollectedEnvelope {
  repo: string;
  report: ComplianceReport;
}

/** The refusal shape — the collector NEVER partially rolls up (F-L1-1). */
export interface CollectRefusal {
  refused: true;
  reason: string;
}

/** The successful rollup: repo-tagged envelopes + the input the EXISTING board consumes. */
export interface CollectResult {
  refused: false;
  envelopes: CollectedEnvelope[];
  /** feeds `architectureScore(boardInput.reports)` UNCHANGED. */
  boardInput: BoardInput;
}

/** total-order string comparator (determinism is load-bearing — mirrors score.ts). */
const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Join the registry against the per-repo report sets. Deterministic: envelopes are sorted
 * (repo, then blueprintRef) regardless of input order. Fail-closed per the module header.
 */
export function collectPortfolio(input: {
  registry: PortfolioRegistry;
  /** repo → that repo's ComplianceReports (as read from its sink dir). */
  reportsByRepo: Record<string, readonly ComplianceReport[]>;
}): CollectResult | CollectRefusal {
  const declared = [...new Set(input.registry.consumers.map((c) => c.repo))].sort();
  const minMembers = input.registry.governance.minMembers;

  if (declared.length < minMembers) {
    return {
      refused: true,
      reason: `minMembers floor: ${declared.length} declared consumer(s) < governance.minMembers ${minMembers}`,
    };
  }

  // repos that actually delivered >= 1 report
  const delivered = Object.keys(input.reportsByRepo)
    .filter((repo) => (input.reportsByRepo[repo]?.length ?? 0) > 0)
    .sort();

  const missing = declared.filter((r) => !delivered.includes(r));
  if (missing.length > 0) {
    return {
      refused: true,
      reason: `missing report(s) for declared consumer(s): ${missing.join(', ')} — the board is never built over a partial denominator`,
    };
  }
  const extra = delivered.filter((r) => !declared.includes(r));
  if (extra.length > 0) {
    return {
      refused: true,
      reason: `report(s) present for UNDECLARED repo(s): ${extra.join(', ')} — an undeclared member must not inflate the fleet rollup`,
    };
  }

  const envelopes: CollectedEnvelope[] = declared
    .flatMap((repo) => (input.reportsByRepo[repo] ?? []).map((report) => ({ repo, report })))
    .sort((a, b) => cmp(a.repo, b.repo) || cmp(a.report.blueprintRef, b.report.blueprintRef));

  return {
    refused: false,
    envelopes,
    boardInput: {
      reports: envelopes.map((e) => e.report),
      // the ONLY count the reports alone cannot carry — from the registry (the scope-carrying
      // source), exactly as `BoardInput.repositories` documents.
      repositories: declared.length,
    },
  };
}
