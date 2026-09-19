/**
 * stack-diff — the closure diff classifier between two StackManifests (stack slice 1).
 *
 * PURE MODULE: no filesystem, no network, no process state. It imports only relative modules.
 * Given manifests A (base) and B (head) it answers "what MOVED in the declared closure, and in
 * which direction" — one row per move, each row in exactly one class:
 *
 *   added / removed  the name is present on one side only (scope 'name'); or ONE COPY of a name that
 *                    stays present entered / left (scope 'version', `copy: true`, `retained` lists
 *                    the versions that did not move)
 *   forward/backward a dropped version PAIRED with a new version of the same name (set matching,
 *                    below), strictly higher / lower by SemVer 2.0.0 precedence
 *   rewritten        same name+version, different hashed identity (integrity first; any other
 *                    non-flag hashed field likewise). The row carries BOTH integrity values and
 *                    BLOCKS: different bytes under an unchanged name@version has no benign reading
 *   flags-changed    same name+version and integrity, only boolean flags moved (dev / optional /
 *                    peer / devOptional / installScript). Visible, explains the digest change, and
 *                    blocks only when `installScript` goes false -> true
 *   spec-changed     resolved nodes unchanged, only a declared range (or a root declaration / its
 *                    dependency group) moved — digest-neutral, informational
 *   unknown          the direction cannot be PROVEN: a non-semver version anywhere among the versions
 *                    of a name that moved (either side), two precedence-equal but string-different
 *                    versions (build metadata), an added node / image / runtime that cannot be
 *                    characterized, an image tag or runtime move that cannot be ordered, a hashed
 *                    item that differs with no row of its own sub-view, or ANY move of an OPAQUE
 *                    entry — a hashed `unmodeled[]` entry or a node of a kind this classifier
 *                    cannot compare
 *
 * JOIN KEY + SET MATCHING: npm rows join on (kind, name) — NEVER on the node id `name@version`. A
 * lockfile routinely carries several copies of one name. Per name, the versions present on BOTH
 * sides are RETAINED (no row unless their identity differs). The one-sided versions are sorted by
 * (precedence, full version string) and paired FROM THE TOP — highest dropped with highest new; each
 * pair is `forward` or `backward`. Leftover dropped versions are `removed` copies, leftover new
 * versions are `added` copies. So a patch bump of a non-max copy beside a retained max is one
 * `forward` row, and a new lower copy beside a retained max is an `added` copy — neither is a
 * downgrade of the retained version.
 *
 * FOUR HASHED SUB-VIEWS, EACH EXPLAINED BY ITS OWN ROWS: `nodes`, `runtime`, `images`, `unmodeled`.
 * `images[]` moves (joined on the image name) and `runtime` moves get real rows; the `oci-image` /
 * `node-runtime` NODES are projections of those blocks and are explained by those rows. After the
 * rows are built, every hashed item that differs between the two hashed views must be NAMED by a
 * digest-bearing row of its own sub-view; anything left over is listed in `unexplained`, the report
 * is `unknown-potential-backward` and the exit code is 2. A node row can therefore never mask an
 * image, runtime or unmodeled change, and a `spec-changed` row explains nothing.
 *
 * LOCKFILE FAMILY: the parser that read each side's lockfile is visible only in the quarantined
 * `sources[]`. When the two sides' lockfile-family sets differ the report is
 * `unknown-potential-backward`, exit 2, with a FIRST row (`view: 'sources'`, name `lockfile-family`)
 * naming both; the per-node rows are still listed beneath it. Same family: nothing changes.
 *
 * FAIL CLOSED, mirroring `policy-change.ts` (`unknown-potential-relaxation`): `unknown` is reported
 * as `unknown-potential-backward`. Exit 2 when `approvalBlocked` (unknown, rewritten, install-script
 * gain, unexplained change) or `downgradeAckRequired` (backward, unknown). No approve-anyway input.
 *
 * Rank: backward > unknown > rewritten|flags-changed > added|removed > forward > spec-changed >
 * identical. The report classification is the max rank present; inside one rank the louder class
 * wins (rewritten over flags-changed, removed over added) — never the first row met. Rows are sorted
 * by an EXPLICIT TOTAL comparator ending in the row's canonical serialization, never by the
 * iteration order of the input arrays, so permuting any array of either manifest cannot move a byte
 * of the report. `layout` (hoisting) is not identity and never produces a row; it is surfaced as
 * path counts only.
 *
 * The ROOT node is compared apart from the closure: its OWN version is quarantined out of the digest
 * (a release bump of the repository is not a dependency move), so two manifests that differ only in
 * the root version are an empty diff. Declared RANGES are quarantined too and live only in `edges` /
 * `rootDeclared[]`; every row carries `rootSpec`, the range(s) the root declares for that name.
 */
import { stableStringify } from '../report.js';
import {
  computeStackDigest,
  stackHashedView,
  stackIdFor,
  type HashedStackNode,
  type StackManifest,
  type StackUnmodeled,
  type StackNode,
  type StackNodeKind,
} from './stack-manifest.js';

/* -------------------------------------------------------------------------- */
/* Semver-lite: strict `x.y.z[-pre][+build]` (SemVer 2.0.0 grammar), no `semver` dependency      */
/* -------------------------------------------------------------------------- */

export interface SemverLite {
  major: string;
  minor: string;
  patch: string;
  /** dot-separated prerelease identifiers; empty for a release */
  prerelease: string[];
  /** build metadata — parsed, NEVER part of precedence */
  build: string[];
}

const NUMERIC = '(?:0|[1-9][0-9]*)';
const PRE_ID = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)';
const BUILD_ID = '[0-9A-Za-z-]+';
const SEMVER_RE = new RegExp(
  `^(${NUMERIC})[.](${NUMERIC})[.](${NUMERIC})(?:-(${PRE_ID}(?:[.]${PRE_ID})*))?(?:[+](${BUILD_ID}(?:[.]${BUILD_ID})*))?$`,
);

/** Strict parse. No `v` prefix, no partials (`22`, `1.2`), no ranges, no leading zeros. null = not semver. */
export function parseSemverLite(version: string): SemverLite | null {
  const m = SEMVER_RE.exec(version);
  if (!m) return null;
  return {
    major: m[1] as string,
    minor: m[2] as string,
    patch: m[3] as string,
    prerelease: m[4] ? m[4].split('.') : [],
    build: m[5] ? m[5].split('.') : [],
  };
}

/** Compare two canonical (no-leading-zero) decimal strings without a Number/BigInt round trip. */
function cmpNumeric(a: string, b: string): number {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** SemVer 2.0.0 §11 precedence. Build metadata is ignored; a prerelease is lower than its release. */
export function compareSemverLite(a: SemverLite, b: SemverLite): number {
  const core = cmpNumeric(a.major, b.major) || cmpNumeric(a.minor, b.minor) || cmpNumeric(a.patch, b.patch);
  if (core !== 0) return core;
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const n = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i] as string;
    const y = b.prerelease[i] as string;
    const xn = /^[0-9]+$/.test(x);
    const yn = /^[0-9]+$/.test(y);
    let c: number;
    if (xn && yn) c = cmpNumeric(x, y);
    else if (xn !== yn) c = xn ? -1 : 1; // numeric identifiers have lower precedence
    else c = x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c;
  }
  return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length < b.prerelease.length ? -1 : 1;
}

/* -------------------------------------------------------------------------- */
/* Report shape                                                                */
/* -------------------------------------------------------------------------- */

/** The class of one move: the design's seven names plus `flags-changed` (a same-version flag move made visible). */
export type StackMoveClass =
  | 'added'
  | 'removed'
  | 'forward'
  | 'backward'
  | 'rewritten'
  | 'flags-changed'
  | 'spec-changed'
  | 'unknown';
/** The report-level classification: a move class, `identical`, or the fail-closed spelling of `unknown`. */
export type StackDiffClassification =
  | 'identical'
  | 'spec-changed'
  | 'forward'
  | 'added'
  | 'removed'
  | 'flags-changed'
  | 'rewritten'
  | 'unknown-potential-backward'
  | 'backward';

/** The hashed sub-view a row explains (`edges` rows are digest-neutral and explain nothing; `sources` is the lockfile-family row). */
export type StackMoveView = 'nodes' | 'runtime' | 'images' | 'unmodeled' | 'edges' | 'sources';

/** backward > unknown > rewritten|flags-changed > added|removed > forward > spec-changed > identical(0). */
export const STACK_MOVE_RANK: Readonly<Record<StackMoveClass, number>> = Object.freeze({
  'spec-changed': 1,
  forward: 2,
  added: 3,
  removed: 3,
  'flags-changed': 4,
  rewritten: 4,
  unknown: 5,
  backward: 6,
});

/** Inside one rank the report classification prefers the louder class — never the first row met. */
const RANK_TIE: Readonly<Record<StackMoveClass, number>> = Object.freeze({
  'spec-changed': 0,
  forward: 0,
  added: 0,
  removed: 1,
  'flags-changed': 0,
  rewritten: 1,
  unknown: 0,
  backward: 0,
});

export const STACK_DIFF_UNKNOWN_CLASSIFICATION = 'unknown-potential-backward' as const;

/** Kinds this classifier can compare. Every other kind is OPAQUE and fails closed. */
export const STACK_COMPARABLE_KINDS: readonly string[] = Object.freeze(['npm', 'oci-image', 'node-runtime']);

/** The boolean node flags. A change of ONLY these at an unchanged version is `flags-changed`, not `rewritten`. */
export const STACK_FLAG_FIELDS: readonly string[] = Object.freeze(['dev', 'devOptional', 'installScript', 'optional', 'peer']);

export interface StackFlagChange {
  flag: string;
  from: boolean | null;
  to: boolean | null;
}

export interface StackMove {
  class: StackMoveClass;
  /** the hashed sub-view this row belongs to */
  view: StackMoveView;
  /** a comparable kind, or the opaque kind as written in the manifest (e.g. `unsupported`) */
  kind: StackNodeKind | 'unsupported';
  name: string;
  /** the A-side value: a version (node moves), an image ref, a declared runtime, or the declared range(s) (`spec-changed`); null when absent */
  from: string | null;
  /** the B-side value, same convention */
  to: string | null;
  /** 'name' = the whole name entered/left; 'version' = one copy of a name present on both sides; 'edge' = a range */
  scope: 'name' | 'version' | 'edge';
  /** true when the row is about ONE COPY of a name that has other versions on that side — never a whole-name add/remove */
  copy: boolean;
  /** the versions of this name present, unmoved, on BOTH sides (sorted) */
  retained: string[];
  /** true when the repository root declares this name directly on either side */
  rootDeclared: boolean;
  /** `spec-changed` only: the node id that declares the range (the root as version-free `root:<name>`); null otherwise */
  declaredBy: string | null;
  /**
   * The range(s) the repository ROOT declares for this name on each side (null when it declares none).
   * Ranges are quarantined out of the digest and live only in `edges`; this is the evidence that a
   * root-declared move was ASKED for (e.g. vitest `^4.1.11` -> `^5.0.0`), not merely resolved.
   */
  rootSpec: { from: string | null; to: string | null };
  /** `rewritten`: BOTH integrity values (npm `sha512-…`, image `sha256:…`), so a re-hash can be told from a swapped artifact; null otherwise */
  integrity: { from: string | null; to: string | null } | null;
  /** the hashed identity fields that differ between the two nodes (rewritten, flags-changed, and version moves) */
  fields: string[];
  /** every boolean flag that moved, with before/after — at the same version, or riding on a version move */
  flagsChanged: StackFlagChange[];
  /** NOT identity: how many `node_modules/…` paths the from/to node occupied (hoisting churn made visible) */
  layoutPaths: { from: number; to: number };
  reasons: string[];
  /** true for `unknown`, `rewritten`, and a `flags-changed` row whose `installScript` went false -> true */
  approvalBlocked: boolean;
}

export interface StackDiffSide {
  stackDigest: string;
  stackId: string;
  ctRepoRevision: string;
  nodeCount: number;
}

export interface StackDiffReport {
  schemaVersion: '1';
  kind: 'StackDiffReport';
  from: StackDiffSide;
  to: StackDiffSide;
  /** the RE-DERIVED stackDigests are equal (the recorded field is never trusted) */
  digestEqual: boolean;
  /** the max rank present; `unknown` is spelled `unknown-potential-backward` */
  classification: StackDiffClassification;
  /** any blocking row (`unknown`, `rewritten`, install-script gain), or a hashed change no row explains */
  approvalBlocked: boolean;
  /** any `backward` or `unknown` move: a later reconcile must carry an explicit acknowledged rationale */
  downgradeAckRequired: boolean;
  /** some hashed item differs and no row OF ITS OWN SUB-VIEW names it — fail closed */
  unexplainedDigestChange: boolean;
  /** `<view>:<key>` of every hashed item that differs without a row of that sub-view (sorted) */
  unexplained: string[];
  summary: Record<StackMoveClass, number>;
  /** sorted by the total comparator `compareStackMoves` */
  moves: StackMove[];
}

/* -------------------------------------------------------------------------- */
/* Classifier                                                                  */
/* -------------------------------------------------------------------------- */

/** Composite-key separator: a character no package name, version or node id can carry. */
const SEP = String.fromCharCode(0);

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The explicit TOTAL order of the report. Input array order never participates: two rows that tie on
 * every named key are separated by their full canonical serialization.
 */
export function compareStackMoves(a: StackMove, b: StackMove): number {
  return (
    // the lockfile-family row is about the COMPARISON itself, so it is always the first row
    (a.view === 'sources' ? 0 : 1) - (b.view === 'sources' ? 0 : 1) ||
    STACK_MOVE_RANK[b.class] - STACK_MOVE_RANK[a.class] ||
    cmp(a.name, b.name) ||
    cmp(a.kind, b.kind) ||
    cmp(a.class, b.class) ||
    cmp(a.from ?? '', b.from ?? '') ||
    cmp(a.to ?? '', b.to ?? '') ||
    cmp(a.declaredBy ?? '', b.declaredBy ?? '') ||
    cmp(stableStringify(a), stableStringify(b))
  );
}

/**
 * The digest-bearing fields of a node besides the join key: EVERY field the node carries except the
 * non-hashed `layout`, the derived `id` and (kind, name, version). Derived from the node itself, never
 * from a fixed list — a field a later manifest revision adds to the hashed view (e.g. `resolved` on a
 * node without integrity) is compared the day it appears, instead of being silently ignored.
 */
const NON_IDENTITY_FIELDS = new Set(['layout', 'id', 'kind', 'name', 'version']);

function identityFields(...nodes: object[]): string[] {
  const fields = new Set<string>();
  for (const n of nodes) for (const k of Object.keys(n)) if (!NON_IDENTITY_FIELDS.has(k)) fields.add(k);
  return [...fields].sort();
}

function fieldValue(node: object, field: string): string {
  return stableStringify((node as Record<string, unknown>)[field] ?? null);
}

function identityOf(node: StackNode): string {
  return identityFields(node).map((f) => `${f}=${fieldValue(node, f)}`).join(SEP);
}

/** The identity fields whose value differs between two nodes (sorted). */
function changedFields(a: object, b: object): string[] {
  return identityFields(a, b).filter((f) => fieldValue(a, f) !== fieldValue(b, f));
}

function flagChanges(a: object, b: object): StackFlagChange[] {
  const flag = (n: object, f: string): boolean | null => {
    const v = (n as Record<string, unknown>)[f];
    return typeof v === 'boolean' ? v : null;
  };
  return changedFields(a, b)
    .filter((f) => STACK_FLAG_FIELDS.includes(f))
    .map((f) => ({ flag: f, from: flag(a, f), to: flag(b, f) }));
}

function gainsInstallScript(changes: readonly StackFlagChange[]): boolean {
  return changes.some((c) => c.flag === 'installScript' && c.from !== true && c.to === true);
}

/* ---- opaque nodes: a kind this classifier cannot compare ---- */

function isOpaque(node: { kind: unknown }): boolean {
  return !STACK_COMPARABLE_KINDS.includes(node.kind as string);
}

function opaqueField(node: object, field: string): string | null {
  const v = (node as Record<string, unknown>)[field];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The label an opaque node joins on: its `key`, else its name, else its id. */
function opaqueKey(node: object): string {
  return opaqueField(node, 'key') ?? opaqueField(node, 'name') ?? opaqueField(node, 'id') ?? '(unnamed)';
}

/** Everything hashed about an opaque node — any byte of difference is a move. */
function opaqueIdentity(node: StackNode): string {
  const { layout, ...hashed } = node as StackNode & Record<string, unknown>;
  void layout;
  return stableStringify(hashed);
}

/** What a row shows for an opaque node: its `spec`, else its version, else its key. */
function opaqueLabel(node: StackNode): string {
  return opaqueField(node, 'spec') ?? opaqueField(node, 'version') ?? opaqueKey(node);
}

interface NameGroup {
  kind: StackNodeKind;
  name: string;
  /** version → nodes carrying it (normally one) */
  byVersion: Map<string, StackNode[]>;
}

function groupByName(nodes: readonly StackNode[]): Map<string, NameGroup> {
  const groups = new Map<string, NameGroup>();
  for (const node of nodes) {
    const key = `${node.kind}${SEP}${node.name}`;
    let g = groups.get(key);
    if (!g) {
      g = { kind: node.kind, name: node.name, byVersion: new Map() };
      groups.set(key, g);
    }
    const list = g.byVersion.get(node.version);
    if (list) list.push(node);
    else g.byVersion.set(node.version, [node]);
  }
  return groups;
}

function layoutCount(group: NameGroup | undefined, version: string | null): number {
  if (!group || version === null) return 0;
  return (group.byVersion.get(version) ?? []).reduce((n, node) => n + node.layout.length, 0);
}

/** True when the manifest carries a non-empty quarantined `rootDeclared[]` list. */
function hasRootDeclared(manifest: StackManifest): boolean {
  return Array.isArray(manifest.rootDeclared) && manifest.rootDeclared.length > 0;
}

interface RootDeclaration {
  /** the sorted range(s), joined — what `rootSpec` shows */
  spec: string;
  /** the sorted dependency group(s), joined; '' when read from edges (group unknown) */
  group: string;
}

/**
 * What the repository root declares directly: name key -> range(s) + group(s). SOURCE: the manifest's
 * own `rootDeclared[]` (read straight from `packages[""]`, so it also names a declared dependency that
 * resolved to nothing); a manifest without it falls back to the edges leaving a root node.
 */
function rootDeclarations(manifest: StackManifest): Map<string, RootDeclaration> {
  const specs = new Map<string, { specs: Set<string>; groups: Set<string> }>();
  const add = (key: string, spec: string, group: string | null): void => {
    let e = specs.get(key);
    if (!e) {
      e = { specs: new Set(), groups: new Set() };
      specs.set(key, e);
    }
    e.specs.add(spec);
    if (group !== null) e.groups.add(group);
  };
  if (hasRootDeclared(manifest)) {
    for (const d of manifest.rootDeclared) add(`npm${SEP}${d.name}`, d.spec, d.group);
  } else {
    const byId = new Map(manifest.nodes.map((n) => [n.id, n] as const));
    const rootIds = new Set(manifest.nodes.filter((n) => n.root).map((n) => n.id));
    for (const e of manifest.edges) {
      if (!rootIds.has(e.from)) continue;
      const target = byId.get(e.to);
      if (target) add(`${target.kind}${SEP}${target.name}`, e.spec, null);
    }
  }
  return new Map(
    [...specs].map(([k, v]) => [k, { spec: [...v.specs].sort().join(' | '), group: [...v.groups].sort().join(' | ') }] as const),
  );
}

/**
 * The version-free id of a root node (`root:<name>`), mirroring the hashed view: the repository's OWN
 * version is quarantined, so it must not re-key an edge pair either.
 */
function edgeEndpointId(id: string, rootIdToName: ReadonlyMap<string, string>): string {
  const name = rootIdToName.get(id);
  return name === undefined ? id : `root:${name}`;
}

/**
 * Descending by SemVer precedence, then by the full version STRING — a TOTAL order, so the result
 * never depends on the order the versions were met in. Callers guarantee every version parses.
 */
export function sortVersionsDesc(versions: readonly string[]): string[] {
  return [...versions].sort(
    (x, y) => compareSemverLite(parseSemverLite(y) as SemverLite, parseSemverLite(x) as SemverLite) || cmp(y, x),
  );
}

/** Pairs of DISTINCT version strings with equal precedence (build metadata only) — order-independent. */
function precedenceTies(versions: readonly string[]): string[] {
  const sorted = sortVersionsDesc(versions);
  const tied = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const x = sorted[i - 1] as string;
    const y = sorted[i] as string;
    if (compareSemverLite(parseSemverLite(x) as SemverLite, parseSemverLite(y) as SemverLite) === 0) {
      tied.add(x);
      tied.add(y);
    }
  }
  return [...tied].sort();
}

/** Group `(from,to)` edge pairs to the sorted set of ranges declared on them. */
function specsByPair(manifest: StackManifest): Map<string, { from: string; to: string; specs: string[] }> {
  const rootIdToName = new Map(manifest.nodes.filter((n) => n.root).map((n) => [n.id, n.name] as const));
  const pairs = new Map<string, { from: string; to: string; specs: Set<string> }>();
  for (const e of manifest.edges) {
    const from = edgeEndpointId(e.from, rootIdToName);
    const to = edgeEndpointId(e.to, rootIdToName);
    const key = `${from}${SEP}${to}`;
    const p = pairs.get(key);
    if (p) p.specs.add(e.spec);
    else pairs.set(key, { from, to, specs: new Set([e.spec]) });
  }
  return new Map([...pairs].map(([k, p]) => [k, { from: p.from, to: p.to, specs: [...p.specs].sort() }] as const));
}

/**
 * `sources[].parser` values that do NOT read a lockfile. Every OTHER parser string is a lockfile
 * FAMILY — deliberately an exclusion list, so a parser a later extractor adds is compared, not ignored.
 */
const NON_LOCKFILE_PARSERS = new Set(['package-json', 'dockerfile', 'compose', 'nvmrc', 'node-version']);

/** The sorted set of lockfile families a manifest was extracted from (`parser` treated as an opaque string). */
export function stackLockfileFamilies(manifest: StackManifest): string[] {
  return [...new Set(manifest.sources.map((src) => src.parser as string).filter((parser) => !NON_LOCKFILE_PARSERS.has(parser)))].sort();
}

/** Multiset difference of two serialized lists: the items on one side only, as [onlyA, onlyB]. */
function multisetDiff<T>(a: readonly T[], b: readonly T[], ser: (x: T) => string): [T[], T[]] {
  const count = new Map<string, number>();
  for (const x of b) count.set(ser(x), (count.get(ser(x)) ?? 0) + 1);
  const onlyA: T[] = [];
  for (const x of a) {
    const k = ser(x);
    const n = count.get(k) ?? 0;
    if (n > 0) count.set(k, n - 1);
    else onlyA.push(x);
  }
  const left = new Map<string, number>();
  for (const x of a) left.set(ser(x), (left.get(ser(x)) ?? 0) + 1);
  const onlyB: T[] = [];
  for (const x of b) {
    const k = ser(x);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else onlyB.push(x);
  }
  return [onlyA, onlyB];
}

/** The key a HASHED node is explained under: the root apart, an opaque kind by its label, else (kind, name). */
function hashedNodeKey(h: HashedStackNode): string {
  const n = h as unknown as { kind: string; name: string; root?: boolean };
  if (n.root === true) return `root${SEP}${n.name}`;
  if (isOpaque(n)) return `${n.kind}${SEP}${opaqueKey(n)}`;
  return `${n.kind}${SEP}${n.name}`;
}

/**
 * Classify every move between two manifests. Deterministic and order-independent: the same pair
 * (in any `nodes[]`/`edges[]`/`images[]`/`unmodeled[]` array order) yields a byte-identical
 * `stableStringify(report)`.
 */
export function diffStackManifests(a: StackManifest, b: StackManifest): StackDiffReport {
  // npm nodes are joined on (kind, name). ROOT nodes are compared apart (their own version is
  // quarantined). `oci-image` / `node-runtime` nodes are PROJECTIONS of `images[]` / `runtime` and are
  // explained by the rows of those sub-views, never by an npm-shaped version comparison.
  const isNpmDep = (n: StackNode): boolean => n.kind === 'npm' && !n.root;
  const groupsA = groupByName(a.nodes.filter(isNpmDep));
  const groupsB = groupByName(b.nodes.filter(isNpmDep));
  const rootDeclA = rootDeclarations(a);
  const rootDeclB = rootDeclarations(b);
  const rootKeys = new Set([...rootDeclA.keys(), ...rootDeclB.keys()]);
  const rootSpecOf = (key: string): StackMove['rootSpec'] => ({ from: rootDeclA.get(key)?.spec ?? null, to: rootDeclB.get(key)?.spec ?? null });
  const moves: StackMove[] = [];
  /** `<view>SEP<key>` of every hashed item a DIGEST-BEARING row names */
  const explained = new Set<string>();
  /** node ids whose identity is NOT the same on both sides — a `spec-changed` row needs unchanged endpoints */
  const rewrittenIds = new Set<string>();

  const row = (m: Pick<StackMove, 'class' | 'view' | 'kind' | 'name' | 'from' | 'to' | 'scope' | 'reasons'> & Partial<StackMove>, explains: string[]): void => {
    const flagsChanged = m.flagsChanged ?? [];
    moves.push({
      copy: false,
      retained: [],
      rootDeclared: false,
      declaredBy: null,
      rootSpec: { from: null, to: null },
      integrity: null,
      fields: [],
      layoutPaths: { from: 0, to: 0 },
      ...m,
      flagsChanged,
      approvalBlocked: m.class === 'unknown' || m.class === 'rewritten' || (m.class === 'flags-changed' && gainsInstallScript(flagsChanged)),
    });
    if (m.class !== 'spec-changed') for (const e of explains) explained.add(e);
  };

  const pushNode = (
    g: { kind: StackNodeKind; name: string },
    key: string,
    cls: StackMoveClass,
    from: string | null,
    to: string | null,
    scope: StackMove['scope'],
    reasons: string[],
    extra: Partial<StackMove> = {},
  ): void => {
    row(
      {
        class: cls,
        view: 'nodes',
        kind: g.kind,
        name: g.name,
        from,
        to,
        scope,
        reasons,
        rootDeclared: rootKeys.has(key),
        rootSpec: rootSpecOf(key),
        layoutPaths: { from: layoutCount(groupsA.get(key), from), to: layoutCount(groupsB.get(key), to) },
        ...extra,
      },
      [`nodes${SEP}${key}`],
    );
  };

  for (const key of [...new Set([...groupsA.keys(), ...groupsB.keys()])].sort()) {
    const ga = groupsA.get(key);
    const gb = groupsB.get(key);

    // ---- name present on one side only ----
    if (!ga && gb) {
      for (const v of [...gb.byVersion.keys()].sort()) {
        if (parseSemverLite(v)) pushNode(gb, key, 'added', null, v, 'name', ['name present on the head side only']);
        else pushNode(gb, key, 'unknown', null, v, 'name', [`added node has a non-semver version '${v}': what entered the closure cannot be characterized`]);
      }
      continue;
    }
    if (ga && !gb) {
      for (const v of [...ga.byVersion.keys()].sort()) pushNode(ga, key, 'removed', v, null, 'name', ['name present on the base side only']);
      continue;
    }
    if (!ga || !gb) continue;

    // ---- same name+version on both sides: identical, flags-changed, or rewritten ----
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    const retained: string[] = [];
    for (const v of [...ga.byVersion.keys()].sort()) {
      const nodesA = ga.byVersion.get(v) as StackNode[];
      const nodesB = gb.byVersion.get(v);
      if (!nodesB) {
        onlyA.push(v);
        continue;
      }
      retained.push(v);
      const idA = nodesA.map(identityOf).sort();
      const idB = nodesB.map(identityOf).sort();
      if (idA.join(SEP + SEP) === idB.join(SEP + SEP)) continue;
      const first = nodesA[0] as StackNode;
      const second = nodesB[0] as StackNode;
      rewrittenIds.add(first.id);
      const single = nodesA.length === 1 && nodesB.length === 1;
      const fields = single ? changedFields(first, second) : [];
      const flagsChanged = single ? flagChanges(first, second) : [];
      const integrities = (ns: StackNode[]): string | null => {
        const all = [...new Set(ns.map((n) => n.integrity ?? '(none)'))].sort();
        return all.length === 1 && all[0] === '(none)' ? null : all.join(', ');
      };
      if (single && fields.length > 0 && fields.every((f) => STACK_FLAG_FIELDS.includes(f))) {
        pushNode(ga, key, 'flags-changed', v, v, 'version', [`same name+version and integrity, flags moved: ${flagsChanged.map((c) => `${c.flag} ${String(c.from)} -> ${String(c.to)}`).join(', ')}`], { fields, flagsChanged });
      } else {
        pushNode(ga, key, 'rewritten', v, v, 'version', [fields.length > 0 ? `same name+version, different ${fields.join(', ')}` : 'same name+version, different node set'], {
          fields,
          flagsChanged,
          integrity: { from: integrities(nodesA), to: integrities(nodesB) },
        });
      }
    }
    for (const v of [...gb.byVersion.keys()].sort()) if (!ga.byVersion.has(v)) onlyB.push(v);
    if (onlyA.length === 0 && onlyB.length === 0) continue;

    // ---- a version moved: the direction must be PROVABLE for EVERY version of the name, on BOTH sides ----
    const all = [...new Set([...ga.byVersion.keys(), ...gb.byVersion.keys()])];
    const unparsable = all.filter((v) => parseSemverLite(v) === null).sort();
    const ties = unparsable.length > 0 ? [] : precedenceTies(all);
    if (unparsable.length > 0 || ties.length > 0) {
      const why =
        unparsable.length > 0
          ? `non-semver version(s) ${unparsable.map((v) => `'${v}'`).join(', ')}: direction cannot be proven`
          : `versions ${ties.map((v) => `'${v}'`).join(', ')} have equal semver precedence but differ (build metadata): direction cannot be proven`;
      for (const v of onlyA) pushNode(ga, key, 'unknown', v, null, 'version', [why], { retained });
      for (const v of onlyB) pushNode(gb, key, 'unknown', null, v, 'version', [why], { retained });
      continue;
    }

    // ---- SET MATCHING: retained versions are no move; the one-sided versions pair from the top ----
    const sortedRetained = sortVersionsDesc(retained).reverse();
    const droppedDesc = sortVersionsDesc(onlyA);
    const newDesc = sortVersionsDesc(onlyB);
    const pairs = Math.min(droppedDesc.length, newDesc.length);
    for (let i = 0; i < pairs; i++) {
      const from = droppedDesc[i] as string;
      const to = newDesc[i] as string;
      const c = compareSemverLite(parseSemverLite(to) as SemverLite, parseSemverLite(from) as SemverLite);
      const na = ga.byVersion.get(from) as StackNode[];
      const nb = gb.byVersion.get(to) as StackNode[];
      const single = na.length === 1 && nb.length === 1;
      const flagsChanged = single ? flagChanges(na[0] as StackNode, nb[0] as StackNode) : [];
      // precedence ties were refused above, so a pair is never equal
      pushNode(gb, key, c > 0 ? 'forward' : 'backward', from, to, 'version', [`semver strictly ${c > 0 ? 'higher' : 'lower'} than the paired base version ${from}`], {
        retained: sortedRetained,
        flagsChanged,
        fields: flagsChanged.map((f) => f.flag),
      });
    }
    for (const v of droppedDesc.slice(pairs)) {
      pushNode(ga, key, 'removed', v, null, 'version', ['a copy of a name that is still present was dropped'], { copy: true, retained: sortedRetained });
    }
    for (const v of newDesc.slice(pairs)) {
      pushNode(gb, key, 'added', null, v, 'version', ['a new copy of a name that is already present'], { copy: true, retained: sortedRetained });
    }
  }

  // ---- ROOT nodes: joined on the name; the repository's OWN version is not part of its closure ----
  const rootIdentity = (n: StackNode): string => identityOf(n); // identityOf never includes `version`
  const rootsOf = (m: StackManifest): Map<string, StackNode[]> => {
    const byName = new Map<string, StackNode[]>();
    for (const n of m.nodes) {
      if (!n.root || isOpaque(n)) continue;
      const k = `${n.kind}${SEP}${n.name}`;
      const list = byName.get(k);
      if (list) list.push(n);
      else byName.set(k, [n]);
    }
    return byName;
  };
  const rootsA = rootsOf(a);
  const rootsB = rootsOf(b);
  for (const k of [...new Set([...rootsA.keys(), ...rootsB.keys()])].sort()) {
    const ra = rootsA.get(k) ?? [];
    const rb = rootsB.get(k) ?? [];
    const sample = (ra[0] ?? rb[0]) as StackNode;
    const versions = (list: StackNode[]): string | null => (list.length === 0 ? null : list.map((n) => n.version).sort().join(', '));
    const rootRow = (cls: StackMoveClass, reason: string, extra: Partial<StackMove> = {}): void => {
      row(
        {
          class: cls,
          view: 'nodes',
          kind: sample.kind,
          name: sample.name,
          from: versions(ra),
          to: versions(rb),
          scope: 'name',
          reasons: [reason],
          layoutPaths: { from: ra.reduce((n, x) => n + x.layout.length, 0), to: rb.reduce((n, x) => n + x.layout.length, 0) },
          ...extra,
        },
        [`nodes${SEP}root${SEP}${sample.name}`],
      );
      for (const n of [...ra, ...rb]) rewrittenIds.add(`root:${n.name}`);
    };
    if (ra.length === 0 || rb.length === 0) {
      // a renamed / different repository root: the two manifests describe different SUBJECTS
      rootRow('unknown', `root package '${sample.name}' is present on the ${ra.length === 0 ? 'head' : 'base'} side only: the manifests describe different subjects`);
    } else if (ra.map(rootIdentity).sort().join(SEP + SEP) !== rb.map(rootIdentity).sort().join(SEP + SEP)) {
      const single = ra.length === 1 && rb.length === 1;
      const fields = single ? changedFields(ra[0] as StackNode, rb[0] as StackNode) : [];
      rootRow('rewritten', fields.length > 0 ? `root package, different ${fields.join(', ')}` : 'root package, different node set', {
        fields,
        flagsChanged: single ? flagChanges(ra[0] as StackNode, rb[0] as StackNode) : [],
        integrity: { from: ra.map((n) => n.integrity ?? '(none)').sort().join(', '), to: rb.map((n) => n.integrity ?? '(none)').sort().join(', ') },
      });
    }
    // same root identity, different own version: NOT a move (the version is quarantined out of the digest)
  }

  // ---- OPAQUE nodes: any move FAILS CLOSED — never a silent `added` / `removed` ----
  const opaqueSide = (nodes: readonly StackNode[]): Map<string, StackNode[]> => {
    const m = new Map<string, StackNode[]>();
    for (const n of nodes) {
      if (!isOpaque(n)) continue;
      const k = `${n.kind as string}${SEP}${opaqueKey(n)}`;
      const list = m.get(k);
      if (list) list.push(n);
      else m.set(k, [n]);
    }
    return m;
  };
  const opaqueA = opaqueSide(a.nodes);
  const opaqueB = opaqueSide(b.nodes);
  for (const k of [...new Set([...opaqueA.keys(), ...opaqueB.keys()])].sort()) {
    const na = opaqueA.get(k) ?? [];
    const nb = opaqueB.get(k) ?? [];
    const idA = na.map(opaqueIdentity).sort().join(SEP);
    const idB = nb.map(opaqueIdentity).sort().join(SEP);
    if (idA === idB) continue; // unchanged: never a row
    const sample = (na[0] ?? nb[0]) as StackNode;
    const what = na.length === 0 ? 'added' : nb.length === 0 ? 'removed' : 'changed';
    row(
      {
        class: 'unknown',
        view: 'nodes',
        kind: sample.kind as StackMove['kind'],
        name: opaqueKey(sample),
        from: na.length === 0 ? null : na.map(opaqueLabel).sort().join(', '),
        to: nb.length === 0 ? null : nb.map(opaqueLabel).sort().join(', '),
        scope: 'name',
        reasons: [`opaque '${sample.kind as string}' node ${what}: its content cannot be compared, so the move cannot be proven safe`],
        layoutPaths: { from: na.reduce((n, x) => n + (x.layout?.length ?? 0), 0), to: nb.reduce((n, x) => n + (x.layout?.length ?? 0), 0) },
      },
      [`nodes${SEP}${k}`],
    );
  }

  // ---- images[]: joined on the image NAME. The `oci-image` nodes are projections of these entries ----
  type HashedImage = Omit<StackManifest['images'][number], 'evidenceRef'>;
  const hashedImage = (i: StackManifest['images'][number]): HashedImage => {
    const { evidenceRef, ...h } = i;
    void evidenceRef;
    return h;
  };
  const imagesByName = (m: StackManifest): Map<string, HashedImage[]> => {
    const byName = new Map<string, HashedImage[]>();
    for (const i of m.images) {
      const list = byName.get(i.name);
      if (list) list.push(hashedImage(i));
      else byName.set(i.name, [hashedImage(i)]);
    }
    return byName;
  };
  const imagesA = imagesByName(a);
  const imagesB = imagesByName(b);
  for (const name of [...new Set([...imagesA.keys(), ...imagesB.keys()])].sort()) {
    const [goneRaw, cameRaw] = multisetDiff(imagesA.get(name) ?? [], imagesB.get(name) ?? [], (i) => stableStringify(i));
    const gone = [...goneRaw].sort((x, y) => cmp(stableStringify(x), stableStringify(y)));
    const came = [...cameRaw].sort((x, y) => cmp(stableStringify(x), stableStringify(y)));
    if (gone.length === 0 && came.length === 0) continue;
    const explains = [`images${SEP}${name}`, `nodes${SEP}oci-image${SEP}${name}`];
    const imageRow = (cls: StackMoveClass, from: HashedImage | null, to: HashedImage | null, reason: string, extra: Partial<StackMove> = {}): void =>
      row({ class: cls, view: 'images', kind: 'oci-image', name, from: from?.ref ?? null, to: to?.ref ?? null, scope: 'name', reasons: [reason], ...extra }, explains);
    /** an entering image can be characterized only when a digest pins its bytes or its tag is a strict version */
    const characterized = (i: HashedImage): boolean => i.digest !== null || (i.tag !== null && parseSemverLite(i.tag) !== null);
    if (gone.length === 1 && came.length === 1) {
      const x = gone[0] as HashedImage;
      const y = came[0] as HashedImage;
      const fields = changedFields(x, y).filter((f) => f !== 'ref');
      const digests = { from: x.digest, to: y.digest };
      if (x.tag !== y.tag) {
        const sx = x.tag === null ? null : parseSemverLite(x.tag);
        const sy = y.tag === null ? null : parseSemverLite(y.tag);
        const c = sx && sy ? compareSemverLite(sy, sx) : 0;
        if (sx && sy && c !== 0) imageRow(c > 0 ? 'forward' : 'backward', x, y, `image tag is semver strictly ${c > 0 ? 'higher' : 'lower'} than ${x.tag as string}`, { fields, integrity: digests });
        else imageRow('unknown', x, y, `image tag moved '${x.tag ?? '(none)'}' -> '${y.tag ?? '(none)'}' and the two tags cannot be ordered: direction cannot be proven`, { fields, integrity: digests });
      } else if (x.digest !== y.digest) {
        imageRow('rewritten', x, y, 'same image name and tag, different digest', { fields, integrity: digests });
      } else {
        imageRow('rewritten', x, y, `same image name, tag and digest, different ${fields.join(', ')}`, { fields, integrity: digests });
      }
    } else if (gone.length === 0) {
      for (const y of came) {
        if (characterized(y)) imageRow('added', null, y, 'image present on the head side only', { integrity: { from: null, to: y.digest } });
        else imageRow('unknown', null, y, `added image '${y.ref}' has neither a digest pin nor a strict version tag: what entered cannot be characterized`);
      }
    } else if (came.length === 0) {
      for (const x of gone) imageRow('removed', x, null, 'image present on the base side only', { integrity: { from: x.digest, to: null } });
    } else {
      row(
        {
          class: 'unknown',
          view: 'images',
          kind: 'oci-image',
          name,
          from: gone.map((i) => i.ref).sort().join(', '),
          to: came.map((i) => i.ref).sort().join(', '),
          scope: 'name',
          reasons: [`several entries of image '${name}' moved at once: they cannot be paired, so no direction can be proven`],
        },
        explains,
      );
    }
  }

  // ---- runtime: the declared node runtime. The `node-runtime` node is a projection of this block ----
  if (stableStringify(a.runtime) !== stableStringify(b.runtime)) {
    const ra = a.runtime.node;
    const rb = b.runtime.node;
    const fields = changedFields(ra, rb);
    const runtimeNames = new Set(['node', ...[...a.nodes, ...b.nodes].filter((n) => n.kind === 'node-runtime').map((n) => n.name)]);
    const explains = [`runtime${SEP}node`, ...[...runtimeNames].map((n) => `nodes${SEP}node-runtime${SEP}${n}`)];
    const runtimeRow = (cls: StackMoveClass, reason: string): void =>
      row({ class: cls, view: 'runtime', kind: 'node-runtime', name: 'node', from: ra.declared, to: rb.declared, scope: 'name', reasons: [reason], fields }, explains);
    if (ra.declared === rb.declared) {
      runtimeRow('rewritten', `same declared runtime, different ${fields.join(', ')}`);
    } else if (ra.declared === null) {
      if (parseSemverLite(rb.declared as string)) runtimeRow('added', 'a node runtime is declared on the head side only');
      else runtimeRow('unknown', `added runtime declaration '${rb.declared as string}' is not an exact version: what entered cannot be characterized`);
    } else if (rb.declared === null) {
      runtimeRow('removed', 'a node runtime is declared on the base side only');
    } else {
      const sa = parseSemverLite(ra.declared);
      const sb = parseSemverLite(rb.declared);
      const c = sa && sb ? compareSemverLite(sb, sa) : 0;
      if (sa && sb && c !== 0) runtimeRow(c > 0 ? 'forward' : 'backward', `declared runtime is semver strictly ${c > 0 ? 'higher' : 'lower'} than ${ra.declared}`);
      else runtimeRow('unknown', `declared runtime moved '${ra.declared}' -> '${rb.declared}' and the two cannot be ordered as exact versions: direction cannot be proven`);
    }
  }

  // ---- unmodeled[]: the hashed OPAQUE lockfile entries (npm: alias, link:, git/file, non-ASCII) ----
  // Joined on the lockfile `key`. The entry is content-hashed but NOT modeled, so no direction can
  // ever be proven for it: added, removed or changed is `unknown`.
  const unmodeledByKey = (m: StackManifest): Map<string, StackUnmodeled[]> => {
    const byKey = new Map<string, StackUnmodeled[]>();
    for (const u of m.unmodeled) {
      const list = byKey.get(u.key);
      if (list) list.push(u);
      else byKey.set(u.key, [u]);
    }
    return byKey;
  };
  const unmodeledA = unmodeledByKey(a);
  const unmodeledB = unmodeledByKey(b);
  const unmodeledLabel = (list: StackUnmodeled[]): string =>
    list.map((u) => `${u.reason} sha256:${u.entrySha256.slice(0, 12)}`).sort().join(', ');
  for (const k of [...new Set([...unmodeledA.keys(), ...unmodeledB.keys()])].sort()) {
    const ua = unmodeledA.get(k) ?? [];
    const ub = unmodeledB.get(k) ?? [];
    if (ua.map((u) => stableStringify(u)).sort().join(SEP) === ub.map((u) => stableStringify(u)).sort().join(SEP)) continue;
    const what = ua.length === 0 ? 'added' : ub.length === 0 ? 'removed' : 'changed';
    const reasonsSeen = [...new Set([...ua, ...ub].map((u) => u.reason))].sort().join(', ');
    row(
      {
        class: 'unknown',
        view: 'unmodeled',
        kind: 'unsupported',
        name: k,
        from: ua.length === 0 ? null : unmodeledLabel(ua),
        to: ub.length === 0 ? null : unmodeledLabel(ub),
        scope: 'name',
        reasons: [`unmodeled entry '${k}' (${reasonsSeen}) ${what}: it is content-hashed but not modeled, so the move cannot be proven safe`],
      },
      [`unmodeled${SEP}${k}`],
    );
  }

  // ---- spec-changed: the same (from,to) pair of UNCHANGED nodes declares a different range ----
  const pairsA = specsByPair(a);
  const pairsB = specsByPair(b);
  const nodeByIdB = new Map(b.nodes.map((n) => [n.root ? `root:${n.name}` : n.id, n] as const));
  // root declarations come from `rootDeclared[]` when EITHER manifest carries it (below); the edge
  // pairs leaving the root are then skipped so one range move is never reported twice.
  const rootFromField = hasRootDeclared(a) || hasRootDeclared(b);
  for (const pairKey of [...pairsA.keys()].sort()) {
    const pa = pairsA.get(pairKey) as { from: string; to: string; specs: string[] };
    const pb = pairsB.get(pairKey);
    if (!pb) continue;
    if (rootFromField && pa.from.startsWith('root:')) continue;
    const specA = pa.specs.join(' | ');
    const specB = pb.specs.join(' | ');
    if (specA === specB) continue;
    if (rewrittenIds.has(pa.from) || rewrittenIds.has(pa.to)) continue;
    const target = nodeByIdB.get(pa.to);
    if (!target) continue;
    const key = `${target.kind}${SEP}${target.name}`;
    row(
      {
        class: 'spec-changed',
        view: 'edges',
        kind: target.kind,
        name: target.name,
        from: specA,
        to: specB,
        scope: 'edge',
        rootDeclared: rootKeys.has(key),
        declaredBy: pa.from,
        rootSpec: rootSpecOf(key),
        layoutPaths: { from: layoutCount(groupsA.get(key), target.version), to: layoutCount(groupsB.get(key), target.version) },
        reasons: [`declared range on ${pa.from} moved; both nodes unchanged (digest-neutral)`],
      },
      [],
    );
  }

  if (rootFromField) {
    const rootName = (m: StackManifest): string => m.nodes.find((n) => n.root)?.name ?? '(root)';
    const movedKeys = new Set(moves.filter((m) => m.class !== 'spec-changed').map((m) => `${m.kind}${SEP}${m.name}`));
    for (const key of [...rootKeys].sort()) {
      const da = rootDeclA.get(key);
      const db = rootDeclB.get(key);
      const groupMoved = da !== undefined && db !== undefined && da.group !== '' && db.group !== '' && da.group !== db.group;
      if (da !== undefined && db !== undefined && da.spec === db.spec && !groupMoved) continue;
      if (movedKeys.has(key)) continue; // the range rides on that move's `rootSpec`; spec-changed needs unchanged nodes
      const name = key.slice(key.indexOf(SEP) + 1);
      const version = [...(groupsB.get(key)?.byVersion.keys() ?? groupsA.get(key)?.byVersion.keys() ?? [])].sort()[0] ?? null;
      const what =
        da === undefined
          ? `root:${rootName(b)} now declares '${name}' (${db?.group || 'dependency'})`
          : db === undefined
            ? `root:${rootName(a)} no longer declares '${name}' (${da.group || 'dependency'})`
            : groupMoved
              ? `declaration of '${name}' on root:${rootName(b)} moved ${da.group} -> ${db.group}${da.spec === db.spec ? '' : ' and its range moved'}`
              : `declared range on root:${rootName(b)} moved`;
      row(
        {
          class: 'spec-changed',
          view: 'edges',
          kind: 'npm',
          name,
          from: da?.spec ?? null,
          to: db?.spec ?? null,
          scope: 'edge',
          rootDeclared: true,
          declaredBy: `root:${rootName(b)}`,
          rootSpec: { from: da?.spec ?? null, to: db?.spec ?? null },
          layoutPaths: { from: layoutCount(groupsA.get(key), version), to: layoutCount(groupsB.get(key), version) },
          reasons: [`${what}; the resolved nodes are unchanged (digest-neutral)`],
        },
        [],
      );
    }
  }

  // ---- LOCKFILE FAMILY: two manifests read by different lockfile parsers are not comparable ----
  // The family lives only in the quarantined `sources[]`, so the digests cannot see it. The same
  // repository read from two lockfile families resolves to different closures, and the per-node rows
  // below such a pair describe the two package managers, not a move — the verdict fails closed.
  const familiesA = stackLockfileFamilies(a);
  const familiesB = stackLockfileFamilies(b);
  const familyMismatch = familiesA.join(SEP) !== familiesB.join(SEP);
  if (familyMismatch) {
    const show = (f: string[]): string => (f.length === 0 ? '(none)' : f.join(', '));
    row(
      {
        class: 'unknown',
        view: 'sources',
        kind: 'unsupported',
        name: 'lockfile-family',
        from: show(familiesA),
        to: show(familiesB),
        scope: 'name',
        reasons: [`the base manifest was extracted by lockfile parser(s) ${show(familiesA)} and the head by ${show(familiesB)}: closures read from different lockfile families are not comparable, so no row below proves a direction`],
      },
      [],
    );
  }

  moves.sort(compareStackMoves);

  // ---- COMPLETENESS: every hashed item that differs must be named by a row OF ITS OWN SUB-VIEW ----
  // The digests are RE-DERIVED here; the recorded `stackDigest` field is never read.
  const viewA = stackHashedView(a);
  const viewB = stackHashedView(b);
  const unexplainedSet = new Set<string>();
  const check = <T>(view: StackMoveView, xs: readonly T[], ys: readonly T[], keyOf: (x: T) => string): void => {
    const [goneItems, cameItems] = multisetDiff(xs, ys, (x) => stableStringify(x));
    for (const item of [...goneItems, ...cameItems]) {
      const key = keyOf(item);
      if (!explained.has(`${view}${SEP}${key}`)) unexplainedSet.add(`${view}:${key.split(SEP).join('/')}`);
    }
  };
  check('nodes', viewA.nodes, viewB.nodes, hashedNodeKey);
  check('images', viewA.images, viewB.images, (i) => i.name);
  check('unmodeled', viewA.unmodeled, viewB.unmodeled, (u) => u.key);
  check('runtime', [viewA.runtime], [viewB.runtime], () => 'node');
  const unexplained = [...unexplainedSet].sort();
  const unexplainedDigestChange = unexplained.length > 0;

  const digestA = computeStackDigest(a);
  const digestB = computeStackDigest(b);
  const digestEqual = digestA === digestB;

  const summary: Record<StackMoveClass, number> = {
    added: 0,
    removed: 0,
    forward: 0,
    backward: 0,
    rewritten: 0,
    'flags-changed': 0,
    'spec-changed': 0,
    unknown: 0,
  };
  for (const m of moves) summary[m.class] += 1;

  let top: StackMoveClass | null = unexplainedDigestChange ? 'unknown' : null;
  for (const m of moves) {
    if (familyMismatch) top = 'unknown'; // the comparison itself is unproven: no backward row may outrank that
    else if (top === null) top = m.class;
    else if (STACK_MOVE_RANK[m.class] > STACK_MOVE_RANK[top]) top = m.class;
    else if (STACK_MOVE_RANK[m.class] === STACK_MOVE_RANK[top] && RANK_TIE[m.class] > RANK_TIE[top]) top = m.class;
  }
  const classification: StackDiffClassification =
    top === null ? 'identical' : top === 'unknown' ? STACK_DIFF_UNKNOWN_CLASSIFICATION : top;

  return {
    schemaVersion: '1',
    kind: 'StackDiffReport',
    from: { stackDigest: digestA, stackId: stackIdFor(digestA), ctRepoRevision: a.ctRepoRevision, nodeCount: a.nodes.length },
    to: { stackDigest: digestB, stackId: stackIdFor(digestB), ctRepoRevision: b.ctRepoRevision, nodeCount: b.nodes.length },
    digestEqual,
    classification,
    approvalBlocked: unexplainedDigestChange || moves.some((m) => m.approvalBlocked),
    downgradeAckRequired: unexplainedDigestChange || summary.backward > 0 || summary.unknown > 0,
    unexplainedDigestChange,
    unexplained,
    summary,
    moves,
  };
}

/**
 * The CLI exit code of a report — 2 (fail closed) when:
 *   - `approvalBlocked`: an `unknown` or `rewritten` row, a same-version `installScript` gain, or a
 *     hashed change no row of its sub-view explains; or
 *   - `downgradeAckRequired`: a `backward` (or `unknown`) move.
 * Else 0. The two flags are independent: `rewritten` blocks without being a downgrade, `backward`
 * is a downgrade without blocking approval outright.
 */
export function stackDiffExitCode(report: StackDiffReport): 0 | 2 {
  return report.approvalBlocked || report.downgradeAckRequired ? 2 : 0;
}
