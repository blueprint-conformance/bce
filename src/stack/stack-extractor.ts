/**
 * The stack-facts extractor (slice 1): reads a materialized repository tree and produces a
 * `StackManifest` — the DECLARED dependency closure, never the installed one.
 *
 * Inputs (all read from the tree, nothing else):
 *   - `npm-shrinkwrap.json` (preferred) or `package-lock.json`, lockfileVersion 3 ONLY;
 *   - `pnpm-lock.yaml`, lockfileVersion '9.0' ONLY, through the hand-rolled subset reader in
 *     `pnpm-lock-reader.ts` (a second SOURCE of the same node shape). It is the declared closure
 *     when `package.json` `packageManager` names pnpm, or when no npm lockfile is present;
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
import { stableStringify } from '../report.js';
import {
  finalizeStackManifest,
  stackNodeId,
  type StackEdge,
  type StackImage,
  type StackManifest,
  type StackManifestBody,
  type StackNode,
  type StackRuntime,
  type StackRootDeclared,
  type StackSource,
  type StackUnmodeled,
} from './stack-manifest.js';
import {
  isPnpmWorkspaceDir,
  pnpmWorkspaceGlobMayMatchBelow,
  readPnpmLock,
  readPnpmWorkspacePatterns,
  stackRefusalPnpmLostClosure,
  type PnpmDerived,
  type PnpmWorkspacePatterns,
} from './pnpm-lock-reader.js';

/* -------------------------------------------------------------------------- */
/* Fixed refusal / coverage strings (verbatim contract — tests pin these)       */
/* -------------------------------------------------------------------------- */

export const STACK_REFUSAL_YARN =
  "lockfile 'yarn.lock' present but not supported in stack slice 1 (classic and berry): owned-by-follow-on; no stack facts extracted";
export const STACK_REFUSAL_NO_LOCKFILE = 'no supported lockfile: declared closure unknown';
export const STACK_COVERAGE_DECLARED_NOT_INSTALLED = 'declared closure, not installed tree: node_modules is never read';
export const STACK_COVERAGE_NO_IMAGES = 'no Dockerfile or compose file found: images[] is empty by absence, not by proof';
export const STACK_COVERAGE_COMPOSE_BUILD_ONLY =
  'compose: build:-only services are not enumerated (line-anchored image: read, no YAML parser)';

export const STACK_COVERAGE_IMAGE_WALK_DEPTH =
  'image files are searched to directory depth 3 only (node_modules/.git/dist/build/coverage/venv excluded): deeper Dockerfiles or compose files are not read';

/** A named stack source that is a symlink (or resolves outside the tree) is refused — never followed. */
export function stackRefusalSymlink(rel: string): string {
  return `stack source '${rel}' is a symbolic link or resolves outside the tree: refused (a stack source must be a regular file inside the materialized tree)`;
}
/** A v3 lockfile with no usable `packages` map. */
export function stackRefusalHollowLockfile(rel: string, why: string): string {
  return `lockfile '${rel}' is hollow (${why}): a closure with no node and no unmodeled entry beyond the root is never a green stack; no stack facts extracted`;
}
/** A lockfile entry that is not an object or carries a non-string version. */
export function stackRefusalMalformedEntry(rel: string, key: string): string {
  return `lockfile '${rel}' entry '${key}' is malformed (not an object, or no string version): refused, never a partial manifest`;
}
/** A dependency map with an EMPTY name: no package can carry it — a refusal, never a schema crash. */
export function stackRefusalEmptyDependencyName(rel: string, key: string): string {
  return `lockfile '${rel}' entry '${key}' declares a dependency with an empty name: refused, never a partial manifest`;
}
/**
 * A symbolic link met by the image-file walk that is not itself named like an image file. It is
 * NEVER followed and its target is never stat-ed or listed: what it points at is host state, not
 * part of the revision, so this line is a pure function of the tree.
 */
export function stackCoverageSymlinkNotFollowed(rel: string): string {
  return `symlink '${rel}' is not followed: nothing under it is read for image files`;
}
/** A directory below the root that is its OWN git checkout (a worktree, a clone, a submodule): another repository's closure. */
export function stackCoverageNestedCheckout(rel: string): string {
  return `nested git checkout '${rel}' is not walked for image files: it is another repository's tree, not part of this one`;
}
/** A lockfile that lost the precedence decision — recorded, never silently skipped. */
export function stackCoverageLockfileIgnored(ignored: string, reason: string): string {
  return `lockfile '${ignored}' ignored: ${reason}`;
}

/**
 * `package.json` `packageManager` names one manager but the lockfile that was READ belongs to another
 * family (the declared manager's own lockfile is absent or unsupported). Recorded, never a refusal:
 * the lockfile that exists is still the only declared closure in the tree.
 */
export function stackCoveragePackageManagerMismatch(declared: string, readRel: string): string {
  return `package.json packageManager declares ${declared} but the lockfile read is '${readRel}': the declared manager's own lockfile is absent or unsupported, so this closure may not be the one that manager would install`;
}

/** `lockfileVersion <n> is not 3: …` — npm v1/v2 lockfiles are refused, their tree is not a closure map. */
export function stackRefusalLockfileVersion(version: unknown): string {
  return `lockfileVersion ${typeof version === 'number' ? String(version) : JSON.stringify(version) ?? 'undefined'} is not 3: npm v1/v2 lockfiles are refused (their 'dependencies' tree is not a closure map); regenerate with npm >= 7`;
}

/**
 * What the CALLER knows about the tree from git (this module never runs git). With it, the
 * nested-checkout decision is a property of the REVISION and identical for a pinned tree and a
 * working tree; without it, the walk falls back to the `.git` marker alone (host state).
 */
export interface StackTreeKnowledge {
  /** every path git tracks at this revision (blob and symlink entries), relative, `/`-separated */
  tracked: ReadonlySet<string>;
  /** every gitlink (submodule) entry at this revision — a directory that is another repository's tree */
  gitlinks: readonly string[];
  /**
   * absolute directory the tree lives at for whoever ran pnpm (the checkout `--ct-repo` names, never a
   * materialization): the anchor `link:`-protocol values are re-relativised from. Absent: the tree's
   * own directory is the anchor (an unpinned read of a non-repository).
   */
  linkAnchor?: string;
}

export interface StackFactsExtractor {
  readonly source: 'npm-lockfile';
  extract(repoDir: string, revision: string, knowledge?: StackTreeKnowledge): StackExtractionResult;
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

/** Thrown by `readSource` for a symlinked / tree-escaping source — the extractor turns it into a refusal. */
export class StackSourceEscapeError extends Error {
  constructor(readonly rel: string) {
    super(stackRefusalSymlink(rel));
  }
}

/**
 * Read a named stack source. NEVER follows a symbolic link: `lstat` first, and the real path of
 * the file must stay inside the real path of the tree (a symlinked parent directory escapes too).
 * Absent ⇒ null; a symlink / escape ⇒ StackSourceEscapeError (a refusal, never a silent read of a
 * host file that is not in the revision).
 */
function readSource(root: string, rel: string): Buffer | null {
  const abs = path.join(root, rel);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) throw new StackSourceEscapeError(rel);
  if (!st.isFile()) return null;
  const realRoot = fs.realpathSync(root);
  const real = fs.realpathSync(abs);
  if (real !== path.join(realRoot, rel) && !real.startsWith(`${realRoot}${path.sep}`)) throw new StackSourceEscapeError(rel);
  return fs.readFileSync(abs);
}

/**
 * `readSource` for a path BELOW the root: no directory on the way may be a symbolic link either
 * (lstat only — the link is never followed), so an importer's `package.json` is read from this tree
 * or not at all. A path that leaves the tree (`..`, absolute, a backslash) is an escape.
 */
function readNestedSource(root: string, rel: string): Buffer | null {
  const segs = rel.split('/');
  if (rel.startsWith('/') || rel.includes('\\') || segs.some((sg) => sg === '' || sg === '..')) throw new StackSourceEscapeError(rel);
  let dir = root;
  for (const sg of segs.slice(0, -1)) {
    if (sg === '.') continue;
    dir = path.join(dir, sg);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(dir);
    } catch {
      return null;
    }
    if (st.isSymbolicLink()) throw new StackSourceEscapeError(rel);
    if (!st.isDirectory()) return null;
  }
  return readSource(root, rel);
}

const PACKAGE_JSON_DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;
/** directories pnpm never takes workspace packages from, plus the repository's own metadata */
const WORKSPACE_WALK_EXCLUDE = new Set(['node_modules', 'bower_components', '.git']);

/**
 * Every directory below the root (never the root itself) that holds a regular-file `package.json`,
 * down to `maxDepth`. Symbolic links are never followed. This walk serves GUARD (d) ONLY and, unlike
 * the image walk, it does NOT stop at another repository's tree: pnpm takes a workspace package from a
 * nested clone or a checked-out submodule exactly as from any directory (it never looks at `.git`), so a
 * `package.json` found there is one the lockfile must name. (A gitlink whose contents are ABSENT from
 * the view is `checkPnpmLockCoversTree`'s concern, from the revision, not this walk's.)
 */
export function findPackageJsonDirs(root: string, maxDepth: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (depth > 0 && entries.some((e) => e.name === 'package.json' && e.isFile())) out.push(rel);
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || WORKSPACE_WALK_EXCLUDE.has(e.name)) continue;
      walk(path.join(dir, e.name), rel ? `${rel}/${e.name}` : e.name, depth + 1);
    }
  };
  walk(root, '', 0);
  return out.sort();
}

/**
 * TRUNCATION GUARDS (c) + (d). A pnpm lockfile cut at an importer boundary is byte-identical to a
 * smaller legitimate lockfile, so the lockfile alone cannot tell — the tree can:
 *   (c) every dependency an importer's own `package.json` declares (dependencies, devDependencies,
 *       optionalDependencies) is recorded in that importer's entry; an importer whose `package.json`
 *       is missing or unreadable cannot be checked, which is a refusal, never a skip;
 *   (d) every directory `pnpm-workspace.yaml` names as a package, holding a `package.json`, is an importer.
 * Both read the SAME view as everything else here (`read` is the extractor's symlink-safe reader).
 * Returns the reasons (already sorted); empty = the lockfile covers this tree.
 */
export function checkPnpmLockCoversTree(
  repoDir: string,
  derived: Pick<PnpmDerived, 'importers' | 'excludeLinksFromLockfile'>,
  read: (rel: string) => Buffer | null,
  knowledge?: StackTreeKnowledge,
): string[] {
  const lost: string[] = [];
  const importerPaths = new Set(derived.importers.map((i) => i.path));
  for (const imp of derived.importers) {
    const rel = imp.path === '.' ? 'package.json' : `${imp.path}/package.json`;
    let bytes: Buffer | null;
    try {
      bytes = imp.path === '.' ? read(rel) : readNestedSource(repoDir, rel);
    } catch (e) {
      if (!(e instanceof StackSourceEscapeError)) throw e;
      lost.push(`importer '${imp.path}': '${rel}' is a symbolic link or leaves the tree, so what it declares cannot be checked`);
      continue;
    }
    if (bytes === null) {
      lost.push(`importer '${imp.path}' has no '${rel}' in this tree, so what it declares cannot be checked`);
      continue;
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(bytes.toString('utf8'));
    } catch {
      manifest = undefined;
    }
    if (!isRecord(manifest) || PACKAGE_JSON_DEP_FIELDS.some((f) => manifest[f] !== undefined && !isRecord(manifest[f]))) {
      lost.push(`importer '${imp.path}': '${rel}' is not a readable package manifest, so what it declares cannot be checked`);
      continue;
    }
    // a workspace link onto the importer ITSELF is real only when the name is the importer's own package name
    const ownName = typeof manifest['name'] === 'string' ? (manifest['name'] as string) : null;
    for (const name of imp.selfLinks) {
      if (name !== ownName) lost.push(`importer '${imp.path}': dependency '${name}' links to the importer itself, whose '${rel}' is named ${ownName === null ? 'nothing' : `'${ownName}'`} — the lockfile is cut short`);
    }
    const recorded = new Set(imp.names);
    for (const field of PACKAGE_JSON_DEP_FIELDS) {
      const deps = manifest[field];
      if (!isRecord(deps)) continue;
      for (const name of Object.keys(deps).sort()) {
        if (recorded.has(name)) continue;
        // measured on pnpm 10.11.1: with settings.excludeLinksFromLockfile a `link:`-protocol
        // dependency is left out of the importer entry by pnpm itself
        if (derived.excludeLinksFromLockfile && typeof deps[name] === 'string' && (deps[name] as string).startsWith('link:')) continue;
        lost.push(`importer '${imp.path}': '${rel}' declares ${field} '${name}' but the lockfile's importer entry does not record it`);
      }
    }
  }
  const wsBytes = read('pnpm-workspace.yaml');
  if (wsBytes === null) {
    // pnpm writes importers other than '.' only for a workspace, and a workspace IS its pnpm-workspace.yaml:
    // without the file guard (d) cannot be evaluated, and a guard that cannot be evaluated refuses
    if (derived.importers.some((i) => i.path !== '.')) lost.push("the lockfile has workspace importers but this tree has no readable 'pnpm-workspace.yaml', so the workspace packages cannot be checked");
  } else {
    let patterns: PnpmWorkspacePatterns | string = readPnpmWorkspacePatterns(wsBytes.toString('utf8'));
    if (typeof patterns !== 'string' && !patterns.hasPackagesKey) {
      // No `packages:` key. Which directories pnpm took is decided by the manager `package.json` declares —
      // NEVER by the lockfile's own importer list (that list is exactly what a cut removes). MEASURED
      // 2026-09-20 (implementer AND refuter, independently): pnpm 10.11.1 takes the root alone; pnpm 8.15.9,
      // 9.0.0 and 9.15.4 refuse to run at all (`ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION packages field
      // missing or empty`) and write nothing. So a lockfile beside such a file was written by pnpm >= 10 and
      // names the root alone — declared or not (only pnpm 10+ CAN have written it) — while a declared pnpm
      // before 10 contradicts its own lockfile: an inconsistent tree, refused (pass 4 of #93: the earlier
      // "every directory" reading for the undeclared arm refused legitimate real pnpm 10 trees).
      const declared = /^pnpm@(\d+)/.exec(readRootPackageManager(read))?.[1];
      if (declared !== undefined && Number(declared) < 10) {
        patterns = `package.json declares pnpm@${declared} but pnpm-workspace.yaml has no 'packages' key: pnpm before 10 refuses to run beside such a file and cannot have written this lockfile — an inconsistent tree, so the workspace packages cannot be checked`;
      }
    }
    if (typeof patterns === 'string') {
      lost.push(patterns);
    } else {
      if (!importerPaths.has('.') && read('package.json') !== null) lost.push("pnpm-workspace.yaml: the root package is always a workspace package but the lockfile has no importer '.'");
      for (const dir of findPackageJsonDirs(repoDir, patterns.maxDepth)) {
        if (isPnpmWorkspaceDir(patterns, dir) && !importerPaths.has(dir)) lost.push(`pnpm-workspace.yaml names package '${dir}' but the lockfile has no importer for it`);
      }
      // a gitlink (submodule entry) the revision declares under a workspace glob, whose contents this view
      // does not hold (a pinned tree never holds a submodule's tree): the guard cannot be evaluated
      for (const g of knowledge?.gitlinks ?? []) {
        if (g.split('/').some((seg) => WORKSPACE_WALK_EXCLUDE.has(seg))) continue;
        let present = false;
        try {
          present = readNestedSource(repoDir, `${g}/package.json`) !== null || fs.readdirSync(path.join(repoDir, g)).length > 0;
        } catch {
          present = false;
        }
        if (present) continue; // its contents are in this view: the walk above already judged them
        if (isPnpmWorkspaceDir(patterns, g) || pnpmWorkspaceGlobMayMatchBelow(patterns, g)) {
          lost.push(`pnpm-workspace.yaml may name a package under the submodule '${g}', whose contents are not in this view, so the workspace packages cannot be checked`);
        }
      }
    }
  }
  return lost.sort();
}

/** `packageManager` of the root `package.json` as declared, `''` when there is none or it is unreadable. */
function readRootPackageManager(read: (rel: string) => Buffer | null): string {
  try {
    const raw: unknown = JSON.parse((read('package.json') ?? Buffer.from('null')).toString('utf8'));
    return isRecord(raw) && typeof raw['packageManager'] === 'string' ? (raw['packageManager'] as string) : '';
  } catch {
    return '';
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

export interface ParsedLockfile {
  nodes: StackNode[];
  edges: StackEdge[];
  unmodeled: StackUnmodeled[];
  /** the ranges the root package declares — manifest-only, never hashed */
  rootDeclared: StackRootDeclared[];
  unsupported: string[];
  /** lockfile keys whose entry is not an object / has no string version — a REFUSAL, never a skip */
  malformed: string[];
  /** entry keys ('<root>' for the root) that declare a dependency whose NAME is the empty string */
  emptyDependencyNames: string[];
  /** why the lockfile is hollow (no `packages` record, no root entry, nothing beyond the root), else null */
  hollow: string | null;
}

function opaque(key: string, reason: StackUnmodeled['reason'], raw: Record<string, unknown>): StackUnmodeled {
  return {
    kind: 'unsupported',
    key,
    reason,
    spec: {
      name: asString(raw.name),
      version: asString(raw.version),
      resolved: asString(raw.resolved),
      integrity: asString(raw.integrity),
      link: raw.link === true,
    },
    entrySha256: sha256(Buffer.from(stableStringify(raw))),
  };
}

function mergeStringSets(a: string[], b: string[] | null): string[] {
  return [...new Set([...a, ...(b ?? [])])].sort();
}

/**
 * Derive nodes + edges + opaque entries from a lockfileVersion-3 `packages` map. Pure over the
 * parsed JSON. Exported for tests.
 *
 * Identity is (kind, name, version, integrity). Several lockfile paths may hold ONE identity with
 * DIFFERENT flags (hoisting places a copy under a dev parent and another under a prod parent), so
 * flags are MERGED across every copy with npm's own semantics — dev / optional / peer /
 * devOptional are true only when EVERY copy carries them, installScript when ANY does — never
 * first-path-wins: the digest must not depend on which path sorts first.
 */
export function deriveFromLockfileV3(lock: Record<string, unknown>): ParsedLockfile {
  const unsupported = new Set<string>();
  const malformed: string[] = [];
  const emptyDependencyNames: string[] = [];
  const unmodeled: StackUnmodeled[] = [];
  const rootDeclared: StackRootDeclared[] = [];
  if (!isRecord(lock.packages)) {
    return { nodes: [], edges: [], unmodeled, rootDeclared: [], unsupported: [], malformed, emptyDependencyNames: [], hollow: "no 'packages' map" };
  }
  const packages = lock.packages;
  const keys = Object.keys(packages).sort();
  if (!keys.includes('')) {
    return { nodes: [], edges: [], unmodeled, rootDeclared: [], unsupported: [], malformed, emptyDependencyNames: [], hollow: "no root '' entry in 'packages'" };
  }
  if (keys.length === 1) {
    return { nodes: [], edges: [], unmodeled, rootDeclared: [], unsupported: [], malformed, emptyDependencyNames: [], hollow: 'no package beyond the root' };
  }
  const entries: LockEntry[] = [];
  for (const k of keys) {
    const raw = packages[k];
    if (!isRecord(raw)) {
      malformed.push(k === '' ? '<root>' : k);
      continue;
    }
    entries.push({ path: k, raw });
  }

  // identity → node (flags merged across copies); path → node id (for edge resolution)
  const byIdentity = new Map<string, StackNode>();
  const idByPath = new Map<string, string>();
  const idsTaken = new Map<string, string>(); // id → identity key (collision detection)

  for (const { path: p, raw } of entries) {
    const version = asString(raw.version);
    const resolved = asString(raw.resolved) ?? '';
    const declaredName = asString(raw.name);
    if (p === '') {
      const rootName = declaredName ?? asString(lock.name);
      const rootVersion = version ?? asString(lock.version);
      if (!rootName || !rootVersion) unsupported.add('root package has no name/version in the lockfile: identity defaulted');
      const name = rootName ?? 'root';
      const ver = rootVersion ?? '0.0.0';
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
        devOptional: false,
        platformConditional: null,
        root: true,
        installScript: raw.hasInstallScript === true,
        resolvedWhenUnpinned: null,
        layout: [''],
      };
      byIdentity.set('root', node);
      for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
        const map = isRecord(raw[group]) ? (raw[group] as Record<string, unknown>) : {};
        for (const dep of Object.keys(map).sort()) {
          if (dep === '') continue; // an empty name is refused whole (below) — it must never reach the strict schema
          rootDeclared.push({ name: dep, spec: asString(map[dep]) ?? '', group });
        }
      }
      // the root id is NOT reserved: a non-root node must never get a suffix that depends on the
      // root's (quarantined) version — a collision re-ids the ROOT instead, after the loop.
      idByPath.set('', node.id);
      continue;
    }
    const pathName = npmNameFromLockPath(p);
    // ---- entries slice 1 cannot fully model: HASHED as opaque nodes + a fixed coverage line ----
    if (!pathName) {
      unmodeled.push(opaque(p, 'not-under-node-modules', raw));
      unsupported.add(`workspace/link entry ${p}: local package not part of the declared closure in slice 1`);
      continue;
    }
    if (raw.link === true) {
      unmodeled.push(opaque(p, 'link', raw));
      unsupported.add(`workspace/link entry ${p}: local package not part of the declared closure in slice 1`);
      continue;
    }
    if (/^(file:|git\+|git:|github:|gitlab:|bitbucket:)/.test(resolved) || /^(file:|git\+|git:|github:)/.test(version ?? '')) {
      unmodeled.push(opaque(p, 'local-or-git', raw));
      unsupported.add(`workspace/link entry ${p}: local package not part of the declared closure in slice 1`);
      continue;
    }
    if (declaredName !== null && declaredName !== pathName) {
      unmodeled.push(opaque(p, 'npm-alias', raw));
      unsupported.add(`npm: alias at ${p} — alias resolution owned-by-follow-on`);
      continue;
    }
    if (!ASCII.test(pathName)) {
      unmodeled.push(opaque(p, 'non-ascii-name', raw));
      unsupported.add(`non-ASCII package name at ${p}: not modeled (npm registry names are ASCII)`);
      continue;
    }
    if (version === null || version === '') {
      malformed.push(p);
      continue;
    }
    const integrity = asString(raw.integrity);
    if (integrity === null) unsupported.add(`lockfile entry ${p} has no integrity: its 'resolved' is hashed instead`);
    const os = asStringArray(raw.os);
    const cpu = asStringArray(raw.cpu);
    const resolvedWhenUnpinned = integrity === null ? asString(raw.resolved) : null;
    // null and "" integrity are DIFFERENT identities (JSON.stringify keeps them apart)
    const identityKey = `npm\0${pathName}\0${version}\0${JSON.stringify(integrity)}\0${JSON.stringify(resolvedWhenUnpinned)}`;
    const copy = {
      dev: raw.dev === true,
      optional: raw.optional === true,
      peer: raw.peer === true,
      devOptional: raw.devOptional === true,
      installScript: raw.hasInstallScript === true,
    };
    let node = byIdentity.get(identityKey);
    if (!node) {
      let id = stackNodeId('npm', pathName, version);
      const taken = idsTaken.get(id);
      if (taken !== undefined && taken !== identityKey) {
        // the bare id is already another identity — disambiguate from the FULL identity key
        id = `${id}+${sha256(Buffer.from(identityKey)).slice(0, 12)}`;
        unsupported.add(`id collision on ${stackNodeId('npm', pathName, version)} (a distinct identity at ${p}): id suffixed`);
      }
      node = {
        id,
        kind: 'npm',
        name: pathName,
        version,
        integrity,
        resolvedFrom: 'lockfile',
        ...copy,
        platformConditional: os || cpu ? { os: os ?? [], cpu: cpu ?? [] } : null,
        root: false,
        resolvedWhenUnpinned,
        layout: [],
      };
      byIdentity.set(identityKey, node);
      idsTaken.set(id, identityKey);
    } else {
      node.dev = node.dev && copy.dev;
      node.optional = node.optional && copy.optional;
      node.peer = node.peer && copy.peer;
      node.devOptional = node.devOptional && copy.devOptional;
      node.installScript = node.installScript || copy.installScript;
      if (os || cpu) {
        node.platformConditional = {
          os: mergeStringSets(node.platformConditional?.os ?? [], os),
          cpu: mergeStringSets(node.platformConditional?.cpu ?? [], cpu),
        };
      }
    }
    node.layout.push(p);
    idByPath.set(p, node.id);
  }

  const rootNode = byIdentity.get('root');
  if (rootNode && idsTaken.has(rootNode.id)) {
    // a non-root package shares the root's name@version: the ROOT's display id yields (its hashed
    // id is `root:<name>` regardless), so the twin's hashed identity never depends on the root version
    unsupported.add(`id collision on ${rootNode.id} (a non-root package shares the root's name and version): root id suffixed`);
    // loop until FREE: `+root` is valid semver build metadata, so another package may already own it
    const base = rootNode.id;
    let candidate = `${base}+root`;
    for (let n = 2; idsTaken.has(candidate); n++) candidate = `${base}+root.${n}`;
    rootNode.id = candidate;
    idByPath.set('', rootNode.id);
  }

  // a dependency map with an EMPTY name names no package: refuse the lockfile, never crash a schema on it
  for (const { path: p, raw } of entries) {
    for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (isRecord(raw[key]) && Object.prototype.hasOwnProperty.call(raw[key], '')) {
        emptyDependencyNames.push(p === '' ? '<root>' : p);
        break;
      }
    }
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
        if (dep === '') continue; // refused below — never an edge, never a coverage guess
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

  return { nodes: [...byIdentity.values()], edges, unmodeled, rootDeclared, unsupported: [...unsupported], malformed, emptyDependencyNames, hollow: null };
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
    devOptional: false,
    platformConditional: null,
    root: false,
    installScript: false,
    resolvedWhenUnpinned: null,
    layout: [],
  };
}

const OCI_DIGEST = /^sha256:[0-9a-f]{64}$/;

function toImage(ref: string, resolvedFrom: 'dockerfile' | 'compose', evidenceRef: string, unsupported: string[]): StackImage {
  const parsed = parseImageRef(ref);
  const wellFormed = parsed.digest !== null && OCI_DIGEST.test(parsed.digest);
  if (parsed.digest !== null && !wellFormed) {
    unsupported.push(`image ref '${ref}' at ${evidenceRef} carries a malformed digest (expected sha256:<64 hex>): pin:false`);
  }
  return {
    ref,
    name: parsed.name,
    tag: parsed.tag,
    tagImplicit: parsed.tagImplicit,
    digest: parsed.digest,
    pin: wellFormed,
    resolved: false,
    resolvedFrom,
    evidenceRef,
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
    out.images.push(toImage(ref, 'dockerfile', `${relPath}#L${line}`, out.unsupported));
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
    out.images.push(toImage(ref, 'compose', `${relPath}#L${i + 1}`, out.unsupported));
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
export function findImageFiles(root: string, knowledge?: StackTreeKnowledge): {
  dockerfiles: string[];
  composeFiles: string[];
  /** symlinks NAMED like an image file — a refusal */
  symlinks: string[];
  /** every other symlink met by the walk — a coverage line; never followed, its target never stat-ed */
  symlinksNotFollowed: string[];
  /** directories below the root that are their own git checkout — a coverage line, not walked */
  nestedCheckouts: string[];
  depthCut: boolean;
} {
  const dockerfiles: string[] = [];
  const composeFiles: string[] = [];
  const symlinks: string[] = [];
  const symlinksNotFollowed: string[] = [];
  const nestedCheckouts: string[] = [];
  let depthCut = false;
  const trackedUnder = (rel: string): boolean => {
    if (!knowledge) return false;
    const prefix = `${rel}/`;
    for (const t of knowledge.tracked) if (t.startsWith(prefix)) return true;
    return false;
  };
  const gitlinkSet = new Set(knowledge?.gitlinks ?? []);
  // A gitlink names another repository's tree whether or not it is present on disk (a pinned tree
  // from `git archive` has no submodule contents at all): declare it from the revision, not the walk
  for (const rel of gitlinkSet) {
    const segs = rel.split('/');
    if (segs.length <= MAX_IMAGE_FILE_DEPTH && !segs.some((sg) => IMAGE_FILE_EXCLUDE.has(sg))) nestedCheckouts.push(rel);
  }
  const walk = (dir: string, rel: string, depth: number): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    // a directory below the root carrying its own `.git` (dir or gitlink file) is ANOTHER repository's
    // tree — a worktree, a clone, a submodule. A pinned tree (git archive) never contains one; an
    // unpinned working tree must not count its images into this repository's closure. When the caller
    // knows what git tracks, the marker alone decides NOTHING that the pinned view would not also see:
    // a gitlink is skipped in both views, and a stray `.git` beside files this repository tracks is
    // ignored (those files ARE this repository's tree). Without that knowledge the marker decides.
    if (depth > 0) {
      const marker = entries.some((e) => e.name === '.git');
      const nested = gitlinkSet.has(rel) || (marker && (knowledge ? !trackedUnder(rel) : true));
      if (nested) {
        if (!gitlinkSet.has(rel)) nestedCheckouts.push(rel);
        return;
      }
    }
    for (const e of [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (IMAGE_FILE_EXCLUDE.has(e.name)) continue;
        if (depth >= MAX_IMAGE_FILE_DEPTH) {
          depthCut = true;
          continue;
        }
        walk(path.join(dir, e.name), r, depth + 1);
      } else if (e.isSymbolicLink()) {
        // LSTAT ONLY — the link is never followed and its TARGET is never stat-ed or listed: what it
        // points at is host state outside the revision, so neither the exit code nor coverage may
        // depend on it. A symlink NAMED like an image file is a refusal; every other symlink (to a
        // file, a directory, or nothing at all) is one coverage line — a pure function of the tree.
        if (isDockerfileName(e.name) || isComposeName(e.name)) symlinks.push(r);
        else if (!IMAGE_FILE_EXCLUDE.has(e.name)) symlinksNotFollowed.push(r);
      } else if (e.isFile()) {
        if (isDockerfileName(e.name)) dockerfiles.push(r);
        else if (isComposeName(e.name)) composeFiles.push(r);
      }
    }
  };
  walk(root, '', 0);
  return {
    dockerfiles: dockerfiles.sort(),
    composeFiles: composeFiles.sort(),
    symlinks: symlinks.sort(),
    symlinksNotFollowed: symlinksNotFollowed.sort(),
    nestedCheckouts: nestedCheckouts.sort(),
    depthCut,
  };
}

/* -------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* -------------------------------------------------------------------------- */

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/** First non-blank, non-comment line, `v` prefix stripped. A multi-line file never reaches a node id. */
function normalizeRuntime(raw: string): string {
  const line = raw.split(/\r?\n/).map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#')) ?? '';
  return line.replace(/^v(?=\d)/, '');
}

/* -------------------------------------------------------------------------- */
/* The extractor                                                               */
/* -------------------------------------------------------------------------- */

export class NpmLockfileStackExtractor implements StackFactsExtractor {
  readonly source = 'npm-lockfile' as const;

  extract(repoDir: string, revision: string, knowledge?: StackTreeKnowledge): StackExtractionResult {
    const sources: StackSource[] = [];
    const nodes: StackNode[] = [];
    const edges: StackEdge[] = [];
    const images: StackImage[] = [];
    const unmodeled: StackUnmodeled[] = [];
    const rootDeclared: StackRootDeclared[] = [];
    const unsupported = new Set<string>([STACK_COVERAGE_DECLARED_NOT_INSTALLED]);
    const refusals: string[] = [];
    let filesScanned = 0;
    const refuse = (msg: string): void => {
      unsupported.add(msg);
      if (!refusals.includes(msg)) refusals.push(msg);
    };
    /** symlink-safe read: a symlinked / tree-escaping source is a refusal, reported as absent */
    const read = (rel: string): Buffer | null => {
      try {
        return readSource(repoDir, rel);
      } catch (e) {
        if (e instanceof StackSourceEscapeError) {
          refuse(e.message);
          return null;
        }
        throw e;
      }
    };

    // ---- package.json (root identity fallback + engines.node) ----
    let pkg: Record<string, unknown> | null = null;
    const pkgBytes = read('package.json');
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

    // ---- lockfile precedence ----
    // package.json `packageManager: pnpm@…` + a pnpm-lock.yaml ⇒ pnpm-lock IS the declared closure and
    // any npm lockfile beside it is a stray (recorded, not read, no fallback to it). Otherwise npm's own
    // rule: npm-shrinkwrap.json > package-lock.json, and pnpm-lock.yaml is read only when NO npm
    // lockfile is present. yarn is refused.
    let lockParsed = false;
    let lockSeen = false;
    /** the lockfile actually parsed into nodes, and its family — for the declared-manager mismatch line */
    let lockRead: { rel: string; family: 'npm' | 'pnpm' } | null = null;
    const pnpmBytes = read('pnpm-lock.yaml');
    const pnpmDeclared = pnpmBytes !== null && /^pnpm@/.test(asString(pkg?.packageManager) ?? '');
    const lockCandidates = ['npm-shrinkwrap.json', 'package-lock.json'];
    for (const rel of lockCandidates) {
      const bytes = read(rel);
      if (!bytes) continue;
      if (pnpmDeclared) {
        unsupported.add(stackCoverageLockfileIgnored(rel, 'package.json packageManager declares pnpm — pnpm-lock.yaml is the declared closure'));
        continue;
      }
      if (lockSeen) {
        unsupported.add(`lockfile '${rel}' ignored: npm-shrinkwrap.json takes precedence`);
        continue;
      }
      lockSeen = true;
      filesScanned++;
      sources.push({ path: rel, sha256: sha256(bytes), parser: 'npm-lockfile-v3' });
      let lock: unknown;
      try {
        lock = JSON.parse(bytes.toString('utf8'));
      } catch (e) {
        refuse(`lockfile '${rel}' is not valid JSON: ${(e as Error).message}`);
        continue;
      }
      if (!isRecord(lock)) {
        refuse(`lockfile '${rel}' is not a JSON object`);
        continue;
      }
      if (lock.lockfileVersion !== 3) {
        refuse(stackRefusalLockfileVersion(lock.lockfileVersion));
        continue;
      }
      const derived = deriveFromLockfileV3(lock);
      if (derived.hollow !== null) {
        refuse(stackRefusalHollowLockfile(rel, derived.hollow));
        continue;
      }
      if (derived.malformed.length > 0 || derived.emptyDependencyNames.length > 0) {
        for (const k of derived.malformed) refuse(stackRefusalMalformedEntry(rel, k));
        for (const k of derived.emptyDependencyNames) refuse(stackRefusalEmptyDependencyName(rel, k));
        continue;
      }
      // loops, never spread: a very large lockfile must not overflow the call stack
      for (const n of derived.nodes) nodes.push(n);
      for (const e of derived.edges) edges.push(e);
      for (const u of derived.unmodeled) unmodeled.push(u);
      for (const d of derived.rootDeclared) rootDeclared.push(d);
      for (const u of derived.unsupported) unsupported.add(u);
      lockParsed = true;
      lockRead = { rel, family: 'npm' };
    }
    if (pnpmBytes) {
      if (lockSeen) {
        unsupported.add(stackCoverageLockfileIgnored('pnpm-lock.yaml', 'an npm lockfile is present and package.json packageManager does not declare pnpm'));
      } else {
        filesScanned++;
        sources.push({ path: 'pnpm-lock.yaml', sha256: sha256(pnpmBytes), parser: 'pnpm-lockfile-v9' });
        const pnpm = readPnpmLock(pnpmBytes.toString('utf8'), { name: asString(pkg?.name), version: asString(pkg?.version), linkAnchor: knowledge?.linkAnchor ?? path.resolve(repoDir).split(path.sep).join('/') });
        // the lockfile reads cleanly — now the TREE has its say (truncation guards c + d)
        const lost = pnpm.refusals.length === 0 && pnpm.derived !== null ? checkPnpmLockCoversTree(repoDir, pnpm.derived, read, knowledge) : [];
        if (pnpm.refusals.length > 0 || pnpm.derived === null) {
          for (const msg of pnpm.refusals) refuse(msg);
        } else if (lost.length > 0) {
          for (const what of lost) refuse(stackRefusalPnpmLostClosure(what));
        } else {
          // loops, never spread: a very large lockfile must not overflow the call stack
          for (const n of pnpm.derived.nodes) nodes.push(n);
          for (const e of pnpm.derived.edges) edges.push(e);
          for (const u of pnpm.derived.unmodeled) unmodeled.push(u);
          for (const d of pnpm.derived.rootDeclared) rootDeclared.push(d);
          for (const u of pnpm.derived.unsupported) unsupported.add(u);
          lockParsed = true;
          lockRead = { rel: 'pnpm-lock.yaml', family: 'pnpm' };
        }
      }
    }
    if (read('yarn.lock')) unsupported.add(STACK_REFUSAL_YARN);
    // declared manager vs the family actually read (npm has no lockfile of its own name to disagree with
    // package-lock.json / npm-shrinkwrap.json, so only pnpm@ and yarn@ declarations can mismatch an npm read)
    const declaredManager = /^(npm|pnpm|yarn)@/.exec(asString(pkg?.packageManager) ?? '')?.[1] ?? null;
    if (lockRead && declaredManager && declaredManager !== lockRead.family) {
      unsupported.add(stackCoveragePackageManagerMismatch(declaredManager, lockRead.rel));
    }

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
        devOptional: false,
        platformConditional: null,
        root: true,
        installScript: false,
        resolvedWhenUnpinned: null,
        layout: [''],
      });
      unsupported.add(STACK_REFUSAL_NO_LOCKFILE);
      // the fixed strings first (verbatim, testable), the summary line last
      if (unsupported.has(STACK_REFUSAL_YARN)) refusals.push(STACK_REFUSAL_YARN);
      refusals.push(STACK_REFUSAL_NO_LOCKFILE);
    }

    // ---- runtime: .nvmrc > .node-version > package.json engines.node ----
    let runtime: StackRuntime = { node: { declared: null, resolvedFrom: null, pin: false } };
    const nvmrc = read('.nvmrc');
    const nodeVersionFile = read('.node-version');
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
        devOptional: false,
        platformConditional: null,
        root: false,
        installScript: false,
        resolvedWhenUnpinned: null,
        layout: [],
      });
      if (!/^\d/.test(first.value)) unsupported.add(`node runtime '${first.value}' is an alias or range, not a version: recorded as declared, pin:false`);
    } else {
      unsupported.add('no node runtime declaration (.nvmrc / .node-version / engines.node): runtime unknown');
    }

    // ---- images: Dockerfile FROM + compose image: ----
    const { dockerfiles, composeFiles, symlinks, symlinksNotFollowed, nestedCheckouts, depthCut } = findImageFiles(repoDir, knowledge);
    for (const rel of symlinksNotFollowed) unsupported.add(stackCoverageSymlinkNotFollowed(rel));
    for (const rel of nestedCheckouts) unsupported.add(stackCoverageNestedCheckout(rel));
    for (const rel of symlinks) refuse(stackRefusalSymlink(rel));
    if (depthCut) unsupported.add(STACK_COVERAGE_IMAGE_WALK_DEPTH);
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
      const bytes = read(rel);
      if (!bytes) continue;
      filesScanned++;
      sources.push({ path: rel, sha256: sha256(bytes), parser: 'dockerfile' });
      addScan(scanDockerfile(rel, bytes.toString('utf8')));
    }
    for (const rel of composeFiles) {
      const bytes = read(rel);
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
      rootDeclared,
      unmodeled,
      coverage: { unsupported: [...unsupported], filesScanned },
    };
    return { manifest: finalizeStackManifest(body), refusals };
  }
}

/** The stack provider table — one row per lockfile family (widen-only; yarn is a follow-on). */
export const STACK_EXTRACTOR_PROVIDERS: readonly { source: StackFactsExtractor['source']; fileKinds: readonly string[]; make(): StackFactsExtractor }[] =
  Object.freeze([
    {
      source: 'npm-lockfile',
      fileKinds: ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'package.json', '.nvmrc', '.node-version', 'Dockerfile', 'compose.yml'],
      make: () => new NpmLockfileStackExtractor(),
    },
  ]);

/** Front door: extract the stack manifest of a materialized tree. LOUD on an unregistered source. */
export function extractStackManifest(
  repoDir: string,
  revision: string,
  source: StackFactsExtractor['source'] = 'npm-lockfile',
  knowledge?: StackTreeKnowledge,
): StackExtractionResult {
  const provider = STACK_EXTRACTOR_PROVIDERS.find((p) => p.source === source);
  if (!provider) {
    throw new Error(`no stack extractor provider registered for source '${source}' — STACK_EXTRACTOR_PROVIDERS (stack-extractor.ts) is widen-only`);
  }
  return provider.make().extract(repoDir, revision, knowledge);
}
