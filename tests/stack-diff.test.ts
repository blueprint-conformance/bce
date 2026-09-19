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
 *  C. SEED TABLE — 47a51f4 → a949557 is exactly: vitest the sole root-declared forward, 6 transitive
 *     forwards, ONE added copy (magic-string 1.3.1 beside the retained 0.30.21), 7 removed,
 *     0 backward / rewritten / flags-changed / unknown (SC-2).
 *  D. TWO-REVISION INVARIANCE — e0f7344 and a949557 share a digest and diff to zero moves; 47a51f4
 *     does not (memo group 4). One VISIBLE skipIf leg per fixture re-derives it from git.
 *  E. MUTATION — a lockfile version bump is exactly one `forward`; an integrity flip is `rewritten`,
 *     carries both integrity values and BLOCKS; `version: "main"` is `unknown`, exit 2 (SC-3).
 *  F. ORDER INDEPENDENCE — permuting `nodes[]` / `edges[]` cannot move a byte of the report (SC-4).
 *  G. CLASSIFIER EDGES — set matching (non-max patch bump, new lower copy, pairing from the top),
 *     precedence ties in every input order, non-semver on either side and among retained copies,
 *     flag moves (same version and riding a version move), spec-only moves, a hashed change no row
 *     of its sub-view explains (alone AND masked), re-derived digests, OPAQUE nodes, rank and ties.
 *  I. IMAGES + RUNTIME — real-extractor repros: a tag / digest / runtime move alone and masked by an
 *     unrelated bump; strict-version tags order; entering / leaving images; array permutation.
 *  J. ROOT DECLARATIONS — declare / un-declare / group move with nodes unchanged is informational.
 *  K. LOCKFILE FAMILY — different lockfile parsers on the two sides fail closed, both directions.
 *  H. CLI — refusals (missing flag, extra positional, a repository, a symlink, a tampered manifest,
 *     a schema violation naming its path, --out onto an input, a snapshot-only flag) write nothing.
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
  compareStackMoves,
  diffStackManifests,
  sortVersionsDesc,
  stackLockfileFamilies,
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

describe('stack diff — A2: the two orders are TOTAL — input order can never decide', () => {
  it('sortVersionsDesc breaks a precedence tie on the full version string, in every input order', () => {
    const expected = ['2.0.0', '1.0.0+b', '1.0.0+a', '1.0.0-rc.1'];
    expect(sortVersionsDesc(['1.0.0+a', '1.0.0+b', '2.0.0', '1.0.0-rc.1'])).toEqual(expected);
    expect(sortVersionsDesc(['1.0.0-rc.1', '2.0.0', '1.0.0+b', '1.0.0+a'])).toEqual(expected);
  });

  it('compareStackMoves separates two rows that tie on every named key by their canonical bytes, antisymmetrically', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.1')]));
    const one = r.moves[0] as StackMove;
    const two: StackMove = { ...one, layoutPaths: { from: 9, to: 9 } };
    expect(compareStackMoves(one, one)).toBe(0);
    expect(compareStackMoves(one, two)).not.toBe(0);
    expect(Math.sign(compareStackMoves(one, two))).toBe(-Math.sign(compareStackMoves(two, one)));
    expect([two, one].sort(compareStackMoves)).toEqual([one, two].sort(compareStackMoves));
  });
});

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

  it('names exactly 7 forward moves: vitest root-declared, 6 transitive', () => {
    expect(rows(report.moves, 'forward')).toEqual([
      '@jridgewell/sourcemap-codec 1.5.5 -> 1.6.0',
      '@vitest/mocker 4.1.11 -> 5.0.0',
      '@vitest/spy 4.1.11 -> 5.0.0',
      'es-module-lexer 2.3.1 -> 2.3.2',
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

  it('names exactly 7 removed names, ONE added copy, and nothing backward, rewritten, flags-changed, spec-changed or unknown', () => {
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
    expect(report.moves.filter((m) => m.class === 'removed').every((m) => !m.copy)).toBe(true);
    expect(rows(report.moves, 'added')).toEqual(['magic-string - -> 1.3.1']);
    expect(report.summary).toEqual({ added: 1, removed: 7, forward: 7, backward: 0, rewritten: 0, 'flags-changed': 0, 'spec-changed': 0, unknown: 0 });
    expect(report.moves).toHaveLength(15);
  });

  it('SET MATCHING: magic-string 1.3.1 is an ADDED COPY beside the retained 0.30.21 — never a whole-name add, never a move of 0.30.21', () => {
    expect(base.nodes.filter((n) => n.name === 'magic-string').map((n) => n.version)).toEqual(['0.30.21']);
    expect(head.nodes.filter((n) => n.name === 'magic-string').map((n) => n.version)).toEqual(['0.30.21', '1.3.1']);
    const moves = report.moves.filter((m) => m.name === 'magic-string');
    expect(moves.map((m) => `${m.class} ${m.from ?? '-'} -> ${m.to ?? '-'}`)).toEqual(['added - -> 1.3.1']);
    // the row says it is ONE COPY of a name that stays present — a reader can tell it from a new dependency
    expect(moves[0]?.copy).toBe(true);
    expect(moves[0]?.scope).toBe('version');
    expect(moves[0]?.retained).toEqual(['0.30.21']);
    // a whole-name add/remove is never flagged as a copy
    expect(report.moves.filter((m) => m.copy).map((m) => m.name)).toEqual(['magic-string']);
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

  it('the reverse direction is the mirror image and FAILS CLOSED on 7 backward moves', () => {
    const reverse = diffStackManifests(head, base);
    expect(reverse.summary).toEqual({ added: 7, removed: 1, forward: 0, backward: 7, rewritten: 0, 'flags-changed': 0, 'spec-changed': 0, unknown: 0 });
    expect(rows(reverse.moves, 'removed')).toEqual(['magic-string 1.3.1 -> -']);
    expect(reverse.moves.find((m) => m.class === 'removed')?.copy).toBe(true);
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

  // One VISIBLE leg per committed manifest: a leg whose commit is not in the local object store is
  // reported as SKIPPED, never passed silently. 47a51f4 and e0f7344 are on the default branch, so a
  // full-history checkout (ci.yml: fetch-depth 0) runs them. a949557 is the bump's BRANCH commit and
  // is reachable from no branch: it is skipped in CI and in a fresh clone, and runs only where that
  // commit was fetched by its full sha. Its digest is still pinned by the two legs above.
  const hasCommit = (sha: string): boolean => {
    try {
      execFileSync('git', ['-C', ROOT, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  for (const [label, file] of [['47a51f4', FILE.base], ['a949557', FILE.head], ['e0f7344', FILE.merge]] as const) {
    const sha = load(file).ctRepoRevision;
    it.skipIf(!hasCommit(sha))(`the committed ${label} manifest is what \`stack snapshot\` extracts from git at ${sha.slice(0, 7)}`, () => {
      expect(sha.startsWith(label)).toBe(true);
      const committed = fs.readFileSync(file, 'utf8');
      const tree = materializeAtRevision(ROOT, sha);
      tempDirs.push(tree);
      const r = extractStackManifest(tree, sha);
      expect(r.refusals).toEqual([]);
      // identity always re-derives from git; the two manifests written from the FULL tree re-derive
      // byte-for-byte. The a949557 golden is written from the reduced fixture tree, so its non-hashed
      // `coverage` notes legitimately differ from a full-tree extraction — never its digest.
      expect(r.manifest.stackDigest, sha).toBe(load(file).stackDigest);
      if (file !== FILE.head) expect(stableStringify(r.manifest), sha).toBe(committed);
    });
  }
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
    expect(r.moves[0]?.fields).toEqual(['integrity']);
    // BOTH integrity values ride on the row: a reviewer can tell a re-hash from a swapped artifact
    const before = clean.nodes.find((n) => n.name === 'zod')?.integrity as string;
    expect(r.moves[0]?.integrity?.from).toBe(before);
    expect(r.moves[0]?.integrity?.to).not.toBe(before);
    expect(r.moves[0]?.integrity?.to).toMatch(/^sha512-/);
    // different bytes under an unchanged name@version is the loudest signal this verb can see: it BLOCKS
    expect(r.classification).toBe('rewritten');
    expect(r.moves[0]?.approvalBlocked).toBe(true);
    expect(r.approvalBlocked).toBe(true);
    expect(r.downgradeAckRequired).toBe(false);
    expect(stackDiffExitCode(r)).toBe(2);
    // and the CLI line shows both values and exits 2, with the report still written
    const dir2 = tmp('flip-cli');
    const fa = path.join(dir2, 'a.json');
    const fb = path.join(dir2, 'b.json');
    const out = path.join(dir2, 'diff.json');
    fs.writeFileSync(fa, stableStringify(clean));
    fs.writeFileSync(fb, stableStringify(extract(dir)));
    const cli = runCli(['stack', 'diff', '--from', fa, '--to', fb, '--out', out], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stdout).toContain(`[integrity ${before} -> ${r.moves[0]?.integrity?.to ?? ''}]`);
    expect(cli.stdout).toContain('BLOCKS');
    expect(fs.existsSync(out)).toBe(true);
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

  it('SET MATCHING: a patch upgrade of a NON-MAX copy is one forward row, exit 0 — never a downgrade from the retained max', () => {
    // the jose shape: 4.15.9 -> 4.15.10 while 6.2.10 stays on both sides
    const r = diffStackManifests(manifest([node('jose', '4.15.9'), node('jose', '6.2.10')]), manifest([node('jose', '4.15.10'), node('jose', '6.2.10')]));
    expect(sig(r)).toEqual(['forward/version jose 4.15.9 -> 4.15.10']);
    expect(r.moves[0]?.retained).toEqual(['6.2.10']);
    expect(r.moves[0]?.copy).toBe(false);
    expect(r.classification).toBe('forward');
    expect(stackDiffExitCode(r)).toBe(0);
    // A{1,3} -> B{2,3}: the retained 3.0.0 is no move; 1 -> 2 is forward
    expect(sig(diffStackManifests(manifest([node('x', '1.0.0'), node('x', '3.0.0')]), manifest([node('x', '2.0.0'), node('x', '3.0.0')])))).toEqual(['forward/version x 1.0.0 -> 2.0.0']);
  });

  it('SET MATCHING: a NEW version BELOW a retained max is an added copy, exit 0 — not backward', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '1.0.0'), node('x', '1.5.0'), node('x', '2.0.0')]));
    expect(sig(r)).toEqual(['added/version x - -> 1.5.0']);
    expect(r.moves[0]?.copy).toBe(true);
    expect(r.moves[0]?.retained).toEqual(['1.0.0', '2.0.0']);
    expect(stackDiffExitCode(r)).toBe(0);
  });

  it('SET MATCHING: one-sided versions pair FROM THE TOP; leftovers are removed / added copies', () => {
    // A-only {1.0.0}, B-only {6.0.0, 3.0.0}, retained {5.0.0}: 1.0.0 pairs with the highest new version
    const r = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '5.0.0')]), manifest([node('x', '5.0.0'), node('x', '6.0.0'), node('x', '3.0.0')]));
    expect(sig(r)).toEqual(['added/version x - -> 3.0.0', 'forward/version x 1.0.0 -> 6.0.0']);
    // a real downgrade still pairs and still fails closed: A{2,1} -> B{1.5} is 2 -> 1.5 backward + a dropped copy
    const down = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '1.5.0')]));
    expect(sig(down)).toEqual(['backward/version x 2.0.0 -> 1.5.0', 'removed/version x 1.0.0 -> -']);
    expect(stackDiffExitCode(down)).toBe(2);
  });

  it('a dropped copy (lowest OR highest) of a name that stays present is removed/version, flagged as a copy', () => {
    const low = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '2.0.0')]));
    expect(sig(low)).toEqual(['removed/version x 1.0.0 -> -']);
    expect(low.moves[0]?.copy).toBe(true);
    expect(low.moves[0]?.retained).toEqual(['2.0.0']);
    const high = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0')]), manifest([node('x', '1.0.0')]));
    expect(sig(high)).toEqual(['removed/version x 2.0.0 -> -']);
    expect(high.moves[0]?.retained).toEqual(['1.0.0']);
  });

  it('spec-changed rows of one name order by (from, to, declaredBy) — the named keys decide before the canonical-bytes fallback', () => {
    const x = node('x', '1.0.0');
    const pa = node('a-parent', '1.0.0');
    const pb = node('b-parent', '1.0.0');
    const r = diffStackManifests(manifest([pa, pb, x], [edge(pa, x, '^2.0.0'), edge(pb, x, '^1.0.0')]), manifest([pa, pb, x], [edge(pa, x, '~2.0.0'), edge(pb, x, '~1.0.0')]));
    // `from` ascending puts b-parent's row first, although `declaredBy` (which sorts earlier in the row's bytes) says a-parent
    expect(r.moves.map((m) => `${m.from} ${m.declaredBy}`)).toEqual(['^1.0.0 npm:b-parent@1.0.0', '^2.0.0 npm:a-parent@1.0.0']);
  });

  it('two rows that tie on (rank, name, kind, class) are ordered by `from` ascending — never by insertion order', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0'), node('x', '2.0.0'), node('x', '3.0.0')]), manifest([node('x', '3.0.0')]));
    expect(sig(r)).toEqual(['removed/version x 1.0.0 -> -', 'removed/version x 2.0.0 -> -']);
    const added = diffStackManifests(manifest([node('x', '3.0.0')]), manifest([node('x', '1.0.0'), node('x', '2.0.0'), node('x', '3.0.0')]));
    expect(sig(added)).toEqual(['added/version x - -> 1.0.0', 'added/version x - -> 2.0.0']);
  });

  it('a prerelease of the same core is backward; build-metadata-only difference is unknown', () => {
    expect(sig(diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.0-rc.1')])))).toEqual(['backward/version x 1.0.0 -> 1.0.0-rc.1']);
    const r = diffStackManifests(manifest([node('x', '1.0.0+a')]), manifest([node('x', '1.0.0+b')]));
    expect(sig(r)).toEqual(['unknown/version x - -> 1.0.0+b', 'unknown/version x 1.0.0+a -> -']);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('precedence-equal versions are unknown in EVERY nodes[] order: same bytes, same exit code', () => {
    // A = {y@1.0.0+a, y@1.0.0+b}, B = {y@1.0.0+b}: the two A manifests differ ONLY in nodes[] order
    const ya = node('y', '1.0.0+a');
    const yb = node('y', '1.0.0+b');
    const sortedA = manifest([ya, yb]);
    const reversedA: StackManifest = { ...sortedA, nodes: [...sortedA.nodes].reverse() };
    expect(verifyStackManifest(reversedA).stackDigestOk).toBe(true);
    expect(reversedA.nodes.map((n) => n.id)).not.toEqual(sortedA.nodes.map((n) => n.id));
    const B = manifest([yb]);
    const r1 = diffStackManifests(sortedA, B);
    const r2 = diffStackManifests(reversedA, B);
    expect(sig(r1)).toEqual(['unknown/version y 1.0.0+a -> -']);
    expect(r1.moves[0]?.reasons[0]).toContain('equal semver precedence');
    expect(stableStringify(r2)).toBe(stableStringify(r1));
    expect(stackDiffExitCode(r1)).toBe(2);
    expect(stackDiffExitCode(r2)).toBe(2);
    // and the mirror image (the tie is on the HEAD side) is unknown too, in both orders
    const m1 = diffStackManifests(B, sortedA);
    const m2 = diffStackManifests(B, reversedA);
    expect(sig(m1)).toEqual(['unknown/version y - -> 1.0.0+a']);
    expect(stableStringify(m2)).toBe(stableStringify(m1));
    expect(stackDiffExitCode(m1)).toBe(2);
  });

  it('a non-semver version on the BASE side of a version move is unknown (both sides are checked)', () => {
    const r = diffStackManifests(manifest([node('x', 'main')]), manifest([node('x', '1.0.0')]));
    expect(sig(r)).toEqual(['unknown/version x - -> 1.0.0', 'unknown/version x main -> -']);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('EVERY version of the name must parse, not only the moved ones: a RETAINED non-semver copy makes a sibling move unknown', () => {
    const r = diffStackManifests(manifest([node('x', 'main'), node('x', '1.0.0')]), manifest([node('x', 'main'), node('x', '1.0.1')]));
    expect(sig(r)).toEqual(['unknown/version x - -> 1.0.1', 'unknown/version x 1.0.0 -> -']);
    expect(r.moves[0]?.reasons[0]).toContain("'main'");
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

  it('a same-version flag move is its own VISIBLE row (flags-changed); gaining an install script BLOCKS', () => {
    const r = diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.0', { installScript: true, dev: true })]));
    expect(sig(r)).toEqual(['flags-changed/version x 1.0.0 -> 1.0.0']);
    expect(r.moves[0]?.flagsChanged).toEqual([
      { flag: 'dev', from: false, to: true },
      { flag: 'installScript', from: false, to: true },
    ]);
    expect(r.moves[0]?.fields).toEqual(['dev', 'installScript']);
    expect(r.moves[0]?.integrity).toBeNull();
    expect(r.digestEqual).toBe(false);
    expect(r.unexplainedDigestChange).toBe(false);
    expect(r.classification).toBe('flags-changed');
    expect(r.moves[0]?.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
    // a flag move that gains NO install script is visible, explains the digest, and does not block
    const dev = diffStackManifests(manifest([node('x', '1.0.0', { dev: true })]), manifest([node('x', '1.0.0')]));
    expect(sig(dev)).toEqual(['flags-changed/version x 1.0.0 -> 1.0.0']);
    expect(dev.moves[0]?.flagsChanged).toEqual([{ flag: 'dev', from: true, to: false }]);
    expect(dev.moves[0]?.approvalBlocked).toBe(false);
    expect(dev.unexplainedDigestChange).toBe(false);
    expect(stackDiffExitCode(dev)).toBe(0);
    // LOSING an install script does not block either
    const lost = diffStackManifests(manifest([node('x', '1.0.0', { installScript: true })]), manifest([node('x', '1.0.0')]));
    expect(lost.moves[0]?.approvalBlocked).toBe(false);
    expect(stackDiffExitCode(lost)).toBe(0);
    // flags + integrity together is `rewritten` (the louder class) and still lists the flags
    const both = diffStackManifests(manifest([node('x', '1.0.0')]), manifest([node('x', '1.0.0', { dev: true, integrity: 'sha512-other' })]));
    expect(sig(both)).toEqual(['rewritten/version x 1.0.0 -> 1.0.0']);
    expect(both.moves[0]?.integrity).toEqual({ from: 'sha512-x-1.0.0', to: 'sha512-other' });
    expect(both.moves[0]?.flagsChanged).toEqual([{ flag: 'dev', from: false, to: true }]);
  });

  it('flags that RIDE on a version move are visible on the row and do not block', () => {
    const r = diffStackManifests(manifest([node('y', '1.0.0', { dev: true })]), manifest([node('y', '1.0.1', { installScript: true })]));
    expect(sig(r)).toEqual(['forward/version y 1.0.0 -> 1.0.1']);
    expect(r.moves[0]?.flagsChanged).toEqual([
      { flag: 'dev', from: true, to: false },
      { flag: 'installScript', from: false, to: true },
    ]);
    expect(r.moves[0]?.approvalBlocked).toBe(false);
    expect(stackDiffExitCode(r)).toBe(0);
    const dir = tmp('flags-cli');
    const fa = path.join(dir, 'a.json');
    const fb = path.join(dir, 'b.json');
    fs.writeFileSync(fa, stableStringify(manifest([node('y', '1.0.0', { dev: true })])));
    fs.writeFileSync(fb, stableStringify(manifest([node('y', '1.0.1', { installScript: true })])));
    const cli = runCli(['stack', 'diff', '--from', fa, '--to', fb, '--out', path.join(dir, 'o.json')], ROOT);
    expect(cli.status).toBe(0);
    expect(cli.stdout).toContain('[flags dev true -> false, installScript false -> true]');
  });

  it('a spec-changed row is never emitted on an edge whose endpoint was rewritten', () => {
    const x1 = node('x', '1.0.0');
    const x2 = node('x', '1.0.0', { integrity: 'sha512-other' });
    const p = node('p', '1.0.0');
    const r = diffStackManifests(manifest([p, x1], [edge(p, x1, '^1.0.0')]), manifest([p, x2], [edge(p, x2, '~1.0.0')]));
    expect(sig(r)).toEqual(['rewritten/version x 1.0.0 -> 1.0.0']);
    // control: with unchanged endpoints the same range move IS a spec-changed row
    const control = diffStackManifests(manifest([p, x1], [edge(p, x1, '^1.0.0')]), manifest([p, x1], [edge(p, x1, '~1.0.0')]));
    expect(sig(control)).toEqual(['spec-changed/edge x ^1.0.0 -> ~1.0.0']);
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

  it('a hashed change no row OF ITS OWN SUB-VIEW explains FAILS CLOSED — even in the company of other rows', () => {
    // an `oci-image` node is a projection of images[]; one that moves while images[] does not is a
    // manifest no extractor writes. No images row names it, so it is unexplained — alone …
    const img = (v: string): StackNode => ({ ...node('node', v, { integrity: null, resolvedFrom: 'dockerfile', layout: [] }), kind: 'oci-image', id: `oci-image:node@${v}` });
    const alone = diffStackManifests(manifest([node('x', '1.0.0'), img('22-alpine')]), manifest([node('x', '1.0.0'), img('18-alpine')]));
    expect(alone.moves).toEqual([]);
    expect(alone.digestEqual).toBe(false);
    expect(alone.unexplainedDigestChange).toBe(true);
    expect(alone.unexplained).toEqual(['nodes:oci-image/node']);
    expect(alone.classification).toBe('unknown-potential-backward');
    expect(alone.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(alone)).toBe(2);
    // … and MASKED by an unrelated forward bump AND a spec-changed row: neither explains it
    const p = node('p', '1.0.0');
    const masked = diffStackManifests(
      manifest([p, node('x', '1.0.0'), node('z', '1.0.0'), img('22-alpine')], [edge(p, node('z', '1.0.0'), '^1.0.0')]),
      manifest([p, node('x', '1.0.1'), node('z', '1.0.0'), img('18-alpine')], [edge(p, node('z', '1.0.0'), '~1.0.0')]),
    );
    expect(sig(masked)).toEqual(['forward/version x 1.0.0 -> 1.0.1', 'spec-changed/edge z ^1.0.0 -> ~1.0.0']);
    expect(masked.unexplained).toEqual(['nodes:oci-image/node']);
    expect(masked.classification).toBe('unknown-potential-backward');
    expect(stackDiffExitCode(masked)).toBe(2);
    // a spec-changed row ALONE explains nothing either
    const specOnly = diffStackManifests(
      manifest([p, node('z', '1.0.0'), img('22-alpine')], [edge(p, node('z', '1.0.0'), '^1.0.0')]),
      manifest([p, node('z', '1.0.0'), img('18-alpine')], [edge(p, node('z', '1.0.0'), '~1.0.0')]),
    );
    expect(sig(specOnly)).toEqual(['spec-changed/edge z ^1.0.0 -> ~1.0.0']);
    expect(specOnly.unexplainedDigestChange).toBe(true);
    expect(stackDiffExitCode(specOnly)).toBe(2);
  });

  it('the digests in the report are RE-DERIVED: a recorded stackDigest that lies is never trusted', () => {
    const A = manifest([node('x', '1.0.0')]);
    const B = manifest([node('x', '1.0.1')]);
    const lying: StackManifest = { ...B, stackDigest: A.stackDigest, stackId: A.stackId };
    const r = diffStackManifests(A, lying);
    expect(r.to.stackDigest).toBe(B.stackDigest);
    expect(r.to.stackDigest).not.toBe(lying.stackDigest);
    expect(r.to.stackId).toBe(B.stackId);
    expect(r.digestEqual).toBe(false);
    const lyingBase: StackManifest = { ...A, stackDigest: B.stackDigest, stackId: B.stackId };
    expect(diffStackManifests(lyingBase, B).from.stackDigest).toBe(A.stackDigest);
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
    // the ROW blocks, not only the report
    expect(r.moves[0]?.approvalBlocked).toBe(true);
    expect(r.moves.every((m) => m.class !== 'unknown' || m.approvalBlocked)).toBe(true);
    expect(r.summary.added).toBe(0);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('a `resolvedWhenUnpinned` move on a node without integrity is rewritten, naming the field', () => {
    const at = (url: string): StackNode => node('x', '1.0.0', { integrity: null, resolvedWhenUnpinned: url });
    const r = diffStackManifests(manifest([at('https://registry.example/x-1.0.0.tgz')]), manifest([at('https://mirror.example/x-1.0.0.tgz')]));
    expect(sig(r)).toEqual(['rewritten/version x 1.0.0 -> 1.0.0']);
    expect(r.moves[0]?.reasons).toEqual(['same name+version, different resolvedWhenUnpinned']);
    expect(r.digestEqual).toBe(false);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('rank: backward > unknown > rewritten|flags-changed > added|removed > forward > spec-changed', () => {
    expect(STACK_MOVE_RANK['flags-changed']).toBe(STACK_MOVE_RANK.rewritten);
    // inside one rank the louder class names the report — whatever the row order
    const tie = diffStackManifests(manifest([node('a', '1.0.0'), node('z', '1.0.0')]), manifest([node('a', '1.0.0', { dev: true }), node('z', '1.0.0', { integrity: 'sha512-other' })]));
    expect(tie.moves.map((m) => m.class)).toEqual(['flags-changed', 'rewritten']);
    expect(tie.classification).toBe('rewritten');
    const tie2 = diffStackManifests(manifest([node('a', '1.0.0', { integrity: 'sha512-other' }), node('z', '1.0.0')]), manifest([node('a', '1.0.0'), node('z', '1.0.0', { dev: true })]));
    expect(tie2.moves.map((m) => m.class)).toEqual(['rewritten', 'flags-changed']);
    expect(tie2.classification).toBe('rewritten');
    const addRemove = diffStackManifests(manifest([node('z', '1.0.0')]), manifest([node('a', '1.0.0')]));
    expect(addRemove.moves.map((m) => m.class)).toEqual(['added', 'removed']);
    expect(addRemove.classification).toBe('removed');
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
/* I. images[] and runtime: real rows, never masked                            */
/* -------------------------------------------------------------------------- */

describe('stack diff — I: image and runtime moves get rows of their OWN sub-view and are never masked by a node row', () => {
  const DIGEST_A = `sha256:${'ab'.repeat(32)}`;
  const DIGEST_B = `sha256:${'cd'.repeat(32)}`;
  /** a tiny repository for the REAL extractor: one dependency x, optionally a Dockerfile and an .nvmrc */
  function repo(label: string, o: { x: string; from?: string; nvmrc?: string; integrity?: string }): StackManifest {
    const dir = tmp(label);
    const pkg = { name: 'demo', version: '1.0.0', dependencies: { x: '^1.0.0' } };
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(
      path.join(dir, 'package-lock.json'),
      JSON.stringify({
        name: 'demo',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: { '': pkg, 'node_modules/x': { version: o.x, resolved: `https://registry.example/x/-/x-${o.x}.tgz`, integrity: o.integrity ?? 'sha512-AAAA' } },
      }),
    );
    if (o.from) fs.writeFileSync(path.join(dir, 'Dockerfile'), `FROM ${o.from}\n`);
    if (o.nvmrc) fs.writeFileSync(path.join(dir, '.nvmrc'), `${o.nvmrc}\n`);
    return extract(dir);
  }
  const line = (r: ReturnType<typeof diffStackManifests>): string[] => r.moves.map((m) => `${m.class}/${m.view} ${m.kind} ${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}`);

  it('an image TAG move is unknown ALONE and unknown IN COMPANY of an unrelated bump (the masked repro)', () => {
    const base0 = repo('img-base', { x: '1.0.0', from: `node:22-alpine@${DIGEST_A}` });
    const tagOnly = repo('img-tag', { x: '1.0.0', from: `node:18-alpine@${DIGEST_A}` });
    const tagAndBump = repo('img-tag-bump', { x: '1.0.1', from: `node:18-alpine@${DIGEST_A}` });
    const alone = diffStackManifests(base0, tagOnly);
    expect(line(alone)).toEqual([`unknown/images oci-image node node:22-alpine@${DIGEST_A} -> node:18-alpine@${DIGEST_A}`]);
    expect(stackDiffExitCode(alone)).toBe(2);
    const masked = diffStackManifests(base0, tagAndBump);
    expect(line(masked)).toEqual([`unknown/images oci-image node node:22-alpine@${DIGEST_A} -> node:18-alpine@${DIGEST_A}`, 'forward/nodes npm x 1.0.0 -> 1.0.1']);
    expect(masked.classification).toBe('unknown-potential-backward');
    expect(masked.unexplainedDigestChange).toBe(false);
    expect(masked.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(masked)).toBe(2);
  });

  it('same image ref, different DIGEST is rewritten: both digests on the row, blocks, exit 2', () => {
    const r = diffStackManifests(repo('dg-a', { x: '1.0.0', from: `node:22-alpine@${DIGEST_A}` }), repo('dg-b', { x: '1.0.1', from: `node:22-alpine@${DIGEST_B}` }));
    expect(line(r)).toEqual([`rewritten/images oci-image node node:22-alpine@${DIGEST_A} -> node:22-alpine@${DIGEST_B}`, 'forward/nodes npm x 1.0.0 -> 1.0.1']);
    expect(r.moves[0]?.integrity).toEqual({ from: DIGEST_A, to: DIGEST_B });
    expect(r.moves[0]?.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('a strict-version image tag orders: forward exit 0, backward exit 2; an unpinned moving tag that ENTERS is unknown', () => {
    const v = (tag: string): StackManifest => repo(`tag-${tag}`, { x: '1.0.0', from: `registry.example/app:${tag}` });
    const up = diffStackManifests(v('1.2.3'), v('1.2.4'));
    expect(line(up)).toEqual(['forward/images oci-image registry.example/app registry.example/app:1.2.3 -> registry.example/app:1.2.4']);
    expect(stackDiffExitCode(up)).toBe(0);
    const down = diffStackManifests(v('1.2.4'), v('1.2.3'));
    expect(down.moves.map((m) => m.class)).toEqual(['backward']);
    expect(stackDiffExitCode(down)).toBe(2);
    const none = repo('no-image', { x: '1.0.0' });
    const entersMoving = diffStackManifests(none, repo('enters-moving', { x: '1.0.0', from: 'node:22-alpine' }));
    expect(entersMoving.moves.map((m) => `${m.class}/${m.view}`)).toEqual(['unknown/images']);
    expect(stackDiffExitCode(entersMoving)).toBe(2);
    const entersPinned = diffStackManifests(none, repo('enters-pinned', { x: '1.0.0', from: `node:22-alpine@${DIGEST_A}` }));
    expect(entersPinned.moves.map((m) => `${m.class}/${m.view}`)).toEqual(['added/images']);
    expect(entersPinned.moves[0]?.integrity).toEqual({ from: null, to: DIGEST_A });
    expect(stackDiffExitCode(entersPinned)).toBe(0);
    const leaves = diffStackManifests(repo('leaves', { x: '1.0.0', from: 'node:22-alpine' }), none);
    expect(leaves.moves.map((m) => `${m.class}/${m.view}`)).toEqual(['removed/images']);
    expect(stackDiffExitCode(leaves)).toBe(0);
  });

  it('a runtime 22 -> 16 move is unknown ALONE and IN COMPANY of an unrelated bump (the masked repro)', () => {
    const base0 = repo('rt-base', { x: '1.0.0', nvmrc: '22' });
    const alone = diffStackManifests(base0, repo('rt-16', { x: '1.0.0', nvmrc: '16' }));
    expect(line(alone)).toEqual(['unknown/runtime node-runtime node 22 -> 16']);
    expect(stackDiffExitCode(alone)).toBe(2);
    const masked = diffStackManifests(base0, repo('rt-16-bump', { x: '1.0.1', nvmrc: '16' }));
    expect(line(masked)).toEqual(['unknown/runtime node-runtime node 22 -> 16', 'forward/nodes npm x 1.0.0 -> 1.0.1']);
    expect(masked.unexplainedDigestChange).toBe(false);
    expect(stackDiffExitCode(masked)).toBe(2);
  });

  it('an EXACT runtime version orders by semver; a runtime block that moves WITHOUT its node is still a runtime row', () => {
    const up = diffStackManifests(repo('rt-a', { x: '1.0.0', nvmrc: '22.1.0' }), repo('rt-b', { x: '1.0.0', nvmrc: '22.2.0' }));
    expect(line(up)).toEqual(['forward/runtime node-runtime node 22.1.0 -> 22.2.0']);
    expect(stackDiffExitCode(up)).toBe(0);
    const down = diffStackManifests(repo('rt-c', { x: '1.0.0', nvmrc: '22.2.0' }), repo('rt-d', { x: '1.0.1', nvmrc: '20.0.0' }));
    expect(line(down)).toEqual(['backward/runtime node-runtime node 22.2.0 -> 20.0.0', 'forward/nodes npm x 1.0.0 -> 1.0.1']);
    expect(stackDiffExitCode(down)).toBe(2);
    // hand-built: `runtime.node.declared` downgraded while the node-runtime NODE is left untouched, plus an unrelated bump
    const A = repo('rt-e', { x: '1.0.0', nvmrc: '22.2.0' });
    const B0 = repo('rt-f', { x: '1.0.1', nvmrc: '22.2.0' });
    const { stackDigest, stackId, manifestDigest, ...body } = B0;
    void stackDigest;
    void stackId;
    void manifestDigest;
    const B = finalizeStackManifest({ ...body, runtime: { node: { ...body.runtime.node, declared: '16.0.0' } } });
    const r = diffStackManifests(A, B);
    expect(line(r)).toEqual(['backward/runtime node-runtime node 22.2.0 -> 16.0.0', 'forward/nodes npm x 1.0.0 -> 1.0.1']);
    expect(stackDiffExitCode(r)).toBe(2);
    // a pin-only flip of the runtime block (same declared value) is a rewritten runtime row naming the field
    const pinFlip = diffStackManifests(manifest([node('x', '1.0.0')], [], false), manifest([node('x', '1.0.0')], [], true));
    expect(line(pinFlip)).toEqual(['rewritten/runtime node-runtime node - -> -']);
    expect(pinFlip.moves[0]?.fields).toEqual(['pin']);
    expect(stackDiffExitCode(pinFlip)).toBe(2);
  });

  it('permuting images[] cannot move a report byte', () => {
    const A = repo('perm-a', { x: '1.0.0', from: `node:22-alpine@${DIGEST_A}`, nvmrc: '22' });
    const B = repo('perm-b', { x: '1.0.1', from: `node:22-alpine@${DIGEST_B}`, nvmrc: '20' });
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges), images: permute(m.images) });
    expect(stableStringify(diffStackManifests(shuffle(A), shuffle(B)))).toBe(stableStringify(diffStackManifests(A, B)));
  });
});

/* -------------------------------------------------------------------------- */
/* J. root declarations with unchanged nodes                                   */
/* -------------------------------------------------------------------------- */

describe('stack diff — J: a root declaration that appears, disappears or changes group with nodes unchanged is an informational row', () => {
  const x = node('x', '1.0.0');
  const y = node('y', '1.0.0');
  const decl = (name: string, spec: string, group: StackRootDeclared['group']): StackRootDeclared => ({ name, spec, group });
  const m = (rd: StackRootDeclared[]): StackManifest => manifest([x, y], [], false, [], APP, rd);
  const line = (r: ReturnType<typeof diffStackManifests>): string[] => r.moves.map((mv) => `${mv.class} ${mv.name} ${mv.from ?? '-'} -> ${mv.to ?? '-'} | ${mv.reasons[0] ?? ''}`);

  it('declares, un-declares, moves group: one spec-changed row each, digest equal, exit 0', () => {
    const both = m([decl('x', '^1.0.0', 'dependencies'), decl('y', '^1.0.0', 'dependencies')]);
    const onlyX = m([decl('x', '^1.0.0', 'dependencies')]);
    const declared = diffStackManifests(onlyX, both);
    expect(line(declared)).toEqual(["spec-changed y - -> ^1.0.0 | root:app now declares 'y' (dependencies); the resolved nodes are unchanged (digest-neutral)"]);
    expect(declared.digestEqual).toBe(true);
    expect(stackDiffExitCode(declared)).toBe(0);
    const undeclared = diffStackManifests(both, onlyX);
    expect(line(undeclared)).toEqual(["spec-changed y ^1.0.0 -> - | root:app no longer declares 'y' (dependencies); the resolved nodes are unchanged (digest-neutral)"]);
    expect(stackDiffExitCode(undeclared)).toBe(0);
    const moved = diffStackManifests(both, m([decl('x', '^1.0.0', 'dependencies'), decl('y', '^1.0.0', 'devDependencies')]));
    expect(line(moved)).toEqual(["spec-changed y ^1.0.0 -> ^1.0.0 | declaration of 'y' on root:app moved dependencies -> devDependencies; the resolved nodes are unchanged (digest-neutral)"]);
    expect(moved.classification).toBe('spec-changed');
    expect(stackDiffExitCode(moved)).toBe(0);
    // unchanged declarations never produce a row
    expect(diffStackManifests(both, both).moves).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* K. lockfile family                                                          */
/* -------------------------------------------------------------------------- */

describe('stack diff — K: manifests read from different lockfile families are not comparable — fail closed, rows still listed', () => {
  const src = (p: string, parser: string): StackManifest['sources'][number] => ({ path: p, sha256: '0'.repeat(64), parser: parser as StackManifest['sources'][number]['parser'] });
  const NPM = [src('package-lock.json', 'npm-lockfile-v3'), src('package.json', 'package-json'), src('.nvmrc', 'nvmrc')];
  // a family this engine version does not know: `parser` is compared as an opaque string
  const OTHER = [src('other-lock.yaml', 'some-future-lockfile'), src('package.json', 'package-json')];
  const withSources = (m: StackManifest, sources: StackManifest['sources']): StackManifest => ({ ...m, sources });
  const A = manifest([node('x', '2.0.0'), node('y', '1.0.0')]);
  const B = manifest([node('x', '1.0.0'), node('y', '1.0.1')]);
  const line = (r: ReturnType<typeof diffStackManifests>): string[] => r.moves.map((m) => `${m.class}/${m.view} ${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}`);

  it('stackLockfileFamilies ignores the non-lockfile parsers and keeps every other string', () => {
    expect(stackLockfileFamilies(withSources(A, NPM))).toEqual(['npm-lockfile-v3']);
    expect(stackLockfileFamilies(withSources(A, OTHER))).toEqual(['some-future-lockfile']);
    expect(stackLockfileFamilies(A)).toEqual([]);
    expect(stackLockfileFamilies(base)).toEqual(['npm-lockfile-v3']);
  });

  it('both directions: the family row is FIRST (above a backward row), classification unknown, exit 2, node rows beneath', () => {
    const r = diffStackManifests(withSources(A, NPM), withSources(B, OTHER));
    expect(line(r)).toEqual(['unknown/sources lockfile-family npm-lockfile-v3 -> some-future-lockfile', 'backward/nodes x 2.0.0 -> 1.0.0', 'forward/nodes y 1.0.0 -> 1.0.1']);
    expect(r.moves[0]?.reasons[0]).toContain('npm-lockfile-v3');
    expect(r.moves[0]?.reasons[0]).toContain('some-future-lockfile');
    expect(r.classification).toBe('unknown-potential-backward');
    expect(r.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
    const rev = diffStackManifests(withSources(B, OTHER), withSources(A, NPM));
    expect(line(rev)).toEqual(['unknown/sources lockfile-family some-future-lockfile -> npm-lockfile-v3', 'backward/nodes y 1.0.1 -> 1.0.0', 'forward/nodes x 1.0.0 -> 2.0.0']);
    expect(rev.classification).toBe('unknown-potential-backward');
    expect(stackDiffExitCode(rev)).toBe(2);
    // an otherwise clean forward-only pair is blocked by the family row alone
    const F = manifest([node('x', '2.0.1'), node('y', '1.0.0')]);
    const fwd = diffStackManifests(withSources(A, NPM), withSources(F, OTHER));
    expect(line(fwd)).toEqual(['unknown/sources lockfile-family npm-lockfile-v3 -> some-future-lockfile', 'forward/nodes x 2.0.0 -> 2.0.1']);
    expect(stackDiffExitCode(fwd)).toBe(2);
    // a side with NO lockfile source at all is a different family set too
    expect(line(diffStackManifests(withSources(A, NPM), F))[0]).toBe('unknown/sources lockfile-family npm-lockfile-v3 -> (none)');
  });

  it('control: the SAME family on both sides adds no row and changes no byte — whatever the file paths and non-lockfile sources', () => {
    const F = manifest([node('x', '2.0.1'), node('y', '1.0.0')]);
    const plain = diffStackManifests(A, F);
    const sameNpm = diffStackManifests(withSources(A, NPM), withSources(F, [src('npm-shrinkwrap.json', 'npm-lockfile-v3'), src('Dockerfile', 'dockerfile')]));
    const sameOther = diffStackManifests(withSources(A, OTHER), withSources(F, OTHER));
    expect(line(plain)).toEqual(['forward/nodes x 2.0.0 -> 2.0.1']);
    expect(stableStringify(sameNpm)).toBe(stableStringify(plain));
    expect(stableStringify(sameOther)).toBe(stableStringify(plain));
    expect(stackDiffExitCode(sameNpm)).toBe(0);
    // the committed seed pair is one family: no family row
    expect(diffStackManifests(base, head).moves.some((m) => m.view === 'sources')).toBe(false);
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
  it('an extra positional argument is a usage error (exit 1), nothing written', () => {
    const out = path.join(tmp('positional'), 'diff.json');
    const r = runCli(['stack', 'diff', 'surprise', '--from', FILE.base, '--to', FILE.head, '--out', out], ROOT);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("unexpected stack diff argument 'surprise'");
    expect(fs.existsSync(out)).toBe(false);
  });

  it('--out that resolves to either input is refused (exit 2): the inputs are left byte-identical', () => {
    const dir = tmp('out-is-input');
    const a = path.join(dir, 'a.stack.json');
    const b = path.join(dir, 'b.stack.json');
    fs.copyFileSync(FILE.base, a);
    fs.copyFileSync(FILE.head, b);
    const bytesA = fs.readFileSync(a, 'utf8');
    const bytesB = fs.readFileSync(b, 'utf8');
    const viaFrom = runCli(['stack', 'diff', '--from', a, '--to', b, '--out', path.join(dir, '.', 'a.stack.json')], ROOT);
    expect(viaFrom.status).toBe(2);
    expect(viaFrom.stderr).toContain('it resolves to the --from manifest');
    const viaTo = runCli(['stack', 'diff', '--from', a, '--to', b, '--out', 'b.stack.json'], dir);
    expect(viaTo.status).toBe(2);
    expect(viaTo.stderr).toContain('it resolves to the --to manifest');
    expect(fs.readFileSync(a, 'utf8')).toBe(bytesA);
    expect(fs.readFileSync(b, 'utf8')).toBe(bytesB);
  });

  it('a schema refusal names the FIRST failing path behind a fixed prefix', () => {
    const dir = tmp('schema-path');
    const bad = JSON.parse(fs.readFileSync(FILE.head, 'utf8')) as Record<string, unknown>;
    bad.schemaVersion = '2';
    const file = path.join(dir, 'bad.stack.json');
    fs.writeFileSync(file, JSON.stringify(bad));
    const out = path.join(dir, 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FILE.base, '--to', file, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`--to ${file} is not a valid StackManifest: at 'schemaVersion': `);
    expect(fs.existsSync(out)).toBe(false);
    const nested = JSON.parse(fs.readFileSync(FILE.head, 'utf8')) as { nodes: Record<string, unknown>[] };
    (nested.nodes[3] as Record<string, unknown>).dev = 'yes';
    fs.writeFileSync(file, JSON.stringify(nested));
    const n = runCli(['stack', 'diff', '--from', FILE.base, '--to', file, '--out', out], ROOT);
    expect(n.status).toBe(2);
    expect(n.stderr).toContain("is not a valid StackManifest: at 'nodes.3.dev': ");
    fs.writeFileSync(file, '{ not json');
    const j = runCli(['stack', 'diff', '--from', FILE.base, '--to', file, '--out', out], ROOT);
    expect(j.status).toBe(2);
    expect(j.stderr).toContain('is not a valid StackManifest: not JSON');
    expect(fs.existsSync(out)).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('a SYMLINKED manifest is refused (exit 2), the same stance the extractor takes on its sources', () => {
    const dir = tmp('symlink');
    const link = path.join(dir, 'link.stack.json');
    fs.symlinkSync(FILE.head, link);
    const out = path.join(dir, 'diff.json');
    const r = runCli(['stack', 'diff', '--from', FILE.base, '--to', link, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('the manifest path is a symbolic link');
    expect(fs.existsSync(out)).toBe(false);
  });
});
