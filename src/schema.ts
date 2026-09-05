/**
 * EngineeringBlueprintSchema — the authored, versioned blueprint artifact contract.
 *
 * A field-for-field Zod port of the v0.9 json-schema
 * (`07_contracts/schemas/engineering-blueprint.schema.json`). This is genuinely-new
 * primitive #1 of Blueprint Engineering: a declarative, human-reviewed, semver'd
 * source of a subsystem's INTENDED architecture — the thing the conformance diff runs
 * a repo's OBSERVED architecture against.
 *
 * Porting rules (so the Zod stays faithful to the json-schema):
 *  - top-level `additionalProperties: false` → `.strict()`
 *  - nested `additionalProperties: true`     → `.passthrough()`
 *  - `required` arrays → non-optional Zod fields; everything else `.optional()`
 *
 * This module is the SINGLE SOURCE OF TRUTH for the shape — never re-describe it from
 * a prose summary (the prompt summary omitted `intentRefs`, which the schema requires).
 */
import { z } from 'zod';
import { safeCompilePattern, UnsafePatternError } from './safe-regex.js';

/** Constraint kinds a blueprint can declare (json-schema `constraints[].type` enum). */
export const ConstraintTypeSchema = z.enum([
  'forbiddenDependency',
  'requiredDependency',
  'requiredComponent',
  'forbiddenPath',
  // A raw-FILE forbidden-path constraint (added 0.8.0). Distinct from `forbiddenPath`: forbiddenPath
  // matches a forbidden path only against EXTRACTED COMPONENTS (`graph.components[].path`), so on a
  // named-export surface that mints 0 components (e.g. service-beta's provisioning src — plain
  // `export class`/`export function`, no default/`*Extension` export) a forbiddenPath constraint is
  // STRUCTURALLY TOOTHLESS (it iterates an empty component set). `forbiddenFile` matches its `path`
  // glob against the RAW scanned-file set (`graph.coverage.scannedFiles`), so a forbidden file is
  // caught regardless of export shape — closing the "a new parallel `beta-provisioner.ts` written as
  // a named-export class evades forbiddenPath" gap (platform-beta-cell blueprint).
  // A `forbiddenFile` constraint against a graph whose extractor did NOT populate `scannedFiles`
  // (pre-0.8.0 graph, or the line-scan fallback if it omits the field) is recorded as `skipped`
  // honestly, never a silent pass. ADDITIVE (widen-only): the enum only GAINS a member; every existing
  // authored blueprint is unaffected (it cannot already contain this string). See `evaluate()` in report.ts.
  'forbiddenFile',
  // A raw provider-host egress constraint (fetch/http.request/axios/got to a provider HTTP host).
  // Distinct from forbiddenDependency: an SDK IMPORT carries an import edge; a raw `fetch(...)` to
  // `api.openai.com` carries NO import edge, so the import-graph never sees it. This constraint
  // targets the CALL-egress edge (`type:'egress'`) the AST extractor emits for a resolved-host
  // network call — closing a coverage gap first declared in a production blueprint's coverageNote: "A raw global
  // fetch() to a provider HTTP endpoint carries no import edge and is NOT caught by the
  // import-graph." RECONCILED (pure-detector redesign, 2026-07-20): the constraint supports TWO modes —
  //   - BLOCKLIST (`to` / `forbiddenEgressHosts` declared): an egress edge to a LISTED provider
  //     host is a violation (the original shape, back-compat).
  //   - ALLOWLIST (`governedHosts` declared): an egress edge to a host NOT in the allowlist is a
  //     violation (B1's shape — catches drift to an UNANTICIPATED host, not just a named one).
  // See `evaluate()` in report.ts for the mode-selection logic. ADDITIVE (widen-only): the enum
  // only GAINS a member, so every existing authored blueprint (which cannot already contain this
  // string) is unaffected.
  'forbiddenEgress',
  'requiredEvidence',
  'minimumMetric',
  'customPolicy',
  // A RUNTIME substance constraint (substance-conformance): the DEPLOYED artifact, driven with
  // >=2 distinct stimuli the intent says should produce DIFFERENT observable output, must actually
  // produce different output (the constant-function / mock detector) AND satisfy the scenario's
  // property oracle. Distinct from every static constraint above: it grades OBSERVED RUNTIME
  // behavior, not the source graph. Its facts come from a `served-runtime` probe (a separate runtime
  // observer, NOT a source extractor) written as `behaviorObservation` graph nodes. A ~11-line
  // hello-world whose output is byte-identical across all stimuli FAILS the constant-function check.
  // ADDITIVE (widen-only): the enum only GAINS a member; every existing authored blueprint is
  // unaffected (it cannot already contain this string). See `evaluate()` in report.ts.
  'behavioralInvariant',
  // A raw-CONTENT forbidden-pattern constraint (added 0.9.0). Distinct from every 0.8.0 tooth:
  // `forbiddenFile` matches a FILENAME glob against `coverage.scannedFiles`; `forbiddenDependency`
  // an IMPORT edge; `forbiddenEgress` a CALL-egress edge. None of them can see mocked-data-in-an-
  // otherwise-legit-file — a `Math.random()` metric planted in a REAL route, a hardcoded
  // `uptime: 99.9` constant in a REAL service (the surface-truth de-theatre
  // gap). `forbiddenPattern` evaluates the constraint's `pattern` regex
  // PER-LINE over the raw scanned-file set and records deterministic hits in
  // `coverage.patternScan` — so a mock literal is caught regardless of filename, export shape, or
  // import graph. FAIL-CLOSED at authoring time: a `forbiddenPattern` constraint MUST declare a
  // `pattern` AND `new RegExp(pattern)` must compile (see the ConstraintSchema superRefine) — an
  // invalid regex is a hard validation error, never a silent evaluate-time skip. FAIL-CLOSED at
  // evaluate time: against a graph whose extractor did NOT record `patternScan` for this pattern
  // (a pre-0.9.0 graph, or a synthesized drift graph) the constraint is recorded as `skipped`
  // honestly, never a silent pass. ADDITIVE (widen-only): the enum only GAINS a member; every
  // existing authored blueprint is unaffected (it cannot already contain this string). See
  // `evaluate()` in report.ts.
  'forbiddenPattern',
]);
export type ConstraintType = z.infer<typeof ConstraintTypeSchema>;

/**
 * Constraint types whose facts come from a RUNTIME observer (the `served-runtime` probe writing
 * `behaviorObservation` graph nodes), NOT from a source extractor. A static `bce gate` run has no
 * observations to grade these against — today that makes a behavioralInvariant blueprint
 * deterministically RED in gate mode (report.ts fail-closes on <2 observations, correctly, because
 * `bce run --observations` is the authoritative grader). FIX-B makes the gate's inability
 * FIRST-CLASS: gate mode SKIPS these constraints with an explicit advisory + count (widen-only
 * ratchet — an un-gradeable constraint is NEVER silently satisfied, and never silently failed
 * for evidence the mode structurally cannot have). DERIVED from `type` — no new authored field.
 */
export const RUNTIME_OBSERVATION_CONSTRAINTS: ReadonlySet<string> = new Set(['behavioralInvariant']);

/**
 * Pure classifier: which EVIDENCE CLASS grades a constraint of this type.
 *  - `behaviorObservation` — facts come from the served-runtime probe (`bce run --observations`);
 *    a static gate run cannot grade it (see RUNTIME_OBSERVATION_CONSTRAINTS above).
 *  - `staticAst` — facts come from the source extractor; gate mode grades it exactly as today.
 */
export function constraintEvidenceClass(type: ConstraintType): 'behaviorObservation' | 'staticAst' {
  return RUNTIME_OBSERVATION_CONSTRAINTS.has(type) ? 'behaviorObservation' : 'staticAst';
}

/** Severity ladder (json-schema `constraints[].severity` enum). Ordered low→high. */
export const SeveritySchema = z.enum(['info', 'low', 'medium', 'high', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

/** A declared architecture component (a node in the intended graph). */
export const ComponentSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    owner: z.string().optional(),
  })
  .passthrough();
export type Component = z.infer<typeof ComponentSchema>;

/** A declared allowed/forbidden relationship (an edge in the intended graph). */
export const RelationshipSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    type: z.string(),
    allowed: z.boolean(),
  })
  .passthrough();
export type Relationship = z.infer<typeof RelationshipSchema>;

/** A single conformance constraint the BCE evaluates against the observed graph. */
export const ConstraintSchema = z
  .object({
    id: z.string(),
    type: ConstraintTypeSchema,
    severity: SeveritySchema,
    from: z.string().optional(),
    to: z.string().optional(),
    component: z.string().optional(),
    path: z.string().optional(),
    /**
     * (forbiddenDependency — 0.9.0, OPTIONAL) repo-relative globs that RESTRICT which importer
     * files a `forbiddenDependency` arm inspects. When PRESENT (non-empty), a forbidden-import hit
     * is a violation ONLY if the edge's from-file (the relPath the edge was observed in) glob-matches
     * at least one entry here. Absent/empty → today's behavior (every importer counts, incl. the
     * `file:` catch-all for unattributable files). Globs use the same `**`/`*`/`?` semantics as
     * `forbiddenPath`/`forbiddenFile` (pathGlobToRe in report.ts). ADDITIVE (widen-only,
     * security-is-a-ratchet): a constraint omitting it is byte-unchanged; setting it can only
     * NARROW which importers fire. Motivating case: attach-one-flow-no-duplicate-handler must forbid
     * `./session-attach.js` imports ONLY from `src/tui/dashboard-route.tsx` + `src/tui/cycles-route.tsx`,
     * not from the index.ts barrel or the factory file (both import it legitimately and today trip
     * the `file:` catch-all).
     */
    scopePaths: z.array(z.string()).optional(),
    evidenceType: z.string().optional(),
    metric: z.string().optional(),
    minimum: z.number().optional(),
    policyRef: z.string().optional(),
    /**
     * (forbiddenEgress — ALLOWLIST mode) the set of governed host / host-suffixes an egress call
     * MAY target (e.g. `api-gateway`, `internal.example.com`). A resolved egress host that is NOT
     * in — or a proper subdomain of — this list is a violation. PRESENT (non-empty) → the
     * constraint runs in allowlist mode. Absent/empty → the constraint falls back to BLOCKLIST
     * mode (see `to` / `forbiddenEgressHosts` below) — see `evaluate()` in report.ts for the
     * mode-selection logic.
     */
    governedHosts: z.array(z.string()).optional(),
    /**
     * (forbiddenEgress) HTTP-client call symbols to detect as an egress edge, ADDITIONAL to the
     * extractor's own broad syntactic recognition (bare `fetch`/`axios`/`got`/`request`,
     * `http(s).request`, `axios.get|post|...`, `got.get|post|...`). Absent → the extractor's
     * broad default set only.
     */
    egressCallees: z.array(z.string()).optional(),
    /**
     * (forbiddenEgress — BLOCKLIST mode) the set of forbidden provider hosts an egress call MUST
     * NOT target. A resolved egress host that EQUALS — or is a subdomain of — any entry here (or
     * of the single `to` field) is a violation. Used when `governedHosts` is absent/empty; a
     * constraint may declare `to` (one host, the original shape), `forbiddenEgressHosts`
     * (several hosts), or both — every entry is checked.
     */
    forbiddenEgressHosts: z.array(z.string()).optional(),
    /**
     * (behavioralInvariant — substance-conformance) the id of the behavior-observation SET
     * this constraint grades. The `served-runtime` probe writes >=2 `behaviorObservation` graph
     * nodes tagged with this `behaviorRef` (one per distinct stimulus, incl. >=1 HELD-OUT stimulus
     * the author did not enumerate). The constraint FAILS if the observations are byte-identical
     * (constant-function / mock signature) OR if any observation's `oracleSatisfied` flag is false
     * (a property-oracle violation the probe recorded). Absent → the constraint refuses (fail-closed:
     * a behavioralInvariant that names no observation set can never pass).
     */
    behaviorRef: z.string().optional(),
    /** sha256 of the canonical runtime probe definition accepted for this invariant. */
    probeDefinitionHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    /** sha256 of the canonical ordered stimulus set accepted for this invariant. */
    stimulusSetHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    /** stable environment identity from which accepted observations must originate. */
    environmentId: z.string().min(1).optional(),
    /**
     * (forbiddenPattern — 0.9.0) the content regex this constraint forbids, evaluated PER-LINE
     * over the raw scanned-file set (`coverage.patternScan` — see graph.ts). REQUIRED (and must
     * compile via `new RegExp`) when `type === 'forbiddenPattern'` — enforced by the superRefine
     * below, so an invalid/missing pattern is a HARD authoring/validate error, never a silent
     * evaluate-time skip. An optional sibling `path` glob NARROWS which scanned files the pattern
     * may redden (e.g. only `src/app/api/**`); absent → every scanned file is in scope.
     */
    pattern: z.string().optional(),
  })
  .passthrough()
  /**
   * FAIL-CLOSED authoring floor for `forbiddenPattern` (0.9.0): the constraint MUST declare a
   * non-empty `pattern` AND the pattern MUST compile as a RegExp. Rejecting at validate/author
   * time (not evaluate time) means a typo'd regex can never silently reduce a blueprint's teeth
   * (widen-only ratchet — a gate can tighten, never silently relax). Other constraint types are
   * untouched (widen-only: every existing authored blueprint parses byte-identically).
   */
  .superRefine((c, ctx) => {
    if (c.type !== 'forbiddenPattern') return;
    if (typeof c.pattern !== 'string' || c.pattern.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: `forbiddenPattern constraint '${c.id}' MUST declare a non-empty 'pattern' regex (fail-closed: a pattern-less content constraint can enforce nothing).`,
      });
      return;
    }
    try {
      // safe-compile through the shared guard (length cap + catastrophic-backtracking reject +
      // bounded compile) — the pattern is author-supplied input that becomes a live RegExp run
      // per-line over the scanned surface (report.ts patternScan), so a non-compiling OR
      // ReDoS-shaped pattern is a HARD validation error here, never a silent evaluate-time skip
      // and never a live-DoS sink (js/regex-injection).
      safeCompilePattern(c.pattern);
    } catch (e) {
      const detail = e instanceof UnsafePatternError ? e.message : (e as Error).message;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pattern'],
        message: `forbiddenPattern constraint '${c.id}' has an INVALID or UNSAFE regex ${JSON.stringify(c.pattern)}: ${detail} (fail-closed: an invalid/ReDoS-shaped regex is a hard validation error, never a silent evaluate-time skip).`,
      });
    }
  });
export type Constraint = z.infer<typeof ConstraintSchema>;

export const EvidenceRequirementSchema = z
  .object({
    type: z.string(),
    required: z.boolean(),
    freshnessSeconds: z.number().int().optional(),
    minimumCoverage: z.number().optional(),
    producerPolicy: z.string().optional(),
    onMissing: z.enum(['unknown', 'block', 'warn']).optional(),
  })
  .passthrough();
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

export const ApprovalSchema = z
  .object({
    role: z.string(),
    stage: z.string(),
  })
  .passthrough();
export type Approval = z.infer<typeof ApprovalSchema>;

export const BlueprintMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
    status: z.enum(['draft', 'proposed', 'approved', 'deprecated', 'retired']),
    ownerRole: z.string().optional(),
    stewardRole: z.string().optional(),
  })
  .passthrough();
export type BlueprintMetadata = z.infer<typeof BlueprintMetadataSchema>;

/**
 * Blueprint scan paths are always repository-relative. Reject traversal at the
 * schema boundary so a reviewed contract cannot make files outside the target
 * repository contribute evidence. The extractor repeats the containment check
 * after realpath resolution as defense in depth against symlinks.
 */
const RepoRelativePathPatternSchema = z.string().min(1).superRefine((value, ctx) => {
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path must be repository-relative' });
  }
  if (normalized.split('/').includes('..')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "path must not contain '..' traversal" });
  }
  if (normalized.includes('\0')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'path must not contain NUL' });
  }
});

export const BlueprintScopeSchema = z
  .object({
    repositories: z.array(z.string()).min(1),
    paths: z.array(RepoRelativePathPatternSchema).optional(),
    environments: z.array(z.string()).optional(),
  })
  .passthrough();
export type BlueprintScope = z.infer<typeof BlueprintScopeSchema>;

export const BlueprintArchitectureSchema = z
  .object({
    components: z.array(ComponentSchema),
    relationships: z.array(RelationshipSchema),
  })
  .passthrough();
export type BlueprintArchitecture = z.infer<typeof BlueprintArchitectureSchema>;

/**
 * The extraction profile — which observed-graph extractor the BCE runs for this
 * blueprint, and the symbols it treats as component-defining / guard-defining.
 *
 * This is the generalization that makes the engine blueprint-DRIVEN rather than
 * hardcoded to one subsystem: instead of the extractor carrying `ONTOLOGY_ROUTE_GLOBS`
 * + `GUARD_SYMBOLS` as constants, the blueprint declares them. ADDITIVE + backward-
 * compatible: a blueprint with NO `extraction` block resolves to the `next-route-handler`
 * profile with the historical CT-ontology `requireTenant*` guard set — so the original
 * `control-tower-ontology` fixture validates and scores byte-identically (widen-only ratchet:
 * never break the proven walking-skeleton path).
 *
 *  - `profile: 'next-route-handler'` — the original: exported HTTP-verb functions in
 *    Next.js `route.ts` files are components; `guardSymbols` called (bare identifier) in a
 *    handler body are `guards` edges only when their imports resolve to `governedModules`.
 *  - `profile: 'plugin-surface'` — an agent-host ExtensionFactory surface: an exported
 *    extension factory (or a `pi.registerTool({...})` call) is a component; symbols in
 *    `requiredSymbols` called in the factory body are `provides` edges; `forbiddenImports`
 *    modules imported are `imports` edges (used by a forbiddenDependency constraint).
 *  - `profile: 'typescript-module-graph'` (widen-only, additive) — every scanned TS/JS module is
 *    a component and every statically named import is an `imports` edge. Constraints address
 *    targets with `module:<repo-path-or-glob>`, `package:<npm-root>`, or `builtin:<node-name>`.
 *    This profile is AST-only and fails closed on unresolved/computed imports that intersect a
 *    governed boundary; it does not claim transitive reachability or cycle detection.
 *  - `profile: 'python-import-surface'` (widen-only, additive) — a Python module surface: every
 *    scanned `.py` file is a `module:<dotted.path>` component of type `pythonModule`; absolute
 *    and relative import statements matching `forbiddenImports` (∪ every forbiddenDependency.to)
 *    are `imports` edges. `paths` is REQUIRED (there is no historical default glob set for
 *    Python). Supports forbiddenDependency / forbiddenFile / forbiddenPattern / forbiddenPath /
 *    requiredComponent; `forbiddenEgress` and `guardSymbols` are NOT supported — the gate/CLI
 *    refuse loudly. Single line-scan provider; see python-extractor.ts for the detected/missed
 *    import forms.
 *  - `profile: 'python-module-graph'` (widen-only, additive) — every scanned `.py` file is a
 *    `pythonModule` and every structured, statically declared import is a policy-independent
 *    direct edge. Explicit `pythonRoots` define import-name resolution; dynamic/reflected imports
 *    are located uncertainty and C2/C3 fail closed.
 */
export const ExtractionProfileSchema = z.enum([
  'next-route-handler',
  'plugin-surface',
  'typescript-module-graph',
  'python-import-surface',
  'python-module-graph',
]);
export type ExtractionProfile = z.infer<typeof ExtractionProfileSchema>;
/** First engine release whose parser/evaluator understands typescript-module-graph. */
export const TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION = '0.3.0';
/** First engine release whose parser/evaluator understands python-module-graph. */
export const PYTHON_MODULE_GRAPH_MIN_ENGINE_VERSION = '0.3.0';

export const BlueprintExtractionSchema = z
  .object({
    /** which extractor to run. Absent → 'next-route-handler' (historical default). */
    profile: ExtractionProfileSchema,
    /**
     * repo-relative file globs to scan. Absent → the historical CT-ontology route globs
     * (only valid with the next-route-handler profile). For plugin-surface, REQUIRED.
     * Simple `**` / `*` globs (no brace expansion) — resolved deterministically, sorted.
     */
    paths: z.array(RepoRelativePathPatternSchema).optional(),
    /**
     * symbols whose bare-identifier CALL inside a component body counts as a satisfied
     * `guards` (next-route-handler) or `provides` (plugin-surface) edge. Absent →
     * the historical requireTenant* guard set (next-route-handler only).
     */
    guardSymbols: z.array(z.string()).optional(),
    /**
     * (plugin-surface) module specifiers that, if IMPORTED by a scanned file, produce a
     * forbidden `imports` edge the blueprint's forbiddenDependency constraint can catch.
     */
    forbiddenImports: z.array(z.string()).optional(),
    /**
     * (plugin-surface) provider HTTP hosts that, if a scanned file makes a RAW egress call to
     * (`fetch('https://<host>/...')`, `http(s).request({host})`, `axios/got('https://<host>/...')`),
     * produce a forbidden `egress` edge the blueprint's `forbiddenEgress` constraint can catch.
     * Host match is a hostname-substring test on the URL string literal (`api.openai.com`,
     * `openrouter.ai`, `generativelanguage.googleapis.com`, …). Internal-service fetches
     * (`localhost`, `staging.example.com`) are NOT listed here, so they never false-fire — this is
     * the allowlist-safe boundary the coverageNote requires (reader scripts legitimately fetch internal service APIs).
     * A non-literal / computed URL is honestly un-analyzable → surfaced in `coverage.unsupported`,
     * never silently passed (mirrors the dynamic-import handling).
     */
    forbiddenEgressHosts: z.array(z.string()).optional(),
    /**
     * Module specifiers that provide GOVERNED helpers. A bare route guard or plugin registration
     * call is credited ONLY when its symbol is imported from one of these modules. Absent/empty →
     * a bare call is NEVER credited (plugin-surface may still prove governance through the explicit
     * `<harness>.registerTool(...)` property-access form).
     */
    governedModules: z.array(z.string()).optional(),
    /**
     * fail-closed floor: the scan MUST resolve at least this many files, else exit 2
     * (an empty/partial scan can never score 100). Absent → the count of resolved paths
     * for plugin-surface, or the historical route-file count for next-route-handler.
     */
    minFiles: z.number().int().positive().optional(),
    /**
     * (typescript-module-graph only) repository-relative tsconfig used for TypeScript module
     * resolution, including `baseUrl`/`paths` and `extends`. Absent means deterministic lexical
     * relative resolution; aliases, package imports (`#...`), and URLs are then unresolved facts.
     */
    tsconfig: RepoRelativePathPatternSchema.superRefine((value, ctx) => {
      if (/[*?]/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'tsconfig must be one repository-relative file, not a glob' });
      }
    }).optional(),
    /**
     * (python-module-graph only) explicit repo-relative Python import roots (`src`, `lib`, `.`).
     * Every scanned file must belong to exactly one root; globs and traversal are rejected.
     */
    pythonRoots: z.array(RepoRelativePathPatternSchema.superRefine((value, ctx) => {
      if (/[*?]/.test(value)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'pythonRoots entries are directories, not globs' });
      }
    })).optional(),
  })
  .strict();
export type BlueprintExtraction = z.infer<typeof BlueprintExtractionSchema>;

function validModuleTargetSelector(value: string | undefined): boolean {
  if (!value) return false;
  if (value.startsWith('module:')) {
    const target = value.slice('module:'.length).replace(/\\/g, '/');
    return target.length > 0 && !target.startsWith('/') && !/^[A-Za-z]:\//.test(target) &&
      !target.split('/').includes('..') && !target.includes('\0');
  }
  if (value.startsWith('package:')) {
    const target = value.slice('package:'.length);
    return /^(?:@[a-z0-9._~-]+\/[a-z0-9._~-]+|[a-z0-9._~-]+)$/.test(target);
  }
  if (value.startsWith('builtin:')) {
    return /^[a-z0-9_./-]+$/.test(value.slice('builtin:'.length));
  }
  return false;
}

/** Profile-specific fail-closed authoring rules for the policy-independent TS/JS graph. */
export function refineModuleGraphBlueprint(
  value: {
    extraction?: BlueprintExtraction | undefined;
    constraints: readonly Constraint[];
    minEngineVersion?: string | undefined;
  },
  ctx: z.RefinementCtx,
  requireMinimumEngineVersion = true,
): void {
  const extraction = value.extraction;
  const issue = (path: Array<string | number>, message: string): void => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  };
  if (!extraction) return;
  const profile = extraction.profile;
  const isTypeScript = profile === 'typescript-module-graph';
  const isPython = profile === 'python-module-graph';
  if (!isTypeScript && extraction.tsconfig !== undefined) {
    issue(['extraction', 'tsconfig'], 'tsconfig is only valid with typescript-module-graph');
  }
  if (!isPython && (extraction.pythonRoots ?? []).length > 0) {
    issue(['extraction', 'pythonRoots'], 'pythonRoots is only valid with python-module-graph');
  }
  if (!isTypeScript && !isPython) {
    return;
  }

  if (!extraction.paths || extraction.paths.length === 0) {
    issue(['extraction', 'paths'], `${profile} requires at least one path glob`);
  }
  if (typeof extraction.minFiles !== 'number') {
    issue(['extraction', 'minFiles'], `${profile} requires an explicit floor`);
  }
  if (isPython && (!extraction.pythonRoots || extraction.pythonRoots.length === 0)) {
    issue(['extraction', 'pythonRoots'], 'python-module-graph requires at least one explicit pythonRoot');
  }
  if (isTypeScript && (extraction.pythonRoots ?? []).length > 0) {
    issue(['extraction', 'pythonRoots'], 'pythonRoots is only valid with python-module-graph');
  }
  if (isPython && extraction.tsconfig !== undefined) {
    issue(['extraction', 'tsconfig'], 'tsconfig is only valid with typescript-module-graph');
  }
  if (requireMinimumEngineVersion) {
    const actual = value.minEngineVersion?.split('.').map(Number);
    const floorVersion = isPython
      ? PYTHON_MODULE_GRAPH_MIN_ENGINE_VERSION
      : TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION;
    const floor = floorVersion.split('.').map(Number);
    const belowFloor = !actual || floor.some((part, index) => {
      const priorEqual = floor.slice(0, index).every((prior, priorIndex) => prior === actual[priorIndex]);
      return priorEqual && (actual[index] ?? 0) < part;
    });
    if (belowFloor) {
      issue(
        ['minEngineVersion'],
        `${profile} requires minEngineVersion >=${floorVersion}`,
      );
    }
  }
  for (const field of ['guardSymbols', 'forbiddenImports', 'forbiddenEgressHosts', 'governedModules'] as const) {
    if ((extraction[field] ?? []).length > 0) {
      issue(['extraction', field], `component-profile policy must be absent or empty for ${profile}`);
    }
  }

  value.constraints.forEach((constraint, index) => {
    if (constraint.type === 'forbiddenEgress') {
      issue(
        ['constraints', index, 'type'],
        `forbiddenEgress is not supported by ${profile}; use a framework AST profile`,
      );
      return;
    }
    const componentType = isPython ? 'pythonModule' : 'typescriptModule';
    if (constraint.type === 'requiredComponent' && constraint.component !== componentType) {
      issue(['constraints', index, 'component'], `requiredComponent must declare ${componentType}`);
      return;
    }
    if (constraint.type !== 'requiredDependency' && constraint.type !== 'forbiddenDependency') return;
    if (constraint.type === 'requiredDependency' && constraint.component !== componentType) {
      issue(['constraints', index, 'component'], `requiredDependency must declare ${componentType}`);
    }
    if (constraint.type === 'forbiddenDependency' && constraint.from && constraint.from !== '*') {
      issue(
        ['constraints', index, 'from'],
        "forbiddenDependency source selection uses scopePaths; from must be absent or '*'",
      );
    }
    const targetValid = isPython
      ? Boolean(constraint.to) && (
          constraint.to!.startsWith('module:')
            ? validModuleTargetSelector(constraint.to)
            : /^package:[\p{ID_Start}_][\p{ID_Continue}_]*$/u.test(constraint.to!)
        )
      : validModuleTargetSelector(constraint.to);
    if (!targetValid) {
      issue(
        ['constraints', index, 'to'],
        isPython
          ? 'target must be module:<path-or-glob> or package:<python-import-root>'
          : 'target must be module:<path-or-glob>, package:<npm-root>, or builtin:<node-name>',
      );
    }
    if (!constraint.scopePaths || constraint.scopePaths.length === 0) {
      issue(['constraints', index, 'scopePaths'], 'dependency constraints require non-empty source paths');
    }
  });
}

/**
 * The authored EngineeringBlueprint. `.strict()` mirrors the json-schema's top-level
 * `additionalProperties: false` — an authored blueprint with an unknown top-level key
 * is a hard validation error (catches typos in the source-of-truth artifact).
 */
export const EngineeringBlueprintSchema = z
  .object({
    apiVersion: z.literal('blueprint-conformance/v1alpha1'),
    kind: z.literal('EngineeringBlueprint'),
    metadata: BlueprintMetadataSchema,
    // REQUIRED in v0.9 (min 1) — every blueprint traces to at least one business intent.
    intentRefs: z.array(z.string()).min(1),
    scope: BlueprintScopeSchema,
    architecture: BlueprintArchitectureSchema,
    // min 1 (finding #1) — a blueprint that declares zero constraints enforces nothing; reject it
    // at authoring time (symmetric with intentRefs.min(1)). A green gate must mean something was proven.
    constraints: z.array(ConstraintSchema).min(1),
    evidenceRequirements: z.array(EvidenceRequirementSchema),
    approvals: z.array(ApprovalSchema),
    /**
     * OPTIONAL extraction profile (the blueprint-driven generalization). Absent →
     * the historical next-route-handler / requireTenant* behavior, so the original
     * control-tower-ontology fixture is byte-unchanged. See ExtractionProfileSchema.
     */
    extraction: BlueprintExtractionSchema.optional(),
    /**
     * OPTIONAL minimum engine version (FIX-E b). A blueprint authored against a NEWER engine may
     * declare the engine floor it needs (e.g. it uses a constraint type this engine's enum does not
     * yet carry). The gate compares this against its own package version and emits a CLEAR score-0
     * "upgrade the pinned engine" report instead of a zod enum trace. Mirrors PortfolioMember's
     * `enginePin` semver-regex style. ADDITIVE (widen-only): a blueprint omitting it parses
     * byte-identically; `.strict()` means the field must live INSIDE the schema to be legal at all.
     */
    minEngineVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/, 'minEngineVersion must be semver x.y.z')
      .optional(),
    evolution: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/** Normative cross-field validator; the public ZodObject above remains API-compatible. */
export const ValidatedEngineeringBlueprintSchema = EngineeringBlueprintSchema.superRefine(refineModuleGraphBlueprint);

export type EngineeringBlueprint = z.infer<typeof EngineeringBlueprintSchema>;

/** Parse + validate an authored blueprint. Throws a ZodError on any violation. */
export function parseBlueprint(input: unknown): EngineeringBlueprint {
  return ValidatedEngineeringBlueprintSchema.parse(input);
}

/** The result of a GATE-MODE tolerant parse (see parseBlueprintTolerant). */
export interface TolerantBlueprintParse {
  blueprint: EngineeringBlueprint;
  /**
   * The constraint entries DROPPED because their `type` string is outside THIS engine's enum
   * (a NEWER blueprint gating an OLDER pinned engine). Empty on the fast (fully-valid) path.
   * Every entry here MUST surface as an explicit gate advisory — never a silent skip (widen-only
   * ratchet; explicit-over-implicit).
   */
  unknownConstraintsSkipped: { id: string; type: string }[];
}

/**
 * GATE-MODE tolerant parse (FIX-E a). `bce gate` runs a PINNED engine against blueprints that may
 * have been authored for a NEWER engine — a single unknown `constraints[].type` must not
 * whole-file parse-reject the blueprint (score-0 "failed to parse"), silently un-grading the N
 * constraints this engine DOES know. Semantics, deliberately NARROW:
 *
 *  1. STRICT parse first — a fully-valid artifact takes the exact `parseBlueprint` path
 *     (byte-transparent: the tolerant machinery only engages on failure).
 *  2. On failure, drop ONLY constraint entries whose `type` is a string outside the enum
 *     (unknown/newer type), then re-validate the remainder STRICTLY. Any OTHER malformation —
 *     bad metadata, bad scope, a malformed KNOWN constraint — still throws (fail-closed for
 *     real corruption; tolerance never widens past the unknown-type drop).
 *  3. If ALL constraints are unknown, that is a HARD parse failure (fail-closed: this engine can
 *     grade NOTHING in the blueprint — a green gate must mean something was proven, the honest-reporting invariant).
 *
 * `bce run` (cli.ts) keeps STRICT `parseBlueprint` — run is the authoritative grader; only the
 * pinned-engine gate gets the narrow tolerance.
 */
export function parseBlueprintTolerant(input: unknown): TolerantBlueprintParse {
  const strict = ValidatedEngineeringBlueprintSchema.safeParse(input);
  if (strict.success) {
    return { blueprint: strict.data, unknownConstraintsSkipped: [] };
  }

  // The failure must be unknown-constraint-shaped to earn tolerance; anything else rethrows.
  if (typeof input !== 'object' || input === null) throw strict.error;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.constraints)) throw strict.error;

  const knownTypes = new Set<string>(ConstraintTypeSchema.options);
  const kept: unknown[] = [];
  const skipped: { id: string; type: string }[] = [];
  for (const entry of raw.constraints) {
    const rec = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : null;
    const type = rec?.type;
    if (typeof type === 'string' && !knownTypes.has(type)) {
      skipped.push({ id: typeof rec?.id === 'string' ? rec.id : '(missing id)', type });
    } else {
      // known-typed or malformed — the strict re-parse below decides its fate (fail-closed).
      kept.push(entry);
    }
  }
  if (skipped.length === 0) throw strict.error; // failure was NOT caused by unknown constraint types
  if (kept.length === 0) {
    // fail-closed: an all-unknown blueprint is un-gradeable by this engine — hard parse failure.
    throw new Error(
      `all ${raw.constraints.length} constraint(s) have unknown types ` +
        `(${skipped.map((s) => s.type).join(', ')}) — fail closed: this engine can grade nothing ` +
        `in the blueprint; upgrade the pinned engine`,
    );
  }
  // Re-validate the remainder STRICTLY — real corruption elsewhere still throws.
  const blueprint = ValidatedEngineeringBlueprintSchema.parse({ ...raw, constraints: kept });
  return { blueprint, unknownConstraintsSkipped: skipped };
}

/* -------------------------------------------------------------------------- */
/* PortfolioBlueprint — the fleet-level authored artifact                     */
/* -------------------------------------------------------------------------- */

/**
 * ADDITIVE + WIDEN-ONLY (widen-only ratchet): everything below is a NEW kind. Nothing about
 * `EngineeringBlueprintSchema` changes — a 0.2.x-authored EngineeringBlueprint validates
 * byte-identically. The PortfolioBlueprint is the fleet-level source of truth a compiler
 * (`portfolio-compile.ts`) lowers into N per-repo EngineeringBlueprint overlays.
 */

/** Portfolio-level governance: the fleet version every member overlay inherits. */
export const PortfolioGovernanceSchema = z
  .object({
    /** the fleet governance version — becomes every compiled overlay's metadata.version. */
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version must be semver x.y.z'),
    /** days a member may lag the fleet enginePin before the sweep flags skew. */
    skewGraceDays: z.number().int().nonnegative(),
    /** the collector's fail-closed denominator floor (see portfolio-collect.ts). */
    minMembers: z.number().int().positive(),
  })
  .strict();
export type PortfolioGovernance = z.infer<typeof PortfolioGovernanceSchema>;

/** One fleet member — a consuming repo whose gate the portfolio governs. */
export const PortfolioMemberSchema = z
  .object({
    /** the repo identity (e.g. `example-org/service-alpha`) — the collector's join key. */
    repo: z.string().min(1),
    /**
     * the directory INSIDE the checkout the member's gate runs `--repo` at (a monorepo
     * member like `agent-host`). `.` = the checkout root. The compiler is repoDir-AWARE
     * but never path-PREFIXES (see portfolio-compile.ts — the F-L2-5 hazard).
     */
    repoDir: z.string().min(1).default('.'),
    /** the required-status-check context name the member's gate reports under. */
    checkContext: z.string().min(1),
    /** the engine version the member pins (skew measured against governance.version). */
    enginePin: z.string().regex(/^\d+\.\d+\.\d+$/, 'enginePin must be semver x.y.z'),
    /** where the pin is encoded in the member repo (how the sweep reads it back). */
    pinEncoding: z.enum(['workflow-literal', 'lockfile']),
    /** which extractor the member's gate runs. */
    extractor: z.enum(['ast', 'line-scan']),
  })
  .strict();
export type PortfolioMember = z.infer<typeof PortfolioMemberSchema>;

/**
 * The authored PortfolioBlueprint. `.strict()` everywhere — an authored fleet artifact with an
 * unknown key is a hard validation error (fail closed, same discipline as EngineeringBlueprint).
 *
 * `coverage.unsupported` is MANDATORY (the declared-honest-coverage invariant): portfolio membership requires a
 * DECLARED honest envelope — the author must name what the fleet gate can NOT see. A portfolio
 * that claims blanket coverage is rejected at authoring time, never discovered at sweep time.
 *
 * `extraction` is REQUIRED here (unlike the per-repo blueprint, where absence resolves to the
 * historical CT-ontology defaults): a fleet artifact silently inheriting one subsystem's
 * route-glob defaults across N repos would be an implicit default (explicit-over-implicit).
 */
export const PortfolioBlueprintSchema = z
  .object({
    apiVersion: z.literal('blueprint-conformance/v1alpha1'),
    kind: z.literal('PortfolioBlueprint'),
    // reuse the existing metadata shape (incl. the draft|proposed|approved|deprecated|retired status enum).
    metadata: BlueprintMetadataSchema,
    // REQUIRED min 1 — a fleet artifact traces to at least one business intent (same as EB).
    intentRefs: z.array(z.string()).min(1),
    governance: PortfolioGovernanceSchema,
    members: z.array(PortfolioMemberSchema).min(1),
    // fleet-wide constraints, reusing the EXISTING per-blueprint constraint element type verbatim.
    fleetConstraints: z.array(ConstraintSchema).min(1),
    // the shared extraction block (globs/guardSymbols/forbiddenImports/minFiles) every member overlay inherits.
    extraction: BlueprintExtractionSchema,
    /** MANDATORY declared honest envelope (the declared-honest-coverage invariant). */
    coverage: z
      .object({
        unsupported: z.array(z.string()).min(1),
      })
      .strict(),
  })
  .strict();

/** Normative portfolio cross-field validator; keeps PortfolioBlueprintSchema a public ZodObject. */
export const ValidatedPortfolioBlueprintSchema = PortfolioBlueprintSchema.superRefine((value, ctx) => {
    refineModuleGraphBlueprint(
      { extraction: value.extraction, constraints: value.fleetConstraints },
      ctx,
      false,
    );
    const profile = value.extraction.profile;
    if (profile !== 'typescript-module-graph' && profile !== 'python-module-graph') return;
    const floorVersion = profile === 'python-module-graph'
      ? PYTHON_MODULE_GRAPH_MIN_ENGINE_VERSION
      : TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION;
    value.members.forEach((member, index) => {
      const actual = member.enginePin.split('.').map(Number);
      const floor = floorVersion.split('.').map(Number);
      const belowFloor = floor.some((part, partIndex) => {
        const priorEqual = floor.slice(0, partIndex).every((prior, priorIndex) => prior === actual[priorIndex]);
        return priorEqual && (actual[partIndex] ?? 0) < part;
      });
      if (belowFloor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['members', index, 'enginePin'],
          message: `${profile} requires member enginePin >=${floorVersion}`,
        });
      }
    });
  });
export type PortfolioBlueprint = z.infer<typeof PortfolioBlueprintSchema>;

/** Parse + validate an authored portfolio. Throws a ZodError on any violation. */
export function parsePortfolioBlueprint(input: unknown): PortfolioBlueprint {
  return ValidatedPortfolioBlueprintSchema.parse(input);
}

/** The discriminated result of parsing an artifact whose kind is not known up front. */
export type AnyBlueprintParse =
  | { kind: 'EngineeringBlueprint'; value: EngineeringBlueprint }
  | { kind: 'PortfolioBlueprint'; value: PortfolioBlueprint };

/**
 * Discriminated parse over the two authored kinds. Tries the STRICT schema matching the artifact's
 * `kind` literal; an unknown/absent kind THROWS (fail closed — an unrecognized artifact must never
 * silently no-op through a gate; the honest-reporting invariant).
 */
export function parseAnyBlueprint(input: unknown): AnyBlueprintParse {
  const kind =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>).kind : undefined;
  if (kind === 'EngineeringBlueprint') {
    return { kind: 'EngineeringBlueprint', value: parseBlueprint(input) };
  }
  if (kind === 'PortfolioBlueprint') {
    return { kind: 'PortfolioBlueprint', value: parsePortfolioBlueprint(input) };
  }
  throw new Error(
    `parseAnyBlueprint: unknown blueprint kind ${JSON.stringify(kind)} — fail closed ` +
      `(expected 'EngineeringBlueprint' | 'PortfolioBlueprint')`,
  );
}
