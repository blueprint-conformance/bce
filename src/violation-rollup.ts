/**
 * The violation-rollup PRODUCER — the
 * missing middle wire of the learning loop. Council finding G2: the pure
 * proposer (proposeFromViolations) and the pure steward-queue both EXIST and are correct, and the
 * CC steward UX reads a runs bundle expecting a `proposals[]` array — but NOTHING computed the real
 * recurring-drift signal and fed the proposer, so the steward's "requested-amendment" lane was
 * STRUCTURALLY ALWAYS EMPTY. This module closes that: it rolls a set of ComplianceReports (the real
 * gate-run history) into the ViolationCount[] the proposer expects, so a recurring violation on a
 * real gated repo actually produces a BlueprintChangeProposal a steward sees.
 *
 * Pure + deterministic (a rollup of REAL engine output, no wall-clock, no fabricated
 * signal): the same set of reports in → byte-identical ViolationCount[] out (sorted). Self-contained
 * (consume-don't-duplicate): reuses THIS package's OWN ComplianceReport/Violation/Severity/ViolationCount + the
 * report.ts SEVERITY_WEIGHT — NEVER CT/Prisma.
 *
 * @module violation-rollup
 */
import type { ComplianceReport, Violation } from './report.js';
import { SEVERITY_WEIGHT } from './report.js';
import type { Severity } from './schema.js';
import type { ViolationCount } from './score.js';

/**
 * Roll a set of ComplianceReports (a blueprint's gate-run history) into the ViolationCount[] that
 * proposeFromViolations consumes. Aggregates per constraintId across all runs: `count` = how many
 * runs the constraint was violated in (the RECURRENCE signal), `weight` = count × severity-weight
 * (the impact rank), `severity` = the HIGHEST severity observed for that constraint, `subsystems` =
 * the distinct blueprintRefs/subsystems where it recurred.
 *
 * A constraint violated in a SINGLE run is noise (count 1 < RECURRENCE_THRESHOLD 2 → the proposer
 * emits nothing); one that recurs across ≥2 runs is a real drift worth proposing a change for.
 */
export function rollupViolations(reports: readonly ComplianceReport[]): ViolationCount[] {
  // constraintId → { count, maxSeverity, subsystems }
  const acc = new Map<string, { count: number; maxSeverity: Severity; subsystems: Set<string> }>();

  const severityRank = (s: Severity): number =>
    (['info', 'low', 'medium', 'high', 'critical'] as const).indexOf(s);

  for (const report of reports) {
    // a report's subsystem label = its blueprintRef (id@version) stripped to the subsystem id
    const subsystem = report.blueprintRef.split('@')[0] ?? report.blueprintRef;
    // count a constraint ONCE per report even if it produced multiple violation rows in that run
    // (recurrence is measured across RUNS, not across rows within a run).
    const seenThisReport = new Set<string>();
    for (const v of report.violations as readonly Violation[]) {
      const key = v.constraintId;
      if (seenThisReport.has(key)) {
        // still widen severity + subsystems even for a repeat row in the same report
        const cur = acc.get(key)!;
        if (severityRank(v.severity) > severityRank(cur.maxSeverity)) cur.maxSeverity = v.severity;
        cur.subsystems.add(subsystem);
        continue;
      }
      seenThisReport.add(key);
      const cur = acc.get(key);
      if (!cur) {
        acc.set(key, { count: 1, maxSeverity: v.severity, subsystems: new Set([subsystem]) });
      } else {
        cur.count += 1;
        if (severityRank(v.severity) > severityRank(cur.maxSeverity)) cur.maxSeverity = v.severity;
        cur.subsystems.add(subsystem);
      }
    }
  }

  const out: ViolationCount[] = [...acc.entries()].map(([constraintId, a]) => ({
    constraintId,
    severity: a.maxSeverity,
    count: a.count,
    weight: a.count * SEVERITY_WEIGHT[a.maxSeverity]!,
    subsystems: [...a.subsystems].sort(),
  }));

  // deterministic order: highest impact (weight) first, then constraintId asc — same input → same output.
  out.sort((x, y) => (y.weight - x.weight) || x.constraintId.localeCompare(y.constraintId));
  return out;
}
