/**
 * stack-pnpm.test.ts — pnpm-lock.yaml (lockfileVersion '9.0') ingestion into the StackManifest.
 *
 * The fixture `fixtures/stack/pnpm-v9-synth-tree` is a SYNTHETIC workspace (synth-* package names,
 * well-known public registry packages only) whose lockfile was written by pnpm 10 with
 * `--lockfile-only`: two importers beyond the root, a `workspace:` link, a `catalog:` reference, a
 * patched dependency, an `npm:` alias, a git-hosted tarball, peer-suffixed snapshot variants (one of
 * them optional), auto-installed peers and os/cpu-conditional optional packages.
 *
 * Groups:
 *  1. BYTE IDENTITY against the committed golden (extractor twice + the real CLI).
 *  2. THE NODE TABLE — identities, derived dev/optional/peer flags, and exactly which inputs are
 *     refused into coverage (link, catalog, git tarball, patch) with NO fabricated node.
 *  3. NEGATIVE CONTROLS — a byte-different, semantically identical lockfile (every mapping reversed,
 *     4-space indent, every scalar quoted, flow collections rewritten as blocks; CRLF + BOM) keeps the
 *     digest, the nodes and the edges.
 *  4. POSITIVE CONTROLS — a version edit and an integrity flip MUST move the digest; a specifier-only
 *     edit must NOT.
 *  5. THE SUBSET READER — what it accepts, and every YAML construct it refuses (with a line number).
 *  6. REFUSALS + PRECEDENCE at the extractor and the CLI.
 *  7. CROSS-FAMILY — the same trivial closure locked by npm and by pnpm shares a digest.
 *
 * Everything runs on temp copies; the fixture is never mutated. No network.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Ajv } from 'ajv';
import { generateSchemas } from '../scripts/generate-schemas.js';
import { stableStringify } from '../src/report.js';
import { parseStackManifest, verifyStackManifest, type StackManifest, type StackNode } from '../src/stack/stack-manifest.js';
import {
  extractStackManifest,
  stackCoverageLockfileIgnored,
  stackCoveragePackageManagerMismatch,
  STACK_REFUSAL_YARN,
  stackRefusalSymlink,
  STACK_COVERAGE_DECLARED_NOT_INSTALLED,
  STACK_COVERAGE_NO_IMAGES,
  STACK_REFUSAL_NO_LOCKFILE,
  checkPnpmLockCoversTree,
  findPackageJsonDirs,
} from '../src/stack/stack-extractor.js';
import {
  deriveFromPnpmLockV9,
  parsePnpmLockSubset,
  PnpmLockSubsetError,
  PnpmBlockScalar,
  PNPM_LOCK_MAX_NESTING,
  readPnpmLock,
  splitPnpmKey,
  stackRefusalPnpmLockfileVersion,
  stackRefusalPnpmSubset,
  STACK_COVERAGE_PNPM_DERIVED_FLAGS,
  STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS,
  STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS,
  STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS,
  STACK_COVERAGE_PNPM_DEPENDENCY_FREE,
  stackRefusalPnpmHollow,
  stackRefusalPnpmMalformed,
  stackRefusalPnpmLostClosure,
  pnpmLinkTarget,
  pnpmWorkspaceGlobToRegExp,
  readPnpmWorkspacePatterns,
  isPnpmWorkspaceDir,
  pnpmWorkspaceGlobMayMatchBelow,
  canonicalPnpmValue,
  type PnpmUnmodeled,
  type PnpmYamlMap,
  type PnpmYamlValue,
} from '../src/stack/pnpm-lock-reader.js';

const ROOT = path.join(__dirname, '..');
const FIXTURE_TREE = path.join(ROOT, 'fixtures', 'stack', 'pnpm-v9-synth-tree');
const GOLDEN_PATH = path.join(ROOT, 'fixtures', 'stack', 'pnpm-v9-synth.stack.json');
const REVISION = 'synthetic-pnpm-v9-fixture';
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(ROOT, 'src', 'cli.ts');

const goldenBytes = fs.readFileSync(GOLDEN_PATH, 'utf8');
const golden: StackManifest = parseStackManifest(JSON.parse(goldenBytes));
const fixtureLock = fs.readFileSync(path.join(FIXTURE_TREE, 'pnpm-lock.yaml'), 'utf8');

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bce-stack-pnpm-${label}-`));
  tempDirs.push(d);
  return d;
}
/**
 * A temp tree with the fixture's root files and the given lockfile text (never the fixture itself).
 * The lockfile must COVER its tree (truncation guards c + d), so every importer the text names gets a
 * `package.json`: the fixture's own when the fixture's root manifest is used (no `pkg`) and it has
 * one, else a manifest declaring nothing. `files`
 * adds or overrides tree files (a `null` value leaves the file out).
 */
function treeWith(label: string, lockText: string, pkg?: Record<string, unknown>, files: Record<string, string | null> = {}): string {
  const d = tmp(label);
  fs.writeFileSync(path.join(d, '.nvmrc'), fs.readFileSync(path.join(FIXTURE_TREE, '.nvmrc')));
  fs.writeFileSync(
    path.join(d, 'package.json'),
    pkg ? JSON.stringify(pkg, null, 2) : fs.readFileSync(path.join(FIXTURE_TREE, 'package.json')),
  );
  fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), lockText);
  const importersBlock = /^['"]?importers['"]?:[ \t]*\r?\n((?:(?:[ \t]+.*)?\r?\n)*)/m.exec(lockText.replace(/^\uFEFF/, ''))?.[1] ?? '';
  const indent = /^( +)\S/m.exec(importersBlock)?.[1] ?? '  ';
  for (const m of importersBlock.matchAll(new RegExp(`^${indent}(?:'([^']+)'|"([^"]+)"|([^\\s'":][^:]*)):`, 'gm'))) {
    const imp = m[1] ?? m[2] ?? m[3] ?? '';
    if (imp === '.' || imp === '' || imp.startsWith('..') || path.isAbsolute(imp)) continue;
    const own = path.join(FIXTURE_TREE, imp, 'package.json');
    fs.mkdirSync(path.join(d, imp), { recursive: true });
    fs.writeFileSync(path.join(d, imp, 'package.json'), !pkg && fs.existsSync(own) ? fs.readFileSync(own) : JSON.stringify({ name: path.basename(imp), version: '1.0.0' }));
  }
  // a lockfile with workspace importers sits in a workspace: the tree names them (guard d)
  if (fs.readdirSync(d).some((e) => fs.statSync(path.join(d, e)).isDirectory())) {
    const dirs = fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name === 'package.json' && path.relative(d, e.parentPath) !== '');
    fs.writeFileSync(path.join(d, 'pnpm-workspace.yaml'), `packages:\n${dirs.map((e) => `  - '${path.relative(d, e.parentPath).split(path.sep).join('/')}'\n`).join('')}`);
  }
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(d, rel);
    if (content === null) {
      fs.rmSync(abs, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return d;
}
/** Move the workspace package `packages/lib` to `packages/other`: its importer AND the link that points at it (guard b). */
function relinkLibToOther(text: string): string {
  const out = text.replace('version: link:../lib', 'version: link:../other').replace('\n  packages/lib:\n', '\n  packages/other:\n');
  expect(out).toContain('\n  packages/other:\n');
  return out;
}
/** The fixture's `packages/app/package.json` with one dependency renamed — the tree must declare what the lockfile records (guard c). */
function appManifestRenaming(from: string, to: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(FIXTURE_TREE, 'packages', 'app', 'package.json'), 'utf8');
  expect(raw).toContain(`"${from}"`);
  return { 'packages/app/package.json': raw.replace(`"${from}"`, `"${to}"`) };
}
function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return { status: typeof res.status === 'number' ? res.status : 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
const node = (m: StackManifest, id: string): StackNode | undefined => m.nodes.find((n) => n.id === id);

/**
 * Re-serialize a parsed lockfile as DIFFERENT bytes with the same meaning: every mapping's keys in
 * reverse order, `indent`-space nesting, every key and scalar single-quoted, every flow collection
 * written as a block (empty ones stay `{}` / `[]`).
 */
function emitYaml(value: PnpmYamlValue, indent: number, depth = 0): string {
  const pad = ' '.repeat(indent * depth);
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  if (typeof value === 'string') return q(value);
  // typed scalars must stay PLAIN: quoting `true` / `null` would turn them into different (string) values
  if (value === null) return '~';
  if (typeof value === 'boolean') return value ? 'True' : 'FALSE';
  if (value instanceof PnpmBlockScalar) throw new Error('the fixture carries no block scalar');
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((v) => `${pad}- ${emitYaml(v, indent, depth + 1)}`).join('\n');
  }
  if (value.size === 0) return '{}';
  return [...value.keys()]
    .reverse()
    .map((k) => {
      const v = value.get(k)!;
      const inline = typeof v === 'string' || typeof v === 'boolean' || v === null || v instanceof PnpmBlockScalar || (Array.isArray(v) ? v.length === 0 : v.size === 0);
      return inline ? `${pad}${q(k)}: ${emitYaml(v, indent, depth + 1)}` : `${pad}${q(k)}:\n${emitYaml(v, indent, depth + 1)}`;
    })
    .join('\n');
}

/* -------------------------------------------------------------------------- */
/* 1. byte identity                                                            */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 1: byte identity against the committed golden', () => {
  it('the synthetic pnpm workspace extracts to the golden manifest byte-for-byte, twice', () => {
    const r1 = extractStackManifest(FIXTURE_TREE, REVISION);
    const r2 = extractStackManifest(FIXTURE_TREE, REVISION);
    expect(r1.refusals).toEqual([]);
    expect(stableStringify(r1.manifest)).toBe(goldenBytes);
    expect(stableStringify(r2.manifest)).toBe(goldenBytes);
  });

  it('the golden re-derives (stackDigest, stackId, manifestDigest) and validates against the published schema', () => {
    expect(verifyStackManifest(golden).valid).toBe(true);
    const ajv = new Ajv({ strict: false, allowUnionTypes: true });
    const validate = ajv.compile(generateSchemas()['stack-manifest.schema.json']!);
    expect(validate(JSON.parse(goldenBytes)), ajv.errorsText(validate.errors)).toBe(true);
    // the widened enum is what admits it: the same document with an unknown parser is rejected
    const bad = JSON.parse(goldenBytes) as { sources: Array<{ parser: string }> };
    bad.sources.find((s) => s.parser === 'pnpm-lockfile-v9')!.parser = 'pnpm-lockfile-v6';
    expect(validate(bad)).toBe(false);
  });

  it('the real CLI writes the golden bytes (--no-pin --ref over the fixture tree)', () => {
    const out = path.join(tmp('cli'), 'stack-manifest.json');
    const r = runCli(['stack', 'snapshot', '--ct-repo', FIXTURE_TREE, '--no-pin', '--ref', REVISION, '--out', out], ROOT);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`stackId ${golden.stackId}`);
    expect(fs.readFileSync(out, 'utf8')).toBe(goldenBytes);
  });
});

/* -------------------------------------------------------------------------- */
/* 2. the node table                                                           */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 2: the node table and the refusals', () => {
  it('SC1: a non-empty closure from the pnpm source (not just the root)', () => {
    expect(golden.sources.map((s) => `${s.path}:${s.parser}`)).toEqual(['.nvmrc:nvmrc', 'package.json:package-json', 'pnpm-lock.yaml:pnpm-lockfile-v9']);
    const npm = golden.nodes.filter((n) => n.kind === 'npm');
    expect(npm).toHaveLength(41); // 40 registry packages + the root
    expect(npm.filter((n) => n.root).map((n) => n.id)).toEqual(['npm:synth-workspace-root@1.2.3']);
    expect(npm.filter((n) => !n.root).every((n) => typeof n.integrity === 'string' && n.integrity.startsWith('sha512-'))).toBe(true);
    expect(npm.every((n) => n.resolvedFrom === 'lockfile' && n.installScript === false)).toBe(true);
  });

  it('identity is (name, version, integrity): peer-suffixed snapshot variants collapse into ONE node, variants kept in the non-hashed layout', () => {
    const uses = golden.nodes.filter((n) => n.name === 'use-sync-external-store');
    expect(uses).toHaveLength(1);
    expect(uses[0]!.layout).toEqual(['use-sync-external-store@1.2.0(react@17.0.2)', 'use-sync-external-store@1.2.0(react@18.2.0)']);
    // two real versions of one name stay two nodes
    expect(golden.nodes.filter((n) => n.name === 'react').map((n) => n.version)).toEqual(['17.0.2', '18.2.0']);
    expect(golden.nodes.filter((n) => n.name === 'is-number').map((n) => n.version)).toEqual(['6.0.0', '7.0.0']);
    // the patch_hash snapshot suffix is not part of the identity either
    expect(node(golden, 'npm:is-odd@3.0.1')!.layout).toEqual(['is-odd@3.0.1(patch_hash=1a72dd5d2472e393b437c7423fd181990431dbb5e2b789002c893b20416cb523)']);
  });

  it('flags: optional is read (every variant optional), dev and peer are derived by reachability', () => {
    // optional: one variant of use-sync-external-store is optional, the other is required ⇒ required
    expect(node(golden, 'npm:use-sync-external-store@1.2.0')!.optional).toBe(false);
    // fsevents is optional everywhere; reachable from a prod importer bucket ⇒ not dev
    expect(node(golden, 'npm:fsevents@2.3.3')).toMatchObject({ optional: true, dev: false, platformConditional: { os: ['darwin'], cpu: [] } });
    // rollup is a root devDependency; its platform binaries are dev + optional + os/cpu conditional
    expect(node(golden, 'npm:rollup@4.18.0')).toMatchObject({ dev: true, optional: false });
    expect(node(golden, 'npm:@rollup/rollup-linux-x64-gnu@4.18.0')).toMatchObject({
      dev: true,
      optional: true,
      platformConditional: { os: ['linux'], cpu: ['x64'] },
    });
    expect(golden.nodes.filter((n) => n.dev).length).toBe(18);
    // ajv is only there because ajv-keywords PEERS on it (auto-installed peer): peer, and so is what only ajv needs
    expect(golden.nodes.filter((n) => n.peer).map((n) => n.id)).toEqual([
      'npm:ajv@8.20.0',
      'npm:fast-uri@3.1.8',
      'npm:json-schema-traverse@1.0.0',
      'npm:require-from-string@2.0.2',
    ]);
    // fast-deep-equal is needed by ajv AND directly by ajv-keywords ⇒ not peer-only
    expect(node(golden, 'npm:fast-deep-equal@3.1.3')!.peer).toBe(false);
    // react is declared by an importer ⇒ not peer-only even though use-sync-external-store peers on it
    expect(node(golden, 'npm:react@18.2.0')!.peer).toBe(false);
  });

  it('SC2: the workspace link:, the git tarball and the catalog/patch facts are coverage lines — and NO node is fabricated for them', () => {
    const lines = golden.coverage.unsupported;
    expect(lines).toEqual(
      [
        STACK_COVERAGE_DECLARED_NOT_INSTALLED,
        STACK_COVERAGE_NO_IMAGES,
        STACK_COVERAGE_PNPM_DERIVED_FLAGS,
        STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS,
        STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS,
        STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS,
        'npm: alias packages/app:sw-cjs -> string-width@4.2.3: the real package is a node; the alias name is hashed as an opaque entry',
        'pnpm catalog reference packages/app:is-number (catalog:): catalog range not dereferenced; edge spec kept verbatim',
        "pnpm package 'is-positive@https://codeload.github.com/kevva/is-positive/tar.gz/97edff6f525f192a3f83cea1944765f769ae2678': non-registry resolution (tarball URL / git / file: / directory) — no locked registry identity in this slice; hashed as an opaque entry, no node",
        "pnpm patchedDependencies 'is-odd@3.0.1': a local patch alters the installed package; the node integrity is the UNPATCHED registry tarball — the patch hash is hashed as an opaque entry",
        'workspace/link entry packages/app:synth-lib -> link:../lib: local package not part of the declared closure in slice 1; hashed as an opaque entry, no node',
      ].sort(),
    );
    expect(golden.nodes.some((n) => n.name === 'synth-lib' || n.name === 'synth-app')).toBe(false);
    expect(golden.nodes.some((n) => n.name === 'is-positive')).toBe(false);
    expect(golden.nodes.some((n) => /^(link|file|workspace|https?):?/.test(n.version))).toBe(false);
    expect(golden.edges.some((e) => e.to.includes('synth-lib') || e.to.includes('is-positive'))).toBe(false);
  });

  it('edges: importer edges hang off the root with the declared specifier; an npm: alias points at the REAL identity; peer edges carry the peer range', () => {
    const rootId = 'npm:synth-workspace-root@1.2.3';
    const fromRoot = golden.edges.filter((e) => e.from === rootId);
    expect(fromRoot.find((e) => e.to === 'npm:string-width@4.2.3')).toMatchObject({ spec: 'npm:string-width@^4.2.0', dev: false });
    expect(golden.nodes.some((n) => n.name === 'sw-cjs')).toBe(false); // the alias is a name for an edge, never a node
    expect(fromRoot.find((e) => e.to === 'npm:is-number@7.0.0')).toMatchObject({ spec: 'catalog:' });
    expect(fromRoot.find((e) => e.to === 'npm:rollup@4.18.0')).toMatchObject({ spec: '4.18.0', dev: true });
    expect(fromRoot.find((e) => e.to === 'npm:fsevents@2.3.3')).toMatchObject({ optional: true, dev: false });
    expect(fromRoot.filter((e) => e.to.startsWith('npm:react@')).map((e) => e.to)).toEqual(['npm:react@17.0.2', 'npm:react@18.2.0']);
    const peerEdges = golden.edges.filter((e) => e.peer);
    expect(peerEdges.find((e) => e.from === 'npm:ajv-keywords@5.1.0')).toMatchObject({ to: 'npm:ajv@8.20.0', spec: '^8.8.2' });
    // a transitive non-peer edge has no recorded range
    expect(golden.edges.find((e) => e.from === 'npm:loose-envify@1.4.0')).toMatchObject({ to: 'npm:js-tokens@4.0.0', spec: '', peer: false });
  });
});

/* -------------------------------------------------------------------------- */
/* 3. negative controls                                                        */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 3: negative controls (byte-different lockfile, same closure)', () => {
  it('SC4: every mapping reversed + 4-space indent + all scalars quoted + flow→block ⇒ same stackDigest, nodes and edges', () => {
    const reserialized = `${emitYaml(parsePnpmLockSubset(fixtureLock), 4)}\n`;
    expect(reserialized).not.toBe(fixtureLock);
    expect(reserialized.indexOf("'snapshots':")).toBeLessThan(reserialized.indexOf("'packages':")); // really reordered
    expect(reserialized).toContain("\n        'resolution':\n            'integrity': 'sha512-"); // really re-indented, flow→block
    const r = extractStackManifest(treeWith('reserialized', reserialized), REVISION);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.nodes).toEqual(golden.nodes);
    expect(r.manifest.edges).toEqual(golden.edges);
    expect(r.manifest.coverage).toEqual(golden.coverage);
    const sha = (m: StackManifest): string | undefined => m.sources.find((s) => s.path === 'pnpm-lock.yaml')?.sha256;
    expect(sha(r.manifest)).not.toBe(sha(golden)); // the file changed, and the manifest says so…
    expect(r.manifest.manifestDigest).not.toBe(golden.manifestDigest);
  });

  it('only the snapshots reordered so the OPTIONAL variant of a package comes first ⇒ same stackDigest (no first-variant-wins)', () => {
    const a = "  use-sync-external-store@1.2.0(react@17.0.2):\n    dependencies:\n      react: 17.0.2\n\n";
    const b = "  use-sync-external-store@1.2.0(react@18.2.0):\n    dependencies:\n      react: 18.2.0\n    optional: true\n\n";
    expect(fixtureLock).toContain(a + b);
    const swapped = fixtureLock.replace(a + b, b + a);
    const r = extractStackManifest(treeWith('variant-order', swapped), REVISION);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(node(r.manifest, 'npm:use-sync-external-store@1.2.0')!.optional).toBe(false);
  });

  it('the optional flag moved onto the FIRST-sorted variant (the other one required) ⇒ still required, same stackDigest (every variant, not the first)', () => {
    const a = "  use-sync-external-store@1.2.0(react@17.0.2):\n    dependencies:\n      react: 17.0.2\n\n";
    const b = "  use-sync-external-store@1.2.0(react@18.2.0):\n    dependencies:\n      react: 18.2.0\n    optional: true\n\n";
    const a2 = "  use-sync-external-store@1.2.0(react@17.0.2):\n    dependencies:\n      react: 17.0.2\n    optional: true\n\n";
    const b2 = "  use-sync-external-store@1.2.0(react@18.2.0):\n    dependencies:\n      react: 18.2.0\n\n";
    const moved = fixtureLock.replace(a + b, a2 + b2);
    expect(moved).not.toBe(fixtureLock);
    const r = extractStackManifest(treeWith('variant-flag', moved), REVISION);
    expect(node(r.manifest, 'npm:use-sync-external-store@1.2.0')!.optional).toBe(false);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
  });

  it('CRLF line endings + a UTF-8 BOM ⇒ same stackDigest', () => {
    const r = extractStackManifest(treeWith('crlf', `\uFEFF${fixtureLock.replace(/\n/g, '\r\n')}`), REVISION);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
  });

  it('a specifier-only edit (rollup 4.18.0 → ^4.18.0, same resolved version) ⇒ same stackDigest, the edge spec changes', () => {
    const edited = fixtureLock.replace('        specifier: 4.18.0\n', '        specifier: ^4.18.0\n');
    expect(edited).not.toBe(fixtureLock);
    const r = extractStackManifest(treeWith('spec', edited), REVISION);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.edges.find((e) => e.to === 'npm:rollup@4.18.0')?.spec).toBe('^4.18.0');
    // the declared range is recorded in the QUARANTINED rootDeclared — visible, never hashed
    expect(golden.rootDeclared).toEqual([{ group: 'devDependencies', name: 'rollup', spec: '4.18.0' }]); // importer '.' only
    expect(r.manifest.rootDeclared).toEqual([{ group: 'devDependencies', name: 'rollup', spec: '^4.18.0' }]);
    expect(r.manifest.manifestDigest).not.toBe(golden.manifestDigest);
  });

  it('bumping ONLY the root package.json version ⇒ same stackDigest (the root version is quarantined); renaming the root moves it', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(FIXTURE_TREE, 'package.json'), 'utf8')) as Record<string, unknown>;
    const bumped = extractStackManifest(treeWith('root-bump', fixtureLock, { ...rootPkg, version: '9.9.9' }), REVISION);
    expect(bumped.refusals).toEqual([]);
    const root = bumped.manifest.nodes.find((n) => n.root)!;
    expect(root).toMatchObject({ id: 'npm:synth-workspace-root@9.9.9', version: '9.9.9', root: true }); // the manifest keeps the real id…
    expect(bumped.manifest.stackDigest).toBe(golden.stackDigest); // …the digest does not see it
    expect(bumped.manifest.manifestDigest).not.toBe(golden.manifestDigest);
    const renamed = extractStackManifest(treeWith('root-rename', fixtureLock, { ...rootPkg, name: 'another-root' }), REVISION);
    expect(renamed.manifest.stackDigest).not.toBe(golden.stackDigest);
  });

  it('a different revision of the same closure ⇒ same stackDigest', () => {
    expect(extractStackManifest(FIXTURE_TREE, 'another-revision').manifest.stackDigest).toBe(golden.stackDigest);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. positive controls                                                        */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 4: a real closure change moves the digest', () => {
  it('is-number 7.0.0 → 7.0.1 ⇒ different stackDigest, exactly one node differs', () => {
    const edited = fixtureLock
      .replace(/^ {2}is-number@7\.0\.0:/gm, '  is-number@7.0.1:')
      .replace("        specifier: 'catalog:'\n        version: 7.0.0\n", "        specifier: 'catalog:'\n        version: 7.0.1\n");
    const r = extractStackManifest(treeWith('bump', edited), REVISION);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest);
    const before = new Set(golden.nodes.map((n) => `${n.id}|${n.integrity}`));
    const after = new Set(r.manifest.nodes.map((n) => `${n.id}|${n.integrity}`));
    expect([...after].filter((x) => !before.has(x)).map((x) => x.split('|')[0])).toEqual(['npm:is-number@7.0.1']);
    expect([...before].filter((x) => !after.has(x)).map((x) => x.split('|')[0])).toEqual(['npm:is-number@7.0.0']);
  });

  it('one integrity character flipped ⇒ different stackDigest (rewritten tarball, same name@version)', () => {
    const integrity = node(golden, 'npm:ws@8.17.0')!.integrity!;
    const at = 'sha512-'.length + 3;
    const target = `${integrity.slice(0, at)}${integrity[at] === 'A' ? 'B' : 'A'}${integrity.slice(at + 1)}`;
    const edited = fixtureLock.replace(integrity, target);
    expect(edited).not.toBe(fixtureLock);
    const r = extractStackManifest(treeWith('integrity', edited), REVISION);
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest);
    expect(node(r.manifest, 'npm:ws@8.17.0')!.integrity).toBe(target);
  });

  it('what the reader cannot model still MOVES the stackDigest: patch hash, link target, git commit, alias name, unpinned tarball URL', () => {
    const digest = (label: string, text: string, files: Record<string, string> = {}): string => {
      const r = extractStackManifest(treeWith(label, text, undefined, files), REVISION);
      expect(r.refusals, label).toEqual([]);
      return r.manifest.stackDigest;
    };
    expect(golden.unmodeled.map((u) => `${u.reason}:${u.key}`)).toEqual([
      'npm-alias:importers/packages/app/dependencies/sw-cjs',
      'link:importers/packages/app/dependencies/synth-lib',
      'local-or-git:packages/is-positive@https://codeload.github.com/kevva/is-positive/tar.gz/97edff6f525f192a3f83cea1944765f769ae2678',
      'pnpm-patched:patchedDependencies/is-odd@3.0.1',
    ]);
    const moved = [
      digest('patch', fixtureLock.replace(/1a72dd5d/g, '2b72dd5d')),
      digest('link', relinkLibToOther(fixtureLock)),
      digest('commit', fixtureLock.replace(/97edff6f525f192a3f83cea1944765f769ae2678/g, '07edff6f525f192a3f83cea1944765f769ae2678')),
      digest('alias', fixtureLock.replace('      sw-cjs:\n', '      sw-esm:\n'), appManifestRenaming('sw-cjs', 'sw-esm')),
    ];
    for (const d of moved) expect(d).not.toBe(golden.stackDigest);
    expect(new Set(moved).size).toBe(moved.length);
    // a registry package WITHOUT integrity is identified by its tarball URL: the URL is hashed
    const integrity = node(golden, 'npm:ws@8.17.0')!.integrity!;
    const unpinned = (url: string): string => fixtureLock.replace(`{integrity: ${integrity}}`, `{tarball: ${url}}`);
    const a = extractStackManifest(treeWith('unpinned-a', unpinned('https://registry.example/ws-8.17.0.tgz')), REVISION).manifest;
    const b = extractStackManifest(treeWith('unpinned-b', unpinned('https://mirror.example/ws-8.17.0.tgz')), REVISION).manifest;
    expect(node(a, 'npm:ws@8.17.0')).toMatchObject({ integrity: null, resolvedWhenUnpinned: 'https://registry.example/ws-8.17.0.tgz' });
    expect(a.stackDigest).not.toBe(b.stackDigest);
    expect(a.stackDigest).not.toBe(golden.stackDigest);
    // …while a PINNED package's tarball URL is not an identity input
    const pinnedWithUrl = fixtureLock.replace(`{integrity: ${integrity}}`, `{integrity: ${integrity}, tarball: https://mirror.example/ws-8.17.0.tgz}`);
    expect(digest('pinned-url', pinnedWithUrl)).toBe(golden.stackDigest);
  });

  it('a required variant turning optional (the LAST required variant) ⇒ the node flag and the digest move', () => {
    const edited = fixtureLock.replace(
      '  use-sync-external-store@1.2.0(react@17.0.2):\n    dependencies:\n      react: 17.0.2\n',
      '  use-sync-external-store@1.2.0(react@17.0.2):\n    dependencies:\n      react: 17.0.2\n    optional: true\n',
    );
    const r = extractStackManifest(treeWith('optional', edited), REVISION);
    expect(node(r.manifest, 'npm:use-sync-external-store@1.2.0')!.optional).toBe(true);
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. the subset reader                                                        */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 5: the YAML-subset reader', () => {
  it('reads exactly the shapes pnpm emits (and a few equivalents), into Maps — never objects', () => {
    const doc = parsePnpmLockSubset(
      [
        '# a full-line comment',
        "lockfileVersion: '9.0'",
        'packages:',
        '',
        "  '@scope/pkg@1.0.0':",
        '    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==, tarball: https://registry.example/pkg.tgz}',
        "    engines: {node: '>=18', npm: ^8.16.0 || >=10}",
        '    cpu: [x64, arm64]',
        '    os: []',
        '    deprecated: |-',
        '      # a hash-led FIRST body line',
        '      first line: with a colon   ',
        '      \ttab-led body line',
        '      # second line',
        '    bundledDependencies:',
        '      - one',
        "      - 'two'",
        '    sameIndentList:',
        '    - a',
        '    hasBin: true',
        '  __proto__@1.0.0: {}',
        '  "dq@1.0.0":',
        '    note: "tab\\tquote\\""',
        "    sq: 'it''s'",
      ].join('\n'),
    );
    expect(doc).toBeInstanceOf(Map);
    const pkgs = doc.get('packages') as PnpmYamlMap;
    expect([...pkgs.keys()]).toEqual(['@scope/pkg@1.0.0', '__proto__@1.0.0', 'dq@1.0.0']);
    const p = pkgs.get('@scope/pkg@1.0.0') as PnpmYamlMap;
    expect([...(p.get('resolution') as PnpmYamlMap).entries()]).toEqual([
      ['integrity', 'sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='],
      ['tarball', 'https://registry.example/pkg.tgz'],
    ]);
    expect((p.get('engines') as PnpmYamlMap).get('npm')).toBe('^8.16.0 || >=10');
    expect(p.get('cpu')).toEqual(['x64', 'arm64']);
    expect(p.get('os')).toEqual([]);
    // a block scalar is NOT a string (no identity position can read it). Inside the body a `#`-led line and
    // a TAB-led line are ordinary text; a body line keeps its trailing whitespace (content in a literal scalar)
    expect(p.get('deprecated')).toBeInstanceOf(PnpmBlockScalar);
    expect((p.get('deprecated') as PnpmBlockScalar).header).toBe('|-');
    expect((p.get('deprecated') as PnpmBlockScalar).text).toBe('# a hash-led FIRST body line\nfirst line: with a colon   \n\ttab-led body line\n# second line');
    expect(p.get('bundledDependencies')).toEqual(['one', 'two']);
    expect(p.get('sameIndentList')).toEqual(['a']);
    expect(p.get('hasBin')).toBe(true); // a PLAIN true is a boolean, exactly as a YAML parser types it
    expect((pkgs.get('__proto__@1.0.0') as PnpmYamlMap).size).toBe(0);
    expect((pkgs.get('dq@1.0.0') as PnpmYamlMap).get('note')).toBe('tab\tquote"');
    expect((pkgs.get('dq@1.0.0') as PnpmYamlMap).get('sq')).toBe("it's");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  const REFUSED: Array<[string, string, number, string]> = [
    ['an anchor', "a: &x 1\nb: 2\n", 1, 'anchor or alias in scalar'],
    ['an alias', "a: 1\nb: *x\n", 2, 'anchor or alias in scalar'],
    // the merge key is refused AS a merge key — with an alias, with an inline mapping, in block form, quoted
    ['a merge key with an alias in a flow map', 'a: {<<: *base}\n', 1, "merge key '<<'"],
    ['a merge key with an inline mapping in a flow map', 'a: {<<: {os: [linux]}, k: 1}\n', 1, "merge key '<<'"],
    ['a block merge key', "a:\n  k: 1\n  <<: {os: [linux]}\n", 3, "merge key '<<'"],
    ['a quoted merge key', "a:\n  '<<': {os: [linux]}\n", 2, "merge key '<<'"],
    ['trailing content after a flow mapping', 'a: {x: 1} junk\n', 1, 'trailing content after a value (inline comment or multi-line collection)'],
    ['trailing content after a quoted scalar', "a: 'x' junk\n", 1, 'trailing content after a value (inline comment or multi-line collection)'],
    ['a flow collection nested deeper than 8', `a: ${'['.repeat(10)}x${']'.repeat(10)}\n`, 1, 'flow collection nested deeper than 8'],
    ['a tag', 'a: !!str 1\n', 1, 'tag in scalar'],
    ['tab indentation', "a:\n\tb: 1\n", 2, 'tab indentation'],
    ['a second document', "a: 1\n---\nb: 2\n", 2, 'document marker or directive (multi-document stream)'],
    ['a duplicate key', "a:\n  k: 1\n  k: 2\n", 3, "duplicate key 'k'"],
    ['a duplicate flow key', 'a: {k: 1, k: 2}\n', 1, "duplicate key 'k'"],
    ['an inline comment', 'a: 1 # why\n', 1, 'inline comment in scalar'],
    ['a multi-line flow mapping', "a: {k: 1,\n  j: 2}\n", 1, 'unterminated or multi-line flow mapping'],
    ['a multi-line flow sequence', "a: [x,\n  y]\n", 1, 'unterminated or multi-line flow sequence'],
    ['a multi-line plain scalar', "a: one\n  two\n", 2, 'multi-line plain scalar or mis-indented entry'],
    ['a multi-line quoted scalar', "a: 'one\n  two'\n", 1, 'unterminated or multi-line single-quoted scalar'],
    ['a complex key', "? a\n: 1\n", 1, 'complex mapping key'],
    ['a mapping inside a sequence item', "a:\n  - k: 1\n", 2, 'mapping inside a block sequence item'],
    ['a dedent to a column no block owns', "a:\n    b: 1\n  c: 2\n", 3, 'inconsistent indentation'],
    ['a YAML escape outside the JSON string grammar', 'a: "\\x41"\n', 1, 'double-quoted scalar uses an escape outside the JSON string grammar'],
    ['a top-level sequence', '- a\n', 1, 'top-level sequence (a lockfile is a mapping)'],
    ['a line that is not key: value', "a:\n  just words\n", 2, 'line is not a `key: value` mapping entry'],
  ];
  for (const [label, text, line, reason] of REFUSED) {
    it(`refuses ${label} with its line number — never a partial read`, () => {
      let caught: unknown;
      try {
        parsePnpmLockSubset(text);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(PnpmLockSubsetError);
      expect({ line: (caught as PnpmLockSubsetError).line, reason: (caught as PnpmLockSubsetError).reason }).toEqual({ line, reason });
      expect(readPnpmLock(text, { name: 'x', version: '1.0.0' })).toEqual({ derived: null, refusals: [stackRefusalPnpmSubset(line, reason)] });
    });
  }

  it('splitPnpmKey: scoped names, peer suffixes, patch hashes, URL versions', () => {
    expect(splitPnpmKey('@scope/name@1.2.3(react@18.2.0)(patch_hash=ab)')).toEqual({ name: '@scope/name', version: '1.2.3', pkgKey: '@scope/name@1.2.3' });
    expect(splitPnpmKey('plain@1.0.0-rc.1+build')).toEqual({ name: 'plain', version: '1.0.0-rc.1+build', pkgKey: 'plain@1.0.0-rc.1+build' });
    expect(splitPnpmKey('git@https://host/x/tar.gz/abc')?.version).toBe('https://host/x/tar.gz/abc');
    expect(splitPnpmKey('@scope/only')).toBeNull();
    expect(splitPnpmKey('trailing@')).toBeNull();
  });

  const DERIVE_DOC = [
    "lockfileVersion: '9.0'",
    'importers:',
    '  .:',
    '    dependencies:',
    '      kept: {specifier: ^1.0.0, version: 1.0.0}',
    '      local: {specifier: file:../local, version: file:../local}',
    'packages:',
    '  kept@1.0.0:',
    '    resolution: {integrity: sha512-KEPTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
    '    libc: [glibc]',
    '    os: [linux]',
    '  local@file:../local:',
    '    resolution: {directory: ../local, type: directory}',
    '  gitdep@1.0.0:',
    '    resolution: {type: git, repo: https://host/x.git, commit: abc}',
    '  nointegrity@2.0.0:',
    '    resolution: {tarball: https://registry.example/n.tgz}',
    '  orphan@3.0.0:',
    '    resolution: {integrity: sha512-ORPHANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
    '  nosnap@5.0.0:',
    '    resolution: {integrity: sha512-NOSNAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
    'snapshots:',
    '  kept@1.0.0:',
    '    dependencies:',
    '      nointegrity: 2.0.0',
    '  local@file:../local: {}',
    '  nointegrity@2.0.0: {}',
    '  orphan@3.0.0: {}',
    'futureSection: {k: v}',
  ].join('\n');
  const derive = (text: string) => deriveFromPnpmLockV9(parsePnpmLockSubset(text), { name: null, version: null });
  const opaqueOf = (text: string, key: string): PnpmUnmodeled | undefined => derive(text).unmodeled.find((u) => u.key === key);

  it('derivation: file:/directory/git resolutions and unread sections are OPAQUE hashed entries (no node); a missing integrity hashes the tarball URL', () => {
    const d = derive(DERIVE_DOC);
    expect(d.malformed).toEqual([]);
    expect(d.hollow).toBeNull();
    expect(d.nodes.map((n) => `${n.id}|${n.integrity}|${n.resolvedWhenUnpinned}`)).toEqual([
      'npm:root@0.0.0|null|null',
      'npm:kept@1.0.0|sha512-KEPTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==|null',
      'npm:nointegrity@2.0.0|null|https://registry.example/n.tgz',
      'npm:nosnap@5.0.0|sha512-NOSNAPAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==|null',
      'npm:orphan@3.0.0|sha512-ORPHANAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==|null',
    ]);
    expect(d.nodes.find((n) => n.name === 'kept')!.platformConditional).toEqual({ os: ['linux'], cpu: [] });
    expect(d.unmodeled.map((u) => `${u.key}|${u.reason}|${u.spec.resolved}`)).toEqual([
      'packages/gitdep@1.0.0|local-or-git|https://host/x.git#abc',
      'packages/local@file:../local|local-or-git|../local',
      'sections/futureSection|pnpm-unread-section|null',
    ]);
    const nonRegistry = (k: string): string =>
      `pnpm package '${k}': non-registry resolution (tarball URL / git / file: / directory) — no locked registry identity in this slice; hashed as an opaque entry, no node`;
    expect([...d.unsupported].sort()).toEqual(
      [
        STACK_COVERAGE_PNPM_DERIVED_FLAGS,
        STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS,
        STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS,
        "pnpm-lock top-level section 'futureSection' is not read: hashed as an opaque entry",
        'root package has no name/version in package.json: identity defaulted',
        nonRegistry('local@file:../local'),
        nonRegistry('gitdep@1.0.0'),
        "pnpm package 'kept@1.0.0' declares a libc condition: not representable in platformConditional (os/cpu kept)",
        "pnpm package 'nointegrity@2.0.0' has no integrity: its tarball URL is hashed instead",
        "pnpm package 'nosnap@5.0.0' has no snapshot: kept, flags defaulted",
        "pnpm package 'orphan@3.0.0' is not reachable from any importer: kept, dev/peer defaulted false",
      ].sort(),
    );
  });

  it('an opaque entry MOVES when what it cannot model moves: git commit, link target, alias name, patch hash, unread section, unpinned tarball', () => {
    // git commit
    expect(opaqueOf(DERIVE_DOC.replace('commit: abc', 'commit: abd'), 'packages/gitdep@1.0.0')!.entrySha256).not.toBe(opaqueOf(DERIVE_DOC, 'packages/gitdep@1.0.0')!.entrySha256);
    expect(opaqueOf(DERIVE_DOC.replace('commit: abc', 'commit: abd'), 'packages/gitdep@1.0.0')!.spec.resolved).toBe('https://host/x.git#abd');
    // unread section content
    expect(opaqueOf(DERIVE_DOC.replace('{k: v}', '{k: w}'), 'sections/futureSection')!.entrySha256).not.toBe(opaqueOf(DERIVE_DOC, 'sections/futureSection')!.entrySha256);
    // …but NOT when only the key order inside it changes (canonical bytes, not file bytes)
    expect(canonicalPnpmValue(parsePnpmLockSubset('a: {x: 1, y: [p, q]}\nb: z\n'))).toBe(canonicalPnpmValue(parsePnpmLockSubset("b: 'z'\na:\n    y:\n        - p\n        - q\n    x: '1'\n")));
    // an unpinned registry tarball is part of the node identity
    expect(derive(DERIVE_DOC.replace('n.tgz', 'm.tgz')).nodes.find((n) => n.name === 'nointegrity')!.resolvedWhenUnpinned).toBe('https://registry.example/m.tgz');
    // the fixture: link target, alias name, patch hash
    const fx = (text: string, key: string): PnpmUnmodeled => readPnpmLock(text, { name: 'x', version: '1.0.0' }).derived!.unmodeled.find((u) => u.key === key)!;
    const LINK = 'importers/packages/app/dependencies/synth-lib';
    const PATCH = 'patchedDependencies/is-odd@3.0.1';
    expect(readPnpmLock(fixtureLock, { name: 'x', version: '1.0.0' }).derived!.unmodeled.map((u) => `${u.reason}:${u.key}`)).toEqual([
      'npm-alias:importers/packages/app/dependencies/sw-cjs',
      `link:${LINK}`,
      'local-or-git:packages/is-positive@https://codeload.github.com/kevva/is-positive/tar.gz/97edff6f525f192a3f83cea1944765f769ae2678',
      `pnpm-patched:${PATCH}`,
    ]);
    expect(fx(relinkLibToOther(fixtureLock), LINK)).toMatchObject({ spec: { version: 'link:../other', link: true } });
    expect(fx(relinkLibToOther(fixtureLock), LINK).entrySha256).not.toBe(fx(fixtureLock, LINK).entrySha256);
    const repatched = fixtureLock.replace(/1a72dd5d/g, '2b72dd5d');
    expect(fx(repatched, PATCH).spec.integrity).toMatch(/^2b72dd5d/);
    expect(fx(repatched, PATCH).entrySha256).not.toBe(fx(fixtureLock, PATCH).entrySha256);
    const renamed = fixtureLock.replace('      sw-cjs:\n', '      sw-esm:\n');
    expect(fx(renamed, 'importers/packages/app/dependencies/sw-esm').reason).toBe('npm-alias');
    expect(readPnpmLock(renamed, { name: 'x', version: '1.0.0' }).derived!.unmodeled.some((u) => u.key.endsWith('/sw-cjs'))).toBe(false);
  });

  it('flags are merged across EVERY variant and EVERY importer: one prod-reachable variant makes the package non-dev, whatever the order', () => {
    const doc = (importers: string[]): string =>
      [
        "lockfileVersion: '9.0'",
        'importers:',
        ...importers,
        'packages:',
        '  a@1.0.0: {resolution: {integrity: sha512-A1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}}',
        '  a@2.0.0: {resolution: {integrity: sha512-A2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}}',
        '  p@1.0.0:',
        '    resolution: {integrity: sha512-PAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
        '    peerDependencies: {a: "*"}',
        'snapshots:',
        '  a@1.0.0: {}',
        '  a@2.0.0: {}',
        '  p@1.0.0(a@1.0.0):',
        '    dependencies: {a: 1.0.0}',
        '  p@1.0.0(a@2.0.0):',
        '    dependencies: {a: 2.0.0}',
      ].join('\n');
    const devImporter = ['  tools:', '    devDependencies:', '      p: {specifier: 1.0.0, version: 1.0.0(a@1.0.0)}'];
    const prodImporter = ['  app:', '    dependencies:', '      p: {specifier: 1.0.0, version: 1.0.0(a@2.0.0)}'];
    const flags = (text: string): string[] => derive(text).nodes.map((n) => `${n.id} dev=${n.dev} peer=${n.peer}`);
    const expected = ['npm:root@0.0.0 dev=false peer=false', 'npm:a@1.0.0 dev=true peer=true', 'npm:a@2.0.0 dev=false peer=true', 'npm:p@1.0.0 dev=false peer=false'];
    expect(flags(doc([...devImporter, ...prodImporter]))).toEqual(expected);
    expect(flags(doc([...prodImporter, ...devImporter]))).toEqual(expected); // importer order is not an input
    expect(flags(doc(devImporter))).toEqual(['npm:root@0.0.0 dev=false peer=false', 'npm:a@1.0.0 dev=true peer=true', 'npm:a@2.0.0 dev=false peer=false', 'npm:p@1.0.0 dev=true peer=false']);
  });

  it('empty strings never reach the strict schema: an empty root name/version defaults, an empty dependency version is the fixed malformed refusal', () => {
    const emptyRoot = deriveFromPnpmLockV9(parsePnpmLockSubset(DERIVE_DOC), { name: '', version: '' });
    expect(emptyRoot.nodes[0]).toMatchObject({ id: 'npm:root@0.0.0', name: 'root', version: '0.0.0', root: true });
    expect(emptyRoot.unsupported).toContain('root package has no name/version in package.json: identity defaulted');
    const d = treeWith('empty-root', fixtureLock, { name: '', version: '', packageManager: 'pnpm@10.11.1' });
    expect(() => extractStackManifest(d, REVISION)).not.toThrow();
    expect(extractStackManifest(d, REVISION).refusals).toEqual([]);
    const r = readPnpmLock(DERIVE_DOC.replace('version: 1.0.0}', "version: ''}"), { name: 'x', version: '1.0.0' });
    expect(r).toEqual({ derived: null, refusals: [stackRefusalPnpmMalformed("importer . dependency 'kept' (version '' names no snapshot)")] });
    const k = readPnpmLock(DERIVE_DOC.replace('  nosnap@5.0.0:', "  'nosnap@':"), { name: 'x', version: '1.0.0' });
    expect(k.refusals).toContain(stackRefusalPnpmMalformed("packages entry 'nosnap@' (not a 'name@version' mapping)"));
  });

  it('a lockfile the reader cannot trust is REFUSED whole — never a skipped entry', () => {
    const cases: Array<[string, string, string]> = [
      ['a dangling snapshot dependency', DERIVE_DOC.replace('      nointegrity: 2.0.0', '      nointegrity: 2.0.0\n      missing: 9.9.9'), "snapshot kept@1.0.0 dependency 'missing' (version '9.9.9' names no snapshot)"],
      ['a dangling importer dependency', DERIVE_DOC.replace('version: 1.0.0}', 'version: 1.0.1}'), "importer . dependency 'kept' (version '1.0.1' names no snapshot)"],
      ['a snapshot no package names', `${DERIVE_DOC.replace('futureSection: {k: v}', '')}`.replace('  orphan@3.0.0: {}', '  orphan@3.0.0: {}\n  ghost@4.0.0: {}'), "snapshots entry 'ghost@4.0.0' (no packages entry names it)"],
      ['a packages key that is not name@version', DERIVE_DOC.replace('  nosnap@5.0.0:', '  nosnap:'), "packages entry 'nosnap' (not a 'name@version' mapping)"],
      ['a package with neither integrity nor tarball', DERIVE_DOC.replace('{tarball: https://registry.example/n.tgz}', '{}'), "packages entry 'nointegrity@2.0.0' (no integrity and no tarball to name it)"],
    ];
    for (const [label, text, what] of cases) {
      const r = readPnpmLock(text, { name: 'x', version: '1.0.0' });
      expect(r.derived, label).toBeNull();
      expect(r.refusals, label).toContain(stackRefusalPnpmMalformed(what));
      expect(r.refusals.every((m) => m.endsWith('is malformed: refused, never a partial manifest')), label).toBe(true);
    }
  });

  it('the reader is pure and dependency-free: relative imports only (no node:fs, no YAML library)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'stack', 'pnpm-lock-reader.ts'), 'utf8');
    const specifiers = [...src.matchAll(/^import\s[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['node:crypto', './stack-manifest.js']);
    expect(src).not.toMatch(/require\(|import\(/);
  });
});

/* -------------------------------------------------------------------------- */
/* 6. refusals + precedence                                                    */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 6: refusals and lockfile precedence', () => {
  const pkg = { name: 'example-app', version: '1.2.3' };

  it('lockfileVersion: v6 / v5 (unquoted number) / unknown / absent each refuse with their own fixed string', () => {
    expect(stackRefusalPnpmLockfileVersion('6.0')).toBe(
      "pnpm lockfileVersion 6.0 is not 9.0: pnpm v5/v6 lockfiles are refused (packages are keyed by '/name@version' path with inline snapshots, not the importers/packages/snapshots split); regenerate with pnpm >= 9",
    );
    expect(stackRefusalPnpmLockfileVersion('10.0')).toBe('pnpm lockfileVersion 10.0 is not 9.0: unknown pnpm lockfile format refused; no stack facts extracted');
    for (const [text, v] of [
      ["lockfileVersion: '6.0'\nimporters:\n  .: {}\n", '6.0'],
      ['lockfileVersion: 5.4\nimporters:\n  .: {}\n', '5.4'],
      ["lockfileVersion: '10.0'\nimporters:\n  .: {}\n", '10.0'],
      ['importers:\n  .: {}\n', null],
    ] as Array<[string, string | null]>) {
      const r = extractStackManifest(treeWith('ver', text, pkg), 'unpinned');
      expect(r.refusals).toEqual([stackRefusalPnpmLockfileVersion(v), STACK_REFUSAL_NO_LOCKFILE]);
      expect(r.manifest.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual(['npm:example-app@1.2.3']);
    }
  });

  it('a HOLLOW v9 lockfile (no importers / no packages / no snapshots) is refused: exit 2, nothing written', () => {
    const head = "lockfileVersion: '9.0'\n";
    const imp = 'importers:\n  .:\n    dependencies:\n      a: {specifier: 1.0.0, version: 1.0.0}\n';
    const pkgs = 'packages:\n  a@1.0.0: {resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}}\n';
    const cases: Array<[string, string]> = [
      [head, "no 'importers' mapping"],
      [`${head}importers: {}\n${pkgs}snapshots:\n  a@1.0.0: {}\n`, "no 'importers' mapping"],
      // an importer DECLARES a dependency and the closure is missing: a lost closure, never a green root
      [`${head}${imp}`, "no 'packages' mapping"],
      [`${head}${imp}packages: {}\nsnapshots: {}\n`, "no 'packages' mapping"],
      [`${head}${imp}packages:\nsnapshots:\n`, "no 'packages' mapping"],
      [`${head}importers:\n  .: {}\n${pkgs}`, "no 'snapshots' mapping"],
    ];
    for (const [text, why] of cases) {
      const r = extractStackManifest(treeWith('hollow', text, pkg), 'unpinned');
      expect(r.refusals, why).toEqual([stackRefusalPnpmHollow(why), STACK_REFUSAL_NO_LOCKFILE]);
      expect(r.manifest.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual(['npm:example-app@1.2.3']);
    }
    // a root plus ONLY an opaque entry is accepted: the entry is hashed, so the closure is not empty
    const onlyOpaque = extractStackManifest(
      treeWith('only-opaque', `${head}importers:\n  .: {}\npackages:\n  g@file:../g: {resolution: {directory: ../g, type: directory}}\nsnapshots:\n  g@file:../g: {}\n`, pkg),
      'unpinned',
    );
    expect(onlyOpaque.refusals).toEqual([]);
    expect(onlyOpaque.manifest.unmodeled.map((u) => u.key)).toEqual(['packages/g@file:../g']);
    // the positive control: the same skeleton WITH a closure is accepted
    expect(extractStackManifest(treeWith('not-hollow', `${head}${imp}${pkgs}snapshots:\n  a@1.0.0: {}\n`, pkg), 'unpinned').refusals).toEqual([]);
    const d = treeWith('hollow-cli', `${head}${imp}`, pkg);
    const out = path.join(d, 'never-written.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain(stackRefusalPnpmHollow("no 'packages' mapping"));
    expect(fs.existsSync(out)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('a SYMLINKED pnpm-lock.yaml is never followed: refusal, exit 2, nothing written — even when its target is a perfectly good lockfile', () => {
    const d = tmp('symlink');
    const outside = tmp('symlink-target');
    fs.writeFileSync(path.join(outside, 'real-lock.yaml'), fixtureLock);
    fs.writeFileSync(path.join(d, 'package.json'), fs.readFileSync(path.join(FIXTURE_TREE, 'package.json')));
    fs.symlinkSync(path.join(outside, 'real-lock.yaml'), path.join(d, 'pnpm-lock.yaml'));
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([stackRefusalSymlink('pnpm-lock.yaml'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm')).toHaveLength(1);
    expect(r.manifest.sources.map((s) => s.path)).not.toContain('pnpm-lock.yaml');
    // an in-tree symlink is refused too (the link itself is not a regular file of the revision)
    const d2 = treeWith('symlink-inside', fixtureLock);
    fs.renameSync(path.join(d2, 'pnpm-lock.yaml'), path.join(d2, 'moved.yaml'));
    fs.symlinkSync('moved.yaml', path.join(d2, 'pnpm-lock.yaml'));
    expect(extractStackManifest(d2, 'unpinned').refusals[0]).toBe(stackRefusalSymlink('pnpm-lock.yaml'));
    // the package.json that decides lockfile precedence is guarded the same way
    const d3 = treeWith('symlink-pkg', fixtureLock);
    fs.renameSync(path.join(d3, 'package.json'), path.join(outside, 'package.json'));
    fs.symlinkSync(path.join(outside, 'package.json'), path.join(d3, 'package.json'));
    expect(extractStackManifest(d3, 'unpinned').refusals).toContain(stackRefusalSymlink('package.json'));
    const out = path.join(d, 'never-written.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain("stack source 'pnpm-lock.yaml' is a symbolic link");
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a lockfile outside the subset is refused WHOLE through the extractor and the CLI: exit 2, the line in stderr, nothing written', () => {
    const broken = fixtureLock.replace('  ws@8.17.0: {}\n', '  ws@8.17.0: &anchored {}\n');
    expect(broken).not.toBe(fixtureLock);
    const d = treeWith('subset', broken);
    const r = extractStackManifest(d, 'unpinned');
    const line = broken.split('\n').findIndex((l) => l.includes('&anchored')) + 1;
    expect(r.refusals).toEqual([stackRefusalPnpmSubset(line, 'anchor or alias in scalar'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm')).toHaveLength(1); // root only — no half-read closure
    const out = path.join(d, 'never-written.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain(`lockfile 'pnpm-lock.yaml' line ${line}: anchor or alias in scalar`);
    expect(fs.existsSync(out)).toBe(false);
  });

  it('packageManager: pnpm@… ⇒ pnpm-lock.yaml is the closure and a stray package-lock.json is a recorded ignore', () => {
    const d = treeWith('stray-npm', fixtureLock);
    fs.writeFileSync(path.join(d, 'package-lock.json'), JSON.stringify({ name: 'stray', version: '0.0.0', lockfileVersion: 3, packages: { '': { name: 'stray', version: '0.0.0' } } }));
    const r = extractStackManifest(d, REVISION);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.sources.map((s) => s.path)).not.toContain('package-lock.json');
    expect(r.manifest.coverage.unsupported).toContain(
      stackCoverageLockfileIgnored('package-lock.json', 'package.json packageManager declares pnpm — pnpm-lock.yaml is the declared closure'),
    );
  });

  it('packageManager: pnpm@… with a REFUSED pnpm-lock never falls back to the stray npm lockfile', () => {
    const d = treeWith('no-fallback', "lockfileVersion: '6.0'\nimporters:\n  .: {}\n");
    fs.writeFileSync(
      path.join(d, 'package-lock.json'),
      JSON.stringify({ name: 'stray', version: '0.0.0', lockfileVersion: 3, packages: { '': { name: 'stray', version: '0.0.0' }, 'node_modules/zod': { version: '4.6.5', integrity: 'sha512-x' } } }),
    );
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([stackRefusalPnpmLockfileVersion('6.0'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(r.manifest.nodes.some((n) => n.name === 'zod')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. cross-family                                                             */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 7: one closure, two lockfile families', () => {
  const integrity = 'sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==';

  it('a flag-free closure (is-number@7.0.0) locked by npm v3 and by pnpm v9 ⇒ the SAME stackDigest (the lockfile family is quarantined)', () => {
    const pkg = { name: 'example-app', version: '1.2.3', dependencies: { 'is-number': '7.0.0' } };
    const npmDir = tmp('family-npm');
    fs.writeFileSync(path.join(npmDir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(
      path.join(npmDir, 'package-lock.json'),
      JSON.stringify({
        name: 'example-app',
        version: '1.2.3',
        lockfileVersion: 3,
        packages: {
          '': { name: 'example-app', version: '1.2.3', dependencies: { 'is-number': '7.0.0' } },
          'node_modules/is-number': { version: '7.0.0', resolved: 'https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz', integrity },
        },
      }),
    );
    const pnpmDir = tmp('family-pnpm');
    fs.writeFileSync(path.join(pnpmDir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(
      path.join(pnpmDir, 'pnpm-lock.yaml'),
      `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      is-number:\n        specifier: 7.0.0\n        version: 7.0.0\n\npackages:\n\n  is-number@7.0.0:\n    resolution: {integrity: ${integrity}}\n\nsnapshots:\n\n  is-number@7.0.0: {}\n`,
    );
    const a = extractStackManifest(npmDir, 'r');
    const b = extractStackManifest(pnpmDir, 'r');
    expect(a.refusals).toEqual([]);
    expect(b.refusals).toEqual([]);
    expect(a.manifest.sources.map((s) => s.parser)).toContain('npm-lockfile-v3');
    expect(b.manifest.sources.map((s) => s.parser)).toContain('pnpm-lockfile-v9');
    expect(b.manifest.stackDigest).toBe(a.manifest.stackDigest);
    expect(b.manifest.nodes.map(({ layout, ...n }) => (void layout, n))).toEqual(a.manifest.nodes.map(({ layout, ...n }) => (void layout, n)));
  });
});

/* -------------------------------------------------------------------------- */
/* 8. adversarial-review round 1 — every finding pinned by NAME                 */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 8: typed scalars, the merge key, and the safety lines', () => {
  const ROOT_ID = { name: 'r', version: '1.0.0' };
  const wsIntegrity = node(golden, 'npm:ws@8.17.0')!.integrity!;
  const flowRes = `    resolution: {integrity: ${wsIntegrity}}\n`;
  const mini = (extra: { pkgs?: string; snaps?: string; imp?: string; head?: string; tail?: string } = {}): string =>
    [
      extra.head ?? "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      extra.imp ?? '    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}',
      'packages:',
      '  a@1.0.0:',
      '    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
      ...(extra.pkgs ? [extra.pkgs] : []),
      'snapshots:',
      '  a@1.0.0: {}',
      ...(extra.snaps ? [extra.snaps] : []),
      ...(extra.tail ? [extra.tail] : []),
      '',
    ].join('\n');
  const refusalsOf = (text: string): string[] => readPnpmLock(text, ROOT_ID).refusals;

  /* ---- MAJOR-1: YAML null is ABSENT, never the string "null" ---- */
  for (const spelling of ['null', 'Null', 'NULL', '~', '']) {
    it(`integrity: ${spelling === '' ? '(empty value)' : spelling} is ABSENT ⇒ the tarball URL is hashed: two URLs for ws@8.17.0 never share a stackDigest`, () => {
      expect(fixtureLock).toContain(flowRes);
      const unpinned = (url: string): string =>
        fixtureLock.replace(flowRes, `    resolution:\n      integrity:${spelling === '' ? '' : ` ${spelling}`}\n      tarball: ${url}\n`);
      const a = extractStackManifest(treeWith('null-a', unpinned('https://registry.example/ws-8.17.0.tgz')), REVISION);
      const b = extractStackManifest(treeWith('null-b', unpinned('https://evil.example/ws-8.17.0.tgz')), REVISION);
      expect(a.refusals).toEqual([]);
      expect(b.refusals).toEqual([]);
      expect(node(a.manifest, 'npm:ws@8.17.0')).toMatchObject({ integrity: null, resolvedWhenUnpinned: 'https://registry.example/ws-8.17.0.tgz' });
      expect(node(b.manifest, 'npm:ws@8.17.0')).toMatchObject({ integrity: null, resolvedWhenUnpinned: 'https://evil.example/ws-8.17.0.tgz' });
      expect(a.manifest.stackDigest).not.toBe(b.manifest.stackDigest);
      if (spelling !== '') {
        // the flow spelling of the same thing
        const flow = (url: string): string => fixtureLock.replace(flowRes, `    resolution: {integrity: ${spelling}, tarball: ${url}}\n`);
        const fa = extractStackManifest(treeWith('null-fa', flow('https://registry.example/ws-8.17.0.tgz')), REVISION);
        expect(fa.refusals).toEqual([]);
        expect(fa.manifest.stackDigest).toBe(a.manifest.stackDigest);
      }
    });
  }

  it('typed plain scalars: null spellings are null, true/false spellings are booleans, QUOTED ones stay strings, numbers stay strings', () => {
    const doc = parsePnpmLockSubset("a: null\nb: ~\nc:\nd: 'null'\ne: True\nf: FALSE\ng: 'true'\nh: 9.0\ni: [~, true, 'x']\nj: {k: NULL, l: false}\nm: nullish\n");
    expect([...doc.entries()].slice(0, 8)).toEqual([['a', null], ['b', null], ['c', null], ['d', 'null'], ['e', true], ['f', false], ['g', 'true'], ['h', '9.0']]);
    expect(doc.get('i')).toEqual([null, true, 'x']);
    expect([...(doc.get('j') as PnpmYamlMap).entries()]).toEqual([['k', null], ['l', false]]);
    expect(doc.get('m')).toBe('nullish');
    // and the canonical bytes keep a typed value apart from its quoted twin
    expect(canonicalPnpmValue(doc)).toContain('"a":null');
    expect(canonicalPnpmValue(doc)).toContain('"d":"null"');
    expect(canonicalPnpmValue(doc)).toContain('"e":true');
    expect(canonicalPnpmValue(doc)).toContain('"g":"true"');
  });

  it('integrity must be ONE sha1-/sha256-/sha384-/sha512- hash: anything else present is the fixed malformed refusal', () => {
    const bad = (value: string): string[] => refusalsOf(mini({ pkgs: `  b@1.0.0:\n    resolution: {integrity: ${value}, tarball: https://registry.example/b.tgz}`, snaps: '  b@1.0.0: {}' }));
    const expected = [stackRefusalPnpmMalformed("packages entry 'b@1.0.0' (integrity is not ONE sha1-/sha256-/sha384-/sha512- hash of its exact length)")];
    const b64 = (n: number, pad: string): string => `${'Ab+/'.repeat(n).slice(0, n)}${pad}`;
    const good = { sha1: `sha1-${b64(27, '=')}`, sha256: `sha256-${b64(43, '=')}`, sha384: `sha384-${b64(64, '')}`, sha512: `sha512-${b64(86, '==')}` };
    for (const v of ["'null'", 'md5-AAAA==', 'sha512-', 'sha512-AA AA', 'true', "''", `[${good.sha512}]`]) expect(bad(v), v).toEqual(expected);
    for (const v of Object.values(good)) expect(bad(v), v).toEqual([]);
    // the EXACT padded length of each digest: a truncated, over-long or unpadded value names no bytes
    const wrongLength = [
      'sha512-x',
      'sha1-AAAA',
      'sha256-AAAA=',
      'sha384-AA+/',
      `sha1-${b64(27, '')}`, // padding dropped
      `sha1-${b64(28, '=')}`,
      `sha256-${b64(43, '==')}`,
      `sha384-${b64(64, '=')}`,
      `sha512-${b64(86, '=')}`,
      `sha512-${b64(85, '==')}`,
      `sha512-${b64(87, '==')}`,
      `sha512-${b64(88, '')}`,
      `sha256-${b64(86, '==')}`, // a sha512-sized value under another algorithm's name
    ];
    for (const v of wrongLength) expect(bad(v), v).toEqual(expected);
    // a multi-hash SRI string is refused: pnpm writes the registry's single `dist.integrity` (or ONE sha1 from `shasum`)
    for (const v of [`${good.sha512} ${good.sha1}`, `'${good.sha512} ${good.sha1}'`, `${good.sha1} ${good.sha1}`]) expect(bad(v), v).toEqual(expected);
    // a non-string tarball / commit is a refusal too — never silently "absent"
    expect(refusalsOf(mini({ pkgs: '  b@1.0.0:\n    resolution: {tarball: true}', snaps: '  b@1.0.0: {}' }))).toEqual([
      stackRefusalPnpmMalformed("packages entry 'b@1.0.0' (resolution.tarball is not a string)"),
    ]);
  });

  /* ---- MAJOR-2: the merge key is refused through the whole path ---- */
  it('MAJOR-2 repro: an os list or `optional: true` smuggled in through `<<` is a whole-lockfile refusal, never a silently different node', () => {
    const osMerge = fixtureLock.replace(flowRes, `${flowRes}    <<: {os: [win32], cpu: [x64]}\n`);
    expect(osMerge).not.toBe(fixtureLock);
    const line = osMerge.split('\n').findIndex((l) => l.includes('<<:')) + 1;
    const r = extractStackManifest(treeWith('merge-os', osMerge), REVISION);
    expect(r.refusals).toEqual([stackRefusalPnpmSubset(line, "merge key '<<'"), STACK_REFUSAL_NO_LOCKFILE]);
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm')).toHaveLength(1); // the root only — and the CLI writes nothing on a refusal

    const optMerge = fixtureLock.replace(/^ {2}ws@8\.17\.0: \{\}$/m, '  ws@8.17.0:\n    <<: {optional: true}');
    expect(optMerge).not.toBe(fixtureLock);
    const line2 = optMerge.split('\n').findIndex((l) => l.includes('<<:')) + 1;
    expect(extractStackManifest(treeWith('merge-opt', optMerge), REVISION).refusals).toEqual([stackRefusalPnpmSubset(line2, "merge key '<<'"), STACK_REFUSAL_NO_LOCKFILE]);

    const out = path.join(tmp('merge-cli'), 'm.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', treeWith('merge-cli-tree', osMerge), '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain("merge key '<<'");
    expect(fs.existsSync(out)).toBe(false);
  });

  /* ---- MAJOR-3: the eleven safety lines ---- */
  it("R07: a packages entry carrying the ROOT's own identity is refused", () => {
    expect(refusalsOf(mini({ pkgs: '  r@1.0.0:\n    resolution: {integrity: sha512-RRRRAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}', snaps: '  r@1.0.0: {}' }))).toEqual([
      stackRefusalPnpmMalformed("packages entry 'r@1.0.0' (it carries the root package's own identity)"),
    ]);
  });

  it('R08: a patchedDependencies entry without a hash is refused (a patch changes the installed bytes; no hash ⇒ nothing names them)', () => {
    for (const entry of ['{path: patches/a.patch}', '{path: patches/a.patch, hash: ~}', '{path: patches/a.patch, hash: true}']) {
      expect(refusalsOf(mini({ tail: `patchedDependencies:\n  a@1.0.0: ${entry}` })), entry).toEqual([stackRefusalPnpmMalformed("patchedDependencies entry 'a@1.0.0' (no hash)")]);
    }
    expect(refusalsOf(mini({ tail: 'patchedDependencies:\n  a@1.0.0: {path: patches/a.patch, hash: abc123}' }))).toEqual([]);
  });

  it('R10: a non-ASCII package name is a HASHED opaque entry, never a node', () => {
    const text = mini({ pkgs: '  naïve@2.0.0:\n    resolution: {integrity: sha512-NNNNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}', snaps: '  naïve@2.0.0: {}' });
    const d = deriveFromPnpmLockV9(parsePnpmLockSubset(text), ROOT_ID);
    expect(d.malformed).toEqual([]);
    expect(d.nodes.map((n) => n.id)).toEqual(['npm:r@1.0.0', 'npm:a@1.0.0']);
    expect(d.unmodeled.map((u) => `${u.key}|${u.reason}|${u.spec.integrity}`)).toEqual(['packages/naïve@2.0.0|non-ascii-name|sha512-NNNNAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==']);
    expect(d.unsupported).toContain('non-ASCII package name at naïve@2.0.0: hashed as an opaque entry, no node (npm registry names are ASCII)');
  });

  it("R13: lockfileVersion is EXACTLY 9.0 (quoted or not) — '9', '9.1', '9.00', '09.0' and a boolean are other formats", () => {
    for (const head of ["lockfileVersion: '9.0'", 'lockfileVersion: 9.0', 'lockfileVersion: "9.0"']) expect(refusalsOf(mini({ head })), head).toEqual([]);
    for (const v of ['9', '9.1', '9.00', '09.0', '9.0.0', '10.0']) {
      expect(refusalsOf(mini({ head: `lockfileVersion: '${v}'` })), v).toEqual([`pnpm lockfileVersion ${v} is not 9.0: unknown pnpm lockfile format refused; no stack facts extracted`]);
    }
    for (const head of ['lockfileVersion: true', 'lockfileVersion: ~', 'lockfileVersion: [9.0]']) {
      expect(refusalsOf(mini({ head })), head).toEqual(["lockfile 'pnpm-lock.yaml' has no lockfileVersion: refused; no stack facts extracted"]);
    }
  });

  it('R18: flow nesting of exactly 8 is read; the cap is what refuses 9+ (see the refusal table)', () => {
    const doc = parsePnpmLockSubset(`a: ${'['.repeat(8)}x${']'.repeat(8)}\n`); // 8 collections, the scalar at depth 8
    let v: PnpmYamlValue = doc.get('a')!;
    let depth = 0;
    while (Array.isArray(v)) {
      v = v[0]!;
      depth++;
    }
    expect({ depth, leaf: v }).toEqual({ depth: 8, leaf: 'x' });
    expect(() => parsePnpmLockSubset(`a: ${'['.repeat(9)}x${']'.repeat(9)}\n`)).toThrow(PnpmLockSubsetError);
  });

  it('R19 + R20: a SNAPSHOT-level link: dependency and a snapshot-level npm: alias are HASHED opaque entries that move with their target', () => {
    const doc = (link: string, alias: string): string =>
      mini({
        pkgs: '  b@2.0.0:\n    resolution: {integrity: sha512-BBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}\n  c@3.0.0:\n    resolution: {integrity: sha512-CCCCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}',
        imp: '    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0(x@1)}',
        snaps: `  b@2.0.0: {}\n  c@3.0.0: {}\n  a@1.0.0(x@1):\n    dependencies:\n      local-lib: link:${link}\n      b-cjs: ${alias}`,
      }).replace('  a@1.0.0: {}\n', '');
    const derive = (t: string) => deriveFromPnpmLockV9(parsePnpmLockSubset(t), ROOT_ID);
    const base = derive(doc('../lib', 'b@2.0.0'));
    expect(base.malformed).toEqual([]);
    expect(base.unmodeled.map((u) => `${u.key}|${u.reason}|${u.spec.version}|${u.spec.link}`)).toEqual([
      'snapshots/a@1.0.0(x@1)/dependencies/b-cjs|npm-alias|b@2.0.0|false',
      'snapshots/a@1.0.0(x@1)/dependencies/local-lib|link|link:../lib|true',
    ]);
    expect(base.nodes.map((n) => n.id)).not.toContain('npm:local-lib@link:../lib');
    expect(base.edges.map((e) => e.to)).toContain('npm:b@2.0.0'); // the alias's REAL package is the edge target
    const sha = (d: ReturnType<typeof derive>, reason: string): string => d.unmodeled.find((u) => u.reason === reason)!.entrySha256;
    expect(sha(derive(doc('../other', 'b@2.0.0')), 'link')).not.toBe(sha(base, 'link'));
    expect(sha(derive(doc('../lib', 'c@3.0.0')), 'npm-alias')).not.toBe(sha(base, 'npm-alias'));
    // and through the digest: same nodes, different link target ⇒ different stackDigest
    const digest = (t: string): string => extractStackManifest(treeWith('snap-link', t, ROOT_ID), REVISION).manifest.stackDigest;
    expect(digest(doc('../other', 'b@2.0.0'))).not.toBe(digest(doc('../lib', 'b@2.0.0')));
  });

  it("R30: optional is a REAL YAML boolean or nothing — the quoted string 'true', yes, 1, a mapping, a bare key and a value cut mid-line are refused, never a flag that is quietly false", () => {
    const derive = (value: string) => deriveFromPnpmLockV9(parsePnpmLockSubset(mini().replace('  a@1.0.0: {}', `  a@1.0.0:\n    optional:${value === '' ? '' : ` ${value}`}`)), ROOT_ID);
    const flagOf = (value: string): boolean => {
      const d = derive(value);
      expect(d.malformed).toEqual([]);
      return d.nodes.find((n) => n.name === 'a')!.optional;
    };
    for (const v of ['true', 'True', 'TRUE']) expect(flagOf(v), v).toBe(true);
    for (const v of ['false', 'False', 'FALSE']) expect(flagOf(v), v).toBe(false);
    // pnpm writes `optional: true` and nothing else there: everything else is a value cut mid-line (`optional: tr`)
    // or a hand edit — a refusal, not a false. (Pass 3: a cut inside that one line flipped a hashed flag silently.)
    for (const v of ["'true'", '"true"', 'yes', '1', '~', 'null', '{}', 'truthy', 'tr', 't', '']) {
      expect(derive(v).malformed, JSON.stringify(v)).toEqual(["snapshots entry 'a@1.0.0' ('optional' is not a boolean — the lockfile is cut short)"]);
    }
  });

  it('R23: os / cpu list ORDER is presentation — sorted in the node, same stackDigest', () => {
    const withOs = (os: string, cpu: string): ReturnType<typeof extractStackManifest> =>
      extractStackManifest(treeWith('os-order', fixtureLock.replace(flowRes, `${flowRes}    os: ${os}\n    cpu: ${cpu}\n`)), REVISION);
    const a = withOs('[win32, darwin, linux]', '[x64, arm64]');
    const b = withOs('[darwin, linux, win32]', '[arm64, x64]');
    expect(a.refusals).toEqual([]);
    expect(node(a.manifest, 'npm:ws@8.17.0')!.platformConditional).toEqual({ os: ['darwin', 'linux', 'win32'], cpu: ['arm64', 'x64'] });
    expect(a.manifest.stackDigest).toBe(b.manifest.stackDigest);
    expect(a.manifest.stackDigest).not.toBe(golden.stackDigest);
    // a non-list os is a refusal, never an ignored condition on a HASHED field
    expect(refusalsOf(mini({ pkgs: '  b@1.0.0:\n    resolution: {integrity: sha512-BBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}\n    os: linux', snaps: '  b@1.0.0: {}' }))).toEqual([
      stackRefusalPnpmMalformed("packages entry 'b@1.0.0' ('os' is not a list of strings)"),
    ]);
  });

  it('X02: the precedence rule is anchored — only a packageManager that STARTS with pnpm@ makes pnpm-lock.yaml win over an npm lockfile', () => {
    const npmLock = JSON.stringify({
      name: 'example-app',
      version: '1.2.3',
      lockfileVersion: 3,
      packages: { '': { name: 'example-app', version: '1.2.3' }, 'node_modules/zod': { version: '4.6.5', integrity: 'sha512-x' } },
    });
    const parserFor = (packageManager: string): string[] => {
      const d = treeWith('anchored', fixtureLock, { name: 'example-app', version: '1.2.3', packageManager });
      fs.writeFileSync(path.join(d, 'package-lock.json'), npmLock);
      const r = extractStackManifest(d, REVISION);
      expect(r.refusals, packageManager).toEqual([]);
      return r.manifest.sources.map((s) => s.parser).filter((p) => p.includes('lockfile'));
    };
    expect(parserFor('pnpm@10.11.1')).toEqual(['pnpm-lockfile-v9']);
    for (const pm of ['not-pnpm@1.0.0', 'xpnpm@9.0.0', '@scope/pnpm@9.0.0', 'pnpmx@1', 'pnpm', 'npm@10.0.0 (was pnpm@9)']) expect(parserFor(pm), pm).toEqual(['npm-lockfile-v3']);
  });

  /* ---- minors ---- */
  it('MINOR-4: nesting deeper than the cap is a fixed refusal with a line number — readPnpmLock never throws on content', () => {
    const deep = (n: number): string => Array.from({ length: n }, (_, i) => `${' '.repeat(i)}k${i}:`).join('\n') + `\n${' '.repeat(n)}leaf: 1\n`;
    expect(() => parsePnpmLockSubset(deep(PNPM_LOCK_MAX_NESTING))).not.toThrow();
    let r: ReturnType<typeof readPnpmLock> | undefined;
    expect(() => (r = readPnpmLock(deep(5000), ROOT_ID))).not.toThrow();
    expect(r!.refusals).toEqual([stackRefusalPnpmSubset(PNPM_LOCK_MAX_NESTING + 2, `block nesting deeper than ${PNPM_LOCK_MAX_NESTING}`)]);
  });

  it('MINOR-5: a line with 200 000 interior spaces is read in linear time (the trailing-whitespace trim is not a backtracking regex)', () => {
    const started = Date.now();
    const doc = parsePnpmLockSubset(`zz: a${' '.repeat(200_000)}b\nyy: c${' '.repeat(200_000)}\n`);
    const elapsed = Date.now() - started;
    expect((doc.get('zz') as string).length).toBe(200_002);
    expect(doc.get('yy')).toBe('c');
    expect(elapsed).toBeLessThan(5_000); // generous: the quadratic form measured 17 s for ONE such line
  });

  it('MINOR-6: a type error in importers / snapshots / dependencies is a malformed REFUSAL, never a silent skip', () => {
    const cases: Array<[string, string]> = [
      [mini().replace("  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}", '  .: garbage'), "importer '.' (not a mapping)"],
      [mini({ imp: '    dependencies: garbage' }), "importer . 'dependencies' (not a mapping)"],
      [mini({ imp: '    dependencies:\n      a: 1.0.0' }), "importer . dependency 'a' (not a specifier/version mapping)"],
      [mini().replace('  a@1.0.0: {}', '  a@1.0.0: garbage'), "snapshots entry 'a@1.0.0' (not a mapping)"],
      [mini().replace('  a@1.0.0: {}', '  a@1.0.0:\n    dependencies: garbage'), "snapshot a@1.0.0 'dependencies' (not a mapping)"],
      [mini().replace('  a@1.0.0: {}', '  a@1.0.0:\n    dependencies:\n      a: {nested: 1.0.0}'), "snapshot a@1.0.0 dependency 'a' (no version string)"],
      [mini().replace('  a@1.0.0: {}', '  a@1.0.0:\n    dependencies:\n      a: ~'), "snapshot a@1.0.0 dependency 'a' (no version string)"],
    ];
    for (const [text, what] of cases) expect(refusalsOf(text), what).toEqual([stackRefusalPnpmMalformed(what)]);
    // the one legitimate empty is what pnpm writes: `{}`. A bare key (YAML null) and a bucket with nothing in it are
    // shapes pnpm never writes (0 in 130 real lockfiles) and exactly what a cut in the tail looks like — guard (a), snapshot side
    expect(refusalsOf(mini())).toEqual([]);
    for (const empty of ['', ' ~', ' null']) {
      expect(refusalsOf(mini().replace('  a@1.0.0: {}', `  a@1.0.0:${empty}`)), empty).toEqual([stackRefusalPnpmMalformed("snapshots entry 'a@1.0.0' (an entry with no value: pnpm writes '{}' — the lockfile is cut short)")]);
    }
    for (const key of ['dependencies', 'optionalDependencies']) {
      for (const empty of ['', ' {}', ' ~']) {
        expect(refusalsOf(mini().replace('  a@1.0.0: {}', `  a@1.0.0:\n    ${key}:${empty}`)), `${key}:${empty}`).toEqual([
          stackRefusalPnpmMalformed(`snapshot a@1.0.0 '${key}' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)`),
        ]);
      }
    }
  });

  it("MINOR-7: v6-style '/name@version' path keys under a 9.0 header are refused — a package key is `name@version` or `@scope/name@version`", () => {
    const v6 = mini().replace(/a@1\.0\.0/g, '/a@1.0.0').replace('      /a@1.0.0', '      a');
    expect(refusalsOf(v6)).toContain(stackRefusalPnpmMalformed("packages entry '/a@1.0.0' (not a 'name@version' mapping)"));
    for (const key of ['a/b@1.0.0', '@s/a/b@1.0.0', '@/a@1.0.0']) {
      expect(refusalsOf(mini({ pkgs: `  '${key}':\n    resolution: {integrity: sha512-BBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}` })), key).toContain(stackRefusalPnpmMalformed(`packages entry '${key}' (not a 'name@version' mapping)`));
    }
    expect(refusalsOf(mini({ pkgs: "  '@s/b@1.0.0':\n    resolution: {integrity: sha512-BBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}", snaps: "  '@s/b@1.0.0': {}" }))).toEqual([]);
  });

  it('MINOR-8: a block scalar is never an identity value — refused as integrity / version / dependency ref, inert as a deprecated message', () => {
    expect(refusalsOf(mini({ pkgs: '  b@1.0.0:\n    resolution:\n      integrity: |-\n        sha512-BBBBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==', snaps: '  b@1.0.0: {}' }))).toEqual([
      stackRefusalPnpmMalformed("packages entry 'b@1.0.0' (integrity is not ONE sha1-/sha256-/sha384-/sha512- hash of its exact length)"),
    ]);
    expect(refusalsOf(mini({ pkgs: '  b@1.0.0:\n    resolution:\n      tarball: >-\n        https://registry.example/b.tgz', snaps: '  b@1.0.0: {}' }))).toEqual([
      stackRefusalPnpmMalformed("packages entry 'b@1.0.0' (resolution.tarball is not a string)"),
    ]);
    expect(refusalsOf(mini({ imp: '    dependencies:\n      a:\n        specifier: ^1.0.0\n        version: |-\n          1.0.0' }))).toEqual([
      stackRefusalPnpmMalformed("importer . dependency 'a' (version '' names no snapshot)"),
    ]);
    expect(refusalsOf(mini().replace('  a@1.0.0: {}', '  a@1.0.0:\n    dependencies:\n      a: |-\n        1.0.0'))).toEqual([stackRefusalPnpmMalformed("snapshot a@1.0.0 dependency 'a' (no version string)")]);
    // a multi-line deprecation notice is what pnpm really writes as a block scalar: read past, same closure
    const digest = (t: string): string => extractStackManifest(treeWith('deprecated', t, ROOT_ID), REVISION).manifest.stackDigest;
    const noticed = mini().replace('    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}', '    resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}\n    deprecated: |-\n      no longer maintained\n      use something else');
    expect(refusalsOf(noticed)).toEqual([]);
    expect(digest(noticed)).toBe(digest(mini()));
  });

  /* ---- MINOR-10: declared ranges never move the digest — for opaque importer entries too ---- */
  describe('MINOR-10: an importer-level opaque entry hashes the dependency name + the RESOLVED value; the specifier is quarantined', () => {
    const run = (label: string, text: string, files: Record<string, string> = {}) => {
      const r = extractStackManifest(treeWith(label, text, undefined, files), REVISION);
      expect(r.refusals, label).toEqual([]);
      return r.manifest;
    };
    const entry = (m: StackManifest, reason: string) => m.unmodeled.find((u) => u.reason === reason && u.key.startsWith('importers/'))!;
    const edit = (from: string, to: string): string => {
      const out = fixtureLock.replace(from, to);
      expect(out, from).not.toBe(fixtureLock);
      return out;
    };

    it('link: specifier workspace:* → workspace:^ ⇒ SAME stackDigest and entrySha256 (only manifestDigest moves)', () => {
      const m = run('link-spec', edit('        specifier: workspace:*\n', '        specifier: workspace:^\n'));
      expect(m.stackDigest).toBe(golden.stackDigest);
      expect(entry(m, 'link').entrySha256).toBe(entry(golden, 'link').entrySha256);
    });
    it('link: TARGET link:../lib → link:../other ⇒ stackDigest and entrySha256 MOVE', () => {
      // the workspace package moves WITH its link: a link whose target is not an importer is a cut lockfile (guard b)
      const m = run('link-target', relinkLibToOther(fixtureLock));
      expect(m.stackDigest).not.toBe(golden.stackDigest);
      expect(entry(m, 'link').entrySha256).not.toBe(entry(golden, 'link').entrySha256);
      expect(entry(m, 'link').spec.version).toBe('link:../other');
    });
    it('alias: specifier npm:string-width@^4.2.0 → ^4.2.1 ⇒ SAME stackDigest and entrySha256; the edge carries the new range', () => {
      const m = run('alias-spec', edit('        specifier: npm:string-width@^4.2.0\n', '        specifier: npm:string-width@^4.2.1\n'));
      expect(m.stackDigest).toBe(golden.stackDigest);
      expect(entry(m, 'npm-alias').entrySha256).toBe(entry(golden, 'npm-alias').entrySha256);
      expect(m.edges.some((e) => e.spec === 'npm:string-width@^4.2.1')).toBe(true);
      expect(m.manifestDigest).not.toBe(golden.manifestDigest);
    });
    it('alias: RESOLVED target string-width@4.2.3 → another locked package ⇒ stackDigest and entrySha256 MOVE', () => {
      const m = run('alias-target', edit('        version: string-width@4.2.3\n', '        version: is-number@7.0.0\n'));
      expect(m.stackDigest).not.toBe(golden.stackDigest);
      expect(entry(m, 'npm-alias').entrySha256).not.toBe(entry(golden, 'npm-alias').entrySha256);
      // …and the alias NAME is still part of the entry: same target under another name is another entry
      const renamed = run('alias-name', edit('      sw-cjs:\n', '      sw-esm:\n'), appManifestRenaming('sw-cjs', 'sw-esm'));
      expect(entry(renamed, 'npm-alias').key).toBe('importers/packages/app/dependencies/sw-esm');
      expect(renamed.stackDigest).not.toBe(golden.stackDigest);
    });
  });

  /* ---- MINOR-3: the declared manager and the family that was read disagree ---- */
  it('MINOR-3: packageManager names a manager whose lockfile is not the one read ⇒ a coverage line (never a refusal); agreement ⇒ no line', () => {
    const npmLock = JSON.stringify({
      name: 'example-app',
      version: '1.2.3',
      lockfileVersion: 3,
      packages: { '': { name: 'example-app', version: '1.2.3' }, 'node_modules/zod': { version: '4.6.5', integrity: 'sha512-x' } },
    });
    const tree = (packageManager: string | null, files: Record<string, string>): string => {
      const d = tmp('declared');
      fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'example-app', version: '1.2.3', ...(packageManager ? { packageManager } : {}) }));
      for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(d, rel), text);
      // the fixture lockfile names the fixture's workspace packages: the tree carries them (guard c)
      if ('pnpm-lock.yaml' in files) {
        fs.cpSync(path.join(FIXTURE_TREE, 'packages'), path.join(d, 'packages'), { recursive: true });
        fs.copyFileSync(path.join(FIXTURE_TREE, 'pnpm-workspace.yaml'), path.join(d, 'pnpm-workspace.yaml'));
      }
      return d;
    };
    const coverage = (d: string): string[] => {
      const r = extractStackManifest(d, REVISION);
      expect(r.refusals).toEqual([]);
      return r.manifest.coverage.unsupported;
    };
    // pnpm declared, only an npm lockfile exists
    expect(coverage(tree('pnpm@10.11.1', { 'package-lock.json': npmLock }))).toContain(stackCoveragePackageManagerMismatch('pnpm', 'package-lock.json'));
    // yarn declared, yarn.lock unsupported, pnpm-lock read
    const yarnCase = coverage(tree('yarn@4.1.0', { 'yarn.lock': '# yarn lockfile v1\n', 'pnpm-lock.yaml': fixtureLock }));
    expect(yarnCase).toContain(stackCoveragePackageManagerMismatch('yarn', 'pnpm-lock.yaml'));
    expect(yarnCase).toContain(STACK_REFUSAL_YARN);
    // npm declared, only pnpm-lock exists
    expect(coverage(tree('npm@10.0.0', { 'pnpm-lock.yaml': fixtureLock }))).toContain(stackCoveragePackageManagerMismatch('npm', 'pnpm-lock.yaml'));
    // agreement or no declaration: no such line
    for (const d of [tree('pnpm@10.11.1', { 'pnpm-lock.yaml': fixtureLock }), tree('npm@10.0.0', { 'package-lock.json': npmLock }), tree(null, { 'package-lock.json': npmLock })]) {
      expect(coverage(d).filter((l) => l.includes('packageManager declares') && l.includes('but the lockfile read'))).toEqual([]);
    }
    expect(golden.coverage.unsupported.filter((l) => l.includes('but the lockfile read'))).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 9. release carry-ins                                                         */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 9: block-scalar bodies, the dependency-free project, the single right-trim', () => {
  const ROOT_ID = { name: 'r', version: '1.0.0' };
  const H = `sha512-${'A'.repeat(86)}==`;
  const doc = (pkgExtra: string): string =>
    [
      "lockfileVersion: '9.0'",
      'importers:',
      '  .:',
      '    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}',
      'packages:',
      '  a@1.0.0:',
      `    resolution: {integrity: ${H}}`,
      pkgExtra,
      'snapshots:',
      '  a@1.0.0: {}',
    ]
      .filter((l) => l !== '')
      .join('\n') + '\n';
  const digest = (text: string): string => {
    const r = extractStackManifest(treeWith('g9', text, ROOT_ID), REVISION);
    expect(r.refusals).toEqual([]);
    return r.manifest.stackDigest;
  };

  it('a TAB-led (or #-led) line INSIDE a block-scalar body is inert text: the lockfile is read, same closure, same stackDigest', () => {
    const plain = doc('');
    const notice = doc('    deprecated: |-\n      \tno longer maintained\n      # see the successor\n      plain line');
    expect(readPnpmLock(notice, ROOT_ID).refusals).toEqual([]);
    expect(digest(notice)).toBe(digest(plain));
    // …as the FIRST body line too, and at the very end of the document
    expect(readPnpmLock(`${plain}time:\n  note: >-\n    \ttabbed\n`, ROOT_ID).refusals).toEqual([]);
  });

  it('a TAB is still a refusal wherever the line is STRUCTURE, and a tabbed block scalar is still refused in an identity position', () => {
    expect(readPnpmLock(doc('').replace('  a@1.0.0: {}', '  a@1.0.0:\n\toptional: true'), ROOT_ID).refusals).toEqual([stackRefusalPnpmSubset(11, 'tab indentation')]);
    // a tab-led line that is NOT inside a block-scalar body (it follows a plain value) is structure
    expect(readPnpmLock("lockfileVersion: '9.0'\nimporters:\n  .: {}\n  \tx: 1\n", ROOT_ID).refusals).toEqual([stackRefusalPnpmSubset(4, 'tab indentation')]);
    // a tab-led comment is not a comment: refused
    expect(readPnpmLock("lockfileVersion: '9.0'\n\t# note\nimporters:\n  .: {}\n", ROOT_ID).refusals).toEqual([stackRefusalPnpmSubset(2, 'tab indentation')]);
    const identity = doc('').replace(`    resolution: {integrity: ${H}}`, `    resolution:\n      integrity: |-\n        \t${H}`);
    expect(readPnpmLock(identity, ROOT_ID).refusals).toEqual([
      stackRefusalPnpmMalformed("packages entry 'a@1.0.0' (integrity is not ONE sha1-/sha256-/sha384-/sha512- hash of its exact length)"),
    ]);
  });

  it('STRUCTURE is right-trimmed once: a padded document marker is still a marker and a padded plain scalar is its trimmed text — a block-scalar BODY line keeps its trailing whitespace', () => {
    expect(readPnpmLock("lockfileVersion: '9.0'   \n---   \nimporters:\n  .: {}\n", ROOT_ID).refusals).toEqual([
      stackRefusalPnpmSubset(2, 'document marker or directive (multi-document stream)'),
    ]);
    const parsed = parsePnpmLockSubset('a: |-\n  body   \t \nb: plain   \n');
    // trailing whitespace is CONTENT inside a literal block scalar: kept, so it can never hash like the trimmed form
    expect((parsed.get('a') as PnpmBlockScalar).text).toBe('body   \t ');
    expect((parsed.get('a') as PnpmBlockScalar).lines).toEqual([[0, 'body   \t ']]);
    expect(parsed.get('b')).toBe('plain');
  });

  describe('a dependency-free project (what pnpm writes as `importers: {.: {}}` and nothing else)', () => {
    const head = "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\n";
    const free = [
      `${head}importers:\n\n  .: {}\n`,
      `${head}importers:\n  .: {}\n  packages/lib: {}\n`,
      `${head}importers:\n  .: {}\npackages: {}\nsnapshots:\n`,
    ];

    it('TRUNCATION GUARD (a): a bucket with NO entries (`dependencies:` null or `{}`) is a shape pnpm never writes — refused, in every bucket and every importer', () => {
      const bucket = (imp: string, key: string): string => stackRefusalPnpmMalformed(`importer ${imp} '${key}' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)`);
      for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        for (const empty of ['', ' {}', ' ~', ' null']) {
          expect(readPnpmLock(`${head}importers:\n  .:\n    ${key}:${empty}\n`, ROOT_ID).refusals, `${key}:${empty}`).toEqual([bucket('.', key)]);
        }
        // in a workspace importer, beside a healthy one, and through the extractor: exit-2 refusal, never a manifest
        const cut = `${head}importers:\n  .: {}\n  packages/lib:\n    ${key}:\n`;
        expect(extractStackManifest(treeWith('null-bucket', cut, ROOT_ID), REVISION).refusals).toEqual([bucket('packages/lib', key), STACK_REFUSAL_NO_LOCKFILE]);
      }
      // what a lockfile cut right after the bucket key looks like, with the closure still present below it in the real file
      const full = `${head}importers:\n  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\npackages:\n  a@1.0.0:\n    resolution: {integrity: ${H}}\nsnapshots:\n  a@1.0.0: {}\n`;
      expect(readPnpmLock(full, ROOT_ID).refusals).toEqual([]);
      expect(readPnpmLock(full.slice(0, full.indexOf('      a:')), ROOT_ID).refusals).toEqual([bucket('.', 'dependencies')]);
    });

    it('is ACCEPTED when EVERY importer declares zero dependencies: root-only closure, a coverage line, no refusal', () => {
      const digests = free.map((text) => {
        const r = extractStackManifest(treeWith('dep-free', text, ROOT_ID), REVISION);
        expect(r.refusals).toEqual([]);
        expect(r.manifest.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual(['npm:r@1.0.0']);
        expect(r.manifest.unmodeled).toEqual([]);
        expect(r.manifest.edges).toEqual([]);
        expect(r.manifest.coverage.unsupported).toContain(STACK_COVERAGE_PNPM_DEPENDENCY_FREE);
        expect(r.manifest.sources.map((s) => s.parser)).toContain('pnpm-lockfile-v9');
        return r.manifest.stackDigest;
      });
      expect(new Set(digests).size).toBe(1);
    });

    it('is still REFUSED as hollow when ANY importer declares a dependency and `packages` is absent', () => {
      const declared = [
        `${head}importers:\n  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\n`,
        `${head}importers:\n  .: {}\n  packages/lib:\n    devDependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\n`,
        `${head}importers:\n  .:\n    optionalDependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\npackages: {}\n`,
      ];
      for (const text of declared) {
        expect(extractStackManifest(treeWith('dep-lost', text, ROOT_ID), REVISION).refusals, text).toEqual([stackRefusalPnpmHollow("no 'packages' mapping"), STACK_REFUSAL_NO_LOCKFILE]);
      }
      // packages present but snapshots lost: still hollow; a scalar `packages` is not "absent"
      expect(readPnpmLock(`${head}importers:\n  .: {}\npackages:\n  a@1.0.0:\n    resolution: {integrity: ${H}}\n`, ROOT_ID).refusals).toEqual([stackRefusalPnpmHollow("no 'snapshots' mapping")]);
      expect(readPnpmLock(`${head}importers:\n  .: {}\npackages: garbage\n`, ROOT_ID).refusals).toEqual([stackRefusalPnpmHollow("no 'packages' mapping")]);
      // a snapshot with no package is a LOST closure, not a dependency-free project: the hollow refusal, not a later one
      expect(readPnpmLock(`${head}importers:\n  .: {}\nsnapshots:\n  a@1.0.0: {}\n`, ROOT_ID).refusals).toEqual([stackRefusalPnpmHollow("no 'packages' mapping")]);
      // no importers at all is never dependency-free
      expect(readPnpmLock(`${head}importers: {}\n`, ROOT_ID).refusals).toEqual([stackRefusalPnpmHollow("no 'importers' mapping")]);
    });

    it('a Dockerfile-only pnpm project gets a snapshot through the real CLI: exit 0, the image is in the closure', () => {
      const d = treeWith('dockerfile-only', free[0]!, { ...ROOT_ID, packageManager: 'pnpm@10.11.1' });
      fs.writeFileSync(path.join(d, 'Dockerfile'), 'FROM node:22-alpine\n');
      const out = path.join(tmp('dockerfile-only-out'), 'm.json');
      const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
      expect(cli.status).toBe(0);
      const m = parseStackManifest(JSON.parse(fs.readFileSync(out, 'utf8')));
      expect(verifyStackManifest(m).valid).toBe(true);
      expect(m.images.map((i) => i.ref)).toEqual(['node:22-alpine']);
      expect(m.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual(['npm:r@1.0.0']);
      // the npm family is unchanged: a root-only package-lock.json is still hollow
      const npmDir = tmp('npm-root-only');
      fs.writeFileSync(path.join(npmDir, 'package.json'), JSON.stringify(ROOT_ID));
      fs.writeFileSync(path.join(npmDir, 'package-lock.json'), JSON.stringify({ name: 'r', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'r', version: '1.0.0' } } }));
      fs.writeFileSync(path.join(npmDir, 'Dockerfile'), 'FROM node:22-alpine\n');
      expect(extractStackManifest(npmDir, REVISION).refusals.length).toBeGreaterThan(0);
    });
  });

  it('`bce stack snapshot --help` names BOTH lockfile families, the packageManager rule and the full identity view', () => {
    const help = runCli(['stack', 'snapshot', '--help'], ROOT);
    expect(help.status).toBe(0);
    const text = help.stdout.replace(/\s+/g, ' ');
    expect(text).toContain('npm lockfile v3 / shrinkwrap or pnpm-lock v9');
    expect(text).toContain('packageManager starts with pnpm@ and a pnpm-lock.yaml exists, it IS the closure');
    expect(text).toContain('pnpm-lock.yaml is read only when no npm lockfile is present');
    expect(text).toContain('(nodes/runtime/images/unmodeled)');
    expect(text).toContain('npm-shrinkwrap.json wins over package-lock.json');
  });

  it('an importer dependency with an EMPTY name is a line-numbered refusal (block and flow), never a schema crash', () => {
    const cases: Array<[string, number, string]> = [
      ["lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '': {specifier: ^1.0.0, version: 1.0.0}\n", 5, 'empty mapping key'],
      ["lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies: {'': {specifier: ^1.0.0, version: 1.0.0}}\n", 4, 'empty flow mapping key'],
    ];
    for (const [text, line, reason] of cases) expect(readPnpmLock(text, ROOT_ID).refusals).toEqual([stackRefusalPnpmSubset(line, reason)]);
  });
});

/* -------------------------------------------------------------------------- */
/* 10. review round 2 — link-only workspaces, block-scalar bodies in opaque hashes */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 10: a link-only workspace is not hollow; block-scalar bodies keep their shape', () => {
  const REAL = path.join(ROOT, 'fixtures', 'stack', 'pnpm-v9-real-shapes');
  const readFixture = (name: string) => extractStackManifest(path.join(REAL, name), REVISION);

  it('D4-1a: a REAL pnpm-written workspace whose only dependencies are workspace: links (no packages, no snapshots by construction) is ACCEPTED', () => {
    for (const name of ['link-only', 'injected']) {
      const r = readFixture(name);
      expect(r.refusals, name).toEqual([]);
      expect(r.manifest.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual([`npm:synth-${name}@1.0.0`]);
      expect(r.manifest.coverage.unsupported).toContain(STACK_COVERAGE_PNPM_DEPENDENCY_FREE);
      expect(r.manifest.coverage.unsupported).toContain(STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS);
    }
    const linkOnly = readFixture('link-only').manifest;
    // the links are HASHED opaque entries: nothing was lost, and a different link target is a different closure
    expect(linkOnly.unmodeled.map((u) => `${u.reason}:${u.key}`)).toEqual(['link:importers/packages/a/dependencies/b', 'link:importers/packages/b/dependencies/a']);
    expect(readFixture('injected').manifest.unmodeled.map((u) => u.key)).toEqual(['importers/packages/a/dependencies/b']);
    expect(linkOnly.stackDigest).not.toBe(readFixture('injected').manifest.stackDigest);
    // the linked package moves WITH the link that names it (a link whose target is no importer is a cut lockfile — guard b)
    const moved = fs.readFileSync(path.join(REAL, 'link-only', 'pnpm-lock.yaml'), 'utf8').replace('version: link:../a', 'version: link:../other').replace('\n  packages/a:\n', '\n  packages/other:\n');
    const r2 = extractStackManifest(treeWith('link-moved', moved, { name: 'synth-link-only', version: '1.0.0' }), REVISION);
    expect(r2.refusals).toEqual([]);
    expect(r2.manifest.stackDigest).not.toBe(linkOnly.stackDigest);
  });

  it('D4-1a negative control: ONE registry dependency declared with no packages is still a LOST closure — hollow, exit 2, nothing written', () => {
    const r = readFixture('link-plus-registry');
    expect(r.refusals).toEqual([stackRefusalPnpmHollow("no 'packages' mapping"), STACK_REFUSAL_NO_LOCKFILE]);
    const out = path.join(tmp('link-plus-out'), 'm.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', path.join(REAL, 'link-plus-registry'), '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain(stackRefusalPnpmHollow("no 'packages' mapping"));
    expect(fs.existsSync(out)).toBe(false);
    // a link-shaped specifier with a NON-link resolved value, or the reverse, is what decides: the RESOLVED value or a workspace: range
    const head = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n";
    expect(readPnpmLock(`${head}      a:\n        specifier: workspace:*\n        version: link:packages/a\n  packages/a: {}\n`, { name: 'r', version: '1.0.0' }).refusals).toEqual([]);
    expect(readPnpmLock(`${head}      a:\n        specifier: ^1.0.0\n        version: 1.0.0\n`, { name: 'r', version: '1.0.0' }).refusals).toEqual([stackRefusalPnpmHollow("no 'packages' mapping")]);
    expect(readPnpmLock(`${head}      a:\n        specifier: file:../a\n        version: file:../a\n`, { name: 'r', version: '1.0.0' }).refusals).toEqual([stackRefusalPnpmHollow("no 'packages' mapping")]);
    // a `workspace:` RANGE whose resolved value is not a link is not a lost closure (nothing registry-shaped was declared) —
    // it is an entry that names no snapshot: the malformed refusal, never the hollow one (survivor R02)
    expect(readPnpmLock(`${head}      a:\n        specifier: workspace:*\n        version: 1.0.0\n`, { name: 'r', version: '1.0.0' }).refusals).toEqual([
      stackRefusalPnpmMalformed("importer . dependency 'a' (version '1.0.0' names no snapshot)"),
    ]);
    // the real CLI accepts the link-only workspace: exit 0, root-only closure plus the two hashed links
    const ok = runCli(['stack', 'snapshot', '--ct-repo', path.join(REAL, 'link-only'), '--no-pin', '--out', path.join(tmp('link-only-out'), 'm.json')], ROOT);
    expect(ok.status).toBe(0);
  });

  describe('a block-scalar body in a HASHED opaque position keeps interior blank lines and relative indentation', () => {
    const digest = (text: string): string => {
      const r = extractStackManifest(treeWith('blk', text, { name: 'r', version: '1.0.0' }), REVISION);
      expect(r.refusals).toEqual([]);
      return r.manifest.stackDigest;
    };
    const H = `sha512-${'A'.repeat(86)}==`;
    const base = (extra: string, tail = ''): string =>
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\npackages:\n  a@1.0.0:\n    resolution: {integrity: ${H}}\n${extra}snapshots:\n  a@1.0.0: {}\n${tail}`;
    const three = (mk: (body: string) => string): void => {
      const a = digest(mk('alpha\n\n      beta'));
      const b = digest(mk('alpha\n      beta'));
      const c = digest(mk('alpha\n        beta'));
      expect(new Set([a, b, c]).size).toBe(3);
    };
    it('a git / non-registry package entry', () => three((body) => base(`  g@https://host/g/tar.gz/abc:\n    resolution: {tarball: https://host/g/tar.gz/abc}\n    version: 1.0.0\n    deprecated: |-\n      ${body}\n`, '  g@https://host/g/tar.gz/abc: {}\n')));
    it('a patchedDependencies entry', () => three((body) => base('', `patchedDependencies:\n  a@1.0.0:\n    hash: abc123\n    path: |-\n      ${body}\n`)));
    it('an unread top-level section', () => three((body) => base('', `futureSection:\n  note: |-\n    ${body.replace(/\n {6}/g, '\n    ').replace(/\n {8}/g, '\n      ')}\n`)));
    it('the raw shape is what the reader keeps: the header, relative indentation, interior blank lines, trailing whitespace — no trailing blank lines unless the header keeps them', () => {
      const doc = parsePnpmLockSubset('a: |-\n    first  \n\n      indented\n    last\n\n\nb: 1\n');
      const a = doc.get('a') as PnpmBlockScalar;
      expect(a.header).toBe('|-');
      expect(a.text).toBe('first  \n\n  indented\nlast');
      expect(a.lines).toEqual([[0, 'first  '], [0, ''], [2, 'indented'], [0, 'last']]);
      expect(doc.get('b')).toBe('1');
      // a body line LESS indented than the first body line (still inside the scalar): readable text clamps, the hashed lines do not
      const shallow = parsePnpmLockSubset('a: |-\n      deep\n    shallow\n').get('a') as PnpmBlockScalar;
      expect(shallow.text).toBe('deep\nshallow');
      expect(shallow.lines).toEqual([[0, 'deep'], [-2, 'shallow']]);
      // `+` KEEPS trailing blank lines in YAML, so there they are counted; an indentation indicator states the body indentation
      expect((parsePnpmLockSubset('a: |+\n  x\n\n\nb: 1\n').get('a') as PnpmBlockScalar).lines).toEqual([[0, 'x'], [0, ''], [0, '']]);
      expect((parsePnpmLockSubset('a: |2\n    x\n  y\n').get('a') as PnpmBlockScalar).lines).toEqual([[2, 'x'], [0, 'y']]);
      expect(() => parsePnpmLockSubset('a: |0\n  x\n')).toThrow(/malformed block scalar header/);
    });

    it('MINOR-1 (pass 2): the HEADER and the lossless body are hashed — `|` vs `>`, chomping, an indentation indicator, a less-indented line, trailing and whitespace-only content never collide', () => {
      const git = (header: string, body: string): string =>
        base(`  g@https://host/g/tar.gz/abc:\n    resolution: {tarball: https://host/g/tar.gz/abc}\n    version: 1.0.0\n    deprecated: ${header}\n${body}`, '  g@https://host/g/tar.gz/abc: {}\n');
      const two = '      alpha\n      beta\n';
      const variants: Array<[string, string]> = [
        ['literal', git('|', two)],
        ['folded', git('>', two)],
        ['literal strip', git('|-', two)],
        ['literal keep', git('|+', two)],
        ['folded strip', git('>-', two)],
        ['folded keep', git('>+', two)],
        ['indentation indicator', git('|6', two)],
        ['keep + one trailing blank line', git('|+', `${two}\n`)],
        ['keep + two trailing blank lines', git('|+', `${two}\n\n`)],
        ['second line indented less', git('|', '        alpha\n      beta\n')],
        ['second line indented more', git('|', '      alpha\n        beta\n')],
        ['trailing spaces on a body line', git('|', '      alpha  \n      beta\n')],
        ['a whitespace-only interior line longer than the body indentation', git('|', '      alpha\n        \n      beta\n')],
        ['an empty interior line', git('|', '      alpha\n\n      beta\n')],
      ];
      const digests = variants.map(([, text]) => digest(text));
      for (let i = 0; i < variants.length; i++) {
        for (let j = i + 1; j < variants.length; j++) expect(digests[i], `${variants[i]![0]} vs ${variants[j]![0]}`).not.toBe(digests[j]);
      }
      // …and what is only the FILE's layout still moves nothing: trailing blank lines under clip / strip, a
      // whitespace-only line no longer than the body indentation (an empty line in YAML), the key's own depth
      expect(digest(git('|', `${two}\n\n`))).toBe(digest(git('|', two)));
      expect(digest(git('|-', `${two}\n`))).toBe(digest(git('|-', two)));
      expect(digest(git('|', '      alpha\n    \n      beta\n'))).toBe(digest(git('|', '      alpha\n\n      beta\n')));
    });
  });

  it('indentation counts SPACES only: a tab-led line with fewer spaces than the body is structure (a refusal), not body text', () => {
    const H = `sha512-${'A'.repeat(86)}==`;
    const text = `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\npackages:\n  a@1.0.0:\n    resolution: {integrity: ${H}}\n    deprecated: |-\n      body line\n    \tnot body: fewer spaces than the body\nsnapshots:\n  a@1.0.0: {}\n`;
    expect(readPnpmLock(text, { name: 'r', version: '1.0.0' }).refusals).toEqual([stackRefusalPnpmSubset(11, 'tab indentation')]);
    // …while the same tab-led line WITH the body's spaces is body text
    expect(readPnpmLock(text.replace('    \tnot body', '      \tis body'), { name: 'r', version: '1.0.0' }).refusals).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 11. review round 3 — a TRUNCATED lockfile is never a smaller legitimate one   */
/* -------------------------------------------------------------------------- */

describe('stack pnpm — group 11: truncation guards (a) empty bucket, (b) link target, (c) declared dependencies, (d) workspace packages', () => {
  const REAL = path.join(ROOT, 'fixtures', 'stack', 'pnpm-v9-real-shapes');
  /** every committed pnpm-written shape that is a stack (link-plus-registry is the hollow negative control) */
  const REAL_SHAPES = ['link-only', 'injected', 'mixed', 'link-workspace-packages', 'link-protocol', 'exclude-links', 'negated-globs', 'self-link'];
  const lost = (what: string): string => stackRefusalPnpmLostClosure(what);
  const bucket = (imp: string, key: string): string => stackRefusalPnpmMalformed(`importer ${imp} '${key}' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)`);
  /** A temp copy of a committed fixture tree whose lockfile is cut to its first `n` lines (all of it when `n` is undefined). */
  const cutCopy = (fixtureDir: string, n?: number): string => {
    const d = tmp('cut');
    fs.cpSync(fixtureDir, d, { recursive: true });
    const lines = fs.readFileSync(path.join(fixtureDir, 'pnpm-lock.yaml'), 'utf8').split(/(?<=\n)/);
    if (n !== undefined) fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), lines.slice(0, n).join(''));
    return d;
  };
  const lineCount = (fixtureDir: string): number => fs.readFileSync(path.join(fixtureDir, 'pnpm-lock.yaml'), 'utf8').split(/(?<=\n)/).length;

  it('THE SWEEP: every line prefix of every real pnpm-written lockfile is REFUSED — only the whole file is a stack', () => {
    const trees = [...REAL_SHAPES.map((n) => path.join(REAL, n)), FIXTURE_TREE];
    for (const tree of trees) {
      const total = lineCount(tree);
      expect(total, tree).toBeGreaterThan(10);
      const accepted: number[] = [];
      for (let n = 1; n <= total; n++) {
        if (extractStackManifest(cutCopy(tree, n), REVISION).refusals.length === 0) accepted.push(n);
      }
      expect(accepted, path.basename(tree)).toEqual([total]);
    }
    // …and BYTE by byte (a cut inside a line), for EVERY committed real shape: only the whole file, and the whole file
    // without its final newline — which is the same document
    for (const name of REAL_SHAPES) {
      const lock = fs.readFileSync(path.join(REAL, name, 'pnpm-lock.yaml'), 'utf8');
      const d = cutCopy(path.join(REAL, name));
      const accepted: number[] = [];
      for (let n = 1; n <= lock.length; n++) {
        fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), lock.slice(0, n));
        if (extractStackManifest(d, REVISION).refusals.length === 0) accepted.push(n);
      }
      expect(lock.endsWith('\n'), name).toBe(true);
      expect(accepted, name).toEqual([lock.length - 1, lock.length]);
    }
  }, 120_000);

  it('each guard decides the prefixes no other guard can: (a) 12/18/24, (b) 15/16, (d) 9/10/21/22, (c) 27 of the real mixed workspace', () => {
    const mixed = path.join(REAL, 'mixed');
    const refusalsAt = (n: number): string[] => extractStackManifest(cutCopy(mixed, n), REVISION).refusals;
    // (a) the cut falls right after a bucket key: a bare `dependencies:`
    expect(refusalsAt(12)).toEqual([bucket('packages/a', 'dependencies'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(refusalsAt(18)).toEqual([bucket('packages/b', 'dependencies'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(refusalsAt(24)).toEqual([bucket('packages/c', 'dependencies'), STACK_REFUSAL_NO_LOCKFILE]);
    // (b) packages/a links to ../b but the cut came before the `packages/b` importer
    const noTarget = stackRefusalPnpmMalformed("importer packages/a dependency 'b' (workspace link target 'packages/b' is not an importer — the lockfile is cut short)");
    expect(refusalsAt(15)).toEqual([noTarget, STACK_REFUSAL_NO_LOCKFILE]);
    expect(refusalsAt(16)).toEqual([noTarget, STACK_REFUSAL_NO_LOCKFILE]);
    // (d) the cut falls on an importer BOUNDARY: the lockfile is well-formed and self-consistent — only the workspace disagrees
    const named = (dir: string): string => lost(`pnpm-workspace.yaml names package '${dir}' but the lockfile has no importer for it`);
    for (const n of [9, 10]) expect(refusalsAt(n), String(n)).toEqual([named('packages/a'), named('packages/b'), named('packages/c'), STACK_REFUSAL_NO_LOCKFILE]);
    for (const n of [21, 22]) expect(refusalsAt(n), String(n)).toEqual([named('packages/c'), STACK_REFUSAL_NO_LOCKFILE]);
    // (c) `packages/c` is an importer and its link entry is complete — the registry dependency its package.json declares is gone
    expect(refusalsAt(27)).toEqual([
      lost("importer 'packages/c': 'packages/c/package.json' declares dependencies 'is-number' but the lockfile's importer entry does not record it"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
  });

  it('prefix 21 of the mixed lockfile is BYTE-IDENTICAL to the legitimate link-only lockfile: the same bytes are a stack in one tree and a lost closure in the other — through the real CLI, exit 2, nothing written', () => {
    const mixedLock = fs.readFileSync(path.join(REAL, 'mixed', 'pnpm-lock.yaml'), 'utf8').split(/(?<=\n)/);
    const linkOnlyLock = fs.readFileSync(path.join(REAL, 'link-only', 'pnpm-lock.yaml'), 'utf8');
    expect(mixedLock.slice(0, 21).join('')).toBe(linkOnlyLock);
    expect(readPnpmLock(linkOnlyLock, { name: 'r', version: '1.0.0' }).refusals).toEqual([]); // the lockfile ALONE cannot tell
    const snapshot = (dir: string) => {
      const out = path.join(tmp('cut-out'), 'm.json');
      const cli = runCli(['stack', 'snapshot', '--ct-repo', dir, '--no-pin', '--out', out], ROOT);
      return { status: cli.status, stderr: cli.stderr, wrote: fs.existsSync(out) };
    };
    expect(snapshot(path.join(REAL, 'link-only'))).toMatchObject({ status: 0, wrote: true });
    const cut = snapshot(cutCopy(path.join(REAL, 'mixed'), 21));
    expect(cut).toMatchObject({ status: 2, wrote: false });
    expect(cut.stderr).toContain(lost("pnpm-workspace.yaml names package 'packages/c' but the lockfile has no importer for it"));
    // a PINNED view of a committed cut lockfile refuses the same way: the guards read the view the verb reads
    const repo = cutCopy(path.join(REAL, 'mixed'), 27);
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    git('add', '-A');
    git('commit', '-q', '-m', 'cut lockfile');
    for (const extra of [[], ['--no-pin']]) {
      const out = path.join(tmp('cut-pinned-out'), 'm.json');
      const cli = runCli(['stack', 'snapshot', '--ct-repo', repo, ...extra, '--out', out], ROOT);
      expect(cli.status, extra.join(' ')).toBe(2);
      expect(cli.stderr).toContain("declares dependencies 'is-number' but the lockfile's importer entry does not record it");
      expect(fs.existsSync(out)).toBe(false);
    }
    // …and the pinned view reads the COMMIT: repairing the working tree does not make the committed cut a stack
    fs.copyFileSync(path.join(REAL, 'mixed', 'pnpm-lock.yaml'), path.join(repo, 'pnpm-lock.yaml'));
    expect(runCli(['stack', 'snapshot', '--ct-repo', repo, '--no-pin', '--out', path.join(tmp('o'), 'm.json')], ROOT).status).toBe(0);
    expect(runCli(['stack', 'snapshot', '--ct-repo', repo, '--out', path.join(tmp('o'), 'm.json')], ROOT).status).toBe(2);
  });

  it('the legitimate shapes pnpm 10.11.1 really writes are all still read: link-only, injected, link-workspace-packages (survivor R01), link: protocol, excludeLinksFromLockfile, negated globs, registry + links', () => {
    const read = (name: string) => extractStackManifest(path.join(REAL, name), REVISION);
    for (const name of REAL_SHAPES) expect(read(name).refusals, name).toEqual([]);
    // R01 — `link-workspace-packages=true`: a PLAIN range resolved to a workspace link. No `workspace:` specifier anywhere, so
    // only the RESOLVED `link:` value says this dependency needs no packages entry — and the closure is still the root alone
    const lwpLock = fs.readFileSync(path.join(REAL, 'link-workspace-packages', 'pnpm-lock.yaml'), 'utf8');
    expect(lwpLock).toContain('specifier: ^1.0.0\n        version: link:../b');
    expect(lwpLock).not.toContain('workspace:');
    const lwp = read('link-workspace-packages').manifest;
    expect(lwp.coverage.unsupported).toContain(STACK_COVERAGE_PNPM_DEPENDENCY_FREE);
    expect(lwp.unmodeled.map((u) => `${u.reason}:${u.key}`)).toEqual(['link:importers/packages/a/dependencies/b']);
    expect(lwp.nodes.filter((n) => n.kind === 'npm').map((n) => n.id)).toEqual(['npm:synth-link-workspace-packages@1.0.0']);
    // a `link:`-PROTOCOL dependency names a directory by path: pnpm writes NO importer for it (one even sits outside the tree)
    const protoLock = fs.readFileSync(path.join(REAL, 'link-protocol', 'pnpm-lock.yaml'), 'utf8');
    expect(protoLock).toContain('specifier: link:../outside\n        version: link:../outside');
    expect(protoLock).not.toContain('\n  vendor/lib:');
    expect(read('link-protocol').manifest.unmodeled.map((u) => u.spec.version)).toEqual(['link:vendor/lib', 'link:../outside', 'link:../../vendor/lib']);
    // excludeLinksFromLockfile: pnpm itself leaves the `link:` dependencies out of the importers — and ONLY under that setting
    const exclude = path.join(REAL, 'exclude-links');
    expect(fs.readFileSync(path.join(exclude, 'pnpm-lock.yaml'), 'utf8')).toContain('excludeLinksFromLockfile: true');
    const notExcluded = cutCopy(exclude);
    fs.writeFileSync(path.join(notExcluded, 'pnpm-lock.yaml'), fs.readFileSync(path.join(exclude, 'pnpm-lock.yaml'), 'utf8').replace('excludeLinksFromLockfile: true', 'excludeLinksFromLockfile: false'));
    expect(extractStackManifest(notExcluded, REVISION).refusals).toEqual([
      lost("importer '.': 'package.json' declares dependencies 'lib' but the lockfile's importer entry does not record it"),
      lost("importer 'packages/a': 'packages/a/package.json' declares dependencies 'lib' but the lockfile's importer entry does not record it"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
    // negated globs: `packages/skip` holds a package.json and matches `packages/*`, but `!packages/skip` takes it out again
    expect(fs.existsSync(path.join(REAL, 'negated-globs', 'packages', 'skip', 'package.json'))).toBe(true);
    const unNegated = cutCopy(path.join(REAL, 'negated-globs'));
    fs.writeFileSync(path.join(unNegated, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n  - apps/**\n');
    expect(extractStackManifest(unNegated, REVISION).refusals).toEqual([lost("pnpm-workspace.yaml names package 'packages/skip' but the lockfile has no importer for it"), STACK_REFUSAL_NO_LOCKFILE]);
    // founder ruling D4-1: a project whose package.json declares NO dependency and whose lockfile is `importers: {.: {}}` alone
    const free = extractStackManifest(treeWith('d4-1', "lockfileVersion: '9.0'\n\nimporters:\n\n  .: {}\n", { name: 'r', version: '1.0.0' }), REVISION);
    expect(free.refusals).toEqual([]);
    expect(free.manifest.coverage.unsupported).toContain(STACK_COVERAGE_PNPM_DEPENDENCY_FREE);
  });

  it('guard (b): a workspace link must land on an importer — `..` segments resolve from the importer, and a link: PROTOCOL specifier is the only exemption', () => {
    expect(pnpmLinkTarget('packages/a', 'link:../b')).toBe('packages/b');
    expect(pnpmLinkTarget('.', 'link:packages/a')).toBe('packages/a');
    expect(pnpmLinkTarget('packages/a', 'link:../..')).toBe('.');
    expect(pnpmLinkTarget('packages/a', 'link:./../b/')).toBe('packages/b');
    expect(pnpmLinkTarget('.', 'link:../outside')).toBe('../outside');
    expect(pnpmLinkTarget('a', 'link:../../x')).toBe('../x');
    const head = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a:\n    dependencies:\n      b:\n";
    const refusalsOf = (entry: string, tail = ''): string[] => readPnpmLock(`${head}${entry}${tail}`, { name: 'r', version: '1.0.0' }).refusals;
    const noTarget = (target: string): string => stackRefusalPnpmMalformed(`importer packages/a dependency 'b' (workspace link target '${target}' is not an importer — the lockfile is cut short)`);
    expect(refusalsOf('        specifier: workspace:*\n        version: link:../b\n', '  packages/b: {}\n')).toEqual([]);
    expect(refusalsOf('        specifier: workspace:*\n        version: link:../b\n')).toEqual([noTarget('packages/b')]);
    expect(refusalsOf('        specifier: ^1.0.0\n        version: link:../b\n')).toEqual([noTarget('packages/b')]); // link-workspace-packages
    expect(refusalsOf('        specifier: workspace:*\n        version: link:../../elsewhere\n')).toEqual([noTarget('elsewhere')]);
    expect(refusalsOf('        specifier: workspace:*\n        version: link:../../../outside\n')).toEqual([noTarget('../outside')]); // leaves the tree: never an importer
    expect(refusalsOf('        specifier: workspace:*\n        version: link:../..\n')).toEqual([]); // the root IS an importer
    expect(refusalsOf('        specifier: link:../b\n        version: link:../b\n')).toEqual([]); // link: protocol — no importer by construction
    // a workspace link onto the importer ITSELF is what pnpm writes for a package depending on itself (`version: 'link:'`)
    // AND what a link path cut mid-line (`link:.`) resolves to: the reader records it as a self link and the TREE decides
    // (guard c: the dependency name must be the importer's own package name) — see 'MINOR-1 (pass 3)' below
    for (const cut of ['link:', "'link:'", 'link:.', 'link:../a']) {
      const r = readPnpmLock(`${head}        specifier: workspace:*\n        version: ${cut}\n`, { name: 'r', version: '1.0.0' });
      expect(r.refusals, cut).toEqual([]);
      expect(r.derived!.importers.find((i) => i.path === 'packages/a')!.selfLinks, cut).toEqual(['b']);
    }
    // MAJOR-2 (pass 3): a link:-PROTOCOL value is a pure function of its specifier — `link:` + pnpm's normalised path —
    // so a value cut mid-line (what 16 byte prefixes of the committed link-protocol fixture were) never matches
    const proto = (spec: string, version: string): string[] => readPnpmLock(`${head}        specifier: ${spec}\n        version: ${version}\n`, { name: 'r', version: '1.0.0' }).refusals;
    const mismatch = (version: string, normalized: string): string => stackRefusalPnpmMalformed(`importer packages/a dependency 'b' (link: protocol value '${version}' is not 'link:${normalized}', the normalised specifier — the lockfile is cut short)`);
    expect(proto('link:./vendor/lib', 'link:vendor/lib')).toEqual([]);
    expect(proto('link:../../vendor/lib', 'link:../../vendor/lib')).toEqual([]);
    expect(proto('link:vendor/lib/', 'link:vendor/lib')).toEqual([]);
    expect(proto('link:./a/../vendor/lib', 'link:vendor/lib')).toEqual([]);
    for (const cut of ['link:vendor/li', 'link:vendor', 'link:', 'link:./vendor/lib', 'link:vendor/lib/', 'link:../vendor/lib']) expect(proto('link:./vendor/lib', cut), cut).toEqual([mismatch(cut, 'vendor/lib')]);
    expect(proto('link:.', 'link:.')).toEqual([mismatch('link:.', '')]);
    expect(proto('link:', 'link:')).toEqual([mismatch('link:', '')]);
    // …in every bucket
    for (const key of ['devDependencies', 'optionalDependencies']) {
      expect(readPnpmLock(`${head.replace('dependencies:', `${key}:`)}        specifier: workspace:*\n        version: link:../b\n`, { name: 'r', version: '1.0.0' }).refusals, key).toEqual([noTarget('packages/b')]);
    }
  });

  it('guard (c): every importer needs a readable package.json, and everything it declares — in all three fields — is recorded; what cannot be checked is refused, never skipped', () => {
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a: {}\n";
    const ws = "packages:\n  - 'packages/*'\n";
    const tree = (files: Record<string, string | null>): string[] => extractStackManifest(treeWith('guard-c', lock, { name: 'r', version: '1.0.0' }, { 'pnpm-workspace.yaml': ws, ...files }), REVISION).refusals;
    expect(tree({})).toEqual([]);
    const A = 'packages/a/package.json';
    expect(tree({ [A]: null })).toEqual([lost(`importer 'packages/a' has no '${A}' in this tree, so what it declares cannot be checked`), STACK_REFUSAL_NO_LOCKFILE]);
    for (const bad of ['{not json', '[]', '"a string"', 'null', '{"dependencies": []}', '{"devDependencies": "x"}', '{"optionalDependencies": null}']) {
      expect(tree({ [A]: bad }), bad).toEqual([lost(`importer 'packages/a': '${A}' is not a readable package manifest, so what it declares cannot be checked`), STACK_REFUSAL_NO_LOCKFILE]);
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      expect(tree({ [A]: JSON.stringify({ name: 'a', [field]: { zod: '^4.0.0', ajv: '^8.0.0' } }) }), field).toEqual([
        lost(`importer 'packages/a': '${A}' declares ${field} 'ajv' but the lockfile's importer entry does not record it`),
        lost(`importer 'packages/a': '${A}' declares ${field} 'zod' but the lockfile's importer entry does not record it`),
        STACK_REFUSAL_NO_LOCKFILE,
      ]);
    }
    // peerDependencies are not installed from the importer entry: never required; an empty field declares nothing
    expect(tree({ [A]: JSON.stringify({ name: 'a', peerDependencies: { react: '*' }, dependencies: {} }) })).toEqual([]);
    // the ROOT importer is checked the same way, and a root without a package.json cannot be checked
    expect(tree({ 'package.json': JSON.stringify({ name: 'r', version: '1.0.0', devDependencies: { vitest: '^5.0.0' } }) })).toEqual([
      lost("importer '.': 'package.json' declares devDependencies 'vitest' but the lockfile's importer entry does not record it"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
    expect(tree({ 'package.json': null })).toContain(lost("importer '.' has no 'package.json' in this tree, so what it declares cannot be checked"));
    // a name recorded in ANY bucket satisfies the declaration (pnpm files a dependency declared twice under one bucket)
    const recorded = `lockfileVersion: '9.0'\nimporters:\n  .:\n    optionalDependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\npackages:\n  a@1.0.0:\n    resolution: {integrity: sha512-${'A'.repeat(86)}==}\nsnapshots:\n  a@1.0.0: {}\n`;
    expect(extractStackManifest(treeWith('guard-c-any', recorded, { name: 'r', version: '1.0.0', dependencies: { a: '^1.0.0' }, optionalDependencies: { a: '^1.0.0' } }), REVISION).refusals).toEqual([]);
    // an importer key that leaves the tree is never read
    const escaping = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  ../sibling: {}\n";
    expect(extractStackManifest(treeWith('guard-c-escape', escaping, { name: 'r', version: '1.0.0' }, { 'pnpm-workspace.yaml': ws }), REVISION).refusals).toEqual([
      lost("importer '../sibling': '../sibling/package.json' is a symbolic link or leaves the tree, so what it declares cannot be checked"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
  });

  it.skipIf(process.platform === 'win32')('guard (c): an importer directory that is a SYMBOLIC LINK is never followed — what it declares cannot be checked', () => {
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a: {}\n";
    const d = treeWith('guard-c-symlink', lock, { name: 'r', version: '1.0.0' }, { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n" });
    const outside = tmp('guard-c-symlink-target');
    fs.writeFileSync(path.join(outside, 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0' }));
    fs.rmSync(path.join(d, 'packages', 'a'), { recursive: true });
    fs.symlinkSync(outside, path.join(d, 'packages', 'a'));
    const refused = lost("importer 'packages/a': 'packages/a/package.json' is a symbolic link or leaves the tree, so what it declares cannot be checked");
    expect(extractStackManifest(d, REVISION).refusals).toContain(refused);
    // …even when the link stays INSIDE the tree (the real path never leaves it): the directory itself is the link
    const inside = treeWith('guard-c-symlink-inside', lock, { name: 'r', version: '1.0.0' }, { 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n", 'real/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0' }) });
    fs.rmSync(path.join(inside, 'packages', 'a'), { recursive: true });
    fs.symlinkSync(path.join('..', 'real', 'a'), path.join(inside, 'packages', 'a'));
    expect(JSON.parse(fs.readFileSync(path.join(inside, 'packages', 'a', 'package.json'), 'utf8')).name).toBe('a'); // the link resolves
    expect(extractStackManifest(inside, REVISION).refusals).toEqual([refused, STACK_REFUSAL_NO_LOCKFILE]);
  });

  it('guard (d): the workspace globs — `*`, `**`, `?`, `.`, negation, dot-led and node_modules directories — and every form that cannot be evaluated refuses', () => {
    const match = (glob: string, dir: string): boolean | null => pnpmWorkspaceGlobToRegExp(glob)?.test(dir) ?? null;
    const cases: Array<[string, string, boolean | null]> = [
      ['packages/*', 'packages/a', true], ['packages/*', 'packages/a/b', false], ['packages/*', 'packages', false], ['packages/*', 'packages/.hidden', false],
      ['apps/**', 'apps', true], ['apps/**', 'apps/x/web', true], ['apps/**', 'appsx', false], ['apps/**', 'apps/.x/web', false],
      ['**', 'a/b/c', true], ['**/web', 'web', true], ['**/web', 'apps/x/web', true], ['a/**/b', 'a/b', true], ['a/**/b', 'a/x/y/b', true], ['a/**/b', 'ab', false],
      ['tests', 'tests', true], ['tests', 'tests/e2e', false], ['@scope/*', '@scope/cli', true], ['./packages/*/', 'packages/a', true], ['packages/a?', 'packages/ab', true], ['packages/a?', 'packages/a', false],
      ['a.b/*', 'aXb/c', false], ['a.b/*', 'a.b/c', true], ['.', '', true],
      ['packages/{a,b}', 'packages/a', null], ['packages/[ab]', 'packages/a', null], ['packages/@(a|b)', 'packages/a', null], ['/abs', 'abs', null], ['a/../b', 'b', null], ['a/b**', 'a/bc', null], ['', '', null], ['a\\b', 'a', null],
    ];
    for (const [glob, dir, want] of cases) expect(match(glob, dir), `${glob} ~ ${dir}`).toBe(want);
    const patterns = readPnpmWorkspacePatterns("packages:\n  - 'packages/*'\n  - apps/**\n  - '!packages/skip'\n  - '!**/fixtures/**'\ncatalog:\n  zod: ^4.0.0\n");
    if (typeof patterns === 'string') throw new Error(patterns);
    expect(patterns.maxDepth).toBe(Infinity);
    expect(['', 'packages/a', 'apps/x/web', 'packages/skip', 'apps/fixtures/x', 'other/a', 'packages/node_modules', 'apps/x/node_modules/dep', 'apps/bower_components/y'].map((dir) => isPnpmWorkspaceDir(patterns, dir))).toEqual([
      true, true, true, false, false, false, false, false, false,
    ]);
    const bounded = readPnpmWorkspacePatterns("packages:\n  - 'packages/*'\n  - 'tools/cli/plugins/*'\n");
    expect(typeof bounded === 'string' ? bounded : bounded.maxDepth).toBe(4);
    // no `packages:` key (pnpm >= 10 keeps settings in this file): the root alone
    const settingsOnly = readPnpmWorkspacePatterns('onlyBuiltDependencies:\n  - esbuild\n');
    expect(typeof settingsOnly === 'string' ? settingsOnly : [settingsOnly.include.length, settingsOnly.maxDepth]).toEqual([0, 0]);
    // cannot be evaluated ⇒ a reason, never a guess
    expect(readPnpmWorkspacePatterns('packages: &anchor\n  - a\n')).toMatch(/^pnpm-workspace\.yaml line 1: .* cannot be read, so the workspace packages cannot be checked$/);
    expect(readPnpmWorkspacePatterns('packages: all\n')).toBe("pnpm-workspace.yaml 'packages' is not a list of strings, so the workspace packages cannot be checked");
    expect(readPnpmWorkspacePatterns("packages:\n  - 'packages/*'\n  - [nested]\n")).toBe("pnpm-workspace.yaml 'packages' is not a list of strings, so the workspace packages cannot be checked");
    expect(readPnpmWorkspacePatterns("packages:\n  - 'packages/{a,b}'\n")).toBe("pnpm-workspace.yaml package pattern 'packages/{a,b}' uses glob syntax this reader does not evaluate, so the workspace packages cannot be checked");
  });

  it('the TAIL of a real lockfile: a cut right after the final snapshot key or a bucket key is refused; a cut BETWEEN two dependencies of the final snapshot is the stated residual (SPEC §16.1) — the format has no terminator', () => {
    const H = `sha512-${'A'.repeat(86)}==`;
    const full =
      `lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      a: {specifier: ^1.0.0, version: 1.0.0}\n      b: {specifier: ^1.0.0, version: 1.0.0}\n      z: {specifier: ^1.0.0, version: 1.0.0}\n` +
      `packages:\n  a@1.0.0:\n    resolution: {integrity: ${H}}\n  b@1.0.0:\n    resolution: {integrity: ${H}}\n  z@1.0.0:\n    resolution: {integrity: ${H}}\n` +
      `snapshots:\n  a@1.0.0: {}\n  b@1.0.0: {}\n  z@1.0.0:\n    dependencies:\n      a: 1.0.0\n      b: 1.0.0\n`;
    const lines = full.split(/(?<=\n)/);
    const pkg = { name: 'r', version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0', z: '^1.0.0' } };
    const accepted: number[] = [];
    for (let n = 1; n <= lines.length; n++) if (extractStackManifest(treeWith('tail', lines.slice(0, n).join(''), pkg), REVISION).refusals.length === 0) accepted.push(n);
    // the whole file, and ONE cut: after `a: 1.0.0`, before `b: 1.0.0` — every node is still there, one edge is not
    expect(accepted).toEqual([lines.length - 1, lines.length]);
    const cutManifest = extractStackManifest(treeWith('tail-residual', lines.slice(0, -1).join(''), pkg), REVISION).manifest;
    const fullManifest = extractStackManifest(treeWith('tail-full', full, pkg), REVISION).manifest;
    expect(cutManifest.nodes.map((n) => n.id)).toEqual(fullManifest.nodes.map((n) => n.id));
    expect(cutManifest.edges.length).toBe(fullManifest.edges.length - 1);
    // edges are not part of the hashed identity view: with every node (and its flags) intact the stackDigest is the
    // whole file's — what the cut loses is the edge, which the manifest body and its manifestDigest do record
    expect(cutManifest.stackDigest).toBe(fullManifest.stackDigest);
    expect(cutManifest.manifestDigest).not.toBe(fullManifest.manifestDigest);
    // the two tail cuts that ARE decidable
    const refusalsAt = (n: number): string[] => readPnpmLock(lines.slice(0, n).join(''), { name: 'r', version: '1.0.0' }).refusals;
    expect(refusalsAt(lines.length - 3)).toEqual([stackRefusalPnpmMalformed("snapshots entry 'z@1.0.0' (an entry with no value: pnpm writes '{}' — the lockfile is cut short)")]);
    expect(refusalsAt(lines.length - 2)).toEqual([stackRefusalPnpmMalformed("snapshot z@1.0.0 'dependencies' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)")]);
  });

  it('MAJOR-1 (pass 3): a workspace package that is a nested clone or a submodule is never skipped — through git, both views, full and cut lockfiles', () => {
    const H = 'sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==';
    const full =
      "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n\n  packages/a: {}\n\n  packages/zsub:\n    dependencies:\n      is-number:\n        specifier: 7.0.0\n        version: 7.0.0\n\n" +
      `packages:\n\n  is-number@7.0.0:\n    resolution: {integrity: ${H}}\n    engines: {node: '>=0.12.0'}\n\nsnapshots:\n\n  is-number@7.0.0: {}\n`;
    const cut = full.slice(0, full.indexOf('  packages/zsub:'));
    expect(readPnpmLock(cut, { name: 'r', version: '1.0.0' }).refusals).toEqual([]); // the lockfile alone cannot tell
    const git = (repo: string, ...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.com', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim();
    const mk = (label: string, variant: 'clone' | 'submodule'): string => {
      const repo = tmp(label);
      fs.mkdirSync(path.join(repo, 'packages', 'a'), { recursive: true });
      fs.writeFileSync(path.join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
      fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'nest-root', version: '1.0.0', private: true }));
      fs.writeFileSync(path.join(repo, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'a', version: '1.0.0' }));
      git(repo, 'init', '-q', '-b', 'main');
      // packages/zsub: its own repository, holding a package.json that declares the registry dependency
      const zsub = path.join(repo, 'packages', 'zsub');
      fs.mkdirSync(zsub, { recursive: true });
      fs.writeFileSync(path.join(zsub, 'package.json'), JSON.stringify({ name: 'zsub', version: '1.0.0', dependencies: { 'is-number': '7.0.0' } }));
      if (variant === 'clone') {
        fs.mkdirSync(path.join(zsub, '.git'));
        fs.writeFileSync(path.join(repo, '.gitignore'), 'packages/zsub/\n');
      } else {
        // a real repository inside: the parent's `git add -A` records it as a gitlink (mode 160000)
        git(zsub, 'init', '-q', '-b', 'main');
        git(zsub, 'add', '-A');
        git(zsub, 'commit', '-q', '-m', 'zsub');
      }
      return repo;
    };
    const snap = (repo: string, extra: string[]): { status: number; nodes: number | null; stderr: string } => {
      const out = path.join(tmp('nest-out'), 'm.json');
      const cli = runCli(['stack', 'snapshot', '--ct-repo', repo, ...extra, '--out', out], ROOT);
      return { status: cli.status, nodes: fs.existsSync(out) ? (JSON.parse(fs.readFileSync(out, 'utf8')) as StackManifest).nodes.length : null, stderr: cli.stderr };
    };
    for (const variant of ['clone', 'submodule'] as const) {
      const repo = mk(`nest-${variant}`, variant);
      for (const lock of ['full', 'cut'] as const) {
        fs.writeFileSync(path.join(repo, 'pnpm-lock.yaml'), lock === 'full' ? full : cut);
        git(repo, 'add', '-A');
        git(repo, 'commit', '-q', '-m', lock);
        if (variant === 'submodule') expect(git(repo, 'ls-files', '--stage', 'packages/zsub')).toMatch(/^160000 /);
        else expect(git(repo, 'ls-files', '--stage', 'packages/zsub')).toBe('');
        const unpinned = snap(repo, ['--no-pin']);
        const pinned = snap(repo, []);
        if (lock === 'full') {
          // the working tree holds zsub's package.json: read, 2 nodes. The pinned tree never holds it (an ignored clone is not in
          // the revision; a submodule's tree is not in git archive): importer 'packages/zsub' cannot be checked — the accepted cost
          expect(unpinned, variant).toMatchObject({ status: 0, nodes: 2 });
          expect(pinned.status, variant).toBe(2);
          expect(pinned.stderr, variant).toContain("importer 'packages/zsub' has no 'packages/zsub/package.json' in this tree");
        } else {
          expect(unpinned.status, variant).toBe(2);
          expect(unpinned.nodes, variant).toBeNull();
          expect(unpinned.stderr, variant).toContain("pnpm-workspace.yaml names package 'packages/zsub' but the lockfile has no importer for it");
          if (variant === 'submodule') {
            // the revision DECLARES a gitlink under `packages/*` and cannot show what is inside it: unevaluable → refused
            expect(pinned.status).toBe(2);
            expect(pinned.stderr).toContain("pnpm-workspace.yaml may name a package under the submodule 'packages/zsub', whose contents are not in this view");
          } else {
            // KNOWN LIMIT, stated plainly: an IGNORED clone leaves no trace in the revision at all — not a gitlink, not a tracked
            // file — so the pinned view of the cut lockfile is indistinguishable from an honest one-package workspace and is read
            expect(pinned).toMatchObject({ status: 0, nodes: 1 });
          }
        }
      }
    }
  });

  it('MAJOR-3 (pass 3): a workspace file with NO packages: key is read by the DECLARED packageManager, never by the lockfile — pnpm >= 10 takes the root alone (measured), anything else is every directory (fail-closed)', () => {
    // MEASURED 2026-09-20: pnpm 10.11.1 with such a file writes `importers: {.: {}}` alone; pnpm 8.15.9, 9.0.0 and 9.15.4 refuse
    // to run at all (`ERR_PNPM_INVALID_WORKSPACE_CONFIGURATION packages field missing or empty`). So a lockfile beside such a
    // file was written by pnpm >= 10 — or the tree is not what its declaration says, which is read as pnpm's own default.
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
    const ws = 'onlyBuiltDependencies:\n  - esbuild\n';
    const pj = (name: string): string => JSON.stringify({ name, version: '1.0.0' });
    const refusals = (packageManager: string | undefined, files: Record<string, string | null> = {}): string[] =>
      extractStackManifest(treeWith('no-packages-key', lock, { name: 'r', version: '1.0.0', ...(packageManager === undefined ? {} : { packageManager }) }, { 'pnpm-workspace.yaml': ws, 'tools/x/package.json': pj('x'), ...files }), REVISION).refusals;
    const named = lost("pnpm-workspace.yaml names package 'tools/x' but the lockfile has no importer for it");
    for (const pm of ['pnpm@10.11.1', 'pnpm@10.0.0', 'pnpm@11.2.0', 'pnpm@10.11.1+sha512.abc']) expect(refusals(pm), pm).toEqual([]);
    for (const pm of ['pnpm@9.15.4', 'pnpm@9.0.0', 'pnpm@8.15.9', undefined, 'pnpm', 'pnpm@x', 'npm@10.0.0', 'yarn@4.1.0']) expect(refusals(pm), String(pm)).toEqual([named, STACK_REFUSAL_NO_LOCKFILE]);
    // decided WITHOUT the lockfile's importer list: the same declarations judge the same tree whether or not the lockfile names tools/x
    const withImporter = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  tools/x: {}\n";
    for (const pm of ['pnpm@10.11.1', 'pnpm@9.15.4', undefined]) {
      expect(extractStackManifest(treeWith('no-packages-key-imp', withImporter, { name: 'r', version: '1.0.0', ...(pm === undefined ? {} : { packageManager: pm }) }, { 'pnpm-workspace.yaml': ws, 'tools/x/package.json': pj('x') }), REVISION).refusals, String(pm)).toEqual([]);
    }
    // the pass-3 reproducer (t_p9): packageManager pnpm@9.15.4, packages/a declares is-number, lockfile cut back to the root importer
    const H = 'sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==';
    const p9full = `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n\n  packages/a:\n    dependencies:\n      is-number:\n        specifier: 7.0.0\n        version: 7.0.0\n\npackages:\n\n  is-number@7.0.0:\n    resolution: {integrity: ${H}}\n    engines: {node: '>=0.12.0'}\n\nsnapshots:\n\n  is-number@7.0.0: {}\n`;
    const p9 = (text: string) => extractStackManifest(treeWith('t_p9', text, { name: 'p9-root', version: '1.0.0', private: true, packageManager: 'pnpm@9.15.4' }, { 'pnpm-workspace.yaml': 'catalog:\n  is-number: 7.0.0\n', 'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { 'is-number': '7.0.0' } }) }), REVISION);
    expect(p9(p9full).refusals).toEqual([]);
    expect(p9(p9full.split(/(?<=\n)/).slice(0, 9).join('')).refusals).toEqual([lost("pnpm-workspace.yaml names package 'packages/a' but the lockfile has no importer for it"), STACK_REFUSAL_NO_LOCKFILE]);
  });

  it("MINOR-1 (pass 3): a package depending on ITSELF through workspace:* (pnpm writes `version: 'link:'`) is read when the name is the importer's own — the self-link fixture — and any other self target refuses", () => {
    const self = path.join(REAL, 'self-link');
    expect(fs.readFileSync(path.join(self, 'pnpm-lock.yaml'), 'utf8')).toContain("version: 'link:'");
    const r = extractStackManifest(self, REVISION);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.unmodeled.map((u) => `${u.reason}:${u.key}:${u.spec.version}`)).toEqual(['link:importers/packages/a/dependencies/a:link:']);
    const cli = runCli(['stack', 'snapshot', '--ct-repo', self, '--no-pin', '--out', path.join(tmp('self-out'), 'm.json')], ROOT);
    expect(cli.status, cli.stderr).toBe(0);
    // the same lockfile bytes in a tree whose packages/a is named otherwise: the self link names a package that is not there
    const renamed = cutCopy(self);
    fs.writeFileSync(path.join(renamed, 'packages', 'a', 'package.json'), JSON.stringify({ name: 'not-a', version: '1.0.0', dependencies: { a: 'workspace:*' } }));
    expect(extractStackManifest(renamed, REVISION).refusals).toEqual([
      lost("importer 'packages/a': dependency 'a' links to the importer itself, whose 'packages/a/package.json' is named 'not-a' — the lockfile is cut short"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
    // …and a link path cut mid-line onto the importer itself (`link:.` from `link:../b`) is a self link under a foreign name
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a:\n    dependencies:\n      b:\n        specifier: workspace:*\n        version: link:.\n  packages/b: {}\n";
    expect(extractStackManifest(treeWith('self-cut', lock, { name: 'r', version: '1.0.0' }, { 'packages/a/package.json': JSON.stringify({ name: 'a', version: '1.0.0', dependencies: { b: 'workspace:*' } }) }), REVISION).refusals).toEqual([
      lost("importer 'packages/a': dependency 'b' links to the importer itself, whose 'packages/a/package.json' is named 'a' — the lockfile is cut short"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
  });

  it('MINOR-3 (pass 3): excludeLinksFromLockfile exempts ONLY a link:-protocol dependency — an unrecorded registry dependency beside it still refuses', () => {
    const lock = "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: true\nimporters:\n  .: {}\n";
    const ok = extractStackManifest(treeWith('excl-ok', lock, { name: 'r', version: '1.0.0', dependencies: { lib: 'link:./vendor/lib' } }, { 'vendor/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0' }) }), REVISION);
    expect(ok.refusals).toEqual([]);
    const registry = extractStackManifest(treeWith('excl-registry', lock, { name: 'r', version: '1.0.0', dependencies: { lib: 'link:./vendor/lib', zod: '^4.0.0' } }, { 'vendor/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0' }) }), REVISION);
    expect(registry.refusals).toEqual([lost("importer '.': 'package.json' declares dependencies 'zod' but the lockfile's importer entry does not record it"), STACK_REFUSAL_NO_LOCKFILE]);
    // a workspace: dependency is not a link:-protocol one either
    expect(extractStackManifest(treeWith('excl-ws', lock, { name: 'r', version: '1.0.0', dependencies: { lib: 'workspace:*' } }), REVISION).refusals).toEqual([
      lost("importer '.': 'package.json' declares dependencies 'lib' but the lockfile's importer entry does not record it"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
  });

  it('guard (d) through the tree: a named package with no importer refuses; node_modules, dot-led, symlinked and package.json-less directories are not packages; no workspace file with workspace importers cannot be checked', () => {
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a: {}\n";
    const ws = "packages:\n  - 'packages/*'\n";
    const pj = (name: string): string => JSON.stringify({ name, version: '1.0.0' });
    const tree = (files: Record<string, string | null>): string => treeWith('guard-d', lock, { name: 'r', version: '1.0.0' }, { 'pnpm-workspace.yaml': ws, ...files });
    const refusals = (files: Record<string, string | null>): string[] => extractStackManifest(tree(files), REVISION).refusals;
    expect(refusals({})).toEqual([]);
    expect(refusals({ 'packages/b/package.json': pj('b') })).toEqual([lost("pnpm-workspace.yaml names package 'packages/b' but the lockfile has no importer for it"), STACK_REFUSAL_NO_LOCKFILE]);
    expect(refusals({ 'packages/node_modules/package.json': pj('x'), 'packages/a/node_modules/dep/package.json': pj('dep'), 'packages/.cache/package.json': pj('c'), 'packages/empty/README.md': 'no manifest\n', 'other/b/package.json': pj('b') })).toEqual([]);
    expect(findPackageJsonDirs(tree({ 'packages/b/package.json': pj('b'), 'packages/b/deep/package.json': pj('deep'), 'packages/node_modules/x/package.json': pj('x') }), 2)).toEqual(['packages/a', 'packages/b']);
    expect(findPackageJsonDirs(tree({ 'packages/clone/package.json': pj('c'), 'packages/clone/.git/HEAD': 'x\n', 'packages/clone/sub/package.json': pj('s') }), Infinity)).toEqual(['packages/a', 'packages/clone', 'packages/clone/sub']);
    expect(findPackageJsonDirs(tree({ 'packages/b/deep/package.json': pj('deep'), 'node_modules/dep/package.json': pj('dep'), 'packages/a/bower_components/w/package.json': pj('w'), '.git/package.json': pj('g') }), Infinity)).toEqual(['packages/a', 'packages/b/deep']);
    // MAJOR-1 (pass 3) RULING — REVERSED from round 3: another repository's tree under a workspace glob IS a workspace package
    // (pnpm never looks at `.git`), so guard (d) walks a nested clone or a checked-out submodule like any directory. The
    // `.git` marker decides nothing here, with or without git knowledge — the image walk's nested-checkout rule is a
    // separate concern and unchanged.
    const named = lost("pnpm-workspace.yaml names package 'packages/clone' but the lockfile has no importer for it");
    const withClone = tree({ 'packages/clone/package.json': pj('clone'), 'packages/clone/.git/HEAD': 'ref: refs/heads/main\n' });
    expect(extractStackManifest(withClone, REVISION).refusals).toEqual([named, STACK_REFUSAL_NO_LOCKFILE]);
    expect(extractStackManifest(withClone, REVISION, 'npm-lockfile', { tracked: new Set(['packages/clone/package.json']), gitlinks: [] }).refusals).toEqual([named, STACK_REFUSAL_NO_LOCKFILE]);
    expect(extractStackManifest(withClone, REVISION, 'npm-lockfile', { tracked: new Set(['packages/clone2/x']), gitlinks: [] }).refusals).toEqual([named, STACK_REFUSAL_NO_LOCKFILE]);
    // a submodule whose contents ARE in the view (checked out): its package.json must be an importer like any other
    const subNamed = lost("pnpm-workspace.yaml names package 'packages/sub' but the lockfile has no importer for it");
    expect(extractStackManifest(tree({ 'packages/sub/package.json': pj('sub') }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['packages/sub'] }).refusals).toEqual([subNamed, STACK_REFUSAL_NO_LOCKFILE]);
    // a gitlink the revision declares under a workspace glob whose contents are NOT in the view (a pinned tree never holds a
    // submodule's tree): the guard cannot be evaluated → refuse — for the honest lockfile as much as for a cut one
    const absent = (g: string): string => lost(`pnpm-workspace.yaml may name a package under the submodule '${g}', whose contents are not in this view, so the workspace packages cannot be checked`);
    expect(extractStackManifest(tree({}), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['packages/sub'] }).refusals).toEqual([absent('packages/sub'), STACK_REFUSAL_NO_LOCKFILE]);
    // …also when the glob reaches BELOW it (`packages/*/web` could name packages/sub/web), and not when no glob can reach it
    expect(extractStackManifest(tree({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/*/web'\n" }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['packages/sub'] }).refusals).toEqual([absent('packages/sub'), STACK_REFUSAL_NO_LOCKFILE]);
    expect(extractStackManifest(tree({}), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['vendor/tool', 'packages/a/node_modules/x'] }).refusals).toEqual([]);
    expect(extractStackManifest(tree({ 'pnpm-workspace.yaml': "packages:\n  - '**'\n" }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['vendor/tool'] }).refusals).toEqual([absent('vendor/tool'), STACK_REFUSAL_NO_LOCKFILE]);
    // a gitlink under node_modules / bower_components / .git can hold no workspace package, whatever the glob
    expect(extractStackManifest(tree({ 'pnpm-workspace.yaml': "packages:\n  - '**'\n" }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['node_modules/x', 'packages/a/bower_components/y'] }).refusals).toEqual([]);
    // `**` reaches ANY depth below a gitlink: `apps/**/web` could name apps/x/y/web
    expect(extractStackManifest(tree({ 'pnpm-workspace.yaml': "packages:\n  - 'apps/**/web'\n" }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['apps/x/y'] }).refusals).toEqual([absent('apps/x/y'), STACK_REFUSAL_NO_LOCKFILE]);
    // a gitlink the workspace file takes OUT by negation, with no glob able to reach below it, needs no look inside
    expect(extractStackManifest(tree({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n  - '!packages/sub'\n" }), REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['packages/sub'] }).refusals).toEqual([]);
    // …and the matcher's own answers
    const P = (yaml: string) => { const r = readPnpmWorkspacePatterns(yaml); if (typeof r === 'string') throw new Error(r); return r; };
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - 'packages/*'\n"), 'packages/sub')).toBe(false); // exact is not below
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - 'packages/*'\n"), 'packages')).toBe(true);
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - 'apps/**/web'\n"), 'apps/x/y')).toBe(true);
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - 'apps/**/web'\n"), 'other')).toBe(false);
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - '**'\n"), 'a/b/c')).toBe(true);
    expect(pnpmWorkspaceGlobMayMatchBelow(P("packages:\n  - 'packages/*/web'\n"), 'packages/sub')).toBe(true);
    // an EMPTY submodule directory on disk (never initialised) is the same absent-contents case
    const emptySub = tree({});
    fs.mkdirSync(path.join(emptySub, 'packages', 'sub'));
    expect(extractStackManifest(emptySub, REVISION, 'npm-lockfile', { tracked: new Set(), gitlinks: ['packages/sub'] }).refusals).toEqual([absent('packages/sub'), STACK_REFUSAL_NO_LOCKFILE]);
    // the file that defines the workspace is missing, unreadable, or written in a glob syntax this reader does not evaluate
    expect(refusals({ 'pnpm-workspace.yaml': null })).toEqual([lost("the lockfile has workspace importers but this tree has no readable 'pnpm-workspace.yaml', so the workspace packages cannot be checked"), STACK_REFUSAL_NO_LOCKFILE]);
    expect(refusals({ 'pnpm-workspace.yaml': "packages:\n  - 'packages/{a,b}'\n" })).toEqual([
      lost("pnpm-workspace.yaml package pattern 'packages/{a,b}' uses glob syntax this reader does not evaluate, so the workspace packages cannot be checked"),
      STACK_REFUSAL_NO_LOCKFILE,
    ]);
    // no `packages:` key: see 'MAJOR-3 (pass 3)' below — the reading is decided by the declared packageManager, never the lockfile
    // a root-only lockfile needs no workspace file; with one, the root is always a package
    const rootOnly = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
    expect(extractStackManifest(treeWith('guard-d-root', rootOnly, { name: 'r', version: '1.0.0' }), REVISION).refusals).toEqual([]);
    expect(checkPnpmLockCoversTree(tree({}), { importers: [{ path: 'packages/a', names: [], selfLinks: [] }], excludeLinksFromLockfile: false }, (rel) => (fs.existsSync(path.join(tree({}), rel)) ? fs.readFileSync(path.join(tree({}), rel)) : null))).toEqual([
      "pnpm-workspace.yaml: the root package is always a workspace package but the lockfile has no importer '.'",
    ]);
  });
});
