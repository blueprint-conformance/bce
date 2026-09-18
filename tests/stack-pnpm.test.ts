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
import { spawnSync } from 'node:child_process';
import { Ajv } from 'ajv';
import { generateSchemas } from '../scripts/generate-schemas.js';
import { stableStringify } from '../src/report.js';
import { parseStackManifest, verifyStackManifest, type StackManifest, type StackNode } from '../src/stack/stack-manifest.js';
import {
  extractStackManifest,
  stackCoverageLockfileIgnored,
  stackRefusalSymlink,
  STACK_COVERAGE_DECLARED_NOT_INSTALLED,
  STACK_COVERAGE_NO_IMAGES,
  STACK_REFUSAL_NO_LOCKFILE,
} from '../src/stack/stack-extractor.js';
import {
  deriveFromPnpmLockV9,
  parsePnpmLockSubset,
  PnpmLockSubsetError,
  readPnpmLock,
  splitPnpmKey,
  stackRefusalPnpmLockfileVersion,
  stackRefusalPnpmSubset,
  STACK_COVERAGE_PNPM_DERIVED_FLAGS,
  STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS,
  STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS,
  STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS,
  stackRefusalPnpmHollow,
  stackRefusalPnpmMalformed,
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
/** A temp tree with the fixture's root files and the given lockfile text (never the fixture itself). */
function treeWith(label: string, lockText: string, pkg?: Record<string, unknown>): string {
  const d = tmp(label);
  fs.writeFileSync(path.join(d, '.nvmrc'), fs.readFileSync(path.join(FIXTURE_TREE, '.nvmrc')));
  fs.writeFileSync(
    path.join(d, 'package.json'),
    pkg ? JSON.stringify(pkg, null, 2) : fs.readFileSync(path.join(FIXTURE_TREE, 'package.json')),
  );
  fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), lockText);
  return d;
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
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((v) => `${pad}- ${emitYaml(v, indent, depth + 1)}`).join('\n');
  }
  if (value.size === 0) return '{}';
  return [...value.keys()]
    .reverse()
    .map((k) => {
      const v = value.get(k)!;
      const inline = typeof v === 'string' || (Array.isArray(v) ? v.length === 0 : v.size === 0);
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
    const digest = (label: string, text: string): string => {
      const r = extractStackManifest(treeWith(label, text), REVISION);
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
      digest('link', fixtureLock.replace('version: link:../lib', 'version: link:../other')),
      digest('commit', fixtureLock.replace(/97edff6f525f192a3f83cea1944765f769ae2678/g, '07edff6f525f192a3f83cea1944765f769ae2678')),
      digest('alias', fixtureLock.replace('      sw-cjs:\n', '      sw-esm:\n')),
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
        '    resolution: {integrity: sha512-AAAA==, tarball: https://registry.example/pkg.tgz}',
        "    engines: {node: '>=18', npm: ^8.16.0 || >=10}",
        '    cpu: [x64, arm64]',
        '    os: []',
        '    deprecated: |-',
        '      first line: with a colon',
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
      ['integrity', 'sha512-AAAA=='],
      ['tarball', 'https://registry.example/pkg.tgz'],
    ]);
    expect((p.get('engines') as PnpmYamlMap).get('npm')).toBe('^8.16.0 || >=10');
    expect(p.get('cpu')).toEqual(['x64', 'arm64']);
    expect(p.get('os')).toEqual([]);
    expect(p.get('deprecated')).toBe('first line: with a colon'); // block scalar: opaque, comment-looking body lines dropped
    expect(p.get('bundledDependencies')).toEqual(['one', 'two']);
    expect(p.get('sameIndentList')).toEqual(['a']);
    expect(p.get('hasBin')).toBe('true'); // scalars stay strings — nothing is type-guessed
    expect((pkgs.get('__proto__@1.0.0') as PnpmYamlMap).size).toBe(0);
    expect((pkgs.get('dq@1.0.0') as PnpmYamlMap).get('note')).toBe('tab\tquote"');
    expect((pkgs.get('dq@1.0.0') as PnpmYamlMap).get('sq')).toBe("it's");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  const REFUSED: Array<[string, string, number, string]> = [
    ['an anchor', "a: &x 1\nb: 2\n", 1, 'anchor or alias in scalar'],
    ['an alias', "a: 1\nb: *x\n", 2, 'anchor or alias in scalar'],
    ['a merge key / alias in a flow map', 'a: {<<: *base}\n', 1, 'anchor or alias in flow scalar'],
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
    '    resolution: {integrity: sha512-KEPT==}',
    '    libc: [glibc]',
    '    os: [linux]',
    '  local@file:../local:',
    '    resolution: {directory: ../local, type: directory}',
    '  gitdep@1.0.0:',
    '    resolution: {type: git, repo: https://host/x.git, commit: abc}',
    '  nointegrity@2.0.0:',
    '    resolution: {tarball: https://registry.example/n.tgz}',
    '  orphan@3.0.0:',
    '    resolution: {integrity: sha512-ORPHAN==}',
    '  nosnap@5.0.0:',
    '    resolution: {integrity: sha512-NOSNAP==}',
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
      'npm:kept@1.0.0|sha512-KEPT==|null',
      'npm:nointegrity@2.0.0|null|https://registry.example/n.tgz',
      'npm:nosnap@5.0.0|sha512-NOSNAP==|null',
      'npm:orphan@3.0.0|sha512-ORPHAN==|null',
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
    expect(fx(fixtureLock.replace('version: link:../lib', 'version: link:../other'), LINK)).toMatchObject({ spec: { version: 'link:../other', link: true } });
    expect(fx(fixtureLock.replace('version: link:../lib', 'version: link:../other'), LINK).entrySha256).not.toBe(fx(fixtureLock, LINK).entrySha256);
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
        '  a@1.0.0: {resolution: {integrity: sha512-A1==}}',
        '  a@2.0.0: {resolution: {integrity: sha512-A2==}}',
        '  p@1.0.0:',
        '    resolution: {integrity: sha512-P==}',
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
    const pkgs = 'packages:\n  a@1.0.0: {resolution: {integrity: sha512-A==}}\n';
    const cases: Array<[string, string]> = [
      [head, "no 'importers' mapping"],
      [`${head}importers: {}\n${pkgs}snapshots:\n  a@1.0.0: {}\n`, "no 'importers' mapping"],
      [`${head}importers:\n  .: {}\n`, "no 'packages' mapping"],
      [`${head}importers:\n  .: {}\npackages: {}\nsnapshots: {}\n`, "no 'packages' mapping"],
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
    const d = treeWith('hollow-cli', `${head}importers:\n  .: {}\n`, pkg);
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
