/**
 * `bce gate` — the blueprint-conformance PR GATE (the D13 anti-shelfware mechanism).
 *
 * This is the piece that turns the engine into an operating-model gate: an operator authors a
 * blueprint (e.g. `luna-chat-extension`) declaring a subsystem's intended architecture; a
 * contributor (e.g. Sam) implements against it; the contributor's PR runs `bce gate`, which:
 *
 *   1. discovers every authored blueprint under a repo's blueprint dir
 *      (default `.blueprints/*.blueprint.json`);
 *   2. selects the blueprints whose `scope.paths` intersect the PR's changed files
 *      (so an unrelated PR is not gated by an unrelated blueprint);
 *   3. runs `bce run` for each selected blueprint against the repo tree;
 *   4. fails the gate (exit 1) if ANY selected blueprint scores a non-pass verdict,
 *      emitting a `::error::` per violation so CI surfaces the exact drift.
 *
 * If `--changed` is omitted, ALL discovered blueprints run (a full-surface sweep — the
 * scheduled/anti-shelfware mode). Fail-closed: a malformed blueprint is a gate failure, never
 * a silent pass (a stale gate must not go green).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { constraintEvidenceClass, parseBlueprintTolerant, type EngineeringBlueprint } from './schema.js';
import { resolveExtraction } from './extractors.js';
import { makeExtractor } from './extractor-registry.js';
import { evaluate, type ComplianceReport } from './report.js';
import { resolveFiles } from './extractors.js';
import { resolveMode, exitCodeForGate, type GateMode, type ResolvedMode } from './mode.js';
import { readBaseline, partitionAgainstBaseline, type BaselineFile } from './baseline.js';

export interface GateResult {
  blueprintsDiscovered: number;
  blueprintsSelected: number;
  reports: ComplianceReport[];
  failed: boolean;
  /**
   * Structural reasons the gate could not honestly grade. Refusals are never
   * softened by advisory mode or a baseline and map to process exit 2 on every
   * interface. Omitted when the run was fully gradeable.
   */
  refusals?: string[];
  /**
   * Non-blocking diagnostic warnings. Repository identity mismatches are refusals.
   */
  warnings?: string[];
  /**
   * Count of RUN-ONLY constraints the static gate could not grade. Every such constraint creates
   * a refusal, so this counter can never coexist with an honest pass.
   */
  runOnlySkipped?: number;
  /**
   * ADDITIVE (FIX-E a, OPTIONAL — omit-when-0, mirroring `warnings?`): the count of constraint
   * entries DROPPED at parse time because their `type` is unknown to THIS pinned engine. Every
   * such entry creates a refusal; known constraints may still be evaluated for useful diagnostics.
   */
  unknownConstraintsSkipped?: number;
}

/**
 * Resolve the HEAD sha of the scanned tree when it is a git repo (gate-mode
 * REVISION HONESTY — the sha is a fact of the tree, so determinism holds: same tree, same sha).
 * Any git failure (not a repo, no commits, git absent) falls back to the historical 'unpinned'
 * label — the 0.2.x behavior, so non-git consumers (CI tarballs, test temp dirs) are unchanged.
 * NOTE: the gate scans the WORKING TREE in place; the HEAD sha does not encode uncommitted
 * changes — it is the best honest provenance available in gate mode (the pinned `bce run` path
 * via `materializeAtRevision` remains the canonical fully-deterministic mode).
 */
export function resolveTreeRevision(repoDir: string): string {
  try {
    const out = execFileSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : 'unpinned';
  } catch {
    return 'unpinned';
  }
}

/**
 * The directory this module runs from, resolved across BOTH build formats (FIX-E b). The package
 * dual-ships ESM (`dist/index.js` — `import.meta.url` is real) and CJS (`dist/index.cjs` —
 * esbuild rewrites `import.meta` to an empty shim, so `.url` is undefined and the CJS-native
 * `__dirname` carries instead). Under vitest (src, ESM transform) the import.meta branch fires.
 */
function engineModuleDir(): string {
  try {
    const url = import.meta.url;
    if (typeof url === 'string' && url.startsWith('file:')) return path.dirname(fileURLToPath(url));
  } catch {
    /* fall through to the CJS branch */
  }
  return typeof __dirname === 'string' ? __dirname : process.cwd();
}

/**
 * Resolve THIS engine's own version at runtime (FIX-E b) — the package.json of
 * `bce-engine`, found by walking up from the module dir (src/ and dist/
 * both sit exactly one level below the package root; the short walk keeps it honest if the build
 * layout ever nests deeper). FAIL-CLOSED floor: an unresolvable version returns '0.0.0', which
 * compares BELOW every authored `minEngineVersion` pin — an engine that cannot prove its own
 * version must never silently grade a blueprint that demands a minimum (widen-only ratchet).
 */
export function resolveEngineVersion(): string {
  let dir = engineModuleDir();
  for (let i = 0; i < 4; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
        name?: unknown;
        version?: unknown;
      };
      if (
        pkg.name === 'bce-engine' &&
        typeof pkg.version === 'string' &&
        /^\d+\.\d+\.\d+/.test(pkg.version)
      ) {
        return pkg.version;
      }
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return '0.0.0';
}

/** Numeric x.y.z compare (no deps): is `a` strictly below `b`? Missing parts read as 0. */
export function semverLt(a: string, b: string): boolean {
  const parts = (s: string): number[] => s.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const [a0 = 0, a1 = 0, a2 = 0] = parts(a);
  const [b0 = 0, b1 = 0, b2 = 0] = parts(b);
  if (a0 !== b0) return a0 < b0;
  if (a1 !== b1) return a1 < b1;
  return a2 < b2;
}

/**
 * Peek `minEngineVersion` off the RAW (pre-schema-parse) artifact (FIX-E b). Peeked BEFORE the
 * full parse deliberately: the whole point of the pin is a FUTURE blueprint this engine may not
 * even be able to parse — the operator must see "upgrade the pinned engine", not a zod enum
 * trace. A present-but-malformed pin returns null here and the schema parse rejects it
 * downstream (fail-closed — a bad pin never silently bypasses the version gate into a grade).
 */
function peekMinEngineVersion(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as Record<string, unknown>).minEngineVersion;
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v : null;
}

/** Recursively find `*.blueprint.json` under a dir. */
export function discoverBlueprints(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...discoverBlueprints(abs));
    } else if (entry.isFile() && entry.name.endsWith('.blueprint.json')) {
      out.push(abs);
    }
  }
  return out.sort();
}

/**
 * Does this blueprint's scope intersect any of the changed files? A blueprint with a `scope.paths`
 * glob (or its `extraction.paths`) is selected if any changed file matches. Absent changed set →
 * always selected (full sweep).
 */
export function blueprintTouchesChanges(
  repoDir: string,
  bp: EngineeringBlueprint,
  changed: string[] | null,
): boolean {
  if (changed === null) return true;
  const patterns = bp.extraction?.paths ?? bp.scope.paths ?? [];
  if (patterns.length === 0) return true; // no path scoping declared → conservative: run it
  // Match each changed file against the blueprint's globs (repo-relative).
  const matchers = patterns.map(globToRe);
  return changed.some((c) => {
    const rel = c.replace(/^\.?\//, '');
    return matchers.some((re) => re.test(rel));
  });
}

function globToRe(glob: string): RegExp {
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
 * Run the gate. `repoDir` is the tree to scan IN PLACE (the CI checkout). `blueprintDir` is
 * where authored blueprints live. `changed` is the PR's changed-file list (repo-relative) or
 * null for a full sweep. `extractorKind` selects ast|line-scan.
 */
export function runGate(
  repoDir: string,
  blueprintDir: string,
  changed: string[] | null,
  extractorKind: 'ast' | 'line-scan',
  /**
   * ADDITIVE (OPTIONAL): the repo identity the caller believes it is gating
   * (e.g. `example-org/service-alpha`). When provided it is stamped as `report.repo` on every
   * emitted report AND checked against each selected blueprint's `scope.repositories`. A mismatch
   * is a refusal because a report attributed to the wrong repository cannot prove applicability.
   */
  repoName?: string,
): GateResult {
  const files = discoverBlueprints(blueprintDir);
  const reports: ComplianceReport[] = [];
  const warnings: string[] = [];
  const refusals: string[] = [];
  let selected = 0;
  // FIX-B / FIX-E skip counters — every skip below is ALSO an explicit warnings line; the counters
  // surface omit-when-0 on the GateResult (mirroring `warnings?`) so a consumer can assert
  // "nothing was skipped" without string-grepping.
  let runOnlySkippedTotal = 0;
  let unknownSkippedTotal = 0;
  // Revision honesty: a git tree reports its real HEAD sha, a non-git tree keeps
  // the historical 'unpinned' label. Resolved ONCE per gate run (one tree, one fact).
  const revision = resolveTreeRevision(repoDir);
  // omit-not-empty spread for the additive repo tag on hand-built (fail-closed) reports.
  const repoTag = repoName !== undefined ? { repo: repoName } : {};
  // FIX-E b: this engine's own version, resolved ONCE per gate run (one engine, one fact).
  const engineVersion = resolveEngineVersion();

  if (files.length === 0) {
    refusals.push(
      `fail-closed: 0 blueprint(s) discovered under ${blueprintDir} — a repository that gates nothing has proven nothing`,
    );
  }

  for (const bpPath of files) {
    let bp: EngineeringBlueprint;
    let unknownSkipped: { id: string; type: string }[];
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(bpPath, 'utf8'));
      // FIX-E b: minEngineVersion honesty gate — peeked from the RAW artifact BEFORE the schema
      // parse (a future blueprint may be unparseable by this engine; the operator must see the
      // version cause, not a zod enum trace). Mirrors the malformed-parse shape: a version-refused
      // blueprint fails the gate regardless of changed-file selection (fail-closed precedent).
      const pin = peekMinEngineVersion(raw);
      if (pin !== null && semverLt(engineVersion, pin)) {
        reports.push({
          schemaVersion: '1',
          blueprintRef: path.basename(bpPath),
          ctRepoRevision: revision,
          score: 0,
          verdict: 'fail',
          violations: [],
          evidenceRef: 'n/a',
          summary: `blueprint requires engine >= ${pin}, gate is running ${engineVersion} — upgrade the pinned engine`,
          coverage: {
            extractor: 'ast',
            filesScanned: 0,
            unsupported: [`engine ${engineVersion} is below the blueprint's minEngineVersion ${pin} — no scan performed`],
          },
          ...repoTag,
        });
        selected += 1;
        continue;
      }
      // FIX-E a: GATE-MODE tolerant parse — an unknown (newer) constraint type is dropped +
      // surfaced, never a whole-file parse-reject; any OTHER malformation still throws into the
      // fail-closed branch below. `bce run` keeps STRICT parseBlueprint (the authoritative grader).
      const tolerant = parseBlueprintTolerant(raw);
      bp = tolerant.blueprint;
      unknownSkipped = tolerant.unknownConstraintsSkipped;
    } catch (e) {
      // fail-closed: a malformed blueprint is a gate failure, never a silent skip.
      reports.push({
        schemaVersion: '1',
        blueprintRef: path.basename(bpPath),
        ctRepoRevision: revision,
        score: 0,
        verdict: 'fail',
        violations: [],
        evidenceRef: 'n/a',
        summary: `blueprint failed to parse: ${(e as Error).message}`,
        coverage: { extractor: 'ast', filesScanned: 0, unsupported: ['blueprint did not parse — no scan performed'] },
        ...repoTag,
      });
      selected += 1;
      continue;
    }
    if (!blueprintTouchesChanges(repoDir, bp, changed)) continue;
    selected += 1;
    // Unknown types may be omitted from diagnostic evaluation, but never from the gate outcome.
    // The current engine cannot prove the whole blueprint, so this is a structural refusal.
    for (const s of unknownSkipped) {
      const reason =
        `unknown constraint type '${s.type}' (id ${s.id}) is not gradeable by engine ${engineVersion}; ` +
        `upgrade the gate pin`;
      warnings.push(reason);
      refusals.push(
        `${bp.metadata.id}@${bp.metadata.version}: ${reason}`,
      );
    }
    unknownSkippedTotal += unknownSkipped.length;
    // Repository identity is part of applicability, not display metadata.
    if (repoName !== undefined && !bp.scope.repositories.includes(repoName)) {
      refusals.push(
        `blueprint ${bp.metadata.id} declares scope.repositories [${bp.scope.repositories.join(', ')}] ` +
          `but the gate is running as '${repoName}'`,
      );
    }
    // Runtime constraints require bound observations. A static-only gate cannot prove them and
    // therefore refuses, while still evaluating any static subset for useful diagnostics.
    const staticConstraints = bp.constraints.filter((c) => constraintEvidenceClass(c.type) === 'staticAst');
    const runOnly = bp.constraints.filter((c) => constraintEvidenceClass(c.type) === 'behaviorObservation');
    for (const c of runOnly) {
      const reason =
        `run-only constraint ${c.id} (${c.type}) is not gradeable in static gate mode; ` +
        `use bce run --observations with revision-bound runtime evidence`;
      warnings.push(reason);
      refusals.push(
        `${bp.metadata.id}@${bp.metadata.version}: ${reason}`,
      );
    }
    runOnlySkippedTotal += runOnly.length;
    if (staticConstraints.length === 0) {
      // ALL-BEHAVIORAL blueprint: emit a refusal-shaped diagnostic report. `refusals` is the
      // canonical outcome; score 0/fail prevents older report-only consumers from seeing green.
      reports.push({
        schemaVersion: '1',
        blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`,
        ctRepoRevision: revision,
        score: 0,
        verdict: 'fail',
        violations: [],
        evidenceRef: 'n/a',
        summary:
          `0 static constraint(s) graded in gate mode; ${runOnly.length} run-only constraint(s) ` +
          `skipped (graded only by bce run --observations)` +
          (unknownSkipped.length > 0
            ? `; ${unknownSkipped.length} unknown constraint type(s) skipped (upgrade the gate pin)`
            : '') +
          ` — gate REFUSED`,
        coverage: {
          extractor: extractorKind,
          filesScanned: 0,
          unsupported: runOnly.map(
            (c) => `run-only constraint '${c.id}' (${c.type}) is not gradeable in gate mode — graded only by bce run --observations`,
          ),
        },
        ...repoTag,
      });
      continue;
    }
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    // refuse line-scan for any governed-modules blueprint (see cli.ts) — fail the gate
    // LOUD with guidance rather than false-reject a conformant PR on the fallback extractor.
    if (extractorKind === 'line-scan' && cfg.governedModules.length > 0) {
      reports.push({
        schemaVersion: '1', blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`, ctRepoRevision: revision,
        score: 0, verdict: 'fail', violations: [], evidenceRef: 'n/a',
        summary: `line-scan cannot honor governedModules — re-run with --extractor ast`,
        coverage: { extractor: 'line-scan', filesScanned: 0, unsupported: ['governedModules require the ast extractor'] },
        ...repoTag,
      });
      continue;
    }
    // b1/egress — same LOUD refusal as cli.ts: line-scan cannot resolve a fetch() host, so it
    // must never silently score a forbiddenEgress blueprint as a pass. (rebase-merge: keep the
    // forbiddenEgress guard AND adopt B2's revision-honesty + repoTag so the refusal report is
    // revision-anchored and repo-attributed like every other report in this loop.)
    if (extractorKind === 'line-scan' && cfg.egressEnabled) {
      reports.push({
        schemaVersion: '1', blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`, ctRepoRevision: revision,
        score: 0, verdict: 'fail', violations: [], evidenceRef: 'n/a',
        summary: `forbiddenEgress requires --extractor ast; line-scan cannot resolve fetch hosts`,
        coverage: { extractor: 'line-scan', filesScanned: 0, unsupported: ['forbiddenEgress requires the ast extractor'] },
        ...repoTag,
      });
      continue;
    }
    // python-import-surface has NO egress support at all (its single provider resolves no hosts,
    // under either kind flag) — same LOUD refusal discipline: never silently score a
    // forbiddenEgress blueprint as a pass on a surface that cannot observe egress.
    if (cfg.profile === 'python-import-surface' && cfg.egressEnabled) {
      reports.push({
        schemaVersion: '1', blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`, ctRepoRevision: revision,
        score: 0, verdict: 'fail', violations: [], evidenceRef: 'n/a',
        summary: `forbiddenEgress is not supported by the python-import-surface profile`,
        coverage: { extractor: 'line-scan', filesScanned: 0, unsupported: ['forbiddenEgress is not supported by the python-import-surface profile'] },
        ...repoTag,
      });
      continue;
    }
    let graph;
    try {
      graph = makeExtractor(extractorKind, cfg).extract(repoDir, revision);
    } catch (e) {
      reports.push({
        schemaVersion: '1',
        blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`,
        ctRepoRevision: revision,
        score: 0,
        verdict: 'fail',
        violations: [],
        evidenceRef: 'n/a',
        summary: `extractor refused: ${(e as Error).message}`,
        coverage: { extractor: extractorKind, filesScanned: 0, unsupported: [(e as Error).message] },
        ...repoTag,
      });
      continue;
    }
    // fail-closed on an empty/partial scan (a stale glob would else score 100).
    if (graph.coverage.filesScanned < cfg.minFiles) {
      reports.push({
        schemaVersion: '1',
        blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`,
        ctRepoRevision: revision,
        score: 0,
        verdict: 'fail',
        violations: [],
        evidenceRef: 'n/a',
        summary: `fail-closed: scanned ${graph.coverage.filesScanned} file(s), expected >= ${cfg.minFiles} for '${cfg.profile}'`,
        coverage: { extractor: graph.coverage.extractor, filesScanned: graph.coverage.filesScanned, unsupported: graph.coverage.unsupported },
        ...repoTag,
      });
      continue;
    }
    // FIX-B: grade the STATIC subset exactly as today (a blueprint with zero run-only constraints
    // passes an identical object through — byte-identical reports on the pre-FIX-B path). When
    // run-only/unknown constraints were skipped, the report SUMMARY names the counts — the skip is
    // legible on the per-blueprint artifact, not only in the GateResult warnings.
    const staticBp: EngineeringBlueprint = { ...bp, constraints: staticConstraints };
    const report = evaluate(staticBp, graph, cfg.profile, repoName);
    if (runOnly.length > 0) {
      report.summary += `; ${runOnly.length} run-only constraint(s) skipped in gate mode (graded only by bce run --observations)`;
    }
    if (unknownSkipped.length > 0) {
      report.summary += `; ${unknownSkipped.length} unknown constraint type(s) skipped (upgrade the gate pin)`;
    }
    reports.push(report);
  }

  if (files.length > 0 && selected === 0) {
    refusals.push(
      `fail-closed: 0 of ${files.length} discovered blueprint(s) selected for the supplied change set — no conformance policy was evaluated`,
    );
  }

  const failed = refusals.length > 0 || reports.some((r) => r.verdict !== 'pass');
  return {
    blueprintsDiscovered: files.length,
    blueprintsSelected: selected,
    reports,
    failed,
    ...(refusals.length > 0 ? { refusals } : {}),
    // omit-not-empty: absent unless something was actually warned (pre-B2 shape preserved).
    ...(warnings.length > 0 ? { warnings } : {}),
    // omit-when-0 (FIX-B / FIX-E a): the skip counters mirror the `warnings?` additive precedent —
    // absent on the pre-existing path, so no pre-existing serialized GateResult byte changes.
    ...(runOnlySkippedTotal > 0 ? { runOnlySkipped: runOnlySkippedTotal } : {}),
    ...(unknownSkippedTotal > 0 ? { unknownConstraintsSkipped: unknownSkippedTotal } : {}),
  };
}

/**
 * The machine-parseable gate document (SPEC §5, §7) — the STABLE agent/CI contract that the CLI's
 * `gate --report-json <path>` serializes and the THIN GitHub Action + THIN MCP server consume.
 *
 * schemaVersion is semver-gated + WIDEN-ONLY: fields are only ever added, never removed nor
 * repurposed, so an agent self-correction loop that parses `gateFailed`/`exitCode`/`reports[]`
 * keeps working across engine minors.
 */
export interface GateReportDoc {
  schemaVersion: '1';
  mode: GateMode;
  modeExplicit: boolean;
  baselineActive: boolean;
  blueprintsDiscovered: number;
  blueprintsSelected: number;
  blockingBlueprints: number;
  newViolationsTotal: number;
  baselinedViolationsTotal: number;
  gateFailed: boolean;
  /** Canonical three-state gate outcome. */
  outcome: 'pass' | 'violation' | 'refusal';
  /** Structural refusal reasons. Empty on pass/violation. */
  refusals: string[];
  exitCode: 0 | 1 | 2;
  warnings: string[];
  reports: ComplianceReport[];
}

/** The full composed gate outcome: the machine doc PLUS the graded facts a rich caller (the CLI's
 * human render) also needs. THIN consumers use only `.doc`. */
export interface ComputedGate {
  doc: GateReportDoc;
  resolvedMode: ResolvedMode;
  baseline: BaselineFile | null;
  result: GateResult;
}

/**
 * Assemble the machine gate document from already-computed gate intermediates — the SINGLE place a
 * `GateReportDoc` is ever constructed. Both `computeGateReport` (the THIN MCP / one-call path) AND
 * the CLI's `gate --report-json` handler (which needs the same intermediates for its rich human
 * render, so it cannot delegate the whole run) call THIS. That is what makes the machine verdict the
 * two surfaces emit byte-identical BY CONSTRUCTION — a field added here reaches both surfaces at
 * once, so the MCP shell can never silently diverge from the CLI (COUNCIL-SYNTHESIS #20).
 *
 * Pure + total: it derives fields only from its inputs, throws nothing, and does NOT re-run the gate.
 */
export function assembleGateReportDoc(args: {
  resolvedMode: ResolvedMode;
  baseline: BaselineFile | null;
  result: GateResult;
  blockingBlueprints: number;
  newViolationsTotal: number;
  baselinedViolationsTotal: number;
  gateFailed: boolean;
}): GateReportDoc {
  const { resolvedMode, baseline, result, blockingBlueprints, newViolationsTotal, baselinedViolationsTotal } = args;
  const reportRefusals = result.reports
    .filter((r) => r.verdict !== 'pass' && r.violations.length === 0)
    .map((r) => r.summary);
  const refusals = [...new Set([...(result.refusals ?? []), ...reportRefusals])];
  const gateFailed = args.gateFailed || refusals.length > 0;
  const outcome: GateReportDoc['outcome'] = refusals.length > 0
    ? 'refusal'
    : gateFailed
      ? 'violation'
      : 'pass';
  const exitCode: GateReportDoc['exitCode'] = outcome === 'refusal'
    ? 2
    : exitCodeForGate(gateFailed, resolvedMode.mode);
  return {
    schemaVersion: '1',
    mode: resolvedMode.mode,
    modeExplicit: resolvedMode.explicit,
    baselineActive: baseline !== null,
    blueprintsDiscovered: result.blueprintsDiscovered,
    blueprintsSelected: result.blueprintsSelected,
    blockingBlueprints,
    newViolationsTotal,
    baselinedViolationsTotal,
    gateFailed,
    outcome,
    refusals,
    exitCode,
    warnings: result.warnings ?? [],
    reports: result.reports,
  };
}

/**
 * Compose a gate run into its machine document — the SINGLE source of the `--report-json` shape.
 *
 * This is the "zero logic to diverge" seam (COUNCIL-SYNTHESIS #20): the THIN MCP `run_gate` tool
 * calls THIS one-shot composition, and both this and the CLI's `gate --report-json` handler build
 * their machine doc through the SINGLE shared `assembleGateReportDoc` assembler — so there is no
 * second place a gate verdict is assembled and the two surfaces are byte-identical by construction.
 * Every graded fact (verdict, exit code, mode, baseline partition counts, the full reports[]) is
 * produced by the SAME `runGate` + `resolveMode` + `readBaseline` + `partitionAgainstBaseline` calls
 * the CLI runs. (The CLI cannot delegate the WHOLE run — it needs the intermediates for its rich
 * human render — so the shared unit is the doc ASSEMBLER, not this one-shot wrapper.)
 *
 * FAIL-CLOSED (unchanged from the CLI): a malformed `.bce-mode.json` throws `ModeConfigError`, a
 * hand-broken `.blueprints/baseline.json` throws `BaselineError`. This helper does NOT swallow them
 * — the caller maps the throw to its own surface (the CLI `die()`s with the message + exit code;
 * the MCP shell returns a JSON-RPC error). A consumer NEVER receives a doc it did not fail-close on.
 *
 * @param repoDir       the repository tree to gate (the `--repo`/`--ct-repo` target).
 * @param blueprintDir  the authored-blueprint directory (default `<repoDir>/.blueprints`).
 * @param changed       repo-relative changed-file scope, or null for a full sweep.
 * @param extractorKind 'ast' (faithful, default) or 'line-scan' (no symbol table).
 * @param repoName      optional repo identity → stamps `report.repo` and fail-closed checks
 *                      `scope.repositories` (absent leaves identity unverified).
 */
export function computeGateReport(
  repoDir: string,
  blueprintDir: string,
  changed: string[] | null,
  extractorKind: 'ast' | 'line-scan',
  repoName?: string,
): ComputedGate {
  // Mode doctrine (SPEC §9): the ADOPTION POSTURE comes from a COMMITTED `.bce-mode.json`, never a
  // flag. ABSENT config → enforced (byte-identical legacy path). Throws ModeConfigError on malformed.
  const resolvedMode = resolveMode(repoDir);
  // Baseline doctrine (SPEC §9.3): a COMMITTED `.blueprints/baseline.json` records the pre-existing
  // accepted set. ABSENT → null → enforce everything. Throws BaselineError on malformed.
  const baseline = readBaseline(repoDir);
  const result = runGate(repoDir, blueprintDir, changed, extractorKind, repoName);

  // Partition every report's violations against the baseline: NEW violations block; BASELINED ones
  // are counted but non-blocking. A null baseline makes every violation NEW (widen-only).
  const parts = partitionAgainstBaseline(result.reports, baseline);
  const partByRef = new Map(parts.map((p) => [p.blueprintRef, p]));

  // A report BLOCKS iff it carries a NEW (un-baselined) violation OR is a FAIL-CLOSED REFUSAL (a
  // graded fail that produced NO violation ROWS — empty/partial scan, malformed blueprint,
  // minEngineVersion miss). A baseline can NEVER suppress a refusal (no violation identity to
  // accept) — it always blocks (SPEC §7 fail-closed discipline).
  const isRefusal = (r: ComplianceReport): boolean => r.verdict !== 'pass' && r.violations.length === 0;
  const blocks = (r: ComplianceReport): boolean => {
    if (isRefusal(r)) return true;
    const p = partByRef.get(r.blueprintRef);
    return (p ? p.newViolations.length : r.violations.length) > 0;
  };

  let newViolationsTotal = 0;
  let baselinedTotal = 0;
  for (const r of result.reports) {
    const part = partByRef.get(r.blueprintRef);
    newViolationsTotal += (part ? part.newViolations : r.violations).length;
    baselinedTotal += part ? part.baselinedViolations.length : 0;
    // Legibility stamp (SPEC §9) — mirrors the CLI: ONLY when a config is EXPLICITLY present, so an
    // absent config leaves the report byte-identical to the pre-mode engine (widen-only).
    if (resolvedMode.explicit) r.mode = resolvedMode.mode;
  }

  const blockingBlueprints = result.reports.filter(blocks).length;
  // advisory ungates the exit entirely → the composition is: refusal always blocks → baseline
  // narrows the graded reds → advisory zeroes. `gateFailed` is the REAL build-gate signal.
  const gateFailed = (result.refusals?.length ?? 0) > 0 ||
    (baseline !== null ? blockingBlueprints > 0 : result.failed);

  const doc = assembleGateReportDoc({
    resolvedMode,
    baseline,
    result,
    blockingBlueprints,
    newViolationsTotal,
    baselinedViolationsTotal: baselinedTotal,
    gateFailed,
  });

  return { doc, resolvedMode, baseline, result };
}
