export type BenchmarkOutcome = 'detected' | 'not-detected' | 'unsupported';
export interface BenchmarkJudgment {
  caseId: string;
  defectClass: string;
  expectedViolation: boolean;
  outcome: BenchmarkOutcome;
  annotators: [string, string];
  locations: [string, string];
  collateralViolations: number;
}
export interface Interval { estimate: number | null; low: number | null; high: number | null }
export interface BenchmarkMetrics {
  opportunities: number; supportedOpportunities: number; unsupported: number;
  tp: number; fp: number; fn: number; tn: number; collateralViolations: number;
  precision: Interval; recall: Interval; specificity: Interval; falseViolationsPerOpportunity: number | null;
}

function wilson(successes: number, total: number): Interval {
  if (total === 0) return { estimate: null, low: null, high: null };
  const z = 1.959963984540054;
  const p = successes / total;
  const den = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / den;
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total) / den;
  return { estimate: p, low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

export function validateJudgments(rows: readonly BenchmarkJudgment[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (ids.has(row.caseId)) errors.push(`${row.caseId}: duplicate caseId`);
    ids.add(row.caseId);
    if (row.annotators[0].trim() === row.annotators[1].trim()) errors.push(`${row.caseId}: annotators must be independent identities`);
    if (row.locations.some((x) => !/^.+#L\d+(?:-L\d+)?$/.test(x))) errors.push(`${row.caseId}: both annotations require exact file#line locations`);
    if (!Number.isInteger(row.collateralViolations) || row.collateralViolations < 0) errors.push(`${row.caseId}: collateralViolations must be a non-negative integer`);
  }
  return errors;
}

export function benchmarkMetrics(rows: readonly BenchmarkJudgment[]): BenchmarkMetrics {
  const invalid = validateJudgments(rows);
  if (invalid.length) throw new Error(`invalid benchmark judgments: ${invalid.join('; ')}`);
  let tp = 0, fp = 0, fn = 0, tn = 0, unsupported = 0, collateralViolations = 0;
  for (const row of rows) {
    collateralViolations += row.collateralViolations;
    if (row.outcome === 'unsupported') { unsupported++; continue; }
    if (row.expectedViolation && row.outcome === 'detected') tp++;
    else if (row.expectedViolation) fn++;
    else if (row.outcome === 'detected') fp++;
    else tn++;
  }
  const supportedOpportunities = rows.length - unsupported;
  return {
    opportunities: rows.length, supportedOpportunities, unsupported, tp, fp, fn, tn, collateralViolations,
    precision: wilson(tp, tp + fp), recall: wilson(tp, tp + fn), specificity: wilson(tn, tn + fp),
    falseViolationsPerOpportunity: supportedOpportunities ? (fp + collateralViolations) / supportedOpportunities : null,
  };
}

export function metricsByClass(rows: readonly BenchmarkJudgment[]): Record<string, BenchmarkMetrics> {
  return Object.fromEntries([...new Set(rows.map((r) => r.defectClass))].sort().map((kind) => [kind, benchmarkMetrics(rows.filter((r) => r.defectClass === kind))]));
}
