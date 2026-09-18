/**
 * stack-diff — the per-node closure diff classifier between two StackManifests (stack slice 1).
 *
 * PURE MODULE: no filesystem, no network, no process state. It imports only relative modules.
 * Given manifests A (base) and B (head) it answers "what MOVED in the declared closure, and in
 * which direction" — one row per move, each row in exactly one class:
 *
 *   added / removed  the name is present on one side only (scope 'name'); or a COPY of a name
 *                    that stays present was dropped (scope 'version', `removed` only)
 *   forward          same name, a B version strictly higher than the MAX A version
 *   backward         same name, a B version strictly lower than the MAX A version (or the highest
 *                    resolved version of the name dropped while only lower copies remain)
 *   rewritten        same name+version, different hashed identity (integrity first; any other
 *                    digest-bearing node field likewise — the row names the fields)
 *   spec-changed     both endpoint nodes unchanged, only the declared range on an edge moved
 *                    (digest-neutral, informational)
 *   unknown          the direction cannot be PROVEN: a non-semver version (git ref, tag, range,
 *                    partial `22`), two semver-equal but string-different versions, an added node
 *                    whose version is not semver, a stackDigest change no row explains, or ANY
 *                    move of an OPAQUE entry — a hashed `unmodeled[]` entry (npm: alias, link:,
 *                    git/file dependency, non-ASCII name), or a node of a kind this classifier
 *                    cannot compare: added, removed or changed
 *
 * JOIN KEY: rows join on (kind, name) — NEVER on the node id `name@version`. A lockfile routinely
 * carries several copies of one name; joining on the id would read every version move as an
 * unrelated `removed` + `added` pair and lose the direction, which is the only thing a reviewer
 * needs. Each B-only version is compared against the MAX A version of the same name.
 *
 * `unknown` FAILS CLOSED, mirroring `policy-change.ts` (`unknown-potential-relaxation`): the report
 * classification is `unknown-potential-backward`, `approvalBlocked` is true, and the CLI exits 2.
 * There is intentionally no approve-anyway input.
 *
 * Rank: backward > unknown > rewritten > added|removed > forward > spec-changed > identical. The
 * report's classification is the max rank present (the `REPORT_RANK` pattern). Rows are sorted by
 * an EXPLICIT total comparator — (rank desc, name, kind, class, from, to, declaredBy) — never by
 * the iteration order of the input arrays, so permuting `nodes[]`/`edges[]` of either manifest
 * cannot move a byte of the report. `layout` (hoisting) is not identity and never produces a row;
 * it is surfaced as path counts only.
 *
 * The ROOT node is compared apart from the closure: its OWN version is quarantined out of the digest
 * (a release bump of the repository is not a dependency move), so two manifests that differ only in
 * the root version are an empty diff. Declared RANGES are quarantined too and live only in `edges`;
 * every row carries `rootSpec`, the range(s) the root declares for that name on each side.
 */
import { stableStringify } from '../report.js';
import {
  computeStackDigest,
  stackIdFor,
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

/** The class of one move (the design's seven names). */
export type StackMoveClass = 'added' | 'removed' | 'forward' | 'backward' | 'rewritten' | 'spec-changed' | 'unknown';
/** The report-level classification: a move class, `identical`, or the fail-closed spelling of `unknown`. */
export type StackDiffClassification =
  | 'identical'
  | 'spec-changed'
  | 'forward'
  | 'added'
  | 'removed'
  | 'rewritten'
  | 'unknown-potential-backward'
  | 'backward';

/** backward > unknown > rewritten > added|removed > forward > spec-changed > identical(0). */
export const STACK_MOVE_RANK: Readonly<Record<StackMoveClass, number>> = Object.freeze({
  'spec-changed': 1,
  forward: 2,
  added: 3,
  removed: 3,
  rewritten: 4,
  unknown: 5,
  backward: 6,
});

export const STACK_DIFF_UNKNOWN_CLASSIFICATION = 'unknown-potential-backward' as const;

/** Kinds whose versions this classifier can compare. Every other kind is OPAQUE and fails closed. */
export const STACK_COMPARABLE_KINDS: readonly string[] = Object.freeze(['npm', 'oci-image', 'node-runtime']);

export interface StackMove {
  class: StackMoveClass;
  /** a comparable kind, or the opaque kind as written in the manifest (e.g. `unsupported`) */
  kind: StackNodeKind | 'unsupported';
  name: string;
  /** the A-side value: a version (node moves) or the declared range(s) (`spec-changed`); null when absent */
  from: string | null;
  /** the B-side value, same convention */
  to: string | null;
  /** 'name' = the whole name entered/left; 'version' = one copy of a name present on both sides; 'edge' = a range */
  scope: 'name' | 'version' | 'edge';
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
  /** NOT identity: how many `node_modules/…` paths the from/to node occupied (hoisting churn made visible) */
  layoutPaths: { from: number; to: number };
  reasons: string[];
  /** true only for `unknown` — the direction is unproven, so approval cannot be granted */
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
  /** any `unknown` row, or a digest change no row explains */
  approvalBlocked: boolean;
  /** any `backward` or `unknown` move: a later reconcile must carry an explicit acknowledged rationale */
  downgradeAckRequired: boolean;
  /** the digests differ but no digest-bearing row explains it (e.g. `runtime`/`images[]` moved) — fail closed */
  unexplainedDigestChange: boolean;
  summary: Record<StackMoveClass, number>;
  /** sorted by (rank desc, name, kind, class, from, to, declaredBy) */
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

/** The explicit total order of the report. Input array order never participates. */
export function compareStackMoves(a: StackMove, b: StackMove): number {
  return (
    STACK_MOVE_RANK[b.class] - STACK_MOVE_RANK[a.class] ||
    cmp(a.name, b.name) ||
    cmp(a.kind, b.kind) ||
    cmp(a.class, b.class) ||
    cmp(a.from ?? '', b.from ?? '') ||
    cmp(a.to ?? '', b.to ?? '') ||
    cmp(a.declaredBy ?? '', b.declaredBy ?? '')
  );
}

/**
 * The digest-bearing fields of a node besides the join key: EVERY field the node carries except the
 * non-hashed `layout`, the derived `id` and (kind, name, version). Derived from the node itself, never
 * from a fixed list — a field a later manifest revision adds to the hashed view (e.g. `resolved` on a
 * node without integrity) is compared the day it appears, instead of being silently ignored.
 */
const NON_IDENTITY_FIELDS = new Set(['layout', 'id', 'kind', 'name', 'version']);

function identityFields(...nodes: StackNode[]): string[] {
  const fields = new Set<string>();
  for (const n of nodes) for (const k of Object.keys(n)) if (!NON_IDENTITY_FIELDS.has(k)) fields.add(k);
  return [...fields].sort();
}

function fieldValue(node: StackNode, field: string): string {
  return stableStringify((node as unknown as Record<string, unknown>)[field] ?? null);
}

function identityOf(node: StackNode): string {
  return identityFields(node).map((f) => `${f}=${fieldValue(node, f)}`).join(SEP);
}

/* ---- opaque nodes: a kind this classifier cannot compare ---- */

function isOpaque(node: StackNode): boolean {
  return !STACK_COMPARABLE_KINDS.includes(node.kind as string);
}

function opaqueField(node: StackNode, field: string): string | null {
  const v = (node as unknown as Record<string, unknown>)[field];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The label an opaque node joins on: its `key`, else its name, else its id. */
function opaqueKey(node: StackNode): string {
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

/** True when the manifest carries the quarantined `rootDeclared[]` list (a manifest that predates the field does not). */
function hasRootDeclared(manifest: StackManifest): boolean {
  return Array.isArray(manifest.rootDeclared) && manifest.rootDeclared.length > 0;
}

/**
 * What the repository root declares directly: name key -> the sorted range(s). SOURCE: the manifest's
 * own `rootDeclared[]` (read straight from `packages[""]`, so it also names a declared dependency that
 * resolved to nothing); a manifest that predates the field falls back to the edges leaving a root node.
 */
function rootDeclaredSpecs(manifest: StackManifest): Map<string, string> {
  if (hasRootDeclared(manifest)) {
    const declared = new Map<string, Set<string>>();
    for (const d of manifest.rootDeclared) {
      const key = `npm${SEP}${d.name}`;
      const set = declared.get(key);
      if (set) set.add(d.spec);
      else declared.set(key, new Set([d.spec]));
    }
    return new Map([...declared].map(([k, v]) => [k, [...v].sort().join(' | ')] as const));
  }
  const byId = new Map(manifest.nodes.map((n) => [n.id, n] as const));
  const rootIds = new Set(manifest.nodes.filter((n) => n.root).map((n) => n.id));
  const specs = new Map<string, Set<string>>();
  for (const e of manifest.edges) {
    if (!rootIds.has(e.from)) continue;
    const target = byId.get(e.to);
    if (!target) continue;
    const key = `${target.kind}${SEP}${target.name}`;
    const set = specs.get(key);
    if (set) set.add(e.spec);
    else specs.set(key, new Set([e.spec]));
  }
  return new Map([...specs].map(([k, v]) => [k, [...v].sort().join(' | ')] as const));
}

/**
 * The version-free id of a root node (`root:<name>`), mirroring the hashed view: the repository's OWN
 * version is quarantined, so it must not re-key an edge pair either.
 */
function edgeEndpointId(id: string, rootIdToName: ReadonlyMap<string, string>): string {
  const name = rootIdToName.get(id);
  return name === undefined ? id : `root:${name}`;
}

function maxVersion(versions: readonly string[]): string {
  // callers guarantee every version parses and the list is non-empty
  return versions.reduce((best, v) =>
    compareSemverLite(parseSemverLite(v) as SemverLite, parseSemverLite(best) as SemverLite) > 0 ? v : best,
  );
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
 * Classify every move between two manifests. Deterministic and order-independent: the same pair
 * (in any `nodes[]`/`edges[]` array order) yields a byte-identical `stableStringify(report)`.
 */
export function diffStackManifests(a: StackManifest, b: StackManifest): StackDiffReport {
  // ROOT nodes are compared apart (below): their own version is quarantined out of the identity, and
  // a dependency that merely shares the root's name must not be joined with it.
  const groupsA = groupByName(a.nodes.filter((n) => !isOpaque(n) && !n.root));
  const groupsB = groupByName(b.nodes.filter((n) => !isOpaque(n) && !n.root));
  const rootSpecsA = rootDeclaredSpecs(a);
  const rootSpecsB = rootDeclaredSpecs(b);
  const rootKeys = new Set([...rootSpecsA.keys(), ...rootSpecsB.keys()]);
  const rootSpecOf = (key: string): StackMove['rootSpec'] => ({ from: rootSpecsA.get(key) ?? null, to: rootSpecsB.get(key) ?? null });
  const moves: StackMove[] = [];
  /** node ids whose identity is NOT the same on both sides — a `spec-changed` row needs unchanged endpoints */
  const rewrittenIds = new Set<string>();

  const push = (
    g: { kind: StackNodeKind; name: string },
    key: string,
    cls: StackMoveClass,
    from: string | null,
    to: string | null,
    scope: StackMove['scope'],
    reasons: string[],
  ): void => {
    moves.push({
      class: cls,
      kind: g.kind,
      name: g.name,
      from,
      to,
      scope,
      rootDeclared: rootKeys.has(key),
      declaredBy: null,
      rootSpec: rootSpecOf(key),
      layoutPaths: { from: layoutCount(groupsA.get(key), from), to: layoutCount(groupsB.get(key), to) },
      reasons,
      approvalBlocked: cls === 'unknown',
    });
  };

  for (const key of new Set([...groupsA.keys(), ...groupsB.keys()])) {
    const ga = groupsA.get(key);
    const gb = groupsB.get(key);

    // ---- name present on one side only ----
    if (!ga && gb) {
      for (const v of gb.byVersion.keys()) {
        if (parseSemverLite(v)) push(gb, key, 'added', null, v, 'name', ['name present on the head side only']);
        else push(gb, key, 'unknown', null, v, 'name', [`added node has a non-semver version '${v}': what entered the closure cannot be characterized`]);
      }
      continue;
    }
    if (ga && !gb) {
      for (const v of ga.byVersion.keys()) push(ga, key, 'removed', v, null, 'name', ['name present on the base side only']);
      continue;
    }
    if (!ga || !gb) continue;

    // ---- same name+version on both sides: identical, or rewritten ----
    const onlyA: string[] = [];
    const onlyB: string[] = [];
    for (const [v, nodesA] of ga.byVersion) {
      const nodesB = gb.byVersion.get(v);
      if (!nodesB) {
        onlyA.push(v);
        continue;
      }
      const idA = nodesA.map(identityOf).sort();
      const idB = nodesB.map(identityOf).sort();
      if (idA.join(SEP + SEP) === idB.join(SEP + SEP)) continue;
      const first = nodesA[0] as StackNode;
      const second = nodesB[0] as StackNode;
      const fields =
        nodesA.length === 1 && nodesB.length === 1
          ? identityFields(first, second).filter((f) => fieldValue(first, f) !== fieldValue(second, f))
          : [];
      push(ga, key, 'rewritten', v, v, 'version', [
        fields.length > 0 ? `same name+version, different ${fields.join(', ')}` : 'same name+version, different node set',
      ]);
      rewrittenIds.add(first.id);
    }
    for (const v of gb.byVersion.keys()) if (!ga.byVersion.has(v)) onlyB.push(v);
    if (onlyA.length === 0 && onlyB.length === 0) continue;

    // ---- a version moved: the direction must be PROVABLE for every version of the name ----
    const allA = [...ga.byVersion.keys()];
    const allB = [...gb.byVersion.keys()];
    const unparsable = [...new Set([...allA, ...allB])].filter((v) => parseSemverLite(v) === null).sort();
    if (unparsable.length > 0) {
      const why = `non-semver version(s) ${unparsable.map((v) => `'${v}'`).join(', ')}: direction cannot be proven`;
      for (const v of onlyA) push(ga, key, 'unknown', v, null, 'version', [why]);
      for (const v of onlyB) push(gb, key, 'unknown', null, v, 'version', [why]);
      continue;
    }

    const maxA = maxVersion(allA);
    const semMaxA = parseSemverLite(maxA) as SemverLite;
    const usedFrom = new Set<string>();
    for (const v of onlyB) {
      const c = compareSemverLite(parseSemverLite(v) as SemverLite, semMaxA);
      usedFrom.add(maxA);
      if (c > 0) push(gb, key, 'forward', maxA, v, 'version', [`semver strictly higher than the max base version ${maxA}`]);
      else if (c < 0) push(gb, key, 'backward', maxA, v, 'version', [`semver strictly lower than the max base version ${maxA}`]);
      else push(gb, key, 'unknown', maxA, v, 'version', [`'${v}' and '${maxA}' have equal semver precedence but differ (build metadata): direction cannot be proven`]);
    }
    if (onlyB.length === 0) {
      // only copies were dropped: if the HIGHEST resolved version is among them, the name moved backward
      const maxB = maxVersion(allB);
      const c = compareSemverLite(parseSemverLite(maxB) as SemverLite, semMaxA);
      if (c < 0) {
        usedFrom.add(maxA);
        push(ga, key, 'backward', maxA, maxB, 'version', [`the highest base version ${maxA} was dropped; the highest remaining is ${maxB}`]);
      } else if (c === 0 && maxB !== maxA) {
        usedFrom.add(maxA);
        push(ga, key, 'unknown', maxA, maxB, 'version', [`'${maxB}' and '${maxA}' have equal semver precedence but differ (build metadata): direction cannot be proven`]);
      }
    }
    for (const v of onlyA) {
      if (usedFrom.has(v)) continue; // already the `from` of a directional row
      push(ga, key, 'removed', v, null, 'version', ['a copy of a name that is still present was dropped']);
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
  for (const k of new Set([...rootsA.keys(), ...rootsB.keys()])) {
    const ra = rootsA.get(k) ?? [];
    const rb = rootsB.get(k) ?? [];
    const sample = (ra[0] ?? rb[0]) as StackNode;
    const versions = (list: StackNode[]): string | null => (list.length === 0 ? null : list.map((n) => n.version).sort().join(', '));
    const row = (cls: StackMoveClass, reason: string): void => {
      moves.push({
        class: cls,
        kind: sample.kind,
        name: sample.name,
        from: versions(ra),
        to: versions(rb),
        scope: 'name',
        rootDeclared: false,
        declaredBy: null,
        rootSpec: { from: null, to: null },
        layoutPaths: { from: ra.reduce((n, x) => n + x.layout.length, 0), to: rb.reduce((n, x) => n + x.layout.length, 0) },
        reasons: [reason],
        approvalBlocked: cls === 'unknown',
      });
      for (const n of [...ra, ...rb]) rewrittenIds.add(`root:${n.name}`);
    };
    if (ra.length === 0 || rb.length === 0) {
      // a renamed / different repository root: the two manifests describe different SUBJECTS
      row('unknown', `root package '${sample.name}' is present on the ${ra.length === 0 ? 'head' : 'base'} side only: the manifests describe different subjects`);
    } else if (ra.map(rootIdentity).sort().join(SEP + SEP) !== rb.map(rootIdentity).sort().join(SEP + SEP)) {
      const fields = ra.length === 1 && rb.length === 1 ? identityFields(ra[0] as StackNode, rb[0] as StackNode).filter((f) => fieldValue(ra[0] as StackNode, f) !== fieldValue(rb[0] as StackNode, f)) : [];
      row('rewritten', fields.length > 0 ? `root package, different ${fields.join(', ')}` : 'root package, different node set');
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
  for (const k of new Set([...opaqueA.keys(), ...opaqueB.keys()])) {
    const na = opaqueA.get(k) ?? [];
    const nb = opaqueB.get(k) ?? [];
    const idA = na.map(opaqueIdentity).sort().join(SEP);
    const idB = nb.map(opaqueIdentity).sort().join(SEP);
    if (idA === idB) continue; // unchanged: never a row
    const sample = (na[0] ?? nb[0]) as StackNode;
    const what = na.length === 0 ? 'added' : nb.length === 0 ? 'removed' : 'changed';
    moves.push({
      class: 'unknown',
      kind: sample.kind as StackMove['kind'],
      name: opaqueKey(sample),
      from: na.length === 0 ? null : na.map(opaqueLabel).sort().join(', '),
      to: nb.length === 0 ? null : nb.map(opaqueLabel).sort().join(', '),
      scope: 'name',
      rootDeclared: false,
      declaredBy: null,
      rootSpec: { from: null, to: null },
      layoutPaths: { from: na.reduce((n, x) => n + (x.layout?.length ?? 0), 0), to: nb.reduce((n, x) => n + (x.layout?.length ?? 0), 0) },
      reasons: [`opaque '${sample.kind as string}' node ${what}: its content cannot be compared, so the move cannot be proven safe`],
      approvalBlocked: true,
    });
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
  for (const k of new Set([...unmodeledA.keys(), ...unmodeledB.keys()])) {
    const ua = unmodeledA.get(k) ?? [];
    const ub = unmodeledB.get(k) ?? [];
    if (ua.map((u) => stableStringify(u)).sort().join(SEP) === ub.map((u) => stableStringify(u)).sort().join(SEP)) continue;
    const what = ua.length === 0 ? 'added' : ub.length === 0 ? 'removed' : 'changed';
    const reasonsSeen = [...new Set([...ua, ...ub].map((u) => u.reason))].sort().join(', ');
    moves.push({
      class: 'unknown',
      kind: 'unsupported',
      name: k,
      from: ua.length === 0 ? null : unmodeledLabel(ua),
      to: ub.length === 0 ? null : unmodeledLabel(ub),
      scope: 'name',
      rootDeclared: false,
      declaredBy: null,
      rootSpec: { from: null, to: null },
      layoutPaths: { from: 0, to: 0 },
      reasons: [`unmodeled entry '${k}' (${reasonsSeen}) ${what}: it is content-hashed but not modeled, so the move cannot be proven safe`],
      approvalBlocked: true,
    });
  }

  // ---- spec-changed: the same (from,to) pair of UNCHANGED nodes declares a different range ----
  const pairsA = specsByPair(a);
  const pairsB = specsByPair(b);
  const nodeByIdB = new Map(b.nodes.map((n) => [n.root ? `root:${n.name}` : n.id, n] as const));
  // root-declared ranges come from `rootDeclared[]` when BOTH manifests carry it (below); the edge
  // pairs leaving the root are then skipped so one range move is never reported twice.
  const rootFromField = hasRootDeclared(a) && hasRootDeclared(b);
  for (const [pairKey, pa] of pairsA) {
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
    moves.push({
      class: 'spec-changed',
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
      approvalBlocked: false,
    });
  }

  if (rootFromField) {
    const rootName = (m: StackManifest): string => m.nodes.find((n) => n.root)?.name ?? '(root)';
    const movedKeys = new Set(moves.filter((m) => m.class !== 'spec-changed').map((m) => `${m.kind}${SEP}${m.name}`));
    for (const [key, specA] of rootSpecsA) {
      const specB = rootSpecsB.get(key);
      if (specB === undefined || specB === specA) continue;
      if (movedKeys.has(key)) continue; // the range rides on that move's `rootSpec`; spec-changed needs unchanged nodes
      const name = key.slice(key.indexOf(SEP) + 1);
      const version = [...(groupsB.get(key)?.byVersion.keys() ?? [])].sort()[0] ?? null;
      moves.push({
        class: 'spec-changed',
        kind: 'npm',
        name,
        from: specA,
        to: specB,
        scope: 'edge',
        rootDeclared: true,
        declaredBy: `root:${rootName(b)}`,
        rootSpec: { from: specA, to: specB },
        layoutPaths: { from: layoutCount(groupsA.get(key), version), to: layoutCount(groupsB.get(key), version) },
        reasons: [`declared range on root:${rootName(b)} moved; the resolved nodes are unchanged (digest-neutral)`],
        approvalBlocked: false,
      });
    }
  }

  moves.sort(compareStackMoves);

  const digestA = computeStackDigest(a);
  const digestB = computeStackDigest(b);
  const digestEqual = digestA === digestB;
  const digestBearing = moves.some((m) => m.class !== 'spec-changed');
  const unexplainedDigestChange = !digestEqual && !digestBearing;

  const summary: Record<StackMoveClass, number> = {
    added: 0,
    removed: 0,
    forward: 0,
    backward: 0,
    rewritten: 0,
    'spec-changed': 0,
    unknown: 0,
  };
  for (const m of moves) summary[m.class] += 1;

  let topRank = unexplainedDigestChange ? STACK_MOVE_RANK.unknown : 0;
  let top: StackMoveClass | null = unexplainedDigestChange ? 'unknown' : null;
  for (const m of moves) {
    if (STACK_MOVE_RANK[m.class] > topRank) {
      topRank = STACK_MOVE_RANK[m.class];
      top = m.class;
    }
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
    summary,
    moves,
  };
}

/** The CLI exit code of a report: 2 when any move is `backward` or `unknown` (fail closed), else 0. */
export function stackDiffExitCode(report: StackDiffReport): 0 | 2 {
  return report.approvalBlocked || report.downgradeAckRequired ? 2 : 0;
}
