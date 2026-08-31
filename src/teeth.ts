/**
 * teeth.ts — the mutation-refutability grader (the substance-conformance bundle).
 *
 * WHY THIS EXISTS
 * ---------------
 * `report.ts` already fails a blueprint that ENFORCES NOTHING (its `implemented===0`
 * fail-closed floor). But a blueprint carrying ONE `requiredComponent` the repo *already
 * satisfies* passes with score 100 — a TOOTHLESS green. A green verdict that no realistic
 * change could ever have reddened is a provenance/structure proof masquerading as a
 * substance proof (the exact drift the operator named: "the project looks mocked on each
 * deploy" — a byte-hash on a hello-world, one altitude up).
 *
 * THE DISCRIMINATING PROPERTY
 * ---------------------------
 * A constraint has TEETH iff there exists a REALISTIC ArchitectureGraph mutation that flips
 * its violation-contribution from GREEN (0 violations) to RED (>=1). An all-trivial blueprint
 * — every constraint TRIVIALLY_GREEN — is TOOTHLESS and must be REJECTED by `bce teeth`/gate.
 *
 * CORE INSIGHT (no semantics drift)
 * ---------------------------------
 * teeth.ts NEVER re-implements constraint semantics. It drives the already-verified
 * `evaluate()` from report.ts as its ORACLE: for each constraint it evaluates a
 * single-constraint blueprint SLICE against (a) the authored graph and (b) a per-type
 * minimally-mutated graph, and reads whether that constraint's own violations went 0 -> >=1.
 *
 * RED-TEAM HARDENING (all three honored)
 * --------------------------------------
 *  - INDETERMINATE is checked FIRST: a constraint governing a surface the extractor could not
 *    fully see (named in `graph.coverage.unsupported`) has UNKNOWABLE refutability and must
 *    NOT be called TRIVIALLY_GREEN. Honesty over a false green.
 *  - ADD-THEN-REMOVE PADDING is excluded structurally: a reddening mutation only REMOVES a real
 *    satisfier or ADDS the violating element a real bad PR would introduce. teeth NEVER credits
 *    "add a component then delete it"; a padding component the blueprint does not constrain
 *    contributes ZERO witnesses.
 *  - MEASURED not asserted: the recall-gate corpus (corpus.ts) includes hello-world / toothless /
 *    padding fixtures that MUST score as honest catches before any non-gameable claim stands.
 *
 * Pure module — no fs, no net, no wall-clock, no CT/Prisma import. Deterministic: witnesses
 * sorted by constraintId; byte-identical TeethReport for the same input (mirrors report.ts).
 */

import type { EngineeringBlueprint, Constraint, ConstraintType, ExtractionProfile } from './schema.js';
import type { ArchitectureGraph, ObservedComponent, ObservedEdge } from './graph.js';
import { evaluate } from './report.js';

/** Per-constraint refutability verdict. */
export enum ConstraintTeeth {
  /**
   * EXTRACTOR-REAL teeth: the constraint fires on the authored graph as-is (already-red — the
   * extractor genuinely recorded the violating evidence), or a reddening mutation for a class
   * whose injected evidence the real extractor observes flips the oracle. For `forbiddenPattern`
   * and `forbiddenDependency` a mutation-flip is NOT credited here (see EVALUATOR_REFUTABLE).
   */
  TOOTHED = 'TOOTHED',
  /**
   * The mutation flipped the oracle, but the witness is EVALUATOR-ONLY: the injected evidence (a
   * synthesized `patternScan` hit / import edge) is something the real extractor never recorded in
   * this tree, and `evaluate()` counts it by string identity — the regex is never applied to any
   * real content. That proves the EVALUATOR can refute the constraint if such evidence ever
   * appears; it is explicitly NOT evidence the constraint has real-world teeth (the measured
   * Class-A defect: a matchable literal ABSENT from the scanned source graded a free TOOTHED —
   * and even a provably-unsatisfiable regex like `(?!)` did, since the regex never runs). NOT a
   * falsification verdict: the evaluator IS refutable, so this never flips a blueprint to
   * `toothless`.
   */
  EVALUATOR_REFUTABLE = 'EVALUATOR_REFUTABLE',
  /** No realistic mutation could redden it in the authored blueprint's own frame. */
  TRIVIALLY_GREEN = 'TRIVIALLY_GREEN',
  /** Governs a surface the extractor could not fully see — refutability unknowable (honest). */
  INDETERMINATE = 'INDETERMINATE',
}

/** The refutability finding for one constraint. */
export interface RefutabilityWitness {
  constraintId: string;
  type: ConstraintType;
  verdict: ConstraintTeeth;
  /** the concrete reddening mutation (TOOTHED), why none exists (TRIVIALLY_GREEN), or why unanalyzable (INDETERMINATE). */
  mutation: string;
}

/** The whole-blueprint teeth verdict. */
export interface TeethReport {
  schemaVersion: '1';
  blueprintRef: string;
  witnesses: RefutabilityWitness[];
  /** count of constraints with EXTRACTOR-REAL teeth (already-red, or a non-manufactured-evidence mutation flip). */
  toothed: number;
  /** count of constraints whose only witness is evaluator-only (synthetic evidence) — NOT evidence of real teeth. */
  evaluatorRefutable: number;
  triviallyGreen: number;
  indeterminate: number;
  /**
   * `toothed` iff any constraint has extractor-real teeth. `evaluator-refutable` iff none do but
   * at least one is EVALUATOR_REFUTABLE — refutable in principle, zero positive substance
   * evidence (keeps the exit-0 class; NOT a falsification). `toothless` iff NO constraint is
   * TOOTHED or EVALUATOR_REFUTABLE (INDETERMINATE alone is not teeth — refutability is unproven)
   * — the sound falsification verdict, byte-unchanged.
   */
  verdict: 'toothed' | 'toothless' | 'evaluator-refutable';
  summary: string;
}

type Profile = ExtractionProfile;

/**
 * Count THIS constraint's own violations under `evaluate()` on graph `g`. Slice to a single
 * constraint so the report.ts `implemented===0` floor + its `__no-enforcing-constraints__`
 * synthetic violation never contaminate the count; filter by constraintId so that synthetic
 * floor violation (which carries a different constraintId) is excluded.
 */
function evalOne(blueprint: EngineeringBlueprint, c: Constraint, g: ArchitectureGraph, profile: Profile): number {
  const slice: EngineeringBlueprint = { ...blueprint, constraints: [c] };
  return evaluate(slice, g, profile).violations.filter((v) => v.constraintId === c.id).length;
}

/** Does any coverage.unsupported entry reference this string (substring, case-insensitive, either direction)? */
function isUnsupported(target: string | undefined, unsupported: string[]): boolean {
  if (!target) return false;
  const t = target.toLowerCase();
  return unsupported.some((u) => {
    const l = u.toLowerCase();
    return l.includes(t) || t.includes(l);
  });
}

/** The extraction profile evaluate() uses (matches its own default). */
function resolveProfile(blueprint: EngineeringBlueprint): Profile {
  // A blueprint's extraction.profile, if declared, selects route-handler vs plugin-surface semantics.
  // Absent → next-route-handler (evaluate()'s own backward-compatible default).
  // pass the DECLARED profile through (python-import-surface must not inherit the
  // route-handler D6 semantics); absent → next-route-handler (evaluate()'s default).
  return blueprint.extraction?.profile ?? 'next-route-handler';
}

/** Clone a graph shallowly with replaced components/edges/coverage (never mutate the input). */
function withGraph(
  g: ArchitectureGraph,
  parts: {
    components?: ObservedComponent[];
    guardEdges?: ObservedEdge[];
    coverage?: ArchitectureGraph['coverage'];
  },
): ArchitectureGraph {
  return {
    ...g,
    components: parts.components ?? g.components,
    guardEdges: parts.guardEdges ?? g.guardEdges,
    coverage: parts.coverage ?? g.coverage,
  };
}

// A concrete file path that MATCHES a simple glob — the exact file a real bad PR would add.
// Each `**` and `*` collapses to a literal segment/char (`x`), which pathGlobToRe accepts
// (a double-star-slash compiles to an optional-segments group that matches `x/`; a single
// star compiles to a no-slash span that matches `x`). NOTE: line comments, not a block
// comment — the glob examples contain star-slash sequences that would terminate a JSDoc.
function concretePathForGlob(glob: string): string {
  return glob.replace(/\*\*/g, 'x').replace(/\*/g, 'x') || 'forbidden/x.ts';
}

/**
 * Build ONE minimal realistic reddening mutation for a constraint of the given type, or return
 * `null` if no realistic mutation exists in this frame (→ TRIVIALLY_GREEN). Mutations only
 * REMOVE a real satisfier or ADD the exact violating element a real bad PR introduces — never
 * add-then-remove padding.
 */
function reddeningMutation(
  c: Constraint,
  g: ArchitectureGraph,
  profile: Profile,
): { g2: ArchitectureGraph; mutation: string } | null {
  switch (c.type) {
    case 'requiredComponent': {
      // Reddens by REMOVING every component of the required type (a real deletion a bad PR does).
      const target = c.component;
      if (!target) return null;
      const present = g.components.filter((x) => x.type === target);
      if (present.length === 0) return null; // already-absent handled as already-red upstream
      return {
        g2: withGraph(g, { components: g.components.filter((x) => x.type !== target) }),
        mutation: `remove all ${present.length} '${target}' component(s) — a real deletion reddens this required-component`,
      };
    }
    case 'requiredDependency': {
      // Reddens by REMOVING the satisfying provides/guards edges from the required components.
      // The edge-type derivation MUST mirror evaluate() (report.ts): the historical-D6 guards
      // semantics apply ONLY on the next-route-handler profile — on plugin-surface a stray
      // evidenceType:'tenantGuard' must NOT retarget to 'guards' (report.ts finding #3), or teeth
      // removes the wrong edge type (a no-op on the count) and mislabels a genuinely-toothed
      // constraint TRIVIALLY_GREEN → a spurious toothless REJECT. Thread the real profile through.
      const isHistoricalD6 =
        profile === 'next-route-handler' && (c.evidenceType === 'tenantGuard' || c.component === 'apiRouteHandler');
      const edgeType = isHistoricalD6 ? 'guards' : 'provides';
      const satisfying = g.guardEdges.filter((e) => e.type === edgeType);
      if (satisfying.length === 0) return null; // no satisfier to remove → already-red upstream or unwitnessable
      return {
        g2: withGraph(g, { guardEdges: g.guardEdges.filter((e) => e.type !== edgeType) }),
        mutation: `remove all ${satisfying.length} '${edgeType}' edge(s) — dropping the governed registration reddens this required-dependency`,
      };
    }
    case 'forbiddenDependency': {
      // Reddens by ADDING the exact forbidden edge a bad PR would introduce.
      const to = c.to;
      if (!to) return null;
      const from = !c.from || c.from === '*' ? (g.components[0]?.id ?? 'file:injected') : c.from;
      // 0.9.0 scopePaths-awareness (found by self-hosting — the engine gating its own tree): a
      // scopePaths-narrowed constraint only counts an edge whose from-FILE (evidenceRef relPath)
      // glob-matches a scope entry (see evaluate() in report.ts). The historical synthetic
      // evidenceRef 'teeth:injected' matches no real glob, so a genuinely-toothed scoped
      // constraint was spuriously labeled TRIVIALLY_GREEN. Mirror the forbiddenPattern mutation's
      // path-respecting discipline: inject the edge AT a concrete file inside the scope — the
      // exact in-scope file a real bad PR would edit.
      const scope0 = c.scopePaths?.[0];
      const injectedPath = scope0 ? concretePathForGlob(scope0) : 'teeth:injected';
      const injected: ObservedEdge = { from, to, type: 'imports', evidenceRef: `${injectedPath}#L1` };
      return {
        g2: withGraph(g, { guardEdges: [...g.guardEdges, injected] }),
        mutation: `add a forbidden edge ${from} -> ${to} — the exact drift a real bad PR introduces`,
      };
    }
    case 'forbiddenEgress': {
      // Reddens by ADDING a forbidden/ungoverned egress edge.
      const from = !c.from || c.from === '*' ? (g.components[0]?.id ?? 'file:injected') : c.from;
      // In blocklist mode add an edge to a forbidden host; in allowlist mode add an UNGOVERNED host.
      const forbiddenHost: string =
        c.to ?? c.forbiddenEgressHosts?.[0] ?? 'api.forbidden-provider.example';
      const injected: ObservedEdge = { from, to: forbiddenHost, type: 'egress', evidenceRef: 'teeth:injected#L1' };
      return {
        g2: withGraph(g, { guardEdges: [...g.guardEdges, injected] }),
        mutation: `add an egress edge ${from} -> ${forbiddenHost} — a raw provider call bypassing the gateway`,
      };
    }
    case 'forbiddenPath': {
      // Reddens by ADDING a component under the forbidden path.
      const p = c.path;
      if (!p) return null;
      const concrete = concretePathForGlob(p);
      const injected: ObservedComponent = {
        id: `teeth:injected:${concrete}`,
        type: 'injectedComponent',
        path: concrete,
        line: 1,
      };
      return {
        g2: withGraph(g, { components: [...g.components, injected] }),
        mutation: `add a component at forbidden path ${concrete} — a real file added under the banned path`,
      };
    }
    case 'forbiddenFile': {
      // Reddens by ADDING a raw scanned file matching the forbidden glob to coverage.scannedFiles —
      // the exact "someone lands a parallel beta-provisioner.ts as a named-export class" PR the
      // constraint exists to catch (a named-export file mints 0 components, so injecting a
      // COMPONENT — the forbiddenPath mutation above — would prove nothing here). Before 0.9.0
      // this type fell to the default → null → TRIVIALLY_GREEN (the grounded teeth gap): a
      // genuinely-toothed forbiddenFile blueprint was spuriously REJECTED as toothless.
      const p = c.path;
      if (!p) return null;
      const concrete = concretePathForGlob(p);
      return {
        g2: withGraph(g, {
          coverage: {
            ...g.coverage,
            scannedFiles: [...new Set([...(g.coverage.scannedFiles ?? []), concrete])].sort(),
          },
        }),
        mutation: `add a raw scanned file at forbidden path ${concrete} — a real named-export file landed under the banned glob reddens this forbiddenFile`,
      };
    }
    case 'forbiddenPattern': {
      // Reddens by ADDING a patternScan hit for this constraint's pattern — models the exact
      // "someone lands a Math.random() mock metric in a real route" PR the content tooth exists to
      // catch. The injected hit's file respects an optional `path` narrowing glob so the oracle
      // (evaluate()'s forbiddenPattern branch) actually fires.
      const pat = c.pattern;
      if (!pat) return null;
      const file = c.path ? concretePathForGlob(c.path) : 'teeth/injected.ts';
      const prior = g.coverage.patternScan;
      return {
        g2: withGraph(g, {
          coverage: {
            ...g.coverage,
            patternScan: {
              patterns: [...new Set([...(prior?.patterns ?? []), pat])].sort(),
              hits: [...(prior?.hits ?? []), { pattern: pat, file, line: 1 }],
            },
          },
        }),
        mutation: `add a content hit of /${pat}/ at ${file}#L1 — the exact mock-literal a real bad PR introduces reddens this forbiddenPattern`,
      };
    }
    case 'behavioralInvariant': {
      // Reddens by INJECTING a CONSTANT-OUTPUT observation set for this behaviorRef — the exact mock
      // signature a real "deploy a hello-world instead of a real app" PR produces. Two observations
      // sharing one output hash trip evaluate()'s constant-function detector → RED. This proves the
      // constraint has teeth: a mocked redeploy WOULD fail it.
      const ref = c.behaviorRef;
      if (!ref) return null; // a refless behavioralInvariant is already-red (handled upstream)
      const constHash = 'deadbeefconst';
      const mk = (stimulus: string): ObservedComponent => ({
        id: `behavior:${ref}:${stimulus}`,
        type: 'behaviorObservation',
        path: `${constHash}|1`, // oracle-satisfied, but byte-identical output = constant function
        line: 1,
      });
      // REPLACE this ref's observations with a constant-output set (a mocked redeploy flattens the
      // real varying output to a constant) — never append (appending to a varying set would leave the
      // hash-variety intact and fail to redden). This models the exact "swap the real app for a
      // hello-world" PR the constant-function detector exists to catch.
      const prefix = `behavior:${ref}:`;
      const withoutRef = g.components.filter((x) => !(x.type === 'behaviorObservation' && x.id.startsWith(prefix)));
      return {
        g2: withGraph(g, { components: [...withoutRef, mk('s1'), mk('s2-held-out')] }),
        mutation: `flatten behaviorRef '${ref}' to a constant-output set — a mocked (constant-function) redeploy reddens this behavioralInvariant`,
      };
    }
    default:
      // requiredEvidence / minimumMetric / customPolicy are not yet enforced by evaluate() (they
      // fall to its `skipped` branch), so a mutation cannot redden them through the oracle. They
      // are handled as INDETERMINATE by the caller, never mislabeled TRIVIALLY_GREEN.
      return null;
  }
}

/** Assess one constraint's teeth against the authored graph. */
function assessConstraint(
  blueprint: EngineeringBlueprint,
  c: Constraint,
  g: ArchitectureGraph,
  profile: Profile,
): RefutabilityWitness {
  const unsupported = g.coverage?.unsupported ?? [];

  // (1) INDETERMINATE FIRST — a constraint over an unsupported surface has unknowable refutability.
  const surfaceTargets = [c.component, c.path, c.to, ...(c.governedHosts ?? []), ...(c.forbiddenEgressHosts ?? [])];
  const unsupportedHit = surfaceTargets.find((t) => isUnsupported(t as string | undefined, unsupported));
  if (unsupportedHit) {
    return {
      constraintId: c.id,
      type: c.type,
      verdict: ConstraintTeeth.INDETERMINATE,
      mutation: `INDETERMINATE: governs an unsupported surface ('${unsupportedHit}' in coverage.unsupported) — refutability unknowable, not called trivial`,
    };
  }

  // The 3 not-yet-enforced constraint types can never be reddened through evaluate() → INDETERMINATE.
  if (c.type === 'requiredEvidence' || c.type === 'minimumMetric' || c.type === 'customPolicy') {
    return {
      constraintId: c.id,
      type: c.type,
      verdict: ConstraintTeeth.INDETERMINATE,
      mutation: `INDETERMINATE: '${c.type}' is declared-but-not-yet-enforced by evaluate() — teeth cannot witness it through the oracle`,
    };
  }

  // (2) already-red? A constraint that fires on the authored graph as-is is enforcing → TOOTHED.
  const baseline = evalOne(blueprint, c, g, profile);
  if (baseline > 0) {
    return {
      constraintId: c.id,
      type: c.type,
      verdict: ConstraintTeeth.TOOTHED,
      mutation: 'already-red: fires on the authored graph as-is (enforcing)',
    };
  }

  // (3) else construct ONE minimal realistic reddening mutation and check the oracle.
  const red = reddeningMutation(c, g, profile);
  if (!red) {
    return {
      constraintId: c.id,
      type: c.type,
      verdict: ConstraintTeeth.TRIVIALLY_GREEN,
      mutation: 'TRIVIALLY_GREEN: no realistic graph mutation reddens this constraint in the authored frame',
    };
  }
  const mutated = evalOne(blueprint, c, red.g2, profile);
  if (mutated > 0) {
    // THE HONESTY SPLIT (measured Class-A defect, 2026-08-23): for `forbiddenPattern` and
    // `forbiddenDependency` the mutation MANUFACTURES its own evidence — the injected
    // `patternScan` hit / import edge is something the real extractor never recorded in this
    // tree, and evaluate() counts it by string identity (the regex is never applied to any real
    // content — even `(?!)` graded TOOTHED). The oracle-flip therefore proves only that the
    // EVALUATOR can refute the constraint if such evidence appears. These two classes grade
    // EVALUATOR_REFUTABLE: explicitly not evidence. A TRUE TOOTHED for them remains available
    // ONLY through the extractor-real path — already-red (handled above, before any mutation).
    if (c.type === 'forbiddenPattern' || c.type === 'forbiddenDependency') {
      return {
        constraintId: c.id,
        type: c.type,
        verdict: ConstraintTeeth.EVALUATOR_REFUTABLE,
        mutation:
          `${red.mutation} — evaluator-only: the injected evidence is synthetic (the extractor ` +
          `recorded none in this tree), so this proves the EVALUATOR can refute the constraint, ` +
          `not that it has real-world teeth`,
      };
    }
    return { constraintId: c.id, type: c.type, verdict: ConstraintTeeth.TOOTHED, mutation: red.mutation };
  }
  return {
    constraintId: c.id,
    type: c.type,
    verdict: ConstraintTeeth.TRIVIALLY_GREEN,
    mutation: `TRIVIALLY_GREEN: the reddening mutation (${red.mutation}) did not flip the oracle — constraint cannot fail in this frame`,
  };
}

/**
 * Assess a whole blueprint's mutation-refutability. Three-way (the honesty split): `toothed` iff
 * any constraint has EXTRACTOR-REAL teeth; `evaluator-refutable` iff none do but at least one is
 * EVALUATOR_REFUTABLE (refutable in principle — explicitly NOT positive evidence); `toothless`
 * iff NO constraint is TOOTHED or EVALUATOR_REFUTABLE — every constraint is TRIVIALLY_GREEN or
 * INDETERMINATE, so a green run could never have been reddened by any realistic change
 * (INDETERMINATE alone is not teeth: an all-unsupported blueprint proves nothing, honestly).
 */
export function assessTeeth(
  blueprint: EngineeringBlueprint,
  graph: ArchitectureGraph,
  profile?: Profile,
): TeethReport {
  const prof = profile ?? resolveProfile(blueprint);
  const witnesses = blueprint.constraints
    .map((c) => assessConstraint(blueprint, c, graph, prof))
    .sort((a, b) => (a.constraintId < b.constraintId ? -1 : a.constraintId > b.constraintId ? 1 : 0));

  const toothed = witnesses.filter((w) => w.verdict === ConstraintTeeth.TOOTHED).length;
  const evaluatorRefutable = witnesses.filter(
    (w) => w.verdict === ConstraintTeeth.EVALUATOR_REFUTABLE,
  ).length;
  const triviallyGreen = witnesses.filter((w) => w.verdict === ConstraintTeeth.TRIVIALLY_GREEN).length;
  const indeterminate = witnesses.filter((w) => w.verdict === ConstraintTeeth.INDETERMINATE).length;
  const verdict: 'toothed' | 'toothless' | 'evaluator-refutable' =
    toothed > 0 ? 'toothed' : evaluatorRefutable > 0 ? 'evaluator-refutable' : 'toothless';

  // The old aggregate banner — "N/M constraint(s) have teeth" with evaluator-only flips counted in
  // N — is RETIRED: it laundered non-evidence into a scoreboard. The toothed banner now counts
  // extractor-real teeth ONLY and names the evaluator-refutable remainder as not-evidence.
  const evalTail =
    evaluatorRefutable > 0
      ? `; ${evaluatorRefutable} evaluator-refutable (synthetic-evidence mutations — NOT evidence of real teeth; substance proof = a mutation corpus)`
      : '';
  const summary =
    verdict === 'toothed'
      ? `${toothed}/${witnesses.length} constraint(s) have EXTRACTOR-REAL teeth (already-red, or a mutation whose evidence the real extractor records)` +
        evalTail
      : verdict === 'evaluator-refutable'
      ? `EVALUATOR-REFUTABLE: 0/${witnesses.length} constraint(s) have extractor-real teeth; ` +
        `${evaluatorRefutable} refutable by the evaluator alone (synthetic-evidence mutations — NOT evidence of real teeth; ` +
        `substance proof = a mutation corpus); ${triviallyGreen} trivially-green, ${indeterminate} indeterminate`
      : `TOOTHLESS: 0/${witnesses.length} constraint(s) can fail — ${triviallyGreen} trivially-green, ${indeterminate} indeterminate. A green verdict here proves nothing.`;

  return {
    schemaVersion: '1',
    blueprintRef: `${blueprint.metadata.id}@${blueprint.metadata.version}`,
    witnesses,
    toothed,
    evaluatorRefutable,
    triviallyGreen,
    indeterminate,
    verdict,
    summary,
  };
}
