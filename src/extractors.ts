/**
 * The RepositoryFactsExtractor implementations — the net-new engine (primitive #2),
 * now BLUEPRINT-DRIVEN.
 *
 * The engine is no longer hardcoded to one subsystem. The scan targets (globs) and the
 * symbols it treats as component-defining / guard-defining come from the blueprint's
 * optional `extraction` block. Two profiles ship:
 *
 *  - `next-route-handler` (the ORIGINAL walking-skeleton behavior): exported HTTP-verb
 *    handlers in Next.js `route.ts` files are components; bare-identifier `requireTenant*`
 *    CALL expressions in a handler body are `guards` edges. When a blueprint carries NO
 *    `extraction` block, this profile runs with the historical CT-ontology route globs +
 *    `requireTenant*` guard set — so the `control-tower-ontology` architecture graph + score/verdict
 *    are byte-identical (widen-only ratchet: the proven path is preserved). The ComplianceREPORT gained
 *    one additive `coverage` envelope field vs the pre-generalization baseline; the graph content-hash
 *    (evidenceRef) and the score/verdict/violations are unchanged.
 *  - `plugin-surface` (NEW): an agent-host ExtensionFactory surface. An exported extension
 *    factory (an exported `const`/`function` whose name ends `Extension` OR a default export)
 *    is a component; a bare-identifier call to any `provideSymbols` symbol (e.g.
 *    `registerTool`) INSIDE the factory body is a `provides` edge; a forbidden module
 *    IMPORT (from the blueprint's `forbiddenImports`) is a forbidden `imports` edge.
 *
 * Both profiles emit the SAME ArchitectureGraph shape → the diff/report never knows which
 * ran. Each extractor honestly declares its fidelity limits in `coverage.unsupported`.
 *
 * Determinism: no wall-clock, all arrays sorted before return; glob resolution is sorted.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Project, SyntaxKind, type CallExpression, type FunctionDeclaration, type NewExpression, type Node } from 'ts-morph';
import type {
  ArchitectureGraph,
  ObservedComponent,
  ObservedEdge,
  RepositoryFactsExtractor,
} from './graph.js';
import { compareComponents, compareEdges } from './graph.js';
import type { BlueprintExtraction, Constraint, ExtractionProfile } from './schema.js';

/** HTTP verbs that name a Next.js route handler export. */
const HTTP_VERBS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] as const;

/**
 * The historical tenant-access guard symbols (next-route-handler default). Kept as the
 * fallback guard set so a blueprint with no `extraction.guardSymbols` behaves exactly as
 * the walking skeleton did (widen-only ratchet).
 */
const DEFAULT_GUARD_SYMBOLS = [
  'requireTenantAccess',
  'requireTenantWriteAccess',
  'requireTenantAdminAccess',
] as const;

/**
 * The ontology-write-authority surface — the walking-skeleton scope. Repo-relative
 * paths under the CT repo root. Used as the default globs for the next-route-handler
 * profile when a blueprint declares no `extraction.paths`.
 */
export const ONTOLOGY_ROUTE_GLOBS = [
  'src/app/api/tenants/[id]/objects/route.ts',
  'src/app/api/tenants/[id]/objects/[objectId]/route.ts',
  'src/app/api/tenants/[id]/objects/links/route.ts',
  'src/app/api/tenants/[id]/objects/[objectId]/links/route.ts',
] as const;

/** Historical minimum route files (next-route-handler default fail-closed floor). */
export const MIN_EXPECTED_ROUTE_FILES = ONTOLOGY_ROUTE_GLOBS.length;

/**
 * The resolved extraction config an extractor operates on — every field concrete after
 * defaults are applied. Derived once from the blueprint (or the historical default) so
 * the extractors themselves carry NO subsystem constants.
 */
export interface ResolvedExtraction {
  profile: ExtractionProfile;
  /** exact repo-relative paths OR globs to resolve */
  paths: readonly string[];
  /** symbols whose bare-identifier call is a satisfied edge */
  guardSymbols: readonly string[];
  /** (plugin-surface) forbidden import module specifiers */
  forbiddenImports: readonly string[];
  /** (plugin-surface) forbidden provider HTTP hosts for raw egress (fetch/http.request/axios/got) */
  forbiddenEgressHosts: readonly string[];
  /** (plugin-surface) modules that provide the governed registration helper (for bare-call provenance) */
  governedModules: readonly string[];
  /** fail-closed floor: min files that must resolve */
  minFiles: number;
  /** true iff the blueprint declares at least one forbiddenEgress constraint (b1/egress) */
  egressEnabled: boolean;
  /** (forbiddenEgress) union of every constraint's governedHosts, sorted, deduped */
  governedHosts: readonly string[];
  /** (forbiddenEgress) union of every constraint's egressCallees, deduped; default ['fetch'] */
  egressCallees: readonly string[];
  /**
   * (forbiddenPattern, 0.9.0) union of every forbiddenPattern constraint's `pattern`, sorted,
   * deduped — the constraint list is the single source of truth for what content to scan (the
   * forbiddenImports/forbiddenEgressHosts finding-#5 discipline). Empty → no content scan runs
   * and `coverage.patternScan` is OMITTED (pre-0.9.0 graphs serialize byte-unchanged).
   */
  patterns: readonly string[];
}

/**
 * Resolve a blueprint's `extraction` block (or its absence) into a concrete config.
 * Absent block → the historical next-route-handler CT-ontology defaults (byte-compatible).
 *
 * @param constraints the blueprint's constraints — the forbidden-import set is UNIONED with
 *   every `forbiddenDependency.to` (finding #5: the two lists must not drift; a constraint
 *   whose module is absent from `extraction.forbiddenImports` would else silently never fire).
 *   Passing the constraints makes the constraint list the single source of truth.
 */
export function resolveExtraction(
  extraction: BlueprintExtraction | undefined,
  constraints: readonly Constraint[] = [],
): ResolvedExtraction {
  // every forbiddenDependency.to becomes a forbidden import to scan for (single source of truth).
  const constraintForbidden = constraints
    .filter((c) => c.type === 'forbiddenDependency' && typeof c.to === 'string' && c.to.length > 0)
    .map((c) => c.to as string);
  // every forbiddenEgress.to becomes a forbidden egress host to scan for (same single-source-of-truth
  // discipline as forbiddenImports — a forbiddenEgress constraint whose host is absent from
  // extraction.forbiddenEgressHosts would else silently never fire).
  const constraintEgressHosts = constraints
    .filter((c) => c.type === 'forbiddenEgress' && typeof c.to === 'string' && c.to.length > 0)
    .map((c) => c.to as string);

  // b1/egress — single source of truth for the egress allowlist, mirroring the forbiddenImports
  // union above: every forbiddenEgress constraint's governedHosts/egressCallees are UNIONED, so a
  // blueprint author declares the allowlist once (on the constraint) and the extractor honors it.
  const egressConstraints = constraints.filter((c) => c.type === 'forbiddenEgress');
  const egressEnabled = egressConstraints.length > 0;
  const governedHosts = [...new Set(egressConstraints.flatMap((c) => c.governedHosts ?? []))].sort();
  const egressCallees = [...new Set(egressConstraints.flatMap((c) => c.egressCallees ?? ['fetch']))];

  // forbiddenPattern (0.9.0) — same single-source-of-truth union discipline: every constraint's
  // `pattern` becomes a content regex to scan for. Sorted + deduped so `coverage.patternScan`
  // serializes deterministically.
  const patterns = [
    ...new Set(
      constraints
        .filter((c) => c.type === 'forbiddenPattern' && typeof c.pattern === 'string' && c.pattern.length > 0)
        .map((c) => c.pattern as string),
    ),
  ].sort();

  if (!extraction) {
    return {
      profile: 'next-route-handler',
      paths: ONTOLOGY_ROUTE_GLOBS,
      guardSymbols: DEFAULT_GUARD_SYMBOLS,
      // union even in the default profile, so a CT blueprint that forbids a module is honored.
      forbiddenImports: [...new Set(constraintForbidden)].sort(),
      forbiddenEgressHosts: [...new Set(constraintEgressHosts)].sort(),
      governedModules: [],
      minFiles: MIN_EXPECTED_ROUTE_FILES,
      egressEnabled,
      governedHosts,
      egressCallees: egressEnabled ? egressCallees : ['fetch'],
      patterns,
    };
  }
  const profile = extraction.profile;
  const paths =
    extraction.paths && extraction.paths.length > 0
      ? extraction.paths
      : profile === 'next-route-handler'
        ? ONTOLOGY_ROUTE_GLOBS
        : [];
  const guardSymbols =
    extraction.guardSymbols && extraction.guardSymbols.length > 0
      ? extraction.guardSymbols
      : profile === 'next-route-handler'
        ? DEFAULT_GUARD_SYMBOLS
        : [];
  // UNION the declared extraction.forbiddenImports with every forbiddenDependency.to — so a
  // constraint can never reference a module the extractor doesn't scan for (finding #5).
  const forbiddenImports = [...new Set([...(extraction.forbiddenImports ?? []), ...constraintForbidden])].sort();
  // Same UNION discipline for egress hosts: declared extraction.forbiddenEgressHosts ∪ every
  // forbiddenEgress.to — the constraint list is the single source of truth for what to scan.
  const forbiddenEgressHosts = [
    ...new Set([...(extraction.forbiddenEgressHosts ?? []), ...constraintEgressHosts]),
  ].sort();
  // fail-closed floor: explicit minFiles wins; else historical route-count for
  // next-route-handler; else the count of declared paths (a partial resolve is a fail).
  const minFiles =
    typeof extraction.minFiles === 'number'
      ? extraction.minFiles
      : profile === 'next-route-handler'
        ? MIN_EXPECTED_ROUTE_FILES
        : Math.max(1, paths.length);
  const governedModules = extraction.governedModules ?? [];
  return {
    profile,
    paths,
    guardSymbols,
    forbiddenImports,
    forbiddenEgressHosts,
    governedModules,
    minFiles,
    egressEnabled,
    governedHosts,
    egressCallees: egressEnabled ? egressCallees : ['fetch'],
    patterns,
  };
}

/* -------------------------------------------------------------------------- */
/* glob resolution (deterministic, sorted)                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve a set of repo-relative path patterns to concrete existing files under repoDir.
 * Supports exact paths and simple `**`/`*` globs (no brace expansion). Deterministic:
 * the returned list is de-duplicated and sorted. A pattern with no glob metachars is
 * treated as an exact path (existsSync check) — preserving the historical route-glob
 * behavior byte-for-byte.
 */
export function resolveFiles(repoDir: string, patterns: readonly string[]): string[] {
  const repoRoot = fs.realpathSync(repoDir);
  const repoPath = path.resolve(repoDir);
  const out = new Set<string>();
  const containedPath = (candidate: string): string => {
    const real = fs.realpathSync(candidate);
    if (real !== repoRoot && !real.startsWith(`${repoRoot}${path.sep}`)) {
      throw new Error(`fail-closed: extraction path escapes repository root: ${candidate}`);
    }
    // Preserve the caller's absolute spelling (not fs.realpath's platform alias,
    // e.g. macOS /var -> /private/var) so repository-relative evidence remains stable.
    return path.resolve(candidate);
  };
  for (const pattern of patterns) {
    const normalized = pattern.replace(/\\/g, '/');
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error(`fail-closed: extraction path must be repository-relative without '..': ${pattern}`);
    }
    if (!/[*?]/.test(pattern)) {
      // exact path (historical behavior)
      const abs = path.join(repoDir, pattern);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) out.add(containedPath(abs));
      continue;
    }
    // glob: walk from the longest non-glob prefix dir, match the rest as a regex
    const firstGlob = pattern.search(/[*?]/);
    const prefix = pattern.slice(0, firstGlob);
    const prefixDir = prefix.endsWith('/') ? prefix.slice(0, -1) : path.dirname(prefix);
    const baseDir = path.join(repoDir, prefixDir);
    if (fs.existsSync(baseDir)) containedPath(baseDir);
    const re = globToRegExp(pattern);
    for (const abs of walkFiles(baseDir)) {
      const contained = containedPath(abs);
      const rel = path.relative(repoPath, contained).split(path.sep).join('/');
      if (re.test(rel)) out.add(contained);
    }
  }
  return [...out].sort();
}

/** Convert a simple `**`/`*` glob (repo-relative) to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  // escape regex metachars except * and ?, then translate ** / * / ?
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // ** → any chars including /. When followed by `/`, anchor to a path boundary:
        // `**/` → `(?:.*/)?` (zero or more FULL segments), so `a/**/x.ts` does NOT match
        // `a/notx.ts` (finding: `**/` must not collapse to a boundary-free `.*`).
        i++; // consume the second '*'
        if (glob[i + 1] === '/') {
          re += '(?:.*/)?';
          i++; // consume the slash after **
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*'; // * → any chars except /
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
 * 0.12.1: maximum directory depth walkFiles descends. Deeper entries are SKIPPED
 * (fail toward under-detection), never a crash. 64 is far beyond any sane repo layout while
 * bounding pathological nesting (dirty trees with nested checkouts).
 */
const MAX_WALK_DEPTH = 64;

/**
 * Recursively list files under dir (skips node_modules/.git/dist for determinism + speed).
 *
 * 0.12.1 hardening (dirty-tree `RangeError: Maximum call stack size exceeded`):
 * (a) symlinks are never followed (a symlinked dir reports isSymbolicLink, and following it
 *     can cycle); (b) descent is depth-bounded by MAX_WALK_DEPTH; (c) child results are
 *     loop-appended, NOT spread into push() — `out.push(...huge)` passes every element as a
 *     call argument and overflows the stack on the very large file sets a dirty tree with
 *     nested checkouts produces. All three fail toward under-detection, never a crash.
 */
function walkFiles(dir: string, depth = 0): string[] {
  const out: string[] = [];
  if (depth > MAX_WALK_DEPTH) return out; // bounded descent — skip, never overflow
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    if (entry.isSymbolicLink()) continue; // never follow symlinks (cycle guard)
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const f of walkFiles(abs, depth + 1)) out.push(f); // loop-append (no spread — RangeError guard)
    } else if (entry.isFile()) out.push(abs);
  }
  return out;
}

/**
 * Map an absolute-path file list to repo-relative, forward-slashed, de-duplicated, sorted paths —
 * the deterministic `coverage.scannedFiles` set a `forbiddenFile` constraint iterates (0.8.0).
 * Sorted so the graph serializes deterministically (no wall-clock, all arrays sorted — graph.ts).
 */
export function toRelSorted(repoDir: string, absFiles: string[]): string[] {
  const rel = absFiles.map((abs) => path.relative(repoDir, abs).split(path.sep).join('/'));
  return Array.from(new Set(rel)).sort();
}

/**
 * forbiddenPattern (0.9.0) — the deterministic per-line content scan BOTH extractors share.
 * Runs every resolved pattern regex over every line of every scanned file and records ONE hit per
 * (pattern, file, line) match, sorted by (file, line, pattern). Content grep needs no AST, so —
 * unlike forbiddenEgress — the line-scan extractor supports it identically (no refusal path).
 * Returns `undefined` when no patterns are declared, so `coverage.patternScan` is OMITTED and
 * every pre-0.9.0 serialized graph is byte-unchanged (the determinism/corpus tests are the oracle).
 * A non-compiling pattern THROWS (hard fail): the schema superRefine already rejects it at
 * validate/author time, so reaching here with one is a programming error — never a silent skip.
 */
export function scanPatterns(
  repoDir: string,
  absFiles: string[],
  patterns: readonly string[],
): { patterns: string[]; hits: Array<{ pattern: string; file: string; line: number }> } | undefined {
  if (patterns.length === 0) return undefined;
  const compiled = patterns.map((p) => {
    try {
      return { pattern: p, re: new RegExp(p) };
    } catch (e) {
      throw new Error(
        `forbiddenPattern: non-compiling regex ${JSON.stringify(p)} reached the extractor: ${(e as Error).message} ` +
          `(the schema superRefine rejects this at validate time — fail-closed, never a silent skip)`,
      );
    }
  });
  const hits: Array<{ pattern: string; file: string; line: number }> = [];
  for (const abs of [...absFiles].sort()) {
    const rel = path.relative(repoDir, abs).split(path.sep).join('/');
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const { pattern, re } of compiled) {
        if (re.test(lines[i] ?? '')) hits.push({ pattern, file: rel, line: i + 1 });
      }
    }
  }
  hits.sort((a, b) => {
    const ka = `${a.file}\u0000${String(a.line).padStart(9, '0')}\u0000${a.pattern}`;
    const kb = `${b.file}\u0000${String(b.line).padStart(9, '0')}\u0000${b.pattern}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return { patterns: [...patterns].sort(), hits };
}

/* -------------------------------------------------------------------------- */
/* component-id helpers                                                        */
/* -------------------------------------------------------------------------- */

/** next-route-handler component id: `route:<segments>:<verb>`. */
function routeComponentId(relPath: string, verb: string): string {
  const seg = relPath
    .replace(/^src\/app\/api\/tenants\/\[id\]\//, '')
    .replace(/\/route\.ts$/, '')
    .replace(/\//g, ':')
    .replace(/[[\]]/g, '');
  return `route:${seg || 'root'}:${verb}`;
}

/** plugin-surface component id: `extension:<basename>`. */
function extensionComponentId(relPath: string): string {
  const base = relPath
    .split('/')
    .pop()!
    .replace(/\.extension\.tsx?$/, '')
    .replace(/\.tsx?$/, '');
  return `extension:${base}`;
}

/* -------------------------------------------------------------------------- */
/* b1/egress — the keystone host resolver + host-match predicate              */
/* -------------------------------------------------------------------------- */

/** The result of attempting to statically resolve an egress call's URL argument to host(s). */
export interface EgressHostResolution {
  /** every candidate host literal that could be statically resolved from the argument. */
  hosts: Set<string>;
  /**
   * true iff the argument (or some part of it — e.g. one `||`-chain operand, or a
   * template substitution) could NOT be resolved to a literal. A call can be BOTH
   * `unresolvable:true` AND carry resolved hosts (e.g. `(a || KNOWN_DEFAULT)` where `a` is
   * an unresolvable env read but `KNOWN_DEFAULT` is a literal) — the resolved hosts are still
   * checked against the allowlist; `unresolvable` only gates the honesty-coverage counter.
   */
  unresolvable: boolean;
}

/**
 * A schemeless literal that is ITSELF exactly a bare `host[:port]` — no scheme, no path, no
 * query, no slash of any kind. Anchors the options-bag fallback below to the narrow shape
 * `http.request({ host: 'api.openai.com' })` / `got.post('api.openai.com')` actually uses
 * (a raw hostname string, sometimes with an explicit port) — never an arbitrary text blob.
 */
const BARE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d+)?$/i;

/** Best-effort host extraction from a bare URL string (e.g. a template's leading literal). */
function hostFromUrlString(raw: string): string | null {
  try {
    // .hostname (NOT .host) — a governedHosts allowlist entry names a bare hostname
    // (`localhost`, `api-gateway`), never a `host:port` pair. Using `.host` would silently
    // fail to match `localhost:3013` against an allowlisted `localhost` (a false RED on a
    // conformant reader that pins a port on its default URL).
    return new URL(raw).hostname || null;
  } catch {
    // not a full absolute URL — try a conservative `scheme://host[/...]` prefix match, which
    // covers a template's LEADING literal span (`https://api.example.com/` before `${path}`).
    // Strip a trailing `:port` from the captured authority for the same reason as above.
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(raw);
    if (m?.[1]) return m[1].replace(/:\d+$/, '');
    // OPTIONS-BAG fallback (composed from the original pass's `matchForbiddenEgressHost` substring scan): a
    // literal that names NO scheme and NO path (e.g. the `'api.openai.com'` string literal an
    // `http.request({ host: 'api.openai.com' })` options bag, or a bare `got.post('api.openai.com')`
    // host-only call) is still a real host candidate — resolve it directly (port stripped) rather
    // than discard it. Deliberately narrow: `BARE_HOST_RE` rejects anything containing a `/`, `?`,
    // whitespace, or other URL-structural character, so a genuine path/text fragment (`example.com/
    // openai`, a free-text string) is NOT mistaken for a host.
    return BARE_HOST_RE.test(raw) ? raw.replace(/:\d+$/, '') : null;
  }
}

/**
 * True iff `node` is a syntactic passthrough that preserves the receiver's host — e.g.
 * `.replace(...)` / `.trim()` — so `resolveEgressHostLiterals` can unwrap to the receiver
 * without following into an unrelated call. Deliberately narrow (a receiver-preserving
 * String-method chain only); anything else is NOT unwrapped (fails toward `unresolvable`).
 */
const HOST_PRESERVING_METHODS = new Set(['replace', 'trim', 'toLowerCase', 'toString']);

/**
 * b3/coverage-envelope Class A #2 — the undici DISPATCHER CONSTRUCTORS. `new undici.Client(url)` /
 * `new Pool(url)` / `new Agent(...)` open a persistent connection to `url`; a subsequent
 * `client.request({ path })` egresses to it. The host is baked into the CONSTRUCTOR's first
 * argument (a literal URL), NOT the `.request({path})` call — so it is invisible to a
 * CallExpression-only scan (0.5.0 never visited the `new Client(...)` NewExpression at all). This
 * set names the recognized undici dispatcher constructors; a blueprint MAY extend the recognized
 * constructor set via `egressCallees` (a `Client`/`Pool`/`Agent` entry unions in). `new Agent(...)`
 * whose first argument is an options bag (not a URL) simply won't resolve a host (fail OPEN) — it
 * is included so the constructor is RECOGNIZED and honestly disclosed when its host is unresolved.
 */
const UNDICI_EGRESS_CONSTRUCTORS = new Set(['Client', 'Pool', 'Agent']);

/**
 * Resolve an egress call's URL argument to its candidate host literal(s), deterministically,
 * bounded to `MAX_EGRESS_HOST_HOPS` (3) same-file const hops — the canonical house idiom
 * (`url = \`${base}/api\`; base = (a || b || DEFAULT).replace(...)`) is 2 identifier-hops deep
 * (`url`->`base`'s chain, then the chain's `DEFAULT` operand -> its own literal); the 3rd hop of
 * headroom covers one further same-file const-alias. Biased to UNDER-detect: any node shape it
 * does not recognize contributes NO host and marks `unresolvable` — never a speculative/guessed
 * edge.
 *
 * Handles:
 *   - a string/no-substitution-template literal → `new URL(text).hostname`;
 *   - a TemplateExpression → the leading literal's `scheme://host` prefix, plus each
 *     substitution span resolved via the Identifier rule below;
 *   - an Identifier → ONE hop to its same-file `const` initializer (any scope in the file — the
 *     house idiom nests the whole chain-then-template shape inside a function body — but ONLY
 *     when the name is unambiguous, i.e. exactly one same-named `const` file-wide), then FOLD:
 *       - a literal → its host;
 *       - a `(a || b || DEFAULT)` / `??` chain → recurse over EVERY operand (the keystone —
 *         every literal operand, including the trailing DEFAULT, is a real candidate host by
 *         language semantics);
 *       - a host-preserving `.replace(...)`/`.trim()` call → unwrap to the receiver;
 *       - a further Identifier operand → ONE more same-file const hop, then STOP.
 *   - anything else (process.env.X, opts.X, a non-passthrough call result, a cross-module
 *     import, beyond the bounded hops) → no candidate, `unresolvable:true`.
 */
/**
 * Bound on same-file const-identifier hops. The canonical house idiom the resolver is built to
 * recognize is THREE identifier-follows deep: `fetch(url)` where `url = \`${base}/api\`` (hop 1:
 * url -> base), `base = (a || b || DEFAULT).replace(...)` (hop 2: base -> the fallback chain),
 * and the chain's trailing `DEFAULT` operand is itself a separate same-file const that must be
 * followed to its literal (hop 3: DEFAULT -> literal). Bounded (not unbounded) — a 4th hop is
 * unresolvable, so a resolver never walks an arbitrarily deep const-aliasing chain.
 */
const MAX_EGRESS_HOST_HOPS = 3;

export function resolveEgressHostLiterals(argNode: Node, hopsRemaining = MAX_EGRESS_HOST_HOPS): EgressHostResolution {
  const kind = argNode.getKind();

  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text = (argNode as any).getLiteralText?.() ?? argNode.getText().replace(/^['"`]|['"`]$/g, '');
    const host = hostFromUrlString(text);
    return host ? { hosts: new Set([host]), unresolvable: false } : { hosts: new Set(), unresolvable: true };
  }

  if (kind === SyntaxKind.TemplateExpression) {
    const tmpl = argNode as unknown as {
      getHead(): { getLiteralText(): string };
      getTemplateSpans(): Array<{ getExpression(): Node }>;
    };
    const hosts = new Set<string>();
    let unresolvable = false;
    // the leading literal (template head) may itself carry a full `scheme://host` prefix.
    const headText = tmpl.getHead().getLiteralText();
    const headHost = hostFromUrlString(headText);
    if (headHost) hosts.add(headHost);
    for (const span of tmpl.getTemplateSpans()) {
      const r = resolveEgressHostLiterals(span.getExpression(), hopsRemaining);
      for (const h of r.hosts) hosts.add(h);
      if (r.unresolvable) unresolvable = true;
    }
    // a template with NO resolvable head prefix and NO resolvable span host is fully unresolvable.
    if (hosts.size === 0) unresolvable = true;
    return { hosts, unresolvable };
  }

  if (kind === SyntaxKind.BinaryExpression) {
    const bin = argNode as unknown as {
      getLeft(): Node;
      getRight(): Node;
      getOperatorToken(): { getText(): string };
    };
    const op = bin.getOperatorToken().getText();
    if (op === '||' || op === '??') {
      // the keystone: EVERY operand of a fallback chain is a real candidate host by language
      // semantics (whichever operand is truthy/non-nullish at runtime becomes the actual host) —
      // recurse into BOTH sides at the SAME hop budget (a chain is not itself a "hop").
      const left = resolveEgressHostLiterals(bin.getLeft(), hopsRemaining);
      const right = resolveEgressHostLiterals(bin.getRight(), hopsRemaining);
      const hosts = new Set<string>([...left.hosts, ...right.hosts]);
      return { hosts, unresolvable: left.unresolvable || right.unresolvable };
    }
    // any other binary operator (string concatenation `+`, comparisons, etc.) is not a chain
    // this resolver folds — conservative: no candidate, unresolvable.
    return { hosts: new Set(), unresolvable: true };
  }

  if (kind === SyntaxKind.CallExpression) {
    const call = argNode as unknown as { getExpression(): Node; getArguments(): Node[] };
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pae = callee as unknown as { getName(): string; getExpression(): Node };
      if (HOST_PRESERVING_METHODS.has(pae.getName())) {
        // host-preserving passthrough (`.replace(...)`/`.trim()`/etc.) — unwrap to the receiver,
        // same hop budget (the method call is not itself a hop).
        return resolveEgressHostLiterals(pae.getExpression(), hopsRemaining);
      }
    }
    return { hosts: new Set(), unresolvable: true };
  }

  if (kind === SyntaxKind.ParenthesizedExpression) {
    const paren = argNode as unknown as { getExpression(): Node };
    return resolveEgressHostLiterals(paren.getExpression(), hopsRemaining);
  }

  if (kind === SyntaxKind.ObjectLiteralExpression) {
    // b3/coverage-envelope Class A #1 — the OPTIONS-BAG form. Node's `http.request` / `https.request`
    // / `http2.connect` accept an options object whose `host` (or `hostname`) property names the
    // target host directly: `http.request({ host: 'api.openai.com', path: '/v1/x' })`. A string-
    // literal `host`/`hostname` property value IS a resolvable host candidate (0.5.0 fell through to
    // `unresolvable` here, so the call was DETECTED-as-egress but never emitted an edge — an
    // uncaught real host literal). Deliberately narrow: only a direct string/no-substitution-template
    // literal value counts (a computed/`||`-chain host inside the options bag is NOT folded here —
    // that stays unresolvable, honestly disclosed). `port` is NOT consulted (a bare host+port pair
    // is normalized by `hostFromUrlString`'s BARE_HOST_RE port-strip). ALL other properties are
    // ignored (an options bag with no literal `host`/`hostname` is unresolvable).
    const obj = argNode as unknown as {
      getProperties(): Array<{
        getKind(): SyntaxKind;
        getName?(): string | undefined;
        getInitializer?(): Node | undefined;
      }>;
    };
    for (const prop of obj.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const name = prop.getName?.();
      if (name !== 'host' && name !== 'hostname') continue;
      const value = prop.getInitializer?.();
      if (!value) continue;
      const vk = value.getKind();
      if (vk !== SyntaxKind.StringLiteral && vk !== SyntaxKind.NoSubstitutionTemplateLiteral) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = (value as any).getLiteralText?.() ?? value.getText().replace(/^['"`]|['"`]$/g, '');
      const host = hostFromUrlString(text);
      if (host) return { hosts: new Set([host]), unresolvable: false };
    }
    // an options bag with no resolvable literal host/hostname is unresolvable (fail OPEN).
    return { hosts: new Set(), unresolvable: true };
  }

  if (kind === SyntaxKind.NewExpression) {
    // b3/coverage-envelope Class A — `new URL('https://api.openai.com/v1')` passed to a request
    // (directly, or resolved through a same-file const hop, e.g. `const u = new URL('...'); fetch(u)`).
    // The URL's first argument is the literal we resolve. Deliberately narrow: only a
    // string/no-substitution-template first argument resolves; a computed URL argument stays
    // unresolvable. (This does NOT recognize `new undici.Client(...)` for EDGE emission — that is a
    // NewExpression CALLEE, detected at the `extractEgress` call site, not an argument resolved here.
    // This NewExpression arm resolves a `new URL(...)` used AS an argument to a recognized egress call.)
    const ne = argNode as unknown as { getArguments?(): Node[] };
    const firstArg = ne.getArguments?.()[0];
    if (firstArg) {
      const ak = firstArg.getKind();
      if (ak === SyntaxKind.StringLiteral || ak === SyntaxKind.NoSubstitutionTemplateLiteral) {
        return resolveEgressHostLiterals(firstArg, hopsRemaining);
      }
    }
    return { hosts: new Set(), unresolvable: true };
  }

  if (kind === SyntaxKind.Identifier) {
    if (hopsRemaining <= 0) return { hosts: new Set(), unresolvable: true };
    const decl = resolveSameFileConstInitializer(argNode as unknown as { getText(): string });
    if (!decl) return { hosts: new Set(), unresolvable: true };
    return resolveEgressHostLiterals(decl, hopsRemaining - 1);
  }

  // process.env.X, opts.X, any other PropertyAccessExpression, a cross-module symbol, or any
  // node shape not explicitly recognized above → no candidate, unresolvable (fail toward
  // under-detection, never a speculative edge).
  return { hosts: new Set(), unresolvable: true };
}

/**
 * Resolve a bare Identifier to its SAME-FILE `const X = <init>` initializer node, or null if no
 * such single unambiguous declaration exists. Follows a `const` at ANY scope in the file (a
 * module-level DEFAULT, a function-body-local `base`/`url` assembled from it, etc. — the real
 * house idiom nests the whole fallback-chain-then-template shape inside a function body) — but
 * ONLY when the name resolves to EXACTLY ONE `const` declaration file-wide; two+ same-named
 * `const`s in different scopes is an ambiguous binding this resolver does NOT attempt to
 * disambiguate by lexical scope, so it fails toward `unresolvable` rather than guess the wrong
 * one. A `let`/`var` (reassignable) or a function-parameter binding is NEVER resolved (a
 * reassignable binding cannot be trusted as the declared value at the call site without full
 * flow analysis, which this resolver does not do).
 */
function resolveSameFileConstInitializer(idNode: { getText(): string }): Node | null {
  const name = idNode.getText().trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyNode = idNode as any;
  const sourceFile: { getDescendantsOfKind(k: SyntaxKind): Array<any> } | undefined = anyNode.getSourceFile?.();
  if (!sourceFile) return null;
  // NOTE: SourceFile#getVariableDeclarations() (StatementedNode) intentionally does NOT recurse
  // into nested function bodies — it only returns declarations directly in the file's own
  // statement list. The real house idiom declares `base`/`url` INSIDE the reader function body,
  // so a file-wide walk (getDescendantsOfKind) is required to find them.
  const candidates = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration).filter((decl) => {
    if (decl.getName?.() !== name) return false;
    const stmt = decl.getVariableStatement?.();
    return stmt?.getDeclarationKind?.() === 'const';
  });
  if (candidates.length !== 1) return null; // zero (not found) or 2+ (ambiguous) — both unresolvable.
  const init = candidates[0].getInitializer?.();
  return (init as Node) ?? null;
}

/**
 * True iff `host` is governed — an exact match, a proper subdomain of some governed entry
 * (`H.endsWith('.'+g)`), or the localhost/127.0.0.1 exact-match special case (a subdomain of
 * `localhost` is not a meaningful concept, so only exact equality governs it).
 */
export function isGovernedHost(host: string, governedHosts: readonly string[]): boolean {
  return governedHosts.some((g) => {
    if (host === g) return true;
    if ((g === 'localhost' || g === '127.0.0.1') && host === g) return true;
    return host.endsWith(`.${g}`);
  });
}

/* -------------------------------------------------------------------------- */
/* PRIMARY: ts-morph AST extractor (both profiles)                            */
/* -------------------------------------------------------------------------- */

export class AstExtractor implements RepositoryFactsExtractor {
  readonly kind = 'ast' as const;
  constructor(private readonly cfg: ResolvedExtraction = resolveExtraction(undefined)) {}

  extract(repoDir: string, revision: string): ArchitectureGraph {
    const files = resolveFiles(repoDir, this.cfg.paths);
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    const components: ObservedComponent[] = [];
    const guardEdges: ObservedEdge[] = [];
    const guardSet = new Set(this.cfg.guardSymbols);
    // b1/egress — a mutable counter (not a field: extract() may run more than once per
    // instance across tests) of egress calls whose host could not be resolved to ANY literal
    // candidate. Surfaced honestly in coverage.unsupported — never silently dropped.
    //   - `unresolved` (b1): count of calls flagged `unresolvable:true` (INCLUDING a call that ALSO
    //     resolved a host via one `||`-chain operand — the house-idiom conformant/drift shape). This
    //     count is UNCHANGED by b3 so those surfaces stay byte-identical.
    //   - `items` (b3/coverage-envelope Class B): the DETECTED-CALLEE-BUT-FULLY-UNRESOLVED case
    //     (`hosts.size === 0`) — a network call the extractor SAW (a recognized egress callee /
    //     undici constructor) but could NOT resolve to any host literal (env-only, cross-module,
    //     reassignable, hop>bound). 0.5.0 folded these into the opaque aggregate count with no
    //     location; b3 itemizes each with its `path#Lnn` + callee so the advisory is auditable —
    //     an accurate "we saw a network call we could not resolve to a host". Governed-host
    //     allowlists consume these items as fail-closed violations.
    const egressCoverage: { unresolved: number; items: Array<{ callee: string; ref: string }> } = {
      unresolved: 0,
      items: [],
    };

    for (const absPath of files) {
      const relPath = path.relative(repoDir, absPath).split(path.sep).join('/');
      const source = project.addSourceFileAtPath(absPath);

      if (this.cfg.profile === 'plugin-surface') {
        this.extractExtension(source, relPath, guardSet, components, guardEdges);
      } else {
        this.extractRouteHandler(source, relPath, guardSet, components, guardEdges);
      }
      if (this.cfg.egressEnabled) {
        this.extractEgress(source, relPath, components, guardEdges, egressCoverage);
      }
    }

    components.sort(compareComponents);
    guardEdges.sort(compareEdges);
    const unsupported =
      this.cfg.profile === 'plugin-surface'
        ? [
            'no cross-module symbol resolution (a tool registered via an imported helper is not followed)',
            'dynamic/reflective tool registration not detected',
            'a re-exported forbidden module (barrel import) may be missed',
          ]
        : [
            'no cross-module symbol resolution (a guard applied via an imported wrapper is not followed)',
            'dynamic/reflective handler registration not detected',
          ];
    if (this.cfg.egressEnabled) {
      unsupported.push(
        `egress host resolution is bounded to ${MAX_EGRESS_HOST_HOPS} same-file const hops; a host built ` +
          'from an imported const, a function call, process.env/opts fields, a reassignable let/var, or ' +
          'cross-module indirection is NOT resolved (fails OPEN — never a false violation, honestly disclosed here)',
      );
      if (egressCoverage.unresolved > 0) {
        unsupported.push(`${egressCoverage.unresolved} egress call(s) had an unresolvable host and were skipped`);
      }
      // Itemized, LOCATED unresolved calls. In governed-host allowlist mode the evaluator treats
      // these as violations: a fallback literal does not prove an env/imported alternative is safe.
      // Sorted (by ref then callee) so the graph serializes deterministically. Fail-OPEN: these are
      // disclosures, never violations — a detected-but-unresolvable call is never a false RED.
      const sortedItems = [...egressCoverage.items].sort((a, b) => {
        const ka = `${a.ref} ${a.callee}`;
        const kb = `${b.ref} ${b.callee}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
      for (const it of sortedItems) {
        unsupported.push(
          `detected egress call \`${it.callee}\` at ${it.ref} — host could not be resolved to a literal ` +
            '(env-only, cross-module, reassignable, or beyond the const-hop bound); governed-host allowlists fail closed on this uncertainty',
        );
      }
    }
    return {
      schemaVersion: '1',
      ctRepoRevision: revision,
      components,
      guardEdges,
      coverage: {
        extractor: 'ast',
        filesScanned: files.length,
        unsupported,
        ...(egressCoverage.items.length > 0
          ? { unresolvedEgress: [...egressCoverage.items].sort((a, b) => `${a.ref}\0${a.callee}`.localeCompare(`${b.ref}\0${b.callee}`)) }
          : {}),
        // 0.8.0 (widen-only): the RAW scanned-file set (repo-relative, sorted, deterministic) so a
        // `forbiddenFile` constraint can match a forbidden basename regardless of export shape.
        scannedFiles: toRelSorted(repoDir, files),
        // 0.9.0 (widen-only): the deterministic content-pattern scan a `forbiddenPattern`
        // constraint evaluates. OMITTED (not empty) when no pattern is declared, so every
        // pre-0.9.0 graph serializes byte-unchanged.
        ...(() => {
          const patternScan = scanPatterns(repoDir, files, this.cfg.patterns);
          return patternScan ? { patternScan } : {};
        })(),
      },
    };
  }

  /** next-route-handler: exported HTTP-verb fns → components; guard calls in body → edges. */
  private extractRouteHandler(
    source: ReturnType<Project['addSourceFileAtPath']>,
    relPath: string,
    guardSet: Set<string>,
    components: ObservedComponent[],
    guardEdges: ObservedEdge[],
  ): void {
    const handlers = source
      .getFunctions()
      .filter(
        (fn: FunctionDeclaration) =>
          fn.isExported() && HTTP_VERBS.includes((fn.getName() ?? '') as (typeof HTTP_VERBS)[number]),
      );
    for (const fn of handlers) {
      const verb = fn.getName() as string;
      const id = routeComponentId(relPath, verb);
      components.push({ id, type: 'apiRouteHandler', path: relPath, line: fn.getStartLineNumber() });
      for (const call of fn.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
        const expr = call.getExpression();
        // SECURITY-CRITICAL: only a BARE IDENTIFIER callee counts (reject obj.method()).
        if (expr.getKind() !== SyntaxKind.Identifier) continue;
        const calleeName = expr.getText().trim();
        if (guardSet.has(calleeName)) {
          guardEdges.push({ from: id, to: calleeName, type: 'guards', evidenceRef: `${relPath}#L${call.getStartLineNumber()}` });
        }
      }
    }
  }

  /**
   * The two prior egress passes RECONCILED — WHOLE-FILE pass (sibling to the forbidden-import scan): detect a
   * call to any egress callee and resolve its first argument to candidate host literals. This is
   * the single unification point between the two independent forbiddenEgress implementations:
   *
   *  - CALLEE RECOGNITION is the UNION of the original pass's broad syntactic set (`isEgressCallee` — bare
   *    `fetch`/`axios`/`got`/`request`, `http(s).request`, `axios.get|post|put|delete|patch`,
   *    `got.get|post|put|delete|patch`) with the later pass's blueprint-declared `egressCallees` override
   *    (default `['fetch']`) and the `globalThis.fetch`/`global.fetch` fully-qualified forms — so a
   *    blueprint author can EXTEND the recognized callee set without losing the broad default.
   *  - HOST RESOLUTION is the later pass's keystone `resolveEgressHostLiterals` (the `||`-chain fold +
   *    same-file const-hop resolver) applied to the UNION callee set above — not the original
   *    pass's literal-only path — so a broad callee (axios/got/http.request) built via the house idiom
   *    (`const base = (a || b || DEFAULT).replace(...); fetch(\`${base}/v1\`)`) is ALSO resolved,
   *    which neither implementation could do alone. `hostFromUrlString` additionally carries the
   *    original pass's options-bag substring fallback (a schemeless bare-hostname literal, e.g. the string arg of
   *    `http.request({ host: 'api.openai.com' })`) as an extra resolution path.
   *  - EDGE EMISSION is mode-agnostic: EVERY resolved host becomes a `type:'egress'` edge
   *    (`hit.to` = the host), governed or not. `evaluate()` (report.ts) decides violation by the
   *    constraint's mode — BLOCKLIST (`to`/`forbiddenEgressHosts`): the host is forbidden;
   *    ALLOWLIST (`governedHosts`): the host is NOT governed. The extractor stays a pure detector;
   *    the policy judgement lives entirely in the report arm (single responsibility).
   *
   * Runs for BOTH profiles (next-route-handler and plugin-surface can both make an ungoverned/
   * forbidden network call), guarded entirely by `this.cfg.egressEnabled` at the call site in
   * `extract()` (true iff the blueprint declares AT LEAST ONE `forbiddenEgress` constraint, in
   * either mode).
   *
   * Fail-OPEN on detection (never a false violation): a call whose host cannot be resolved to any
   * literal candidate emits NO edge — it is counted in `coverage.unresolved` instead, so a
   * conformant dynamic reader (`fetch(process.env.TARGET)`) is never false-blocked.
   */
  private extractEgress(
    source: ReturnType<Project['addSourceFileAtPath']>,
    relPath: string,
    components: ObservedComponent[],
    guardEdges: ObservedEdge[],
    coverage: { unresolved: number; items: Array<{ callee: string; ref: string }> },
  ): void {
    const calleeSet = new Set(this.cfg.egressCallees);

    // Emit edges for a resolved (hosts, unresolvable) result + update the honesty coverage — shared
    // by the CallExpression pass (fetch/axios/got/http.request) and the NewExpression pass (undici
    // Client/Pool/Agent constructors) below, so both share the SAME uncertainty contract.
    const record = (
      hosts: Set<string>,
      unresolvable: boolean,
      line: number,
      calleeLabel: string,
    ): void => {
      const owningComponent = this.componentForLine(components, relPath, line);
      const from = owningComponent ?? `file:${relPath}`;
      // mode-agnostic emission: every resolved host becomes an egress edge; evaluate() applies the
      // constraint's blocklist/allowlist policy. hosts.size===0 means nothing resolved.
      for (const host of hosts) {
        guardEdges.push({ from, to: host, type: 'egress', evidenceRef: `${relPath}#L${line}` });
      }
      // an unresolvable call contributes to the honesty counter regardless of whether it ALSO
      // resolved some hosts (e.g. a `||`-chain where one operand resolves and another doesn't) —
      // the resolved hosts are still real edges; `unresolvable` on its own is the coverage signal.
      if (unresolvable) coverage.unresolved++;
      // Itemize EVERY unresolved branch, including a fallback chain that also yielded a literal.
      // At runtime an earlier env/imported operand may win, so the fallback cannot justify an
      // allowlist pass. Blocklist mode remains detection-based and does not consume this field.
      if (unresolvable) {
        coverage.items.push({ callee: calleeLabel, ref: `${relPath}#L${line}` });
      }
    };

    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
      const expr = call.getExpression();
      let isEgressCall = false;
      if (expr.getKind() === SyntaxKind.Identifier) {
        // UNION: the blueprint-declared egressCallees set (default ['fetch']) OR the original pass's broad
        // bare-identifier recognition (fetch/axios/got/request).
        isEgressCall = calleeSet.has(expr.getText().trim()) || this.isEgressCallee(expr);
      } else if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        // `globalThis.fetch(...)` / `global.fetch(...)` — the fully-qualified global form (B1) —
        // OR the original pass's broad property-access recognition (http(s).request, axios.*, got.*).
        const member = expr.getLastChild()?.getText().trim();
        const receiver = expr.getFirstChild()?.getText().trim();
        const isGlobalForm =
          !!member && calleeSet.has(member) && (receiver === 'globalThis' || receiver === 'global');
        isEgressCall = isGlobalForm || this.isEgressCallee(expr);
      }
      if (!isEgressCall) continue;

      const arg0 = call.getArguments()[0];
      if (!arg0) continue;
      const { hosts, unresolvable } = resolveEgressHostLiterals(arg0);
      record(hosts, unresolvable, call.getStartLineNumber(), expr.getText().trim());
    }

    // b3/coverage-envelope Class A #2 — the undici DISPATCHER CONSTRUCTOR pass. `new Client(url)` /
    // `new Pool(url)` / `new Agent(...)` (from `undici`) is a NewExpression, NOT a CallExpression, so
    // it was invisible to the loop above (0.5.0 never emitted an edge for a `new Client('https://
    // api.openai.com')` even though its host is a plain literal). Recognize a NewExpression whose
    // constructor identifier is a known undici dispatcher (or a blueprint-declared `egressCallees`
    // entry naming one) and resolve its first argument to the host. Fail-OPEN + itemized identically
    // to the call pass (an `Agent({...})` options-bag or an env-built URL resolves to nothing →
    // unresolved item; governed-host allowlists fail closed without fabricating an edge).
    for (const ne of source.getDescendantsOfKind(SyntaxKind.NewExpression) as NewExpression[]) {
      const ctorExpr = ne.getExpression();
      const ctorText = ctorExpr.getText().trim();
      // bare `new Client(...)` (Identifier) or `new undici.Client(...)` (PropertyAccess) — match the
      // LAST identifier segment against the recognized constructor set (unioned with any
      // blueprint-declared egressCallees naming a constructor).
      const lastSeg = ctorText.includes('.') ? ctorText.slice(ctorText.lastIndexOf('.') + 1) : ctorText;
      const isUndiciCtor = UNDICI_EGRESS_CONSTRUCTORS.has(lastSeg) || calleeSet.has(lastSeg);
      if (!isUndiciCtor) continue;
      const arg0 = ne.getArguments()[0];
      if (!arg0) {
        // a recognized dispatcher constructor with no argument (e.g. `new Agent()`) — detected but
        // no host to resolve; disclose it honestly rather than silently ignore.
        record(new Set(), true, ne.getStartLineNumber(), `new ${ctorText}`);
        continue;
      }
      const { hosts, unresolvable } = resolveEgressHostLiterals(arg0);
      record(hosts, unresolvable, ne.getStartLineNumber(), `new ${ctorText}`);
    }
  }

  /** The narrowest already-emitted component whose declared line is <= the call's line, same file. */
  private componentForLine(components: ObservedComponent[], relPath: string, line: number): string | null {
    let best: ObservedComponent | null = null;
    for (const c of components) {
      if (c.path !== relPath || c.line > line) continue;
      if (best === null || c.line > best.line) best = c;
    }
    return best?.id ?? null;
  }

  /**
   * plugin-surface extractor. The forbidden-import scan runs over the WHOLE file (a forbidden
   * module reachable ANYWHERE is drift); the `provides`-edge scan is scoped to the recognized
   * factory's BODY (a governed registration must be inside the factory the blueprint is about —
   * a stray registration elsewhere in the file does not satisfy it).
   *
   * A `provides` edge is credited ONLY for a GOVERNED registration:
   *   - property-access `<harness>.registerTool(...)` where `<harness>` is the factory's first
   *     parameter (the pi harness) — a decoy object's `.registerTool` does NOT count; OR
   *   - a bare `registerTool(...)` whose symbol is imported from a blueprint-declared
   *     `governedModules` entry — a bare call from ANY other module (or a local decl) does NOT count.
   * When no `governedModules` are declared, the bare-identifier form is NEVER credited (conservative):
   *   only the explicit `<harness>.method(...)` form proves governance without provenance data.
   */
  private extractExtension(
    source: ReturnType<Project['addSourceFileAtPath']>,
    relPath: string,
    provideSet: Set<string>,
    components: ObservedComponent[],
    guardEdges: ObservedEdge[],
  ): void {
    const isFactoryName = (n: string | undefined): boolean => !!n && /Extension$/.test(n);
    // Capture the factory NODE (not just its line) so `provides` can be scoped to its body.
    type FactoryNode = { getStartLineNumber(): number; getDescendantsOfKind(k: SyntaxKind): CallExpression[] };
    let factoryNode: FactoryNode | null = null;
    let harnessParam: string | null = null;

    for (const fn of source.getFunctions()) {
      if (fn.isExported() && (isFactoryName(fn.getName()) || fn.isDefaultExport())) {
        factoryNode = fn as unknown as FactoryNode;
        harnessParam = fn.getParameters()[0]?.getName() ?? null;
        break;
      }
    }
    if (factoryNode === null) {
      for (const decl of source.getVariableDeclarations()) {
        const exported = decl.getVariableStatement()?.isExported() ?? false;
        if (!exported || !isFactoryName(decl.getName())) continue;
        const init = decl.getInitializer();
        if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
          factoryNode = init as unknown as FactoryNode;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          harnessParam = (init as any).getParameters?.()[0]?.getName?.() ?? null;
        } else {
          factoryNode = decl as unknown as FactoryNode;
        }
        break;
      }
    }
    if (factoryNode === null) {
      const def = source.getDefaultExportSymbol();
      const d = def?.getDeclarations()[0];
      if (d) {
        factoryNode = d as unknown as FactoryNode;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        harnessParam = (d as any).getParameters?.()?.[0]?.getName?.() ?? null;
      }
    }

    // CURRIED ExtensionFactory unwrap. The real agent-host extensions are curried:
    //   export function createXxxExtension(deps): ExtensionFactory { return async (pi) => { pi.registerTool(...) } }
    // The pi harness + the registration calls live in the RETURNED function, NOT the outer factory
    // (whose first param is `deps`). Descend one level: if the recognized factory RETURNS a
    // function/arrow, re-point the scan body + harness param to that inner function. A factory that
    // IS the arrow (the direct-arrow fixture form) has no returned function → this is a NO-OP
    // (byte-identical to pre-fix), so the CT-ontology/next-route-handler path and every existing
    // fixture are untouched. Under-credit direction: a registration in a helper OUTSIDE the returned
    // arrow is not credited (fail-closed).
    if (factoryNode !== null) {
      const inner = this.returnedFactoryFunction(factoryNode);
      if (inner !== null) {
        factoryNode = inner;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        harnessParam = (inner as any).getParameters?.()?.[0]?.getName?.() ?? null;
      }
    }

    // component id: the recognized extension, else a FILE-scoped pseudo-component so forbidden
    // imports are STILL attributed when no factory is recognized (finding #1).
    const id = factoryNode !== null ? extensionComponentId(relPath) : `file:${relPath}`;
    if (factoryNode !== null) {
      components.push({ id, type: 'pluginSurface', path: relPath, line: factoryNode.getStartLineNumber() });
    }

    // `provides` — scoped to the FACTORY BODY (finding #1: not the whole file), governed-only (#3).
    if (factoryNode !== null && provideSet.size > 0) {
      const governedModules = this.cfg.governedModules;
      // Fail-closed shadowing guard (finding: same-name harness shadowing). ts-morph symbol
      // resolution is unreliable without a full type-checker (a shadowed `const pi` may still
      // resolve to the Parameter), so we detect the shadow SYNTACTICALLY: if the factory body
      // declares a local binding (const/let/var/function/class) with the harness param's name,
      // any `<harness>.registerTool(...)` receiver is AMBIGUOUS and is NOT credited.
      const harnessShadowed =
        harnessParam !== null &&
        this.factoryDeclaresLocalNamed(factoryNode as unknown as { getDescendantsOfKind(k: SyntaxKind): Array<{ getName?: () => string | undefined }> }, harnessParam);
      for (const call of factoryNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        let calleeName: string | null = null;
        let credited = false;
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          const member = expr.getLastChild()?.getText().trim() ?? null;
          const receiverNode = expr.getFirstChild();
          const receiver = receiverNode?.getText().trim() ?? null;
          calleeName = member;
          // governed iff receiver is the harness param BY NAME **and** by BINDING (finding:
          // same-name shadowing — a local `const pi = {registerTool}` decoy has the same name but
          // resolves to a VariableDeclaration, NOT the factory's Parameter). Reject the decoy.
          if (member && provideSet.has(member) && harnessParam !== null && receiver === harnessParam && !harnessShadowed) {
            credited = true;
          }
        } else if (expr.getKind() === SyntaxKind.Identifier) {
          calleeName = expr.getText().trim();
          // a bare call is governed ONLY when its symbol is imported from a declared governed
          // module. With no governedModules declared, a bare call is NEVER credited (conservative).
          if (calleeName && provideSet.has(calleeName) && governedModules.length > 0) {
            credited = this.identifierResolvesToGovernedImport(expr, governedModules);
          }
        }
        if (credited && calleeName) {
          guardEdges.push({ from: id, to: calleeName, type: 'provides', evidenceRef: `${relPath}#L${call.getStartLineNumber()}` });
          break;
        }
      }
    }

    // forbidden `imports` — WHOLE FILE. Static import, re-export (`export … from`), export-star,
    // import-equals-require (finding #2), dynamic `import('x')`, and CommonJS `require('x')` (#4).
    const emitForbidden = (spec: string, line: number): void => {
      for (const forbidden of this.cfg.forbiddenImports) {
        if (spec === forbidden || spec.startsWith(`${forbidden}/`)) {
          guardEdges.push({ from: id, to: forbidden, type: 'imports', evidenceRef: `${relPath}#L${line}` });
        }
      }
    };
    for (const imp of source.getImportDeclarations()) {
      // a compile-time-erased `import type { X } from 'openai'` emits no runtime code and cannot
      // egress data — not a runtime forbidden-dependency. Skip type-only imports (avoid false-RED).
      if (imp.isTypeOnly?.()) continue;
      // 0.12.1 catch-and-skip: extraction.paths may legitimately include non-TS files
      // (`.sh`/`.yml` — the patternScan surface). ts-morph mis-parses such content and a hostile
      // line (`import x from $VAR`) lexes into an ImportDeclaration whose specifier is NOT a
      // string literal — getModuleSpecifierValue() then THROWS (InvalidOperationError), crashing
      // the whole run. Skip the unreadable specifier instead: fail toward under-detection (the
      // extractor's documented philosophy) — the patternScan on the same file is unaffected.
      let impSpec: string;
      try {
        impSpec = imp.getModuleSpecifierValue();
      } catch {
        continue; // non-literal specifier from TS-hostile content — skip, never crash
      }
      emitForbidden(impSpec, imp.getStartLineNumber());
    }
    // re-exports + export-star (`export { X } from 'm'` / `export * from 'm'`)
    for (const exp of source.getExportDeclarations()) {
      // 0.12.1 catch-and-skip: same hostile-content class as the import walk above —
      // `export * from ${VAR}` in a mis-parsed `.yml` throws on getModuleSpecifierValue().
      let spec: string | undefined;
      try {
        spec = exp.getModuleSpecifierValue();
      } catch {
        continue; // non-literal specifier from TS-hostile content — skip, never crash
      }
      if (spec) emitForbidden(spec, exp.getStartLineNumber());
    }
    // import-equals-require (`import X = require('m')`)
    for (const ie of source.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ref = (ie as any).getModuleReference?.();
      const lit = ref?.getExpression?.();
      if (lit && lit.getKind?.() === SyntaxKind.StringLiteral) {
        emitForbidden(lit.getText().replace(/^['"`]|['"`]$/g, ''), ie.getStartLineNumber());
      }
    }
    // dynamic `import('x')` + CommonJS `require('x')`. Raw provider-host EGRESS detection (the
    // former inline fetch/http.request/axios/got scan that lived here) is now the UNIFIED
    // whole-file `extractEgress` pass (below), which runs for BOTH profiles and composes the
    // broad callee recognition (`isEgressCallee`, unchanged from the original pass) with the deep
    // `resolveEgressHostLiterals` host resolver (B1's keystone) — see `extractEgress` doc comment
    // for the full reconciliation. Removing the duplicate scan here avoids emitting the SAME
    // egress edge twice for an plugin-surface surface.
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression) as CallExpression[]) {
      // 0.12.1 catch-and-skip: the third hostile-content walk site — a mis-parsed
      // non-TS file can yield call nodes whose argument/literal reads throw. Per-call guard:
      // an unreadable call is skipped (under-detection), never a crashed run.
      try {
        const expr = call.getExpression();
        const isDynamicImport = expr.getKind() === SyntaxKind.ImportKeyword;
        const isRequire = expr.getKind() === SyntaxKind.Identifier && expr.getText().trim() === 'require';
        if (!isDynamicImport && !isRequire) continue;
        const arg = call.getArguments()[0];
        // accept a plain string OR a no-substitution template literal (backtick) — `require(`openai`)`
        // is a valid runtime import and must not evade the detector (finding: template-literal bypass).
        // A TemplateExpression WITH substitutions is a computed specifier (honestly un-analyzable) —
        // it is NOT silently passed: it surfaces in coverage.unsupported instead.
        if (arg && (arg.getKind() === SyntaxKind.StringLiteral || arg.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const spec = (arg as any).getLiteralText?.() ?? arg.getText().replace(/^['"`]|['"`]$/g, '');
          emitForbidden(spec, call.getStartLineNumber());
        }
      } catch {
        continue; // TS-hostile mis-parse — skip this call, never crash
      }
    }
  }

  /**
   * Is this call expression a raw HTTP egress? Recognizes the bare `fetch(...)`, `axios(...)`,
   * `got(...)`, `request(...)` identifiers AND the `http.request` / `https.request` / `axios.get` /
   * `axios.post` property-access forms (from the original pass) — UNIONED with any blueprint-declared
   * `egressCallees` override (B1) in `extractEgress` below. Conservative + syntactic (no symbol
   * resolution): a call whose callee TEXT ends in one of these names. False positives are guarded
   * by the URL-host resolution — a `myThing.request(...)` with no resolvable/ungoverned host emits
   * nothing.
   */
  private isEgressCallee(expr: ReturnType<CallExpression['getExpression']>): boolean {
    const text = expr.getText().trim();
    if (expr.getKind() === SyntaxKind.Identifier) {
      return /^(fetch|axios|got|request)$/.test(text);
    }
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
      // http.request / https.request / axios.get|post|put|delete|patch / got.post …
      return /(^|\.)(https?\.request|axios\.(get|post|put|delete|patch|request)|got\.(get|post|put|delete|patch)|request)$/.test(text);
    }
    return false;
  }

  /** The first-parameter name of the recognized extension factory (the `pi` harness), or null. */
  private factoryFirstParamName(source: ReturnType<Project['addSourceFileAtPath']>): string | null {
    // arrow/function assigned to an exported `…Extension` const, an exported fn, or default export.
    const fromParams = (params: { getName(): string }[]): string | null =>
      params.length > 0 ? (params[0]?.getName() ?? null) : null;
    for (const fn of source.getFunctions()) {
      if (fn.isExported() && (/Extension$/.test(fn.getName() ?? '') || fn.isDefaultExport())) {
        return fromParams(fn.getParameters());
      }
    }
    for (const decl of source.getVariableDeclarations()) {
      const exported = decl.getVariableStatement()?.isExported() ?? false;
      if (!exported || !/Extension$/.test(decl.getName())) continue;
      const init = decl.getInitializer();
      if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fromParams((init as any).getParameters?.() ?? []);
      }
    }
    return null;
  }

  /**
   * True iff the factory body declares a LOCAL binding (const/let/var/function/class) whose name
   * equals the harness param — i.e. the harness is shadowed. Syntactic (no type-checker needed),
   * so it is reliable in this project setup where ts-morph symbol resolution is not. Conservative:
   * a shadow anywhere in the factory body makes every `<harness>.method(...)` receiver ambiguous.
   */
  private factoryDeclaresLocalNamed(
    factoryNode: { getDescendantsOfKind(k: SyntaxKind): Array<{ getName?: () => string | undefined }> },
    name: string,
  ): boolean {
    const kinds = [
      SyntaxKind.VariableDeclaration,
      SyntaxKind.FunctionDeclaration,
      SyntaxKind.ClassDeclaration,
    ];
    for (const k of kinds) {
      for (const d of factoryNode.getDescendantsOfKind(k)) {
        if (d.getName?.() === name) return true;
      }
    }
    return false;
  }

  /**
   * If the recognized factory is a CURRIED `ExtensionFactory` (its body RETURNS an arrow/function
   * expression — the real agent-host convention `create…Extension(deps) { return async (pi) => {…} }`),
   * return that inner function node; else null. The inner function is the `ExtensionFactory` the
   * harness `pi` is passed to. Matches the FIRST top-level `return <arrow|fnExpr>` in document order
   * (ts-morph `getDescendantsOfKind(ReturnStatement)` is document-order, so the outermost/earliest
   * top-level return is first). A parenthesized return `return ( async (pi) => … )` (the curried-arrow
   * form) is unwrapped. A factory that IS the arrow (direct-arrow fixture form) has no returned
   * function → null → the caller does not descend (direct-arrow fixtures stay byte-identical).
   */
  private returnedFactoryFunction(
    factoryNode: { getDescendantsOfKind(k: SyntaxKind): Array<{ getExpression?: () => unknown }> },
  ): { getStartLineNumber(): number; getDescendantsOfKind(k: SyntaxKind): CallExpression[]; getParameters?: () => Array<{ getName(): string }> } | null {
    for (const ret of factoryNode.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let expr = (ret as any).getExpression?.() as { getKind?: () => SyntaxKind; getExpression?: () => unknown } | undefined;
      // unwrap `return ( … )` (ParenthesizedExpression), possibly nested.
      while (expr?.getKind?.() === SyntaxKind.ParenthesizedExpression) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expr = (expr as any).getExpression?.() as typeof expr;
      }
      const k = expr?.getKind?.();
      if (k === SyntaxKind.ArrowFunction || k === SyntaxKind.FunctionExpression) {
        return expr as unknown as {
          getStartLineNumber(): number;
          getDescendantsOfKind(k: SyntaxKind): CallExpression[];
          getParameters?: () => Array<{ getName(): string }>;
        };
      }
    }
    return null;
  }

  /**
   * True iff a bare identifier callee resolves to an import FROM ONE OF THE GOVERNED MODULES.
   * Merely resolving to *an* import is NOT enough (finding #3: `registerTool` imported from an
   * ungoverned local module must not be credited). Fail-closed on any resolution failure.
   */
  private identifierResolvesToGovernedImport(
    expr: { getSymbol?: () => unknown },
    governedModules: readonly string[],
  ): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sym = (expr as any).getSymbol?.();
      const decls: Array<any> = sym?.getDeclarations?.() ?? [];
      if (decls.length === 0) return false;
      const fromGoverned = (mod: string | undefined): boolean =>
        !!mod && governedModules.some((g) => mod === g || mod.startsWith(`${g}/`));
      return decls.some((d) => {
        const kind = d.getKindName?.() ?? '';
        if (kind !== 'ImportSpecifier' && kind !== 'ImportClause' && kind !== 'NamespaceImport') return false;
        // walk up to the ImportDeclaration and read its module specifier.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const impDecl = d.getFirstAncestorByKind?.(SyntaxKind.ImportDeclaration);
        const mod = impDecl?.getModuleSpecifierValue?.();
        return fromGoverned(mod);
      });
    } catch {
      return false; // fail-closed
    }
  }
}

/* -------------------------------------------------------------------------- */
/* FALLBACK: zero-dependency line-scan extractor (both profiles)              */
/* -------------------------------------------------------------------------- */

export class LineScanExtractor implements RepositoryFactsExtractor {
  readonly kind = 'line-scan' as const;
  constructor(private readonly cfg: ResolvedExtraction = resolveExtraction(undefined)) {}

  extract(repoDir: string, revision: string): ArchitectureGraph {
    const files = resolveFiles(repoDir, this.cfg.paths);
    const components: ObservedComponent[] = [];
    const guardEdges: ObservedEdge[] = [];
    const guardAlt = this.cfg.guardSymbols.map(escapeRe).join('|');
    const guardRe = guardAlt ? new RegExp(`\\b(${guardAlt})\\s*\\(`) : null;

    for (const absPath of files) {
      const relPath = path.relative(repoDir, absPath).split(path.sep).join('/');
      const lines = fs.readFileSync(absPath, 'utf8').split('\n');
      if (this.cfg.profile === 'plugin-surface') {
        this.scanExtension(relPath, lines, guardRe, components, guardEdges);
      } else {
        this.scanRouteHandler(relPath, lines, guardRe, components, guardEdges);
      }
    }

    components.sort(compareComponents);
    guardEdges.sort(compareEdges);
    return {
      schemaVersion: '1',
      ctRepoRevision: revision,
      components,
      guardEdges,
      coverage: {
        extractor: 'line-scan',
        filesScanned: files.length,
        unsupported: [
          'indirect / wrapper / decorator guards not detected (textual body-slice only)',
          'a call split across lines may be missed',
          'no cross-module symbol resolution',
          ...(this.cfg.profile === 'plugin-surface' ? ['factory detection is name-heuristic (…Extension / default export)', 'a governed bare `registerTool(` call is NOT credited (only `<harness>.registerTool(` is) — use the ast extractor for full fidelity'] : []),
          // b1/egress — line-scan CANNOT resolve a fetch() argument to a host (no AST, no symbol
          // table for the `||`-chain const-fold). It never emits egress edges. `bce run`/`bce gate`
          // REFUSE line-scan for an egressEnabled blueprint (see cli.ts/gate.ts) rather than
          // silently scanning nothing; this line documents the same limit on the extractor itself.
          ...(this.cfg.egressEnabled ? ['forbiddenEgress is NOT evaluated by line-scan (no host resolution) — use the ast extractor'] : []),
        ],
        // 0.8.0 (widen-only): the RAW scanned-file set — line-scan resolves the same file list, so
        // `forbiddenFile` (a pure path-glob constraint needing no AST) works under BOTH extractors.
        scannedFiles: toRelSorted(repoDir, files),
        // 0.9.0 (widen-only): the content-pattern scan — a pure per-line regex needing no AST, so
        // line-scan supports `forbiddenPattern` IDENTICALLY to the ast extractor (no refusal path,
        // unlike forbiddenEgress). OMITTED when no pattern is declared (byte-back-compat).
        ...(() => {
          const patternScan = scanPatterns(repoDir, files, this.cfg.patterns);
          return patternScan ? { patternScan } : {};
        })(),
      },
    };
  }

  private scanRouteHandler(
    relPath: string,
    lines: string[],
    guardRe: RegExp | null,
    components: ObservedComponent[],
    guardEdges: ObservedEdge[],
  ): void {
    const handlerRe = /^export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE)\s*\(/;
    const topLevelRe = /^(export\s+(?:async\s+)?function\s|export\s+(?:const|class)\s|function\s)/;
    const handlerStarts: { verb: string; idx: number }[] = [];
    lines.forEach((ln, i) => {
      const m = handlerRe.exec(ln.trim());
      if (m?.[1]) handlerStarts.push({ verb: m[1], idx: i });
    });
    handlerStarts.forEach((h, hi) => {
      const id = routeComponentId(relPath, h.verb);
      components.push({ id, type: 'apiRouteHandler', path: relPath, line: h.idx + 1 });
      const nextStart = handlerStarts[hi + 1];
      const end =
        nextStart !== undefined
          ? nextStart.idx
          : (() => {
              for (let j = h.idx + 1; j < lines.length; j++) if (topLevelRe.test(lines[j] ?? '')) return j;
              return lines.length;
            })();
      if (!guardRe) return;
      for (let j = h.idx; j < end; j++) {
        const line = lines[j] ?? '';
        const gm = guardRe.exec(line);
        const trimmed = line.trim();
        if (gm?.[1] && !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('import')) {
          guardEdges.push({ from: id, to: gm[1], type: 'guards', evidenceRef: `${relPath}#L${j + 1}` });
        }
      }
    });
  }

  private scanExtension(
    relPath: string,
    lines: string[],
    provideRe: RegExp | null,
    components: ObservedComponent[],
    guardEdges: ObservedEdge[],
  ): void {
    const factoryRe = /^export\s+(?:default\s+)?(?:async\s+)?(?:const|function)\s+(\w*Extension)\b|^export\s+default\b/;
    let factoryLine: number | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (factoryRe.test((lines[i] ?? '').trim())) {
        factoryLine = i + 1;
        break;
      }
    }
    // The component id: recognized extension, else a FILE-scoped pseudo-component so forbidden
    // imports are STILL attributed when no factory is recognized (finding #1).
    const id = factoryLine !== null ? extensionComponentId(relPath) : `file:${relPath}`;
    if (factoryLine !== null) {
      components.push({ id, type: 'pluginSurface', path: relPath, line: factoryLine });
    }

    // provides: only credited for a recognized factory, only inside the FACTORY BODY (finding #1:
    // a stray governed register elsewhere in the file must NOT satisfy it), and only when the call
    // is a GOVERNED registration — the harness param `.registerTool(` (finding #3: reject a decoy
    // receiver). The factory body is bounded [factoryLine, next top-level export | EOF).
    if (factoryLine !== null && provideRe) {
      const harnessParam = lineScanFactoryParam(lines);
      const topLevelRe = /^(export\s+(?:default\s+)?(?:async\s+)?(?:const|class|function)\s|function\s)/;
      const bodyStart = factoryLine - 1; // factoryLine is 1-based
      let bodyEnd = lines.length;
      for (let k = bodyStart + 1; k < lines.length; k++) {
        if (topLevelRe.test((lines[k] ?? '').trim())) { bodyEnd = k; break; }
      }
      // syntactic shadow guard (same-name harness shadowing): if a local `const/let/var/function/
      // class <harness>` appears in the body, the receiver is ambiguous — do NOT credit.
      const shadowRe = harnessParam
        ? new RegExp(`\\b(?:const|let|var|function|class)\\s+${escapeRe(harnessParam)}\\b`)
        : null;
      let shadowed = false;
      if (shadowRe) {
        for (let k = bodyStart; k < bodyEnd; k++) {
          if (shadowRe.test(lines[k] ?? '')) { shadowed = true; break; }
        }
      }
      for (let j = bodyStart; !shadowed && j < bodyEnd; j++) {
        const line = lines[j] ?? '';
        const trimmed = line.trim();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('import')) continue;
        const m = provideRe.exec(line);
        if (!m?.[1]) continue;
        const sym = m[1];
        // CONSERVATIVE (finding #3): line-scan cannot resolve symbols, so it can NOT tell a
        // governed bare `registerTool(` from a local-decoy bare `registerTool(`. It therefore
        // credits a `provides` edge ONLY via the explicit `<harnessParam>.<sym>(` form — a decoy
        // object's `.registerTool(` (receiver ≠ harnessParam) and a bare local call are NOT
        // credited. The AST extractor is the faithful path; this limit is disclosed in coverage.
        const harnessCall = harnessParam
          ? new RegExp(`\\b${escapeRe(harnessParam)}\\.${escapeRe(sym)}\\s*\\(`).test(line)
          : false;
        if (harnessCall) {
          guardEdges.push({ from: id, to: sym, type: 'provides', evidenceRef: `${relPath}#L${j + 1}` });
          break;
        }
      }
    }

    // forbidden imports (textual) — runs on EVERY file (finding #1). Matches static `from 'x'`,
    // dynamic `import('x')`, and `require('x')` (findings #2/#4) — inspect ANY line that
    // references the module in an import/require position (not gated on `startsWith('import')`).
    for (let j = 0; j < lines.length; j++) {
      const rawLine = lines[j] ?? '';
      const trimmed = rawLine.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      // strip a trailing inline `//` comment (finding #4 — a forbidden module name quoted in a
      // trailing comment must NOT phantom-match). Best-effort: cut at the first `//` that is not
      // inside a quote. This keeps line-scan from false-RED'ing a conformant contributor PR.
      const line = stripTrailingComment(rawLine);
      // a compile-time-erased `import type …` / `export type …` emits no runtime code — skip
      // (parity with the AST path's isTypeOnly() skip, so both extractors agree on type imports).
      if (/^\s*(?:import|export)\s+type\b/.test(line)) continue;
      // quote class includes backticks (finding: template-literal specifier bypass).
      const hasImportContext = /\bfrom\s*[`'"]/.test(line) || /\bimport\s*\(/.test(line) || /\brequire\s*\(/.test(line) || /^\s*import\s+[`'"]/.test(line);
      if (!hasImportContext) continue;
      for (const forbidden of this.cfg.forbiddenImports) {
        const re = new RegExp(`[\`'"]${escapeRe(forbidden)}(/[^\`'"]*)?[\`'"]`);
        if (re.test(line)) {
          guardEdges.push({ from: id, to: forbidden, type: 'imports', evidenceRef: `${relPath}#L${j + 1}` });
        }
      }
    }
  }
}

/** Best-effort first-param name of the factory from a line-scan (the `pi` harness). */
function lineScanFactoryParam(lines: string[]): string | null {
  const re = /(?:const|function)\s+\w*Extension\b[^(]*\(\s*(\w+)|export\s+default\s+(?:async\s+)?\(?\s*(\w+)/;
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1] ?? m[2] ?? null;
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Cut a line at the first `//` that is NOT inside a single/double/back quote (best-effort). */
function stripTrailingComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote && line[i - 1] !== '\\') quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Build an extractor for a resolved extraction config. The `bce` CLI resolves the config
 * from the blueprint (or the historical default) and passes it here.
 */
export function makeExtractor(
  kind: 'ast' | 'line-scan',
  cfg: ResolvedExtraction,
): RepositoryFactsExtractor {
  return kind === 'line-scan' ? new LineScanExtractor(cfg) : new AstExtractor(cfg);
}
