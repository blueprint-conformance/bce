/**
 * `bce` — the Blueprint Conformance Engine CLI (walking skeleton).
 *
 *   bce validate --blueprint <path>
 *       Zod-validate an authored EngineeringBlueprint. Exit 0 = VALID.
 *
 *   bce author --id <id> --intent-ref <ref> --constraint "<type>:<arg>[:<severity>]" ...
 *       (alias: bce init) Model-agnostic, interactive-free scaffold generator: flags in,
 *       schema-VALID draft blueprint out (status `draft`, version 0.1.0). Self-validates
 *       through the STRICT schema (round-trip on the WRITTEN artifact) and, when --repo
 *       is given, runs a scan-based sanity (scope must match >= 1 file — exit 2 else).
 *       No LLM, no network. See the usage footer for the full flag set + constraint grammar.
 *
 *   bce propose --repo <dir> --intent-file <path> --assistant openai-responses
 *       --assistant-model <exact> (--base <path> | --new)
 *       Send a bounded, disclosed repository context to one registered assistant adapter, then
 *       deterministically compile and inspect its draft. Writes only to a quarantined proposal
 *       directory. It never approves, ratifies, amends, or writes governed policy.
 *
 *   bce review show|verify|decide --packet <review-packet.json> ...
 *       Render and replay the immutable review packet. `decide` records an authenticated human
 *       decision beside it; policy landing remains a separate, packet-bound ceremony.
 *
 *   bce scan --ct-repo <dir> [--ref <sha|ref>] [--extractor ast|line-scan] --out <path>
 *       Materialize the target repo at a pinned revision, build the observed
 *       architecture-graph.json. Fail-closed: fewer than the expected route files → exit 2.
 *
 *   bce run --blueprint <path> --ct-repo <dir> [--ref <sha|ref>] [--extractor ast|line-scan] --out <path>
 *       validate → scan → diff → deterministic ComplianceReport. Exit 0 pass / 1 fail.
 *
 * "Executable" means precisely this: a repo can be RUN against a blueprint to yield a
 * scored, evidenced, re-derivable verdict. No tenant, no runtime, no HTTP — a static
 * pass over a frozen git tree.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseBlueprint,
  parsePortfolioBlueprint,
  ConstraintTypeSchema,
  SeveritySchema,
  ExtractionProfileSchema,
  PYTHON_MODULE_GRAPH_MIN_ENGINE_VERSION,
  TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION,
  type BlueprintExtraction,
  type Component,
  type Constraint,
  type EngineeringBlueprint,
  type Relationship,
  type Severity,
} from './schema.js';
import { resolveExtraction, type ResolvedExtraction } from './extractors.js';
import { makeExtractor } from './extractor-registry.js';
import { safeCompilePattern, UnsafePatternError } from './safe-regex.js';
import { evaluate, stableStringify, type ComplianceReport } from './report.js';
import { assessTeeth, type TeethReport } from './teeth.js';
import { assessExtractorTeethCorpus } from './extractor-teeth.js';
import { readTeethWaiver, TeethWaiverError, TEETH_WAIVER_RELPATH } from './teeth-waiver.js';
import { resolveRevision, materializeAtRevision } from './pin.js';
import { runGate, assembleGateReportDoc } from './gate.js';
import {
  resolveMode,
  exitCodeForGate,
  appendGraduationRecord,
  writeModeConfig,
  readGraduationRecord,
  ADVISORY_BANNER,
  MODE_CONFIG_BASENAME,
  GRADUATION_RECORD_RELPATH,
  ModeConfigError,
  type GateMode,
} from './mode.js';
import {
  readBaseline,
  planBaselineWrite,
  assessBaselineMaintenance,
  renderBaselineShrinkPatch,
  writeBaseline,
  partitionAgainstBaseline,
  BaselineError,
  BASELINE_RELPATH,
} from './baseline.js';
import { resolveEngineVersion } from './gate.js';
import { renderViolations } from './violation-format.js';
import { emitRun, EVIDENCE_GENESIS_HASH } from './emit.js';
import { compilePortfolio, serializeBlueprintCanonical, slugifyRepo } from './portfolio-compile.js';
import { collectPortfolio, PortfolioRegistrySchema } from './portfolio-collect.js';
import { architectureScore } from './score.js';
import type { ArchitectureGraph, ObservedComponent } from './graph.js';
import { loadObservations, observationBinding } from './observations.js';
import { doctorRepository, checkEngineUpgrade } from './lifecycle.js';
import { ratifyBlueprint, amendBlueprint, PolicyHistoryError, type PolicyHistoryEntry } from './policy-history.js';
import { createEvidenceBundle, verifyEvidenceBundle, type EvidenceBundle } from './evidence-bundle.js';
import { resolveToolchainIdentity } from './runtime-identity.js';
import {
  BlueprintDecisionRecordSchema,
  BlueprintReviewPacketSchema,
  type BlueprintDecisionRecord,
  type BlueprintReviewPacket,
} from './review-contracts.js';
import {
  buildReviewPacket,
  compileDraftPlan,
  reviewDigest,
  verifyReviewPacket,
} from './review.js';
import { renderReviewPacketHtml, renderReviewPacketText } from './review-render.js';
import { buildDisclosureManifest, createRegisteredAssistant } from './assistant-adapter.js';
import {
  authenticateGitHubDecision,
  reauthenticateGitHubDecision,
  type GitHubReviewSelector,
} from './scm-review.js';
import {
  DEFAULT_PROPOSAL_OUT,
  DEFAULT_GOVERNED_DIRS,
  collectProposalContext,
  collectRepositoryPolicyDiff,
  createProposalStagingDirectory,
  finalizeProposalDirectory,
  prepareQuarantineRoot,
  resolveProposalInput,
  snapshotRepository,
  writeProposalFile,
} from './proposal-io.js';

// Reviewed upstream Action commits. Generated workflows execute these exact objects;
// the major versions are comments for human update tooling, never executable refs.
const CHECKOUT_ACTION = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'; // v7.0.1
const SETUP_NODE_ACTION = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020'; // v4

interface Args {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Args {
  const args: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function die(msg: string, code = 1): never {
  process.stderr.write(`::error::${msg}\n`);
  process.exit(code);
}

function readBlueprint(p: string) {
  if (!p || !fs.existsSync(p)) die(`blueprint not found: ${p}`);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    die(`blueprint is not valid JSON: ${(e as Error).message}`);
  }
  try {
    return parseBlueprint(raw);
  } catch (e) {
    die(`blueprint failed schema validation: ${(e as Error).message}`);
  }
}

function writableRepoTarget(repoDir: string, rel: string, label: string): string {
  if (!rel || path.isAbsolute(rel)) die(`${label} must be a repository-relative path`, 2);
  const root = fs.realpathSync(repoDir);
  const target = path.resolve(root, rel);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) die(`${label} escapes --repo: ${rel}`, 2);
  if (fs.existsSync(target)) {
    const real = fs.realpathSync(target);
    if (!real.startsWith(`${root}${path.sep}`)) die(`${label} resolves outside --repo: ${rel}`, 2);
  }
  return target;
}

/** Persisted and user-facing repository paths are platform-independent contracts. */
function repoRelative(repoDir: string, target: string): string {
  return path.relative(repoDir, target).split(path.sep).join('/');
}

function packageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

interface DemoRecipe {
  id: string;
  title: string;
  support: string;
  protects: string;
  blueprint: string;
  greenTree: string;
  redTree: string;
  expectedConstraintId: string;
}

/**
 * Packaged architecture recipes are executable product claims, not screenshots. Every entry
 * names one checked-in blueprint, one conforming repository, one drifted repository, and the
 * exact constraint the RED leg must fire. Keep this catalog small enough to scan and broad
 * enough to show the real support envelope across every shipped extractor profile.
 */
const DEMO_RECIPES = [
  {
    id: 'extension-contract',
    title: 'Govern a plugin or agent extension',
    support: 'TypeScript/JavaScript · mature AST',
    protects: 'required surface + governed registration + no direct provider SDK',
    blueprint: 'fixtures/luna-chat-extension.blueprint.json',
    greenTree: 'fixtures/extension-surface/conformant',
    redTree: 'fixtures/extension-surface/drift-forbidden-import',
    expectedConstraintId: 'no-direct-provider-sdk',
  },
  {
    id: 'tenant-route-guard',
    title: 'Require access control in every tenant route',
    support: 'Next.js TypeScript · mature AST',
    protects: 'every exported route handler calls the governed tenant guard',
    blueprint: 'fixtures/route-guard.blueprint.json',
    greenTree: 'fixtures/route-surface/conformant-guarded',
    redTree: 'fixtures/route-surface/drift-missing-guard',
    expectedConstraintId: 'd6-tenant-guard',
  },
  {
    id: 'governed-egress',
    title: 'Keep outbound calls on approved hosts',
    support: 'TypeScript/JavaScript · mature AST',
    protects: 'raw network calls cannot bypass the governed gateway',
    blueprint: 'fixtures/egress-reader.blueprint.json',
    greenTree: 'fixtures/egress-surface/conformant-houseidiom',
    redTree: 'fixtures/egress-surface/drift-egress-new-url',
    expectedConstraintId: 'reader-egress-governed-only',
  },
  {
    id: 'python-module-layering',
    title: 'Keep Python domain code below the API layer',
    support: 'Python · structured direct graph',
    protects: 'directional Python layers cannot grow a reverse direct import',
    blueprint: 'fixtures/python-module-layering.blueprint.json',
    greenTree: 'fixtures/python-module-graph-surface/conformant',
    redTree: 'fixtures/python-module-graph-surface/drift-reverse-layer',
    expectedConstraintId: 'domain-cannot-import-api',
  },
  {
    id: 'module-layering',
    title: 'Keep domain code below application code',
    support: 'TypeScript/JavaScript · direct module graph',
    protects: 'directional layers cannot grow a reverse direct import',
    blueprint: 'fixtures/typescript-module-layering.blueprint.json',
    greenTree: 'fixtures/typescript-module-surface/conformant',
    redTree: 'fixtures/typescript-module-surface/drift-reverse-layer',
    expectedConstraintId: 'domain-cannot-import-app',
  },
  {
    id: 'configuration-allowlist',
    title: 'Stop a governed manifest from silently widening',
    support: 'JSON/Markdown · real-source pattern pair',
    protects: 'configuration content cannot silently widen',
    blueprint: 'examples/config-guard/blueprint/minimal-feature-manifest.blueprint.json',
    greenTree: 'examples/config-guard/clean',
    redTree: 'examples/config-guard/drift',
    expectedConstraintId: 'no-feature-beyond-the-day-one-trio',
  },
] as const satisfies readonly DemoRecipe[];

function runDemoRecipe(root: string, recipe: DemoRecipe): { clean: ComplianceReport; drift: ComplianceReport } {
  const blueprint = readBlueprint(path.join(root, recipe.blueprint));
  const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
  const run = (tree: string): ComplianceReport => {
    const graph = makeExtractor('ast', cfg).extract(path.join(root, tree), `demo:${recipe.id}:${tree}`);
    return evaluate(blueprint, graph, cfg.profile);
  };
  const clean = run(recipe.greenTree);
  const drift = run(recipe.redTree);
  const expectedDrift = drift.violations.some((violation) => violation.constraintId === recipe.expectedConstraintId);
  if (clean.verdict !== 'pass' || clean.score !== 100 || drift.verdict !== 'fail' || !expectedDrift) {
    die(`demo REFUSED: packaged recipe '${recipe.id}' did not match its GREEN/RED oracle`, 2);
  }
  return { clean, drift };
}

function printDemoRecipe(recipe: DemoRecipe, clean: ComplianceReport, drift: ComplianceReport): void {
  const witness = drift.violations.find((violation) => violation.constraintId === recipe.expectedConstraintId);
  process.stdout.write(`recipe ${recipe.id} [${recipe.support}] — ${recipe.title}\n`);
  process.stdout.write(`GREEN conformant: score ${clean.score}, exit 0\n`);
  process.stdout.write(`RED drift: score ${drift.score}, would exit 1, violation ${recipe.expectedConstraintId}\n`);
  if (witness) process.stdout.write(`  observed ${witness.observed}\n  evidence ${witness.evidenceRef}\n`);
  process.stdout.write(`bce demo: ${recipe.id} discriminates GREEN from RED\n`);
}

function filesUnder(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(p));
    else if (entry.isFile()) files.push(p);
  }
  return files;
}

function codexMcpConfig(existing: string): string {
  if (
    /^\s*\[\s*mcp_servers\s*\.\s*(?:bce|"bce"|'bce')(?:\s*\.|\s*\])/m.test(existing) ||
    /^\s*mcp_servers\s*\.\s*(?:bce|"bce"|'bce')\s*=/m.test(existing)
  ) {
    die(`--mcp-config already defines mcp_servers.bce`, 2);
  }
  const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  return `${prefix}${existing.length === 0 ? '' : '\n'}[mcp_servers.bce]\ncommand = "npx"\nargs = ["--no-install", "bce-mcp"]\n`;
}

/** Prove the exact candidate policy can be falsified against the live tree before approval. */
function everyConstraintHasExtractorRealTeeth(teeth: TeethReport): boolean {
  return teeth.witnesses.length > 0 && teeth.toothed === teeth.witnesses.length;
}

/** A blueprint-wide waiver may cover evaluator-only witnesses, never trivial or unknown ones. */
function eligibleForReviewedEvaluatorWaiver(teeth: TeethReport): boolean {
  return teeth.evaluatorRefutable > 0 && teeth.triviallyGreen === 0 && teeth.indeterminate === 0;
}

function policyProof(
  repoDir: string,
  blueprint: EngineeringBlueprint,
  reviewedWaiver: boolean,
): PolicyHistoryEntry['proof'] {
  const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
  const graph = makeExtractor('ast', cfg).extract(repoDir, 'policy-working-tree');
  if (graph.coverage.filesScanned < cfg.minFiles) {
    die(`policy proof refused: scanned ${graph.coverage.filesScanned} file(s), expected >= ${cfg.minFiles}`, 2);
  }
  const teeth = assessTeeth(blueprint, graph, cfg.profile);
  if (everyConstraintHasExtractorRealTeeth(teeth)) return 'extractor-real';
  if (eligibleForReviewedEvaluatorWaiver(teeth) && reviewedWaiver) {
    try {
      readTeethWaiver(repoDir, teeth.blueprintRef);
      return 'reviewed-evaluator-waiver';
    } catch (e) {
      die(`policy proof waiver refused: ${(e as Error).message}`, 2);
    }
  }
  die(
    `policy proof refused: ${teeth.toothed}/${teeth.witnesses.length} constraints have extractor-real teeth; ` +
      `approval requires every constraint to have extractor-real teeth` +
      (eligibleForReviewedEvaluatorWaiver(teeth) ? ` or --reviewed-waiver backed by ${TEETH_WAIVER_RELPATH}` : ''),
    2,
  );
}

/**
 * (0.9.0 --observations) RELOCATED to `./observations.js` (corpus-expansion FIX 3): the recall
 * harness must merge observation fixtures through the SAME fail-closed validated path the CLI
 * uses — so the validator is now a THROWING library export, and the CLI call site below catches
 * ObservationsValidationError and `die()`s with the IDENTICAL message + exit code (CLI stderr
 * bytes + exit semantics preserved; observations-merge.test.ts's CLI cases are the oracle).
 */

/**
 * Collect EVERY occurrence of a repeatable `--<key> <value>` flag from the raw argv.
 * `parseArgs` is last-wins for repeated flags (existing verbs never repeat one); the
 * author verb needs repeatable --constraint / --intent-ref / --repository / --guard-symbol,
 * so it re-scans the raw argv — additive, no change to parseArgs semantics.
 */
function collectRepeatable(argv: string[], key: string): string[] {
  const flag = `--${key}`;
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) out.push(next);
    }
  }
  return out;
}

/** camelCase constraint type → kebab-case id prefix (forbiddenDependency → forbidden-dependency). */
function kebab(s: string): string {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** deterministic id fragment from an arbitrary arg (module/host/path/metric). */
function slugFragment(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

/**
 * Parse one `--constraint "<type>:<arg>[:<severity>]"` spec into a schema-valid Constraint.
 * Grammar (documented in the usage footer):
 *   forbiddenDependency:<module>            → { from:'*', to: module }
 *   requiredDependency:<componentType>      → { component } (a component of that type must
 *                                             carry a provides/guards edge — see report.ts)
 *   requiredDependency:<componentType>-><target> → { component, to } for module-graph profiles
 *   requiredComponent:<componentType>       → { component }
 *   forbiddenPath:<glob>                    → { path } (matches EXTRACTED-COMPONENT paths)
 *   forbiddenFile:<glob>                    → { path } (matches RAW scanned-file paths — export-shape-agnostic)
 *   forbiddenPattern:<regex>                → { pattern } (per-line CONTENT regex over the raw scanned files —
 *                                             catches a mock literal inside an otherwise-legit file; the regex
 *                                             may contain `:` — internal colons are preserved by the rest-join)
 *   forbiddenEgress:<host,host...>          → { from:'*', forbiddenEgressHosts } (BLOCKLIST)
 *   forbiddenEgress:governed=<host,host...> → { from:'*', governedHosts }        (ALLOWLIST)
 *   requiredEvidence:<evidenceType>         → { evidenceType }
 *   minimumMetric:<metric>=<number>         → { metric, minimum }
 *   customPolicy:<policyRef>                → { policyRef }
 *   behavioralInvariant:<behaviorRef>       → { behaviorRef } (the runtime not-a-mock substance constraint)
 * The optional trailing `:<severity>` segment (info|low|medium|high|critical) is recognized
 * ONLY when it is a valid severity AND at least one arg segment precedes it; default `high`.
 * (Caveat, shared with every type: a final arg segment that IS a valid severity token — e.g. a
 * regex literally ending `:critical` — is consumed as the severity; declare the pattern in the
 * blueprint JSON directly for such shapes.)
 * Fail-closed: an unknown type, empty arg, malformed type-specific arg, or a non-compiling
 * forbiddenPattern regex is a hard error.
 */
function parseConstraintSpec(spec: string, index: number): Constraint {
  const parts = spec.split(':');
  const rawType = (parts[0] ?? '').trim();
  const typeParsed = ConstraintTypeSchema.safeParse(rawType);
  if (!typeParsed.success) {
    die(
      `--constraint '${spec}': unknown constraint type '${rawType}' ` +
        `(expected ${ConstraintTypeSchema.options.join(' | ')}).`,
    );
  }
  let rest = parts.slice(1);
  let severity: Severity = 'high';
  if (rest.length >= 2) {
    const sevParsed = SeveritySchema.safeParse(rest[rest.length - 1]);
    if (sevParsed.success) {
      severity = sevParsed.data;
      rest = rest.slice(0, -1);
    }
  }
  const arg = rest.join(':').trim();
  if (!arg) {
    die(`--constraint '${spec}': missing the argument after the type (grammar: "<type>:<arg>[:<severity>]").`);
  }
  const type = typeParsed.data;
  const id = (frag: string): string => `${kebab(type)}-${slugFragment(frag) || String(index + 1)}`;

  if (type === 'forbiddenDependency') return { id: id(arg), type, severity, from: '*', to: arg };
  if (type === 'requiredDependency') {
    const arrow = arg.indexOf('->');
    if (arrow >= 0) {
      const component = arg.slice(0, arrow).trim();
      const to = arg.slice(arrow + 2).trim();
      if (!component || !to) {
        die(`--constraint '${spec}': requiredDependency arrow form requires '<componentType>-><target>'.`);
      }
      return { id: id(`${component}-${to}`), type, severity, component, to };
    }
    return { id: id(arg), type, severity, component: arg };
  }
  if (type === 'requiredComponent') return { id: id(arg), type, severity, component: arg };
  if (type === 'forbiddenPath') return { id: id(arg), type, severity, path: arg };
  if (type === 'forbiddenFile') return { id: id(arg), type, severity, path: arg };
  if (type === 'forbiddenPattern') {
    // fail-closed at parse time (mirrors the schema superRefine): a user-supplied regex is
    // safe-compiled through the shared guard (length cap + catastrophic-backtracking reject +
    // bounded compile) so a non-compiling OR ReDoS-shaped pattern is a hard error HERE, with a
    // legible message — never deferred to a downstream zod failure and never a live-DoS sink
    // (js/regex-injection: `new RegExp(<cli-arg>)` is refused unless it passes the guard).
    try {
      safeCompilePattern(arg);
    } catch (e) {
      const detail = e instanceof UnsafePatternError ? e.message : (e as Error).message;
      die(`--constraint '${spec}': forbiddenPattern ${detail}`);
    }
    return { id: id(arg), type, severity, pattern: arg };
  }
  if (type === 'requiredEvidence') return { id: id(arg), type, severity, evidenceType: arg };
  if (type === 'customPolicy') return { id: id(arg), type, severity, policyRef: arg };
  if (type === 'minimumMetric') {
    const m = /^([^=]+)=(-?\d+(?:\.\d+)?)$/.exec(arg);
    if (!m) die(`--constraint '${spec}': minimumMetric requires '<metric>=<number>' (e.g. minimumMetric:coverage=0.8).`);
    return { id: id(m[1] as string), type, severity, metric: (m[1] as string).trim(), minimum: Number(m[2]) };
  }
  // behavioralInvariant — the runtime substance constraint. The arg is
  // the behaviorRef naming the served-runtime observation set this constraint grades.
  if (type === 'behavioralInvariant') return { id: id(arg), type, severity, behaviorRef: arg };
  // forbiddenEgress — the one two-mode constraint (see schema.ts ConstraintTypeSchema comment).
  const isAllow = arg.startsWith('governed=');
  const hosts = (isAllow ? arg.slice('governed='.length) : arg)
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hosts.length === 0) {
    die(`--constraint '${spec}': forbiddenEgress requires at least one host ('<host,...>' blocklist or 'governed=<host,...>' allowlist).`);
  }
  return isAllow
    ? { id: id(hosts[0] as string), type, severity, from: '*', governedHosts: hosts }
    : { id: id(hosts[0] as string), type, severity, from: '*', forbiddenEgressHosts: hosts };
}

/**
 * Derive the declarative intended-architecture block from the authored constraints —
 * deterministic, nothing invented: constraint-referenced component types become intended
 * components; forbidden imports/egress become disallowed relationships (allowlist hosts
 * become ALLOWED egress relationships). The author edits from there.
 */
function deriveArchitecture(constraints: readonly Constraint[]): {
  components: Component[];
  relationships: Relationship[];
} {
  const components = new Map<string, Component>();
  const relationships: Relationship[] = [];
  for (const c of constraints) {
    if ((c.type === 'requiredComponent' || c.type === 'requiredDependency') && c.component) {
      components.set(c.component, { id: c.component, type: c.component });
    }
    if (c.type === 'forbiddenDependency' && c.to) {
      relationships.push({ from: c.from ?? '*', to: c.to, type: 'imports', allowed: false });
    }
    if (c.type === 'forbiddenEgress') {
      for (const host of c.governedHosts ?? []) {
        relationships.push({ from: c.from ?? '*', to: host, type: 'egress', allowed: true });
      }
      for (const host of c.forbiddenEgressHosts ?? []) {
        relationships.push({ from: c.from ?? '*', to: host, type: 'egress', allowed: false });
      }
    }
  }
  return { components: [...components.values()], relationships };
}

/**
 * Build the observed graph. Two modes:
 *  - default (pinned): materialize the target repo at a resolved revision via
 *    `git archive` — deterministic, working-tree-immune. This is the canonical path.
 *    The UNSPECIFIED-ref default is HEAD (per-worktree), NOT origin/main: in a
 *    multi-worktree repo origin/main lives in the SHARED object DB, so a pinned run
 *    defaulting to it graded the remote-tracking commit while `--no-pin` graded the
 *    feature worktree — pinned-vs---no-pin DISAGREEMENT on the same `--ct-repo` (the
 *    multi-worktree failure mode). HEAD keeps both paths on the same commit; an
 *    explicit `--ref origin/main` (or any ref / 40-hex SHA) is honored verbatim.
 *  - `--no-pin`: scan the given directory IN PLACE (no git). For scanning a
 *    non-git materialized tree (e.g. a RED-fixture), a CI working-tree, or any
 *    directory that is not a git repo. Provenance is the caller-supplied `--ref`
 *    label (or `unpinned`) — the caller owns determinism in this mode.
 * Fail-closed on an empty/partial scan in BOTH modes.
 */
function buildGraph(
  ctRepo: string,
  ref: string | undefined,
  extractorKind: 'ast' | 'line-scan',
  noPin: boolean,
  cfg: ResolvedExtraction,
): ArchitectureGraph {
  if (!ctRepo || !fs.existsSync(ctRepo)) die(`--ct-repo not found: ${ctRepo}`);
  if (
    extractorKind === 'line-scan' &&
    (cfg.profile === 'typescript-module-graph' || cfg.profile === 'python-module-graph')
  ) {
    die(`${cfg.profile} requires --extractor ast; line-scan cannot resolve module targets`, 2);
  }
  let tree: string;
  let revision: string;
  let cleanup: (() => void) | null = null;
  if (noPin) {
    tree = ctRepo;
    revision = (typeof ref === 'string' && ref) || 'unpinned';
  } else {
    // explicit 40-hex SHA passes through verbatim; otherwise resolve the ref — defaulting
    // to HEAD (worktree-scoped), never origin/main (see the mode docblock above).
    const sha = /^[0-9a-f]{40}$/.test(ref ?? '') ? (ref as string) : resolveRevision(ctRepo, ref ?? 'HEAD');
    tree = materializeAtRevision(ctRepo, sha);
    revision = sha;
    cleanup = () => fs.rmSync(tree, { recursive: true, force: true });
  }
  try {
    const graph = makeExtractor(extractorKind, cfg).extract(tree, revision);
    // fail-closed: the scan MUST resolve at least the blueprint-derived floor of files.
    // An empty/partial scan can never score 100 (a stale glob would else pass green).
    if (graph.coverage.filesScanned < cfg.minFiles) {
      die(
        `fail-closed: scanned ${graph.coverage.filesScanned} file(s), expected >= ${cfg.minFiles} ` +
          `for the '${cfg.profile}' profile. An empty/partial scan can never score 100. (revision ${revision})`,
        2,
      );
    }
    return graph;
  } finally {
    if (cleanup) cleanup();
  }
}

function digestFiles(root: string, files: readonly string[]): string {
  const manifest = files.map((file) => ({
    path: file,
    sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'),
  }));
  return reviewDigest(manifest);
}

function engineSourceRevision(root: string): string {
  try {
    if (!fs.existsSync(path.join(root, '.git'))) throw new Error('installed package has no repository metadata');
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { gitHead?: unknown };
      return typeof pkg.gitHead === 'string' && pkg.gitHead ? pkg.gitHead : 'source-revision-unavailable';
    } catch {
      return 'source-revision-unavailable';
    }
  }
}

function currentReviewIdentities(kind: 'ast' | 'line-scan', profile: ResolvedExtraction['profile']) {
  const root = packageRoot();
  const executingDirectory = path.basename(path.dirname(fileURLToPath(import.meta.url)));
  const artifactDirectory = executingDirectory === 'dist' ? 'dist' : 'src';
  const sourceFiles = filesUnder(path.join(root, artifactDirectory)).map((file) => repoRelative(root, file)).sort();
  const identityFiles = ['package.json', 'npm-shrinkwrap.json', ...sourceFiles]
    .filter((file) => fs.existsSync(path.join(root, file)));
  const engineVersion = resolveEngineVersion();
  const runtime = resolveToolchainIdentity({ engineVersion, extractorKind: kind, extractionProfile: profile });
  const artifactDigest = digestFiles(root, identityFiles);
  const extractorFiles = sourceFiles.filter((file) => /(?:extractor|graph|observations|safe-regex|schema)\.(?:ts|js)$/.test(file));
  const extractorArtifactDigest = digestFiles(root, extractorFiles.length > 0 ? extractorFiles : identityFiles);
  return {
    engine: {
      name: 'bce-engine' as const,
      version: engineVersion,
      artifactDigest,
      sourceRevision: engineSourceRevision(root),
    },
    extractor: {
      provider: runtime.extractor.provider,
      kind: runtime.extractor.kind,
      profile: runtime.extractor.profile,
      version: runtime.extractor.version,
      artifactDigest: extractorArtifactDigest,
    },
    toolchain: {
      runtime: 'node',
      version: runtime.runtime.node,
      platform: runtime.runtime.platform,
      arch: runtime.runtime.arch,
      packageManager: { name: 'npm' as const, version: runtime.runtime.npm },
      dependencyLockDigest: runtime.dependencyLock.sha256,
    },
  };
}

function readCanonicalPacket(packetPath: string): BlueprintReviewPacket {
  let raw: string;
  let parsed: unknown;
  try {
    raw = fs.readFileSync(packetPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (error) {
    die(`review packet is unreadable JSON: ${(error as Error).message}`, 2);
  }
  let packet: BlueprintReviewPacket;
  try { packet = BlueprintReviewPacketSchema.parse(parsed); }
  catch (error) { die(`review packet failed schema validation: ${(error as Error).message}`, 2); }
  if (raw !== stableStringify(packet)) die('review packet bytes are not canonical or were tampered', 2);
  return packet;
}

function readCanonicalDecision(decisionPath: string): BlueprintDecisionRecord {
  let raw: string;
  let parsed: unknown;
  try {
    raw = fs.readFileSync(decisionPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (error) {
    die(`decision record is unreadable JSON: ${(error as Error).message}`, 2);
  }
  let decision: BlueprintDecisionRecord;
  try { decision = BlueprintDecisionRecordSchema.parse(parsed); }
  catch (error) { die(`decision record failed schema validation: ${(error as Error).message}`, 2); }
  if (raw !== stableStringify(decision)) die('decision record bytes are not canonical or were tampered', 2);
  return decision;
}

function readCanonicalCandidate(candidatePath: string): EngineeringBlueprint {
  let raw: string;
  let candidate: EngineeringBlueprint;
  try {
    raw = fs.readFileSync(candidatePath, 'utf8');
    candidate = parseBlueprint(JSON.parse(raw));
  } catch (error) {
    die(`reviewed candidate is unreadable or invalid: ${(error as Error).message}`, 2);
  }
  if (raw !== stableStringify(candidate)) die('reviewed candidate bytes are not canonical or were tampered', 2);
  return candidate;
}

function assertCanonicalPacketLocation(repoDir: string, packetPath: string, packet: BlueprintReviewPacket): void {
  const expected = path.join(repoDir, DEFAULT_PROPOSAL_OUT, packet.proposalId, 'review-packet.json');
  if (packetPath !== expected) die(`review packet must use canonical proposal location ${repoRelative(repoDir, expected)}`, 2);
}

function assertCanonicalDecisionLocation(
  repoDir: string,
  packet: BlueprintReviewPacket,
  decisionPath: string,
): void {
  const expectedDirectory = path.join(repoDir, DEFAULT_PROPOSAL_OUT, packet.proposalId, 'decisions');
  if (path.dirname(decisionPath) !== expectedDirectory) {
    die(`decision record must be under ${repoRelative(repoDir, expectedDirectory)}`, 2);
  }
}

function assertCanonicalCandidateLocation(
  repoDir: string,
  packet: BlueprintReviewPacket,
  candidatePath: string,
): void {
  const candidateId = packet.artifacts.proposal.candidate.metadata.id;
  const expected = path.join(repoDir, DEFAULT_PROPOSAL_OUT, packet.proposalId, `${candidateId}.blueprint.json`);
  if (candidatePath !== expected) {
    die(`reviewed candidate must use canonical proposal location ${repoRelative(repoDir, expected)}`, 2);
  }
}

function packetFreshnessFailures(packet: BlueprintReviewPacket, repoDir: string): string[] {
  const failures: string[] = [];
  try {
    const candidateRel = path.join(DEFAULT_PROPOSAL_OUT, packet.proposalId, `${packet.artifacts.proposal.candidate.metadata.id}.blueprint.json`);
    const candidatePath = resolveProposalInput(repoDir, candidateRel, 'reviewed candidate');
    const raw = fs.readFileSync(candidatePath, 'utf8');
    const candidate = parseBlueprint(JSON.parse(raw));
    if (raw !== stableStringify(candidate)) failures.push('reviewed candidate bytes are not canonical');
    if (reviewDigest(candidate) !== packet.provenance.candidateDigest) failures.push('reviewed candidate digest changed');
  } catch (error) {
    failures.push(`reviewed candidate cannot be reproduced: ${(error as Error).message}`);
  }
  const snapshot = snapshotRepository(repoDir);
  if (snapshot.identity !== packet.identity.repository.identity) failures.push('repository identity changed');
  if (snapshot.revision !== packet.identity.repository.revision) failures.push('repository revision changed');
  if (snapshot.worktreeDigest !== packet.identity.repository.worktreeDigest) failures.push('repository worktree bytes changed');
  const current = currentReviewIdentities(packet.identity.extractor.kind, packet.identity.extractor.profile);
  if (stableStringify(current.engine) !== stableStringify(packet.identity.engine)) failures.push('engine identity changed');
  if (stableStringify(current.extractor) !== stableStringify(packet.identity.extractor)) failures.push('extractor identity changed');
  if (stableStringify(current.toolchain) !== stableStringify(packet.identity.toolchain)) failures.push('toolchain identity changed');
  try {
    const dirty = execFileSync('git', [
      '-C', repoDir, 'status', '--porcelain=v1', '--untracked-files=all', '--', '.', ':(exclude).bce/**',
      ':(exclude).blueprints/.bce-policy-transition.lock',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (dirty) failures.push('repository has changes outside the proposal quarantine that are not present at the reviewed commit');
    for (const scanned of packet.artifacts.graph.coverage.scannedFiles ?? []) {
      try {
        execFileSync('git', ['-C', repoDir, 'ls-files', '--error-unmatch', '--', scanned], {
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch {
        failures.push(`reviewed extractor input is not tracked by the reviewed commit: ${scanned}`);
      }
    }
  } catch (error) {
    failures.push(`reviewed-commit cleanliness check failed: ${(error as Error).message}`);
  }
  const reviewedBase = packet.artifacts.repositoryPolicyDiff;
  const policyDiff = reviewedBase.complete
    ? collectRepositoryPolicyDiff(repoDir, {
      baseRef: reviewedBase.baseRef!,
      baseHeadRevision: reviewedBase.baseHeadRevision!,
    })
    : collectRepositoryPolicyDiff(repoDir);
  if (stableStringify(policyDiff) !== stableStringify(packet.artifacts.repositoryPolicyDiff)) {
    failures.push('repository policy diff changed');
  }
  try {
    const candidate = packet.artifacts.proposal.candidate;
    const cfg = resolveExtraction(candidate.extraction, candidate.constraints);
    const graph = makeExtractor(packet.identity.extractor.kind, cfg).extract(repoDir, snapshot.revision);
    if (graph.coverage.filesScanned < cfg.minFiles) failures.push(`live extraction scanned ${graph.coverage.filesScanned} file(s), below minFiles ${cfg.minFiles}`);
    if (reviewDigest(graph) !== packet.provenance.graphDigest) failures.push('live repository extraction changed');
  } catch (error) {
    failures.push(`live repository extraction failed: ${(error as Error).message}`);
  }
  return failures;
}

function requiredStringArg(args: Args, key: string, message: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) die(message, 1);
  return value;
}

function requiredPositiveIntegerArg(args: Args, key: string, label: string): number {
  const raw = requiredStringArg(args, key, `${label} is required`);
  if (!/^\d+$/.test(raw)) die(`${label} must be a positive integer`, 1);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) die(`${label} must be a positive integer`, 1);
  return value;
}

function githubReviewSelector(args: Args): GitHubReviewSelector {
  return {
    repository: requiredStringArg(args, 'github-repo', '--github-repo owner/name is required'),
    pullRequest: requiredPositiveIntegerArg(args, 'github-pull', '--github-pull'),
    reviewId: requiredPositiveIntegerArg(args, 'github-review', '--github-review'),
  };
}

async function verifyLandingEvidence(
  args: Args,
  repoDir: string,
  candidatePath: string,
  candidate: EngineeringBlueprint,
  expectedBase: EngineeringBlueprint | null,
): Promise<{
  packet: BlueprintReviewPacket;
  decision: BlueprintDecisionRecord;
  assertFresh: () => void;
}> {
  let packetPath: string;
  try {
    packetPath = resolveProposalInput(repoDir, requiredStringArg(args, 'packet', '--packet is required for policy landing'), '--packet');
  } catch (error) {
    die((error as Error).message, 2);
  }
  const packet = readCanonicalPacket(packetPath);
  assertCanonicalPacketLocation(repoDir, packetPath, packet);
  assertCanonicalCandidateLocation(repoDir, packet, candidatePath);
  let decisionPath: string;
  try {
    decisionPath = resolveProposalInput(repoDir, requiredStringArg(args, 'decision', '--decision is required for policy landing'), '--decision');
  } catch (error) {
    die((error as Error).message, 2);
  }
  const decision = readCanonicalDecision(decisionPath);
  assertCanonicalDecisionLocation(repoDir, packet, decisionPath);
  const verification = verifyReviewPacket(packet, decision);
  const freshness = packetFreshnessFailures(packet, repoDir);
  if (!verification.valid || freshness.length > 0) {
    die(`policy landing evidence is stale or invalid: ${[...verification.failures, ...freshness].join('; ')}`, 2);
  }
  if (decision.decision !== 'approve') die(`policy landing requires an approve decision, got ${decision.decision}`, 2);
  if (packet.approval.status !== 'eligible') die(`policy landing packet is blocked: ${packet.approval.blockers.join('; ')}`, 2);
  if (reviewDigest(candidate) !== packet.provenance.candidateDigest) die('policy landing candidate bytes do not match the reviewed candidate', 2);
  const expectedBaseDigest = expectedBase === null ? null : reviewDigest(expectedBase);
  if (packet.provenance.baseDigest !== expectedBaseDigest) die('policy landing base does not match the reviewed semantic baseline', 2);
  try {
    await reauthenticateGitHubDecision({
      packet,
      decision: decision.decision,
      selector: githubReviewSelector(args),
      savedDecision: decision,
    });
  } catch (error) {
    die(`policy landing SCM authentication failed: ${(error as Error).message}`, 2);
  }
  const assertFresh = (): void => {
    const currentFailures = packetFreshnessFailures(packet, repoDir);
    if (currentFailures.length > 0) {
      throw new PolicyHistoryError(`repository evidence changed during authenticated landing: ${currentFailures.join('; ')}`);
    }
  };
  assertFresh();
  return { packet, decision, assertFresh };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  // Help is a read-only short circuit. In particular, `bce gate --help` must
  // never run a gate and `bce baseline --help` must never write policy.
  const helpRequested = args.help !== undefined || args._.includes('-h') || args._[0] === 'help';
  const cmd = helpRequested ? undefined : args._[0];
  const versionRequested = args.version !== undefined || args._.includes('-v');
  if (versionRequested) {
    process.stdout.write(`${resolveEngineVersion()}\n`);
    return;
  }
  const allowedByCommand: Record<string, readonly string[]> = {
    demo: ['list', 'recipe'],
    doctor: ['repo', 'blueprint-dir', 'out'],
    'verify-bundle': ['bundle'],
    upgrade: ['check', 'repo', 'blueprint-dir', 'candidate-engine', 'out'],
    adopt: ['repo', 'blueprint', 'engine'],
    onboard: ['repo', 'blueprint', 'engine', 'harness', 'agent-file', 'mcp-config'],
    ratify: ['repo', 'blueprint', 'packet', 'decision', 'github-repo', 'github-pull', 'github-review'],
    amend: ['repo', 'blueprint', 'replacement', 'packet', 'decision', 'compatibility', 'github-repo', 'github-pull', 'github-review'],
    validate: ['blueprint'],
    propose: ['repo', 'intent-file', 'assistant', 'assistant-model', 'out', 'base', 'new', 'governed-dir', 'max-context-files', 'max-context-bytes'],
    review: args._[1] === 'show'
      ? ['packet', 'decision', 'format', 'repo']
      : args._[1] === 'decide'
        ? ['packet', 'decision', 'github-repo', 'github-pull', 'github-review', 'repo']
        : ['packet', 'decision', 'repo'],
    author: ['id', 'intent-ref', 'constraint', 'repository', 'guard-symbol', 'name', 'owner-role', 'steward-role', 'scope-paths', 'extraction-profile', 'tsconfig', 'python-root', 'min-files', 'repo', 'out'],
    init: ['id', 'intent-ref', 'constraint', 'repository', 'guard-symbol', 'name', 'owner-role', 'steward-role', 'scope-paths', 'extraction-profile', 'tsconfig', 'python-root', 'min-files', 'repo', 'out'],
    scan: ['ct-repo', 'blueprint', 'ref', 'extractor', 'no-pin', 'out'],
    run: ['blueprint', 'ct-repo', 'ref', 'extractor', 'no-pin', 'out', 'observations', 'emit-bundle', 'emit', 'prev-hash', 'emit-evidence-out', 'emit-wo-out'],
    teeth: ['blueprint', 'ct-repo', 'ref', 'extractor', 'no-pin', 'require-extractor-real', 'reviewed-waiver', 'mutation-manifest', 'require-all-extractor-real', 'out'],
    gate: ['repo', 'ct-repo', 'blueprint-dir', 'changed', 'extractor', 'repo-name', 'all', 'report-json'],
    baseline: ['repo', 'ct-repo', 'blueprint-dir', 'changed', 'extractor', 'repo-name', 'dry-run', 'check', 'out', 'patch-out'],
    graduate: ['repo', 'ct-repo', 'downgrade', 'rationale'],
    portfolio: args._[1] === 'compile' ? ['portfolio', 'out-dir'] : ['registry', 'reports-dir'],
  };
  if (cmd && allowedByCommand[cmd]) {
    const allowed = new Set([...allowedByCommand[cmd], 'help', 'version']);
    const unknown = Object.keys(args).filter((key) => key !== '_' && !allowed.has(key));
    if (unknown.length > 0) die(`unknown option for bce ${cmd}: --${unknown[0]}`, 1);
  }
  const extractorKind = (args.extractor === 'line-scan' ? 'line-scan' : 'ast') as 'ast' | 'line-scan';
  const noPin = args['no-pin'] === true || args['no-pin'] === 'true';

  if (cmd === 'demo') {
    const root = packageRoot();
    const recipeSelections = process.argv.slice(2).filter((arg) => arg === '--recipe').length;
    if (args.list !== undefined && args.list !== true) die(`--list does not accept a value`, 1);
    const listRequested = args.list === true;
    const recipeArg = typeof args.recipe === 'string' ? args.recipe : undefined;
    if (listRequested && recipeArg) die(`bce demo accepts --list or --recipe <id|all>, not both`, 1);
    if (args.recipe === true) die(`--recipe requires an id (use 'bce demo --list')`, 1);
    if (recipeSelections > 1) die(`bce demo accepts exactly one --recipe selection`, 1);

    if (listRequested) {
      process.stdout.write(`bce demo recipes — packaged architecture RED/GREEN proofs\n`);
      for (const recipe of DEMO_RECIPES) {
        process.stdout.write(`  ${recipe.id.padEnd(25)} ${recipe.support}\n`);
        process.stdout.write(`    ${recipe.protects}\n`);
      }
      process.stdout.write(`run one: bce demo --recipe <id>\nrun all: bce demo --recipe all\n`);
      return;
    }

    if (recipeArg) {
      const selected = recipeArg === 'all'
        ? DEMO_RECIPES
        : DEMO_RECIPES.filter((recipe) => recipe.id === recipeArg);
      if (selected.length === 0) die(`unknown demo recipe '${recipeArg}' (use 'bce demo --list')`, 1);
      for (const [index, recipe] of selected.entries()) {
        if (index > 0) process.stdout.write(`\n`);
        const { clean, drift } = runDemoRecipe(root, recipe);
        printDemoRecipe(recipe, clean, drift);
      }
      if (recipeArg === 'all') {
        process.stdout.write(`\nbce demo: ${selected.length}/${DEMO_RECIPES.length} packaged recipes discriminate GREEN from RED\n`);
      }
      return;
    }

    // Preserve the v0.2.0 zero-argument contract byte-for-byte for existing consumers.
    const defaultRecipe = DEMO_RECIPES[0];
    const { clean, drift } = runDemoRecipe(root, defaultRecipe);
    process.stdout.write(`GREEN conformant: score ${clean.score}, exit 0\n`);
    process.stdout.write(`RED drift-forbidden-import: score ${drift.score}, would exit 1, violation no-direct-provider-sdk\n`);
    process.stdout.write(`bce demo: package fixtures discriminate GREEN from RED\n`);
    return;
  }

  if (cmd === 'doctor') {
    const requestedRepoDir = (args.repo as string) || '.';
    if (!fs.existsSync(requestedRepoDir)) die(`--repo not found: ${requestedRepoDir}`, 2);
    const repoDir = fs.realpathSync(requestedRepoDir);
    const blueprintDir = (args['blueprint-dir'] as string) || path.join(repoDir, '.blueprints');
    const report = doctorRepository(repoDir, blueprintDir);
    const out = typeof args.out === 'string' ? (args.out as string) : undefined;
    if (out) fs.writeFileSync(out, stableStringify(report));
    for (const check of report.checks) {
      process.stdout.write(`  ${check.status === 'pass' ? '✓' : check.status === 'warning' ? '!' : '✗'} ${check.id}: ${check.detail}\n`);
    }
    process.stdout.write(`bce doctor: ${report.outcome} (exit ${report.exitCode})\n`);
    process.exit(report.exitCode);
  }

  if (cmd === 'verify-bundle') {
    const bundlePath = args.bundle as string;
    if (!bundlePath || !fs.existsSync(bundlePath)) die(`--bundle not found: ${bundlePath}`, 2);
    let bundle: EvidenceBundle;
    try { bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as EvidenceBundle; }
    catch (e) { die(`bundle is not valid JSON: ${(e as Error).message}`, 2); }
    const result = verifyEvidenceBundle(bundle);
    process.stdout.write(stableStringify(result));
    process.exit(result.valid ? 0 : 2);
  }

  if (cmd === 'upgrade' && (args.check === true || args.check === 'true')) {
    const repoDir = (args.repo as string) || '.';
    const blueprintDir = (args['blueprint-dir'] as string) || path.join(repoDir, '.blueprints');
    const candidateVersion = typeof args['candidate-engine'] === 'string' ? args['candidate-engine'] : '';
    const result = checkEngineUpgrade(blueprintDir, candidateVersion);
    if (typeof args.out === 'string') fs.writeFileSync(args.out, stableStringify(result));
    process.stdout.write(stableStringify(result));
    process.exit(result.exitCode);
  }

  if (cmd === 'adopt' || cmd === 'onboard') {
    // Safe proposal generator: installs advisory posture + a DRAFT contract + least-privilege CI
    // and agent instructions. It never approves/ratifies policy and never overwrites a file.
    const requestedRepoDir = (args.repo as string) || '.';
    if (!fs.existsSync(requestedRepoDir)) die(`--repo not found: ${requestedRepoDir}`, 2);
    const repoDir = fs.realpathSync(requestedRepoDir);
    const sourceBlueprint = readBlueprint(args.blueprint as string);
    if (sourceBlueprint.metadata.status !== 'draft' && sourceBlueprint.metadata.status !== 'proposed') {
      die(`bce adopt accepts only draft/proposed blueprints; ratification is a separate human-gated ceremony`, 2);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceBlueprint.metadata.id)) {
      die(`blueprint id must be lowercase kebab-case for adoption`, 2);
    }
    const engine = typeof args.engine === 'string' ? (args.engine as string) : '';
    const packageEngine = /^bce-engine@\d+\.\d+\.\d+$/.test(engine);
    const actionEngine = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/.test(engine);
    if (!packageEngine && !actionEngine) {
      die(`--engine must be an exact published pin (bce-engine@1.2.3) or immutable Action ref (owner/repo@40-char-sha); ranges/tags/latest are refused`, 2);
    }
    const harness = typeof args.harness === 'string' ? args.harness : 'agents';
    if (!['agents', 'claude', 'cursor', 'codex'].includes(harness)) die(`--harness must be agents|claude|cursor|codex`, 2);
    const defaultAgentFile = harness === 'claude' ? 'CLAUDE.md' : harness === 'cursor' ? '.cursorrules' : 'AGENTS.md';
    const agentRel = cmd === 'onboard'
      ? (typeof args['agent-file'] === 'string' ? args['agent-file'] : defaultAgentFile)
      : 'AGENTS.bce.md';
    const agentTarget = writableRepoTarget(repoDir, agentRel, '--agent-file');
    const defaultMcpRel = harness === 'cursor' ? '.cursor/mcp.json' : harness === 'codex' ? '.codex/config.toml' : '.mcp.json';
    const mcpRel = cmd === 'onboard'
      ? (typeof args['mcp-config'] === 'string' ? args['mcp-config'] : defaultMcpRel)
      : '';
    const mcpTarget = mcpRel ? writableRepoTarget(repoDir, mcpRel, '--mcp-config') : undefined;
    let mcpConfig: Record<string, unknown> | string | undefined;
    if (mcpTarget) {
      if (harness === 'codex') {
        mcpConfig = codexMcpConfig(fs.existsSync(mcpTarget) ? fs.readFileSync(mcpTarget, 'utf8') : '');
      } else {
        mcpConfig = {};
        if (fs.existsSync(mcpTarget)) {
          try { mcpConfig = JSON.parse(fs.readFileSync(mcpTarget, 'utf8')) as Record<string, unknown>; }
          catch (e) { die(`--mcp-config is not valid JSON: ${(e as Error).message}`, 2); }
        }
        const servers = mcpConfig.mcpServers && typeof mcpConfig.mcpServers === 'object'
          ? mcpConfig.mcpServers as Record<string, unknown> : {};
        if (servers.bce !== undefined) die(`--mcp-config already defines mcpServers.bce`, 2);
        mcpConfig.mcpServers = { ...servers, bce: { command: 'npx', args: ['--no-install', 'bce-mcp'] } };
      }
    }
    const skillRootRel = harness === 'claude' ? '.claude/skills' : harness === 'cursor' ? '.cursor/skills' : '.agents/skills';
    const skillTargets = ['bce', 'skill-tuning'].map((name) => ({
      name,
      source: path.join(packageRoot(), 'skills', name),
      target: writableRepoTarget(repoDir, path.join(skillRootRel, name), '--harness skill directory'),
    }));
    const missingSkillSources = skillTargets.filter(({ source }) => !fs.existsSync(source));
    if (missingSkillSources.length > 0) {
      die(`installed package is missing skills: ${missingSkillSources.map(({ name }) => name).join(', ')}`, 2);
    }
    const occupiedSkills = skillTargets.filter(({ target }) => fs.existsSync(target));
    if (occupiedSkills.length > 0) {
      die(`onboard refuses to overwrite existing skills: ${occupiedSkills.map(({ target }) => repoRelative(repoDir, target)).join(', ')}`, 2);
    }
    const targets = {
      blueprint: path.join(repoDir, '.blueprints', `${sourceBlueprint.metadata.id}.blueprint.json`),
      mode: path.join(repoDir, MODE_CONFIG_BASENAME),
      workflow: path.join(repoDir, '.github', 'workflows', 'blueprint-conformance.yml'),
      manifest: path.join(repoDir, '.bce-adoption.json'),
    };
    const occupied = Object.values(targets).filter((p) => fs.existsSync(p));
    if (occupied.length > 0) die(`adopt refuses to overwrite existing policy files: ${occupied.map((p) => repoRelative(repoDir, p)).join(', ')}`, 2);
    fs.mkdirSync(path.dirname(targets.blueprint), { recursive: true });
    fs.mkdirSync(path.dirname(targets.workflow), { recursive: true });
    fs.writeFileSync(targets.blueprint, stableStringify(sourceBlueprint));
    writeModeConfig(repoDir, 'advisory');
    fs.writeFileSync(targets.workflow, packageEngine
      ? `name: blueprint conformance\non: [pull_request]\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${CHECKOUT_ACTION} # v7.0.1\n        with:\n          fetch-depth: 0\n      - uses: ${SETUP_NODE_ACTION} # v4\n        with:\n          node-version: "22"\n      - run: npx --yes --package ${engine} bce gate --repo . --report-json bce-report.json\n`
      : `name: blueprint conformance\non: [pull_request]\npermissions:\n  contents: read\njobs:\n  gate:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${CHECKOUT_ACTION} # v7.0.1\n        with:\n          fetch-depth: 0\n      - uses: ${engine}\n        with:\n          engine: local\n          repo: .\n          comment: "false"\n`);
    const contextMarker = '<!-- bce-agent-context -->';
    const context = `${contextMarker}\n# BCE done-check\n\nPrefer MCP \`run_gate {}\` for diagnosis and the final live-tree done-check; if BCE MCP is unavailable, run \`npx --no-install bce gate --repo .\`. ` +
      `Read the substantive verdict: advisory mode can exit 0 while reports remain RED. Fix code on violations. Treat refusals and CLI exits 1 and 2 as red. Blueprint, baseline, mode, workflow, waiver, agent/MCP configuration, installed-skill, and engine-pin changes are policy changes and require human-owner review.\n`;
    fs.mkdirSync(path.dirname(agentTarget), { recursive: true });
    if (!fs.existsSync(agentTarget)) fs.writeFileSync(agentTarget, context);
    else if (!fs.readFileSync(agentTarget, 'utf8').includes(contextMarker)) fs.appendFileSync(agentTarget, `\n${context}`);
    if (mcpTarget) {
      fs.mkdirSync(path.dirname(mcpTarget), { recursive: true });
      fs.writeFileSync(mcpTarget, typeof mcpConfig === 'string' ? mcpConfig : stableStringify(mcpConfig));
    }
    for (const skill of skillTargets) {
      fs.mkdirSync(path.dirname(skill.target), { recursive: true });
      fs.cpSync(skill.source, skill.target, { recursive: true, errorOnExist: true });
    }
    const installedSkillFiles = skillTargets.flatMap(({ target }) => filesUnder(target));
    const generatedFiles = [...Object.values(targets), agentTarget, ...(mcpTarget ? [mcpTarget] : []), ...installedSkillFiles]
      .filter((p, i, all) => p !== targets.manifest && all.indexOf(p) === i)
      .map((p) => repoRelative(repoDir, p)).sort();
    fs.writeFileSync(targets.manifest, stableStringify({
      schemaVersion: '1',
      state: 'proposed',
      engine,
      blueprintRef: `${sourceBlueprint.metadata.id}@${sourceBlueprint.metadata.version}`,
      mode: 'advisory',
      ratified: false,
      harness,
      generatedFiles,
    }));
    process.stdout.write(`bce ${cmd}: PROPOSED advisory adoption with draft ${sourceBlueprint.metadata.id}; human ratification still required\n`);
    if (cmd === 'onboard') {
      process.stdout.write(`agent context: ${repoRelative(repoDir, agentTarget)}\n`);
      process.stdout.write(`skills: ${skillRootRel}/bce, ${skillRootRel}/skill-tuning\n`);
      process.stdout.write(
        `MCP config: ${repoRelative(repoDir, mcpTarget!)} ` +
        `(doctor_repository, check_baseline, validate_blueprint, run_gate, assess_teeth, ` +
        `inspect_blueprint, explain_constraint, compare_blueprint_policy, verify_review_packet, get_report)\n`,
      );
      process.stdout.write(`next: run 'npx --no-install bce doctor --repo .' and review/commit the proposal; ratification remains attended\n`);
    }
    return;
  }

  if (cmd === 'propose') {
    if (args._.length !== 1) die('usage: bce propose --repo <dir> --intent-file <path> --assistant openai-responses --assistant-model <exact> (--base <path> | --new)', 1);
    const requestedRepo = typeof args.repo === 'string' ? args.repo : '.';
    if (!fs.existsSync(requestedRepo)) die(`--repo not found: ${requestedRepo}`, 2);
    const repoDir = fs.realpathSync(requestedRepo);
    const intentFile = requiredStringArg(args, 'intent-file', '--intent-file <repository-relative path> is required');
    const assistantId = requiredStringArg(args, 'assistant', '--assistant is required; registered adapters: openai-responses');
    const model = requiredStringArg(args, 'assistant-model', '--assistant-model <exact provider model id> is required; BCE has no moving default');
    const hasBase = typeof args.base === 'string';
    const isNew = args.new === true || args.new === 'true';
    if (hasBase === isNew) die('select exactly one semantic baseline: --base <repository-relative blueprint> or --new', 1);
    const rawArgv = process.argv.slice(2);
    const extraGoverned = collectRepeatable(rawArgv, 'governed-dir');
    const governedDirs = [...DEFAULT_GOVERNED_DIRS, ...extraGoverned];
    const parsePositive = (key: string): number | undefined => {
      if (args[key] === undefined) return undefined;
      const value = Number.parseInt(String(args[key]), 10);
      if (!Number.isInteger(value) || value < 1) die(`--${key} must be a positive integer`, 1);
      return value;
    };
    const maxContextFiles = parsePositive('max-context-files');
    const maxContextBytes = parsePositive('max-context-bytes');
    let baseBlueprint: EngineeringBlueprint | null = null;
    if (hasBase) {
      try { baseBlueprint = readBlueprint(resolveProposalInput(repoDir, args.base as string, '--base')); }
      catch (error) { die((error as Error).message, 2); }
    }
    let context;
    try {
      context = collectProposalContext({
        repoDir,
        intentFile,
        ...(maxContextFiles !== undefined ? { maxFiles: maxContextFiles } : {}),
        ...(maxContextBytes !== undefined ? { maxBytes: maxContextBytes } : {}),
      });
    } catch (error) {
      die(`proposal context refused: ${(error as Error).message}`, 2);
    }
    const repositoryPolicyDiff = collectRepositoryPolicyDiff(repoDir);
    let quarantine: string;
    try {
      const proposalOut = typeof args.out === 'string' ? args.out.replace(/\\/g, '/').replace(/\/$/, '') : DEFAULT_PROPOSAL_OUT;
      if (proposalOut !== DEFAULT_PROPOSAL_OUT) {
        throw new Error(`--out must be ${DEFAULT_PROPOSAL_OUT}; decision evidence uses this canonical quarantine root`);
      }
      quarantine = prepareQuarantineRoot({
        repoDir,
        out: proposalOut,
        governedDirs,
      });
    } catch (error) {
      die(`proposal quarantine refused: ${(error as Error).message}`, 2);
    }
    const staging = createProposalStagingDirectory(quarantine);
    const disclosure = buildDisclosureManifest(context);
    writeProposalFile(path.join(staging, 'context.json'), stableStringify(context));
    writeProposalFile(path.join(staging, 'disclosure.json'), stableStringify(disclosure));
    process.stdout.write(`BCE disclosure preview — these exact context bytes will be sent to ${assistantId}:\n${stableStringify(disclosure)}`);

    const schemaPath = path.join(packageRoot(), 'spec', 'schemas', 'blueprint-draft-plan.schema.json');
    if (!fs.existsSync(schemaPath)) {
      writeProposalFile(path.join(staging, 'processing-failure.json'), stableStringify({ error: 'installed package is missing blueprint-draft-plan.schema.json' }));
      finalizeProposalDirectory(staging, `failed-${context.contextDigest.slice(0, 16)}`);
      die('installed package is missing blueprint-draft-plan.schema.json', 2);
    }
    let adapter;
    try {
      adapter = createRegisteredAssistant(assistantId, {
        model,
        outputSchema: JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, unknown>,
        ...(process.env.OPENAI_API_KEY !== undefined ? { apiKey: process.env.OPENAI_API_KEY } : {}),
      });
    } catch (error) {
      writeProposalFile(path.join(staging, 'processing-failure.json'), stableStringify({ error: (error as Error).message }));
      finalizeProposalDirectory(staging, `failed-${context.contextDigest.slice(0, 16)}`);
      die((error as Error).message, 2);
    }
    const generation = await adapter.generate(context);
    const generationDigest = reviewDigest(generation.record);
    writeProposalFile(path.join(staging, 'generation.json'), stableStringify(generation.record));
    writeProposalFile(path.join(staging, 'raw-response.txt'), generation.rawResponse);
    const failAttempt = (message: string): never => {
      writeProposalFile(path.join(staging, 'processing-failure.json'), stableStringify({
        schemaVersion: '1', status: 'failed', error: message, generationDigest,
      }));
      const failed = finalizeProposalDirectory(staging, `failed-${generationDigest.slice(0, 16)}`);
      die(`${message}; failed proposal retained at ${repoRelative(repoDir, failed)}`, 2);
    };
    const plan = generation.plan ?? failAttempt(generation.record.error ?? 'assistant did not produce a reviewable draft plan');

    const afterContext = (() => {
      try { return collectProposalContext({
        repoDir,
        intentFile,
        ...(maxContextFiles !== undefined ? { maxFiles: maxContextFiles } : {}),
        ...(maxContextBytes !== undefined ? { maxBytes: maxContextBytes } : {}),
      }); }
      catch (error) { return failAttempt(`repository freshness recheck failed: ${(error as Error).message}`); }
    })();
    if (afterContext.contextDigest !== context.contextDigest) failAttempt('repository or disclosed context changed while the assistant was running');
    if (baseBlueprint && plan.metadata.id !== baseBlueprint.metadata.id) {
      failAttempt(`assistant plan id '${plan.metadata.id}' does not match human-selected base '${baseBlueprint.metadata.id}'`);
    }

    const proposal = (() => {
      try { return compileDraftPlan({
        context,
        plan,
        promptDigest: generation.record.promptDigest,
        generationDigest,
      }); }
      catch (error) { return failAttempt(`deterministic proposal compilation refused: ${(error as Error).message}`); }
    })();
    const cfg = resolveExtraction(proposal.candidate.extraction, proposal.candidate.constraints);
    const graph = (() => {
      try {
        const observed = makeExtractor('ast', cfg).extract(repoDir, context.repository.revision);
        if (observed.coverage.filesScanned < cfg.minFiles) {
          return failAttempt(`scope resolution scanned ${observed.coverage.filesScanned} file(s), below minFiles ${cfg.minFiles}`);
        }
        return observed;
      } catch (error) { return failAttempt(`deterministic scope/extraction refused: ${(error as Error).message}`); }
    })();
    const identities = currentReviewIdentities(graph.coverage.extractor, cfg.profile);
    const packet = (() => {
      try {
        const built = buildReviewPacket({
        proposal,
        baseBlueprint,
        graph,
        ...identities,
        repositoryPolicyDiff,
        resolvedScope: {
          matchedFiles: graph.coverage.scannedFiles ?? [],
          excludedPaths: context.excluded.paths,
          excludedClasses: context.excluded.classes,
        },
        });
        const verification = verifyReviewPacket(built);
        if (!verification.valid) return failAttempt(`generated review packet failed replay: ${verification.failures.join('; ')}`);
        return built;
      } catch (error) { return failAttempt(`deterministic review refused: ${(error as Error).message}`); }
    })();
    writeProposalFile(path.join(staging, 'draft-plan.json'), stableStringify(plan));
    writeProposalFile(path.join(staging, `${proposal.candidate.metadata.id}.blueprint.json`), stableStringify(proposal.candidate));
    writeProposalFile(path.join(staging, 'proposal.json'), stableStringify(proposal));
    writeProposalFile(path.join(staging, 'review-packet.json'), stableStringify(packet));
    writeProposalFile(path.join(staging, 'review.txt'), renderReviewPacketText(packet));
    writeProposalFile(path.join(staging, 'review.html'), renderReviewPacketHtml(packet));
    let finalDir: string;
    try { finalDir = finalizeProposalDirectory(staging, proposal.proposalId); }
    catch (error) { die(`proposal finalization refused: ${(error as Error).message}; staging retained at ${staging}`, 2); }
    process.stdout.write(
      `bce propose: REVIEWABLE draft ${proposal.candidate.metadata.id}@${proposal.candidate.metadata.version} -> ` +
      `${repoRelative(repoDir, finalDir)} (packet sha256:${packet.packetDigest}; approval ${packet.approval.status})\n`,
    );
    return;
  }

  if (cmd === 'review') {
    const sub = args._[1];
    if (!['show', 'decide', 'verify'].includes(String(sub)) || args._.length !== 2) {
      die('usage: bce review show|decide|verify --packet <review-packet.json>', 1);
    }
    const requestedRepo = typeof args.repo === 'string' ? args.repo : '.';
    if (!fs.existsSync(requestedRepo)) die(`--repo not found: ${requestedRepo}`, 2);
    const repoDir = fs.realpathSync(requestedRepo);
    let packetPath: string;
    try { packetPath = resolveProposalInput(repoDir, requiredStringArg(args, 'packet', '--packet is required'), '--packet'); }
    catch (error) { die((error as Error).message, 2); }
    const packet = readCanonicalPacket(packetPath);
    assertCanonicalPacketLocation(repoDir, packetPath, packet);
    const decisionPathArg = typeof args.decision === 'string' && sub !== 'decide' ? args.decision : undefined;
    let savedDecision: BlueprintDecisionRecord | undefined;
    if (decisionPathArg) {
      const savedPath = resolveProposalInput(repoDir, decisionPathArg, '--decision');
      assertCanonicalDecisionLocation(repoDir, packet, savedPath);
      savedDecision = readCanonicalDecision(savedPath);
    }
    const verification = verifyReviewPacket(packet, savedDecision);
    const freshness = packetFreshnessFailures(packet, repoDir);
    if (!verification.valid || freshness.length > 0) {
      die(`review verification failed: ${[...verification.failures, ...freshness].join('; ')}`, 2);
    }

    if (sub === 'show') {
      const format = typeof args.format === 'string' ? args.format : 'text';
      if (format === 'text') process.stdout.write(renderReviewPacketText(packet, savedDecision));
      else if (format === 'json') process.stdout.write(stableStringify(packet));
      else if (format === 'html') process.stdout.write(renderReviewPacketHtml(packet, savedDecision));
      else die('--format must be text|json|html', 1);
      return;
    }
    if (sub === 'verify') {
      process.stdout.write(
        `bce review verify: INTEGRITY VERIFIED packet sha256:${packet.packetDigest}` +
        `${savedDecision ? ` + decision sha256:${savedDecision.decisionDigest}; SCM authentication is rechecked by ratify/amend` : ''}\n`,
      );
      return;
    }

    const decision = requiredStringArg(args, 'decision', '--decision approve|reject|request-changes is required');
    if (!['approve', 'reject', 'request-changes'].includes(decision)) die('--decision must be approve|reject|request-changes', 1);
    let record: BlueprintDecisionRecord;
    try {
      record = await authenticateGitHubDecision({
        packet,
        decision: decision as BlueprintDecisionRecord['decision'],
        selector: githubReviewSelector(args),
      });
    } catch (error) {
      die(`decision SCM authentication refused: ${(error as Error).message}`, 2);
    }
    const decisionsDir = path.join(path.dirname(packetPath), 'decisions');
    fs.mkdirSync(decisionsDir, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(decisionsDir) !== decisionsDir) die('decision directory resolves through a symbolic link', 2);
    const out = path.join(decisionsDir, `${record.decision}-${record.decisionDigest.slice(0, 16)}.json`);
    try { writeProposalFile(out, stableStringify(record)); }
    catch (error) { die(`decision persistence refused: ${(error as Error).message}`, 2); }
    process.stdout.write(`bce review decide: ${record.decision} -> ${repoRelative(repoDir, out)} (sha256:${record.decisionDigest}); no policy files changed\n`);
    return;
  }

  if (cmd === 'ratify') {
    const requestedRepo = (args.repo as string) || '.';
    if (!fs.existsSync(requestedRepo)) die(`--repo not found: ${requestedRepo}`, 2);
    const repoDir = fs.realpathSync(requestedRepo);
    const blueprintPath = resolveProposalInput(repoDir, requiredStringArg(args, 'blueprint', '--blueprint is required'), '--blueprint');
    const blueprint = readCanonicalCandidate(blueprintPath);
    const existingPolicyPath = path.join(repoDir, '.blueprints', `${blueprint.metadata.id}.blueprint.json`);
    const existingDraft = blueprintPath !== existingPolicyPath && fs.existsSync(existingPolicyPath)
      ? readBlueprint(resolveProposalInput(repoDir, repoRelative(repoDir, existingPolicyPath), 'existing policy'))
      : null;
    if (existingDraft && !['draft', 'proposed'].includes(existingDraft.metadata.status)) {
      die(`ratify refuses to replace existing ${existingDraft.metadata.status} policy; use bce amend`, 2);
    }
    const { packet, decision, assertFresh } = await verifyLandingEvidence(args, repoDir, blueprintPath, blueprint, existingDraft);
    const proof = policyProof(repoDir, blueprint, false);
    try {
      const result = ratifyBlueprint({
        repoDir,
        blueprintPath,
        review: {
          reviewer: decision.reviewer.id,
          rationale: decision.rationale,
          recordedAt: decision.decidedAt,
          authentication: decision.reviewer.authentication,
          evidence: {
            packetDigest: decision.binding.packetDigest,
            decisionDigest: decision.decisionDigest,
            candidateDigest: decision.binding.candidateDigest,
            baseDigest: packet.provenance.baseDigest,
            repositoryRevision: decision.binding.repositoryRevision,
            worktreeDigest: decision.binding.worktreeDigest,
          },
        },
        proof,
        assertFresh,
        expectedCandidateDigest: packet.provenance.candidateDigest,
        expectedBaseDigest: packet.provenance.baseDigest,
      });
      process.stdout.write(`bce ratify: ${result.entry.fromRef} -> ${result.entry.toRef}; approved with ${proof} proof\n`);
    } catch (e) {
      if (e instanceof PolicyHistoryError) die(e.message, 2);
      throw e;
    }
    return;
  }

  if (cmd === 'amend') {
    const requestedRepo = (args.repo as string) || '.';
    if (!fs.existsSync(requestedRepo)) die(`--repo not found: ${requestedRepo}`, 2);
    const repoDir = fs.realpathSync(requestedRepo);
    const blueprintPath = resolveProposalInput(repoDir, requiredStringArg(args, 'blueprint', '--blueprint is required'), '--blueprint');
    const replacementPath = resolveProposalInput(repoDir, requiredStringArg(args, 'replacement', '--replacement is required'), '--replacement');
    const current = readBlueprint(blueprintPath);
    const replacement = readCanonicalCandidate(replacementPath);
    const { packet, decision, assertFresh } = await verifyLandingEvidence(args, repoDir, replacementPath, replacement, current);
    const compatibility = packet.semanticDiff.classification === 'relaxation'
      ? 'weakening'
      : packet.semanticDiff.classification === 'tightening'
        ? 'tightening'
        : 'compatible';
    if (typeof args.compatibility === 'string' && args.compatibility !== compatibility) {
      die(`--compatibility '${args.compatibility}' contradicts deterministic review classification '${compatibility}'`, 2);
    }
    const proof = policyProof(repoDir, replacement, false);
    try {
      const result = amendBlueprint({
        repoDir,
        blueprintPath,
        replacementPath,
        review: {
          reviewer: decision.reviewer.id,
          rationale: decision.rationale,
          recordedAt: decision.decidedAt,
          authentication: decision.reviewer.authentication,
          evidence: {
            packetDigest: decision.binding.packetDigest,
            decisionDigest: decision.decisionDigest,
            candidateDigest: decision.binding.candidateDigest,
            baseDigest: packet.provenance.baseDigest,
            repositoryRevision: decision.binding.repositoryRevision,
            worktreeDigest: decision.binding.worktreeDigest,
          },
          acceptWeakening: decision.weakeningAccepted,
        },
        compatibility,
        proof,
        assertFresh,
        expectedCandidateDigest: packet.provenance.candidateDigest,
        expectedBaseDigest: packet.provenance.baseDigest!,
      });
      process.stdout.write(`bce amend: ${result.entry.fromRef} -> ${result.entry.toRef}; ${compatibility}; ${proof} proof\n`);
    } catch (e) {
      if (e instanceof PolicyHistoryError) die(e.message, 2);
      throw e;
    }
    return;
  }

  if (cmd === 'validate') {
    const bp = readBlueprint(args.blueprint as string);
    process.stdout.write(`blueprint VALID: ${bp.metadata.id}@${bp.metadata.version} (${bp.constraints.length} constraint(s))\n`);
    return;
  }

  if (cmd === 'author' || cmd === 'init') {
    // Model-agnostic blueprint AUTHORING: flags in → schema-VALID draft out.
    // Interactive-free (scriptable by any model or none), no LLM, no network. The scaffold
    // is born `status: draft` @ 0.1.0 — ratification (`approved`) is the human ceremony,
    // never this verb. Fail-closed at every step: unknown constraint type, missing
    // intentRef, zero constraints, or a scope that matches no file all refuse loudly.
    const rawArgv = process.argv.slice(2);
    const id = typeof args.id === 'string' ? (args.id as string).trim() : '';
    if (!id) die(`--id <blueprint-id> is required.`, 1);

    // intentRefs — the schema demands min 1 (every blueprint traces to a business intent).
    const intentRefs = collectRepeatable(rawArgv, 'intent-ref');
    if (intentRefs.length === 0) {
      die(`at least one --intent-ref <ref> is required — every blueprint traces to a business intent (schema: intentRefs min 1).`, 1);
    }

    // constraints — the schema demands min 1 (a blueprint that enforces nothing is refused at authoring time).
    const constraintSpecs = collectRepeatable(rawArgv, 'constraint');
    if (constraintSpecs.length === 0) {
      die(`at least one --constraint "<type>:<arg>[:<severity>]" is required — a blueprint with zero constraints enforces nothing (schema: constraints min 1).`, 1);
    }
    const constraints = constraintSpecs.map((s, i) => parseConstraintSpec(s, i));
    // deterministic id dedupe: a repeated fragment gains a positional suffix (never a silent overwrite).
    const seen = new Map<string, number>();
    for (const c of constraints) {
      const n = seen.get(c.id) ?? 0;
      seen.set(c.id, n + 1);
      if (n > 0) c.id = `${c.id}-${n + 1}`;
    }

    // scope — repositories min 1; explicit --repository wins, else derived from --repo's dirname.
    const repoDir = typeof args.repo === 'string' ? (args.repo as string) : undefined;
    if (repoDir && !fs.existsSync(repoDir)) die(`--repo not found: ${repoDir}`);
    const repositories = collectRepeatable(rawArgv, 'repository');
    if (repositories.length === 0) {
      if (repoDir) repositories.push(path.basename(path.resolve(repoDir)));
      else die(`--repository <org/repo> is required (or pass --repo <dir> to derive it from the directory name).`, 1);
    }
    const scopePaths =
      typeof args['scope-paths'] === 'string'
        ? (args['scope-paths'] as string).split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

    // extraction — only when a profile is EXPLICITLY named (absent → the historical
    // next-route-handler defaults resolve at run time; explicit-over-implicit).
    let extraction: BlueprintExtraction | undefined;
    if (typeof args['extraction-profile'] === 'string') {
      const profileParsed = ExtractionProfileSchema.safeParse(args['extraction-profile']);
      if (!profileParsed.success) {
        die(`--extraction-profile must be one of: ${ExtractionProfileSchema.options.join(' | ')} (got '${args['extraction-profile'] as string}').`, 1);
      }
      if (profileParsed.data !== 'next-route-handler' && (!scopePaths || scopePaths.length === 0)) {
        die(`--extraction-profile ${profileParsed.data} requires --scope-paths <glob,glob> (this profile has no default globs).`, 1);
      }
      const guardSymbols = collectRepeatable(rawArgv, 'guard-symbol');
      const pythonRoots = collectRepeatable(rawArgv, 'python-root');
      let minFiles = 1;
      if (typeof args['min-files'] === 'string') {
        minFiles = Number.parseInt(args['min-files'] as string, 10);
        if (!Number.isInteger(minFiles) || minFiles < 1) die(`--min-files must be a positive integer (got '${args['min-files'] as string}').`, 1);
      }
      extraction = {
        profile: profileParsed.data,
        ...(scopePaths && scopePaths.length > 0 ? { paths: scopePaths } : {}),
        ...(guardSymbols.length > 0 ? { guardSymbols } : {}),
        ...(pythonRoots.length > 0 ? { pythonRoots } : {}),
        minFiles,
        ...(typeof args.tsconfig === 'string' ? { tsconfig: args.tsconfig } : {}),
      };
      if (args.tsconfig === true) die(`--tsconfig requires one repository-relative file path.`, 1);
      if (args.tsconfig && profileParsed.data !== 'typescript-module-graph') {
        die(`--tsconfig is only valid with --extraction-profile typescript-module-graph.`, 1);
      }
      if (pythonRoots.length > 0 && profileParsed.data !== 'python-module-graph') {
        die(`--python-root is only valid with --extraction-profile python-module-graph.`, 1);
      }
      if (profileParsed.data === 'python-module-graph' && pythonRoots.length === 0) {
        die(`python-module-graph requires at least one --python-root <repo-relative-directory>.`, 1);
      }
      const isModuleGraph =
        profileParsed.data === 'typescript-module-graph' || profileParsed.data === 'python-module-graph';
      if (isModuleGraph) {
        for (const constraint of constraints) {
          if (constraint.type !== 'requiredDependency' && constraint.type !== 'forbiddenDependency') continue;
          constraint.scopePaths = [...(scopePaths ?? [])];
          if (constraint.type === 'requiredDependency' && !constraint.to) {
            die(
              `${profileParsed.data} requiredDependency uses '<componentType>-><target>' ` +
                `(example: requiredDependency:${profileParsed.data === 'python-module-graph' ? 'pythonModule->package:requests' : 'typescriptModule->package:zod'}).`,
              1,
            );
          }
        }
      }
    }

    const name = typeof args.name === 'string' ? (args.name as string) : undefined;
    const ownerRole = typeof args['owner-role'] === 'string' ? (args['owner-role'] as string) : undefined;
    const stewardRole = typeof args['steward-role'] === 'string' ? (args['steward-role'] as string) : undefined;
    const { components, relationships } = deriveArchitecture(constraints);

    const draft = {
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'EngineeringBlueprint',
      metadata: {
        id,
        ...(name ? { name } : {}),
        version: '0.1.0',
        status: 'draft',
        ...(ownerRole ? { ownerRole } : {}),
        ...(stewardRole ? { stewardRole } : {}),
      },
      intentRefs,
      scope: { repositories, ...(scopePaths && scopePaths.length > 0 ? { paths: scopePaths } : {}) },
      architecture: { components, relationships },
      constraints,
      // house-fixture defaults for the author to edit — the engine IS the staticAst evidence
      // producer, and ratification is a blueprint-steward stage (see fixtures/*.json).
      evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
      approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
      ...(extraction ? { extraction } : {}),
      ...(extraction?.profile === 'typescript-module-graph'
        ? { minEngineVersion: TYPESCRIPT_MODULE_GRAPH_MIN_ENGINE_VERSION }
        : extraction?.profile === 'python-module-graph'
          ? { minEngineVersion: PYTHON_MODULE_GRAPH_MIN_ENGINE_VERSION }
          : {}),
    };

    // SELF-VALIDATE (fail-closed): the scaffold must pass the STRICT schema BEFORE it is written.
    let bp: EngineeringBlueprint;
    try {
      bp = parseBlueprint(draft);
    } catch (e) {
      die(`author bug — the generated draft failed schema validation (nothing written): ${(e as Error).message}`, 1);
    }
    const out = (args.out as string) || `${id}.blueprint.json`;
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, serializeBlueprintCanonical(bp));
    // round-trip proof: re-read the WRITTEN artifact through the strict parser (dies on any drift).
    readBlueprint(out);
    process.stdout.write(
      `authored DRAFT blueprint ${id}@0.1.0 -> ${out} ` +
        `(${constraints.length} constraint(s), ${intentRefs.length} intent ref(s)) — schema-VALID, round-tripped\n`,
    );

    // scan-based sanity (only when --repo is given): the authored scope must match >= 1 real
    // file, else the draft would gate NOTHING — refuse (exit 2, the fail-closed scan class).
    if (repoDir) {
      const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const graph = makeExtractor('ast', cfg).extract(repoDir, 'author-sanity');
      if (graph.coverage.filesScanned < 1) {
        die(
          `author sanity FAILED: the blueprint scope matched 0 files in ${repoDir} ` +
            `(profile '${cfg.profile}', paths: ${cfg.paths.join(', ')}). ` +
            `A blueprint whose scope resolves nothing gates nothing — fix --scope-paths (draft left at ${out} for editing).`,
          2,
        );
      }
      process.stdout.write(
        `author sanity: scope matches ${graph.coverage.filesScanned} file(s) in ${repoDir} ` +
          `(${graph.components.length} component(s) observed)\n`,
      );
    }
    return;
  }

  if (cmd === 'scan') {
    // scan may be blueprint-driven (derive the extraction profile) or default (CT-ontology).
    let cfg: ResolvedExtraction;
    if (typeof args.blueprint === 'string' && args.blueprint) {
      const bp: EngineeringBlueprint = readBlueprint(args.blueprint);
      cfg = resolveExtraction(bp.extraction, bp.constraints);
    } else {
      cfg = resolveExtraction(undefined);
    }
    const graph = buildGraph(args['ct-repo'] as string, args.ref as string | undefined, extractorKind, noPin, cfg);
    const out = (args.out as string) || 'architecture-graph.json';
    fs.writeFileSync(out, stableStringify(graph));
    process.stdout.write(
      `scanned ${graph.coverage.filesScanned} file(s) via ${graph.coverage.extractor} [${cfg.profile}]: ` +
        `${graph.components.length} component(s), ${graph.guardEdges.length} edge(s) @ ${graph.ctRepoRevision}\n`,
    );
    return;
  }

  if (cmd === 'run') {
    const bp = readBlueprint(args.blueprint as string);
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    // line-scan structurally cannot resolve a bare governed import (it has no symbol table), so it
    // would FALSE-REJECT a conformant route or extension that uses a bare governed call. Refuse
    // every blueprint that declares governedModules and escalate to the faithful AST path.
    if (extractorKind === 'line-scan' && cfg.governedModules.length > 0) {
      die(`--extractor line-scan cannot honor governedModules (it has no symbol resolution). Use --extractor ast.`, 1);
    }
    // b1/egress — line-scan has no AST / symbol table, so it cannot resolve a fetch() argument to
    // a host (the `||`-chain const-fold is an AST-only operation). Refuse LOUD rather than silently
    // scan zero egress edges (which would score a drifted blueprint as a false pass).
    if (extractorKind === 'line-scan' && cfg.egressEnabled) {
      die(`forbiddenEgress requires --extractor ast; line-scan cannot resolve fetch hosts`, 1);
    }
    // python-import-surface resolves no egress hosts under either kind flag — refuse LOUD (same
    // discipline as the line-scan refusal above; a silent zero-edge scan would be a false pass).
    if (
      (cfg.profile === 'python-import-surface' || cfg.profile === 'python-module-graph') &&
      cfg.egressEnabled
    ) {
      die(`forbiddenEgress is not supported by the ${cfg.profile} profile`, 1);
    }
    // 0.9.0 --observations: a bare flag (no path) is a LOUD error, never a silent skip.
    if (args.observations === true) {
      die(`--observations requires a file path (bce run ... --observations <path>).`);
    }
    const graph = buildGraph(args['ct-repo'] as string, args.ref as string | undefined, extractorKind, noPin, cfg);
    // Ingest a provenance-bound served-runtime observation envelope and MERGE its nodes
    // into the observed graph's components AFTER the static extract, BEFORE evaluate. The
    // behavioralInvariant grader (report.ts) already reads these nodes FROM the graph; this is the
    // only missing produce→ingest seam. Absent flag → today's behavior (a behavioralInvariant then
    // finds <2 observations and fail-closes, exactly as now). Merged nodes are re-sorted into
    // graph.components by id so the report stays deterministic. The envelope is bound to the exact
    // revision, scanned source bytes, extracted graph, probe, stimuli, and environment before merge.
    if (typeof args.observations === 'string' && args.observations) {
      // FIX 3 seam: the shared validator THROWS; the CLI preserves its historical fail-closed
      // surface by die()ing with the identical message + exit code (default 1, as before).
      let obs: ObservedComponent[];
      try {
        const behavioral = bp.constraints.filter((c) => c.type === 'behavioralInvariant');
        if (behavioral.length === 0) throw new Error(`--observations supplied but blueprint has no behavioralInvariant constraint`);
        const expectations = new Set(
          behavioral.map((c) => `${c.probeDefinitionHash ?? ''}|${c.stimulusSetHash ?? ''}|${c.environmentId ?? ''}`),
        );
        const expectation = [...expectations][0];
        if (expectations.size !== 1 || !expectation) {
          throw new Error(`behavioralInvariant constraints must declare one shared probeDefinitionHash, stimulusSetHash, and environmentId`);
        }
        const parts = expectation.split('|');
        if (parts.length !== 3 || parts.some((x) => !x)) {
          throw new Error(`behavioralInvariant constraints must declare one shared probeDefinitionHash, stimulusSetHash, and environmentId`);
        }
        const [probeDefinitionHash, stimulusSetHash, environmentId] = parts as [string, string, string];
        obs = loadObservations(args.observations, {
          ...observationBinding(args['ct-repo'] as string, graph),
          probeDefinitionHash,
          stimulusSetHash,
          environmentId,
        });
      } catch (e) {
        die((e as Error).message);
      }
      graph.components = [...graph.components, ...obs].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      process.stdout.write(`merged ${obs.length} behaviorObservation node(s) from ${args.observations}\n`);
    }
    const report = evaluate(bp, graph, cfg.profile);
    const out = (args.out as string) || 'compliance-report.json';
    fs.writeFileSync(out, stableStringify(report));
    if (typeof args['emit-bundle'] === 'string') {
      const bundle = createEvidenceBundle({
        blueprint: bp, graph, report, engineVersion: resolveEngineVersion(),
        command: 'bce run', extractionProfile: cfg.profile,
      });
      fs.writeFileSync(args['emit-bundle'] as string, stableStringify(bundle));
      process.stdout.write(`emitted self-contained integrity bundle -> ${args['emit-bundle'] as string} (origin authenticity not established)\n`);
    }
    process.stdout.write(
      `ComplianceReport: ${report.blueprintRef} @ ${report.ctRepoRevision} -> score ${report.score} (${report.verdict}), ` +
        `${report.violations.length} violation(s). ${report.summary}\n`,
    );
    // --emit: close the scan→evidence→WO arrow. Writes a chained, traceId-stamped
    // evidence record (chained onto --prev-hash if given) + proposed remediation WOs. Deterministic.
    if (args.emit === true || args.emit === 'true') {
      const prev = typeof args['prev-hash'] === 'string' ? (args['prev-hash'] as string) : EVIDENCE_GENESIS_HASH;
      const emission = emitRun(report, prev, resolveToolchainIdentity({
        engineVersion: resolveEngineVersion(),
        extractorKind: report.coverage.extractor,
        extractionProfile: cfg.profile,
      }));
      const evOut = (args['emit-evidence-out'] as string) || 'evidence-record.json';
      const woOut = (args['emit-wo-out'] as string) || 'remediation-work-orders.json';
      fs.writeFileSync(evOut, stableStringify(emission.evidence));
      fs.writeFileSync(woOut, stableStringify(emission.workOrders));
      process.stdout.write(
        `emitted evidence ${emission.evidence.hash.slice(0, 16)}… (chain from ${prev.slice(0, 8)}…) + ` +
          `${emission.workOrders.length} PROPOSED remediation WO(s)\n`,
      );
    }
    // exit 1 on a failing verdict so CI can gate on it (a real conformance gate).
    process.exit(report.verdict === 'pass' ? 0 : 1);
  }

  if (cmd === 'teeth') {
    // The TOOTHLESSNESS gate. Grades a blueprint's
    // mutation-refutability: a constraint has TEETH iff a realistic ArchitectureGraph mutation
    // reddens it. An all-trivial blueprint (nothing can fail) is TOOTHLESS → exit 2. This makes a
    // green `bce run` verdict MEAN something: it can only be green because nothing was reddenable
    // if the blueprint also passes `bce teeth`. Deterministic, static — drives evaluate() as the
    // oracle over per-type minimal graph mutations (no runtime, no network). Exit codes:
    //   0 = TOOTHED (at least one constraint has extractor-real teeth)
    //   0 = EVALUATOR-REFUTABLE (refutable in principle only — synthetic-evidence mutations; NOT a
    //       falsification, so it keeps the exit-0 class, surfaced as a ::warning:: because it is
    //       explicitly NOT evidence of real teeth)
    //   2 = TOOTHLESS (every constraint trivially-green or indeterminate — a green run proves nothing)
    const bp = readBlueprint(args.blueprint as string);
    if (typeof args['mutation-manifest'] === 'string') {
      if (args['require-all-extractor-real'] !== true && args['require-all-extractor-real'] !== 'true') {
        die('--mutation-manifest requires --require-all-extractor-real; partial source-mutation credit is refused', 2);
      }
      let manifest: unknown;
      try { manifest = JSON.parse(fs.readFileSync(args['mutation-manifest'], 'utf8')); }
      catch (e) { die(`mutation manifest is not valid JSON: ${(e as Error).message}`, 2); }
      let report;
      try {
        report = assessExtractorTeethCorpus({
          blueprint: bp,
          repoDir: args['ct-repo'] as string,
          manifest,
          extractor: extractorKind,
        });
      } catch (e) {
        die(`extractor-real mutation proof refused: ${(e as Error).message}`, 2);
      }
      const out = (args.out as string) || 'extractor-teeth-report.json';
      fs.writeFileSync(out, stableStringify(report));
      if (report.verdict !== 'extractor-real-proven') {
        process.stderr.write(
          `::error::extractor-real mutation proof REFUSED — ${report.killed}/${report.constraints} constraints killed; ` +
          `${report.survived} survived, ${report.refused} refused, ${report.unmappedConstraints.length} unmapped\n`,
        );
        for (const entry of report.cases.filter((item) => item.status !== 'killed')) {
          process.stderr.write(`::error::  [${entry.constraintId}/${entry.id}] ${entry.status}: ${entry.detail}\n`);
        }
        process.exit(2);
      }
      process.stdout.write(
        `ExtractorTeethReport: ${report.blueprintRef} -> extractor-real-proven — ` +
        `${report.killed}/${report.constraints} separately materialized source mutants killed\n`,
      );
      return;
    }
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    const graph = buildGraph(args['ct-repo'] as string, args.ref as string | undefined, extractorKind, noPin, cfg);
    const teeth = assessTeeth(bp, graph, cfg.profile);
    const requireExtractorReal = args['require-extractor-real'] === true || args['require-extractor-real'] === 'true';
    const reviewedWaiver = args['reviewed-waiver'] === true || args['reviewed-waiver'] === 'true';
    let readinessRefused = false;
    if (requireExtractorReal) {
      if (everyConstraintHasExtractorRealTeeth(teeth)) {
        teeth.readiness = { status: 'ready', proof: 'extractor-real' };
      } else if (eligibleForReviewedEvaluatorWaiver(teeth) && reviewedWaiver) {
        try {
          const waiver = readTeethWaiver(args['ct-repo'] as string, teeth.blueprintRef);
          teeth.readiness = {
            status: 'waived',
            proof: 'reviewed-evaluator-waiver',
            waiver: { reviewer: waiver.reviewer, rationale: waiver.rationale, evidenceRef: waiver.evidenceRef },
          };
        } catch (e) {
          readinessRefused = true;
          teeth.readiness = { status: 'refusal', proof: 'insufficient' };
          if (e instanceof TeethWaiverError) process.stderr.write(`::error::reviewed teeth waiver refused: ${e.message}\n`);
          else throw e;
        }
      } else {
        readinessRefused = true;
        teeth.readiness = { status: 'refusal', proof: 'insufficient' };
      }
    }
    const out = (args.out as string) || 'teeth-report.json';
    fs.writeFileSync(out, stableStringify(teeth));
    if (teeth.verdict === 'toothless') {
      process.stderr.write(`::error::blueprint ${teeth.blueprintRef} is TOOTHLESS — ${teeth.summary}\n`);
      for (const w of teeth.witnesses.filter((x) => x.verdict !== 'TOOTHED')) {
        process.stderr.write(`::error::  [${w.constraintId}/${w.type}] ${w.verdict}: ${w.mutation}\n`);
      }
    } else {
      process.stdout.write(`TeethReport: ${teeth.blueprintRef} -> ${teeth.verdict} — ${teeth.summary}\n`);
      // ONE warning line (not per-witness) when the blueprint has NO extractor-real teeth: the
      // exit stays 0 (not a falsification) but CI logs must never read this as a substance pass.
      if (teeth.verdict === 'evaluator-refutable') {
        process.stderr.write(
          `::warning::blueprint ${teeth.blueprintRef} has NO extractor-real teeth — ` +
            `${teeth.evaluatorRefutable} constraint(s) are evaluator-refutable only (synthetic-evidence ` +
            `mutations; NOT evidence of real teeth). Substance proof = a mutation corpus.\n`,
        );
      }
    }
    if (requireExtractorReal && teeth.readiness?.status === 'refusal') {
      process.stderr.write(
        `::error::enforcement readiness requires extractor-real teeth for every constraint; ` +
          `${teeth.toothed}/${teeth.witnesses.length} proven. Evaluator-only, trivial, or indeterminate witnesses are insufficient\n`,
      );
    }
    process.exit(teeth.verdict === 'toothless' || readinessRefused ? 2 : 0);
  }

  if (cmd === 'gate') {
    // The PR gate (D13). Discover blueprints, run those whose scope intersects the changed
    // files, fail (exit 1) on any non-pass. --changed <a,b,c> (repo-relative) scopes the run;
    // absent → full sweep. --blueprint-dir defaults to .blueprints. --all prints every violation
    // (default is the grouped per-constraint summary — SPEC §9.3).
    const repoDir = (args['repo'] as string) || (args['ct-repo'] as string) || '.';
    const blueprintDir = (args['blueprint-dir'] as string) || path.join(repoDir, '.blueprints');
    const showAll = args['all'] === true || args['all'] === 'true';
    const changedArg = args['changed'];
    const changed =
      typeof changedArg === 'string' && changedArg.length > 0
        ? changedArg.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
    // --repo-name stamps report.repo and fail-closed checks scope.repositories.
    const repoName = typeof args['repo-name'] === 'string' ? (args['repo-name'] as string) : undefined;
    // Mode doctrine (SPEC §9): the ADOPTION POSTURE comes from a COMMITTED config file
    // (`.bce-mode.json`), never a CLI flag. ABSENT config → enforced (byte-identical legacy path).
    // The mode changes ONLY the exit code + a banner + a legibility stamp; the verdict below is
    // computed identically either way (advisory is NOT a skip flag — nothing is suppressed).
    // Fail-closed: a malformed config is a LOUD error, never a silent default.
    let resolvedMode;
    try {
      resolvedMode = resolveMode(repoDir);
    } catch (e) {
      if (e instanceof ModeConfigError) die(e.message, 1);
      throw e;
    }
    // Baseline doctrine (SPEC §9.3): a COMMITTED `.blueprints/baseline.json` records a pre-existing
    // accepted violation set. ABSENT → null → enforce everything (byte-identical pre-baseline path).
    // Fail-closed: a malformed/hand-broken baseline is a LOUD error, never a silent "accept nothing"
    // (which would spuriously re-redden the whole wall) nor a silent "accept anything".
    let baseline;
    try {
      baseline = readBaseline(repoDir);
    } catch (e) {
      if (e instanceof BaselineError) die(e.message, 1);
      throw e;
    }
    const result = runGate(repoDir, blueprintDir, changed, extractorKind, repoName);
    // Partition every report's violations against the baseline: NEW violations always block;
    // BASELINED violations are reported (visible, counted) but non-blocking. A null baseline makes
    // every violation NEW → byte-identical to the pre-baseline gate (widen-only). The partition is
    // an EXIT overlay only — it never mutates a report's score or verdict (those are graded facts).
    const parts = partitionAgainstBaseline(result.reports, baseline);
    const partByRef = new Map(parts.map((p) => [p.blueprintRef, p]));
    // ADVISORY banner FIRST — unmissable, before the per-blueprint output, so it frames everything
    // the reader is about to see. Only in advisory mode (enforced is byte-silent on the legacy path).
    if (resolvedMode.mode === 'advisory') {
      process.stderr.write(`${ADVISORY_BANNER}\n`);
    }
    if (baseline !== null) {
      process.stderr.write(
        `▸ BASELINE ACTIVE (${BASELINE_RELPATH}, ${baseline.entries.length} accepted violation(s)) — ` +
          `NEW violations FAIL the gate; baselined ones are shown + counted but do NOT block. ` +
          `Shrink the wall with 'bce baseline' (it only ever removes).\n`,
      );
    }
    for (const w of result.warnings ?? []) {
      process.stderr.write(`::warning::${w}\n`);
    }
    let newViolationsTotal = 0;
    let baselinedTotal = 0;
    // A report BLOCKS the build iff it carries a NEW (un-baselined) violation OR it is a FAIL-CLOSED
    // REFUSAL. A refusal is a report whose graded verdict is `fail` but which produced NO violation
    // ROWS (an empty/partial scan below the floor, a malformed blueprint, a minEngineVersion miss) —
    // the engine could not honestly grade. A baseline can NEVER suppress a refusal: there is no
    // violation identity to accept, so it is not a "pre-existing accepted violation" — it always
    // blocks + prints FAILED (SPEC §7 fail-closed discipline, unchanged by the baseline overlay).
    const isRefusal = (r: (typeof result.reports)[number]): boolean =>
      r.verdict !== 'pass' && r.violations.length === 0;
    const blocks = (r: (typeof result.reports)[number]): boolean => {
      if (isRefusal(r)) return true;
      const p = partByRef.get(r.blueprintRef);
      return (p ? p.newViolations.length : r.violations.length) > 0;
    };
    for (const r of result.reports) {
      // Legibility stamp (SPEC §9): only when a config is EXPLICITLY present. An absent config leaves
      // the report byte-identical to the pre-mode engine (widen-only omit-not-empty). The stamp is a
      // posture label ONLY — it never touched the score/verdict/violations computed by runGate.
      if (resolvedMode.explicit) r.mode = resolvedMode.mode;
      const part = partByRef.get(r.blueprintRef);
      const newViolations = part ? part.newViolations : r.violations;
      const baselinedViolations = part ? part.baselinedViolations : [];
      newViolationsTotal += newViolations.length;
      baselinedTotal += baselinedViolations.length;
      if (r.verdict === 'pass') {
        // graded green: nothing to baseline, nothing blocking.
        process.stdout.write(`  ✓ ${r.blueprintRef} — score ${r.score} (pass)\n`);
      } else if (isRefusal(r)) {
        // FAIL-CLOSED REFUSAL — always blocks, never baselineable. Prints FAILED with the legible cause.
        process.stderr.write(`::error::blueprint ${r.blueprintRef} FAILED — score ${r.score}: ${r.summary}\n`);
      } else if (newViolations.length === 0) {
        // graded red, but every violation row is BASELINED → non-blocking. Loud + honest, never a
        // silent green: the score/verdict are the real graded fail; the baseline decides only blocking.
        process.stdout.write(
          `  ~ ${r.blueprintRef} — score ${r.score} (graded fail; all ${baselinedViolations.length} violation(s) BASELINED — non-blocking)\n`,
        );
        for (const line of renderViolations(baselinedViolations, showAll)) {
          process.stderr.write(`::warning::${line}\n`);
        }
      } else {
        process.stderr.write(
          `::error::blueprint ${r.blueprintRef} FAILED — score ${r.score}: ${newViolations.length} NEW violation(s)` +
            (baselinedViolations.length > 0 ? `, ${baselinedViolations.length} baselined` : '') +
            `. ${r.summary}\n`,
        );
        for (const line of renderViolations(newViolations, showAll)) {
          process.stderr.write(`::error::${line}\n`);
        }
        if (baselinedViolations.length > 0) {
          process.stderr.write(`::warning::  ${baselinedViolations.length} baselined violation(s) on this blueprint (non-blocking):\n`);
          for (const line of renderViolations(baselinedViolations, showAll)) {
            process.stderr.write(`::warning::${line}\n`);
          }
        }
      }
    }
    // The build-gate FAIL signal: a blueprint blocks if it has a NEW violation OR is a fail-closed
    // refusal (baseline narrows only the graded-violation reds; advisory then ungates the exit
    // entirely — composition: refusal always blocks → baseline narrows graded reds → advisory zeroes).
    const blockingBlueprints = result.reports.filter(blocks).length;
    const gateFailed = (result.refusals?.length ?? 0) > 0 ||
      (baseline !== null ? blockingBlueprints > 0 : result.failed);
    process.stdout.write(
      `bce gate [${resolvedMode.mode}]: ${result.blueprintsSelected}/${result.blueprintsDiscovered} blueprint(s) evaluated, ` +
        `${blockingBlueprints} failing` +
        (baseline !== null ? ` (${newViolationsTotal} new, ${baselinedTotal} baselined)` : '') +
        `.\n`,
    );
    // In advisory mode, restate the non-blocking exit LOUDLY when there is a real (new) red — so the
    // exit-0 is never read as "it passed". The verdict is unchanged; only the build-gate consequence is.
    if (resolvedMode.mode === 'advisory' && gateFailed && (result.refusals?.length ?? 0) === 0) {
      process.stderr.write(
        `::warning::ADVISORY MODE — ${blockingBlueprints} blueprint(s) have NEW violation(s) but the gate exits 0 (non-blocking). ` +
          `Graduate to enforced (bce graduate) to make these block.\n`,
      );
    }
    // ADDITIVE (OPTIONAL) machine-parseable side-channel — the agent/CI contract (SPEC §5, §7).
    // `--report-json <path>` serializes the SAME GateResult the gate already computed into one stable
    // document so a THIN consumer (the GitHub Action's PR-comment island, an MCP shell, an agent
    // self-correction loop) parses the verdict WITHOUT re-deriving it. It is a pure OUTPUT side
    // channel: the verdict, exit code, stdout/stderr annotations, and every graded fact below are
    // BYTE-IDENTICAL with or without the flag (widen-only — absent flag ⇒ pre-flag path unchanged).
    // Fail-closed: a write failure is a LOUD error (exit 1), never a silent skip — a consumer that
    // asked for the machine report must never proceed as if it got one.
    const doc = assembleGateReportDoc({
      resolvedMode,
      baseline,
      result,
      blockingBlueprints,
      newViolationsTotal,
      baselinedViolationsTotal: baselinedTotal,
      gateFailed,
    });
    for (const refusal of result.refusals ?? []) {
      process.stderr.write(`::error::${refusal}. Author one with 'bce author', or point --blueprint-dir at the right directory.\n`);
    }
    const reportJsonPath = typeof args['report-json'] === 'string' ? (args['report-json'] as string) : undefined;
    if (reportJsonPath) {
      // NO interpretation, NO re-computation: the doc is assembled by `assembleGateReportDoc` — the
      // SINGLE doc-construction site the THIN MCP `run_gate` tool (via computeGateReport) also uses.
      // Sharing that one assembler is what makes the CLI's machine report and the MCP shell's output
      // byte-identical BY CONSTRUCTION (COUNCIL-SYNTHESIS #20 — zero logic to diverge). The inputs
      // are exactly the graded facts the human render above already computed from the SAME run.
      try {
        fs.writeFileSync(reportJsonPath, stableStringify(doc));
      } catch (e) {
        die(`--report-json: could not write machine report to ${reportJsonPath}: ${(e as Error).message}`, 1);
      }
    }
    process.exit(doc.exitCode);
  }

  if (cmd === 'baseline') {
    // The shrink-only adoption lever (SPEC §9.3) — the ONE new v1 verb. Runs the SAME gate over the
    // tree, then writes `.blueprints/baseline.json` recording the CURRENT violation set as accepted.
    // The load-bearing property: the file ONLY EVER SHRINKS.
    //   bce baseline [--repo <dir>] [--blueprint-dir <dir>] [--changed a,b,c] [--extractor ...]
    //   bce baseline ... --dry-run     → compute + print the plan, write NOTHING (preview a shrink)
    //
    //  · FRESH CREATION (no baseline yet): records every current violation — the one path that can
    //    GROW the accepted set, and it is PR-visible (a new file appears in the diff).
    //  · SHRINK WRITE (a baseline already exists): keeps only entries whose violation still exists,
    //    auto-removes vanished ones, and REFUSES to add a current violation not already baselined.
    //    The result is always a SUBSET of the prior baseline. To GROW the wall you must delete the
    //    file and re-create it — a reviewed act, never a silent bump (the widen-only ratchet, SPEC §10.3).
    // Fail-closed everywhere: a malformed existing baseline is a LOUD error; a gate-run that cannot
    // honestly grade (a fail-closed refusal report) still contributes its violations to the plan.
    const repoDir = (args['repo'] as string) || (args['ct-repo'] as string) || '.';
    const blueprintDir = (args['blueprint-dir'] as string) || path.join(repoDir, '.blueprints');
    const dryRun = args['dry-run'] === true || args['dry-run'] === 'true';
    const checkOnly = args.check === true || args.check === 'true';
    const changedArg = args['changed'];
    const changed =
      typeof changedArg === 'string' && changedArg.length > 0
        ? changedArg.split(',').map((s) => s.trim()).filter(Boolean)
        : null;
    const repoName = typeof args['repo-name'] === 'string' ? (args['repo-name'] as string) : undefined;
    let existing;
    try {
      existing = readBaseline(repoDir);
    } catch (e) {
      if (e instanceof BaselineError) die(e.message, 1);
      throw e;
    }
    const result = runGate(repoDir, blueprintDir, changed, extractorKind, repoName);
    const plan = planBaselineWrite(result.reports, existing);
    const engine = resolveEngineVersion();

    if (checkOnly) {
      const checked = assessBaselineMaintenance(result.reports, existing, result.refusals).result;
      const checkOut = typeof args.out === 'string' ? (args.out as string) : undefined;
      const bytes = stableStringify(checked);
      if (checkOut) fs.writeFileSync(checkOut, bytes);
      const patchOut = typeof args['patch-out'] === 'string' ? (args['patch-out'] as string) : undefined;
      if (patchOut) {
        if (existing === null) die(`--patch-out requires an existing baseline; fresh creation is a human-reviewed policy act`, 2);
        const patch = renderBaselineShrinkPatch(existing, plan);
        fs.writeFileSync(patchOut, patch);
      }
      process.stdout.write(
        `BaselineCheck: ${checked.state} — ${checked.currentViolations} current, ${checked.removable} removable, ` +
          `${checked.unacceptedNew} unaccepted-new (exit ${checked.exitCode})\n`,
      );
      process.exit(checked.exitCode);
    }

    if (plan.hadExisting) {
      process.stdout.write(
        `bce baseline: SHRINK write (an existing baseline at ${BASELINE_RELPATH}) — ` +
          `${plan.kept.length} kept, ${plan.removed.length} auto-removed (violation gone). ` +
          `The baseline can only shrink; a re-write never adds.\n`,
      );
      if (plan.refused.length > 0) {
        process.stderr.write(
          `::warning::${plan.refused.length} current violation(s) are NOT in the baseline and were NOT added ` +
            `(a shrink write never grows). To accept them, DELETE ${BASELINE_RELPATH} and re-run 'bce baseline' ` +
            `(a PR-visible re-creation) — or fix them:\n`,
        );
        for (const line of renderViolations(
          plan.refused.map((e) => ({
            constraintId: e.constraintId,
            severity: e.severity,
            component: e.component,
            evidenceType: 'staticAst',
            evidenceRef: 'n/a',
            observed: `violation is present now but NOT in the baseline`,
            expected: `either fix it, or delete + re-create the baseline to accept it`,
          })),
          false,
        )) {
          process.stderr.write(`::warning::${line}\n`);
        }
      }
      for (const e of plan.removed) {
        process.stdout.write(`  - removed: [${e.constraintId}/${e.severity}] ${e.component} (${e.blueprintRef})\n`);
      }
    } else {
      process.stdout.write(
        `bce baseline: FRESH creation — recording ${plan.added.length} current violation(s) as the accepted ` +
          `pre-existing set. From now the gate ENFORCES: any NEW violation fails, these baselined ones do not.\n`,
      );
      for (const e of plan.added) {
        process.stdout.write(`  + accepted: [${e.constraintId}/${e.severity}] ${e.component} (${e.blueprintRef})\n`);
      }
    }

    if (dryRun) {
      process.stdout.write(`bce baseline: --dry-run — nothing written (plan above).\n`);
      return;
    }
    const written = writeBaseline(repoDir, plan, engine);
    process.stdout.write(
      `bce baseline: wrote ${plan.entries.length} accepted violation(s) → ${path.relative(repoDir, written) || BASELINE_RELPATH} ` +
        `(commit it; it is PR-reviewed and shrink-only).\n`,
    );
    return;
  }

  if (cmd === 'graduate') {
    // Mode-doctrine graduation ceremony (SPEC §9) — ONE-WAY + RECORDED.
    //   bce graduate [--repo <dir>]                     → advisory → enforced (the default, free)
    //   bce graduate --downgrade --rationale "<why>"    → enforced → advisory (REQUIRES a rationale)
    // Every transition appends an auditable entry to `.blueprints/GRADUATION.md`; the config file
    // (`.bce-mode.json`) is flipped to match. Tightening (advisory→enforced) is free; RELAXING
    // (enforced→advisory) is refused without the recorded rationale — the widen-only ratchet applied
    // to adoption posture (SPEC §9: a skip is always explicit; SPEC §10.3: gates tighten, never
    // silently relax). This is a ceremony verb, NOT a `gate` flag — the mode never becomes a bypass.
    const repoDir = (args['repo'] as string) || (args['ct-repo'] as string) || '.';
    const downgrade = args['downgrade'] === true || args['downgrade'] === 'true';
    let current: GateMode;
    try {
      current = resolveMode(repoDir).mode;
    } catch (e) {
      if (e instanceof ModeConfigError) die(e.message, 1);
      throw e;
    }
    const target: GateMode = downgrade ? 'advisory' : 'enforced';
    if (current === target) {
      // Idempotent no-op is honest, not an error — but it writes nothing (no phantom ceremony record).
      process.stdout.write(`bce graduate: already in '${target}' mode — no change, no record written.\n`);
      return;
    }
    // The rationale gate: a DOWNGRADE (enforced→advisory) MUST carry a rationale; a GRADUATE
    // (advisory→enforced) MAY. Both are recorded. Never a silent posture relax.
    const rationaleArg = typeof args['rationale'] === 'string' ? (args['rationale'] as string).trim() : '';
    if (downgrade && rationaleArg.length < 10) {
      die(
        `enforced → advisory is a RELAX of the gate — it REQUIRES --rationale "<why, >=10 chars>" ` +
          `so the downgrade is recorded in ${GRADUATION_RECORD_RELPATH} (never a silent skip).`,
        1,
      );
    }
    const direction: 'graduate' | 'downgrade' = downgrade ? 'downgrade' : 'graduate';
    const rationale =
      rationaleArg.length > 0
        ? rationaleArg
        : `Graduated to enforced: the gate now blocks the build on any non-pass verdict.`;
    const recordPath = appendGraduationRecord(repoDir, direction, current, target, rationale);
    const configPath = writeModeConfig(repoDir, target, path.relative(repoDir, recordPath) || GRADUATION_RECORD_RELPATH);
    const recorded = readGraduationRecord(repoDir);
    process.stdout.write(
      `bce graduate: ${current} → ${target}. Recorded in ${GRADUATION_RECORD_RELPATH} ` +
        `(${recorded.length} ceremony entr${recorded.length === 1 ? 'y' : 'ies'} total); ${MODE_CONFIG_BASENAME} updated.\n`,
    );
    void configPath;
    return;
  }

  if (cmd === 'portfolio') {
    // B2 — the fleet-level surface. Two subcommands, both fail-closed:
    //   bce portfolio compile --portfolio <file> [--out-dir <dir>]
    //   bce portfolio collect --registry <file> --reports-dir <dir>
    const sub = args._[1];

    if (sub === 'compile') {
      // Validate the authored PortfolioBlueprint (STRICT — exit 1 with zod detail on
      // any violation), lower it into per-member EngineeringBlueprint overlays, write each one
      // canonically (sorted keys, 2-space indent, trailing newline — byte-stable).
      const pPath = args.portfolio as string;
      if (typeof pPath !== 'string' || !fs.existsSync(pPath)) die(`--portfolio not found: ${pPath}`);
      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(pPath, 'utf8'));
      } catch (e) {
        die(`portfolio is not valid JSON: ${(e as Error).message}`);
      }
      let portfolio;
      try {
        portfolio = parsePortfolioBlueprint(raw);
      } catch (e) {
        die(`portfolio failed schema validation: ${(e as Error).message}`);
      }
      const outDir = typeof args['out-dir'] === 'string' ? (args['out-dir'] as string) : '.';
      fs.mkdirSync(outDir, { recursive: true });
      const overlays = compilePortfolio(portfolio);
      for (const { blueprint } of overlays) {
        const outPath = path.join(outDir, `${blueprint.metadata.id}.blueprint.json`);
        fs.writeFileSync(outPath, serializeBlueprintCanonical(blueprint));
      }
      process.stdout.write(`bce portfolio compile: ${overlays.length} member overlay(s) emitted\n`);
      return;
    }

    if (sub === 'collect') {
      // Join the consumer registry against per-repo report sinks
      // (<reports-dir>/<slug(repo)>/*.json) and roll up via the EXISTING aggregators.
      // Fail-closed (F-L1-1): refusal (exit 1) on a missing/extra repo or the minMembers floor.
      const regPath = args.registry as string;
      const reportsDir = args['reports-dir'] as string;
      if (typeof regPath !== 'string' || !fs.existsSync(regPath)) die(`--registry not found: ${regPath}`);
      if (typeof reportsDir !== 'string' || !fs.existsSync(reportsDir)) die(`--reports-dir not found: ${reportsDir}`);
      let registry;
      try {
        registry = PortfolioRegistrySchema.parse(JSON.parse(fs.readFileSync(regPath, 'utf8')));
      } catch (e) {
        die(`registry failed validation: ${(e as Error).message}`);
      }
      const reportsByRepo: Record<string, ComplianceReport[]> = {};
      for (const consumer of registry.consumers) {
        const sink = path.join(reportsDir, slugifyRepo(consumer.repo));
        if (!fs.existsSync(sink)) continue; // absent sink → 0 reports → the collector refuses, naming the repo
        const reports: ComplianceReport[] = [];
        for (const f of fs.readdirSync(sink).filter((n) => n.endsWith('.json')).sort()) {
          try {
            const parsed = JSON.parse(fs.readFileSync(path.join(sink, f), 'utf8')) as ComplianceReport;
            // light structural guard — a non-report JSON in the sink is a hard error, never skipped.
            if (typeof parsed?.blueprintRef !== 'string' || typeof parsed?.score !== 'number' || !Array.isArray(parsed?.violations)) {
              die(`not a ComplianceReport: ${path.join(sink, f)}`);
            }
            reports.push(parsed);
          } catch (e) {
            die(`unreadable report ${path.join(sink, f)}: ${(e as Error).message}`);
          }
        }
        reportsByRepo[consumer.repo] = reports;
      }
      const result = collectPortfolio({ registry, reportsByRepo });
      if (result.refused) {
        die(`portfolio collect REFUSED: ${result.reason}`);
      }
      const arch = architectureScore(result.boardInput.reports);
      process.stdout.write(
        `bce portfolio collect: ${result.envelopes.length} report(s) across ${result.boardInput.repositories} repo(s) — ` +
          `Architecture Score ${arch.overall} (${arch.passing}/${arch.total} subsystems passing)\n`,
      );
      for (const s of arch.subsystems) {
        process.stdout.write(`  ${s.verdict === 'pass' ? '✓' : '✗'} ${s.blueprintRef} — score ${s.score} (${s.verdict}), ${s.violationCount} violation(s)\n`);
      }
      return;
    }

    die(`unknown portfolio subcommand: ${String(sub)} (expected compile | collect)`);
  }

  process.stdout.write(
      `bce — Blueprint Conformance Engine\n\n` +
      `  bce demo [--list | --recipe <id|all>]  Package-only architecture RED/GREEN proofs\n` +
      `       No repository, account, configuration, network, or API key required. Zero arguments preserves the original extension-contract proof.\n` +
      `  bce doctor [--repo <dir>] [--blueprint-dir <dir>] [--out <json>]  Read-only lifecycle readiness audit\n` +
      `  bce adopt --repo <dir> --blueprint <draft.json> --engine bce-engine@<exact>  Minimal advisory proposal; never ratifies\n` +
      `  bce onboard --repo <dir> --blueprint <draft.json> --engine <package|owner/repo@40-char-sha>\n` +
      `       [--harness agents|claude|cursor|codex] [--agent-file <repo-relative>] [--mcp-config <repo-relative>]\n` +
      `       Full-stack proposal: policy + immutable CI + preserved agent context + project skills + MCP wiring.\n` +
      `  bce propose --repo <dir> --intent-file <path> --assistant openai-responses --assistant-model <exact> (--base <path> | --new)\n` +
      `       [--out .bce/proposals] [--governed-dir <repo-relative-dir>] [--max-context-files <n>] [--max-context-bytes <n>]\n` +
      `       AI drafts; BCE validates, extracts, classifies policy direction, and writes an immutable review packet to quarantine.\n` +
      `  bce review show --repo <dir> --packet <path> [--decision <path>] [--format text|json|html]\n` +
      `  bce review verify --repo <dir> --packet <path> [--decision <path>]\n` +
      `  bce review decide --repo <dir> --packet <path> --decision approve|reject|request-changes\n` +
      `       --github-repo <owner/name> --github-pull <n> --github-review <id>  Derives identity, rationale, and time from SCM.\n` +
      `       Requires BCE_GITHUB_TOKEN or GITHUB_TOKEN. Records only; never mutates policy.\n` +
      `  bce ratify --repo <dir> --blueprint <reviewed-draft> --packet <path> --decision <approved-decision.json> <GitHub selector>\n` +
      `  bce amend --repo <dir> --blueprint <current> --replacement <reviewed-draft> --packet <path> --decision <approved-decision.json> <GitHub selector>\n` +
      `       <GitHub selector> = --github-repo <owner/name> --github-pull <n> --github-review <id>.\n` +
      `       [--compatibility compatible|tightening|weakening]  Replays exact packet/decision bindings before policy mutation.\n` +
      `  bce upgrade --check --repo <dir> --candidate-engine X.Y.Z [--out <json>]  Read-only compatibility preflight\n` +
      `  bce verify-bundle --bundle <json>  Re-hash and re-evaluate; reports integrity, never origin authenticity\n` +
      `  bce author --id <id> --intent-ref <ref> --constraint "<type>:<arg>[:<severity>]"\n` +
      `       [--repository <org/repo>] [--repo <dir>] [--scope-paths <glob,glob>]\n` +
      `       [--extraction-profile next-route-handler|plugin-surface|typescript-module-graph|python-import-surface|python-module-graph] [--guard-symbol <sym>]\n` +
      `       [--tsconfig <repo-relative-file>] [--python-root <repo-relative-directory>] [--min-files <n>] [--name <name>] [--owner-role <r>] [--steward-role <r>] [--out <path>]\n` +
      `       (alias: bce init) Scaffold a schema-VALID draft blueprint (status draft, 0.1.0) —\n` +
      `       interactive-free, self-validating; with --repo, refuses (exit 2) a scope matching 0 files.\n` +
      `       --intent-ref / --constraint / --repository / --guard-symbol / --python-root are repeatable. Constraint grammar:\n` +
      `         forbiddenDependency:<module-or-target> | requiredDependency:<componentType> | requiredComponent:<componentType>\n` +
      `         module graph requiredDependency:<componentType>-><module:glob|package:root|builtin:name>\n` +
      `         forbiddenPath:<glob> | forbiddenEgress:<host,...> (blocklist) | forbiddenEgress:governed=<host,...> (allowlist)\n` +
      `         forbiddenFile:<glob> (raw scanned-file glob — export-shape-agnostic) | forbiddenPattern:<regex> (per-line content grep)\n` +
      `         behavioralInvariant:<behaviorRef> (runtime not-a-mock substance constraint)\n` +
      `         requiredEvidence:<evidenceType> | minimumMetric:<metric>=<number> | customPolicy:<policyRef>\n` +
      `       optional trailing :<severity> = info|low|medium|high|critical (default high)\n` +
      `  bce validate --blueprint <path>\n` +
      `  bce scan  --ct-repo <dir> [--blueprint <path>] [--ref <sha|ref>] [--extractor ast|line-scan] --out <path>\n` +
      `  bce run   --blueprint <path> --ct-repo <dir> [--ref <sha|ref>] [--extractor ast|line-scan] --out <path> [--emit-bundle <json>]\n` +
      `  bce teeth --blueprint <path> --ct-repo <dir> [--require-extractor-real] [--reviewed-waiver] [--out <path>]\n` +
      `       --require-extractor-real marks ready only when EVERY constraint has extractor-real teeth.\n` +
      `       --reviewed-waiver accepts evaluator-only remainder only via committed ${TEETH_WAIVER_RELPATH}.\n` +
      `       --mutation-manifest <json> [--require-all-extractor-real] materializes each declared source mutant\n` +
      `       in a fresh copy and requires the real extractor to redden every mapped constraint.\n` +
      `  bce gate  [--repo <dir>] [--blueprint-dir <dir>] [--changed a,b,c] [--extractor ast|line-scan] [--repo-name <org/repo>] [--all] [--report-json <path>]\n` +
      `       --report-json <path> ADDITIVELY writes the machine-parseable gate result (verdict, exit code,\n` +
      `       mode, counts, full graded reports) — a pure output side-channel; the verdict + exit + streams\n` +
      `       are byte-identical with or without it. This is the agent/Action/MCP contract (SPEC §5).\n` +
      `       Adoption posture comes from a COMMITTED ${MODE_CONFIG_BASENAME} ({"mode":"enforced"|"advisory"}),\n` +
      `       NEVER a flag. enforced (default, and when the file is absent) = non-pass fails the build;\n` +
      `       advisory = the SAME full verdict is printed with an unmissable banner + a machine-readable\n` +
      `       report "mode" field, but the gate exits 0. Advisory is an adoption posture, NOT a skip flag.\n` +
      `       A committed ${BASELINE_RELPATH} (see 'bce baseline') keeps the gate ENFORCING but only NEW\n` +
      `       violations block; baselined ones are shown + counted, never hidden. Violation output is\n` +
      `       grouped per-constraint by default; --all prints every violation with observed-vs-expected +\n` +
      `       the anchor + both remediation paths (fix the code / amend the blueprint via PR).\n` +
      `  bce baseline [--repo <dir>] [--blueprint-dir <dir>] [--changed a,b,c] [--extractor ...] [--dry-run]\n` +
      `       --check [--out <json>] [--patch-out <diff>] reports typed clean | shrink-needed | unaccepted-new | refusal;\n` +
      `       Write a shrink-only, PR-reviewed ${BASELINE_RELPATH} of the CURRENT violations (the burndown\n` +
      `       wall). Fresh creation records them all; a re-write can only REMOVE (auto-drops vanished ones,\n` +
      `       refuses to add). To GROW the wall, delete the file and re-create (PR-visible). --dry-run previews.\n` +
      `  bce graduate [--repo <dir>]                    Ceremony: advisory → enforced (one-way, recorded in\n` +
      `       ${GRADUATION_RECORD_RELPATH}). Downgrade: bce graduate --downgrade --rationale "<why>"\n` +
      `       (enforced → advisory is REFUSED without a recorded rationale — never a silent relax).\n` +
      `  bce portfolio compile --portfolio <file> [--out-dir <dir>]\n` +
      `  bce portfolio collect --registry <file> --reports-dir <dir>\n`,
  );
  if (cmd && cmd !== 'help') process.exit(1);
}

void main().catch((error: unknown) => {
  die(`unexpected CLI failure: ${(error as Error).message}`, 2);
});
