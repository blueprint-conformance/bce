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
  stackRefusalLockfileVersion,
} from '../src/stack/stack-extractor.js';

const ROOT = path.join(__dirname, '..');
const FIXTURE_TREE = path.join(ROOT, 'fixtures', 'stack', 'a949557-tree');
const GOLDEN_PATH = path.join(ROOT, 'fixtures', 'stack', 'a949557.stack.json');
const SEED_COMMIT = 'a94955759bfbd6d34c6e1bde02bfc565cd1300d7';
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(ROOT, 'src', 'cli.ts');

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

  it('the fixture tree is the real seed commit (lockfile bytes match git) when history is available', () => {
    let available = false;
    try {
      execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${SEED_COMMIT}^{commit}`], { stdio: 'ignore' });
      available = true;
    } catch {
      /* shallow checkout: the fixture-tree half above already ran */
    }
    if (!available) return;
    const fromGit = execFileSync('git', ['-C', ROOT, 'show', `${SEED_COMMIT}:npm-shrinkwrap.json`]);
    expect(fromGit.equals(fs.readFileSync(path.join(FIXTURE_TREE, 'npm-shrinkwrap.json')))).toBe(true);
    // and a real git-archive materialization of the commit reproduces the golden too
    const tree = materializeAtRevision(ROOT, SEED_COMMIT);
    tempDirs.push(tree);
    const r = extractStackManifest(tree, SEED_COMMIT);
    expect(r.refusals).toEqual([]);
    expect(stableStringify(r.manifest)).toBe(goldenBytes);
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
    expect(hashedKeys).toEqual(['dev', 'id', 'installScript', 'integrity', 'kind', 'name', 'optional', 'peer', 'platformConditional', 'resolvedFrom', 'root', 'version']);
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
