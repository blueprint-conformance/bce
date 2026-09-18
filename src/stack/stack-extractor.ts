/**
 * The stack-facts extractor (slice 1): reads a materialized repository tree and produces a
 * `StackManifest` — the DECLARED dependency closure, never the installed one.
 *
 * Inputs (all read from the tree, nothing else):
 *   - `npm-shrinkwrap.json` (preferred) or `package-lock.json`, lockfileVersion 3 ONLY;
 *   - `package.json` (root identity + `engines.node`);
 *   - `.nvmrc` / `.node-version` (runtime pin);
 *   - `Dockerfile*` / `*.Dockerfile` (`FROM` base images) and `docker-compose*.y*ml` /
 *     `compose.y*ml` (`image:` lines), read line-anchored — no YAML library (the engine's runtime
 *     dependency allowlist admits only zod / ts-morph / @lezer / node: / relative).
 *
 * NEVER: `node_modules` (the installed tree is not the declared closure), the network (no registry
 * lookups, no `docker manifest inspect` — resolution is a separate verb that writes a proposal),
 * `npm ls`, the machine's platform/arch/npm version, or the wall-clock.
 *
 * Refusal is LOUD. An unsupported or malformed lockfile is recorded with a FIXED string in
 * `coverage.unsupported`; when NO supported lockfile could be parsed the extraction additionally
 * returns `refusals` (the CLI exits 2 on them) — a manifest with only the root node is never a
 * green stack, and a silent empty manifest is never emitted.
 *
 * This is a SEPARATE seam from `RepositoryFactsExtractor` (graph.ts): a lockfile is not an
 * ArchitectureGraph, and forcing it into components/edges would make `--extractor` lie.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  finalizeStackManifest,
  stackNodeId,
  type StackEdge,
  type StackImage,
  type StackManifest,
  type StackManifestBody,
  type StackNode,
  type StackRuntime,
  type StackSource,
} from './stack-manifest.js';

/* -------------------------------------------------------------------------- */
/* Fixed refusal / coverage strings (verbatim contract — tests pin these)       */
/* -------------------------------------------------------------------------- */

export const STACK_REFUSAL_PNPM =
  "lockfile 'pnpm-lock.yaml' present but not supported in stack slice 1: pnpm v6/v9 importers/packages/snapshots parser is owned-by-follow-on; no stack facts extracted";
export const STACK_REFUSAL_YARN =
  "lockfile 'yarn.lock' present but not supported in stack slice 1 (classic and berry): owned-by-follow-on; no stack facts extracted";
export const STACK_REFUSAL_NO_LOCKFILE = 'no supported lockfile: declared closure unknown';
export const STACK_COVERAGE_DECLARED_NOT_INSTALLED = 'declared closure, not installed tree: node_modules is never read';
export const STACK_COVERAGE_NO_IMAGES = 'no Dockerfile or compose file found: images[] is empty by absence, not by proof';
export const STACK_COVERAGE_COMPOSE_BUILD_ONLY =
  'compose: build:-only services are not enumerated (line-anchored image: read, no YAML parser)';

/** `lockfileVersion <n> is not 3: …` — npm v1/v2 lockfiles are refused, their tree is not a closure map. */
export function stackRefusalLockfileVersion(version: unknown): string {
  return `lockfileVersion ${String(version)} is not 3: npm v1/v2 lockfiles are refused (their 'dependencies' tree is not a closure map); regenerate with npm >= 7`;
}

export interface StackFactsExtractor {
  readonly source: 'npm-lockfile';
  extract(repoDir: string, revision: string): StackExtractionResult;
}

export interface StackExtractionResult {
  manifest: StackManifest;
  /**
   * Non-empty when the extraction could not honestly describe a closure (no supported lockfile,
   * malformed or wrong-version lockfile). The manifest is still returned (root node + coverage)
   * so a caller can inspect WHY, but it must never be written or graded as a stack.
   */
  refusals: string[];
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readIfPresent(root: string, rel: string): Buffer | null {
  const abs = path.join(root, rel);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return fs.readFileSync(abs);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function asStringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string') ? [...(v as string[])].sort() : null;
}

/** `node_modules/@scope/pkg/node_modules/dep` → `dep`; `node_modules/@scope/pkg` → `@scope/pkg`. */
export function npmNameFromLockPath(lockPath: string): string | null {
  const marker = 'node_modules/';
  const idx = lockPath.lastIndexOf(marker);
  if (idx === -1) return null;
  const name = lockPath.slice(idx + marker.length);
  return name.length > 0 ? name : null;
}

const ASCII = /^[\x21-\x7e]+$/;

/* -------------------------------------------------------------------------- */
/* npm lockfile v3                                                             */
/* -------------------------------------------------------------------------- */

interface LockEntry {
  path: string;
  raw: Record<string, unknown>;
}

interface ParsedLockfile {
  nodes: StackNode[];
  edges: StackEdge[];
  unsupported: string[];
  rootName: string | null;
  rootVersion: string | null;
}

/**
 * Derive nodes + edges from a lockfileVersion-3 `packages` map. Pure over the parsed JSON.
 * Exported for tests (the mutation / negative-control legs feed it re-serialized lockfiles).
 */
export function deriveFromLockfileV3(lock: Record<string, unknown>): ParsedLockfile {
  const packages = isRecord(lock.packages) ? lock.packages : {};
  const unsupported = new Set<string>();
  const entries: LockEntry[] = Object.keys(packages)
    .sort()
    .map((p) => ({ path: p, raw: isRecord(packages[p]) ? (packages[p] as Record<string, unknown>) : {} }));

  // identity dedup: (kind,name,version,integrity) → node; path → node id (for edge resolution)
  const byIdentity = new Map<string, StackNode>();
  const idByPath = new Map<string, string>();
  const idsTaken = new Map<string, string>(); // id → identity key (collision detection)
  let rootName: string | null = null;
  let rootVersion: string | null = null;

  for (const { path: p, raw } of entries) {
    const isRoot = p === '';
    const version = asString(raw.version);
    const resolved = asString(raw.resolved) ?? '';
    const declaredName = asString(raw.name);
    if (isRoot) {
      rootName = declaredName ?? asString(lock.name);
      rootVersion = version ?? asString(lock.version);
      const name = rootName ?? 'root';
      const ver = rootVersion ?? '0.0.0';
      if (!rootName || !rootVersion) unsupported.add('root package has no name/version in the lockfile: identity defaulted');
      const node: StackNode = {
        id: stackNodeId('npm', name, ver),
        kind: 'npm',
        name,
        version: ver,
        integrity: null,
        resolvedFrom: 'lockfile',
        dev: false,
        optional: false,
        peer: false,
        platformConditional: null,
        root: true,
        installScript: raw.hasInstallScript === true,
        layout: [''],
      };
      byIdentity.set(`root`, node);
      idByPath.set('', node.id);
      idsTaken.set(node.id, 'root');
      continue;
    }
    const pathName = npmNameFromLockPath(p);
    if (!pathName) {
      unsupported.add(`lockfile entry '${p}' is not under node_modules/: skipped`);
      continue;
    }
    if (raw.link === true || /^(file:|git\+|github:|gitlab:|bitbucket:)/.test(resolved) || /^(file:|git\+|github:)/.test(version ?? '')) {
      unsupported.add(`workspace/link entry ${p}: local package not part of the declared closure in slice 1`);
      continue;
    }
    if (declaredName !== null && declaredName !== pathName) {
      unsupported.add(`npm: alias at ${p} — alias resolution owned-by-follow-on`);
      continue;
    }
    if (!ASCII.test(pathName)) {
      unsupported.add(`non-ASCII package name at ${p}: skipped (npm registry names are ASCII)`);
      continue;
    }
    if (!version) {
      unsupported.add(`lockfile entry ${p} has no version: skipped`);
      continue;
    }
    const integrity = asString(raw.integrity);
    if (!integrity) unsupported.add(`lockfile entry ${p} has no integrity: node kept with integrity null`);
    const os = asStringArray(raw.os);
    const cpu = asStringArray(raw.cpu);
    const identityKey = `npm\0${pathName}\0${version}\0${integrity ?? ''}`;
    let node = byIdentity.get(identityKey);
    if (!node) {
      let id = stackNodeId('npm', pathName, version);
      const taken = idsTaken.get(id);
      if (taken !== undefined && taken !== identityKey) {
        // same name@version, different integrity — keep both, disambiguate the id, say so
        id = `${id}+${sha256(Buffer.from(integrity ?? '')).slice(0, 12)}`;
        unsupported.add(`duplicate identity ${stackNodeId('npm', pathName, version)} with differing integrity at ${p}: id suffixed`);
      }
      node = {
        id,
        kind: 'npm',
        name: pathName,
        version,
        integrity,
        resolvedFrom: 'lockfile',
        dev: raw.dev === true,
        optional: raw.optional === true,
        peer: raw.peer === true,
        platformConditional: os || cpu ? { os: os ?? [], cpu: cpu ?? [] } : null,
        root: false,
        installScript: raw.hasInstallScript === true,
        layout: [],
      };
      byIdentity.set(identityKey, node);
      idsTaken.set(id, identityKey);
    }
    node.layout.push(p);
    idByPath.set(p, node.id);
  }

  // edges: nearest-ancestor node_modules walk, exactly npm's resolution
  const edges: StackEdge[] = [];
  const seenEdges = new Set<string>();
  const resolveDep = (fromPath: string, dep: string): string | null => {
    let base = fromPath;
    for (;;) {
      const candidate = base === '' ? `node_modules/${dep}` : `${base}/node_modules/${dep}`;
      const id = idByPath.get(candidate);
      if (id) return id;
      if (base === '') return null;
      const idx = base.lastIndexOf('/node_modules/');
      base = idx === -1 ? '' : base.slice(0, idx);
    }
  };
  for (const { path: p, raw } of entries) {
    const fromId = idByPath.get(p);
    if (!fromId) continue;
    const groups: Array<{ key: string; dev: boolean; optional: boolean; peer: boolean }> = [
      { key: 'dependencies', dev: false, optional: false, peer: false },
      { key: 'optionalDependencies', dev: false, optional: true, peer: false },
      { key: 'peerDependencies', dev: false, optional: false, peer: true },
    ];
    if (p === '') groups.push({ key: 'devDependencies', dev: true, optional: false, peer: false });
    const peerMeta = isRecord(raw.peerDependenciesMeta) ? raw.peerDependenciesMeta : {};
    for (const g of groups) {
      const map = isRecord(raw[g.key]) ? (raw[g.key] as Record<string, unknown>) : {};
      for (const dep of Object.keys(map).sort()) {
        const spec = asString(map[dep]) ?? '';
        const toId = resolveDep(p, dep);
        if (!toId) {
          const meta = isRecord(peerMeta[dep]) ? (peerMeta[dep] as Record<string, unknown>) : {};
          const optionalPeer = g.peer && meta.optional === true;
          unsupported.add(
            `unresolved ${optionalPeer ? 'optional peer' : g.optional ? 'optional' : g.peer ? 'peer' : 'dependency'} '${dep}' from ${p === '' ? '<root>' : p}: no node in the closure; edge omitted`,
          );
          continue;
        }
        const k = `${fromId}\0${toId}\0${spec}`;
        if (seenEdges.has(k)) continue;
        seenEdges.add(k);
        edges.push({ from: fromId, to: toId, spec, dev: g.dev, optional: g.optional, peer: g.peer });
      }
    }
  }

  return { nodes: [...byIdentity.values()], edges, unsupported: [...unsupported], rootName, rootVersion };
}

/* -------------------------------------------------------------------------- */
/* Dockerfile FROM + compose image:                                            */
/* -------------------------------------------------------------------------- */

export interface ParsedImageRef {
  name: string;
  tag: string | null;
  tagImplicit: boolean;
  digest: string | null;
}

/** `name[:tag][@sha256:hex]` — the tag separator is the last `:` after the last `/` (registry ports keep their `:`). */
export function parseImageRef(ref: string): ParsedImageRef {
  let rest = ref;
  let digest: string | null = null;
  const at = rest.indexOf('@');
  if (at !== -1) {
    digest = rest.slice(at + 1);
    rest = rest.slice(0, at);
  }
  const slash = rest.lastIndexOf('/');
  const colon = rest.lastIndexOf(':');
  let name = rest;
  let tag: string | null = null;
  if (colon > slash) {
    name = rest.slice(0, colon);
    tag = rest.slice(colon + 1);
  }
  const tagImplicit = tag === null && digest === null;
  if (tagImplicit) tag = 'latest';
  return { name, tag, tagImplicit, digest };
}

const VAR_REF = /\$\{?[A-Za-z_]/;

interface ImageScan {
  images: StackImage[];
  nodes: StackNode[];
  unsupported: string[];
}

function imageNode(img: StackImage): StackNode {
  const version = img.digest ?? img.tag ?? 'latest';
  return {
    id: stackNodeId('oci-image', img.name, version),
    kind: 'oci-image',
    name: img.name,
    version,
    integrity: img.digest,
    resolvedFrom: img.resolvedFrom,
    dev: false,
    optional: false,
    peer: false,
    platformConditional: null,
    root: false,
    installScript: false,
    layout: [],
  };
}

/** Parse every `FROM` of a Dockerfile (comments stripped, `\` continuations joined, stage aliases dropped). */
export function scanDockerfile(relPath: string, text: string): ImageScan {
  const out: ImageScan = { images: [], nodes: [], unsupported: [] };
  const rawLines = text.split(/\r?\n/);
  const aliases = new Set<string>();
  // join continuations, remembering the 1-based line each logical line started on
  const logical: Array<{ line: number; text: string }> = [];
  for (let i = 0; i < rawLines.length; i++) {
    let t = rawLines[i] ?? '';
    const start = i + 1;
    while (/\\\s*$/.test(t) && i + 1 < rawLines.length) {
      i++;
      t = `${t.replace(/\\\s*$/, ' ')}${rawLines[i] ?? ''}`;
    }
    logical.push({ line: start, text: t });
  }
  for (const { line, text: t } of logical) {
    if (/^\s*#/.test(t)) continue;
    const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(t);
    if (!m) continue;
    const ref = m[1] ?? '';
    const alias = m[2];
    if (VAR_REF.test(ref)) {
      out.unsupported.push(`Dockerfile ${relPath}:${line} FROM uses ARG substitution: unresolved base image`);
      if (alias) aliases.add(alias.toLowerCase());
      continue;
    }
    if (aliases.has(ref.toLowerCase()) || ref.toLowerCase() === 'scratch') {
      if (alias) aliases.add(alias.toLowerCase());
      continue;
    }
    const parsed = parseImageRef(ref);
    const img: StackImage = {
      ref,
      name: parsed.name,
      tag: parsed.tag,
      tagImplicit: parsed.tagImplicit,
      digest: parsed.digest,
      pin: parsed.digest !== null,
      resolved: false,
      resolvedFrom: 'dockerfile',
      evidenceRef: `${relPath}#L${line}`,
    };
    out.images.push(img);
    if (alias) aliases.add(alias.toLowerCase());
  }
  return out;
}

/** Line-anchored `image:` read of a compose file — no YAML parser, `${VAR}` refs are coverage lines. */
export function scanComposeFile(relPath: string, text: string): ImageScan {
  const out: ImageScan = { images: [], nodes: [], unsupported: [STACK_COVERAGE_COMPOSE_BUILD_ONLY] };
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s+image:\s*["']?([^"'\s#]+)/.exec(lines[i] ?? '');
    if (!m) continue;
    const ref = m[1] ?? '';
    if (VAR_REF.test(ref)) {
      out.unsupported.push(`compose ${relPath}:${i + 1} image uses variable interpolation: unresolved image ref`);
      continue;
    }
    const parsed = parseImageRef(ref);
    out.images.push({
      ref,
      name: parsed.name,
      tag: parsed.tag,
      tagImplicit: parsed.tagImplicit,
      digest: parsed.digest,
      pin: parsed.digest !== null,
      resolved: false,
      resolvedFrom: 'compose',
      evidenceRef: `${relPath}#L${i + 1}`,
    });
  }
  return out;
}

const IMAGE_FILE_EXCLUDE = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', 'venv']);
const MAX_IMAGE_FILE_DEPTH = 3;

function isDockerfileName(base: string): boolean {
  return /^Dockerfile(\..+)?$/.test(base) || /\.Dockerfile$/.test(base);
}
function isComposeName(base: string): boolean {
  return /^(docker-)?compose(\..+)?\.ya?ml$/.test(base);
}

/** Bounded, sorted walk for Dockerfiles + compose files (depth ≤ 3, build/dep dirs excluded). */
export function findImageFiles(root: string): { dockerfiles: string[]; composeFiles: string[] } {
  const dockerfiles: string[] = [];
  const composeFiles: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IMAGE_FILE_EXCLUDE.has(e.name) || depth >= MAX_IMAGE_FILE_DEPTH) continue;
        walk(path.join(dir, e.name), r, depth + 1);
      } else if (e.isFile()) {
        if (isDockerfileName(e.name)) dockerfiles.push(r);
        else if (isComposeName(e.name)) composeFiles.push(r);
      }
    }
  };
  walk(root, '', 0);
  return { dockerfiles: dockerfiles.sort(), composeFiles: composeFiles.sort() };
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function normalizeRuntime(raw: string): string {
  return raw.trim().replace(/^v/, '');
}

/* -------------------------------------------------------------------------- */
/* The extractor                                                               */
/* -------------------------------------------------------------------------- */

export class NpmLockfileStackExtractor implements StackFactsExtractor {
  readonly source = 'npm-lockfile' as const;

  extract(repoDir: string, revision: string): StackExtractionResult {
    const sources: StackSource[] = [];
    const nodes: StackNode[] = [];
    const edges: StackEdge[] = [];
    const images: StackImage[] = [];
    const unsupported = new Set<string>([STACK_COVERAGE_DECLARED_NOT_INSTALLED]);
    const refusals: string[] = [];
    let filesScanned = 0;

    // ---- package.json (root identity fallback + engines.node) ----
    let pkg: Record<string, unknown> | null = null;
    const pkgBytes = readIfPresent(repoDir, 'package.json');
    if (pkgBytes) {
      filesScanned++;
      sources.push({ path: 'package.json', sha256: sha256(pkgBytes), parser: 'package-json' });
      try {
        const parsed: unknown = JSON.parse(pkgBytes.toString('utf8'));
        pkg = isRecord(parsed) ? parsed : null;
      } catch (e) {
        unsupported.add(`package.json is not valid JSON: ${(e as Error).message}`);
      }
    }

    // ---- lockfile: npm-shrinkwrap.json > package-lock.json; pnpm/yarn refused ----
    let lockParsed = false;
    let rootName: string | null = null;
    let rootVersion: string | null = null;
    const lockCandidates = ['npm-shrinkwrap.json', 'package-lock.json'];
    for (const rel of lockCandidates) {
      const bytes = readIfPresent(repoDir, rel);
      if (!bytes) continue;
      if (lockParsed) {
        unsupported.add(`lockfile '${rel}' ignored: npm-shrinkwrap.json takes precedence`);
        continue;
      }
      filesScanned++;
      sources.push({ path: rel, sha256: sha256(bytes), parser: 'npm-lockfile-v3' });
      let lock: unknown;
      try {
        lock = JSON.parse(bytes.toString('utf8'));
      } catch (e) {
        const msg = `lockfile '${rel}' is not valid JSON: ${(e as Error).message}`;
        unsupported.add(msg);
        refusals.push(msg);
        continue;
      }
      if (!isRecord(lock)) {
        const msg = `lockfile '${rel}' is not a JSON object`;
        unsupported.add(msg);
        refusals.push(msg);
        continue;
      }
      if (lock.lockfileVersion !== 3) {
        const msg = stackRefusalLockfileVersion(lock.lockfileVersion);
        unsupported.add(msg);
        refusals.push(msg);
        continue;
      }
      const derived = deriveFromLockfileV3(lock);
      nodes.push(...derived.nodes);
      edges.push(...derived.edges);
      for (const u of derived.unsupported) unsupported.add(u);
      rootName = derived.rootName;
      rootVersion = derived.rootVersion;
      lockParsed = true;
    }
    if (readIfPresent(repoDir, 'pnpm-lock.yaml')) unsupported.add(STACK_REFUSAL_PNPM);
    if (readIfPresent(repoDir, 'yarn.lock')) unsupported.add(STACK_REFUSAL_YARN);

    if (!lockParsed) {
      // root-only manifest: identity from package.json when present; never a green stack
      const name = asString(pkg?.name) ?? 'root';
      const version = asString(pkg?.version) ?? '0.0.0';
      nodes.push({
        id: stackNodeId('npm', name, version),
        kind: 'npm',
        name,
        version,
        integrity: null,
        resolvedFrom: 'lockfile',
        dev: false,
        optional: false,
        peer: false,
        platformConditional: null,
        root: true,
        installScript: false,
        layout: [''],
      });
      unsupported.add(STACK_REFUSAL_NO_LOCKFILE);
      // the fixed strings first (verbatim, testable), the summary line last
      if (unsupported.has(STACK_REFUSAL_PNPM)) refusals.push(STACK_REFUSAL_PNPM);
      if (unsupported.has(STACK_REFUSAL_YARN)) refusals.push(STACK_REFUSAL_YARN);
      refusals.push(STACK_REFUSAL_NO_LOCKFILE);
    }
    void rootName;
    void rootVersion;

    // ---- runtime: .nvmrc > .node-version > package.json engines.node ----
    let runtime: StackRuntime = { node: { declared: null, resolvedFrom: null, pin: false } };
    const nvmrc = readIfPresent(repoDir, '.nvmrc');
    const nodeVersionFile = readIfPresent(repoDir, '.node-version');
    if (nvmrc) {
      filesScanned++;
      sources.push({ path: '.nvmrc', sha256: sha256(nvmrc), parser: 'nvmrc' });
    }
    if (nodeVersionFile) {
      filesScanned++;
      sources.push({ path: '.node-version', sha256: sha256(nodeVersionFile), parser: 'node-version' });
    }
    const declaredFrom: Array<{ from: 'nvmrc' | 'node-version' | 'engines'; value: string | null }> = [
      { from: 'nvmrc', value: nvmrc ? normalizeRuntime(nvmrc.toString('utf8')) : null },
      { from: 'node-version', value: nodeVersionFile ? normalizeRuntime(nodeVersionFile.toString('utf8')) : null },
      { from: 'engines', value: isRecord(pkg?.engines) ? asString((pkg!.engines as Record<string, unknown>).node) : null },
    ];
    const first = declaredFrom.find((d) => d.value !== null && d.value !== '');
    if (first && first.value) {
      runtime = { node: { declared: first.value, resolvedFrom: first.from, pin: EXACT_VERSION.test(first.value) } };
      nodes.push({
        id: stackNodeId('node-runtime', 'node', first.value),
        kind: 'node-runtime',
        name: 'node',
        version: first.value,
        integrity: null,
        resolvedFrom: first.from,
        dev: false,
        optional: false,
        peer: false,
        platformConditional: null,
        root: false,
        installScript: false,
        layout: [],
      });
    } else {
      unsupported.add('no node runtime declaration (.nvmrc / .node-version / engines.node): runtime unknown');
    }

    // ---- images: Dockerfile FROM + compose image: ----
    const { dockerfiles, composeFiles } = findImageFiles(repoDir);
    const imageNodeIds = new Set<string>();
    const addScan = (scan: ImageScan): void => {
      for (const u of scan.unsupported) unsupported.add(u);
      for (const img of scan.images) {
        images.push(img);
        const n = imageNode(img);
        if (!imageNodeIds.has(n.id)) {
          imageNodeIds.add(n.id);
          nodes.push(n);
        }
      }
    };
    for (const rel of dockerfiles) {
      const bytes = readIfPresent(repoDir, rel);
      if (!bytes) continue;
      filesScanned++;
      sources.push({ path: rel, sha256: sha256(bytes), parser: 'dockerfile' });
      addScan(scanDockerfile(rel, bytes.toString('utf8')));
    }
    for (const rel of composeFiles) {
      const bytes = readIfPresent(repoDir, rel);
      if (!bytes) continue;
      filesScanned++;
      sources.push({ path: rel, sha256: sha256(bytes), parser: 'compose' });
      addScan(scanComposeFile(rel, bytes.toString('utf8')));
    }
    if (dockerfiles.length === 0 && composeFiles.length === 0) unsupported.add(STACK_COVERAGE_NO_IMAGES);

    const body: StackManifestBody = {
      schemaVersion: '1',
      kind: 'StackManifest',
      ctRepoRevision: revision,
      sources,
      nodes,
      edges,
      runtime,
      images,
      coverage: { unsupported: [...unsupported], filesScanned },
    };
    return { manifest: finalizeStackManifest(body), refusals };
  }
}

/** The stack provider table — one row per lockfile family (widen-only; pnpm/yarn are follow-ons). */
export const STACK_EXTRACTOR_PROVIDERS: readonly { source: StackFactsExtractor['source']; fileKinds: readonly string[]; make(): StackFactsExtractor }[] =
  Object.freeze([
    {
      source: 'npm-lockfile',
      fileKinds: ['npm-shrinkwrap.json', 'package-lock.json', 'package.json', '.nvmrc', '.node-version', 'Dockerfile', 'compose.yml'],
      make: () => new NpmLockfileStackExtractor(),
    },
  ]);

/** Front door: extract the stack manifest of a materialized tree. LOUD on an unregistered source. */
export function extractStackManifest(repoDir: string, revision: string, source: StackFactsExtractor['source'] = 'npm-lockfile'): StackExtractionResult {
  const provider = STACK_EXTRACTOR_PROVIDERS.find((p) => p.source === source);
  if (!provider) {
    throw new Error(`no stack extractor provider registered for source '${source}' — STACK_EXTRACTOR_PROVIDERS (stack-extractor.ts) is widen-only`);
  }
  return provider.make().extract(repoDir, revision);
}
