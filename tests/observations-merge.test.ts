/**
 * observations-merge.test.ts — the `bce run --observations` ingest seam (0.9.0).
 *
 * WHY THIS EXISTS: the behavioralInvariant grader (report.ts) already reads behaviorObservation
 * nodes FROM the graph, but before 0.9.0 NOTHING produced or ingested them — the static extractor
 * never mints them, and `bce run` had no way to accept a served-runtime probe's output. So every
 * behavioralInvariant was permanently fail-closed RED ("0 observation(s)"). `--observations <path>`
 * reads the probe's nodes and merges them into graph.components before evaluate().
 *
 * Proves:
 *   (GRADE-GREEN)  merged 2 DIVERGENT observations (distinct hashes, oracle ok) → behavioralInvariant PASS;
 *   (GRADE-RED)    merged 2 CONSTANT observations (single hash) → constant-function violation (anti-mock);
 *   (GRADE-RED)    merged an oracle-violated observation → FAIL;
 *   (FAIL-CLOSED)  malformed observation nodes are REJECTED (never a silent partial merge → false GREEN);
 *   (CLI)          `bce run --observations <bad>` dies fail-closed; a bare `--observations` dies LOUD.
 *
 * The merge is a pure graph mutation, so the GRADE cases drive evaluate() over a graph with the
 * ingested nodes (identical to what the cli.ts merge produces); the FAIL-CLOSED/CLI cases drive the
 * real built validator via the CLI. Self-contained — no committed fixtures.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from '../src/report.js';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import type { ArchitectureGraph, ObservedComponent } from '../src/graph.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.ts');
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function bp(): EngineeringBlueprint {
  return parseBlueprint({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'obs-bp', version: '1.0.0', status: 'approved', ownerRole: 'platform-engineer', stewardRole: 'blueprint-steward' },
    intentRefs: ['intent:flow-varies-with-input'],
    scope: { repositories: ['repo'], paths: ['src/**'] },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'c-flow', type: 'behavioralInvariant', severity: 'critical', behaviorRef: 'my-flow' }],
    evidenceRequirements: [{ type: 'runtimeProbe', required: true, onMissing: 'block' }],
    approvals: [{ role: 'blueprint-steward', stage: 'ratify' }],
  });
}
/** Build a behaviorObservation node — the exact shape --observations ingests + report.ts grades. */
function obs(stimulus: string, outputHash: string, oracleOk: boolean): ObservedComponent {
  return { id: `behavior:my-flow:${stimulus}`, type: 'behaviorObservation', path: `${outputHash}|${oracleOk ? '1' : '0'}`, line: 1 };
}
/** A graph whose components carry the merged observations (what cli.ts's merge produces). */
function graphWith(obsNodes: ObservedComponent[]): ArchitectureGraph {
  return {
    schemaVersion: '1',
    ctRepoRevision: 'testsha',
    components: [...obsNodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    guardEdges: [],
    coverage: { extractor: 'ast', filesScanned: 6, unsupported: [] },
  };
}
const verdict = (obsNodes: ObservedComponent[]) => evaluate(bp(), graphWith(obsNodes), 'plugin-surface').verdict;

describe('behavioralInvariant grading over merged observations (--observations ingest)', () => {
  it('GRADE-GREEN: 2 DIVERGENT observations (distinct hashes, oracle ok) → pass', () => {
    expect(verdict([obs('stimA', 'aaaa1111', true), obs('stimB', 'bbbb2222', true)])).toBe('pass');
  });

  it('GRADE-RED: 2 CONSTANT observations (single hash) → fail (constant-function / anti-mock)', () => {
    expect(verdict([obs('stimA', 'same0000', true), obs('stimB', 'same0000', true)])).toBe('fail');
  });

  it('GRADE-RED: a divergent set with an ORACLE-VIOLATED observation → fail', () => {
    expect(verdict([obs('stimA', 'aaaa1111', true), obs('stimB', 'bbbb2222', false)])).toBe('fail');
  });

  it('GRADE-RED: fewer than 2 observations → fail-closed (cannot prove input-conditioned variation)', () => {
    expect(verdict([obs('stimA', 'aaaa1111', true)])).toBe('fail');
  });
});

/** Run the built CLI, capturing exit code + stderr. */
function runCli(args: string[]): { code: number; err: string } {
  try {
    execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, err: '' };
  } catch (e) {
    const ex = e as { status?: number; stderr?: string };
    return { code: ex.status ?? 1, err: ex.stderr ?? '' };
  }
}

describe('--observations fail-closed validation (CLI)', () => {
  function scratchRepoAndBlueprint(): { repo: string; bpPath: string } {
    const root = mkdtempSync(join(tmpdir(), 'bce-obs-'));
    dirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    const bpPath = join(root, 'bp.json');
    writeFileSync(bpPath, JSON.stringify({ ...bp(), extraction: { profile: 'plugin-surface', paths: ['src/**'], guardSymbols: ['on'], governedModules: [], forbiddenImports: [], minFiles: 1 } }));
    return { repo: root, bpPath };
  }

  it('a bare --observations (no path) dies LOUD, never a silent skip', () => {
    const { repo, bpPath } = scratchRepoAndBlueprint();
    const { code, err } = runCli(['run', '--blueprint', bpPath, '--ct-repo', repo, '--no-pin', '--extractor', 'ast', '--observations']);
    expect(code).not.toBe(0);
    expect(err).toMatch(/--observations requires a file path/);
  });

  it('a malformed observation node (bad path segment) is REJECTED (never a silent partial merge)', () => {
    const { repo, bpPath } = scratchRepoAndBlueprint();
    const obsPath = join(repo, 'obs.json');
    // path missing the "|<0|1>" oracle segment → must be rejected
    writeFileSync(obsPath, JSON.stringify([{ id: 'behavior:my-flow:x', type: 'behaviorObservation', path: 'nohash', line: 1 }]));
    const { code, err } = runCli(['run', '--blueprint', bpPath, '--ct-repo', repo, '--no-pin', '--extractor', 'ast', '--observations', obsPath]);
    expect(code).not.toBe(0);
    expect(err).toMatch(/path must be exactly/);
  });

  it('a non-array observations file is REJECTED', () => {
    const { repo, bpPath } = scratchRepoAndBlueprint();
    const obsPath = join(repo, 'obs.json');
    writeFileSync(obsPath, JSON.stringify({ not: 'an array' }));
    const { code, err } = runCli(['run', '--blueprint', bpPath, '--ct-repo', repo, '--no-pin', '--extractor', 'ast', '--observations', obsPath]);
    expect(code).not.toBe(0);
    expect(err).toMatch(/must be a JSON array/);
  });
});
