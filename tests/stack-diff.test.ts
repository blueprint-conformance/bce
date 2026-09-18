/**
 * stack-diff.test.ts — the acceptance proof for `bce stack diff` (the per-node closure classifier).
 *
 * The seed corpus is three REAL revisions of this repository, committed as manifests written by
 * `bce stack snapshot`:
 *   47a51f4  base  (vitest 4.1.11)
 *   a949557  head  (vitest 5.0.0) — also the slice-1 golden
 *   e0f7344  the merge commit of the same bump: a byte-identical lockfile at a different revision
 *
 * Groups:
 *  A. SEMVER-LITE — the strict parser and SemVer 2.0.0 §11 precedence (no `semver` dependency).
 *  B. IDENTICAL — the same closure diffs to zero moves, exit 0 (SC-1).
 *  C. SEED TABLE — 47a51f4 → a949557 is exactly: vitest the sole root-declared forward, 7 transitive
 *     forwards (magic-string 0.30.21→1.3.1 among them, though 0.30.21 stays present), 0 added,
 *     7 removed, 0 backward / rewritten / unknown (SC-2).
 *  D. TWO-REVISION INVARIANCE — e0f7344 and a949557 share a digest and diff to zero moves; 47a51f4
 *     does not (memo group 4). Fixtures re-derive from git when the checkout carries the history.
 *  E. MUTATION — a lockfile version bump is exactly one `forward`; an integrity flip is `rewritten`;
 *     `version: "main"` is `unknown`, approvalBlocked, exit 2 (memo group 2, SC-3).
 *  F. ORDER INDEPENDENCE — permuting `nodes[]` / `edges[]` cannot move a byte of the report (SC-4).
 *  G. CLASSIFIER EDGES — backward, dropped copies, build metadata, flag flips, spec-only moves, an
 *     unexplained digest change, OPAQUE (`unsupported`) nodes failing closed, rank and sort order —
 *     on small synthetic manifests.
 *  H. CLI — refusals (missing flag, a repository instead of a manifest, a tampered manifest, a
 *     snapshot-only flag) write nothing and exit non-zero.
 *
 * Everything runs on temp copies; the repository and its fixtures are never mutated.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { stableStringify } from '../src/report.js';
import { materializeAtRevision } from '../src/pin.js';
import {
  finalizeStackManifest,
  parseStackManifest,
  stackNodeId,
  verifyStackManifest,
  type StackEdge,
  type StackManifest,
  type StackNode,
  type StackRootDeclared,
  type StackUnmodeled,
} from '../src/stack/stack-manifest.js';
import { extractStackManifest } from '../src/stack/stack-extractor.js';
import {
  compareSemverLite,
  diffStackManifests,
  parseSemverLite,
  stackDiffExitCode,
  STACK_DIFF_UNKNOWN_CLASSIFICATION,
  STACK_MOVE_RANK,
  type SemverLite,
  type StackMove,
} from '../src/stack/stack-diff.js';

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(ROOT, 'fixtures', 'stack');
const FIXTURE_TREE = path.join(FIXTURES, 'a949557-tree');
const DIST_CLI = path.join(ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(ROOT, 'src', 'cli.ts');

/** the revision label the fixture tree is extracted under (the slice-1 seed commit) */
const HEAD_SHA = 'a94955759bfbd6d34c6e1bde02bfc565cd1300d7';
const FILE = {
  base: path.join(FIXTURES, '47a51f4.stack.json'),
  head: path.join(FIXTURES, 'a949557.stack.json'),
  merge: path.join(FIXTURES, 'e0f7344.stack.json'),
} as const;

function load(file: string): StackManifest {
  return parseStackManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
}
const base = load(FILE.base);
const head = load(FILE.head);
const merge = load(FILE.merge);

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});
function tmp(label: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `bce-stack-diff-${label}-`));
  tempDirs.push(d);
  return d;
}
function copyTree(label: string): string {
  const d = tmp(label);
  for (const f of fs.readdirSync(FIXTURE_TREE)) fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(FIXTURE_TREE, f)));
  return d;
}
type Lock = { packages: Record<string, Record<string, unknown>> };
function mutateLock(dir: string, fn: (lock: Lock) => void): void {
  const p = path.join(dir, 'npm-shrinkwrap.json');
  const lock = JSON.parse(fs.readFileSync(p, 'utf8')) as Lock;
  fn(lock);
  fs.writeFileSync(p, JSON.stringify(lock, null, 2) + '\n');
}
function extract(dir: string): StackManifest {
  const r = extractStackManifest(dir, HEAD_SHA);
  expect(r.refusals).toEqual([]);
  return r.manifest;
}
function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return { status: typeof res.status === 'number' ? res.status : 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}
function rows(moves: readonly StackMove[], cls: StackMove['class']): string[] {
  return moves.filter((m) => m.class === cls).map((m) => `${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}`);
}
/** Deterministic non-identity permutation: reverse, then rotate by a third. */
function permute<T>(xs: readonly T[]): T[] {
  const r = [...xs].reverse();
  const k = Math.floor(r.length / 3);
  return [...r.slice(k), ...r.slice(0, k)];
}

/* ---- synthetic manifests for the classifier edges ---- */
function node(name: string, version: string, over: Partial<StackNode> = {}): StackNode {
  return {
    id: stackNodeId('npm', name, version),
    kind: 'npm',
    name,
    version,
    integrity: `sha512-${name}-${version}`,
    resolvedFrom: 'lockfile',
    dev: false,
    optional: false,
    peer: false,
    devOptional: false,
    resolvedWhenUnpinned: null,
    platformConditional: null,
    root: false,
    installScript: false,
    layout: [`node_modules/${name}`],
    ...over,
  };
}
const APP = node('app', '1.0.0', { root: true, integrity: null, layout: [''] });
function edge(from: StackNode, to: StackNode, spec: string): StackEdge {
  return { from: from.id, to: to.id, spec, dev: false, optional: false, peer: false };
}
function manifest(nodes: StackNode[], edges: StackEdge[] = [], runtimePin = false, unmodeled: StackUnmodeled[] = [], root: StackNode = APP, rootDeclared: StackRootDeclared[] = []): StackManifest {
  return finalizeStackManifest({
    schemaVersion: '1',
    kind: 'StackManifest',
    ctRepoRevision: 'synthetic',
    sources: [],
    nodes: [root, ...nodes],
    rootDeclared,
    edges,
    runtime: { node: { declared: null, resolvedFrom: null, pin: runtimePin } },
    images: [],
    unmodeled,
    coverage: { unsupported: [], filesScanned: 0 },
  });
}

/* -------------------------------------------------------------------------- */
/* A. semver-lite                                                              */
/* -------------------------------------------------------------------------- */

describe('stack diff — A: strict semver-lite', () => {
  it('accepts exactly x.y.z[-pre][+build] and refuses everything else', () => {
    for (const ok of ['0.0.0', '1.2.3', '10.20.30', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-0.3.7', '1.0.0-x-y-z.--', '1.0.0+build.5', '1.0.0-rc.1+sha.5114f85', '0.30.21']) {
      expect(parseSemverLite(ok), ok).not.toBeNull();
    }
    for (const bad of ['', '22', '1.2', 'v1.2.3', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03', '1.0.0-01', '1.0.0-', '1.0.0+', '1.0.0-a..b', '^1.2.3', '~1.2.3', '>=1.0.0', '1.x', '*', 'latest', 'main', 'github:user/repo#main', 'file:../x', ' 1.2.3', '1.2.3 ', '1.2.3\n']) {
      expect(parseSemverLite(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('orders the SemVer 2.0.0 section 11 chain, ignores build metadata, and never overflows', () => {
    const chain = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.1.0', '2.0.0', '10.0.0'];
    const p = (v: string): SemverLite => parseSemverLite(v) as SemverLite;
    for (let i = 0; i < chain.length; i++) {
      for (let j = 0; j < chain.length; j++) {
        expect(Math.sign(compareSemverLite(p(chain[i] as string), p(chain[j] as string))), `${chain[i]} vs ${chain[j]}`).toBe(Math.sign(i - j));
      }
    }
    expect(compareSemverLite(p('1.0.0+a'), p('1.0.0+b'))).toBe(0);
    // 20-digit components: a Number round trip would collapse these to equal
    expect(compareSemverLite(p('1.0.0-20260918123456789012'), p('1.0.0-20260918123456789013'))).toBe(-1);
    expect(compareSemverLite(p('99999999999999999999.0.0'), p('100000000000000000000.0.0'))).toBe(-1);
  });
});

/* -------------------------------------------------------------------------- */
/* B. identical                                                                */
/* -------------------------------------------------------------------------- */

describe('stack diff — B: an identical closure is an empty diff (SC-1)', () => {
  it('two extractions of the same tree diff to zero moves, classification identical, exit 0', () => {
    const r = diffStackManifests(extract(FIXTURE_TREE), extract(FIXTURE_TREE));
    expect(r.moves).toEqual([]);
    expect(r.classification).toBe('identical');
    expect(r.digestEqual).toBe(true);
    expect(r.approvalBlocked).toBe(false);
    expect(r.downgradeAckRequired).toBe(false);
    expect(Object.values(r.summary).every((n) => n === 0)).toBe(true);
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('the CLI agrees: exit 0 and an empty moves[] in the written report', () => {
    const out = path.join(tmp('same'), 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FILE.head, '--to', FILE.head, '--out', out], ROOT);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('classification identical');
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).moves).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* C. the measured seed table                                                  */
/* -------------------------------------------------------------------------- */

describe('stack diff — C: 47a51f4 -> a949557, the vitest 4 -> 5 bump (SC-2)', () => {
  const report = diffStackManifests(base, head);

  it('names exactly 8 forward moves: vitest root-declared, 7 transitive', () => {
    expect(rows(report.moves, 'forward')).toEqual([
      '@jridgewell/sourcemap-codec 1.5.5 -> 1.6.0',
      '@vitest/mocker 4.1.11 -> 5.0.0',
      '@vitest/spy 4.1.11 -> 5.0.0',
      'es-module-lexer 2.3.1 -> 2.3.2',
      'magic-string 0.30.21 -> 1.3.1',
      'picomatch 4.0.5 -> 4.0.7',
      'tinybench 2.9.0 -> 6.1.4',
      'vitest 4.1.11 -> 5.0.0',
    ]);
    const rootDeclared = report.moves.filter((m) => m.rootDeclared);
    expect(rootDeclared.map((m) => `${m.class} ${m.name}`)).toEqual(['forward vitest']);
    // the declared RANGE is quarantined out of the digest; the row carries it as the evidence that
    // the move was asked for by the root, read from the edges of each side
    expect(rootDeclared[0]?.rootSpec).toEqual({ from: '^4.1.11', to: '^5.0.0' });
    expect(report.moves.filter((m) => !m.rootDeclared).every((m) => m.rootSpec.from === null && m.rootSpec.to === null)).toBe(true);
  });

  it('names exactly 7 removed names and nothing added, backward, rewritten, spec-changed or unknown', () => {
    expect(rows(report.moves, 'removed')).toEqual([
      '@vitest/expect 4.1.11 -> -',
      '@vitest/pretty-format 4.1.11 -> -',
      '@vitest/runner 4.1.11 -> -',
      '@vitest/snapshot 4.1.11 -> -',
      '@vitest/utils 4.1.11 -> -',
      'convert-source-map 2.0.0 -> -',
      'tinyrainbow 3.1.1 -> -',
    ]);
    expect(report.moves.filter((m) => m.class === 'removed').every((m) => m.scope === 'name')).toBe(true);
    expect(report.summary).toEqual({ added: 0, removed: 7, forward: 8, backward: 0, rewritten: 0, 'spec-changed': 0, unknown: 0 });
    expect(report.moves).toHaveLength(15);
  });

  it('joins on the NAME: magic-string is forward although 0.30.21 is still present on the head side', () => {
    expect(base.nodes.filter((n) => n.name === 'magic-string').map((n) => n.version)).toEqual(['0.30.21']);
    expect(head.nodes.filter((n) => n.name === 'magic-string').map((n) => n.version)).toEqual(['0.30.21', '1.3.1']);
    const moves = report.moves.filter((m) => m.name === 'magic-string');
    expect(moves.map((m) => m.class)).toEqual(['forward']);
  });

  it('reads picomatch hoisting (3 nested paths -> 1 top-level) as layout, never as a move of its own', () => {
    const moves = report.moves.filter((m) => m.name === 'picomatch');
    expect(moves).toHaveLength(1);
    expect(moves[0]?.class).toBe('forward');
    expect(moves[0]?.layoutPaths).toEqual({ from: 3, to: 1 });
  });

  it('is not fail-closed: the rank puts removed above forward, nothing blocks, exit 0', () => {
    // The rank is binding (added|removed > forward), so with 7 removed names present the report's
    // TOP class is `removed`; `forward` is the top among the version moves.
    expect(report.classification).toBe('removed');
    expect(STACK_MOVE_RANK.removed).toBeGreaterThan(STACK_MOVE_RANK.forward);
    expect(report.digestEqual).toBe(false);
    expect(report.unexplainedDigestChange).toBe(false);
    expect(report.approvalBlocked).toBe(false);
    expect(report.downgradeAckRequired).toBe(false);
    expect(stackDiffExitCode(report)).toBe(0);
  });

  it('the reverse direction is the mirror image and FAILS CLOSED on 8 backward moves', () => {
    const reverse = diffStackManifests(head, base);
    expect(reverse.summary).toEqual({ added: 7, removed: 0, forward: 0, backward: 8, rewritten: 0, 'spec-changed': 0, unknown: 0 });
    expect(reverse.classification).toBe('backward');
    expect(reverse.downgradeAckRequired).toBe(true);
    expect(stackDiffExitCode(reverse)).toBe(2);
  });

  it('the CLI writes the same report bytes twice and exits 0', () => {
    const dir = tmp('seed');
    const o1 = path.join(dir, 'd1.json');
    const o2 = path.join(dir, 'd2.json');
    const r1 = runCli(['stack', 'diff', '--from', FILE.base, '--to', FILE.head, '--out', o1], ROOT);
    const r2 = runCli(['stack', 'diff', '--from', FILE.base, '--to', FILE.head, '--out', o2], ROOT);
    expect(r1.status, r1.stderr).toBe(0);
    expect(r2.status, r2.stderr).toBe(0);
    expect(r1.stdout).toContain('vitest  4.1.11 -> 5.0.0  [root-declared ^4.1.11 -> ^5.0.0]');
    expect(fs.readFileSync(o1, 'utf8')).toBe(stableStringify(report));
    expect(fs.readFileSync(o2, 'utf8')).toBe(fs.readFileSync(o1, 'utf8'));
  });
});

/* -------------------------------------------------------------------------- */
/* D. two-revision invariance                                                  */
/* -------------------------------------------------------------------------- */

describe('stack diff — D: same closure at two revisions, same digest (memo group 4)', () => {
  it('every committed seed manifest re-derives its own digests', () => {
    for (const m of [base, head, merge]) expect(verifyStackManifest(m).valid, m.ctRepoRevision).toBe(true);
    expect(base.ctRepoRevision.startsWith('47a51f4')).toBe(true);
    expect(head.ctRepoRevision.startsWith('a949557')).toBe(true);
    expect(merge.ctRepoRevision.startsWith('e0f7344')).toBe(true);
  });

  it('e0f7344 and a949557 share a stackDigest; 47a51f4 does not', () => {
    expect(merge.ctRepoRevision).not.toBe(head.ctRepoRevision);
    expect(merge.stackDigest).toBe(head.stackDigest);
    expect(merge.manifestDigest).not.toBe(head.manifestDigest); // the revision is in the file, not in the identity
    expect(base.stackDigest).not.toBe(head.stackDigest);
  });

  it('e0f7344 <-> a949557 diffs to zero moves in both directions', () => {
    for (const r of [diffStackManifests(merge, head), diffStackManifests(head, merge)]) {
      expect(r.moves).toEqual([]);
      expect(r.classification).toBe('identical');
      expect(r.digestEqual).toBe(true);
      expect(stackDiffExitCode(r)).toBe(0);
    }
  });

  it('the committed manifests are what `stack snapshot` extracts from git, when history is available', () => {
    for (const file of [FILE.base, FILE.head, FILE.merge]) {
      const committed = fs.readFileSync(file, 'utf8');
      const sha = load(file).ctRepoRevision;
      try {
        execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
      } catch {
        continue; // shallow checkout: the committed-fixture legs above already ran
      }
      const tree = materializeAtRevision(ROOT, sha);
      tempDirs.push(tree);
      const r = extractStackManifest(tree, sha);
      expect(r.refusals).toEqual([]);
      // identity always re-derives from git; the two manifests written from the FULL tree re-derive
      // byte-for-byte. The a949557 golden is written from the reduced fixture tree, so its non-hashed
      // `coverage` notes legitimately differ from a full-tree extraction — never its digest.
      expect(r.manifest.stackDigest, sha).toBe(load(file).stackDigest);
      if (file !== FILE.head) expect(stableStringify(r.manifest), sha).toBe(committed);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* E. mutation                                                                 */
/* -------------------------------------------------------------------------- */

describe('stack diff — E: lockfile mutants through the real extractor (memo group 2, SC-3)', () => {
  const clean = extract(FIXTURE_TREE);

  it('a version bump of one node is exactly one forward move', () => {
    const dir = copyTree('bump');
    mutateLock(dir, (l) => {
      (l.packages['node_modules/zod'] as Record<string, unknown>).version = '4.6.6';
    });
    const r = diffStackManifests(clean, extract(dir));
    expect(r.digestEqual).toBe(false);
    expect(r.moves.filter((m) => m.class !== 'spec-changed').map((m) => `${m.class} ${m.name} ${m.from} -> ${m.to}`)).toEqual(['forward zod 4.6.5 -> 4.6.6']);
    expect(r.moves.find((m) => m.name === 'zod')?.rootDeclared).toBe(true);
    expect(r.classification).toBe('forward');
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('one flipped integrity character is rewritten, naming the field', () => {
    const dir = copyTree('flip');
    mutateLock(dir, (l) => {
      const zod = l.packages['node_modules/zod'] as Record<string, unknown>;
      const integrity = zod.integrity as string;
      zod.integrity = integrity.slice(0, -3) + (integrity.at(-3) === 'A' ? 'B' : 'A') + integrity.slice(-2);
    });
    const r = diffStackManifests(clean, extract(dir));
    expect(r.moves.map((m) => `${m.class} ${m.name} ${m.from} -> ${m.to}`)).toEqual(['rewritten zod 4.6.5 -> 4.6.5']);
    expect(r.moves[0]?.reasons).toEqual(['same name+version, different integrity']);
    expect(r.classification).toBe('rewritten');
    expect(r.approvalBlocked).toBe(false);
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('version "main" is unknown: unknown-potential-backward, approvalBlocked, exit 2 — library and CLI', () => {
    const dir = copyTree('main');
    mutateLock(dir, (l) => {
      (l.packages['node_modules/zod'] as Record<string, unknown>).version = 'main';
    });
    const mutant = extract(dir);
    const r = diffStackManifests(clean, mutant);
    const zod = r.moves.filter((m) => m.name === 'zod');
    expect(zod.map((m) => `${m.class} ${m.from ?? '-'} -> ${m.to ?? '-'}`).sort()).toEqual(['unknown - -> main', 'unknown 4.6.5 -> -']);
    expect(zod.every((m) => m.approvalBlocked)).toBe(true);
    expect(r.moves.filter((m) => m.class !== 'unknown' && m.class !== 'spec-changed')).toEqual([]);
    expect(r.classification).toBe(STACK_DIFF_UNKNOWN_CLASSIFICATION);
    expect(r.classification).toBe('unknown-potential-backward');
    expect(r.approvalBlocked).toBe(true);
    expect(r.downgradeAckRequired).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);

    const work = tmp('main-cli');
    const mutantFile = path.join(work, 'mutant.stack.json');
    fs.writeFileSync(mutantFile, stableStringify(mutant));
    const out = path.join(work, 'diff.json');
    const cli = runCli(['stack', 'diff', '--from', FILE.head, '--to', mutantFile, '--out', out], ROOT);
    expect(cli.status, cli.stderr).toBe(2);
    expect(cli.stderr).toContain('FAILS CLOSED');
    expect(cli.stderr).toContain('unknown-potential-backward');
    const written = JSON.parse(fs.readFileSync(out, 'utf8')) as { approvalBlocked: boolean; classification: string };
    expect(written.approvalBlocked).toBe(true);
    expect(written.classification).toBe('unknown-potential-backward');
  });
});

/* -------------------------------------------------------------------------- */
/* F. order independence                                                       */
/* -------------------------------------------------------------------------- */

describe('stack diff — F: nodes[] / edges[] array order cannot move a report byte (SC-4)', () => {
  it('a permuted copy of the seed pair yields byte-identical report bytes', () => {
    const permA: StackManifest = { ...base, nodes: permute(base.nodes), edges: permute(base.edges) };
    const permB: StackManifest = { ...head, nodes: permute(head.nodes), edges: permute(head.edges) };
    // the precondition the fixture varies: same node SET, genuinely different array order
    expect(permA.nodes.map((n) => n.id)).not.toEqual(base.nodes.map((n) => n.id));
    expect(permB.nodes.map((n) => n.id)).not.toEqual(head.nodes.map((n) => n.id));
    expect([...permA.nodes.map((n) => n.id)].sort()).toEqual([...base.nodes.map((n) => n.id)].sort());
    expect([...permB.nodes.map((n) => n.id)].sort()).toEqual([...head.nodes.map((n) => n.id)].sort());
    // and the permutation reorders the MOVED names relative to each other, so an input-order sort would show
    const moved = new Set(diffStackManifests(base, head).moves.map((m) => m.name));
    const order = (m: StackManifest): string[] => m.nodes.filter((n) => moved.has(n.name)).map((n) => n.id);
    expect(order(permB)).not.toEqual(order(head));

    const want = stableStringify(diffStackManifests(base, head));
    expect(stableStringify(diffStackManifests(permA, permB))).toBe(want);
    expect(stableStringify(diffStackManifests(permA, head))).toBe(want);
    expect(stableStringify(diffStackManifests(base, permB))).toBe(want);
  });

  it('rows are in (rank desc, name) order', () => {
    const moves = diffStackManifests(base, head).moves;
    for (let i = 1; i < moves.length; i++) {
      const p = moves[i - 1] as StackMove;
      const c = moves[i] as StackMove;
      const rankOk = STACK_MOVE_RANK[p.class] > STACK_MOVE_RANK[c.class];
      const tieOk = STACK_MOVE_RANK[p.class] === STACK_MOVE_RANK[c.class] && p.name <= c.name;
      expect(rankOk || tieOk, `${p.class} ${p.name} before ${c.class} ${c.name}`).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* G. classifier edges                                                         */
/* -------------------------------------------------------------------------- */

describe('stack diff — G: classifier edges on synthetic manifests', () => {
  const sig = (r: ReturnType<typeof diffStackManifests>): string[] =>
    r.moves.map((m) => `${m.class}/${m.scope} ${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}`);

  it('a lower version is backward and fails closed without blocking approval outright', () => {
    const r = diffStackManifests(manifest([node('x', '2.0.0')]), manifest([node('x', '1.9.9')]));
    expect(sig(r)).toEqual(['backward/version x 2.0.0 -> 1.9.9']);
    expect(r.classification).toBe('backward');
    expect(r.approvalBlocked).toBe(false);
    expect(r.downgradeAckRequired).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('compares each head version against the MAX base version when several copies exist', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '5.0.0')]), manifest([node('x', '5.0.0'), node('x', '6.0.0'), node('x', '3.0.0')]));
    expect(sig(r)).toEqual(['backward/version x 5.0.0 -> 3.0.0', 'removed/version x 1.0.0 -> -', 'forward/version x 5.0.0 -> 6.0.0']);
  });

  it('a dropped lower copy is removed/version; a dropped HIGHEST copy is backward', () => {
    expect(sig(diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '2.0.0')])))).toEqual(['removed/version x 1.0.0 -> -']);
    expect(sig(diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '1.0.0')])))).toEqual(['backward/version x 2.0.0 -> 1.0.0']);
  });

  it('a prerelease of the same core is backward; build-metadata-only difference is unknown', () => {
    expect(sig(diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.0-rc.1')])))).toEqual(['backward/version x 1.0.0 -> 1.0.0-rc.1']);
    const r = diffStackManifests(manifest([node('x', '1.0.0+a')]), manifest([node('x', '1.0.0+b')]));
    expect(sig(r)).toEqual(['unknown/version x 1.0.0+a -> 1.0.0+b']);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('an ADDED node with a non-semver version is unknown; a REMOVED one is just removed', () => {
    const git = node('g', 'github:user/repo#main');
    const added = diffStackManifests(manifest([]), manifest([git]));
    expect(sig(added)).toEqual(['unknown/name g - -> github:user/repo#main']);
    expect(added.approvalBlocked).toBe(true);
    const removed = diffStackManifests(manifest([git]), manifest([]));
    expect(sig(removed)).toEqual(['removed/name g github:user/repo#main -> -']);
    expect(stackDiffExitCode(removed)).toBe(0);
    expect(sig(diffStackManifests(manifest([]), manifest([node('n', '1.0.0')])))).toEqual(['added/name n - -> 1.0.0']);
  });

  it('an UNCHANGED non-semver node never produces a row (identical manifests stay an empty diff)', () => {
    const git = node('g', 'main');
    const r = diffStackManifests(manifest([git, node('x', '1.0.0')]), manifest([git, node('x', '1.0.1')]));
    expect(sig(r)).toEqual(['forward/version x 1.0.0 -> 1.0.1']);
  });

  it('a flipped hashed flag on the same name+version is rewritten and names the field', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.0', { installScript: true, dev: true })]));
    expect(sig(r)).toEqual(['rewritten/version x 1.0.0 -> 1.0.0']);
    expect(r.moves[0]?.reasons).toEqual(['same name+version, different dev, installScript']);
    expect(r.digestEqual).toBe(false);
  });

  it('a layout-only change (hoisting) is not a move at all', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0', { layout: ['node_modules/a/node_modules/x', 'node_modules/b/node_modules/x'] })]), manifest([node('x', '1.0.0')]));
    expect(r.moves).toEqual([]);
    expect(r.digestEqual).toBe(true);
    expect(r.classification).toBe('identical');
  });

  it('a range-only move is spec-changed: digest-neutral, informational, exit 0', () => {
    const x = node('x', '1.2.3');
    const r = diffStackManifests(manifest([x], [edge(APP, x, '^1.0.0')]), manifest([x], [edge(APP, x, '^1.2.0')]));
    expect(sig(r)).toEqual(['spec-changed/edge x ^1.0.0 -> ^1.2.0']);
    expect(r.moves[0]?.declaredBy).toBe('root:app');
    expect(r.moves[0]?.rootDeclared).toBe(true);
    expect(r.digestEqual).toBe(true);
    expect(r.classification).toBe('spec-changed');
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('two manifests differing ONLY in the root version: zero rows, equal digests, exit 0', () => {
    const x = node('x', '1.2.3');
    const APP2 = node('app', '2.0.0', { root: true, integrity: null, layout: [''] });
    const a1 = manifest([x], [edge(APP, x, '^1.0.0')]);
    const a2 = manifest([x], [edge(APP2, x, '^1.0.0')], false, [], APP2);
    expect(a1.nodes.find((n) => n.root)?.version).toBe('1.0.0');
    expect(a2.nodes.find((n) => n.root)?.version).toBe('2.0.0');
    expect(a2.stackDigest).toBe(a1.stackDigest);
    for (const r of [diffStackManifests(a1, a2), diffStackManifests(a2, a1)]) {
      expect(r.moves).toEqual([]);
      expect(r.digestEqual).toBe(true);
      expect(r.classification).toBe('identical');
      expect(stackDiffExitCode(r)).toBe(0);
    }
  });

  it('a root-declared range move is still spec-changed across a root version bump', () => {
    const x = node('x', '1.2.3');
    const APP2 = node('app', '2.0.0', { root: true, integrity: null, layout: [''] });
    const r = diffStackManifests(manifest([x], [edge(APP, x, '^1.0.0')]), manifest([x], [edge(APP2, x, '^1.2.0')], false, [], APP2));
    expect(sig(r)).toEqual(['spec-changed/edge x ^1.0.0 -> ^1.2.0']);
    expect(r.moves[0]?.declaredBy).toBe('root:app');
    expect(r.moves[0]?.rootSpec).toEqual({ from: '^1.0.0', to: '^1.2.0' });
    expect(r.digestEqual).toBe(true);
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('root-declared evidence is read from manifest.rootDeclared when both sides carry it, exactly once', () => {
    const x = node('x', '1.2.3');
    const dep = (spec: string): StackRootDeclared[] => [{ name: 'x', spec, group: 'dependencies' }];
    // edges AND rootDeclared both present (what the real extractor writes): one row, not two
    const r = diffStackManifests(manifest([x], [edge(APP, x, '^1.0.0')], false, [], APP, dep('^1.0.0')), manifest([x], [edge(APP, x, '^1.2.0')], false, [], APP, dep('^1.2.0')));
    expect(sig(r)).toEqual(['spec-changed/edge x ^1.0.0 -> ^1.2.0']);
    expect(r.moves[0]?.rootDeclared).toBe(true);
    expect(r.moves[0]?.declaredBy).toBe('root:app');
    expect(r.moves[0]?.rootSpec).toEqual({ from: '^1.0.0', to: '^1.2.0' });
    expect(r.digestEqual).toBe(true);
    // the field, not the edges, is the source: a range the edges do not carry is still seen
    const fieldOnly = diffStackManifests(manifest([x], [], false, [], APP, dep('^1.0.0')), manifest([x], [], false, [], APP, dep('~1.2.0')));
    expect(sig(fieldOnly)).toEqual(['spec-changed/edge x ^1.0.0 -> ~1.2.0']);
    // on a moved node the range rides on the move row instead of a second row
    const moved = diffStackManifests(manifest([x], [], false, [], APP, dep('^1.0.0')), manifest([node('x', '2.0.0')], [], false, [], APP, dep('^2.0.0')));
    expect(sig(moved)).toEqual(['forward/version x 1.2.3 -> 2.0.0']);
    expect(moved.moves[0]?.rootDeclared).toBe(true);
    expect(moved.moves[0]?.rootSpec).toEqual({ from: '^1.0.0', to: '^2.0.0' });
  });

  it('a manifest that predates rootDeclared falls back to the edges leaving the root', () => {
    const x = node('x', '1.2.3');
    const old = manifest([x], [edge(APP, x, '^1.0.0')]);
    const legacy = { ...old } as Record<string, unknown>;
    delete legacy.rootDeclared;
    const r = diffStackManifests(legacy as unknown as StackManifest, manifest([node('x', '1.3.0')], [edge(APP, node('x', '1.3.0'), '^1.3.0')], false, [], APP, [{ name: 'x', spec: '^1.3.0', group: 'dependencies' }]));
    expect(sig(r)).toEqual(['forward/version x 1.2.3 -> 1.3.0']);
    expect(r.moves[0]?.rootSpec).toEqual({ from: '^1.0.0', to: '^1.3.0' });
  });

  it('a dependency that shares the root name is joined with dependencies, never with the root', () => {
    const twin1 = node('app', '0.1.0');
    const twin2 = node('app', '0.2.0');
    const r = diffStackManifests(manifest([twin1]), manifest([twin2]));
    expect(sig(r)).toEqual(['forward/version app 0.1.0 -> 0.2.0']);
  });

  it('a different root NAME is a different subject: unknown, fails closed; a changed root flag is rewritten', () => {
    const OTHER = node('other', '1.0.0', { root: true, integrity: null, layout: [''] });
    const renamed = diffStackManifests(manifest([]), manifest([], [], false, [], OTHER));
    expect(sig(renamed)).toEqual(['unknown/name app 1.0.0 -> -', 'unknown/name other - -> 1.0.0']);
    expect(stackDiffExitCode(renamed)).toBe(2);
    const SCRIPTED = node('app', '1.0.0', { root: true, integrity: null, layout: [''], installScript: true });
    const flagged = diffStackManifests(manifest([]), manifest([], [], false, [], SCRIPTED));
    expect(sig(flagged)).toEqual(['rewritten/name app 1.0.0 -> 1.0.0']);
    expect(flagged.moves[0]?.reasons).toEqual(['root package, different installScript']);
  });

  it('a digest change no node row explains FAILS CLOSED', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0')], [], false), manifest([node('x', '1.0.0')], [], true));
    expect(r.moves).toEqual([]);
    expect(r.digestEqual).toBe(false);
    expect(r.unexplainedDigestChange).toBe(true);
    expect(r.classification).toBe('unknown-potential-backward');
    expect(r.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  const alias = (version: string): StackUnmodeled => ({
    kind: 'unsupported',
    key: 'node_modules/my-alias',
    reason: 'npm-alias',
    spec: { name: 'real', version, resolved: `https://registry.example/real-${version}.tgz`, integrity: `sha512-real-${version}`, link: false },
    entrySha256: (version === '1.0.0' ? 'a' : 'b').repeat(64),
  });

  it('an unmodeled[] entry ADDED, REMOVED or CHANGED is unknown and fails closed — never added/removed', () => {
    const x = [node('x', '1.0.0')];
    const plain = manifest(x);
    const v1 = manifest(x, [], false, [alias('1.0.0')]);
    const v2 = manifest(x, [], false, [alias('2.0.0')]);
    const A = 'npm-alias sha256:aaaaaaaaaaaa';
    const B = 'npm-alias sha256:bbbbbbbbbbbb';
    const cases: [string, StackManifest, StackManifest, string][] = [
      ['added', plain, v1, `unknown/name node_modules/my-alias - -> ${A}`],
      ['removed', v1, plain, `unknown/name node_modules/my-alias ${A} -> -`],
      ['changed', v1, v2, `unknown/name node_modules/my-alias ${A} -> ${B}`],
    ];
    for (const [label, from, to, want] of cases) {
      const r = diffStackManifests(from, to);
      expect(sig(r), label).toEqual([want]);
      expect(r.moves[0]?.kind, label).toBe('unsupported');
      expect(r.moves[0]?.reasons[0], label).toContain(`unmodeled entry 'node_modules/my-alias' (npm-alias) ${label}`);
      expect(r.moves[0]?.approvalBlocked, label).toBe(true);
      expect(r.summary.added + r.summary.removed, label).toBe(0);
      expect(r.unexplainedDigestChange, label).toBe(false); // named by a row, not left to the fallback
      expect(r.classification, label).toBe('unknown-potential-backward');
      expect(r.approvalBlocked, label).toBe(true);
      expect(stackDiffExitCode(r), label).toBe(2);
    }
  });

  it('an UNCHANGED unmodeled[] entry never produces a row', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0')], [], false, [alias('1.0.0')]), manifest([node('x', '1.0.1')], [], false, [alias('1.0.0')]));
    expect(sig(r)).toEqual(['forward/version x 1.0.0 -> 1.0.1']);
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('a node of a kind the classifier cannot compare fails closed too (a later manifest revision)', () => {
    const plain = manifest([node('x', '1.0.0')]);
    const future = { ...node('y', '1.0.0'), kind: 'wasm-module' } as unknown as StackNode;
    const r = diffStackManifests(plain, { ...plain, nodes: [...plain.nodes, future] });
    expect(r.moves.map((m) => `${m.class} ${m.kind} ${m.name}`)).toEqual(['unknown wasm-module y']);
    expect(r.summary.added).toBe(0);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('a `resolvedWhenUnpinned` move on a node without integrity is rewritten, naming the field', () => {
    const at = (url: string): StackNode => node('x', '1.0.0', { integrity: null, resolvedWhenUnpinned: url });
    const r = diffStackManifests(manifest([at('https://registry.example/x-1.0.0.tgz')]), manifest([at('https://mirror.example/x-1.0.0.tgz')]));
    expect(sig(r)).toEqual(['rewritten/version x 1.0.0 -> 1.0.0']);
    expect(r.moves[0]?.reasons).toEqual(['same name+version, different resolvedWhenUnpinned']);
    expect(r.digestEqual).toBe(false);
  });

  it('rank: backward > unknown > rewritten > added|removed > forward > spec-changed', () => {
    const order = ['backward', 'unknown', 'rewritten', 'removed', 'forward', 'spec-changed'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(STACK_MOVE_RANK[order[i - 1] as StackMove['class']]).toBeGreaterThan(STACK_MOVE_RANK[order[i] as StackMove['class']]);
    }
    expect(STACK_MOVE_RANK.added).toBe(STACK_MOVE_RANK.removed);
    // backward outranks unknown in the reported top class, but the unknown still blocks approval
    const r = diffStackManifests(manifest([node('b', '2.0.0'), node('u', '1.0.0')]), manifest([node('b', '1.0.0'), node('u', 'main')]));
    expect(r.classification).toBe('backward');
    expect(r.approvalBlocked).toBe(true);
    expect(r.moves.map((m) => m.class)).toEqual(['backward', 'unknown', 'unknown']);
  });
});

/* -------------------------------------------------------------------------- */
/* H. CLI refusals                                                             */
/* -------------------------------------------------------------------------- */

describe('stack diff — H: the CLI takes manifests, refuses everything else, and writes nothing on refusal', () => {
  it('a missing --to is a usage error (exit 1)', () => {
    const out = path.join(tmp('usage'), 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FILE.head, '--out', out], ROOT);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--to <manifest.json> is required');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a repository directory instead of a manifest is refused (exit 2)', () => {
    const out = path.join(tmp('repo'), 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FIXTURE_TREE, '--to', FILE.head, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is not a StackManifest file');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a manifest edited after extraction is refused (exit 2) — a diff over a tampered input proves nothing', () => {
    const dir = tmp('tamper');
    const tampered = JSON.parse(fs.readFileSync(FILE.head, 'utf8')) as StackManifest;
    const zod = tampered.nodes.find((n) => n.name === 'zod') as StackNode;
    zod.version = '4.6.4';
    const file = path.join(dir, 'tampered.stack.json');
    fs.writeFileSync(file, stableStringify(tampered));
    const out = path.join(dir, 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FILE.head, '--to', file, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('recorded digests do not re-derive');
    expect(fs.existsSync(out)).toBe(false);
  });

  it('a non-manifest JSON file is refused (exit 2); a snapshot-only flag is a usage error (exit 1)', () => {
    const dir = tmp('junk');
    const out = path.join(dir, 'diff.json');
    const r = runCli(['stack', 'diff', '--from', path.join(ROOT, 'package.json'), '--to', FILE.head, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('is not a valid StackManifest');
    expect(fs.existsSync(out)).toBe(false);
    const f = runCli(['stack', 'diff', '--from', FILE.base, '--to', FILE.head, '--ct-repo', '.', '--out', out], ROOT);
    expect(f.status).toBe(1);
    expect(f.stderr).toContain('unknown option for bce stack: --ct-repo');
    // and the snapshot verb still refuses the diff flags
    const s = runCli(['stack', 'snapshot', '--ct-repo', FIXTURE_TREE, '--no-pin', '--from', FILE.base, '--out', out], ROOT);
    expect(s.status).toBe(1);
    expect(s.stderr).toContain('unknown option for bce stack: --from');
    expect(fs.existsSync(out)).toBe(false);
  });
});
