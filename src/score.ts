/**
 * The Architecture Score primitive + the append-only score time-series +
 * the Top-Violations rollup — the observability primitives over ComplianceReports.
 *
 * These are pure aggregators (no I/O, no wall-clock) so they are deterministic and testable; the
 * CLI / a CT board persists the JSONL and renders. Architecture Engineering's "real greenfield"
 * (per the vision synthesis) is observability — but built HONESTLY as a rollup of the engine's own
 * re-derivable ComplianceReports, never a dashboard over nothing.
 */
import type { ComplianceReport, Violation } from './report.js';
import { SEVERITY_WEIGHT } from './report.js';
import type { Severity } from './schema.js';

/* -------------------------------------------------------------------------- */
/* Architecture Score — one 0-100 per subsystem + a fleet rollup              */
/* -------------------------------------------------------------------------- */

export interface SubsystemScore {
  /** the blueprint id (subsystem) — one score per authored blueprint. */
  subsystem: string;
  blueprintRef: string;
  score: number;
  verdict: 'pass' | 'fail';
  violationCount: number;
  /** violation counts by severity, so a board can show the severity mix. */
  bySeverity: Record<Severity, number>;
}

export interface ArchitectureScore {
  /** the mean score across subsystems (0-100), rounded to 1 dp — the fleet Architecture Score. */
  overall: number;
  /** the count of subsystems whose verdict is pass. */
  passing: number;
  total: number;
  subsystems: SubsystemScore[];
  /** fleet-wide violation counts by severity. */
  bySeverity: Record<Severity, number>;
}

const ZERO_SEVERITY: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };

function countBySeverity(violations: readonly Violation[]): Record<Severity, number> {
  const out = { ...ZERO_SEVERITY };
  for (const v of violations) out[v.severity] = (out[v.severity] ?? 0) + 1;
  return out;
}

/** One subsystem's score, derived from its ComplianceReport. */
export function subsystemScore(report: ComplianceReport): SubsystemScore {
  return {
    subsystem: report.blueprintRef.split('@')[0] ?? report.blueprintRef,
    blueprintRef: report.blueprintRef,
    score: report.score,
    verdict: report.verdict,
    violationCount: report.violations.length,
    bySeverity: countBySeverity(report.violations),
  };
}

/**
 * Roll a set of ComplianceReports into the fleet Architecture Score. Deterministic: subsystems are
 * sorted by id; `overall` is the mean subsystem score (0 for an empty set — a fleet with no scored
 * subsystem is honestly 0, never a vacuous 100).
 */
export function architectureScore(reports: readonly ComplianceReport[]): ArchitectureScore {
  // total-order comparator (finding: two reports sharing a subsystem id must not depend on input
  // order — determinism is load-bearing). Tiebreak subsystem → blueprintRef → verdict.
  const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
  const subsystems = reports
    .map(subsystemScore)
    .sort((a, b) => cmp(a.subsystem, b.subsystem) || cmp(a.blueprintRef, b.blueprintRef) || cmp(a.verdict, b.verdict));
  const total = subsystems.length;
  const overall = total === 0 ? 0 : Math.round((subsystems.reduce((s, x) => s + x.score, 0) / total) * 10) / 10;
  const passing = subsystems.filter((s) => s.verdict === 'pass').length;
  const bySeverity = { ...ZERO_SEVERITY };
  for (const s of subsystems) for (const k of Object.keys(bySeverity) as Severity[]) bySeverity[k] = (bySeverity[k] ?? 0) + (s.bySeverity[k] ?? 0);
  return { overall, passing, total, subsystems, bySeverity };
}

/* -------------------------------------------------------------------------- */
/* Score time-series — append-only trend series                               */
/* -------------------------------------------------------------------------- */

export interface ScoreSample {
  /** the repo revision this sample was measured at — the determinism anchor (NOT wall-clock). */
  revision: string;
  subsystem: string;
  score: number;
  verdict: 'pass' | 'fail';
  violationCount: number;
}

/** One trend sample from a report (revision-anchored, deterministic). */
export function toScoreSample(report: ComplianceReport): ScoreSample {
  return {
    revision: report.ctRepoRevision,
    subsystem: report.blueprintRef.split('@')[0] ?? report.blueprintRef,
    score: report.score,
    verdict: report.verdict,
    violationCount: report.violations.length,
  };
}

export interface TrendSummary {
  subsystem: string;
  samples: number;
  first: number;
  last: number;
  /** last − first: positive = improving, negative = drifting worse. */
  delta: number;
  min: number;
  max: number;
}

/**
 * Summarize an append-only series of samples (assumed in chronological append order) into a
 * per-subsystem trend. Deterministic; empty series → []. This is the read-path over the JSONL a
 * scheduled `bce run --emit` would append; the store itself is append-only JSONL on disk/CT.
 */
export function trendSummary(series: readonly ScoreSample[]): TrendSummary[] {
  const bySub = new Map<string, ScoreSample[]>();
  for (const s of series) {
    const arr = bySub.get(s.subsystem) ?? [];
    arr.push(s);
    bySub.set(s.subsystem, arr);
  }
  return [...bySub.keys()].sort().map((subsystem) => {
    const arr = bySub.get(subsystem)!;
    const scores = arr.map((x) => x.score);
    const first = scores[0]!;
    const last = scores[scores.length - 1]!;
    return { subsystem, samples: arr.length, first, last, delta: last - first, min: Math.min(...scores), max: Math.max(...scores) };
  });
}

/* -------------------------------------------------------------------------- */
/* Top-Violations rollup                                                      */
/* -------------------------------------------------------------------------- */

export interface ViolationCount {
  constraintId: string;
  severity: Severity;
  count: number;
  /** total severity-weight this constraint contributes (count × weight) — the impact rank. */
  weight: number;
  subsystems: string[];
}

/**
 * Roll all violations across all reports into a Top-Violations feed, ranked by total severity
 * weight (impact) then count. Deterministic (stable sort with id tiebreak). A pure aggregator over
 * the engine's own Violation[] — no external source, no fabricated data (never claim what was not proven).
 */
export function topViolations(reports: readonly ComplianceReport[], limit = 10): ViolationCount[] {
  const byConstraint = new Map<string, ViolationCount>();
  for (const report of reports) {
    const subsystem = report.blueprintRef.split('@')[0] ?? report.blueprintRef;
    for (const v of report.violations) {
      const cur = byConstraint.get(v.constraintId) ?? { constraintId: v.constraintId, severity: v.severity, count: 0, weight: 0, subsystems: [] };
      cur.count += 1;
      cur.weight += SEVERITY_WEIGHT[v.severity];
      if (!cur.subsystems.includes(subsystem)) cur.subsystems.push(subsystem);
      // keep the highest severity seen for this constraint
      if (SEVERITY_WEIGHT[v.severity] > SEVERITY_WEIGHT[cur.severity]) cur.severity = v.severity;
      byConstraint.set(v.constraintId, cur);
    }
  }
  return [...byConstraint.values()]
    .map((c) => ({ ...c, subsystems: [...c.subsystems].sort() }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || (a.constraintId < b.constraintId ? -1 : 1))
    .slice(0, limit);
}
