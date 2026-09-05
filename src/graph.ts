/**
 * The observed architecture graph — genuinely-new primitive #2's data shape.
 *
 * A machine-readable graph of a repo's ACTUAL architecture (components + real
 * call/dependency edges), extracted from source, that the conformance diff runs the
 * authored blueprint against. Persisted as `architecture-graph.json` (never prose).
 *
 * Deterministic-by-construction: no wall-clock in the body (provenance is
 * `ctRepoRevision`, a content SHA); all arrays are sorted before serialization.
 */

/** A node in the observed graph. For the walking skeleton: one per API route handler. */
export interface ObservedComponent {
  /** stable id, e.g. `route:objects:POST` */
  id: string;
  /** component class, e.g. `apiRouteHandler`, `ontologyStore` */
  type: string;
  /** repo-relative source path */
  path: string;
  /** 1-based line of the handler declaration */
  line: number;
}

/** An observed edge — a REAL call/dependency the extractor found in source. */
export interface ObservedEdge {
  /** source component id */
  from: string;
  /** the symbol/target the edge points at, e.g. `requireTenantWriteAccess` */
  to: string;
  /** edge kind, e.g. `guards` (a tenant-access guard call), `writes` (a store write) */
  type: string;
  /** evidence anchor `path#Lnn` */
  evidenceRef: string;
}

/** Honesty envelope — every extractor MUST declare what it cannot see (v0.9 COVERAGE_AND_CONFIDENCE). */
export interface CoverageReport {
  /** which extractor produced this graph */
  extractor: 'ast' | 'line-scan';
  /** count of source files actually parsed */
  filesScanned: number;
  /** fidelity limits this extractor carries — never claim full coverage */
  unsupported: string[];
  /**
   * OPTIONAL (added 0.8.0, widen-only): the sorted list of repo-relative source-file paths the
   * extractor actually scanned — the RAW file set, distinct from `components` (which only exist for
   * files that extracted as a recognized factory/route). This is what a `forbiddenFile` constraint
   * iterates, so a forbidden file is caught regardless of export shape (a named-export file that
   * mints 0 components is invisible to a `forbiddenPath` constraint but present here). ABSENT on
   * pre-0.8.0 graphs (the field is optional; older graphs serialize byte-unchanged). A `forbiddenFile`
   * constraint against a graph with no `scannedFiles` is recorded as `skipped` (honestly), never a
   * silent pass — see `evaluate()` in report.ts.
   */
  scannedFiles?: string[];
  /**
   * OPTIONAL (added 0.9.0, widen-only): the deterministic content-pattern scan a `forbiddenPattern`
   * constraint evaluates. `patterns` is the sorted, de-duplicated union of every forbiddenPattern
   * constraint's `pattern` (the constraint list is the single source of truth for what to scan —
   * the forbiddenImports/forbiddenEgressHosts union discipline, extractors.ts finding #5); `hits`
   * is one entry per (pattern, file, line) match, sorted by (file, line, pattern). Populated by
   * BOTH extractors over the SAME file set as `scannedFiles` (content grep needs no AST, so —
   * unlike forbiddenEgress — line-scan supports it with no refusal). ABSENT when the blueprint
   * declares no forbiddenPattern constraint, so every pre-existing serialized graph is
   * byte-unchanged. A `forbiddenPattern` constraint against a graph with no `patternScan` (or one
   * that never scanned its pattern) is recorded as `skipped` (honestly), never a silent pass —
   * see `evaluate()` in report.ts.
   */
  patternScan?: {
    patterns: string[];
    hits: Array<{ pattern: string; file: string; line: number }>;
  };
  /**
   * Detected network calls whose destination could not be resolved. An enforced
   * governed-host allowlist treats these as violations: absence of a destination
   * proof is not proof that the destination is governed.
   */
  unresolvedEgress?: Array<{ callee: string; ref: string }>;
  /**
   * Statically observed imports whose target could not be classified or resolved by the
   * TypeScript module-graph provider. Located uncertainty is evidence: relevant C2/C3 boundary
   * constraints fail closed on these items instead of treating an unknown edge as absent.
   */
  unresolvedImports?: Array<{
    from: string;
    specifier: string;
    kind: string;
    ref: string;
    reason: string;
  }>;
}

/** The persisted observed architecture graph. */
export interface ArchitectureGraph {
  schemaVersion: '1';
  /** the CT (or target) repo revision this graph was observed at — the determinism anchor */
  ctRepoRevision: string;
  components: ObservedComponent[];
  /** guard/write/etc. edges the extractor found (sorted) */
  guardEdges: ObservedEdge[];
  coverage: CoverageReport;
}

/**
 * The extractor contract. Both the ts-morph AST extractor and the line-scan fallback
 * implement this single interface, so `bce scan --extractor {ast|line-scan}` swaps
 * implementations with byte-identical downstream schema/diff/report.
 */
export interface RepositoryFactsExtractor {
  readonly kind: 'ast' | 'line-scan';
  /**
   * Extract the observed architecture graph from a clean repo tree.
   * @param repoDir  a materialized clean tree (e.g. `git archive origin/main | tar -x`)
   * @param revision the revision the tree was materialized from (stamped into the graph)
   */
  extract(repoDir: string, revision: string): ArchitectureGraph;
}

/** Total-order comparator so component arrays serialize deterministically. */
export function compareComponents(a: ObservedComponent, b: ObservedComponent): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Total-order comparator for edges (by from, then to, then type). */
export function compareEdges(a: ObservedEdge, b: ObservedEdge): number {
  const k = (e: ObservedEdge): string => `${e.from}\0${e.to}\0${e.type}`;
  const ka = k(a);
  const kb = k(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}
