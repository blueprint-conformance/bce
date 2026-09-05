/**
 * The NA-6-style MEASURED-RECALL gate for the Blueprint Conformance Engine —
 * the measured-recall verify layer applied to the BCE itself.
 *
 * The BCE is a conformance ENGINE: it only earns the right to gate a merge if it is itself
 * MEASURED to actually catch the defects it claims to. This module scores that measurement.
 * Given a corpus of SeededDefect fixtures (from `./corpus.js`) and the ComplianceReports the
 * engine produced when run over those fixtures, it computes:
 *
 *   - recall  = caught / total-seeded  — did the engine flag the planted defect?
 *   - fpRate  = false-positives / total-reports — a false-positive is a violation on a report
 *               whose fixture seeded NO defect for that constraint (the engine crying wolf).
 *
 * `gateVerdict` turns the measurement into a HONEST pass/fail: a recall MEASURED below the
 * floor is an honest FAIL that keeps the engine ADVISORY — it is NEVER a licence to lower the
 * threshold to go green (the honest-fail invariant: ship only what the panel passes; a below-floor
 * measurement is a valid outcome, not a bug to paper over). The measurement IS the deliverable.
 *
 * Pure + deterministic: no wall-clock, no Math.random, sorted output. Same (seeded, results) in →
 * byte-identical measurement out. Self-contained — mirrors the SeededDefect/caughtDefect contract
 * from the sibling corpus module; imports NO host-estate package (consume-don't-duplicate).
 */
import type { ComplianceReport } from './report.js';
import type { SeededDefect } from './corpus.js';
import { caughtDefect } from './corpus.js';

/**
 * One fixture run: the seeded fixture's id + the ComplianceReport the engine produced for it.
 * The fixture id is the join key that lets the gate distinguish a caught seeded defect (recall)
 * from a violation on a clean fixture (a false-positive). REAL engine output only — an aggregator
 * rolls up what the engine produced, never a fabricated report (never claim what was not proven).
 */
export interface SeededRun {
  /** the fixture id — matches SeededDefect.fixture; the join key for recall/fp attribution. */
  fixture: string;
  /** the ComplianceReport the engine produced when run over this fixture. */
  report: ComplianceReport;
}

export interface RecallMeasurement {
  /** caught / total-seeded, in [0,1]. A corpus with zero seeded defects is honestly 0 (never 1). */
  recall: number;
  /** false-positives / total-reports, in [0,1]. Zero reports → 0. */
  fpRate: number;
  /** number of seeded defects the engine caught. */
  caught: number;
  /** total number of seeded defects in the corpus. */
  total: number;
  /** the seeded defects the engine MISSED — listed so an honest FAIL names exactly what slipped. */
  misses: SeededDefect[];
  /** number of violations on a report whose fixture seeded NO defect for that constraint. */
  falsePositives: number;
  /** total number of reports measured (the fp denominator). */
  reports: number;
}

export interface GateThresholds {
  minRecall: number;
  maxFpRate: number;
}

export interface GateVerdict {
  pass: boolean;
  reason: string;
}

/**
 * DEFAULT_THRESHOLDS — the pinned NA-6 floor for the BCE gate (a PINNED surface — tighten-only). A gate
 * measured below `minRecall` OR above `maxFpRate` is an honest FAIL. Per the security-is-a-ratchet
 * principle these may only ever TIGHTEN (higher recall floor, lower fp ceiling), never relax.
 */
export const DEFAULT_THRESHOLDS: GateThresholds = { minRecall: 0.9, maxFpRate: 0.1 };

/** Stable ordering for SeededDefect so `misses` is byte-deterministic. */
function compareDefects(a: SeededDefect, b: SeededDefect): number {
  const ka = `${a.fixture} ${a.constraintId}`;
  const kb = `${b.fixture} ${b.constraintId}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/**
 * Measure the engine's refute-recall + false-positive rate over a seeded corpus.
 *
 *  - recall counts, over the sorted seeded set, how many the engine caught (via corpus.caughtDefect
 *    against the report for that defect's fixture — a defect whose fixture has no run is a MISS,
 *    never silently dropped).
 *  - fpRate counts reports that raised a violation for a constraint their own fixture did NOT seed:
 *    a violation whose (fixture, constraintId) is not in the seeded set is a false-positive. A report
 *    with ONE-OR-MORE such violations counts once toward `falsePositives` (a report either cried wolf
 *    or it didn't). This keeps a panel that "refuses everything" from trivially scoring recall 1.0 —
 *    it pays in fpRate, which the ceiling catches (the measured-recall verify layer).
 *
 * Pure + deterministic. Empty corpus → recall 0 (honest); no reports → fpRate 0.
 */
export function measureRecall(
  seeded: readonly SeededDefect[],
  results: readonly SeededRun[],
): RecallMeasurement {
  const sortedSeeded = [...seeded].sort(compareDefects);
  const reportByFixture = new Map<string, ComplianceReport>();
  for (const run of results) reportByFixture.set(run.fixture, run.report);

  // recall: a seeded defect is caught iff its fixture ran AND corpus.caughtDefect says so.
  const misses: SeededDefect[] = [];
  let caught = 0;
  for (const defect of sortedSeeded) {
    const report = reportByFixture.get(defect.fixture);
    if (report && caughtDefect(defect, report)) {
      caught += 1;
    } else {
      misses.push(defect);
    }
  }
  const total = sortedSeeded.length;
  const recall = total === 0 ? 0 : caught / total;

  // fpRate: the set of legitimately-seeded (fixture, constraintId) pairs; any violation outside it
  // on that fixture's report is the engine crying wolf. A report is a false-positive iff it has ≥1.
  const seededPairs = new Set(sortedSeeded.map((d) => `${d.fixture} ${d.constraintId}`));
  let falsePositives = 0;
  for (const run of results) {
    const criedWolf = run.report.violations.some(
      (v) => !seededPairs.has(`${run.fixture} ${v.constraintId}`),
    );
    if (criedWolf) falsePositives += 1;
  }
  const reports = results.length;
  const fpRate = reports === 0 ? 0 : falsePositives / reports;

  return { recall, fpRate, caught, total, misses, falsePositives, reports };
}

/**
 * Turn a measurement into an HONEST gate verdict against the thresholds (DEFAULT_THRESHOLDS by
 * default). pass iff recall ≥ minRecall AND fpRate ≤ maxFpRate. A below-floor recall or an
 * over-ceiling fpRate is a FAIL whose `reason` names the shortfall (and the first misses) — the
 * caller keeps the engine ADVISORY on a FAIL, never lowers the floor to pass (the honest-fail invariant).
 */
export function gateVerdict(
  measurement: RecallMeasurement,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): GateVerdict {
  // Defend the PINNED surface (the honest-fail invariant): a caller MUST NOT pass a sub-floor threshold
  // to force green. minRecall<=0 or maxFpRate>=1 would make an empty/zero-seeded corpus vacuously
  // pass — the exact gate-relaxation bypass the doctrine forbids. Refuse it by construction.
  if (thresholds.minRecall <= 0 || thresholds.maxFpRate >= 1) {
    return {
      pass: false,
      reason: `GOVERNANCE-REFUSED: sub-floor thresholds (minRecall ${thresholds.minRecall} must be >0, maxFpRate ${thresholds.maxFpRate} must be <1) — a below-floor override is a governance bypass`,
    };
  }
  const { recall, fpRate, caught, total, misses } = measurement;
  const recallOk = recall >= thresholds.minRecall;
  const fpOk = fpRate <= thresholds.maxFpRate;

  if (recallOk && fpOk) {
    return {
      pass: true,
      reason: `PASS: recall ${recall.toFixed(3)} >= ${thresholds.minRecall} (${caught}/${total} caught), fpRate ${fpRate.toFixed(3)} <= ${thresholds.maxFpRate}`,
    };
  }

  const reasons: string[] = [];
  if (!recallOk) {
    // name what slipped — an honest FAIL points at the exact missed defects (never claim what was not proven).
    const named = misses
      .slice(0, 3)
      .map((m) => `${m.fixture}:${m.constraintId}`)
      .join(', ');
    const suffix = misses.length > 3 ? `, +${misses.length - 3} more` : '';
    reasons.push(
      `recall ${recall.toFixed(3)} < ${thresholds.minRecall} (${caught}/${total} caught; missed: ${named}${suffix})`,
    );
  }
  if (!fpOk) {
    reasons.push(`fpRate ${fpRate.toFixed(3)} > ${thresholds.maxFpRate} (${measurement.falsePositives}/${measurement.reports} reports cried wolf)`);
  }
  return { pass: false, reason: `FAIL (engine stays advisory): ${reasons.join('; ')}` };
}
