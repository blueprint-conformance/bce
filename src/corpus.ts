/**
 * The seeded-architecture-defect corpus — the ground truth for measuring the
 * engine's RECALL.
 *
 * A seeded defect is a KNOWN architecture violation that a correct `bce run` MUST catch: a
 * route that bypasses `requireTenantAccess`, an extension importing a provider SDK directly,
 * a datastore written to from outside its owning service, a declared-but-deleted required component, and so on. Each
 * entry maps to a `constraintId` the engine emits and a MINIMUM `expectedSeverity` at which
 * catching it counts. `caughtDefect(defect, report)` answers, for one seeded defect, "did the
 * engine's ComplianceReport catch THIS specific defect at or above the expected severity?"
 *
 * This is the honest recall-measurement primitive: recall = |caught| / |SEEDED_CORPUS|. It is a
 * MATCHER over the engine's OWN re-derivable ComplianceReport output — it never fabricates a
 * verdict and never mutates a report (never claim what was not proven). A defect the report does not contain at the
 * expected severity is an honest MISS, never silently credited.
 *
 * Self-contained + deterministic: the corpus is a frozen constant; `caughtDefect` is a pure
 * predicate over (defect, report). No wall-clock, no randomness, no CT/Prisma import.
 */
import type { ComplianceReport } from './report.js';
import { SEVERITY_WEIGHT } from './report.js';
import type { Severity } from './schema.js';

/**
 * One planted architecture defect the engine is expected to catch.
 *
 *  - `id`               — a stable, unique corpus id (kebab).
 *  - `blueprintRef`     — the subsystem blueprint (`id@x.y.z`) the defect was planted in.
 *  - `constraintId`     — the constraint the engine emits when it catches this defect; a
 *                         report violation with this `constraintId` is the catch signal.
 *  - `description`      — a one-line human description of the planted defect.
 *  - `expectedSeverity` — the MINIMUM severity a matching violation must carry to count as
 *                         caught (a security defect caught only at `info` is not really caught).
 */
export interface SeededDefect {
  id: string;
  blueprintRef: string;
  /**
   * the fixture surface this defect is planted in — the recall join key. A bare dir name (e.g.
   * `drift-forbidden-import`) resolves under `fixtures/extension-surface/`; a
   * `<surfaceRoot>/<dir>` form (e.g. `egress-surface/drift-egress-provider-houseidiom`) resolves
   * under `fixtures/<surfaceRoot>/<dir>` — so the corpus can reference fixtures across more than
   * one surface root without every entry repeating the historical extension-surface prefix.
   */
  fixture: string;
  constraintId: string;
  description: string;
  expectedSeverity: Severity;
}

/**
 * The seeded corpus. Realistic, engine-mappable defects across the two extraction profiles the
 * engine serves (next-route-handler CT/route surface + plugin-surface surface). Each `constraintId`
 * is one the engine actually emits, so a defect is caught iff the report carries a violation with
 * that id at/above the expected severity.
 *
 * Frozen (readonly) so a caller cannot mutate the ground truth mid-measurement — the corpus IS the
 * denominator, and a mutated denominator is a dishonest recall number.
 */
export const SEEDED_CORPUS: readonly SeededDefect[] = Object.freeze([
  // Every entry references a REAL fixture dir under fixtures/extension-surface/ + a REAL constraintId
  // the luna-chat-extension blueprint emits, so the corpus is measurable against the REAL engine
  // (evaluate()/runGate() over the fixture) — never a synthetic report. corpus.test.ts asserts each
  // fixture resolves on disk, so a dangling reference fails CI instead of silently zeroing recall.
  {
    id: 'ext-direct-openai-import',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-forbidden-import',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin imports the openai SDK directly instead of routing through the gateway',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-reexport-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-reexport',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin re-exports the openai SDK (export … from) — a provider reach via re-export',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-dynamic-import-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-dynamic-import',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin reaches openai via a dynamic import() — the async-import bypass',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-ungoverned-registration',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-no-register',
    constraintId: 'ext-registers-through-governed-path',
    description: 'the plugin does not register through the governed registerTool path',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-shadowed-harness-decoy',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-shadow-harness',
    constraintId: 'ext-registers-through-governed-path',
    description: 'the plugin registers via a same-name decoy that shadows the harness parameter (ungoverned)',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-decoy-registration',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-decoy-register',
    constraintId: 'ext-registers-through-governed-path',
    description: 'the plugin registers via a decoy object .registerTool (not the governed harness)',
    expectedSeverity: 'critical',
  },
  // egress surface — the realistic drift shape (the capability-transparency concern): a
  // reader using the EXACT house-idiom fallback-chain-then-fetch pattern, but whose baked-in
  // DEFAULT resolves to an ungoverned provider host instead of the gateway/localhost.
  {
    id: 'ext-ungoverned-egress-provider',
    blueprintRef: 'egress-reader@0.1.0',
    fixture: 'egress-surface/drift-egress-provider-houseidiom',
    constraintId: 'reader-egress-governed-only',
    description: 'the reader egresses to an ungoverned provider host via the house-idiom ||-chain default, bypassing the gateway',
    expectedSeverity: 'critical',
  },
  // coverage-envelope Class A #1 — the OPTIONS-BAG egress form. `https.request({ hostname:
  // 'api.openai.com' })` names the provider host via an options-object property, NOT a URL string
  // arg — a shape a naive scan detects as a callee but cannot resolve to a host (silently uncaught).
  {
    id: 'ext-ungoverned-egress-optbag',
    blueprintRef: 'egress-reader@0.1.0',
    fixture: 'egress-surface/drift-egress-optbag',
    constraintId: 'reader-egress-governed-only',
    description: 'the reader egresses to an ungoverned provider host via the http(s).request options-bag {hostname} form',
    expectedSeverity: 'critical',
  },
  // coverage-envelope Class A #2 — the undici DISPATCHER CONSTRUCTOR egress form. `new
  // undici.Client('https://api.openai.com')` bakes the host into a NewExpression that a
  // CallExpression-only scan never visits — a provider reach with zero disclosure.
  {
    id: 'ext-ungoverned-egress-undici-client',
    blueprintRef: 'egress-reader@0.1.0',
    fixture: 'egress-surface/drift-egress-undici-client',
    constraintId: 'reader-egress-governed-only',
    description: 'the reader egresses to an ungoverned provider host via a new undici.Client(literal-url) dispatcher constructor',
    expectedSeverity: 'critical',
  },
  /* ------------------------------------------------------------------------ */
  /* Corpus expansion N=9 → N=25 (suite-v2 corpus-expansion design).
   * APPEND-ONLY: the 9 entries above are the paper-cited baseline set — their ids,
   * fixtures, constraint ids, and severities are the stable join keys to the frozen
   * paper corpus (see corpus/CORPUS-MAP.md).
   *
   * Route surface — the missing-tenant-guard block (route-guard@0.1.0,
   * next-route-handler profile) + the forbiddenPath/forbiddenFile/forbiddenPattern
   * teeth, previously unmeasured by the corpus. */
  {
    id: 'rg-missing-tenant-guard',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-missing-guard',
    constraintId: 'd6-tenant-guard',
    description: 'tenant route POST validates+queries with NO tenant-guard call — missing function-level access control (CWE-306)',
    expectedSeverity: 'critical',
  },
  {
    id: 'rg-unguarded-new-route',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-unguarded-new-route',
    constraintId: 'd6-tenant-guard',
    description: 'a NEW parallel route ships GET+POST with zero guard calls beside guarded neighbors — the incident-observed fleet shape',
    expectedSeverity: 'critical',
  },
  {
    id: 'rg-decoy-guard-local',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-decoy-guard',
    constraintId: 'd6-tenant-guard',
    description: 'handler calls auth.requireTenantAccess (same-name property-access decoy, not the bare imported guard)',
    expectedSeverity: 'critical',
  },
  {
    id: 'rg-legacy-route-path',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-legacy-route',
    constraintId: 'no-legacy-route-path',
    description: 'a guarded route placed under the forbidden src/app/api/legacy/** path (forbiddenPath arm, first corpus exercise)',
    expectedSeverity: 'high',
  },
  {
    id: 'rg-shadow-provisioner-file',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-shadow-provisioner',
    constraintId: 'no-parallel-provisioner-file',
    description: 'a parallel *-provisioner.ts authored as a named-export class (0 components) — caught via coverage.scannedFiles only',
    expectedSeverity: 'high',
  },
  {
    id: 'rg-mocked-metric-pattern',
    blueprintRef: 'route-guard@0.1.0',
    fixture: 'route-surface/drift-mock-metric',
    constraintId: 'no-mocked-metrics',
    description: 'a guarded route returns a mocked Math.random() metric — caught via coverage.patternScan at the exact file#line',
    expectedSeverity: 'high',
  },
  /* Extension surface — the unrecognizable-factory TRI-SEED (one existing fixture, three real
   * consequences of the one planted defect; leaving any unseeded would make the fixture's honest
   * report a false-positive under measureRecall's cried-wolf rule). */
  {
    id: 'ext-unrecognizable-factory',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-unrecognized-factory',
    constraintId: 'ext-must-be-recognizable',
    description: 'file with a non-name-recognized factory extracts 0 pluginSurface components — the requiredComponent arm fires',
    expectedSeverity: 'high',
  },
  {
    id: 'ext-unrecognizable-forbidden-import',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-unrecognized-factory',
    constraintId: 'no-direct-provider-sdk',
    description: 'the forbidden openai import is caught via the file: pseudo-component even without a recognized factory',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-unrecognizable-zero-targets',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-unrecognized-factory',
    constraintId: 'ext-registers-through-governed-path',
    description: 'requiredDependency over ZERO target components is NOT vacuously satisfied — the fail-closed zero-targets arm',
    expectedSeverity: 'critical',
  },
  /* Behavior surface — the observation-GRADING arm (served-behavior@0.1.0), honestly scoped:
   * these grade RECORDED probe artifacts merged through the real fail-closed --observations
   * path; the live probe itself is outside the fixture corpus's measurement scope. */
  {
    id: 'bhv-constant-function',
    blueprintRef: 'served-behavior@0.1.0',
    fixture: 'behavior-surface/drift-constant-output',
    constraintId: 'served-output-varies-with-input',
    description: 'all recorded observations share ONE outputHash across distinct+held-out stimuli — the mock/constant-function signature',
    expectedSeverity: 'critical',
  },
  {
    id: 'bhv-oracle-violation',
    blueprintRef: 'served-behavior@0.1.0',
    fixture: 'behavior-surface/drift-oracle-violation',
    constraintId: 'served-output-varies-with-input',
    description: 'one recorded observation violated its property oracle (oracleSatisfied=0) with distinct hashes — the oracle branch, isolated',
    expectedSeverity: 'critical',
  },
  /* Evasion promotions — five existing, engine-regression-tested drift
   * fixtures promoted into the measured set: evasion-shape DEPTH inside already-covered types. */
  {
    id: 'ext-require-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-require',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin reaches openai via CommonJS require() — the require-form bypass',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-require-template-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-require-template',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin reaches openai via require(`openai`) — the template-literal require specifier',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-dynamic-template-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-dynamic-template',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin reaches openai via import(`openai`) — the template-literal dynamic-import specifier',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-stray-register',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-stray-register',
    constraintId: 'ext-registers-through-governed-path',
    description: 'the factory body never registers; a stray registration sits OUTSIDE it (not credited — fail-closed)',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-ungoverned-registry-import',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-ungoverned-import',
    constraintId: 'ext-registers-through-governed-path',
    description: 'bare registerTool imported from an UNGOVERNED module — ungoverned provenance is not credited',
    expectedSeverity: 'critical',
  },
  // python surface (B1 python-import-surface) — the first non-TypeScript corpus arm: the same
  // gateway-choke-point drift class expressed in Python, plus the committed-secret classes the
  // profile catches via scannedFiles (forbiddenFile) and patternScan (forbiddenPattern).
  {
    id: 'py-direct-openai-import',
    blueprintRef: 'python-service@0.1.0',
    fixture: 'python-surface/drift-forbidden-import',
    constraintId: 'no-direct-provider-sdk',
    description: 'the python service imports the openai SDK directly instead of routing through the gateway client',
    expectedSeverity: 'critical',
  },
  {
    id: 'py-committed-secrets-module',
    blueprintRef: 'python-service@0.1.0',
    fixture: 'python-surface/drift-secrets-file',
    constraintId: 'no-committed-secrets-module',
    description: 'a secrets.py module is committed on the scanned surface (forbiddenFile over scannedFiles)',
    expectedSeverity: 'high',
  },
  {
    id: 'py-hardcoded-provider-key',
    blueprintRef: 'python-service@0.1.0',
    fixture: 'python-surface/drift-hardcoded-key',
    constraintId: 'no-hardcoded-provider-key',
    description: 'a provider API key literal is hardcoded in source (forbiddenPattern over patternScan)',
    expectedSeverity: 'high',
  },
  // corpus v3 (B2) — syntactic-bypass forms the extractors support but no defect exercised:
  // the import-equals + subpath reach on the extension surface, the new-URL const-hop +
  // fully-qualified-global egress forms, and the aliased + parenthesized python imports.
  {
    id: 'ext-import-equals-openai',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-import-equals',
    constraintId: 'no-direct-provider-sdk',
    description: 'the plugin reaches the openai SDK via import-equals-require (import X = require(...))',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-subpath-openai-import',
    blueprintRef: 'luna-chat-extension@0.1.0',
    fixture: 'drift-subpath-import',
    constraintId: 'no-direct-provider-sdk',
    description: "the plugin imports a provider SUBPATH ('openai/uploads') — the prefix-match bypass",
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-ungoverned-egress-new-url',
    blueprintRef: 'egress-reader@0.1.0',
    fixture: 'egress-surface/drift-egress-new-url',
    constraintId: 'reader-egress-governed-only',
    description: 'the ungoverned provider host is baked into new URL(...) reached via a same-file const hop',
    expectedSeverity: 'critical',
  },
  {
    id: 'ext-ungoverned-egress-globalthis',
    blueprintRef: 'egress-reader@0.1.0',
    fixture: 'egress-surface/drift-egress-globalthis',
    constraintId: 'reader-egress-governed-only',
    description: 'the ungoverned provider is reached via the fully-qualified globalThis.fetch(...) form',
    expectedSeverity: 'critical',
  },
  {
    id: 'py-aliased-openai-import',
    blueprintRef: 'python-service@0.1.0',
    fixture: 'python-surface/drift-aliased-import',
    constraintId: 'no-direct-provider-sdk',
    description: 'the python service imports the provider SDK under an alias (import openai as oa)',
    expectedSeverity: 'critical',
  },
  {
    id: 'py-paren-from-import',
    blueprintRef: 'python-service@0.1.0',
    fixture: 'python-surface/drift-paren-from-import',
    constraintId: 'no-direct-provider-sdk',
    description: 'the provider import hides in a parenthesized multi-line from-import',
    expectedSeverity: 'critical',
  },
]);

/** Ordered low→high severity comparison via the engine's own SEVERITY_WEIGHT (single source). */
function severityAtLeast(actual: Severity, floor: Severity): boolean {
  return SEVERITY_WEIGHT[actual] >= SEVERITY_WEIGHT[floor];
}

/**
 * Did `report` catch THIS specific seeded defect?
 *
 * True iff the report contains at least one violation whose `constraintId` equals the defect's
 * `constraintId` AND whose `severity` is at or above the defect's `expectedSeverity`. A violation
 * of the same constraint at too-low a severity does NOT count (a security defect must be caught at
 * its real severity, not downgraded). Pure predicate — reads the report, never mutates it.
 */
export function caughtDefect(defect: SeededDefect, report: ComplianceReport): boolean {
  // a defect is caught ONLY when the violation fires under the SUBSYSTEM it was planted in
  // (finding: matching on constraintId alone credits a catch under a DIFFERENT blueprint — a
  // recall-inflation vector). The report's blueprintRef must equal the defect's.
  if (report.blueprintRef !== defect.blueprintRef) return false;
  return report.violations.some(
    (v) => v.constraintId === defect.constraintId && severityAtLeast(v.severity, defect.expectedSeverity),
  );
}
