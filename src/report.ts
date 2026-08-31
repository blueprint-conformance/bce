/**
 * The intended-vs-observed conformance diff + the deterministic ComplianceReport.
 *
 * This is the conformance ENGINE (not a compiler): a policy-evaluation pass over the
 * observed architecture graph, checking each authored blueprint constraint and emitting
 * a graded verdict with evidence. Pure + deterministic — same (blueprint, graph) in →
 * byte-identical report out.
 */
import { createHash } from 'node:crypto';
import type { ArchitectureGraph } from './graph.js';
import type { EngineeringBlueprint, ExtractionProfile, Severity } from './schema.js';
import { isGovernedHost } from './extractors.js';

export interface Violation {
  constraintId: string;
  severity: Severity;
  component: string;
  evidenceType: string;
  evidenceRef: string;
  observed: string;
  expected: string;
}

export interface ComplianceReport {
  schemaVersion: '1';
  blueprintRef: string;
  ctRepoRevision: string;
  score: number;
  verdict: 'pass' | 'fail';
  violations: Violation[];
  evidenceRef: string;
  summary: string;
  /**
   * The scan's honesty envelope, surfaced so a gate consumer sees what the extractor could NOT
   * see (never imply coverage you don't have). Mirrors the graph's CoverageReport.
   */
  coverage: {
    extractor: 'ast' | 'line-scan';
    filesScanned: number;
    unsupported: string[];
  };
  /**
   * ADDITIVE (OPTIONAL): the repo identity this report was produced for — the
   * portfolio collector's join key. ABSENT unless the producer passed one (`runGate(..., repoName)`
   * / `evaluate(..., repoName)`), so every 0.2.x-produced report — and its stableStringify bytes,
   * evidence hash, and score — is byte-identical (widen-only proof).
   */
  repo?: string;
  /**
   * ADDITIVE (OPTIONAL — mode doctrine, SPEC §9): the gate-mode ADOPTION POSTURE this report was
   * produced under, stamped by `bce gate` ONLY when a `.bce-mode.json` is present (`ResolvedMode.
   * explicit`). ABSENT on the pre-mode path (no config file) so every legacy report — bytes,
   * evidence hash, score — is byte-identical (widen-only). This field NEVER affects the verdict,
   * score, or violation set — it is a legibility stamp so a consumer can machine-distinguish an
   * advisory report from an enforced one. `advisory` means the gate exited 0 despite the verdict;
   * `enforced` means the standard fail-closed exit applied. NOT graded evidence — a posture label.
   */
  mode?: 'enforced' | 'advisory';
}

/**
 * Fixed per-severity weights. NOTE (honest flag per the design): these live in code
 * for the walking skeleton; in a real cycle they belong in a `severity→weight` map on
 * the blueprint itself so a subsystem can tune its own risk posture. Pinned here so the
 * score is a deterministic pure function of the violation set.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 40,
  high: 20,
  medium: 10,
  low: 5,
  info: 0,
};

/** Deterministic, sorted-key JSON serializer + trailing newline (byte-stable). */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v as object)) throw new Error('cannot serialize a cycle');
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(sort);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sort((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function compareViolations(a: Violation, b: Violation): number {
  const k = (v: Violation): string => `${v.constraintId} ${v.component}`;
  const ka = k(a);
  const kb = k(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

/** Anchored RegExp for a `forbiddenPath` glob (repo-relative, simple `**`/`*`). */
function pathGlobToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` anchors to a path boundary → `(?:.*/)?`; bare `**` → `.*`.
        i++;
        if (glob[i + 1] === '/') {
          re += '(?:.*/)?';
          i++;
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c as string)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Evaluate one blueprint against one observed graph → a deterministic ComplianceReport.
 *
 * Constraint semantics (blueprint-driven — the constraint names WHICH component type it
 * governs, so the same engine serves the CT-ontology surface AND an plugin-surface surface):
 *
 *  - `requiredDependency`: every observed component of the constraint's target type MUST
 *    have an outgoing satisfying edge. The target type + edge type are resolved from the
 *    constraint:
 *      · the historical D6 shape (`component:'apiRouteHandler'` + `evidenceType:'tenantGuard'`)
 *        → target `apiRouteHandler`, edge `guards` (byte-identical to the walking skeleton);
 *      · otherwise the constraint's `component` field names the target type and the edge is
 *        `provides` (an plugin-surface must register through the governed path).
 *    A component of the target type with NO satisfying edge → a violation at the severity.
 *  - `requiredComponent`: at least one observed component of the named type MUST exist
 *    (`constraint.component` = the required type). Zero → one violation (the scanned surface
 *    declares no recognizable component of that kind — e.g. a file that is not a real extension).
 *  - `forbiddenDependency` (from→to): a violation for EACH observed edge from→to. For an
 *    extension, `to` is a forbidden import module; the `from` may be `*` to mean "any
 *    component" (catch the forbidden import in any scanned extension).
 *  - `forbiddenPath`: a violation if any observed component's path matches the constraint's
 *    `path` (a component living where the blueprint forbids it).
 * Other constraint types are recorded as `skipped` — honestly, in the summary — never
 * silently treated as passing.
 */
export function evaluate(
  blueprint: EngineeringBlueprint,
  graph: ArchitectureGraph,
  /**
   * The resolved extraction profile. Used to gate the historical-D6 (CT/route) semantics ONLY
   * for `next-route-handler` (finding #3 — a stray `evidenceType:'tenantGuard'` on an plugin-surface
   * constraint must NOT silently retarget it to route semantics). Defaults to next-route-handler
   * for backward compatibility when a caller does not thread it (e.g. a raw evaluate() in a test).
   */
  profile: ExtractionProfile = 'next-route-handler',
  /**
   * ADDITIVE (OPTIONAL): the repo identity to stamp on the report (`report.repo`).
   * Absent → the field is OMITTED (not '') so pre-B2 reports stay byte-identical.
   */
  repoName?: string,
): ComplianceReport {
  const violations: Violation[] = [];
  const byId = new Map(graph.components.map((c) => [c.id, c]));
  const componentsByType = (t: string): typeof graph.components =>
    graph.components.filter((c) => c.type === t);
  // components that have at least one satisfying edge of a given edge-type
  const satisfiedIds = (edgeType: string): Set<string> =>
    new Set(graph.guardEdges.filter((e) => e.type === edgeType).map((e) => e.from));

  let skipped = 0;
  let implemented = 0; // count of ENFORCING (non-skipped) constraints that actually ran

  for (const c of blueprint.constraints) {
    if (c.type === 'requiredDependency') {
      implemented += 1;
      // The historical-D6 (CT/route) semantics apply ONLY on the next-route-handler profile
      // (finding #3): on plugin-surface, `component` always names the real target type — a stray
      // evidenceType:'tenantGuard' can never silently retarget it to apiRouteHandler/guards.
      const isHistoricalD6 =
        profile === 'next-route-handler' && (c.evidenceType === 'tenantGuard' || c.component === 'apiRouteHandler');
      const targetType = isHistoricalD6 ? 'apiRouteHandler' : (c.component ?? 'pluginSurface');
      const edgeType = isHistoricalD6 ? 'guards' : 'provides';
      const satisfied = satisfiedIds(edgeType);
      const targets = componentsByType(targetType);
      if (targets.length === 0) {
        // FAIL-CLOSED (findings #2/#5): a requiredDependency over ZERO target components is NOT
        // vacuously satisfied — a security-critical "must register through the governed path"
        // constraint that finds no component to check is a drift signal, not a pass.
        violations.push({
          constraintId: c.id,
          severity: c.severity,
          component: targetType,
          evidenceType: 'staticAst',
          evidenceRef: (blueprint.scope.paths ?? blueprint.scope.repositories).join(','),
          observed: `no '${targetType}' component found to satisfy the required ${edgeType} dependency`,
          expected: `at least one '${targetType}' component with a ${edgeType} edge`,
        });
      }
      for (const comp of [...targets].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
        if (!satisfied.has(comp.id)) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: comp.id,
            evidenceType: 'staticAst',
            evidenceRef: `${comp.path}#L${comp.line}`,
            observed: `no ${edgeType} edge from ${comp.id}`,
            expected: isHistoricalD6
              ? 'requireTenantAccess | requireTenantWriteAccess call in the handler body'
              : `a governed registration call (${edgeType}) in the ${targetType} body`,
          });
        }
      }
    } else if (c.type === 'requiredComponent' && c.component) {
      implemented += 1;
      if (componentsByType(c.component).length === 0) {
        violations.push({
          constraintId: c.id,
          severity: c.severity,
          component: c.component,
          evidenceType: 'staticAst',
          evidenceRef: (blueprint.scope.paths ?? blueprint.scope.repositories).join(','),
          observed: `no component of type '${c.component}' found in the scanned surface`,
          expected: `at least one '${c.component}' component`,
        });
      }
    } else if (c.type === 'forbiddenDependency' && c.to) {
      implemented += 1;
      // `from` may be an explicit component id, or '*'/undefined = any component.
      const anyFrom = !c.from || c.from === '*';
      // A forbidden import in an UNATTRIBUTABLE file (a `file:` pseudo-id — no recognized factory)
      // must NEVER be silently dropped by a from-specific filter (latent security gap): treat a
      // `file:` edge as matching ANY named `from`. A forbidden provider import is drift regardless
      // of whether the file names a recognized component.
      //
      // 0.9.0 scopePaths: when set, ADDITIONALLY require the edge's from-FILE to glob-match one of
      // the scope globs. Absent/empty → unchanged (every importer counts). The from-file is derived
      // from the edge's evidenceRef (`<relPath>#L<line>`) — robust across BOTH edge `from` shapes
      // (`file:<relPath>` unattributable AND `extension:<base>` factory), where a bare `file:`-strip
      // would miss the factory-file case. Fail-closed: an evidenceRef with no `#L` yields the whole
      // string as the relPath (still a deterministic, matchable value), never a silent skip.
      const scopeGlobs = c.scopePaths;
      const scopeRes =
        scopeGlobs && scopeGlobs.length > 0 ? scopeGlobs.map((g) => pathGlobToRe(g)) : null;
      const edgeRelPath = (e: (typeof graph.guardEdges)[number]): string => {
        const ref = e.evidenceRef ?? '';
        const hash = ref.indexOf('#L');
        return hash >= 0 ? ref.slice(0, hash) : ref;
      };
      const inScope = (e: (typeof graph.guardEdges)[number]): boolean =>
        scopeRes === null || scopeRes.some((re) => re.test(edgeRelPath(e)));
      const hits = graph.guardEdges.filter(
        (e) =>
          e.to === c.to &&
          (anyFrom || e.from === c.from || e.from.startsWith('file:')) &&
          inScope(e),
      );
      for (const hit of hits) {
        violations.push({
          constraintId: c.id,
          severity: c.severity,
          component: hit.from,
          evidenceType: 'staticAst',
          evidenceRef: hit.evidenceRef,
          observed: `forbidden edge ${hit.from} -> ${c.to} is present`,
          expected: `no ${anyFrom ? '' : `${c.from} -> `}${c.to} edge`,
        });
      }
    } else if (c.type === 'forbiddenEgress') {
      // RECONCILED (blocklist ∪ allowlist designs) — the extractor (extractors.ts#extractEgress) is
      // now a PURE detector: it emits a `type:'egress'` edge for EVERY resolved host, governed or
      // not, forbidden or not. This arm applies the constraint's POLICY over those edges, choosing
      // its mode from which fields the constraint declares:
      //
      //  - ALLOWLIST mode (B1, `governedHosts` declared): a hit is a violation when its host is NOT
      //    governed (`isGovernedHost` — exact match or proper subdomain of a governedHosts entry).
      //  - BLOCKLIST mode (back-compat, `to`/`forbiddenEgressHosts` declared, no governedHosts):
      //    a hit is a violation when its host EQUALS or is a subdomain of a forbidden host — `c.to`
      //    (the single historical field) UNIONED with `c.forbiddenEgressHosts` (a constraint may
      //    declare either or both; every entry is checked).
      //
      // `from` may be an explicit component/file id, or '*'/undefined = any component — the
      // `file:` pseudo-id catch-all (matching forbiddenDependency's shape above) ensures an
      // unattributable egress call is never silently dropped by a from-specific filter.
      implemented += 1;
      const anyFrom = !c.from || c.from === '*';
      const fromMatches = (from: string): boolean => anyFrom || from === c.from || from.startsWith('file:');
      const isAllowlistMode = Array.isArray(c.governedHosts) && c.governedHosts.length > 0;
      const egressHits = graph.guardEdges.filter((e) => e.type === 'egress' && fromMatches(e.from));

      if (isAllowlistMode) {
        const governedHosts = c.governedHosts ?? [];
        for (const hit of egressHits.filter((h) => !isGovernedHost(h.to, governedHosts))) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: hit.from,
            evidenceType: 'staticAst',
            evidenceRef: hit.evidenceRef,
            observed: `ungoverned egress ${hit.from} -> ${hit.to}`,
            expected: `egress only to a governed host (${governedHosts.join('|')}) or via the gateway`,
          });
        }
      } else {
        // BLOCKLIST mode — `c.to` (the historical single-host field) UNIONED with
        // `c.forbiddenEgressHosts` (the array field), so a constraint may use either shape.
        const forbidden = [...new Set([...(c.to ? [c.to] : []), ...(c.forbiddenEgressHosts ?? [])])];
        const isForbidden = (host: string): boolean =>
          forbidden.some((f) => host === f || host.endsWith(`.${f}`));
        for (const hit of egressHits.filter((h) => isForbidden(h.to))) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: hit.from,
            evidenceType: 'staticAst',
            evidenceRef: hit.evidenceRef,
            observed: `forbidden raw egress ${hit.from} -> ${hit.to} is present (a fetch/http.request to the provider host bypasses the SDK-import gate)`,
            expected: `no raw egress to ${forbidden.join('|')} (route provider traffic through the api-gateway choke point)`,
          });
        }
      }
    } else if (c.type === 'forbiddenPath' && c.path) {
      implemented += 1;
      const re = pathGlobToRe(c.path);
      for (const comp of graph.components) {
        if (re.test(comp.path)) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: comp.id,
            evidenceType: 'staticAst',
            evidenceRef: `${comp.path}#L${comp.line}`,
            observed: `component at forbidden path ${comp.path}`,
            expected: `no component under ${c.path}`,
          });
        }
      }
    } else if (c.type === 'forbiddenFile' && c.path) {
      // RAW-FILE forbidden-path (0.8.0). Sibling to forbiddenPath, but matches the constraint's `path`
      // glob against the RAW scanned-file set (`graph.coverage.scannedFiles`) rather than
      // `graph.components` — so a forbidden file is caught even when it extracts as 0 components (a
      // named-export `export class` file). This closes the "a new parallel `beta-provisioner.ts` written
      // as a named-export class evades forbiddenPath" gap. FAIL-CLOSED HONESTY: if the extractor did NOT
      // populate `scannedFiles` (a pre-0.8.0 graph, or a synthesized drift graph), this constraint is
      // recorded as `skipped` — NOT a silent pass. A skipped forbiddenFile does not count toward
      // `implemented`, so a blueprint whose ONLY constraint is a forbiddenFile against a scannedFiles-less
      // graph falls to the `implemented === 0` hard-violation (a green gate must mean something ran).
      const scanned = graph.coverage.scannedFiles;
      if (!scanned) {
        skipped += 1;
      } else {
        implemented += 1;
        const re = pathGlobToRe(c.path);
        for (const rel of scanned) {
          if (re.test(rel)) {
            violations.push({
              constraintId: c.id,
              severity: c.severity,
              component: `file:${rel}`,
              evidenceType: 'staticAst',
              evidenceRef: rel,
              observed: `file at forbidden path ${rel}`,
              expected: `no file under ${c.path}`,
            });
          }
        }
      }
    } else if (c.type === 'forbiddenPattern' && c.pattern) {
      // RAW-CONTENT forbidden-pattern (0.9.0). Sibling to forbiddenFile, one layer deeper: where
      // forbiddenFile matches a FILENAME glob against `coverage.scannedFiles`, forbiddenPattern
      // matches a CONTENT regex against the per-line scan the extractor recorded in
      // `coverage.patternScan` — catching mocked-data-in-an-otherwise-legit-file (a `Math.random()`
      // metric in a real route, a hardcoded `uptime: 99.9` constant) that no filename/import/egress
      // tooth can see. FAIL-CLOSED HONESTY: if the graph carries NO `patternScan`, or the scan never
      // included THIS constraint's pattern (a pre-0.9.0 graph, or a synthesized drift graph), the
      // constraint is recorded as `skipped` — NOT a silent pass. A skipped forbiddenPattern does not
      // count toward `implemented`, so a blueprint whose ONLY constraint is a forbiddenPattern
      // against such a graph falls to the `implemented === 0` hard-violation below (a green gate
      // must mean something ran). An optional `c.path` glob NARROWS which files' hits redden.
      const scan = graph.coverage.patternScan;
      if (!scan || !scan.patterns.includes(c.pattern)) {
        skipped += 1;
      } else {
        implemented += 1;
        const pathRe = c.path ? pathGlobToRe(c.path) : null;
        const hits = scan.hits.filter(
          (h) => h.pattern === c.pattern && (!pathRe || pathRe.test(h.file)),
        );
        for (const hit of hits) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: `file:${hit.file}`,
            evidenceType: 'staticAst',
            evidenceRef: `${hit.file}#L${hit.line}`,
            observed: `forbidden content pattern /${c.pattern}/ matched at ${hit.file}#L${hit.line}`,
            expected: `no match of /${c.pattern}/${c.path ? ` under ${c.path}` : ' in the scanned surface'}`,
          });
        }
      }
    } else if (c.type === 'behavioralInvariant') {
      // RUNTIME substance (substance-conformance). The `served-runtime` probe wrote
      // `behaviorObservation` graph nodes for this constraint's `behaviorRef`, one per distinct
      // stimulus (incl. >=1 HELD-OUT stimulus). Each observation node is encoded as:
      //   id:   `behavior:<behaviorRef>:<stimulusId>`
      //   type: `behaviorObservation`
      //   path: `<outputHash>|<oracleSatisfied 0|1>`   (the probe's recorded facts)
      // The constraint FAILS on either mock signature:
      //   (a) CONSTANT-FUNCTION — all observations share ONE outputHash (byte-identical output
      //       across distinct + held-out stimuli), the exact hello-world/mock signature.
      //   (b) ORACLE-VIOLATION — any observation recorded oracleSatisfied=0 (the deployed output
      //       violated its property-oracle on that stimulus).
      // FAIL-CLOSED: a behavioralInvariant naming no behaviorRef, or one with fewer than 2
      // observations, cannot prove input-conditioned variation → violation (never a silent pass).
      implemented += 1;
      const ref = c.behaviorRef;
      if (!ref) {
        violations.push({
          constraintId: c.id,
          severity: c.severity,
          component: c.id,
          evidenceType: 'runtimeProbe',
          evidenceRef: (blueprint.scope.paths ?? blueprint.scope.repositories).join(','),
          observed: 'behavioralInvariant declares no behaviorRef — no observation set to grade',
          expected: 'a behaviorRef naming a served-runtime observation set (>=2 stimuli)',
        });
      } else {
        const prefix = `behavior:${ref}:`;
        const obs = graph.components
          .filter((x) => x.type === 'behaviorObservation' && x.id.startsWith(prefix))
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (obs.length < 2) {
          violations.push({
            constraintId: c.id,
            severity: c.severity,
            component: c.id,
            evidenceType: 'runtimeProbe',
            evidenceRef: prefix,
            observed: `behaviorRef '${ref}' has ${obs.length} observation(s) — cannot prove input-conditioned variation`,
            expected: 'at least 2 served-runtime observations (distinct + held-out stimuli)',
          });
        } else {
          const parse = (comp: (typeof obs)[number]): { hash: string; oracle: boolean } => {
            const [hash = '', oracleFlag = '0'] = comp.path.split('|');
            return { hash, oracle: oracleFlag === '1' };
          };
          const parsed = obs.map(parse);
          // (a) constant-function: every observation shares one output hash.
          const distinctHashes = new Set(parsed.map((p) => p.hash));
          if (distinctHashes.size === 1) {
            violations.push({
              constraintId: c.id,
              severity: c.severity,
              component: c.id,
              evidenceType: 'runtimeProbe',
              evidenceRef: prefix,
              observed: `constant output across all ${obs.length} stimuli (single hash ${[...distinctHashes][0]?.slice(0, 12)}…) — the mock/constant-function signature`,
              expected: 'output that VARIES with input where the intent demands difference (a computing artifact, not a fixture)',
            });
          }
          // (b) oracle-violation: any observation failed its property oracle.
          for (let i = 0; i < obs.length; i++) {
            if (!parsed[i]!.oracle) {
              violations.push({
                constraintId: c.id,
                severity: c.severity,
                component: obs[i]!.id,
                evidenceType: 'runtimeProbe',
                evidenceRef: obs[i]!.id,
                observed: `observation ${obs[i]!.id} violated its property oracle (oracleSatisfied=0)`,
                expected: 'the deployed output satisfies the scenario property oracle for this stimulus',
              });
            }
          }
        }
      }
    } else {
      skipped += 1;
    }
  }

  // FAIL-CLOSED empty-evaluation floor (finding #1): a blueprint that ENFORCES NOTHING must not
  // score 100/pass. If zero enforcing constraints ran — an empty `constraints` array, or every
  // constraint fell into a not-yet-implemented `skipped` type — emit a hard violation so the
  // verdict is fail and the gate exits non-zero. A green gate must mean "something was proven",
  // never "nothing was checked" (the honest-reporting invariant / widen-only ratchet).
  if (implemented === 0) {
    violations.push({
      constraintId: '__no-enforcing-constraints__',
      severity: 'critical',
      component: blueprint.metadata.id,
      evidenceType: 'staticAst',
      evidenceRef: (blueprint.scope.paths ?? blueprint.scope.repositories).join(','),
      observed: `blueprint enforces nothing — ${blueprint.constraints.length} constraint(s), 0 implemented`,
      expected: 'at least one enforcing constraint (requiredComponent / requiredDependency / forbiddenDependency / forbiddenEgress / forbiddenPath / forbiddenFile / forbiddenPattern / behavioralInvariant)',
    });
  }

  violations.sort(compareViolations);
  const score = Math.max(
    0,
    violations.reduce((acc, v) => acc - SEVERITY_WEIGHT[v.severity], 100),
  );
  const verdict: 'pass' | 'fail' = violations.length === 0 ? 'pass' : 'fail';
  const graphBytes = stableStringify(graph);

  const summaryParts = [
    `${blueprint.constraints.length} constraint(s) evaluated`,
    `${violations.length} violation(s)`,
    `score ${score}`,
  ];
  if (skipped > 0) summaryParts.push(`${skipped} constraint type(s) not-yet-implemented (skipped, not passed)`);
  // legibility (finding): an all-info violation set yields score 100 but verdict fail — make the
  // fail reason explicit so `score 100` is never read as a pass.
  if (score === 100 && verdict === 'fail') summaryParts.push('FAIL despite score 100 (info-only or floor violations)');

  return {
    schemaVersion: '1',
    blueprintRef: `${blueprint.metadata.id}@${blueprint.metadata.version}`,
    ctRepoRevision: graph.ctRepoRevision,
    score,
    verdict,
    violations,
    evidenceRef: `architecture-graph.json@sha256:${sha256(graphBytes)}`,
    summary: summaryParts.join('; '),
    coverage: {
      extractor: graph.coverage.extractor,
      filesScanned: graph.coverage.filesScanned,
      unsupported: graph.coverage.unsupported,
    },
    // omit-not-empty: an absent repoName leaves the key OFF the report entirely, so the
    // canonical bytes (and every downstream hash) of a pre-B2 report are unchanged.
    ...(repoName !== undefined ? { repo: repoName } : {}),
  };
}
