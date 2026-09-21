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
 *  L. ROOT PAIR — the version the root itself resolves to pairs first (backward on a root downgrade
 *     even when a nested copy rises); other copies set-match afterwards.
 *  M. ROOT SETS — the versions the root reaches are compared as sets before the retained split: a
 *     root move between two retained versions, and unpairable importer moves (real extractor).
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
import { createHash } from 'node:crypto';
import { stableStringify } from '../src/report.js';
import { materializeAtRevision } from '../src/pin.js';
import {
  finalizeStackManifest,
  parseStackManifest,
  computeManifestDigest,
  computeCanonicalManifestDigest,
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
    expect('manifestDigest' in r).toBe(false); // the same manifest bytes: nothing to point at
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
    // identical, but the manifests are not the same bytes (the revision is in the file): both manifestDigests ride on the report
    expect(diffStackManifests(merge, head).manifestDigest).toEqual({ from: merge.manifestDigest, to: head.manifestDigest });
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
    // zod is a ROOT dependency: the root's own edge moved 4.6.5 -> main, one unorderable root pair
    expect(zod.map((m) => `${m.class} ${m.from ?? '-'} -> ${m.to ?? '-'}`).sort()).toEqual(['unknown 4.6.5 -> main']);
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

  it("a root edge whose TARGET is a root node (a self-reference, or a second importer-style root) never enters the root's version set — the root's own version is quarantined, so a root bump beside a same-named dependency stays an empty diff", () => {
    // the root depends on itself (workspace self-link) AND on a dependency that shares its name
    const dep = node('app', '2.0.0');
    const APP2 = node('app', '1.5.0', { root: true, integrity: null, layout: [''] });
    const a1 = manifest([dep], [edge(APP, APP, 'workspace:*'), edge(APP, dep, '^2.0.0')]);
    const a2 = manifest([dep], [edge(APP2, APP2, 'workspace:*'), edge(APP2, dep, '^2.0.0')], false, [], APP2);
    for (const r of [diffStackManifests(a1, a2), diffStackManifests(a2, a1)]) {
      expect(r.moves).toEqual([]); // counting the root's 1.0.0 / 1.5.0 as a root-reached version would make this unknown
      expect(r.classification).toBe('identical');
      expect(stackDiffExitCode(r)).toBe(0);
    }
    // a SECOND root node (an importer) the root has an edge to, sharing the dependency's name at a high version:
    // the dependency's own move 0.1.0 -> 0.2.0 is a plain forward — the importer's 9.0.0 is not a version the root reaches
    const imp = node('app', '9.0.0', { root: true, integrity: null, layout: ['packages/app'] });
    const twin1 = node('app', '0.1.0');
    const twin2 = node('app', '0.2.0');
    const b1 = manifest([twin1, imp], [edge(APP, imp, 'workspace:*'), edge(APP, twin1, '^0.1.0')]);
    const b2 = manifest([twin2, imp], [edge(APP, imp, 'workspace:*'), edge(APP, twin2, '^0.2.0')]);
    const r = diffStackManifests(b1, b2);
    expect(sig(r)).toEqual(['forward/version app 0.1.0 -> 0.2.0']);
    expect(stackDiffExitCode(r)).toBe(0);
    expect(stackDiffExitCode(diffStackManifests(b2, b1))).toBe(2);
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

  it('a different root NAME is a different subject: unknown, fails closed; a root flag move is flags-changed, another root field is rewritten', () => {
    const OTHER = node('other', '1.0.0', { root: true, integrity: null, layout: [''] });
    const renamed = diffStackManifests(manifest([]), manifest([], [], false, [], OTHER));
    expect(sig(renamed)).toEqual(['unknown/name app 1.0.0 -> -', 'unknown/name other - -> 1.0.0']);
    expect(stackDiffExitCode(renamed)).toBe(2);
    const SCRIPTED = node('app', '1.0.0', { root: true, integrity: null, layout: [''], installScript: true });
    const flagged = diffStackManifests(manifest([]), manifest([], [], false, [], SCRIPTED));
    // the same rule as for a dependency: flags only = flags-changed; an install-script gain blocks
    expect(sig(flagged)).toEqual(['flags-changed/name app 1.0.0 -> 1.0.0']);
    expect(flagged.moves[0]?.flagsChanged).toEqual([{ flag: 'installScript', from: false, to: true }]);
    expect(flagged.moves[0]?.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(flagged)).toBe(2);
    const DEV_ROOT = node('app', '1.0.0', { root: true, integrity: null, layout: [''], dev: true });
    const devFlag = diffStackManifests(manifest([]), manifest([], [], false, [], DEV_ROOT));
    expect(sig(devFlag)).toEqual(['flags-changed/name app 1.0.0 -> 1.0.0']);
    expect(stackDiffExitCode(devFlag)).toBe(0);
    // a non-flag root field is still rewritten
    const RESOLVED_ROOT = node('app', '1.0.0', { root: true, integrity: null, layout: [''], resolvedWhenUnpinned: 'file:.' });
    const rew = diffStackManifests(manifest([]), manifest([], [], false, [], RESOLVED_ROOT));
    expect(sig(rew)).toEqual(['rewritten/name app 1.0.0 -> 1.0.0']);
    expect(rew.moves[0]?.reasons).toEqual(['root package, different resolvedWhenUnpinned']);
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
/* L. the root's own resolution pairs FIRST                                    */
/* -------------------------------------------------------------------------- */

describe('stack diff — L: the version the ROOT resolves to pairs first; other copies set-match afterwards', () => {
  /** the reviewer's shape, through the REAL extractor: root declares x; optionally a dep w nests its own x */
  function repo(label: string, o: { rootX: string; rootSpec: string; nestedX?: string }): StackManifest {
    const dir = tmp(label);
    const deps: Record<string, string> = { x: o.rootSpec, ...(o.nestedX ? { w: '^1.0.0' } : {}) };
    const pkg = { name: 'demo', version: '1.0.0', dependencies: deps };
    const x = (v: string) => ({ version: v, resolved: `https://registry.example/x/-/x-${v}.tgz`, integrity: `sha512-x${v}` });
    const packages: Record<string, unknown> = { '': pkg, 'node_modules/x': x(o.rootX) };
    if (o.nestedX) {
      packages['node_modules/w'] = { version: '1.0.0', resolved: 'https://registry.example/w/-/w-1.0.0.tgz', integrity: 'sha512-w', dependencies: { x: `^${o.nestedX}` } };
      packages['node_modules/w/node_modules/x'] = x(o.nestedX);
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages }));
    return extract(dir);
  }
  const sig = (r: ReturnType<typeof diffStackManifests>): string[] => r.moves.map((m) => `${m.class}/${m.scope} ${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}${m.copy ? ' (copy)' : ''}`);

  it("the reviewer's repro: root ^2.0.0 -> ^1.0.0 while a new dep nests x@3.0.0 is BACKWARD (root's pair) + an added copy, exit 2", () => {
    const base0 = repo('re-base', { rootX: '2.0.0', rootSpec: '^2.0.0' });
    const head0 = repo('re-head', { rootX: '1.0.0', rootSpec: '^1.0.0', nestedX: '3.0.0' });
    const r = diffStackManifests(base0, head0);
    expect(sig(r)).toEqual(['backward/version x 2.0.0 -> 1.0.0', 'added/name w - -> 1.0.0', 'added/version x - -> 3.0.0 (copy)']);
    const back = r.moves[0] as StackMove;
    expect(back.rootDeclared).toBe(true);
    expect(back.rootSpec).toEqual({ from: '^2.0.0', to: '^1.0.0' });
    expect(back.reasons[0]).toContain('the root itself resolved to');
    expect(r.classification).toBe('backward');
    expect(r.downgradeAckRequired).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
    // the mirror: root ^1 -> ^2 while the nested 3.0.0 disappears with w = forward + removed copy, exit 0
    const m = diffStackManifests(head0, base0);
    expect(sig(m)).toEqual(['removed/name w 1.0.0 -> -', 'removed/version x 3.0.0 -> - (copy)', 'forward/version x 1.0.0 -> 2.0.0']);
    expect(m.moves[2]?.rootDeclared).toBe(true);
    expect(stackDiffExitCode(m)).toBe(0);
  });

  it("an unchanged root resolution produces no row of its own; the root's dropped version still present elsewhere is still the root's pair", () => {
    // root keeps x@1.0.0 on both sides; only the nested copy moves 2.0.0 -> 3.0.0
    const A = repo('same-a', { rootX: '1.0.0', rootSpec: '^1.0.0', nestedX: '2.0.0' });
    const B = repo('same-b', { rootX: '1.0.0', rootSpec: '^1.0.0', nestedX: '3.0.0' });
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['forward/version x 2.0.0 -> 3.0.0']);
    expect(r.moves[0]?.reasons[0]).toContain('the paired base version 2.0.0');
    expect(stackDiffExitCode(r)).toBe(0);
    // root moves 2.0.0 -> 1.0.0 while 2.0.0 STAYS present as a nested copy: still the root's backward pair, 2.0.0 listed as retained
    const C = repo('keep-a', { rootX: '2.0.0', rootSpec: '^2.0.0' });
    const D = repo('keep-b', { rootX: '1.0.0', rootSpec: '^1.0.0', nestedX: '2.0.0' });
    const k = diffStackManifests(C, D);
    expect(sig(k)).toEqual(['backward/version x 2.0.0 -> 1.0.0', 'added/name w - -> 1.0.0']);
    expect(k.moves[0]?.retained).toEqual(['2.0.0']);
    expect(stackDiffExitCode(k)).toBe(2);
  });

  it('a name the root declares on ONE side only falls back to plain set matching', () => {
    const p = node('p', '1.0.0');
    const x2 = node('x', '2.0.0');
    const x3 = node('x', '3.0.0');
    const A = manifest([p, x2], [edge(APP, x2, '^2.0.0'), edge(p, x2, '^2.0.0')], false, [], APP, [{ name: 'x', spec: '^2.0.0', group: 'dependencies' }, { name: 'p', spec: '^1.0.0', group: 'dependencies' }]);
    const B = manifest([p, x3], [edge(p, x3, '^3.0.0')], false, [], APP, [{ name: 'p', spec: '^1.0.0', group: 'dependencies' }]);
    const r = diffStackManifests(A, B);
    expect(r.moves.map((m) => `${m.class} ${m.name} ${m.from} -> ${m.to}`)).toEqual(['forward x 2.0.0 -> 3.0.0']);
    expect(r.moves[0]?.rootDeclared).toBe(true);
    expect(r.moves[0]?.rootSpec).toEqual({ from: '^2.0.0', to: null });
  });

  it('pnpm workspace shape: an IMPORTER dependency (a root edge that rootDeclared[] does not list) downgraded beside a rising nested copy is BACKWARD, exit 2', () => {
    const orig = load(path.join(FIXTURES, 'pnpm-v9-synth.stack.json'));
    const root = orig.nodes.find((n) => n.root) as StackNode;
    const wsId = stackNodeId('npm', 'ws', '8.17.0');
    // the premise: the root has an edge to ws, and the root's own rootDeclared[] does NOT name it
    expect(orig.edges.some((e) => e.from === root.id && e.to === wsId)).toBe(true);
    expect(orig.rootDeclared.some((d) => d.name === 'ws')).toBe(false);
    const ws = orig.nodes.find((n) => n.id === wsId) as StackNode;
    const down: StackNode = { ...ws, id: stackNodeId('npm', 'ws', '8.16.0'), version: '8.16.0', integrity: 'sha512-ws-8.16.0' };
    const nested: StackNode = { ...ws, id: stackNodeId('npm', 'ws', '9.0.0'), version: '9.0.0', integrity: 'sha512-ws-9.0.0', layout: [] };
    const parent = orig.nodes.find((n) => n.name === 'rollup') as StackNode;
    const { stackDigest, stackId, manifestDigest, ...body } = orig;
    void stackDigest;
    void stackId;
    void manifestDigest;
    const head0 = finalizeStackManifest({
      ...body,
      nodes: [...orig.nodes.filter((n) => n.id !== wsId), down, nested],
      edges: [...orig.edges.map((e) => (e.to === wsId ? { ...e, to: down.id } : e)), { from: parent.id, to: nested.id, spec: '^9.0.0', dev: false, optional: false, peer: false }],
    });
    const r = diffStackManifests(orig, head0);
    expect(r.moves.map((m) => `${m.class} ${m.name} ${m.from ?? '-'} -> ${m.to ?? '-'}${m.copy ? ' (copy)' : ''}`)).toEqual(['backward ws 8.17.0 -> 8.16.0', 'added ws - -> 9.0.0 (copy)']);
    expect(r.moves[0]?.rootDeclared).toBe(false);
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('the seed table is unchanged by root-edge pairing: vitest is the root pair, 7 forward / 1 added copy / 7 removed', () => {
    const r = diffStackManifests(base, head);
    expect(r.summary).toEqual({ added: 1, removed: 7, forward: 7, backward: 0, rewritten: 0, 'flags-changed': 0, 'spec-changed': 0, unknown: 0 });
    const vitest = r.moves.find((m) => m.name === 'vitest') as StackMove;
    expect(`${vitest.class} ${vitest.from} -> ${vitest.to}`).toBe('forward 4.1.11 -> 5.0.0');
    expect(vitest.reasons[0]).toContain('the root itself resolved to on the base side (4.1.11)');
    expect(stackDiffExitCode(r)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* M. root-edge version SETS are compared before the retained split            */
/* -------------------------------------------------------------------------- */

describe('stack diff — M: the versions the root reaches are compared as SETS, before the retained / one-sided split', () => {
  const integ = (n: string, v: string): string => `sha512-${createHash('sha512').update(`${n}@${v}`).digest('base64')}`;
  /** npm lockfile v3 through the REAL extractor. pkgs: lockfile path -> [name, version, deps?] */
  function npmRepo(label: string, rootDeps: Record<string, string>, pkgs: Record<string, [string, string, Record<string, string>?]>): StackManifest {
    const dir = tmp(label);
    const pkg = { name: 'demo', version: '1.0.0', dependencies: rootDeps };
    const packages: Record<string, unknown> = { '': pkg };
    for (const [p, [name, version, deps]] of Object.entries(pkgs)) {
      packages[p] = { version, resolved: `https://registry.example/${name}/-/${name}-${version}.tgz`, integrity: integ(name, version), ...(deps ? { dependencies: deps } : {}) };
    }
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages }));
    return extract(dir);
  }
  /** pnpm-lock v9 workspace through the REAL extractor. importers: path -> dep -> [specifier, version]; pkgs: 'name@version' -> deps */
  function pnpmRepo(label: string, importers: Record<string, Record<string, [string, string]>>, pkgs: Record<string, Record<string, string>>): StackManifest {
    const dir = tmp(label);
    fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const L: string[] = ["lockfileVersion: '9.0'", '', 'settings:', '  autoInstallPeers: true', '  excludeLinksFromLockfile: false', '', 'importers:', ''];
    for (const [imp, deps] of Object.entries(importers)) {
      const pd = imp === '.' ? dir : path.join(dir, imp);
      fs.mkdirSync(pd, { recursive: true });
      fs.writeFileSync(path.join(pd, 'package.json'), JSON.stringify({ name: imp === '.' ? 'ws-root' : path.basename(imp), version: '1.0.0', private: true, dependencies: Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, v[0]])) }));
      if (Object.keys(deps).length > 0) {
        L.push(`  ${imp}:`, '    dependencies:');
        for (const k of Object.keys(deps).sort()) L.push(`      ${k}:`, `        specifier: ${(deps[k] as [string, string])[0]}`, `        version: ${(deps[k] as [string, string])[1]}`);
      } else L.push(`  ${imp}: {}`);
      L.push('');
    }
    L.push('packages:', '');
    for (const id of Object.keys(pkgs).sort()) L.push(`  '${id}':`, `    resolution: {integrity: ${integ(id, 'x')}}`, '');
    L.push('snapshots:', '');
    for (const id of Object.keys(pkgs).sort()) {
      const deps = pkgs[id] as Record<string, string>;
      if (Object.keys(deps).length > 0) L.push(`  '${id}':`, '    dependencies:', ...Object.keys(deps).sort().map((k) => `      ${k}: ${deps[k] as string}`));
      else L.push(`  '${id}': {}`);
      L.push('');
    }
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), L.join('\n'));
    return extract(dir);
  }
  const sig = (r: ReturnType<typeof diffStackManifests>): string[] =>
    r.moves.filter((m) => m.name === 'x').map((m) => `${m.class} ${m.from ?? '-'} -> ${m.to ?? '-'}${m.copy ? ' (copy)' : ''}`);

  it('T1 (npm): the root moves x 2.0.0 -> 1.0.0 while BOTH versions stay in the closure — backward, exit 2, alone and in company', () => {
    const A = npmRepo('t1-a', { x: '^2.0.0', v: '^1.0.0', w: '^1.0.0' }, {
      'node_modules/x': ['x', '2.0.0'],
      'node_modules/v': ['v', '1.0.0', { x: '^2.0.0' }],
      'node_modules/w': ['w', '1.0.0', { x: '^1.0.0' }],
      'node_modules/w/node_modules/x': ['x', '1.0.0'],
    });
    const B = npmRepo('t1-b', { x: '^1.0.0', v: '^1.0.0', w: '^1.0.0' }, {
      'node_modules/x': ['x', '1.0.0'],
      'node_modules/v': ['v', '1.0.0', { x: '^2.0.0' }],
      'node_modules/w': ['w', '1.0.0', { x: '^1.0.0' }],
      'node_modules/v/node_modules/x': ['x', '2.0.0'],
    });
    expect(A.stackDigest).toBe(B.stackDigest); // the closure is identical: only the root's EDGE moved
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['backward 2.0.0 -> 1.0.0']);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]?.retained).toEqual(['1.0.0', '2.0.0']);
    expect(r.moves[0]?.rootSpec).toEqual({ from: '^2.0.0', to: '^1.0.0' });
    expect(r.classification).toBe('backward');
    expect(stackDiffExitCode(r)).toBe(2);
    // the mirror is forward, exit 0
    const m = diffStackManifests(B, A);
    expect(sig(m)).toEqual(['forward 1.0.0 -> 2.0.0']);
    expect(stackDiffExitCode(m)).toBe(0);
    // in company of an unrelated new copy x@3.0.0 the root row is the same
    const C = npmRepo('t1-c', { x: '^1.0.0', v: '^1.0.0', w: '^1.0.0', u: '^1.0.0' }, {
      'node_modules/x': ['x', '1.0.0'],
      'node_modules/v': ['v', '1.0.0', { x: '^2.0.0' }],
      'node_modules/w': ['w', '1.0.0', { x: '^1.0.0' }],
      'node_modules/v/node_modules/x': ['x', '2.0.0'],
      'node_modules/u': ['u', '1.0.0', { x: '^3.0.0' }],
      'node_modules/u/node_modules/x': ['x', '3.0.0'],
    });
    expect(sig(diffStackManifests(A, C))).toEqual(['backward 2.0.0 -> 1.0.0', 'added - -> 3.0.0 (copy)']);
  });

  it('T2 (pnpm): two importers on x@2.0.0, one goes DOWN to 1.0.0 and one UP to 3.0.0 — unpairable, unknown, exit 2', () => {
    const A = pnpmRepo('t2-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { 'x@2.0.0': {} });
    const B = pnpmRepo('t2-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^3.0.0', '3.0.0'] } }, { 'x@1.0.0': {}, 'x@3.0.0': {} });
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['unknown 2.0.0 -> 1.0.0, 3.0.0']);
    expect(r.moves.find((m) => m.name === 'x')?.reasons[0]).toContain('no importer identity');
    expect(r.moves.find((m) => m.name === 'x')?.approvalBlocked).toBe(true);
    expect(r.classification).toBe('unknown-potential-backward');
    expect(stackDiffExitCode(r)).toBe(2);
    // the mirror (two importers converge UP and DOWN onto one version) is unpairable too
    expect(stackDiffExitCode(diffStackManifests(B, A))).toBe(2);
  });

  it('T6 (pnpm): an importer goes 2.0.0 -> 1.0.0 while another importer JOINS at 2.0.0 (so 2.0.0 is retained) — unknown, exit 2', () => {
    const A = pnpmRepo('t6-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': {} }, { 'x@2.0.0': {} });
    const B = pnpmRepo('t6-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { 'x@1.0.0': {}, 'x@2.0.0': {} });
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['unknown - -> 1.0.0']);
    expect(r.moves.find((m) => m.name === 'x')?.reasons[0]).toContain('joined below the base root version 2.0.0');
    expect(stackDiffExitCode(r)).toBe(2);
  });

  it('T3 / T4 / T5 controls: pairable root sets give direction rows; an importer that joins ABOVE every base root version is a plain added copy', () => {
    const app2lib5 = pnpmRepo('t3-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^5.0.0', '5.0.0'] } }, { 'x@2.0.0': {}, 'x@5.0.0': {} });
    const app1lib5 = pnpmRepo('t3-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^5.0.0', '5.0.0'] } }, { 'x@1.0.0': {}, 'x@5.0.0': {} });
    // T3: root {2,5} -> {1,5}: 5 is retained so not every head root version is below max(D)=2, and 1 is
    // below the dropped 2 — some importer assignment is a downgrade, some is not: unknown, blocks
    const t3 = diffStackManifests(app2lib5, app1lib5);
    expect(sig(t3)).toEqual(['unknown 2.0.0 -> 1.0.0']);
    expect(stackDiffExitCode(t3)).toBe(2);
    const app1lib6 = pnpmRepo('t5-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^6.0.0', '6.0.0'] } }, { 'x@1.0.0': {}, 'x@6.0.0': {} });
    // T5: root {2,5} -> {1,6}: 6 is not below max(D)=5 and 1 is below a dropped version — mixed, unknown
    const t5 = diffStackManifests(app2lib5, app1lib6);
    expect(sig(t5)).toEqual(['unknown 2.0.0, 5.0.0 -> 1.0.0, 6.0.0']);
    expect(stackDiffExitCode(t5)).toBe(2);
    const t4a = pnpmRepo('t4-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] } }, { 'x@2.0.0': {} });
    const t4b = pnpmRepo('t4-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'], w: ['^1.0.0', '1.0.0'] } }, { 'x@1.0.0': {}, 'x@3.0.0': {}, 'w@1.0.0': { x: '3.0.0' } });
    const t4 = diffStackManifests(t4a, t4b);
    expect(sig(t4)).toEqual(['backward 2.0.0 -> 1.0.0', 'added - -> 3.0.0 (copy)']);
    expect(stackDiffExitCode(t4)).toBe(2);
    // joins ABOVE: app stays on 2.0.0, lib newly depends on 3.0.0 — nothing the root had went down
    const joinsUp = pnpmRepo('up-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^3.0.0', '3.0.0'] } }, { 'x@2.0.0': {}, 'x@3.0.0': {} });
    const up = diffStackManifests(t4a, joinsUp);
    expect(sig(up)).toEqual(['added - -> 3.0.0 (copy)']);
    expect(stackDiffExitCode(up)).toBe(0);
  });

  const X = (...vs: string[]): Record<string, Record<string, string>> => Object.fromEntries(vs.map((v) => [`x@${v}`, {}]));

  it('C7: an importer goes 5.0.0 -> 2.0.0 onto a sibling version while 5.0.0 stays in the closure — root {2,5} -> {2}, equal digests — backward, exit 2', () => {
    const A = pnpmRepo('c7-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'], w: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { ...X('2.0.0', '5.0.0'), 'w@1.0.0': { x: '5.0.0' } });
    const B = pnpmRepo('c7-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'], w: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { ...X('2.0.0', '5.0.0'), 'w@1.0.0': { x: '5.0.0' } });
    expect(A.stackDigest).toBe(B.stackDigest);
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['backward 5.0.0 -> 2.0.0']);
    expect(r.moves).toHaveLength(1);
    expect(r.digestEqual).toBe(true);
    expect(r.classification).toBe('backward');
    expect(stackDiffExitCode(r)).toBe(2);
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges) });
    expect(stableStringify(diffStackManifests(shuffle(A), shuffle(B)))).toBe(stableStringify(r));
  });

  it('C1: an importer goes 5.0.0 -> 1.0.0 onto a sibling version and 5.0.0 leaves — root {1,5} -> {1}: every head root version is below the dropped 5.0.0, backward, exit 2 — and the control where the importer merely DROPS the dependency blocks identically (the accepted cost)', () => {
    const A = pnpmRepo('c1-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0', '5.0.0'));
    const B = pnpmRepo('c1-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0'));
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['backward 5.0.0 -> 1.0.0']);
    expect(r.moves).toHaveLength(1);
    expect(stackDiffExitCode(r)).toBe(2);
    // the control: app simply REMOVES its dependency on x while lib stays on 1.0.0 — the SAME manifest pair, so it blocks too
    const R = pnpmRepo('c1-r', { '.': {}, 'packages/app': {}, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0'));
    expect(R.stackDigest).toBe(B.stackDigest);
    expect(stableStringify({ ...R, sources: [], manifestDigest: '' })).toBe(stableStringify({ ...B, sources: [], manifestDigest: '' }));
    expect(stableStringify(diffStackManifests(A, R).moves)).toBe(stableStringify(r.moves));
    expect(stackDiffExitCode(diffStackManifests(A, R))).toBe(2);
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges) });
    expect(stableStringify(diffStackManifests(shuffle(A), shuffle(B)))).toBe(stableStringify(r));
  });

  it('C2: two importers CROSS (5 -> 4 down, 1 -> 6 up), equal-size root sets — unknown, exit 2, never two forwards', () => {
    const A = pnpmRepo('c2-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0', '5.0.0'));
    const B = pnpmRepo('c2-b', { '.': {}, 'packages/app': { x: ['^4.0.0', '4.0.0'] }, 'packages/lib': { x: ['^6.0.0', '6.0.0'] } }, X('4.0.0', '6.0.0'));
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['unknown 1.0.0, 5.0.0 -> 4.0.0, 6.0.0']);
    expect(r.summary.forward).toBe(0);
    expect(stackDiffExitCode(r)).toBe(2);
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges) });
    expect(stableStringify(diffStackManifests(shuffle(A), shuffle(B)))).toBe(stableStringify(r));
  });

  it('C3 / C4 / C5 / C6: certain downgrade is one backward row; every head root version above every dropped one is forward; a join above is an added copy; a join below is unknown', () => {
    const c3a = pnpmRepo('c3-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0', '5.0.0'));
    const c3b = pnpmRepo('c3-b', { '.': {}, 'packages/app': { x: ['^3.0.0', '3.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, X('2.0.0', '3.0.0'));
    const c3 = diffStackManifests(c3a, c3b);
    expect(sig(c3)).toEqual(['backward 5.0.0 -> 3.0.0']);
    expect(stackDiffExitCode(c3)).toBe(2);
    const c4a = pnpmRepo('c4-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': {} }, X('2.0.0'));
    const c4b = pnpmRepo('c4-b', { '.': {}, 'packages/app': { x: ['^3.0.0', '3.0.0'] }, 'packages/lib': { x: ['^4.0.0', '4.0.0'] } }, X('3.0.0', '4.0.0'));
    const c4 = diffStackManifests(c4a, c4b);
    expect(sig(c4)).toEqual(['added - -> 3.0.0 (copy)', 'forward 2.0.0 -> 4.0.0']);
    expect(stackDiffExitCode(c4)).toBe(0);
    const c5b = pnpmRepo('c5-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] } }, X('2.0.0', '9.0.0'));
    const c5 = diffStackManifests(c4a, c5b);
    expect(sig(c5)).toEqual(['added - -> 9.0.0 (copy)']);
    expect(stackDiffExitCode(c5)).toBe(0);
    const c6a = pnpmRepo('c6-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': {} }, X('5.0.0'));
    const c6b = pnpmRepo('c6-b', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': { x: ['^1.0.0', '1.0.0'] } }, X('1.0.0', '5.0.0'));
    const c6 = diffStackManifests(c6a, c6b);
    expect(sig(c6)).toEqual(['unknown - -> 1.0.0']);
    expect(stackDiffExitCode(c6)).toBe(2);
    // the root stops reaching the name altogether (every importer drops it) while it stays transitively: no root row
    const gone = pnpmRepo('gone-b', { '.': {}, 'packages/app': { w: ['^1.0.0', '1.0.0'] }, 'packages/lib': {} }, { ...X('5.0.0'), 'w@1.0.0': { x: '5.0.0' } });
    const g = diffStackManifests(c6a, gone);
    expect(sig(g)).toEqual([]);
    expect(stackDiffExitCode(g)).toBe(0);
  });

  it('CX1: a new-to-root version BELOW a RETAINED root version — app 2 -> 9 while lib 9 -> 5, root {2,9} -> {5,9} — is unknown, exit 2 (never forward): the retained 9.0.0 is a version an importer may have LEFT; the innocent twin (app 2 -> 5, lib stays 9) is the SAME manifest pair and blocks too', () => {
    const A = pnpmRepo('cx0-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] } }, X('2.0.0', '9.0.0'));
    const B = pnpmRepo('cx1-b', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^5.0.0', '5.0.0'] } }, X('5.0.0', '9.0.0'));
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['unknown 2.0.0 -> 5.0.0']);
    expect(r.moves).toHaveLength(1);
    expect(r.moves[0]?.reasons[0]).toContain('at least one assignment of importers to versions is a downgrade');
    expect(r.summary.forward).toBe(0);
    expect(r.classification).toBe('unknown-potential-backward');
    expect(stackDiffExitCode(r)).toBe(2);
    // the innocent twin: app moves UP 2 -> 5 and lib stays on 9 — same nodes, edges, rootDeclared and
    // stackDigest, so the manifest cannot tell it from the downgrade above: it blocks too (the accepted cost)
    const I = pnpmRepo('cx1i-b', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] } }, X('5.0.0', '9.0.0'));
    expect(I.stackDigest).toBe(B.stackDigest);
    expect(stableStringify({ ...I, sources: [], manifestDigest: '' })).toBe(stableStringify({ ...B, sources: [], manifestDigest: '' }));
    const ri = diffStackManifests(A, I);
    expect(stableStringify(ri.moves)).toBe(stableStringify(r.moves));
    expect(stackDiffExitCode(ri)).toBe(2);
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges) });
    expect(stableStringify(diffStackManifests(shuffle(A), shuffle(B)))).toBe(stableStringify(r));
  });

  it('CX2 / CX3 / CX4: the same shape with a lower new version, with three importers, and with unequal set sizes — unknown, exit 2, never forward and never an added copy', () => {
    const A = pnpmRepo('cx2-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] } }, X('2.0.0', '9.0.0'));
    // CX2: app 2 -> 9, lib 9 -> 3: root {2,9} -> {3,9}
    const cx2 = diffStackManifests(A, pnpmRepo('cx2-b', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^3.0.0', '3.0.0'] } }, X('3.0.0', '9.0.0')));
    expect(sig(cx2)).toEqual(['unknown 2.0.0 -> 3.0.0']);
    expect(stackDiffExitCode(cx2)).toBe(2);
    // CX3: three importers — app 2 -> 9, lib 9 -> 5, svc stays 9: root {2,9} -> {5,9} (edges collapse the two 9s)
    const cx3a = pnpmRepo('cx3-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] }, 'packages/svc': { x: ['^9.0.0', '9.0.0'] } }, X('2.0.0', '9.0.0'));
    const cx3b = pnpmRepo('cx3-b', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^5.0.0', '5.0.0'] }, 'packages/svc': { x: ['^9.0.0', '9.0.0'] } }, X('5.0.0', '9.0.0'));
    const cx3 = diffStackManifests(cx3a, cx3b);
    expect(sig(cx3)).toEqual(['unknown 2.0.0 -> 5.0.0']);
    expect(stackDiffExitCode(cx3)).toBe(2);
    // CX4: app 2 -> 4, lib 9 -> 6, svc joins at 9: root {2,9} -> {4,6,9} — unequal sizes, both new versions below the retained 9
    const cx4 = diffStackManifests(A, pnpmRepo('cx4-b', { '.': {}, 'packages/app': { x: ['^4.0.0', '4.0.0'] }, 'packages/lib': { x: ['^6.0.0', '6.0.0'] }, 'packages/svc': { x: ['^9.0.0', '9.0.0'] } }, X('4.0.0', '6.0.0', '9.0.0')));
    expect(sig(cx4)).toEqual(['unknown 2.0.0 -> 4.0.0, 6.0.0']);
    expect(cx4.summary.added).toBe(0);
    expect(cx4.summary.forward).toBe(0);
    expect(stackDiffExitCode(cx4)).toBe(2);
    // the D-empty sibling is unchanged: nobody moved, svc JOINS at 5 below the retained 9 — unknown
    const cx6 = diffStackManifests(A, pnpmRepo('cx6-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] }, 'packages/svc': { x: ['^5.0.0', '5.0.0'] } }, X('2.0.0', '5.0.0', '9.0.0')));
    expect(sig(cx6)).toEqual(['unknown - -> 5.0.0']);
    expect(stackDiffExitCode(cx6)).toBe(2);
  });

  it('CX controls: a RETAINED lower version beside a dropped higher one is unknown (the 9 -> 2 assignment exists); every head root version at or above every base root version is forward, exit 0', () => {
    const A = pnpmRepo('cxc-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] } }, X('2.0.0', '9.0.0'));
    // app stays 2, lib 9 -> 10: root {2,9} -> {2,10}. The retained 2 is below the dropped 9, so
    // {2 -> 10, 9 -> 2} is an assignment — unknown (the retained versions are compared, not only the new ones)
    const kept = diffStackManifests(A, pnpmRepo('cxc-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^10.0.0', '10.0.0'] } }, X('2.0.0', '10.0.0')));
    expect(sig(kept)).toEqual(['unknown 9.0.0 -> 10.0.0']);
    expect(stackDiffExitCode(kept)).toBe(2);
    // app 2 -> 9 (onto lib's version), lib 9 -> 10: root {2,9} -> {9,10}. No head root version is below
    // any base root version, so no assignment is a downgrade: one forward row 2 -> 10, exit 0
    const up = diffStackManifests(A, pnpmRepo('cxc-c', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^10.0.0', '10.0.0'] } }, X('9.0.0', '10.0.0')));
    expect(sig(up)).toEqual(['forward 2.0.0 -> 10.0.0']);
    expect(stackDiffExitCode(up)).toBe(0);
    // both importers converge UP onto 10: root {2,9} -> {10}. Clean, but two dropped versions against one
    // new: no root row — plain set matching pairs 9 -> 10 forward and drops 2 as a removed copy (never a
    // root pairing that swallows the 2)
    const conv = diffStackManifests(A, pnpmRepo('cxc-d', { '.': {}, 'packages/app': { x: ['^10.0.0', '10.0.0'] }, 'packages/lib': { x: ['^10.0.0', '10.0.0'] } }, X('10.0.0')));
    expect(sig(conv)).toEqual(['removed 2.0.0 -> - (copy)', 'forward 9.0.0 -> 10.0.0']);
    expect(stackDiffExitCode(conv)).toBe(0);
    // the `maxD -> max(rootA)` mutant is EQUIVALENT (a retained max(rootA) makes `certain` false either
    // way; when `certain` holds, max(rootA) was dropped and IS max(D)) — no test can or needs to kill it
  });

  it('CX8 (the FALSE-PASS half of the importer-identity limitation): an importer moving between two versions the root STILL reaches from other importers is identical, exit 0 — and the report carries both manifestDigests so a reader can see the lockfile changed', () => {
    // three importers: app 9 / lib 9 / svc 2 -> app 9 / lib 2 (DOWN) / svc 2. Root {2,9} -> {2,9}; edges collapse
    // duplicates, so nodes, edges, rootDeclared and stackDigest are equal — only sources[].sha256 differs
    const A = pnpmRepo('cx8-a', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] }, 'packages/svc': { x: ['^2.0.0', '2.0.0'] } }, X('2.0.0', '9.0.0'));
    const B = pnpmRepo('cx8-b', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] }, 'packages/svc': { x: ['^2.0.0', '2.0.0'] } }, X('2.0.0', '9.0.0'));
    expect(A.stackDigest).toBe(B.stackDigest);
    expect(A.manifestDigest).not.toBe(B.manifestDigest);
    const r = diffStackManifests(A, B);
    expect(r.moves).toEqual([]);
    expect(r.classification).toBe('identical');
    expect(stackDiffExitCode(r)).toBe(0);
    expect(r.manifestDigest).toEqual({ from: A.manifestDigest, to: B.manifestDigest });
    // the field is absent when the manifests are the same bytes, and absent on every non-identical report
    expect('manifestDigest' in diffStackManifests(A, A)).toBe(false);
    // (svc 2 -> 10, above every base root version: root {2,9} -> {9,10}, a plain forward — not the CX2 shape)
    const moved = diffStackManifests(A, pnpmRepo('cx8-c', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] }, 'packages/svc': { x: ['^10.0.0', '10.0.0'] } }, X('10.0.0', '9.0.0')));
    expect(sig(moved)).toEqual(['forward 2.0.0 -> 10.0.0']);
    expect('manifestDigest' in moved).toBe(false);
    // the CLI writes it too
    const dir = tmp('cx8-cli');
    const fa = path.join(dir, 'a.json');
    const fb = path.join(dir, 'b.json');
    const out = path.join(dir, 'diff.json');
    fs.writeFileSync(fa, stableStringify(A));
    fs.writeFileSync(fb, stableStringify(B));
    const cli = runCli(['stack', 'diff', '--from', fa, '--to', fb, '--out', out], ROOT);
    expect(cli.status, cli.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, 'utf8')).manifestDigest).toEqual({ from: A.manifestDigest, to: B.manifestDigest });
  });

  it('P6-m1: an identical-with-field report is byte-stable under EVERY input array order, and a manifest against a re-ordered copy of itself shows no field (CX8 shape and C7 reversed)', () => {
    const X = (...vs: string[]): Record<string, Record<string, string>> => Object.fromEntries(vs.map((v) => [`x@${v}`, {}]));
    /** every array of the manifest re-ordered; the recorded digests RE-DERIVED for the new byte order, as any honest writer would */
    const reorder = (m: StackManifest): StackManifest => {
      const { manifestDigest, ...rest } = m;
      void manifestDigest;
      const body = {
        ...rest,
        sources: permute(m.sources),
        nodes: permute(m.nodes).map((n) => ({ ...n, layout: permute(n.layout) })),
        edges: permute(m.edges),
        images: permute(m.images),
        rootDeclared: permute(m.rootDeclared),
        unmodeled: permute(m.unmodeled),
        // a coverage line written twice says nothing new: the canonical form holds each line once
        coverage: { ...m.coverage, unsupported: permute([...m.coverage.unsupported, m.coverage.unsupported[0] as string]) },
      };
      return parseStackManifest({ ...body, manifestDigest: computeManifestDigest(body) });
    };
    /**
     * The CX8 shape, with EVERY array the canonical order covers holding at least two entries: the root
     * declares two dependencies (`rootDeclared`), two workspace links are opaque entries (`unmodeled`) —
     * all through the real extractor — plus two images and a node installed at two paths (`layout`).
     */
    const rich = (label: string, lib: string): StackManifest => {
      const m = pnpmRepo(
        label,
        {
          '.': { y: ['^1.0.0', '1.0.0'], z: ['^1.0.0', '1.0.0'] },
          'packages/app': { x: ['^9.0.0', '9.0.0'], lib: ['workspace:*', 'link:../lib'] },
          'packages/lib': { x: [`^${lib}`, lib], svc: ['workspace:*', 'link:../svc'] },
          'packages/svc': { x: ['^2.0.0', '2.0.0'] },
        },
        { ...X('2.0.0', '9.0.0'), 'y@1.0.0': {}, 'z@1.0.0': {} },
      );
      const { stackDigest, stackId, manifestDigest, ...body } = m;
      void stackDigest;
      void stackId;
      void manifestDigest;
      const image = (name: string, line: number): StackManifest['images'][number] => ({ ref: `${name}:1`, name, tag: '1', tagImplicit: false, digest: null, pin: false, resolved: false, resolvedFrom: 'dockerfile', evidenceRef: `Dockerfile#L${line}` });
      return finalizeStackManifest({
        ...body,
        images: [image('node', 1), image('alpine', 2)],
        nodes: body.nodes.map((n) => (n.name === 'y' ? { ...n, layout: [...n.layout, 'a-second-path'] } : n)),
      });
    };
    const cx8a = rich('p6m1-cx8-a', '9.0.0');
    const cx8b = rich('p6m1-cx8-b', '2.0.0');
    for (const m of [cx8a, cx8b]) {
      expect(verifyStackManifest(m).valid).toBe(true);
      for (const len of [m.sources.length, m.nodes.length, m.edges.length, m.images.length, m.rootDeclared.length, m.unmodeled.length, m.coverage.unsupported.length, m.nodes.find((n) => n.name === 'y')!.layout.length]) expect(len).toBeGreaterThanOrEqual(2);
    }
    const c7a = pnpmRepo('p6m1-c7-a', { '.': {}, 'packages/app': { x: ['^5.0.0', '5.0.0'], w: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { ...X('2.0.0', '5.0.0'), 'w@1.0.0': { x: '5.0.0' } });
    const c7b = pnpmRepo('p6m1-c7-b', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'], w: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] } }, { ...X('2.0.0', '5.0.0'), 'w@1.0.0': { x: '5.0.0' } });
    for (const [label, from, to] of [['cx8', cx8a, cx8b], ['c7 reversed', c7b, c7a]] as const) {
      const r = diffStackManifests(from, to);
      expect(r.classification, label).toBe('identical');
      expect(r.manifestDigest, label).toEqual({ from: from.manifestDigest, to: to.manifestDigest });
      const rf = reorder(from);
      const rt = reorder(to);
      // the re-ordered copies are honest manifests whose BYTES (and so whose recorded manifestDigest) really differ
      expect(verifyStackManifest(rf).valid && verifyStackManifest(rt).valid, label).toBe(true);
      expect(rf.stackDigest, label).toBe(from.stackDigest);
      expect(rf.manifestDigest, label).not.toBe(from.manifestDigest);
      expect(rt.manifestDigest, label).not.toBe(to.manifestDigest);
      for (const [x, y] of [[rf, rt], [from, rt], [rf, to]] as const) expect(stableStringify(diffStackManifests(x, y)), label).toBe(stableStringify(r));
      // a manifest against a re-ordered copy of itself: nothing changed, so nothing is claimed
      for (const [x, y] of [[from, rf], [rf, from], [to, rt]] as const) {
        const self = diffStackManifests(x, y);
        expect(self.classification, label).toBe('identical');
        expect('manifestDigest' in self, label).toBe(false);
      }
    }
    // …through the real CLI too: the re-ordered copy is accepted (its digests re-derive) and the report names no change
    const dir = tmp('p6m1-cli');
    const fa = path.join(dir, 'a.json');
    const fs2 = path.join(dir, 'a-reordered.json');
    const out = path.join(dir, 'diff.json');
    fs.writeFileSync(fa, stableStringify(cx8a));
    fs.writeFileSync(fs2, stableStringify(reorder(cx8a)));
    const cli = runCli(['stack', 'diff', '--from', fa, '--to', fs2, '--out', out], ROOT);
    expect(cli.status, cli.stderr).toBe(0);
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    expect(written.classification).toBe('identical');
    expect('manifestDigest' in written).toBe(false);
  });

  it('P6-m3: the field is RE-DERIVED, never the recorded manifestDigest — a forged-zero digest is not echoed and a forged-equal one cannot suppress the field (library path; the CLI refuses both)', () => {
    const X = (...vs: string[]): Record<string, Record<string, string>> => Object.fromEntries(vs.map((v) => [`x@${v}`, {}]));
    const A = pnpmRepo('p6m3-a', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^9.0.0', '9.0.0'] }, 'packages/svc': { x: ['^2.0.0', '2.0.0'] } }, X('2.0.0', '9.0.0'));
    const B = pnpmRepo('p6m3-b', { '.': {}, 'packages/app': { x: ['^9.0.0', '9.0.0'] }, 'packages/lib': { x: ['^2.0.0', '2.0.0'] }, 'packages/svc': { x: ['^2.0.0', '2.0.0'] } }, X('2.0.0', '9.0.0'));
    const honest = { from: A.manifestDigest, to: B.manifestDigest };
    expect(computeCanonicalManifestDigest(A)).toBe(A.manifestDigest); // what `stack snapshot` wrote IS canonical
    expect(computeCanonicalManifestDigest(B)).toBe(B.manifestDigest);
    expect(diffStackManifests(A, B).manifestDigest).toEqual(honest);
    const zero = '0'.repeat(64);
    expect(diffStackManifests(A, { ...B, manifestDigest: zero }).manifestDigest).toEqual(honest); // forged-zero: not echoed
    expect(diffStackManifests({ ...A, manifestDigest: zero }, B).manifestDigest).toEqual(honest);
    expect(diffStackManifests(A, { ...B, manifestDigest: A.manifestDigest }).manifestDigest).toEqual(honest); // forged-equal: still shown
    // a forged digest on the SAME manifest invents no change either
    expect('manifestDigest' in diffStackManifests(A, { ...A, manifestDigest: zero })).toBe(false);
    // a forged recorded stackDigest / stackId cannot move the field: they are re-derived before the manifest is hashed
    expect(diffStackManifests(A, { ...B, stackDigest: zero, stackId: 'stack:000000000000' }).manifestDigest).toEqual(honest);
    // the CLI never gets this far with a forged manifest
    const dir = tmp('p6m3-cli');
    fs.writeFileSync(path.join(dir, 'a.json'), stableStringify(A));
    fs.writeFileSync(path.join(dir, 'b.json'), stableStringify({ ...B, manifestDigest: zero }));
    const cli = runCli(['stack', 'diff', '--from', path.join(dir, 'a.json'), '--to', path.join(dir, 'b.json'), '--out', path.join(dir, 'diff.json')], ROOT);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain('manifestDigest MISMATCH');
    expect(fs.existsSync(path.join(dir, 'diff.json'))).toBe(false);
  });

  it('P6-m2 (CX9, documented cost — SPEC §16.2): with TWO retained root versions ANY drop of the name blocks, even a pure upgrade above everything — {2,5,9} -> {5,9,12} is unknown, exit 2; its nothing-dropped sibling passes', () => {
    const X = (...vs: string[]): Record<string, Record<string, string>> => Object.fromEntries(vs.map((v) => [`x@${v}`, {}]));
    const ws = (app: string | null, lib: string, svc: string): Record<string, Record<string, [string, string]>> => ({
      '.': {},
      ...(app === null ? {} : { 'packages/app': { x: [`^${app}`, app] as [string, string] } }),
      'packages/lib': { x: [`^${lib}`, lib] },
      'packages/svc': { x: [`^${svc}`, svc] },
    });
    const A = pnpmRepo('cx9-a', ws('2.0.0', '5.0.0', '9.0.0'), X('2.0.0', '5.0.0', '9.0.0'));
    const B = pnpmRepo('cx9-b', ws('12.0.0', '5.0.0', '9.0.0'), X('12.0.0', '5.0.0', '9.0.0'));
    const r = diffStackManifests(A, B);
    expect(sig(r)).toEqual(['unknown 2.0.0 -> 12.0.0']);
    expect(r.classification).toBe(STACK_DIFF_UNKNOWN_CLASSIFICATION);
    expect(r.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(r)).toBe(2);
    // CX9j — nothing dropped: a new importer JOINS at 12 beside the same two retained versions — an added copy, exit 0
    const J0 = pnpmRepo('cx9j-a', ws(null, '5.0.0', '9.0.0'), X('5.0.0', '9.0.0'));
    const j = diffStackManifests(J0, B);
    expect(sig(j)).toEqual(['added - -> 12.0.0 (copy)']);
    expect(stackDiffExitCode(j)).toBe(0);
    // …and the unchanged two-version set is identical: the 5-below-9 pair blocks only when the name also drops a version
    expect(diffStackManifests(J0, pnpmRepo('cx9j-same', ws(null, '5.0.0', '9.0.0'), X('5.0.0', '9.0.0'))).classification).toBe('identical');
    // with ONE retained version the same upgrade is a plain forward move
    const one = diffStackManifests(pnpmRepo('cx9-one-a', ws('2.0.0', '9.0.0', '9.0.0'), X('2.0.0', '9.0.0')), pnpmRepo('cx9-one-b', ws('12.0.0', '9.0.0', '9.0.0'), X('12.0.0', '9.0.0')));
    expect(sig(one)).toEqual(['forward 2.0.0 -> 12.0.0']);
    expect(stackDiffExitCode(one)).toBe(0);
  });

  it('a root pair that cannot be ordered is unknown; shuffled nodes[] / edges[] cannot move a report byte', () => {
    const p = node('p', '1.0.0');
    const xa = node('x', '1.0.0+a');
    const xb = node('x', '1.0.0+b');
    const A = manifest([p, xa, xb], [edge(APP, xa, '1.0.0'), edge(p, xb, '1.0.0')]);
    const B = manifest([p, xa, xb], [edge(APP, xb, '1.0.0'), edge(p, xa, '1.0.0')]);
    const r = diffStackManifests(A, B);
    expect(r.moves.map((m) => `${m.class} ${m.from} -> ${m.to}`)).toEqual(['unknown 1.0.0+a -> 1.0.0+b']);
    expect(stackDiffExitCode(r)).toBe(2);
    const git = node('x', 'main');
    const x1 = node('x', '1.0.0');
    const G = diffStackManifests(manifest([p, git, x1], [edge(APP, git, 'main'), edge(p, x1, '^1.0.0')]), manifest([p, git, x1], [edge(APP, x1, '^1.0.0'), edge(p, git, 'main')]));
    expect(G.moves.map((m) => `${m.class} ${m.from} -> ${m.to}`)).toEqual(['unknown main -> 1.0.0']);
    expect(stackDiffExitCode(G)).toBe(2);
    const t2a = pnpmRepo('sh-a', { '.': {}, 'packages/app': { x: ['^2.0.0', '2.0.0'] }, 'packages/lib': { x: ['^5.0.0', '5.0.0'] } }, { 'x@2.0.0': {}, 'x@5.0.0': {} });
    const t2b = pnpmRepo('sh-b', { '.': {}, 'packages/app': { x: ['^1.0.0', '1.0.0'] }, 'packages/lib': { x: ['^6.0.0', '6.0.0'] } }, { 'x@1.0.0': {}, 'x@6.0.0': {} });
    const shuffle = (m: StackManifest): StackManifest => ({ ...m, nodes: permute(m.nodes), edges: permute(m.edges) });
    expect(stableStringify(diffStackManifests(shuffle(t2a), shuffle(t2b)))).toBe(stableStringify(diffStackManifests(t2a, t2b)));
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

  it('a runtime declaration that ENTERS as a non-exact version (adding `.nvmrc` = 22) is unknown, exit 2; an exact one is added, exit 0', () => {
    const none = repo('rt-none', { x: '1.0.0' });
    const entersRange = diffStackManifests(none, repo('rt-enters-22', { x: '1.0.0', nvmrc: '22' }));
    expect(line(entersRange)).toEqual(['unknown/runtime node-runtime node - -> 22']);
    expect(entersRange.moves[0]?.approvalBlocked).toBe(true);
    expect(stackDiffExitCode(entersRange)).toBe(2);
    const entersExact = diffStackManifests(none, repo('rt-enters-exact', { x: '1.0.0', nvmrc: '22.22.2' }));
    expect(line(entersExact)).toEqual(['added/runtime node-runtime node - -> 22.22.2']);
    expect(stackDiffExitCode(entersExact)).toBe(0);
    const leaves = diffStackManifests(repo('rt-leaves', { x: '1.0.0', nvmrc: '22' }), none);
    expect(line(leaves)).toEqual(['removed/runtime node-runtime node 22 -> -']);
    expect(stackDiffExitCode(leaves)).toBe(0);
  });

  it('several entries of ONE image name moving at once cannot be paired: unknown, exit 2 (two Dockerfiles both bumping node)', () => {
    const two = (label: string, tag: string): StackManifest => {
      const m0 = repo(`${label}-0`, { x: '1.0.0', from: `node:${tag}-alpine` });
      void m0;
      const dir = tmp(label);
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', dependencies: { x: '^1.0.0' } }));
      fs.writeFileSync(
        path.join(dir, 'package-lock.json'),
        JSON.stringify({ name: 'demo', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'demo', version: '1.0.0', dependencies: { x: '^1.0.0' } }, 'node_modules/x': { version: '1.0.0', resolved: 'https://registry.example/x/-/x-1.0.0.tgz', integrity: 'sha512-AAAA' } } }),
      );
      fs.writeFileSync(path.join(dir, 'Dockerfile'), `FROM node:${tag}-alpine\n`);
      fs.mkdirSync(path.join(dir, 'worker'));
      fs.writeFileSync(path.join(dir, 'worker', 'Dockerfile'), `FROM node:${tag}-bookworm\n`);
      return extract(dir);
    };
    const A = two('img2-a', '22');
    const B = two('img2-b', '20');
    expect(A.images).toHaveLength(2);
    const r = diffStackManifests(A, B);
    expect(line(r)).toEqual(['unknown/images oci-image node node:22-alpine, node:22-bookworm -> node:20-alpine, node:20-bookworm']);
    expect(r.moves[0]?.reasons[0]).toContain('cannot be paired');
    expect(r.unexplainedDigestChange).toBe(false);
    expect(stackDiffExitCode(r)).toBe(2);
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

  it('REAL families through the built CLI: a committed pnpm-lock manifest vs a committed npm manifest — first stdout row, exit 2, report still written', () => {
    const PNPM = path.join(FIXTURES, 'pnpm-v9-synth.stack.json');
    expect(stackLockfileFamilies(load(PNPM))).toEqual(['pnpm-lockfile-v9']);
    const dir = tmp('family-cli');
    const out = path.join(dir, 'diff.json');
    const r = runCli(['stack', 'diff', '--from', PNPM, '--to', FILE.head, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stdout.split('\n')[0]).toContain('lockfile-family  pnpm-lockfile-v9 -> npm-lockfile-v3');
    expect(r.stdout).toContain('classification unknown-potential-backward');
    const written = JSON.parse(fs.readFileSync(out, 'utf8')) as { moves: StackMove[]; classification: string };
    expect(written.moves[0]?.view).toBe('sources');
    expect(written.moves.length).toBeGreaterThan(1);
    const back = runCli(['stack', 'diff', '--from', FILE.head, '--to', PNPM, '--out', out], ROOT);
    expect(back.status).toBe(2);
    expect(back.stdout.split('\n')[0]).toContain('lockfile-family  npm-lockfile-v3 -> pnpm-lockfile-v9');
  });

  it('pnpm -> pnpm on the committed synth manifest: one version bump is ONE forward row, exit 0; an opaque importer entry that changes is unknown, exit 2', () => {
    const PNPM = path.join(FIXTURES, 'pnpm-v9-synth.stack.json');
    const orig = load(PNPM);
    expect(orig.unmodeled.length).toBeGreaterThan(0);
    expect(orig.rootDeclared.length).toBeGreaterThan(0);
    const body = (m: StackManifest) => {
      const { stackDigest, stackId, manifestDigest, ...rest } = m;
      void stackDigest;
      void stackId;
      void manifestDigest;
      return rest;
    };
    // bump ws 8.17.0 -> 8.17.1 (node id + every edge that points at it), everything else untouched
    const from = stackNodeId('npm', 'ws', '8.17.0');
    const to = stackNodeId('npm', 'ws', '8.17.1');
    expect(orig.nodes.some((n) => n.id === from)).toBe(true);
    const bumped = finalizeStackManifest({
      ...body(orig),
      nodes: orig.nodes.map((n) => (n.id === from ? { ...n, id: to, version: '8.17.1' } : n)),
      edges: orig.edges.map((e) => ({ ...e, from: e.from === from ? to : e.from, to: e.to === from ? to : e.to })),
    });
    const r = diffStackManifests(orig, bumped);
    expect(line(r)).toEqual(['forward/nodes ws 8.17.0 -> 8.17.1']);
    expect(r.unexplained).toEqual([]);
    expect(r.classification).toBe('forward');
    expect(stackDiffExitCode(r)).toBe(0);
    const dir = tmp('pnpm-bump');
    const fb = path.join(dir, 'bumped.stack.json');
    fs.writeFileSync(fb, stableStringify(bumped));
    const cli = runCli(['stack', 'diff', '--from', PNPM, '--to', fb, '--out', path.join(dir, 'o.json')], ROOT);
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toContain('forward       ws  8.17.0 -> 8.17.1');
    // an importer-level opaque entry (the npm alias) whose hashed content moves is unknown and blocks
    const alias = orig.unmodeled.find((u) => u.reason === 'npm-alias') as StackUnmodeled;
    const opaque = finalizeStackManifest({
      ...body(orig),
      unmodeled: orig.unmodeled.map((u) => (u.key === alias.key ? { ...u, entrySha256: 'f'.repeat(64) } : u)),
    });
    const o = diffStackManifests(orig, opaque);
    expect(line(o)).toEqual([`unknown/unmodeled ${alias.key} ${alias.reason} sha256:${alias.entrySha256.slice(0, 12)} -> ${alias.reason} sha256:ffffffffffff`]);
    expect(o.classification).toBe('unknown-potential-backward');
    expect(stackDiffExitCode(o)).toBe(2);
    // and the synth manifest against itself is identical
    expect(diffStackManifests(orig, orig).moves).toEqual([]);
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
  it('the `unexplained` list reaches stdout with its sub-view key, and the CLI exits 2', () => {
    const img = (v: string): StackNode => ({ ...node('node', v, { integrity: null, resolvedFrom: 'dockerfile', layout: [] }), kind: 'oci-image', id: `oci-image:node@${v}` });
    const dir = tmp('unexplained-cli');
    const fa = path.join(dir, 'a.json');
    const fb = path.join(dir, 'b.json');
    fs.writeFileSync(fa, stableStringify(manifest([node('x', '1.0.0'), img('22-alpine')])));
    fs.writeFileSync(fb, stableStringify(manifest([node('x', '1.0.1'), img('18-alpine')])));
    const out = path.join(dir, 'o.json');
    const r = runCli(['stack', 'diff', '--from', fa, '--to', fb, '--out', out], ROOT);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('hashed content changed with no row of its own sub-view explaining it (nodes:oci-image/node) — fail closed');
    expect(r.stdout).toContain('classification unknown-potential-backward');
    expect((JSON.parse(fs.readFileSync(out, 'utf8')) as { unexplained: string[] }).unexplained).toEqual(['nodes:oci-image/node']);
  });

  it.skipIf(process.platform === 'win32')('a consumer that closes the pipe early (| head -1) keeps the 0 / 2 exit contract — never an EPIPE crash (exit 1)', () => {
    const cli = fs.existsSync(DIST_CLI) ? `${JSON.stringify(process.execPath)} ${JSON.stringify(DIST_CLI)}` : `${JSON.stringify(path.join(ROOT, 'node_modules', '.bin', 'tsx'))} ${JSON.stringify(SRC_CLI)}`;
    const dir = tmp('epipe');
    const run = (from: string, to: string): { code: string; stderr: string } => {
      const res = spawnSync('bash', ['-c', `${cli} stack diff --from ${JSON.stringify(from)} --to ${JSON.stringify(to)} --out ${JSON.stringify(path.join(dir, 'o.json'))} 2>${JSON.stringify(path.join(dir, 'err.txt'))} | head -1 >/dev/null; echo "\${PIPESTATUS[0]}"`], { cwd: ROOT, encoding: 'utf8' });
      return { code: res.stdout.trim(), stderr: fs.readFileSync(path.join(dir, 'err.txt'), 'utf8') };
    };
    // a ~450-row fail-closed report (pnpm vs npm): exit 2, no stack trace
    const closed = run(path.join(FIXTURES, 'pnpm-v9-synth.stack.json'), FILE.head);
    expect(closed.code).toBe('2');
    expect(closed.stderr).not.toContain('EPIPE');
    expect(closed.stderr).not.toMatch(/at .*\(node:/);
    // a passing report: exit 0
    const ok = run(FILE.base, FILE.head);
    expect(ok.code).toBe('0');
    expect(ok.stderr).not.toContain('EPIPE');
  });
  it.skipIf(process.platform === 'win32')('a LARGE fail-closed report reaches a SLOW consumer complete: the summary line and the exit code both survive (no process.exit before the pipe drains)', () => {
    const cli = fs.existsSync(DIST_CLI) ? `${JSON.stringify(process.execPath)} ${JSON.stringify(DIST_CLI)}` : `${JSON.stringify(path.join(ROOT, 'node_modules', '.bin', 'tsx'))} ${JSON.stringify(SRC_CLI)}`;
    const dir = tmp('drain');
    const many = Array.from({ length: 4000 }, (_, i) => node(`pkg-with-a-deliberately-long-name-${String(i).padStart(5, '0')}`, '1.0.0'));
    const fa = path.join(dir, 'a.json');
    const fb = path.join(dir, 'b.json');
    fs.writeFileSync(fa, stableStringify(manifest([node('x', '2.0.0')])));
    fs.writeFileSync(fb, stableStringify(manifest([node('x', '1.0.0'), ...many])));
    const captured = path.join(dir, 'stdout.txt');
    const res = spawnSync('bash', ['-c', `${cli} stack diff --from ${JSON.stringify(fa)} --to ${JSON.stringify(fb)} --out ${JSON.stringify(path.join(dir, 'o.json'))} 2>/dev/null | (sleep 1; cat) > ${JSON.stringify(captured)}; echo "\${PIPESTATUS[0]}"`], { cwd: ROOT, encoding: 'utf8' });
    expect(res.stdout.trim()).toBe('2');
    const text = fs.readFileSync(captured, 'utf8');
    expect(Buffer.byteLength(text)).toBeGreaterThan(256 * 1024); // far beyond any pipe buffer
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(4001 + 2);
    expect(lines[lines.length - 2]).toContain('classification backward');
    expect(lines[lines.length - 1]).toMatch(/^wrote /);
  });
});
