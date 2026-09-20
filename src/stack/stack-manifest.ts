/**
 * StackManifest — the declared dependency closure of a repository at a revision, as a
 * content-addressed artifact (stack slice 1).
 *
 * PURE MODULE: no filesystem, no network, no process state. It imports only `node:crypto`,
 * `zod` (the schema vocabulary every authored/emitted kind in this engine uses) and relative
 * modules. The extractor (`stack-extractor.ts`) reads files; this module only shapes, sorts and
 * hashes what it is handed.
 *
 * The identity primitive is `stackDigest` — sha256 over the HASHED VIEW below — and its human
 * handle `stackId = 'stack:' + first 12 hex`. Two revisions whose lockfiles resolve to the same
 * closure share a digest; that IS the join key later work reads.
 *
 * HASHED VIEW (exactly these keys, key-sorted by `stableStringify`):
 *   schemaVersion, kind, nodes[] (every StackNode field EXCEPT `layout`), runtime,
 *   images[] (every field EXCEPT `evidenceRef` — a comment line above a FROM must not re-key),
 *   unmodeled[] (every lockfile entry the extractor cannot fully model, as an OPAQUE node: the
 *   digest always moves when the closure moves, even where slice 1 cannot say what moved).
 * The ROOT node's own `version` is quarantined: in the view it carries no `version` and its `id`
 * is `root:<name>` (the manifest keeps the real `npm:<name>@<version>` for display), so a release
 * bump of the repository itself never re-keys the digest of an unchanged closure. The root `name`
 * stays hashed — a renamed package is a different subject. Declared RANGES (root or not) are never
 * hashed: the digest names the RESOLVED closure; ranges live in the quarantined `edges`.
 * QUARANTINED OUT of the digest (present in the manifest, never hashed):
 *   ctRepoRevision (same closure at two revisions ⇒ same digest), sources[].sha256 (whitespace /
 *   key-order churn of the lockfile must not move the digest), rootDeclared (declared ranges), edges (a pure function of the node
 *   set + the resolver walk — hashing them adds resolver surface, no executable information),
 *   coverage, stackId, manifestDigest. Nothing read from the network, the platform, the machine's
 *   npm/node version, the wall-clock or file mtimes ever enters the view.
 *
 * `manifestDigest` is a SEPARATE tamper-detection field: sha256 over the whole manifest minus
 * itself, so a committed manifest file can be re-derived and checked byte-for-byte.
 *
 * Determinism is a hard contract: every array is sorted by the producer before serialization;
 * `stableStringify` (sorted keys, 2-space indent, LF, one trailing newline) is the only serializer.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod/v3';
import { stableStringify } from '../report.js';

/* -------------------------------------------------------------------------- */
/* Schema (strict at every level — a typo is a hard error, never a silent extra) */
/* -------------------------------------------------------------------------- */

export const StackNodeKindSchema = z.enum(['npm', 'oci-image', 'node-runtime']);
export type StackNodeKind = z.infer<typeof StackNodeKindSchema>;

export const StackResolvedFromSchema = z.enum(['lockfile', 'dockerfile', 'compose', 'engines', 'nvmrc', 'node-version']);
export type StackResolvedFrom = z.infer<typeof StackResolvedFromSchema>;

export const StackNodeSchema = z
  .object({
    /** the bom-ref: `${kind}:${name}@${version}` — unique after identity dedup */
    id: z.string().min(1),
    kind: StackNodeKindSchema,
    name: z.string().min(1),
    version: z.string().min(1),
    /** `sha512-…` verbatim from the lockfile; an image digest (`sha256:…`); null for the root + runtime */
    integrity: z.string().nullable(),
    resolvedFrom: StackResolvedFromSchema,
    dev: z.boolean(),
    optional: z.boolean(),
    peer: z.boolean(),
    /** `{os, cpu}` when the lockfile entry carries either array, else null */
    platformConditional: z.object({ os: z.array(z.string()), cpu: z.array(z.string()) }).strict().nullable(),
    /** true only for the `""` package (the repository itself) */
    root: z.boolean(),
    /** npm's `devOptional` flag (dev OR optional) — AND across every copy of the identity */
    devOptional: z.boolean(),
    /** the lockfile's `hasInstallScript` flag — a node that runs code at install time (OR across copies) */
    installScript: z.boolean(),
    /**
     * The lockfile's `resolved` (tarball URL / git URL + commit) — recorded ONLY when `integrity`
     * is null. With an integrity the bytes are pinned and a mirror swap is content-neutral, so
     * `resolved` stays out of the identity; without one, `resolved` is the only thing that names
     * the bytes and MUST move the digest.
     */
    resolvedWhenUnpinned: z.string().nullable(),
    /**
     * NOT HASHED: the `node_modules/…` paths this identity occupied. Hoisting is an npm-version
     * artefact of the same closure, so layout churn is explanation, never identity.
     */
    layout: z.array(z.string()),
  })
  .strict();
export type StackNode = z.infer<typeof StackNodeSchema>;

export const StackEdgeSchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    /** the range as declared by `from` (e.g. `^4.0.7`) */
    spec: z.string(),
    dev: z.boolean(),
    optional: z.boolean(),
    peer: z.boolean(),
  })
  .strict();
export type StackEdge = z.infer<typeof StackEdgeSchema>;

export const StackSourceSchema = z
  .object({
    path: z.string().min(1),
    /** sha256 of the file bytes as read — NOT in the digest (a re-serialized lockfile is the same closure) */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    parser: z.enum(['npm-lockfile-v3', 'pnpm-lockfile-v9', 'package-json', 'dockerfile', 'compose', 'nvmrc', 'node-version']),
  })
  .strict();
export type StackSource = z.infer<typeof StackSourceSchema>;

export const StackRuntimeSchema = z
  .object({
    node: z
      .object({
        declared: z.string().nullable(),
        resolvedFrom: z.enum(['nvmrc', 'node-version', 'engines']).nullable(),
        /** true only for an exact `x.y.z` — a range is not a pin */
        pin: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type StackRuntime = z.infer<typeof StackRuntimeSchema>;

export const StackImageSchema = z
  .object({
    /** the reference as written, e.g. `node:22-alpine@sha256:…` */
    ref: z.string().min(1),
    name: z.string().min(1),
    tag: z.string().nullable(),
    /** true when no tag was written and `latest` was implied — the moving-tag hazard made visible */
    tagImplicit: z.boolean(),
    digest: z.string().nullable(),
    /** true only when a `@sha256:` digest pins the image */
    pin: z.boolean(),
    /** always false in slice 1 — resolution is a separate verb that writes a proposal, never a manifest field */
    resolved: z.literal(false),
    resolvedFrom: z.enum(['dockerfile', 'compose']),
    /** evidence anchor `path#L<line>` */
    evidenceRef: z.string().min(1),
  })
  .strict();
export type StackImage = z.infer<typeof StackImageSchema>;

/**
 * An OPAQUE node: a lockfile entry slice 1 cannot fully model (an `npm:` alias, a `link:` workspace
 * entry or its target, a git/file dependency, a non-ASCII name). It is HASHED — `entrySha256` covers
 * the entire raw entry — so two closures that differ only in such an entry never share a digest.
 * `key` is the lockfile key (path-dependent by necessity: an unmodeled entry has no trusted identity).
 */
export const StackUnmodeledSchema = z
  .object({
    kind: z.literal('unsupported'),
    key: z.string().min(1),
    reason: z.enum(['npm-alias', 'link', 'local-or-git', 'non-ascii-name', 'not-under-node-modules', 'pnpm-patched', 'pnpm-unread-section']),
    /** the raw distinguishing strings, as read */
    spec: z
      .object({
        name: z.string().nullable(),
        version: z.string().nullable(),
        resolved: z.string().nullable(),
        integrity: z.string().nullable(),
        link: z.boolean(),
      })
      .strict(),
    /** sha256 over the canonical serialization of the ENTIRE raw lockfile entry */
    entrySha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type StackUnmodeled = z.infer<typeof StackUnmodeledSchema>;

/**
 * One dependency range DECLARED by the root package (`packages[""]`). QUARANTINED — never hashed:
 * the digest names the RESOLVED closure, and a range-only edit with identical resolved nodes leaves
 * the running stack identical. Kept in the manifest as the source for a diff's spec-changed rows.
 */
export const StackRootDeclaredSchema = z
  .object({
    name: z.string().min(1),
    spec: z.string(),
    group: z.enum(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']),
  })
  .strict();
export type StackRootDeclared = z.infer<typeof StackRootDeclaredSchema>;

export const StackCoverageSchema = z
  .object({
    /** every fidelity limit and every refused input, as fixed strings — never claim full coverage */
    unsupported: z.array(z.string()),
    filesScanned: z.number().int().min(0),
  })
  .strict();
export type StackCoverage = z.infer<typeof StackCoverageSchema>;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const StackManifestSchema = z
  .object({
    schemaVersion: z.literal('1'),
    kind: z.literal('StackManifest'),
    /** the revision the tree was materialized from — the determinism anchor; NOT in the digest */
    ctRepoRevision: z.string().min(1),
    /** sorted by path */
    sources: z.array(StackSourceSchema),
    /** sorted by (kind, name, version, integrity) */
    nodes: z.array(StackNodeSchema),
    /** sorted by (from, to, spec) — NOT in the digest */
    edges: z.array(StackEdgeSchema),
    runtime: StackRuntimeSchema,
    /** sorted by (ref, evidenceRef) */
    images: z.array(StackImageSchema),
    /** sorted by (group, name) — NOT in the digest: the ranges the root package declares */
    rootDeclared: z.array(StackRootDeclaredSchema),
    /** sorted by key — HASHED opaque nodes for every lockfile entry slice 1 cannot model */
    unmodeled: z.array(StackUnmodeledSchema),
    coverage: StackCoverageSchema,
    /** sha256 hex over the HASHED VIEW — the identity */
    stackDigest: Hex64,
    /** `stack:` + the first 12 hex of stackDigest — the human handle */
    stackId: z.string().regex(/^stack:[0-9a-f]{12}$/),
    /** sha256 hex over the whole manifest minus this field — tamper detection of the file itself */
    manifestDigest: Hex64,
  })
  .strict();
export type StackManifest = z.infer<typeof StackManifestSchema>;

/** The manifest before its digests are derived (what an extractor hands to `finalizeStackManifest`). */
export type StackManifestBody = Omit<StackManifest, 'stackDigest' | 'stackId' | 'manifestDigest'>;

/** The exact key set that is hashed. Exported so a test can assert the quarantine list, not trust it. */
export const STACK_HASHED_VIEW_KEYS = Object.freeze(['schemaVersion', 'kind', 'nodes', 'runtime', 'images', 'unmodeled'] as const);
/** The manifest keys deliberately kept OUT of the digest. */
export const STACK_QUARANTINED_KEYS = Object.freeze([
  'ctRepoRevision',
  'sources',
  'edges',
  'rootDeclared',
  'coverage',
  'stackId',
  'manifestDigest',
] as const);

/* -------------------------------------------------------------------------- */
/* Comparators — every array is sorted by the producer, never by the serializer */
/* -------------------------------------------------------------------------- */

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareStackNodes(a: StackNode, b: StackNode): number {
  return (
    cmp(a.kind, b.kind) ||
    cmp(a.name, b.name) ||
    cmp(a.version, b.version) ||
    cmp(a.integrity ?? '', b.integrity ?? '')
  );
}

export function compareStackEdges(a: StackEdge, b: StackEdge): number {
  return cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.spec, b.spec);
}

export function compareStackSources(a: StackSource, b: StackSource): number {
  return cmp(a.path, b.path);
}

export function compareStackImages(a: StackImage, b: StackImage): number {
  return cmp(a.ref, b.ref) || cmp(a.evidenceRef, b.evidenceRef);
}

export function compareStackRootDeclared(a: StackRootDeclared, b: StackRootDeclared): number {
  return cmp(a.group, b.group) || cmp(a.name, b.name);
}

export function compareStackUnmodeled(a: StackUnmodeled, b: StackUnmodeled): number {
  return cmp(a.key, b.key);
}

/** The bom-ref for a (kind, name, version) identity. */
export function stackNodeId(kind: StackNodeKind, name: string, version: string): string {
  return `${kind}:${name}@${version}`;
}

/* -------------------------------------------------------------------------- */
/* Digest                                                                      */
/* -------------------------------------------------------------------------- */

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * The shape of a node that enters the digest: `layout` removed; for the ROOT node `version` is
 * removed too and `id` is the version-free `root:<name>`.
 */
export type HashedStackNode = Omit<StackNode, 'layout'> | Omit<StackNode, 'layout' | 'version'>;

/** A StackImage with the non-hashed `evidenceRef` (a line number) removed. */
export type HashedStackImage = Omit<StackImage, 'evidenceRef'>;

export interface StackHashedView {
  schemaVersion: '1';
  kind: 'StackManifest';
  nodes: HashedStackNode[];
  runtime: StackRuntime;
  images: HashedStackImage[];
  unmodeled: StackUnmodeled[];
}

/**
 * Build the HASHED VIEW of a manifest body: the identity-bearing subset, arrays re-sorted with
 * the canonical comparators (idempotent on an already-sorted body) and `layout` stripped from
 * every node. Everything in the quarantine list is absent by construction — there is no field
 * an extractor can set that leaks into the digest by accident.
 */
export function stackHashedView(body: StackManifestBody | StackManifest): StackHashedView {
  const hashedNodes = body.nodes.map((n): HashedStackNode => {
    const { layout, ...hashed } = n;
    void layout;
    if (!n.root) return hashed;
    // the repository's OWN version is not part of its dependency closure
    const { version, ...rootHashed } = hashed;
    void version;
    return { ...rootHashed, id: `root:${n.name}` };
  });
  // order by the HASHED form, never by a quarantined field (the root's version must not decide
  // where the root sorts among same-named nodes)
  const nodes = hashedNodes
    .map((h) => ({ h, k: stableStringify(h) }))
    .sort((x, y) => cmp(x.k, y.k))
    .map((x) => x.h);
  // strip FIRST, sort AFTER: a quarantined field must not decide the hashed ORDER either
  const images = body.images
    .map((i) => {
      const { evidenceRef, ...hashed } = i;
      void evidenceRef;
      return hashed;
    })
    .map((h) => ({ h, k: stableStringify(h) }))
    .sort((a, b) => cmp(a.k, b.k))
    // the hashed view holds the SET of image identities: the same ref declared by a second Dockerfile
    // or compose service is the same closure (the manifest keeps every declaration, with its evidenceRef)
    .filter((x, i, all) => i === 0 || all[i - 1]!.k !== x.k)
    .map((x) => x.h);
  const unmodeled = [...body.unmodeled].sort(compareStackUnmodeled);
  return { schemaVersion: '1', kind: 'StackManifest', nodes, runtime: body.runtime, images, unmodeled };
}

/** `stackDigest = sha256(stableStringify(hashedView))` — the same formula the evidence record uses. */
export function computeStackDigest(body: StackManifestBody | StackManifest): string {
  return sha256(stableStringify(stackHashedView(body)));
}

/** The human handle: `stack:` + the first 12 hex of the digest (every JSON field carries the full digest). */
export function stackIdFor(stackDigest: string): string {
  return `stack:${stackDigest.slice(0, 12)}`;
}

/** sha256 over the whole manifest minus `manifestDigest` — the tamper-detection field. */
export function computeManifestDigest(manifest: Omit<StackManifest, 'manifestDigest'>): string {
  return sha256(stableStringify(manifest));
}

/** Every array of a manifest body in its CANONICAL order — the one order `finalizeStackManifest` writes. */
function canonicalStackManifestBody(body: StackManifestBody): StackManifestBody {
  return {
    ...body,
    sources: [...body.sources].sort(compareStackSources),
    nodes: [...body.nodes].sort(compareStackNodes).map((n) => ({ ...n, layout: [...n.layout].sort() })),
    edges: [...body.edges].sort(compareStackEdges),
    images: [...body.images].sort(compareStackImages),
    rootDeclared: [...body.rootDeclared].sort(compareStackRootDeclared),
    unmodeled: [...body.unmodeled].sort(compareStackUnmodeled),
    coverage: { ...body.coverage, unsupported: [...new Set(body.coverage.unsupported)].sort() },
  };
}

/**
 * The `manifestDigest` a manifest WOULD carry in canonical array order, with every recorded digest
 * (`stackDigest`, `stackId`, `manifestDigest`) re-derived and none of them trusted. `manifestDigest`
 * itself covers the file's bytes, so it moves when the same content is merely re-ordered; this one
 * does not. For a manifest `finalizeStackManifest` wrote — everything `bce stack snapshot` emits — it
 * EQUALS the recorded `manifestDigest`.
 */
export function computeCanonicalManifestDigest(manifest: StackManifest): string {
  const { stackDigest, stackId, manifestDigest, ...body } = manifest;
  void stackDigest;
  void stackId;
  void manifestDigest;
  const sorted = canonicalStackManifestBody(body);
  const derived = computeStackDigest(sorted);
  return computeManifestDigest({ ...sorted, stackDigest: derived, stackId: stackIdFor(derived) });
}

/**
 * Sort every array with its canonical comparator and derive `stackDigest`, `stackId` and
 * `manifestDigest`. The result validates STRICTLY — an extractor that hands over an out-of-schema
 * body fails here, never in a consumer.
 */
export function finalizeStackManifest(body: StackManifestBody): StackManifest {
  const sorted = canonicalStackManifestBody(body);
  const stackDigest = computeStackDigest(sorted);
  const withoutManifestDigest = { ...sorted, stackDigest, stackId: stackIdFor(stackDigest) };
  const manifestDigest = computeManifestDigest(withoutManifestDigest);
  return StackManifestSchema.parse({ ...withoutManifestDigest, manifestDigest });
}

/** Parse + strictly validate an untrusted StackManifest document (a committed file, a tool result). */
export function parseStackManifest(raw: unknown): StackManifest {
  return StackManifestSchema.parse(raw);
}

export interface StackManifestVerification {
  /** the recorded stackDigest re-derives from the hashed view */
  stackDigestOk: boolean;
  /** the recorded stackId is the handle of the recorded stackDigest */
  stackIdOk: boolean;
  /** the recorded manifestDigest re-derives from the manifest bytes minus itself */
  manifestDigestOk: boolean;
  valid: boolean;
}

/**
 * Re-derive every digest of a manifest and compare — the tamper check. A manifest whose recorded
 * digests do not re-derive was edited after extraction (or produced by a non-conforming tool).
 */
export function verifyStackManifest(manifest: StackManifest): StackManifestVerification {
  const stackDigestOk = computeStackDigest(manifest) === manifest.stackDigest;
  const stackIdOk = stackIdFor(manifest.stackDigest) === manifest.stackId;
  const { manifestDigest, ...rest } = manifest;
  const manifestDigestOk = computeManifestDigest(rest) === manifestDigest;
  return { stackDigestOk, stackIdOk, manifestDigestOk, valid: stackDigestOk && stackIdOk && manifestDigestOk };
}
