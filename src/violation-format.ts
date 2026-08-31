/**
 * Grouped violation OUTPUT (SPEC §9.3 + §11). The gate's per-violation firehose is legible for one
 * or two reds, but a brownfield adoption run can surface dozens — an unreadable wall of `::error::`
 * lines. This module renders the SAME violation set two ways, deterministically:
 *
 *  - DEFAULT (grouped): one summary line PER CONSTRAINT — `constraintId (severity): N violation(s)`
 *    followed by a compact per-constraint remediation footer. A reader sees the SHAPE of the drift
 *    (which constraints, how badly) without scrolling past every component.
 *  - `--all` (full): every violation, each carrying expected-vs-observed + the blueprint anchor
 *    (`evidenceRef`, `path#L<line>` where applicable) + BOTH remediation paths.
 *
 * BOTH remediation paths, on every violation and every constraint group (SPEC §9.3): a violation is
 * NOT only "the code is wrong" — the blueprint might be. Every message states both:
 *   (1) FIX THE CODE   — change the implementation to satisfy the constraint;
 *   (2) AMEND THE BLUEPRINT — if the constraint is wrong/obsolete, change or remove it via a PR
 *       (the blueprint is a reviewed artifact; a bad rule is fixed by editing the rule, in the open).
 * This is the honest frame: the gate reports a DISAGREEMENT between code and blueprint, and either
 * side may be the one to move. Pure — returns lines; the CLI writes them (testable without a CLI).
 */
import type { Severity } from './schema.js';
import type { Violation } from './report.js';

/** Order severities strongest-first for grouped display (critical groups lead). */
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/** The blueprint anchor for a violation — the `path#L<line>` (or the raw evidenceRef when unanchored). */
export function blueprintAnchor(v: Violation): string {
  return v.evidenceRef && v.evidenceRef !== 'n/a' ? v.evidenceRef : '(no file anchor)';
}

/**
 * The two remediation paths for a constraint, as a single compact line. Deterministic, constraint-
 * scoped (names the constraintId so amending is unambiguous). No wall-clock, no host, no repo path.
 */
export function remediationLine(constraintId: string): string {
  return (
    `      fix: change the code to satisfy '${constraintId}'  |  ` +
    `amend: if the rule is wrong, edit/remove '${constraintId}' in the blueprint via PR`
  );
}

/**
 * One fully-detailed violation line (the `--all` shape): the observed fact, the expectation it
 * violated, and the blueprint anchor — everything a fixer needs to act without opening the report.
 */
export function detailLine(v: Violation): string {
  return (
    `    - [${v.constraintId}/${v.severity}] ${v.component}\n` +
    `        observed: ${v.observed}\n` +
    `        expected: ${v.expected}\n` +
    `        at:       ${blueprintAnchor(v)}\n` +
    remediationLine(v.constraintId)
  );
}

/** A per-constraint group: the constraint, its (highest) severity, its violation rows. */
export interface ConstraintGroup {
  constraintId: string;
  severity: Severity;
  violations: Violation[];
}

/**
 * Group a violation set by constraintId, strongest-severity-first then constraintId-asc (stable,
 * deterministic). Within a group the violations keep the report's (constraintId, component) sort.
 * A group's severity is the HIGHEST severity among its rows (a constraint firing at mixed severities
 * displays at its worst).
 */
export function groupByConstraint(violations: readonly Violation[]): ConstraintGroup[] {
  const byId = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = byId.get(v.constraintId);
    if (arr) arr.push(v);
    else byId.set(v.constraintId, [v]);
  }
  const groups: ConstraintGroup[] = [...byId.entries()].map(([constraintId, vs]) => {
    const severity = vs.reduce<Severity>(
      (worst, v) => (SEVERITY_ORDER[v.severity] < SEVERITY_ORDER[worst] ? v.severity : worst),
      'info',
    );
    return { constraintId, severity, violations: vs };
  });
  groups.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.constraintId.localeCompare(b.constraintId),
  );
  return groups;
}

/**
 * Render a report's violations. `all=false` (default) → the grouped summary: one line per constraint
 * with its count + an example anchor, plus the two-path remediation footer. `all=true` → every
 * violation fully detailed. Returns an array of lines (no trailing newline per line) so the caller
 * controls the stream (stdout/stderr) and the CI-annotation prefix. Empty violations → empty array.
 */
export function renderViolations(violations: readonly Violation[], all: boolean): string[] {
  if (violations.length === 0) return [];
  const groups = groupByConstraint(violations);
  const lines: string[] = [];
  for (const g of groups) {
    if (all) {
      lines.push(`  ${g.constraintId} (${g.severity}): ${g.violations.length} violation(s)`);
      for (const v of g.violations) lines.push(detailLine(v));
    } else {
      // grouped summary: the constraint, the count, ONE example anchor, and the remediation footer.
      const example = g.violations[0];
      const more = g.violations.length > 1 ? ` (+${g.violations.length - 1} more component(s))` : '';
      lines.push(
        `  ${g.constraintId} (${g.severity}): ${g.violations.length} violation(s) — ` +
          `e.g. ${example ? example.component : '?'} at ${example ? blueprintAnchor(example) : '?'}${more}`,
      );
      lines.push(remediationLine(g.constraintId));
    }
  }
  if (!all) {
    lines.push(`  (run with --all for every violation's observed-vs-expected + anchor)`);
  }
  return lines;
}
