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
 *   schemaVersion, kind, nodes[] (every StackNode field EXCEPT `layout`), runtime, images[].
 * QUARANTINED OUT of the digest (present in the manifest, never hashed):
 *   ctRepoRevision (same closure at two revisions ⇒ same digest), sources[].sha256 (whitespace /
 *   key-order churn of the lockfile must not move the digest), edges (a pure function of the node
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
import { stableStringify } from './report.js';

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
    /** the lockfile's `hasInstallScript` flag — a node that runs code at install time */
    installScript: z.boolean(),
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
    parser: z.enum(['npm-lockfile-v3', 'package-json', 'dockerfile', 'compose', 'nvmrc', 'node-version']),
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
export const STACK_HASHED_VIEW_KEYS = Object.freeze(['schemaVersion', 'kind', 'nodes', 'runtime', 'images'] as const);
/** The manifest keys deliberately kept OUT of the digest. */
export const STACK_QUARANTINED_KEYS = Object.freeze([
  'ctRepoRevision',
  'sources',
  'edges',
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

/** A StackNode with the non-hashed `layout` removed — the shape that enters the digest. */
export type HashedStackNode = Omit<StackNode, 'layout'>;

export interface StackHashedView {
  schemaVersion: '1';
  kind: 'StackManifest';
  nodes: HashedStackNode[];
  runtime: StackRuntime;
  images: StackImage[];
}

/**
 * Build the HASHED VIEW of a manifest body: the identity-bearing subset, arrays re-sorted with
 * the canonical comparators (idempotent on an already-sorted body) and `layout` stripped from
 * every node. Everything in the quarantine list is absent by construction — there is no field
 * an extractor can set that leaks into the digest by accident.
 */
export function stackHashedView(body: StackManifestBody | StackManifest): StackHashedView {
  const nodes = [...body.nodes].sort(compareStackNodes).map((n) => {
    const { layout, ...hashed } = n;
    void layout;
    return hashed;
  });
  const images = [...body.images].sort(compareStackImages);
  return { schemaVersion: '1', kind: 'StackManifest', nodes, runtime: body.runtime, images };
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

/**
 * Sort every array with its canonical comparator and derive `stackDigest`, `stackId` and
 * `manifestDigest`. The result validates STRICTLY — an extractor that hands over an out-of-schema
 * body fails here, never in a consumer.
 */
export function finalizeStackManifest(body: StackManifestBody): StackManifest {
  const sorted: StackManifestBody = {
    ...body,
    sources: [...body.sources].sort(compareStackSources),
    nodes: [...body.nodes].sort(compareStackNodes).map((n) => ({ ...n, layout: [...n.layout].sort() })),
    edges: [...body.edges].sort(compareStackEdges),
    images: [...body.images].sort(compareStackImages),
    coverage: { ...body.coverage, unsupported: [...new Set(body.coverage.unsupported)].sort() },
  };
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
