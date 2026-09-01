/**
 * run-conformance-vectors.ts — execute every conformance vector against THIS engine.
 *
 * spec/conformance-vectors/vectors.json is a data artifact: (blueprint, tree) → expected
 * verdict + exit code. This script is the reference engine's SELF-RUNNER over that data:
 * for each vector it drives the REAL CLI (`bce run`) as a child process and checks the
 * REAL process exit code and the emitted ComplianceReport against the vector's
 * expectations. It is the executable form of the README's "reproduce a vector" recipe —
 * the artifact an external implementation can port (or mimic invocation-for-invocation)
 * to measure itself against the same data.
 *
 * Invocation contract (what "run the engine over a vector's pair" means, precisely):
 *
 *   bce run --blueprint <blueprintFile> --ct-repo <tree> --extractor <extractor> \
 *           --no-pin [--observations <tree>/observations.json]
 *
 *   - `--no-pin`: the tree is scanned IN PLACE (each vector's tree is a checked-in
 *     fixture directory, not a git revision of its own).
 *   - `--observations`: added iff the vector's tree carries `observations.json` at its
 *     root. A behavioral pair's recorded probe artifact is PART of the vector input —
 *     behavioralInvariant constraints are graded from observations, not static AST.
 *
 * Per-vector checks (all must hold):
 *   1. process exit code === expectedExitCode        (0 proven-green / 1 graded-red)
 *   2. report.verdict   === expectedVerdict          (pass / fail)
 *   3. green vectors: score 100 and zero violations  (a conformant control is clean)
 *   4. red vectors naming a constraintId: the report contains a violation with that
 *      constraintId at severity >= expectedSeverity  (the RIGHT defect was caught,
 *      at or above the declared floor — not a coincidental red)
 *
 * NON-CLAIM (unchanged from the vectors README): passing this runner confers NO
 * conformance level. Levels and certification are milestone-gated on an external
 * implementation existing (GOVERNANCE.md).
 *
 * Exit codes (direct invocation): 0 = every vector passed; 1 = any vector failed or
 * the vectors file is malformed.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComplianceReport } from '../src/report.js';
import type { Severity } from '../src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(HERE, '..');
export const VECTORS_FILE = path.join(REPO_ROOT, 'spec', 'conformance-vectors', 'vectors.json');
const CLI = path.join(REPO_ROOT, 'src', 'cli.ts');

/** Severity ordering for the "caught at or above the declared floor" check (#4). */
export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/** One vector, as authored in vectors.json (red fields optional on green vectors). */
export interface ConformanceVector {
  id: string;
  intent: string;
  blueprintRef: string;
  blueprintFile: string;
  extractionProfile: string;
  tree: string;
  extractor: 'ast' | 'line-scan';
  expectedVerdict: 'pass' | 'fail';
  expectedExitCode: 0 | 1;
  constraintId?: string;
  constraintType?: string;
  expectedSeverity?: Severity;
  sourceDefectId?: string;
  sourceCleanFixture?: string;
}

export interface VectorsFile {
  vectorsVersion: number;
  apiVersion: string;
  counts: { vectors: number; red: number; green: number };
  vectors: ConformanceVector[];
}

/** What actually happened when the engine ran a vector's pair. */
export interface VectorOutcome {
  exitCode: number;
  /** null iff the run produced no parseable report (itself a failure on every vector). */
  report: ComplianceReport | null;
  stdout: string;
  stderr: string;
}

export interface VectorAssessment {
  id: string;
  ok: boolean;
  failures: string[];
}

/**
 * Load + structurally validate vectors.json. Fail-closed: a malformed vectors file, a
 * count that disagrees with the list, or a vector whose blueprint/tree path does not
 * exist in this repository is a THROW, never a silently-shrunk run.
 */
export function loadVectorsFile(file: string = VECTORS_FILE): VectorsFile {
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const vf = raw as VectorsFile;
  if (!Array.isArray(vf.vectors) || vf.vectors.length === 0) {
    throw new Error(`vectors file ${file} has no vectors[]`);
  }
  const red = vf.vectors.filter((v) => v.expectedVerdict === 'fail').length;
  const green = vf.vectors.filter((v) => v.expectedVerdict === 'pass').length;
  if (vf.counts.vectors !== vf.vectors.length || vf.counts.red !== red || vf.counts.green !== green) {
    throw new Error(
      `vectors file counts {vectors:${vf.counts.vectors}, red:${vf.counts.red}, green:${vf.counts.green}} ` +
        `disagree with the list {vectors:${vf.vectors.length}, red:${red}, green:${green}}`,
    );
  }
  const ids = new Set<string>();
  for (const v of vf.vectors) {
    if (ids.has(v.id)) throw new Error(`duplicate vector id: ${v.id}`);
    ids.add(v.id);
    for (const rel of [v.blueprintFile, v.tree]) {
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
        throw new Error(`vector ${v.id} references a path that does not exist in this repo: ${rel}`);
      }
    }
    if ((v.expectedVerdict === 'pass') !== (v.expectedExitCode === 0)) {
      throw new Error(`vector ${v.id}: expectedVerdict/${v.expectedVerdict} disagrees with expectedExitCode/${v.expectedExitCode}`);
    }
  }
  return vf;
}

/**
 * PURE assessment of an outcome against a vector's expectations — separated from the
 * child-process execution so the check logic is unit-testable (including the negative
 * direction: a runner that cannot report a failure would be a bug).
 */
export function assessVector(vector: ConformanceVector, outcome: VectorOutcome): VectorAssessment {
  const failures: string[] = [];
  if (outcome.exitCode !== vector.expectedExitCode) {
    failures.push(`exit code ${outcome.exitCode} (expected ${vector.expectedExitCode})`);
  }
  if (outcome.report === null) {
    failures.push('no parseable ComplianceReport was emitted');
    return { id: vector.id, ok: false, failures };
  }
  const r = outcome.report;
  if (r.verdict !== vector.expectedVerdict) {
    failures.push(`verdict '${r.verdict}' (expected '${vector.expectedVerdict}')`);
  }
  if (vector.expectedVerdict === 'pass') {
    if (r.score !== 100) failures.push(`green vector scored ${r.score} (expected 100)`);
    if (r.violations.length !== 0) {
      failures.push(`green vector has ${r.violations.length} violation(s) (expected 0)`);
    }
  }
  if (vector.expectedVerdict === 'fail' && vector.constraintId !== undefined) {
    const hits = r.violations.filter((x) => x.constraintId === vector.constraintId);
    if (hits.length === 0) {
      failures.push(
        `no violation on constraint '${vector.constraintId}' ` +
          `(got: ${r.violations.map((x) => x.constraintId).join(', ') || 'none'})`,
      );
    } else if (vector.expectedSeverity !== undefined) {
      const floor = SEVERITY_RANK[vector.expectedSeverity];
      if (!hits.some((x) => SEVERITY_RANK[x.severity] >= floor)) {
        failures.push(
          `constraint '${vector.constraintId}' caught below the '${vector.expectedSeverity}' severity floor ` +
            `(got: ${hits.map((x) => x.severity).join(', ')})`,
        );
      }
    }
  }
  return { id: vector.id, ok: failures.length === 0, failures };
}

/** Run ONE vector's pair through the real CLI as a child process (real exit codes). */
export function executeVector(vector: ConformanceVector): VectorOutcome {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bce-vec-')), 'report.json');
  const treeAbs = path.join(REPO_ROOT, vector.tree);
  const args = [
    '--import', 'tsx', CLI,
    'run',
    '--blueprint', path.join(REPO_ROOT, vector.blueprintFile),
    '--ct-repo', treeAbs,
    '--extractor', vector.extractor,
    '--no-pin',
    '--ref', vector.tree.replace(/^fixtures\//, ''),
    '--out', out,
  ];
  const obs = path.join(treeAbs, 'observations.json');
  if (fs.existsSync(obs)) args.push('--observations', obs);

  let exitCode = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: REPO_ROOT,
    });
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    exitCode = err.status ?? 1;
    stdout = err.stdout ?? '';
    stderr = err.stderr ?? '';
  }
  let report: ComplianceReport | null = null;
  try {
    report = JSON.parse(fs.readFileSync(out, 'utf8')) as ComplianceReport;
  } catch {
    report = null;
  }
  return { exitCode, report, stdout, stderr };
}

/** Execute + assess every vector. */
export function runAllVectors(file: string = VECTORS_FILE): { assessments: VectorAssessment[]; allOk: boolean } {
  const vf = loadVectorsFile(file);
  const assessments = vf.vectors.map((v) => assessVector(v, executeVector(v)));
  return { assessments, allOk: assessments.every((a) => a.ok) };
}

/* Direct invocation: per-vector PASS/FAIL lines + summary; exit 1 on any failure. */
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const asJson = process.argv.includes('--json');
  let result: { assessments: VectorAssessment[]; allOk: boolean };
  try {
    result = runAllVectors();
  } catch (e) {
    process.stderr.write(`::error::conformance-vectors runner refused to run: ${(e as Error).message}\n`);
    process.exit(1);
  }
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result.assessments, null, 2)}\n`);
  } else {
    for (const a of result.assessments) {
      if (a.ok) process.stdout.write(`  PASS ${a.id}\n`);
      else process.stdout.write(`  FAIL ${a.id}: ${a.failures.join('; ')}\n`);
    }
    const passed = result.assessments.filter((a) => a.ok).length;
    process.stdout.write(`conformance vectors: ${passed}/${result.assessments.length} pass\n`);
  }
  process.exit(result.allOk ? 0 : 1);
}
