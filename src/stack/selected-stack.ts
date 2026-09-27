/** Strict, finite source selection for declared-stack contracts. No discovery or network. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { StackSourceConfigSchema, type StackSourceConfig } from '../schema.js';
import { stableStringify } from '../report.js';
import { finalizeStackManifest, StackManifestSchema, stackNodeId, type StackManifest, type StackNode, type StackSource } from './stack-manifest.js';
import { deriveFromLockfileV3, scanDockerfile, scanComposeFile, imageNode, parseImageRef, checkPnpmLockCoversTree } from './stack-extractor.js';
import { readPnpmLock, type StackWarningObserver } from './pnpm-lock-reader.js';

const domainNames = ['packages', 'images', 'runtime', 'closure'] as const;
export type StackDomain = typeof domainNames[number];
const codes = ['opaque-package-entry', 'unresolved-image', 'runtime-conflict', 'non-exact-runtime', 'ambiguous-package-manager', 'unsupported-package-manager-config', 'unsupported-source-syntax', 'unclassified-coverage'] as const;
export type StackLimitationCode = typeof codes[number];
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const InventorySchema = z.object({ path: z.string(), role: z.enum(['selected', 'conflict-check']), present: z.boolean(), sha256: hex.nullable(), parser: z.enum(['npm-lockfile-v3','pnpm-lockfile-v9','package-json','dockerfile','compose','nvmrc','node-version','package-manager-config']) }).strict();
const LimitationSchema = z.object({ code: z.enum(codes), domains: z.array(z.enum(domainNames)), sources: z.array(z.string()), message: z.string(), manifestWarningIndexes: z.array(z.number().int().nonnegative()) }).strict();
export const DeclaredStackFactsSchema = z.object({
  schemaVersion: z.literal('1'), kind: z.literal('DeclaredStackFacts'), provider: z.literal('selected-stack-v1'),
  ctRepoRevision: z.string(), manifestDigest: hex, sourceConfigDigest: hex,
  inventory: z.array(InventorySchema),
  domains: z.object({ packages: z.enum(['complete', 'incomplete', 'not-selected']), images: z.enum(['complete', 'incomplete', 'not-selected']), runtime: z.enum(['complete', 'incomplete', 'not-selected']), closure: z.enum(['complete', 'incomplete', 'not-selected']) }).strict(),
  limitations: z.array(LimitationSchema),
}).strict();
export type DeclaredStackFacts = z.infer<typeof DeclaredStackFactsSchema>;
export type StackLimitation = DeclaredStackFacts['limitations'][number];
export type StackInventoryEntry = DeclaredStackFacts['inventory'][number];
const roots = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'package.json', '.nvmrc', '.node-version', '.npmrc', 'pnpm-workspace.yaml'];
const locks = ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml'];
const exactRuntime = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export const stackSourceConfigDigest = (config: StackSourceConfig): string => digest(stableStringify(config));
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const unique = (v: string[]) => [...new Set(v)].sort();
function parserFor(p: string): StackInventoryEntry['parser'] {
  if (p === 'package.json') return 'package-json';
  if (p === '.nvmrc') return 'nvmrc';
  if (p === '.node-version') return 'node-version';
  if (p === 'pnpm-lock.yaml') return 'pnpm-lockfile-v9';
  if (p === 'package-lock.json' || p === 'npm-shrinkwrap.json') return 'npm-lockfile-v3';
  if (p === '.npmrc' || p === 'pnpm-workspace.yaml') return 'package-manager-config';
  return /^Dockerfile(?:\..+)?$/.test(p.split('/').at(-1)!) ? 'dockerfile' : 'compose';
}
function selectedPaths(c: StackSourceConfig): string[] { return unique([c.lockfile, c.packageManifest, ...c.imageFiles, ...c.runtimeFiles]); }
export function selectedStackInventory(config: StackSourceConfig): Array<Pick<StackInventoryEntry, 'path' | 'role' | 'parser'>> {
  const selected = new Set(selectedPaths(config));
  return unique([...roots, ...selected]).map(p => ({ path: p, role: selected.has(p) ? 'selected' : 'conflict-check', parser: parserFor(p) }));
}
/** Only ENOENT is absence. Inspect every component before any read. */
function readFinite(root: string, rel: string): Buffer | null {
  let current = root;
  const segments = rel.split('/');
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]!);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(current); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
    if (stat.isSymbolicLink() || (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error(`selected stack input is not a regular in-tree file: ${rel}`);
  }
  const real = fs.realpathSync(current);
  if (!real.startsWith(root + path.sep)) throw new Error(`selected stack input escapes repository: ${rel}`);
  return fs.readFileSync(current);
}
function domainsFor(code: StackLimitationCode, c: StackSourceConfig): StackDomain[] {
  if (code === 'opaque-package-entry') return ['packages'];
  if (code === 'unresolved-image') return ['closure', 'images'];
  if (code === 'runtime-conflict' || code === 'non-exact-runtime') return ['closure', 'runtime'];
  if (code === 'ambiguous-package-manager' || code === 'unsupported-package-manager-config') return ['closure', 'packages'];
  return (['closure', ...(c.imageFiles.length ? ['images'] : []), 'packages', ...(c.runtimeFiles.length ? ['runtime'] : [])] as StackDomain[]).sort();
}
function deriveDomains(c: StackSourceConfig, limitations: StackLimitation[]): DeclaredStackFacts['domains'] {
  const domains: DeclaredStackFacts['domains'] = { packages: 'complete', images: c.imageFiles.length ? 'complete' : 'not-selected', runtime: c.runtimeFiles.length ? 'complete' : 'not-selected', closure: 'complete' };
  for (const l of limitations) if (l.code !== 'opaque-package-entry') for (const d of l.domains) domains[d] = 'incomplete';
  return domains;
}
function normalizedRuntime(raw: string): string { return raw.replace(/^v(?=\d)/, ''); }

export function extractSelectedStack(repoDir: string, revision: string, input: StackSourceConfig, linkAnchor = repoDir): { manifest: StackManifest; facts: DeclaredStackFacts } {
  const config = StackSourceConfigSchema.parse(input);
  const root = fs.realpathSync(repoDir);
  const bytes = new Map<string, Buffer | null>();
  const inventory = selectedStackInventory(config).map(row => {
    const data = readFinite(root, row.path); bytes.set(row.path, data);
    if (!data && row.role === 'selected') throw new Error(`selected stack input is missing: ${row.path}`);
    return { ...row, present: data !== null, sha256: data === null ? null : digest(data) };
  });
  const pkg: unknown = JSON.parse(bytes.get('package.json')!.toString('utf8'));
  if (!object(pkg)) throw new Error('selected package.json must be an object');
  for (const f of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'engines']) if (pkg[f] !== undefined && !object(pkg[f])) throw new Error(`invalid package.json ${f}`);
  const pending: Array<Omit<StackLimitation, 'manifestWarningIndexes'>> = [];
  const add = (code: StackLimitationCode, message: string, sources: string[]) => {
    pending.push({ code, message, sources: unique(sources), domains: domainsFor(code, config) });
  };
  const observer = (source: string): StackWarningObserver => (code, message) => {
    // These explicitly producer-classified notices describe snapshot-only claims:
    // install scripts, inferred flags, transitive ranges, identity disambiguation,
    // absent integrity (resolved identity retained), and complete empty closures.
    if (code !== 'snapshot-information') add(code, message, [source]);
  };
  const presentLocks = locks.filter(p => bytes.get(p) !== null);
  if (presentLocks.length !== 1) add('ambiguous-package-manager', 'multiple root package-manager lockfiles are present', presentLocks);
  const expectedManager = config.source === 'npm-lockfile-v3' ? 'npm' : 'pnpm';
  if (pkg.packageManager !== undefined && (typeof pkg.packageManager !== 'string' || !new RegExp(`^${expectedManager}@[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?$`).test(pkg.packageManager))) add('ambiguous-package-manager', 'packageManager declaration conflicts with the selected lockfile family or is unsupported', ['package.json', config.lockfile]);
  for (const p of ['.npmrc', 'pnpm-workspace.yaml']) if (bytes.get(p)?.toString('utf8').trim()) add('unsupported-package-manager-config', `nonempty ${p} is not interpreted by selected-stack-v1`, [p]);
  let derived: ReturnType<typeof deriveFromLockfileV3>;
  if (config.source === 'npm-lockfile-v3') {
    const lock: unknown = JSON.parse(bytes.get(config.lockfile)!.toString('utf8'));
    if (!object(lock) || lock.lockfileVersion !== 3) throw new Error('selected npm lockfile must have lockfileVersion 3');
    const lockRoot = object(lock.packages) && object(lock.packages['']) ? lock.packages[''] : null;
    if (lockRoot) {
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        if (stableStringify(pkg[field] ?? {}) !== stableStringify(lockRoot[field] ?? {})) throw new Error(`package.json ${field} disagrees with the selected lockfile root`);
      }
    }
    const emptyRoot = lockRoot !== null && ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].every(f => object(pkg[f] ?? {}) && Object.keys((pkg[f] ?? {}) as object).length === 0);
    derived = deriveFromLockfileV3(lock, observer(config.lockfile), emptyRoot);
    if (derived.hollow || derived.malformed.length || derived.emptyDependencyNames.length) throw new Error(`selected npm lockfile is incomplete: ${derived.hollow ?? [...derived.malformed, ...derived.emptyDependencyNames].join(', ')}`);
  } else {
    const result = readPnpmLock(bytes.get(config.lockfile)!.toString('utf8'), {
      name: typeof pkg.name === 'string' ? pkg.name : null,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      linkAnchor: path.resolve(linkAnchor).split(path.sep).join('/'),
    }, observer(config.lockfile));
    if (!result.derived || result.refusals.length) throw new Error(`selected pnpm lockfile is incomplete: ${result.refusals.join('; ')}`);
    const pd = result.derived;
    // Non-root importers need package manifests outside the accepted finite inventory.
    // Do not read them, silently weaken upstream truncation guards, or claim replayability.
    if (pd.importers.some(i => i.path !== '.')) add('unsupported-package-manager-config', 'workspace importer validation requires sources outside selected-stack-v1 inventory', [config.lockfile]);
    else {
      const lost = checkPnpmLockCoversTree(root, pd, p => p === 'pnpm-workspace.yaml' ? null : bytes.get(p) ?? null);
      if (lost.length) throw new Error(`selected pnpm lockfile lost declared closure: ${lost.join('; ')}`);
    }
    derived = { ...pd, emptyDependencyNames: [] };
  }
  if (derived.unmodeled.length && !pending.some(l => l.code === 'opaque-package-entry')) add('opaque-package-entry', 'opaque package identities are hashed but package names cannot be fully graded', [config.lockfile]);
  const nodes = [...derived.nodes];
  const images: StackManifest['images'] = [];
  for (const p of config.imageFiles) {
    const scan = parserFor(p) === 'dockerfile' ? scanDockerfile(p, bytes.get(p)!.toString('utf8'), observer(p), true) : scanComposeFile(p, bytes.get(p)!.toString('utf8'), observer(p));
    images.push(...scan.images);
  }
  for (const image of images) { const n = imageNode(image); if (!nodes.some(v => v.id === n.id)) nodes.push(n); }
  const runtime: StackManifest['runtime'] = { node: { declared: null, resolvedFrom: null, pin: false } };
  if (config.runtimeFiles.length) {
    const declarations: Array<{ path: string; value: string }> = [];
    for (const p of ['.nvmrc', '.node-version']) {
      const data = bytes.get(p);
      if (data) {
        const lines = data.toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
        if (lines.length !== 1) add('non-exact-runtime', `${p} must contain exactly one Node version declaration`, [p]);
        declarations.push({ path: p, value: normalizedRuntime(lines[0] ?? '') });
      }
    }
    if (object(pkg.engines) && pkg.engines.node !== undefined) {
      if (typeof pkg.engines.node !== 'string') add('non-exact-runtime', 'package.json engines.node is not a string declaration', ['package.json']);
      else declarations.push({ path: 'package.json', value: normalizedRuntime(pkg.engines.node) });
    }
    for (const d of declarations) if (!exactRuntime.test(d.value)) add('non-exact-runtime', `${d.path} does not declare an exact Node x.y.z version`, [d.path]);
    if (new Set(declarations.map(d => d.value)).size > 1) add('runtime-conflict', 'present Node declarations disagree', declarations.map(d => d.path));
    const selected = declarations.find(d => config.runtimeFiles.includes(d.path));
    if (!selected || config.runtimeFiles.some(p => !declarations.some(d => d.path === p))) add('non-exact-runtime', 'a selected runtime source contains no Node declaration', config.runtimeFiles);
    if (selected && selected.value) {
      const from = selected.path === '.nvmrc' ? 'nvmrc' : selected.path === '.node-version' ? 'node-version' : 'engines';
      runtime.node = { declared: selected.value, resolvedFrom: from, pin: exactRuntime.test(selected.value) };
      const n: StackNode = { id: stackNodeId('node-runtime', 'node', selected.value), kind: 'node-runtime', name: 'node', version: selected.value, integrity: null, resolvedFrom: from, dev: false, optional: false, peer: false, devOptional: false, root: false, installScript: false, resolvedWhenUnpinned: null, platformConditional: null, layout: [] };
      nodes.push(n);
    }
  }
  const warnings = unique(pending.map(l => l.message));
  const manifest = finalizeStackManifest({ schemaVersion: '1', kind: 'StackManifest', ctRepoRevision: revision, sources: inventory.filter(r => r.role === 'selected').map(r => ({ path: r.path, sha256: r.sha256!, parser: r.parser as StackSource['parser'] })), nodes, edges: derived.edges, images, runtime, rootDeclared: derived.rootDeclared, unmodeled: derived.unmodeled, coverage: { unsupported: warnings, filesScanned: selectedPaths(config).length } });
  const byMessage = new Map<string, Omit<StackLimitation, 'manifestWarningIndexes'>>();
  for (const l of pending) {
    const previous = byMessage.get(l.message);
    if (previous) previous.sources = unique([...previous.sources, ...l.sources]);
    else byMessage.set(l.message, { ...l });
  }
  const limitations = [...byMessage.values()].map(l => ({ ...l, manifestWarningIndexes: [manifest.coverage.unsupported.indexOf(l.message)] })).sort((a, b) => compare(stableStringify(a), stableStringify(b)));
  const facts: DeclaredStackFacts = { schemaVersion: '1', kind: 'DeclaredStackFacts', provider: 'selected-stack-v1', ctRepoRevision: revision, manifestDigest: manifest.manifestDigest, sourceConfigDigest: stackSourceConfigDigest(config), inventory, domains: deriveDomains(config, limitations), limitations };
  const errors = validateSelectedStack(config, manifest, facts);
  if (errors.length) throw new Error(`selected stack consistency error: ${errors.join('; ')}`);
  return { manifest, facts };
}

/** Offline internal consistency, never source provenance. No filesystem access. */
export function validateSelectedStack(input: StackSourceConfig, manifestInput: StackManifest, factsInput: DeclaredStackFacts): string[] {
  const errors: string[] = [];
  const c = StackSourceConfigSchema.safeParse(input), m = StackManifestSchema.safeParse(manifestInput), f = DeclaredStackFactsSchema.safeParse(factsInput);
  if (!c.success || !m.success || !f.success) return ['invalid strict selected-stack artifact shape'];
  const config = c.data, manifest = m.data, facts = f.data;
  if (facts.sourceConfigDigest !== stackSourceConfigDigest(config)) errors.push('source configuration digest mismatch');
  if (facts.ctRepoRevision !== manifest.ctRepoRevision || facts.manifestDigest !== manifest.manifestDigest) errors.push('manifest/facts binding mismatch');
  const { stackDigest: _s, stackId: _i, manifestDigest: _m, ...body } = manifest;
  if (stableStringify(finalizeStackManifest(body)) !== stableStringify(manifest)) errors.push('manifest canonical identities mismatch');
  const expected = selectedStackInventory(config);
  if (stableStringify(facts.inventory.map(({ path, role, parser }) => ({ path, role, parser }))) !== stableStringify(expected)) errors.push('inventory path/role/parser mismatch');
  for (const row of facts.inventory) if (row.present !== (row.sha256 !== null) || (row.role === 'selected' && !row.present)) errors.push(`inventory presence mismatch: ${row.path}`);
  const selected = facts.inventory.filter(r => r.role === 'selected' && r.present).map(r => ({ path: r.path, sha256: r.sha256!, parser: r.parser }));
  if (stableStringify(selected) !== stableStringify(manifest.sources) || manifest.coverage.filesScanned !== selected.length) errors.push('selected manifest source binding mismatch');
  const orderedLimitations = [...facts.limitations].sort((a,b) => compare(stableStringify(a),stableStringify(b)));
  if (stableStringify(orderedLimitations) !== stableStringify(facts.limitations) || new Set(facts.limitations.map(l=>stableStringify(l))).size !== facts.limitations.length) errors.push('limitations are not canonical unique entries');
  const used = new Set<number>();
  for (const l of facts.limitations) {
    if (stableStringify(l.domains) !== stableStringify(domainsFor(l.code, config))) errors.push(`limitation domain mismatch: ${l.code}`);
    if (stableStringify(l.sources) !== stableStringify(unique(l.sources)) || l.sources.some(p => !facts.inventory.some(r => r.path === p && r.present))) errors.push('limitation source mismatch');
    if (l.manifestWarningIndexes.length > 1) errors.push('grouped warning indexes');
    for (const i of l.manifestWarningIndexes) {
      if (used.has(i) || manifest.coverage.unsupported[i] !== l.message) errors.push('warning index/message mismatch');
      used.add(i);
    }
    if ((l.code === 'unresolved-image' && !config.imageFiles.length) || (['runtime-conflict', 'non-exact-runtime'].includes(l.code) && !config.runtimeFiles.length)) errors.push('limitation affects unselected domain');
  }
  if (used.size !== manifest.coverage.unsupported.length) errors.push('unmatched manifest warnings');
  if (stableStringify(facts.domains) !== stableStringify(deriveDomains(config, facts.limitations))) errors.push('gradeability domain mismatch');
  if ((manifest.unmodeled.length > 0) !== facts.limitations.some(l => l.code === 'opaque-package-entry')) errors.push('opaque identity limitation mismatch');
  if (facts.inventory.filter(r => locks.includes(r.path) && r.present).length > 1 && !facts.limitations.some(l => l.code === 'ambiguous-package-manager')) errors.push('unacknowledged package-manager conflict');
  const nodeIds = new Set(manifest.nodes.map(n=>n.id));
  if (nodeIds.size !== manifest.nodes.length) errors.push('duplicate node identities');
  if (manifest.nodes.filter(n=>n.root).length !== 1 || manifest.nodes.some(n=>n.root && n.kind !== 'npm')) errors.push('invalid root node');
  for (const n of manifest.nodes) {
    const base = stackNodeId(n.kind,n.name,n.version);
    const identity = `npm\0${n.name}\0${n.version}\0${JSON.stringify(n.integrity)}\0${JSON.stringify(n.resolvedWhenUnpinned)}`;
    const collision = `${base}+${digest(identity).slice(0,12)}`;
    const rootSuffix = n.root && n.id.startsWith(base+'+root') && /^(?:\.[2-9][0-9]*|\.1[0-9]+)?$/.test(n.id.slice((base+'+root').length));
    if (n.id !== base && !(n.kind === 'npm' && (n.root ? rootSuffix : n.id === collision))) errors.push('node identity does not match its facts');
    if (n.kind === 'npm' && n.resolvedFrom !== 'lockfile') errors.push('npm node source mismatch');
    if (n.kind === 'oci-image' && !manifest.images.some(i=>stableStringify(imageNode(i))===stableStringify(n))) errors.push('image node has no corresponding selected declaration');
  }
  for (const e of manifest.edges) if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || manifest.nodes.find(n=>n.id===e.from)?.kind !== 'npm' || manifest.nodes.find(n=>n.id===e.to)?.kind !== 'npm') errors.push('edge endpoints are not package identities');
  const runtimeNodes = manifest.nodes.filter(n=>n.kind==='node-runtime');
  const runtime = manifest.runtime.node;
  if (runtime.pin !== (runtime.declared !== null && exactRuntime.test(runtime.declared))) errors.push('runtime pin disagrees with declaration');
  if (runtime.declared === null ? runtimeNodes.length !== 0 || runtime.resolvedFrom !== null : runtimeNodes.length !== 1 || runtimeNodes[0]!.version !== runtime.declared || runtimeNodes[0]!.name !== 'node' || runtimeNodes[0]!.resolvedFrom !== runtime.resolvedFrom) errors.push('runtime node/declaration mismatch');
  if (config.source === 'npm-lockfile-v3' && manifest.unmodeled.some(u=>u.reason.startsWith('pnpm-'))) errors.push('opaque identity source family mismatch');
  if (config.source === 'pnpm-lockfile-v9' && manifest.unmodeled.some(u=>u.reason==='not-under-node-modules')) errors.push('opaque identity source family mismatch');
  for (const image of manifest.images) {
    const parsed = parseImageRef(image.ref);
    if (image.name !== parsed.name || image.tag !== parsed.tag || image.tagImplicit !== parsed.tagImplicit || image.digest !== parsed.digest || image.pin !== /^sha256:[a-f0-9]{64}$/.test(image.digest ?? '')) errors.push('image reference interpretation mismatch');
    if (!manifest.nodes.some(n=>n.id===imageNode(image).id)) errors.push('image declaration has no node');
    const match = /^(.*)#L([1-9]\d*)$/.exec(image.evidenceRef);
    if (!match || !config.imageFiles.includes(match[1]!) || parserFor(match[1]!) !== image.resolvedFrom) errors.push('image source anchor mismatch');
  }
  const runtimePath = manifest.runtime.node.resolvedFrom === 'nvmrc' ? '.nvmrc' : manifest.runtime.node.resolvedFrom === 'node-version' ? '.node-version' : manifest.runtime.node.resolvedFrom === 'engines' ? 'package.json' : null;
  if (runtimePath && !config.runtimeFiles.includes(runtimePath)) errors.push('runtime source is not selected');
  if (!config.runtimeFiles.length && (manifest.runtime.node.declared !== null || manifest.nodes.some(n => n.kind === 'node-runtime'))) errors.push('unselected runtime injected');
  if (!config.imageFiles.length && (manifest.images.length || manifest.nodes.some(n => n.kind === 'oci-image'))) errors.push('unselected images injected');
  if (config.runtimeFiles.length && (!manifest.runtime.node.declared || !exactRuntime.test(manifest.runtime.node.declared)) && !facts.limitations.some(l => l.code === 'non-exact-runtime')) errors.push('unacknowledged non-exact runtime');
  for (const image of manifest.images) if ((!image.pin || !/^sha256:[a-f0-9]{64}$/.test(image.digest ?? '')) && image.digest !== null && !facts.limitations.some(l => l.code === 'unresolved-image')) errors.push('unacknowledged malformed image digest');
  return unique(errors);
}
