/**
 * stack-determinism.test.ts — the slice-1 acceptance proof for the stack plane.
 *
 * Groups (numbered as in the design memo):
 *  1. BYTE IDENTITY — extracting the committed `fixtures/stack/a949557-tree` reproduces the committed
 *     golden `fixtures/stack/a949557.stack.json` byte-for-byte (two runs, plus a git-materialized run
 *     of the real commit when the checkout carries it — ci.yml fetches full history; the shallow
 *     portability checkouts still run the fixture-tree half on every OS).
 *  2. MUTATION — a version bump or an integrity flip in a copied lockfile MUST move the digest.
 *  3. NEGATIVE CONTROLS — a byte-different but semantically identical lockfile (keys reversed, 4-space
 *     indent, trailing newline stripped; CRLF; renamed to package-lock.json) MUST NOT move the digest
 *     while `sources[].sha256` / `sources[].path` visibly change.
 *  5. REFUSAL LEGS — pnpm-only / yarn-only / lockfileVersion 2 / truncated / no lockfile refuse with the
 *     exact fixed strings (extractor result AND the built CLI: exit 2, stderr carries the string, no
 *     file written); Dockerfile `FROM ${ARG}` is a coverage line with no node; `@sha256:` pins.
 *  Plus: the HASHED-VIEW quarantine is asserted from the outside (a quarantined field cannot move the
 *  digest; a hashed field must), the tamper field re-derives, and the golden validates against the
 *  published JSON Schema.
 *
 * Everything runs on temp copies; the repository and its fixtures are never mutated.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { Ajv } from 'ajv';
import { generateSchemas } from '../scripts/generate-schemas.js';
import { stableStringify } from '../src/report.js';
import { materializeAtRevision } from '../src/pin.js';
import {
  computeStackDigest,
  parseStackManifest,
  stackHashedView,
  verifyStackManifest,
  STACK_HASHED_VIEW_KEYS,
  STACK_QUARANTINED_KEYS,
  type StackManifest,
} from '../src/stack/stack-manifest.js';
import {
  extractStackManifest,
  parseImageRef,
  scanDockerfile,
  STACK_COVERAGE_DECLARED_NOT_INSTALLED,
  STACK_COVERAGE_NO_IMAGES,
  STACK_REFUSAL_NO_LOCKFILE,
  STACK_REFUSAL_PNPM,
  STACK_REFUSAL_YARN,
  STACK_COVERAGE_IMAGE_WALK_DEPTH,
  stackRefusalHollowLockfile,
  stackRefusalLockfileVersion,
  stackRefusalMalformedEntry,
  stackRefusalSymlink,
} from '../src/stack/stack-extractor.js';

const ROOT = path.join(__dirname, '..');
const FIXTURE_TREE = path.join(ROOT, 'fixtures', 'stack', 'a949557-tree');
const GOLDEN_PATH = path.join(ROOT, 'fixtures', 'stack', 'a949557.stack.json');
const SEED_COMMIT = 'a94955759bfbd6d34c6e1bde02bfc565cd1300d7';
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(ROOT, 'src', 'cli.ts');

const SEED_COMMIT_AVAILABLE = ((): boolean => {
  try {
    execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${SEED_COMMIT}^{commit}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const goldenBytes = fs.readFileSync(GOLDEN_PATH, 'utf8');
const golden: StackManifest = parseStackManifest(JSON.parse(goldenBytes));

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bce-stack-${label}-`));
  tempDirs.push(d);
  return d;
}
/** A fresh copy of the seed fixture tree (never the fixture itself). */
function copyTree(label: string): string {
  const d = tmp(label);
  for (const f of fs.readdirSync(FIXTURE_TREE)) fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(FIXTURE_TREE, f)));
  return d;
}
function readLock(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, 'npm-shrinkwrap.json'), 'utf8')) as Record<string, unknown>;
}
function digestOf(dir: string): string {
  return extractStackManifest(dir, SEED_COMMIT).manifest.stackDigest;
}

/** Run the REAL bce CLI (built dist when present, else tsx over src) capturing both streams + exit. */
function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return { status: typeof res.status === 'number' ? res.status : 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/* -------------------------------------------------------------------------- */
/* 1. byte identity                                                            */
/* -------------------------------------------------------------------------- */

describe('stack slice 1 — group 1: byte identity against the committed golden', () => {
  it('the fixture tree extracts to the golden manifest byte-for-byte, twice', () => {
    const r1 = extractStackManifest(FIXTURE_TREE, SEED_COMMIT);
    const r2 = extractStackManifest(FIXTURE_TREE, SEED_COMMIT);
    expect(r1.refusals).toEqual([]);
    expect(stableStringify(r1.manifest)).toBe(goldenBytes);
    expect(stableStringify(r2.manifest)).toBe(goldenBytes);
    expect(r1.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r1.manifest.stackId).toBe(`stack:${golden.stackDigest.slice(0, 12)}`);
  });

  it('the golden is internally consistent: stackDigest, stackId and manifestDigest all re-derive', () => {
    const v = verifyStackManifest(golden);
    expect(v).toEqual({ stackDigestOk: true, stackIdOk: true, manifestDigestOk: true, valid: true });
  });

  it('the golden carries the seed closure facts (root, zod pin, platform variants, runtime, no images)', () => {
    const root = golden.nodes.filter((n) => n.root);
    expect(root).toHaveLength(1);
    expect(root[0]?.id).toBe('npm:bce-engine@0.3.1');
    const zod = golden.nodes.find((n) => n.name === 'zod');
    expect(zod?.version).toBe('4.6.5');
    expect(zod?.integrity).toMatch(/^sha512-/);
    expect(zod?.dev).toBe(false);
    const darwin = golden.nodes.find((n) => n.name === '@esbuild/darwin-arm64');
    expect(darwin?.platformConditional).toEqual({ cpu: ['arm64'], os: ['darwin'] });
    expect(darwin?.optional).toBe(true);
    // hoisting is layout, not identity: every node id is unique after dedup
    expect(new Set(golden.nodes.map((n) => n.id)).size).toBe(golden.nodes.length);
    expect(golden.runtime).toEqual({ node: { declared: '22', resolvedFrom: 'nvmrc', pin: false } });
    expect(golden.nodes.find((n) => n.kind === 'node-runtime')?.id).toBe('node-runtime:node@22');
    expect(golden.images).toEqual([]);
    expect(golden.coverage.unsupported).toContain(STACK_COVERAGE_DECLARED_NOT_INSTALLED);
    expect(golden.coverage.unsupported).toContain(STACK_COVERAGE_NO_IMAGES);
    expect(golden.sources.map((s) => s.path)).toEqual(['.nvmrc', 'npm-shrinkwrap.json', 'package.json']);
    // every edge endpoint is a real node — never a fabricated target
    const ids = new Set(golden.nodes.map((n) => n.id));
    for (const e of golden.edges) {
      expect(ids.has(e.from), e.from).toBe(true);
      expect(ids.has(e.to), e.to).toBe(true);
    }
  });

  // The seed commit is the bump's BRANCH commit: it is reachable from no branch, so neither a shallow
  // nor a full-history checkout carries it (ci.yml's fetch-depth 0 does NOT bring it in). The leg is
  // then SKIPPED VISIBLY in the report (never a silent early return); it runs only where the commit
  // was fetched by its full sha. The fixture-tree legs above pin the same golden everywhere.
  it.skipIf(!SEED_COMMIT_AVAILABLE)('the fixture tree is the real seed commit (lockfile bytes match git; git-archive materialization reproduces the golden)', () => {
    const fromGit = execFileSync('git', ['-C', ROOT, 'show', `${SEED_COMMIT}:npm-shrinkwrap.json`]);
    expect(fromGit.equals(fs.readFileSync(path.join(FIXTURE_TREE, 'npm-shrinkwrap.json')))).toBe(true);
    // and a real git-archive materialization of the commit reproduces the golden too
    const tree = materializeAtRevision(ROOT, SEED_COMMIT);
    tempDirs.push(tree);
    const r = extractStackManifest(tree, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    // the full repository tree differs from the 3-file fixture tree ONLY in quarantined coverage
    // (it has directories below the image-walk depth) — identity, nodes and edges are identical
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.nodes).toEqual(golden.nodes);
    expect(r.manifest.edges).toEqual(golden.edges);
    expect(r.manifest.coverage.unsupported.filter((u) => !golden.coverage.unsupported.includes(u))).toEqual([STACK_COVERAGE_IMAGE_WALK_DEPTH]);
  });

  it('the built CLI writes the golden bytes (--no-pin --ref <seed sha> over the fixture tree)', () => {
    const out = path.join(tmp('cli'), 'stack-manifest.json');
    const r = runCli(['stack', 'snapshot', '--ct-repo', FIXTURE_TREE, '--no-pin', '--ref', SEED_COMMIT, '--out', out], ROOT);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain(`stackId ${golden.stackId}`);
    expect(fs.readFileSync(out, 'utf8')).toBe(goldenBytes);
  });
});

/* -------------------------------------------------------------------------- */
/* the HASHED VIEW quarantine, asserted from the outside                       */
/* -------------------------------------------------------------------------- */

describe('stack slice 1 — the HASHED VIEW quarantine', () => {
  it('the hashed view carries exactly the declared keys and none of the quarantined ones', () => {
    const view = stackHashedView(golden) as unknown as Record<string, unknown>;
    expect(Object.keys(view).sort()).toEqual([...STACK_HASHED_VIEW_KEYS].sort());
    for (const q of STACK_QUARANTINED_KEYS) expect(view[q as string]).toBeUndefined();
    for (const n of (view.nodes as Array<Record<string, unknown>>)) expect(n.layout).toBeUndefined();
  });

  it('a quarantined field cannot move the digest: revision, sources sha256, edges, coverage, layout', () => {
    const base = computeStackDigest(golden);
    expect(computeStackDigest({ ...golden, ctRepoRevision: 'f'.repeat(40) })).toBe(base);
    expect(computeStackDigest({ ...golden, sources: golden.sources.map((s) => ({ ...s, sha256: '0'.repeat(64) })) })).toBe(base);
    expect(computeStackDigest({ ...golden, edges: [] })).toBe(base);
    expect(computeStackDigest({ ...golden, rootDeclared: [] })).toBe(base);
    expect(computeStackDigest({ ...golden, coverage: { unsupported: [], filesScanned: 0 } })).toBe(base);
    expect(computeStackDigest({ ...golden, nodes: golden.nodes.map((n) => ({ ...n, layout: ['elsewhere'] })) })).toBe(base);
  });

  it('a hashed field must move the digest: a node version, an integrity, the runtime, an image', () => {
    const base = computeStackDigest(golden);
    const bump = golden.nodes.map((n) => (n.name === 'zod' ? { ...n, version: '4.6.6', id: 'npm:zod@4.6.6' } : n));
    expect(computeStackDigest({ ...golden, nodes: bump })).not.toBe(base);
    const flip = golden.nodes.map((n) => (n.name === 'zod' ? { ...n, integrity: `${n.integrity?.slice(0, -2)}AA` } : n));
    expect(computeStackDigest({ ...golden, nodes: flip })).not.toBe(base);
    expect(computeStackDigest({ ...golden, runtime: { node: { declared: '22.22.2', resolvedFrom: 'nvmrc', pin: true } } })).not.toBe(base);
    expect(
      computeStackDigest({
        ...golden,
        images: [{ ref: 'node:22', name: 'node', tag: '22', tagImplicit: false, digest: null, pin: false, resolved: false, resolvedFrom: 'dockerfile', evidenceRef: 'Dockerfile#L1' }],
      }),
    ).not.toBe(base);
  });

  it('EVERY hashed node field moves the digest on its own (no field rides on another — id and version are independent)', () => {
    const base = computeStackDigest(golden);
    const sample = golden.nodes.find((n) => n.name === 'zod')!;
    const hashedKeys = Object.keys(sample).filter((k) => k !== 'layout').sort();
    expect(hashedKeys).toEqual(['dev', 'devOptional', 'id', 'installScript', 'integrity', 'kind', 'name', 'optional', 'peer', 'platformConditional', 'resolvedFrom', 'resolvedWhenUnpinned', 'root', 'version']);
    const perturb = (v: unknown): unknown => {
      if (typeof v === 'boolean') return !v;
      if (typeof v === 'string') return `${v}x`;
      if (v === null) return 'x';
      return { os: ['zz'], cpu: [] };
    };
    for (const k of hashedKeys) {
      const nodes = golden.nodes.map((n) => (n === sample ? { ...n, [k]: perturb((n as unknown as Record<string, unknown>)[k]) } : n));
      expect(computeStackDigest({ ...golden, nodes: nodes as typeof golden.nodes }), `field '${k}' alone did not move the digest`).not.toBe(base);
    }
  });

  it('a tampered committed manifest is caught by the tamper field, not by the identity', () => {
    const tampered = { ...golden, coverage: { ...golden.coverage, unsupported: [] } };
    const v = verifyStackManifest(tampered);
    expect(v.stackDigestOk).toBe(true); // coverage is quarantined — the identity is untouched
    expect(v.manifestDigestOk).toBe(false); // but the file was edited after extraction
    expect(v.valid).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* 2 + 3. mutation and negative controls                                       */
/* -------------------------------------------------------------------------- */

/** Reverse every object's key order recursively — the same JSON value, different bytes. */
function reverseKeys(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(reverseKeys);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v as Record<string, unknown>).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
  return out;
}

describe('stack slice 1 — group 3: negative controls (byte-different lockfile, same closure)', () => {
  it('keys reversed + 4-space indent + trailing newline stripped ⇒ same stackDigest, different sources[].sha256', () => {
    const d = copyTree('reserialized');
    const lock = readLock(d);
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), JSON.stringify(reverseKeys(lock), null, 4)); // no trailing \n
    expect(fs.readFileSync(path.join(d, 'npm-shrinkwrap.json')).equals(fs.readFileSync(path.join(FIXTURE_TREE, 'npm-shrinkwrap.json')))).toBe(false);
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    const goldenSha = golden.sources.find((s) => s.path === 'npm-shrinkwrap.json')?.sha256;
    const newSha = r.manifest.sources.find((s) => s.path === 'npm-shrinkwrap.json')?.sha256;
    expect(newSha).not.toBe(goldenSha); // the file changed…
    expect(r.manifest.manifestDigest).not.toBe(golden.manifestDigest); // …and the manifest says so…
    expect(r.manifest.nodes).toEqual(golden.nodes); // …while the closure is identical
    expect(r.manifest.edges).toEqual(golden.edges);
  });

  it('CRLF line endings ⇒ same stackDigest', () => {
    const d = copyTree('crlf');
    const text = fs.readFileSync(path.join(d, 'npm-shrinkwrap.json'), 'utf8').replace(/\n/g, '\r\n');
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), text);
    fs.writeFileSync(path.join(d, '.nvmrc'), '22\r\n');
    expect(digestOf(d)).toBe(golden.stackDigest);
  });

  it('renamed to package-lock.json ⇒ same stackDigest, sources[].path differs', () => {
    const d = copyTree('renamed');
    fs.renameSync(path.join(d, 'npm-shrinkwrap.json'), path.join(d, 'package-lock.json'));
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.sources.map((s) => s.path)).toEqual(['.nvmrc', 'package-lock.json', 'package.json']);
  });

  it('a different revision of the same closure ⇒ same stackDigest, different ctRepoRevision', () => {
    const r = extractStackManifest(FIXTURE_TREE, 'e0f7344'.padEnd(40, '0'));
    expect(r.manifest.stackDigest).toBe(golden.stackDigest);
    expect(r.manifest.ctRepoRevision).not.toBe(golden.ctRepoRevision);
  });
});

describe('stack slice 1 — group 2: a real closure change moves the digest', () => {
  it('zod 4.6.5 → 4.6.6 in a copied lockfile ⇒ different stackDigest, exactly one node differs', () => {
    const d = copyTree('bump');
    const lock = readLock(d);
    const pkgs = lock.packages as Record<string, Record<string, unknown>>;
    expect(pkgs['node_modules/zod']?.version).toBe('4.6.5');
    pkgs['node_modules/zod']!.version = '4.6.6';
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), `${JSON.stringify(lock, null, 2)}\n`);
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest);
    expect(r.manifest.nodes.find((n) => n.name === 'zod')?.id).toBe('npm:zod@4.6.6');
    const others = r.manifest.nodes.filter((n) => n.name !== 'zod');
    expect(others).toEqual(golden.nodes.filter((n) => n.name !== 'zod'));
  });

  it('one integrity character flipped ⇒ different stackDigest (rewritten, same name@version)', () => {
    const d = copyTree('integrity');
    const lock = readLock(d);
    const zod = (lock.packages as Record<string, Record<string, unknown>>)['node_modules/zod']!;
    const integrity = zod.integrity as string;
    zod.integrity = `${integrity.slice(0, -3)}${integrity.endsWith('A==') ? 'B==' : 'A=='}`;
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), `${JSON.stringify(lock, null, 2)}\n`);
    expect(digestOf(d)).not.toBe(golden.stackDigest);
  });

  it('a runtime pin change (.nvmrc 22 → 22.22.2) ⇒ different stackDigest, pin:true', () => {
    const d = copyTree('runtime');
    fs.writeFileSync(path.join(d, '.nvmrc'), 'v22.22.2\n');
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.manifest.runtime).toEqual({ node: { declared: '22.22.2', resolvedFrom: 'nvmrc', pin: true } });
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. refusal legs                                                             */
/* -------------------------------------------------------------------------- */

function minimalPackageJson(dir: string): void {
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'example-app', version: '1.2.3' }, null, 2)}\n`);
}

describe('stack slice 1 — group 5: refusal legs (fixed strings, exit 2, nothing written)', () => {
  it('pnpm-lock.yaml only ⇒ refusal carries the exact pnpm string + the no-lockfile string; root-only manifest', () => {
    const d = tmp('pnpm');
    minimalPackageJson(d);
    fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies: {}\n");
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([STACK_REFUSAL_PNPM, STACK_REFUSAL_NO_LOCKFILE]);
    expect(r.manifest.coverage.unsupported).toContain(STACK_REFUSAL_PNPM);
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm')).toHaveLength(1);
    expect(r.manifest.nodes[0]?.root).toBe(true);
    expect(r.manifest.nodes[0]?.id).toBe('npm:example-app@1.2.3');
  });

  it('the built CLI refuses a pnpm-only tree: exit 2, stderr carries the exact string, --out is NOT written', () => {
    const d = tmp('pnpm-cli');
    minimalPackageJson(d);
    fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const out = path.join(d, 'never-written.json');
    const r = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("lockfile 'pnpm-lock.yaml' present but not supported in stack slice 1");
    expect(r.stderr).toContain(STACK_REFUSAL_PNPM);
    expect(r.stderr).toContain('REFUSED');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('yarn.lock only ⇒ the exact yarn string', () => {
    const d = tmp('yarn');
    minimalPackageJson(d);
    fs.writeFileSync(path.join(d, 'yarn.lock'), '# yarn lockfile v1\n');
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([STACK_REFUSAL_YARN, STACK_REFUSAL_NO_LOCKFILE]);
  });

  it('lockfileVersion 2 ⇒ the exact version-refusal string', () => {
    const d = tmp('v2');
    minimalPackageJson(d);
    fs.writeFileSync(path.join(d, 'package-lock.json'), `${JSON.stringify({ name: 'example-app', lockfileVersion: 2, packages: {}, dependencies: {} })}\n`);
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toContain(stackRefusalLockfileVersion(2));
    expect(r.refusals).toContain(STACK_REFUSAL_NO_LOCKFILE);
    expect(stackRefusalLockfileVersion(2)).toBe(
      "lockfileVersion 2 is not 3: npm v1/v2 lockfiles are refused (their 'dependencies' tree is not a closure map); regenerate with npm >= 7",
    );
  });

  it('a truncated lockfile ⇒ refusal (never a silent partial manifest)', () => {
    const d = copyTree('truncated');
    const bytes = fs.readFileSync(path.join(d, 'npm-shrinkwrap.json'));
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), bytes.subarray(0, Math.floor(bytes.length / 2)));
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals.some((x) => x.startsWith("lockfile 'npm-shrinkwrap.json' is not valid JSON"))).toBe(true);
    expect(r.refusals).toContain(STACK_REFUSAL_NO_LOCKFILE);
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', path.join(d, 'x.json')], ROOT);
    expect(cli.status).toBe(2);
    expect(fs.existsSync(path.join(d, 'x.json'))).toBe(false);
  });

  it('no lockfile at all ⇒ the no-lockfile string, exit 2', () => {
    const d = tmp('none');
    minimalPackageJson(d);
    expect(extractStackManifest(d, 'unpinned').refusals).toEqual([STACK_REFUSAL_NO_LOCKFILE]);
    expect(runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin'], d).status).toBe(2);
  });

  it('a supported lockfile beside pnpm-lock.yaml is NOT a refusal — the pnpm string stays a coverage note', () => {
    const d = copyTree('mixed');
    fs.writeFileSync(path.join(d, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.coverage.unsupported).toContain(STACK_REFUSAL_PNPM);
    expect(r.manifest.stackDigest).toBe(golden.stackDigest); // coverage is quarantined
  });

  it('Dockerfile: `FROM ${BASE}` ⇒ coverage line + no image node; `@sha256:` ⇒ pin:true; bare ref ⇒ latest implicit; stage alias dropped', () => {
    const d = copyTree('dockerfile');
    const hex = 'a'.repeat(64);
    fs.writeFileSync(
      path.join(d, 'Dockerfile'),
      [
        'ARG BASE=node:22',
        '# a comment FROM nowhere',
        'FROM ${BASE} AS deps',
        `FROM node:22-alpine@sha256:${hex} \\`,
        '  AS build',
        'FROM alpine',
        'FROM build',
        'FROM --platform=linux/amd64 ghcr.io/example/app:1.2.3',
        '',
      ].join('\n'),
    );
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.coverage.unsupported).toContain('Dockerfile Dockerfile:3 FROM uses ARG substitution: unresolved base image');
    expect(r.manifest.coverage.unsupported).not.toContain(STACK_COVERAGE_NO_IMAGES);
    expect(r.manifest.images.map((i) => [i.name, i.tag, i.tagImplicit, i.pin, i.evidenceRef])).toEqual([
      ['alpine', 'latest', true, false, 'Dockerfile#L6'],
      ['ghcr.io/example/app', '1.2.3', false, false, 'Dockerfile#L8'],
      ['node', '22-alpine', false, true, 'Dockerfile#L4'],
    ]);
    const pinned = r.manifest.images.find((i) => i.name === 'node');
    expect(pinned?.digest).toBe(`sha256:${hex}`);
    expect(r.manifest.images.every((i) => i.resolved === false)).toBe(true);
    const imageNodes = r.manifest.nodes.filter((n) => n.kind === 'oci-image').map((n) => n.id);
    expect(imageNodes).toEqual(['oci-image:alpine@latest', 'oci-image:ghcr.io/example/app@1.2.3', `oci-image:node@sha256:${hex}`]);
    expect(r.manifest.stackDigest).not.toBe(golden.stackDigest); // images are hashed
  });

  it('compose: line-anchored image: read; ${VAR} refs are coverage lines', () => {
    const d = copyTree('compose');
    fs.writeFileSync(path.join(d, 'docker-compose.yml'), 'services:\n  db:\n    image: "postgres:15"\n  app:\n    image: ${REGISTRY}/app:latest\n  worker:\n    build: .\n');
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.manifest.images.map((i) => [i.ref, i.resolvedFrom, i.evidenceRef])).toEqual([['postgres:15', 'compose', 'docker-compose.yml#L3']]);
    expect(r.manifest.coverage.unsupported).toContain('compose docker-compose.yml:5 image uses variable interpolation: unresolved image ref');
  });

  it('runtime precedence: .node-version wins over engines.node; engines alone is a range, not a pin', () => {
    const d = copyTree('runtime-precedence');
    fs.rmSync(path.join(d, '.nvmrc'));
    fs.writeFileSync(path.join(d, '.node-version'), '22.22.2\n');
    expect(extractStackManifest(d, SEED_COMMIT).manifest.runtime).toEqual({ node: { declared: '22.22.2', resolvedFrom: 'node-version', pin: true } });
    fs.rmSync(path.join(d, '.node-version'));
    expect(extractStackManifest(d, SEED_COMMIT).manifest.runtime).toEqual({ node: { declared: '>=22', resolvedFrom: 'engines', pin: false } });
  });

  it('parseImageRef + scanDockerfile unit shapes (registry ports keep their colon)', () => {
    expect(parseImageRef('localhost:5000/team/app')).toEqual({ name: 'localhost:5000/team/app', tag: 'latest', tagImplicit: true, digest: null });
    expect(parseImageRef('localhost:5000/team/app:1.0')).toEqual({ name: 'localhost:5000/team/app', tag: '1.0', tagImplicit: false, digest: null });
    expect(parseImageRef('node@sha256:abc')).toEqual({ name: 'node', tag: null, tagImplicit: false, digest: 'sha256:abc' });
    expect(scanDockerfile('x/Dockerfile', 'FROM scratch\nCOPY . .\n').images).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* schema conformance                                                          */
/* -------------------------------------------------------------------------- */

describe('stack slice 1 — the golden validates against the published stack-manifest.schema.json', () => {
  it('real extractor output conforms to the mechanically derived schema', () => {
    const schemas = generateSchemas();
    const ajv = new Ajv({ strict: false, allowUnionTypes: true });
    const validate = ajv.compile(schemas['stack-manifest.schema.json']!);
    expect(validate(JSON.parse(goldenBytes)), ajv.errorsText(validate.errors)).toBe(true);
    // and the strict schema rejects an unknown field (never a silent extra)
    expect(validate({ ...JSON.parse(goldenBytes), zzUnknown: 1 })).toBe(false);
    expect(() => parseStackManifest({ ...golden, zzUnknown: 1 })).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* adversarial legs — synthetic lockfiles (the seed fixture has 0 aliases / links / git deps) */
/* -------------------------------------------------------------------------- */

type Lock = { name: string; version: string; lockfileVersion: unknown; packages?: unknown };
type Pkgs = Record<string, Record<string, unknown> | null>;

function baseLock(): Lock & { packages: Pkgs } {
  return {
    name: 'r',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'r', version: '1.0.0', dependencies: { a: '^1.0.0', b: '^1.0.0' } },
      'node_modules/a': { version: '1.0.0', resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: 'sha512-AAAA', dependencies: { c: '^1.0.0' } },
      'node_modules/b': { version: '1.0.0', resolved: 'https://registry.npmjs.org/b/-/b-1.0.0.tgz', integrity: 'sha512-BBBB', dev: true, dependencies: { c: '^2.0.0' } },
      'node_modules/c': { version: '1.0.0', resolved: 'https://registry.npmjs.org/c/-/c-1.0.0.tgz', integrity: 'sha512-CCC1' },
      'node_modules/b/node_modules/c': { version: '2.0.0', resolved: 'https://registry.npmjs.org/c/-/c-2.0.0.tgz', integrity: 'sha512-CCC2', dev: true },
    },
  };
}
/** Materialize a synthetic tree; `files` adds/overrides extra files. */
function synth(lock: unknown, opts: { lockName?: string; files?: Record<string, string> } = {}): string {
  const d = tmp('synth');
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'r', version: '1.0.0' }));
  if (lock !== null) fs.writeFileSync(path.join(d, opts.lockName ?? 'package-lock.json'), JSON.stringify(lock));
  for (const [k, v] of Object.entries(opts.files ?? {})) {
    fs.mkdirSync(path.dirname(path.join(d, k)), { recursive: true });
    fs.writeFileSync(path.join(d, k), v);
  }
  return d;
}
function mutated(f: (pkgs: Pkgs) => void): ReturnType<typeof baseLock> {
  const l = baseLock();
  f(l.packages);
  return l;
}
const extractSynth = (lock: unknown, opts?: Parameters<typeof synth>[1]) => extractStackManifest(synth(lock, opts), 'unpinned');
const BASE_DIGEST = extractSynth(baseLock()).manifest.stackDigest;

describe('stack slice 1 — fail-closed: a hollow or malformed v3 lockfile is a refusal, never a root-only manifest', () => {
  const hollow: Array<[string, (l: Record<string, unknown>) => void, string]> = [
    ["'packages' key missing", (l) => { delete l.packages; }, "no 'packages' map"],
    ["'packages' is {}", (l) => { l.packages = {}; }, "no root '' entry in 'packages'"],
    ["'packages' is []", (l) => { l.packages = []; }, "no 'packages' map"],
    ['root entry only', (l) => { l.packages = { '': (l.packages as Pkgs)[''] }; }, 'no package beyond the root'],
  ];
  for (const [label, f, why] of hollow) {
    it(`${label} ⇒ refusal + exit 2 + nothing written`, () => {
      const l = baseLock() as unknown as Record<string, unknown>;
      f(l);
      const d = synth(l);
      const r = extractStackManifest(d, 'unpinned');
      expect(r.refusals).toContain(stackRefusalHollowLockfile('package-lock.json', why));
      expect(r.refusals).toContain(STACK_REFUSAL_NO_LOCKFILE);
      const out = path.join(d, 'out.json');
      const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
      expect(cli.status).toBe(2);
      expect(cli.stderr).toContain('is hollow');
      expect(fs.existsSync(out)).toBe(false);
    });
  }

  it('every non-root entry null ⇒ malformed-entry refusal (never a silent skip)', () => {
    const r = extractSynth(mutated((p) => { for (const k of Object.keys(p)) if (k !== '') p[k] = null; }));
    expect(r.refusals).toContain(stackRefusalMalformedEntry('package-lock.json', 'node_modules/a'));
    expect(r.refusals).toContain(STACK_REFUSAL_NO_LOCKFILE);
  });

  it('an EMPTY-STRING version ⇒ the fixed malformed-entry refusal (never a schema crash)', () => {
    const d = synth(mutated((p) => { p['node_modules/a']!.version = ''; }));
    expect(extractStackManifest(d, 'unpinned').refusals).toContain(stackRefusalMalformedEntry('package-lock.json', 'node_modules/a'));
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', path.join(d, 'o.json')], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('is malformed');
    expect(cli.stderr).not.toContain('unexpected CLI failure');
  });

  it('root + ONLY opaque entries is ACCEPTED (the digest is honest) — the floor is "no node AND no unmodeled entry beyond the root"', () => {
    const l = baseLock();
    l.packages = { '': l.packages['']!, 'node_modules/ws1': { resolved: 'packages/ws1', link: true } };
    const r = extractSynth(l);
    expect(r.refusals).toEqual([]);
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm').map((n) => n.root)).toEqual([true]);
    expect(r.manifest.unmodeled).toHaveLength(1);
    expect(stackRefusalHollowLockfile('x', 'y')).toContain('no node and no unmodeled entry beyond the root');
  });

  it('a numeric version ⇒ malformed-entry refusal', () => {
    const r = extractSynth(mutated((p) => { p['node_modules/a']!.version = 1; }));
    expect(r.refusals).toContain(stackRefusalMalformedEntry('package-lock.json', 'node_modules/a'));
  });

  it('lockfileVersion "3" (a string) is refused with a non-contradictory message', () => {
    const l = baseLock();
    l.lockfileVersion = '3';
    const r = extractSynth(l);
    expect(r.refusals[0]).toBe(stackRefusalLockfileVersion('3'));
    expect(r.refusals[0]?.startsWith('lockfileVersion "3" is not 3:')).toBe(true);
  });
});

describe('stack slice 1 — hoisting never reaches the digest (flags merge across every copy of one identity)', () => {
  const z = (dev: boolean): Record<string, unknown> => ({ version: '1.0.0', integrity: 'sha512-ZZ', ...(dev ? { dev: true } : {}) });
  const layouts: Array<[string, (p: Pkgs) => void]> = [
    ['top-level dev copy + nested prod copy', (p) => { p['node_modules/z'] = z(true); p['node_modules/a/node_modules/z'] = z(false); }],
    ['top-level prod copy + nested dev copy', (p) => { p['node_modules/z'] = z(false); p['node_modules/b/node_modules/z'] = z(true); }],
    ['two nested copies', (p) => { p['node_modules/a/node_modules/z'] = z(false); p['node_modules/b/node_modules/z'] = z(true); }],
  ];
  it('three layouts of ONE closure ⇒ one digest; dev = AND across copies', () => {
    const results = layouts.map(([, f]) => extractSynth(mutated(f)).manifest);
    const digests = new Set(results.map((m) => m.stackDigest));
    expect([...digests]).toHaveLength(1);
    for (const m of results) expect(m.nodes.find((n) => n.name === 'z')?.dev).toBe(false);
    // and the layout (the only thing that differs) is recorded, unhashed
    expect(new Set(results.map((m) => JSON.stringify(m.nodes.find((n) => n.name === 'z')?.layout))).size).toBe(3);
  });

  it('installScript = OR across copies; an all-dev identity stays dev', () => {
    const m = extractSynth(mutated((p) => {
      // the flag sits on the LATER-sorting path, so a first-copy-wins implementation would lose it
      p['node_modules/z'] = { ...z(true), hasInstallScript: true };
      p['node_modules/b/node_modules/z'] = { ...z(true) };
    })).manifest;
    const node = m.nodes.find((n) => n.name === 'z');
    expect(node?.dev).toBe(true);
    expect(node?.installScript).toBe(true);
  });

  it('devOptional is modeled and hashed', () => {
    const m = extractSynth(mutated((p) => { p['node_modules/a']!.devOptional = true; })).manifest;
    expect(m.nodes.find((n) => n.name === 'a')?.devOptional).toBe(true);
    expect(m.stackDigest).not.toBe(BASE_DIGEST);
  });
});

describe('stack slice 1 — an entry the extractor cannot model is an OPAQUE HASHED node (different closure ⇒ different digest)', () => {
  const cases: Array<[string, (p: Pkgs) => void, string, string, string]> = [
    ['npm: alias', (p) => { p['node_modules/alias'] = { name: 'realpkg', version: '6.6.6', integrity: 'sha512-EVIL', resolved: 'https://registry.npmjs.org/realpkg/-/realpkg-6.6.6.tgz' }; }, 'node_modules/alias', 'npm-alias', 'npm: alias at node_modules/alias — alias resolution owned-by-follow-on'],
    ['link: workspace entry', (p) => { p['node_modules/ws1'] = { resolved: 'packages/ws1', link: true }; }, 'node_modules/ws1', 'link', 'workspace/link entry node_modules/ws1: local package not part of the declared closure in slice 1'],
    ['workspace target', (p) => { p['packages/ws1'] = { version: '1.0.0', dependencies: { evil: '1' } }; }, 'packages/ws1', 'not-under-node-modules', 'workspace/link entry packages/ws1: local package not part of the declared closure in slice 1'],
    ['git dependency', (p) => { p['node_modules/g'] = { version: '1.0.0', resolved: 'git+ssh://git@github.com/x/g.git#abc' }; }, 'node_modules/g', 'local-or-git', 'workspace/link entry node_modules/g: local package not part of the declared closure in slice 1'],
    ['non-ASCII name', (p) => { p['node_modules/café'] = { version: '1.0.0', integrity: 'sha512-U' }; }, 'node_modules/café', 'non-ascii-name', 'non-ASCII package name at node_modules/café: not modeled (npm registry names are ASCII)'],
  ];
  for (const [label, f, key, reason, coverageLine] of cases) {
    it(`${label}: exit-0 manifest, digest MOVES, opaque node + the fixed coverage line, never a modeled node`, () => {
      const r = extractSynth(mutated(f));
      expect(r.refusals).toEqual([]);
      expect(r.manifest.stackDigest).not.toBe(BASE_DIGEST);
      expect(r.manifest.unmodeled.map((u) => [u.key, u.reason, u.kind])).toEqual([[key, reason, 'unsupported']]);
      expect(r.manifest.coverage.unsupported).toContain(coverageLine);
      // the modeled node set is exactly the base closure — nothing was ingested under a wrong name
      expect(r.manifest.nodes.map((n) => n.id).sort()).toEqual(extractSynth(baseLock()).manifest.nodes.map((n) => n.id).sort());
    });
  }

  it('a git commit change (#abc → #def) moves the digest', () => {
    const g = (c: string) => extractSynth(mutated((p) => { p['node_modules/g'] = { version: '1.0.0', resolved: `git+ssh://git@github.com/x/g.git#${c}` }; })).manifest.stackDigest;
    expect(g('abc')).not.toBe(g('def'));
  });

  it('a change INSIDE a workspace target (its declared deps) moves the digest', () => {
    const w = (dep: string) => extractSynth(mutated((p) => { p['packages/ws1'] = { version: '1.0.0', dependencies: { [dep]: '1' } }; })).manifest.stackDigest;
    expect(w('evil')).not.toBe(w('fine'));
  });

  it('integrity ABSENT ⇒ `resolved` is hashed (a re-pointed tarball moves the digest)', () => {
    const t = (url: string) => extractSynth(mutated((p) => { p['node_modules/g'] = { version: '1.0.0', resolved: url }; })).manifest;
    const a = t('https://codeload.github.com/x/g/tar.gz/abc');
    const b = t('https://codeload.github.com/x/g/tar.gz/EVIL');
    expect(a.stackDigest).not.toBe(b.stackDigest);
    expect(a.nodes.find((n) => n.name === 'g')?.resolvedWhenUnpinned).toBe('https://codeload.github.com/x/g/tar.gz/abc');
  });

  it('integrity PRESENT ⇒ `resolved` is NOT hashed (a mirror swap is content-neutral)', () => {
    const m = extractSynth(mutated((p) => { p['node_modules/a']!.resolved = 'https://mirror.example/a-1.0.0.tgz'; })).manifest;
    expect(m.stackDigest).toBe(BASE_DIGEST);
    expect(m.nodes.find((n) => n.name === 'a')?.resolvedWhenUnpinned).toBeNull();
  });

  it('missing vs empty-string integrity are different identities; a 3-way id collision keeps ids unique', () => {
    const m = extractSynth(mutated((p) => {
      p['node_modules/q@1'] = { version: '2', integrity: 'sha512-Q' };
      p['node_modules/q'] = { version: '1@2', integrity: 'sha512-Q' };
      p['node_modules/a/node_modules/q'] = { version: '1@2', integrity: '' };
    })).manifest;
    const ids = m.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(m.nodes.filter((n) => n.name.startsWith('q'))).toHaveLength(3);
  });
});

describe('stack slice 1 — the root package: its OWN version is quarantined; declared ranges never move the digest', () => {
  it('bumping ONLY the root version (lockfile + package.json) does NOT move the digest — a release is not a closure change', () => {
    const d = copyTree('root-bump');
    const lock = readLock(d);
    lock.version = '9.9.9';
    (lock.packages as Record<string, Record<string, unknown>>)['']!.version = '9.9.9';
    fs.writeFileSync(path.join(d, 'npm-shrinkwrap.json'), `${JSON.stringify(lock, null, 2)}\n`);
    const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')) as Record<string, unknown>;
    pkg.version = '9.9.9';
    fs.writeFileSync(path.join(d, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    const r = extractStackManifest(d, SEED_COMMIT);
    expect(r.manifest.nodes.find((n) => n.root)?.id).toBe('npm:bce-engine@9.9.9'); // still shown in the manifest…
    expect(r.manifest.nodes.find((n) => n.root)?.version).toBe('9.9.9');
    expect(r.manifest.stackDigest).toBe(golden.stackDigest); // …never in the identity
    const rootView = stackHashedView(r.manifest).nodes.find((n) => n.root) as unknown as Record<string, unknown>;
    expect(rootView.version).toBeUndefined();
    expect(rootView.id).toBe('root:bce-engine');
    expect(JSON.stringify(stackHashedView(r.manifest))).not.toContain('9.9.9');
  });

  it('renaming the root package DOES move the digest (a renamed fork is a different subject)', () => {
    const m = extractSynth({ ...baseLock(), packages: { ...baseLock().packages, '': { ...baseLock().packages['']!, name: 'forked' } } }).manifest;
    expect(m.stackDigest).not.toBe(BASE_DIGEST);
  });

  it('a spec-range-only change (root AND non-root) keeps the digest — and the manifest edges carry the new spec for the diff', () => {
    const m = extractSynth(mutated((p) => {
      (p['']!.dependencies as Record<string, string>).a = '^1.0.0 || ^2.0.0';
      (p['node_modules/a']!.dependencies as Record<string, string>).c = '>=1.0.0';
    })).manifest;
    expect(m.stackDigest).toBe(BASE_DIGEST);
    expect(m.nodes).toEqual(extractSynth(baseLock()).manifest.nodes); // identical resolved nodes
    expect(m.rootDeclared).toContainEqual({ name: 'a', spec: '^1.0.0 || ^2.0.0', group: 'dependencies' });
    expect((stackHashedView(m) as unknown as Record<string, unknown>).rootDeclared).toBeUndefined();
    expect(m.edges).toContainEqual({ from: 'npm:r@1.0.0', to: 'npm:a@1.0.0', spec: '^1.0.0 || ^2.0.0', dev: false, optional: false, peer: false });
    expect(m.edges.find((e) => e.from === 'npm:a@1.0.0' && e.to === 'npm:c@1.0.0')?.spec).toBe('>=1.0.0');
  });

  it('both root-identity fallback paths are quarantined too: root entry without a version (top-level version used / defaulted)', () => {
    const noRootVersion = (top: string | undefined) => {
      const l = baseLock() as unknown as Record<string, unknown>;
      delete (l.packages as Pkgs)['']!.version;
      if (top === undefined) delete l.version;
      else l.version = top;
      return extractSynth(l).manifest;
    };
    const a = noRootVersion('1.0.0');
    const b = noRootVersion('7.7.7');
    const c = noRootVersion(undefined); // defaults to 0.0.0 with a coverage line
    expect(b.nodes.find((n) => n.root)?.version).toBe('7.7.7');
    expect(c.nodes.find((n) => n.root)?.version).toBe('0.0.0');
    expect(new Set([a.stackDigest, b.stackDigest, c.stackDigest, BASE_DIGEST]).size).toBe(1);
  });

  it('top-level `version` disagreeing with packages[""].version is not a smuggling channel', () => {
    const l = baseLock();
    l.version = '6.6.6';
    const m = extractSynth(l).manifest;
    expect(m.stackDigest).toBe(BASE_DIGEST);
    expect(m.nodes.find((n) => n.root)?.version).toBe('1.0.0'); // the root entry wins for display
  });

  it('a NON-root package sharing the root\'s name (and version) is a real node: unique ids, digest moves, its version stays hashed', () => {
    const withTwin = (v: string) => extractSynth(mutated((p) => { p['node_modules/r'] = { version: v, integrity: 'sha512-RR' }; })).manifest;
    const same = withTwin('1.0.0'); // collides with the root's manifest id npm:r@1.0.0 → suffixed
    const other = withTwin('1.0.1');
    for (const m of [same, other]) expect(new Set(m.nodes.map((n) => n.id)).size).toBe(m.nodes.length);
    expect(same.stackDigest).not.toBe(BASE_DIGEST);
    expect(same.stackDigest).not.toBe(other.stackDigest); // the twin is NOT the root: its version is identity
    const twinView = stackHashedView(same).nodes.filter((n) => n.name === 'r');
    expect(twinView).toHaveLength(2);
    expect(twinView.filter((n) => 'version' in n)).toHaveLength(1);
  });

  it('the id-collision suffix on the root id does not leak the root version into the digest', () => {
    // same twin, root bumped: the twin's suffixed/unsuffixed MANIFEST id changes, its hashed identity must not
    const at = (rootVersion: string) => {
      const l = mutated((p) => { p['node_modules/r'] = { version: '1.0.0', integrity: 'sha512-RR' }; });
      l.packages['']!.version = rootVersion;
      return extractSynth(l).manifest;
    };
    expect(at('1.0.0').stackDigest).toBe(at('2.0.0').stackDigest);
  });
});

describe('stack slice 1 — lockfile precedence and symlink refusal', () => {
  it('npm-shrinkwrap.json wins over package-lock.json (npm\'s rule): the digest is the shrinkwrap\'s, with a coverage line', () => {
    const other = mutated((p) => { p['node_modules/a']!.version = '9.9.9'; });
    const both = synth(baseLock(), { lockName: 'npm-shrinkwrap.json', files: { 'package-lock.json': JSON.stringify(other) } });
    const r = extractStackManifest(both, 'unpinned');
    expect(r.refusals).toEqual([]);
    expect(r.manifest.stackDigest).toBe(BASE_DIGEST);
    expect(r.manifest.stackDigest).not.toBe(extractSynth(other).manifest.stackDigest);
    expect(r.manifest.coverage.unsupported).toContain("lockfile 'package-lock.json' ignored: npm-shrinkwrap.json takes precedence");
    expect(r.manifest.sources.map((s) => s.path)).toEqual(['npm-shrinkwrap.json', 'package.json']);
  });

  it('a malformed shrinkwrap is a refusal even when a good package-lock.json sits beside it', () => {
    const d = synth(baseLock(), { files: { 'npm-shrinkwrap.json': '{ truncated' } });
    expect(extractStackManifest(d, 'unpinned').refusals.length).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === 'win32')('a symlinked lockfile is refused (never followed to a host file outside the tree): exit 2, nothing written', () => {
    const outside = tmp('outside');
    fs.writeFileSync(path.join(outside, 'evil-lock.json'), JSON.stringify(baseLock()));
    const d = synth(null);
    fs.symlinkSync(path.join(outside, 'evil-lock.json'), path.join(d, 'package-lock.json'));
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toContain(stackRefusalSymlink('package-lock.json'));
    expect(r.manifest.nodes.filter((n) => n.kind === 'npm')).toHaveLength(1);
    const out = path.join(d, 'out.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', d, '--no-pin', '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('symbolic link');
    expect(fs.existsSync(out)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('a symlinked Dockerfile / .nvmrc is refused too; a COMMITTED symlink is refused on the pinned git-archive path', () => {
    const outside = tmp('outside2');
    fs.writeFileSync(path.join(outside, 'Dockerfile'), 'FROM evil:1\n');
    fs.writeFileSync(path.join(outside, 'lock.json'), JSON.stringify(baseLock()));
    const d = synth(baseLock());
    fs.symlinkSync(path.join(outside, 'Dockerfile'), path.join(d, 'Dockerfile'));
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([stackRefusalSymlink('Dockerfile')]);
    expect(r.manifest.images).toEqual([]);
    // pinned path: commit a symlinked lockfile, snapshot via --ref HEAD (git archive preserves the link)
    const repo = synth(null);
    fs.symlinkSync(path.join(outside, 'lock.json'), path.join(repo, 'package-lock.json'));
    const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'add', '-A');
    git('-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'symlinked lock');
    const out = path.join(tmp('pinned-out'), 'out.json');
    const cli = runCli(['stack', 'snapshot', '--ct-repo', repo, '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain(stackRefusalSymlink('package-lock.json'));
    expect(fs.existsSync(out)).toBe(false);
  });
});

describe('stack slice 1 — images and runtime hygiene', () => {
  it('a comment line above a FROM does NOT move the digest (evidenceRef is quarantined); a changed ref does', () => {
    const d1 = synth(baseLock(), { files: { Dockerfile: 'FROM node:22\n' } });
    const d2 = synth(baseLock(), { files: { Dockerfile: '# build image\nFROM node:22\n' } });
    const d3 = synth(baseLock(), { files: { Dockerfile: 'FROM node:23\n' } });
    const [m1, m2, m3] = [d1, d2, d3].map((d) => extractStackManifest(d, 'unpinned').manifest);
    expect(m2!.images[0]?.evidenceRef).toBe('Dockerfile#L2');
    expect(m2!.stackDigest).toBe(m1!.stackDigest);
    expect(m3!.stackDigest).not.toBe(m1!.stackDigest);
  });

  it('a malformed @sha256 digest is never a pin', () => {
    const m = extractStackManifest(synth(baseLock(), { files: { Dockerfile: 'FROM node:22@sha256:abc\n' } }), 'unpinned').manifest;
    expect(m.images[0]?.pin).toBe(false);
    expect(m.coverage.unsupported.some((u) => u.includes('malformed digest'))).toBe(true);
  });

  it('.nvmrc: first non-comment line only; an alias is recorded with a coverage line, never a multi-line id', () => {
    const m = extractStackManifest(synth(baseLock(), { files: { '.nvmrc': '# pin\nv22.1.0\n' } }), 'unpinned').manifest;
    expect(m.runtime.node).toEqual({ declared: '22.1.0', resolvedFrom: 'nvmrc', pin: true });
    const alias = extractStackManifest(synth(baseLock(), { files: { '.nvmrc': 'lts/*\n' } }), 'unpinned').manifest;
    expect(alias.runtime.node.pin).toBe(false);
    expect(alias.coverage.unsupported).toContain("node runtime 'lts/*' is an alias or range, not a version: recorded as declared, pin:false");
  });

  it('the SAME image set declared from different file locations ⇒ same digest (a quarantined field must not decide the hashed order)', () => {
    const compose = 'services:\n  app:\n    image: node:22\n';
    const m1 = extractStackManifest(synth(baseLock(), { files: { Dockerfile: 'FROM node:22\n', 'compose.yml': compose } }), 'unpinned').manifest;
    const m2 = extractStackManifest(synth(baseLock(), { files: { 'zz/Dockerfile': 'FROM node:22\n', 'compose.yml': compose } }), 'unpinned').manifest;
    expect(m1.images.map((i) => i.evidenceRef)).not.toEqual(m2.images.map((i) => i.evidenceRef));
    expect(m2.stackDigest).toBe(m1.stackDigest);
  });

  it.skipIf(process.platform === 'win32')('a symlinked DIRECTORY holding a Dockerfile is a refusal; an empty symlinked directory is a coverage line', () => {
    const outside = tmp('outside-dir');
    fs.writeFileSync(path.join(outside, 'Dockerfile'), 'FROM evil:1\n');
    const d = synth(baseLock());
    fs.symlinkSync(outside, path.join(d, 'docker'));
    const r = extractStackManifest(d, 'unpinned');
    expect(r.refusals).toEqual([stackRefusalSymlink('docker/Dockerfile')]);
    expect(r.manifest.images).toEqual([]);
    const empty = tmp('outside-empty');
    const d2 = synth(baseLock());
    fs.symlinkSync(empty, path.join(d2, 'assets'));
    const r2 = extractStackManifest(d2, 'unpinned');
    expect(r2.refusals).toEqual([]);
    expect(r2.manifest.coverage.unsupported).toContain("symlinked directory 'assets' is not walked for image files");
  });

  it('a Dockerfile below the depth-3 walk is NOT read — and the manifest says so', () => {
    const m = extractStackManifest(synth(baseLock(), { files: { 'a/b/c/d/Dockerfile': 'FROM deep:1\n' } }), 'unpinned').manifest;
    expect(m.images).toEqual([]);
    expect(m.coverage.unsupported).toContain(STACK_COVERAGE_IMAGE_WALK_DEPTH);
  });
});
