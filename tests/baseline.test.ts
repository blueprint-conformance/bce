/**
 * BASELINE — the shrink-only adoption lever (SPEC §9.3), the ONE new v1 verb.
 *
 * These are the claims the "baseline is not a bypass" posture rests on. Each is DISCRIMINATING: it
 * fails the moment the shrink-only property leaks into a grow, a new violation stops failing, or a
 * baselined violation gets silently hidden. Two layers:
 *
 *  · UNIT (pure): the identity content-address, the fail-closed reader, and planBaselineWrite's
 *    fresh-creation-vs-shrink-only heart — asserted directly, no CLI.
 *  · E2E (real CLI): `bce baseline` writes the file, then `bce gate` reads it and the three
 *    load-bearing behaviors hold end-to-end through real process exit codes:
 *      (1) new-violation-fails-with-baseline-present — a NEW violation STILL exits 1;
 *      (2) baseline-shrinks-only — a re-write can only remove, never add; growth needs delete+recreate;
 *      (3) baselined-still-reported — a baselined violation is visible + counted, never hidden.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  violationIdentity,
  readBaseline,
  planBaselineWrite,
  partitionAgainstBaseline,
  serializeBaseline,
  BaselineError,
  BASELINE_RELPATH,
  type BaselineFile,
} from '../src/baseline.js';
import type { ComplianceReport, Violation } from '../src/report.js';

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Unit layer — the pure baseline core
// ───────────────────────────────────────────────────────────────────────────────────────────────

function viol(constraintId: string, component: string, severity: Violation['severity'] = 'high'): Violation {
  return {
    constraintId,
    component,
    severity,
    evidenceType: 'staticAst',
    evidenceRef: `src/${component}.ts#L1`,
    observed: `observed drift on ${component}`,
    expected: `no drift on ${component}`,
  };
}

function report(blueprintRef: string, violations: Violation[]): ComplianceReport {
  return {
    schemaVersion: '1',
    blueprintRef,
    ctRepoRevision: 'testrev',
    score: violations.length === 0 ? 100 : 40,
    verdict: violations.length === 0 ? 'pass' : 'fail',
    violations,
    evidenceRef: 'architecture-graph.json@sha256:deadbeef',
    summary: 'test report',
    coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
  };
}

describe('violationIdentity — content-addressed, stable across line/observed drift', () => {
  it('same (blueprintRef, constraintId, component) → same id (line/observed/expected do NOT matter)', () => {
    const a = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'reader' });
    // a "different" violation object with the same identity tuple must hash identically.
    const b = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'reader' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a moved component or constraint is a DIFFERENT identity (correctly un-baselined)', () => {
    const base = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'reader' });
    expect(violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'writer' })).not.toBe(base);
    expect(violationIdentity('bp@1.0.0', { constraintId: 'c2', component: 'reader' })).not.toBe(base);
    expect(violationIdentity('other@1.0.0', { constraintId: 'c1', component: 'reader' })).not.toBe(base);
  });
});

describe('planBaselineWrite — FRESH creation grows once; a re-write can only SHRINK', () => {
  it('FRESH creation (no existing baseline) records EVERY current violation', () => {
    const reports = [report('bp@1.0.0', [viol('c1', 'a'), viol('c2', 'b')])];
    const plan = planBaselineWrite(reports, null);
    expect(plan.hadExisting).toBe(false);
    expect(plan.entries).toHaveLength(2);
    expect(plan.added).toHaveLength(2);
    expect(plan.removed).toHaveLength(0);
    expect(plan.refused).toHaveLength(0);
  });

  it('SHRINK-ONLY: a re-write over an existing baseline NEVER adds a new violation (it is REFUSED)', () => {
    // existing baseline accepts {c1/a}. Current run has {c1/a} AND a NEW {c2/b}.
    const existing: BaselineFile = {
      schemaVersion: '1',
      engine: '0.0.0',
      entries: [
        {
          id: violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' }),
          blueprintRef: 'bp@1.0.0',
          constraintId: 'c1',
          component: 'a',
          severity: 'high',
        },
      ],
    };
    const reports = [report('bp@1.0.0', [viol('c1', 'a'), viol('c2', 'b')])];
    const plan = planBaselineWrite(reports, existing);
    expect(plan.hadExisting).toBe(true);
    // the NEW violation is REFUSED, not added — the file stays a SUBSET of the prior baseline.
    expect(plan.added).toHaveLength(0);
    expect(plan.refused).toHaveLength(1);
    expect(plan.refused[0]!.constraintId).toBe('c2');
    // c1/a still exists → kept. Result entries = {c1/a} only (never grew to include c2/b).
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.constraintId).toBe('c1');
    const priorIds = new Set(existing.entries.map((e) => e.id));
    expect(plan.entries.every((e) => priorIds.has(e.id))).toBe(true); // strict subset invariant
  });

  it('SHRINK-ONLY: a violation that DISAPPEARED is auto-removed (the wall burns down)', () => {
    const idA = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' });
    const idB = violationIdentity('bp@1.0.0', { constraintId: 'c2', component: 'b' });
    const existing: BaselineFile = {
      schemaVersion: '1',
      engine: '0.0.0',
      entries: [
        { id: idA, blueprintRef: 'bp@1.0.0', constraintId: 'c1', component: 'a', severity: 'high' },
        { id: idB, blueprintRef: 'bp@1.0.0', constraintId: 'c2', component: 'b', severity: 'high' },
      ],
    };
    // current run: only c1/a remains — c2/b was fixed.
    const reports = [report('bp@1.0.0', [viol('c1', 'a')])];
    const plan = planBaselineWrite(reports, existing);
    expect(plan.kept.map((e) => e.constraintId)).toEqual(['c1']);
    expect(plan.removed.map((e) => e.constraintId)).toEqual(['c2']);
    expect(plan.entries).toHaveLength(1); // shrank from 2 → 1
  });

  it('SHRINK is idempotent: re-writing an unchanged baseline yields the identical entry set', () => {
    const idA = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' });
    const existing: BaselineFile = {
      schemaVersion: '1',
      engine: '0.0.0',
      entries: [{ id: idA, blueprintRef: 'bp@1.0.0', constraintId: 'c1', component: 'a', severity: 'high' }],
    };
    const reports = [report('bp@1.0.0', [viol('c1', 'a')])];
    const plan = planBaselineWrite(reports, existing);
    expect(plan.entries).toEqual(existing.entries);
    expect(plan.removed).toHaveLength(0);
    expect(plan.refused).toHaveLength(0);
  });
});

describe('partitionAgainstBaseline — NEW blocks, BASELINED is surfaced; a null baseline enforces all', () => {
  it('null baseline → every violation is NEW (byte-identical to the pre-baseline gate)', () => {
    const reports = [report('bp@1.0.0', [viol('c1', 'a'), viol('c2', 'b')])];
    const parts = partitionAgainstBaseline(reports, null);
    expect(parts[0]!.newViolations).toHaveLength(2);
    expect(parts[0]!.baselinedViolations).toHaveLength(0);
  });

  it('a present baseline splits NEW from BASELINED — a baselined violation is NEVER dropped, only re-classed', () => {
    const idA = violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' });
    const baseline: BaselineFile = {
      schemaVersion: '1',
      engine: '0.0.0',
      entries: [{ id: idA, blueprintRef: 'bp@1.0.0', constraintId: 'c1', component: 'a', severity: 'high' }],
    };
    const reports = [report('bp@1.0.0', [viol('c1', 'a'), viol('c2', 'b')])];
    const parts = partitionAgainstBaseline(reports, baseline);
    expect(parts[0]!.baselinedViolations.map((v) => v.constraintId)).toEqual(['c1']);
    expect(parts[0]!.newViolations.map((v) => v.constraintId)).toEqual(['c2']);
    // total is conserved — nothing vanished (baselined is a re-class, not a suppression).
    expect(parts[0]!.newViolations.length + parts[0]!.baselinedViolations.length).toBe(2);
  });
});

describe('readBaseline — FAIL-CLOSED on a corrupt/hand-broken file (never a silent accept)', () => {
  function tmp(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'bce-baseline-'));
  }
  function writeBaselineRaw(dir: string, body: string): void {
    fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
    fs.writeFileSync(path.join(dir, BASELINE_RELPATH), body);
  }

  it('ABSENT → null (enforce everything; NOT an error, NOT a permissive accept)', () => {
    expect(readBaseline(tmp())).toBeNull();
  });

  it('bad JSON throws BaselineError', () => {
    const dir = tmp();
    writeBaselineRaw(dir, '{not json');
    expect(() => readBaseline(dir)).toThrow(BaselineError);
  });

  it('a missing entries array throws (a corrupt baseline never silently grades as empty)', () => {
    const dir = tmp();
    writeBaselineRaw(dir, '{"schemaVersion":"1","engine":"0.0.0"}');
    expect(() => readBaseline(dir)).toThrow(BaselineError);
  });

  it('an entry whose id was HAND-EDITED to not match its fields is REFUSED (no smuggled broader identity)', () => {
    const dir = tmp();
    // a hand-forged entry: real (c1, a) fields but an id that is NOT sha256(bp c1 a). If the reader
    // trusted the id blindly, an attacker could baseline a broad identity and mismatch the fields.
    writeBaselineRaw(
      dir,
      JSON.stringify({
        schemaVersion: '1',
        engine: '0.0.0',
        entries: [{ id: 'deadbeef', blueprintRef: 'bp@1.0.0', constraintId: 'c1', component: 'a', severity: 'high' }],
      }),
    );
    expect(() => readBaseline(dir)).toThrow(/id does not match/);
  });

  it('a well-formed baseline round-trips (parse → same entries, sorted)', () => {
    const dir = tmp();
    const file: BaselineFile = {
      schemaVersion: '1',
      engine: '0.1.0',
      entries: [
        {
          id: violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' }),
          blueprintRef: 'bp@1.0.0',
          constraintId: 'c1',
          component: 'a',
          severity: 'high',
        },
      ],
    };
    writeBaselineRaw(dir, serializeBaseline(file));
    const read = readBaseline(dir);
    expect(read?.entries).toHaveLength(1);
    expect(read?.entries[0]!.id).toBe(file.entries[0]!.id);
  });
});

describe('serializeBaseline — byte-stable (sorted entries, canonical JSON, trailing newline)', () => {
  it('two files with entries in different orders serialize identically (deterministic)', () => {
    const eA = {
      id: violationIdentity('bp@1.0.0', { constraintId: 'c1', component: 'a' }),
      blueprintRef: 'bp@1.0.0',
      constraintId: 'c1',
      component: 'a',
      severity: 'high' as const,
    };
    const eB = {
      id: violationIdentity('bp@1.0.0', { constraintId: 'c2', component: 'b' }),
      blueprintRef: 'bp@1.0.0',
      constraintId: 'c2',
      component: 'b',
      severity: 'high' as const,
    };
    const f1: BaselineFile = { schemaVersion: '1', engine: '0.1.0', entries: [eA, eB] };
    const f2: BaselineFile = { schemaVersion: '1', engine: '0.1.0', entries: [eB, eA] };
    expect(serializeBaseline(f1)).toBe(serializeBaseline(f2));
    expect(serializeBaseline(f1).endsWith('\n')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// E2E layer — the real CLI, real process exit codes
// ───────────────────────────────────────────────────────────────────────────────────────────────

const REPO_ROOT = path.join(__dirname, '..');
const DIST_CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(REPO_ROOT, 'src', 'cli.ts');
const FIXROOT = path.join(REPO_ROOT, 'fixtures');
const LUNA_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return {
    status: typeof res.status === 'number' ? res.status : 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

/**
 * Arrange a throwaway repo with the luna blueprint + a chosen source tree.
 * `drift-forbidden-import` reddens the gate (the seeded `no-direct-provider-sdk` violation);
 * `conformant` greens it.
 */
function arrangeRepo(source: 'conformant' | 'drift-forbidden-import'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-baseline-e2e-'));
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  fs.copyFileSync(LUNA_PATH, path.join(dir, '.blueprints', path.basename(LUNA_PATH)));
  fs.cpSync(path.join(FIXROOT, 'extension-surface', source, 'src'), path.join(dir, 'src'), { recursive: true });
  return dir;
}

describe('E2E (1) new-violation-fails-with-baseline-present — a baseline NEVER suppresses a NEW violation', () => {
  it('baseline the current red, gate goes GREEN; introduce a SECOND red → gate FAILS (exit 1)', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    // 1. gate is genuinely red here (the seeded forbidden import).
    expect(runCli(['gate', '--repo', dir], dir).status).toBe(1);
    // 2. baseline it — records the current violation as accepted.
    const bl = runCli(['baseline', '--repo', dir], dir);
    expect(bl.status).toBe(0);
    expect(fs.existsSync(path.join(dir, BASELINE_RELPATH))).toBe(true);
    // 3. gate now GREEN (exit 0) — the ONLY red is baselined.
    const gated = runCli(['gate', '--repo', dir], dir);
    expect(gated.status, gated.stdout + gated.stderr).toBe(0);
    // 4. introduce a NEW, un-baselined violation: add a SECOND drifted extension file the same
    //    blueprint scopes. The forbidden import in a new component is a NEW identity → must FAIL.
    const driftSrc = fs.readFileSync(
      path.join(FIXROOT, 'extension-surface', 'drift-forbidden-import', 'src', 'extensions', 'luna-chat.extension.ts'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'src', 'extensions', 'luna-chat-second.extension.ts'), driftSrc);
    const reGated = runCli(['gate', '--repo', dir], dir);
    expect(reGated.status, 'a NEW violation with a baseline present MUST still fail').toBe(1);
    expect(reGated.stderr).toContain('NEW violation');
  });
});

describe('E2E (2) baseline-shrinks-only — a re-write can only remove; growth needs delete+recreate', () => {
  it('a re-baseline over an existing file with a NEW red REFUSES to add it (file stays a subset)', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    // fresh baseline of the one red.
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    const firstBytes = fs.readFileSync(path.join(dir, BASELINE_RELPATH), 'utf8');
    const firstCount = JSON.parse(firstBytes).entries.length;
    // add a SECOND red (a new drifted extension).
    const driftSrc = fs.readFileSync(
      path.join(FIXROOT, 'extension-surface', 'drift-forbidden-import', 'src', 'extensions', 'luna-chat.extension.ts'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'src', 'extensions', 'luna-chat-second.extension.ts'), driftSrc);
    // re-baseline: it must REFUSE to add the new red — the file does NOT grow.
    const re = runCli(['baseline', '--repo', dir], dir);
    expect(re.status).toBe(0);
    expect(re.stderr).toContain('were NOT added'); // the shrink-only refusal is surfaced
    const secondBytes = fs.readFileSync(path.join(dir, BASELINE_RELPATH), 'utf8');
    const secondCount = JSON.parse(secondBytes).entries.length;
    expect(secondCount, 'a re-baseline never grows the accepted set').toBe(firstCount);
    // and the gate still FAILS — the second red was NOT smuggled into the baseline.
    expect(runCli(['gate', '--repo', dir], dir).status).toBe(1);
  });

  it('deleting the file + re-baseline is the PR-visible growth path (now the second red is accepted)', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    const driftSrc = fs.readFileSync(
      path.join(FIXROOT, 'extension-surface', 'drift-forbidden-import', 'src', 'extensions', 'luna-chat.extension.ts'),
      'utf8',
    );
    fs.writeFileSync(path.join(dir, 'src', 'extensions', 'luna-chat-second.extension.ts'), driftSrc);
    // the sanctioned growth: DELETE, then re-create fresh — accepts EVERYTHING currently red.
    fs.rmSync(path.join(dir, BASELINE_RELPATH));
    const fresh = runCli(['baseline', '--repo', dir], dir);
    expect(fresh.status).toBe(0);
    expect(fresh.stdout).toContain('FRESH creation');
    // now BOTH reds are baselined → gate GREEN.
    expect(runCli(['gate', '--repo', dir], dir).status).toBe(0);
  });

  it('a violation that disappears is AUTO-REMOVED on the next baseline write (the wall burns down)', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    // add a second drifted file, then FRESH-baseline both.
    const driftSrc = fs.readFileSync(
      path.join(FIXROOT, 'extension-surface', 'drift-forbidden-import', 'src', 'extensions', 'luna-chat.extension.ts'),
      'utf8',
    );
    const secondFile = path.join(dir, 'src', 'extensions', 'luna-chat-second.extension.ts');
    fs.writeFileSync(secondFile, driftSrc);
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    const twoCount = JSON.parse(fs.readFileSync(path.join(dir, BASELINE_RELPATH), 'utf8')).entries.length;
    expect(twoCount).toBeGreaterThanOrEqual(2);
    // FIX the second file (remove it) → its violation disappears. Re-baseline auto-removes it.
    fs.rmSync(secondFile);
    const shrink = runCli(['baseline', '--repo', dir], dir);
    expect(shrink.status).toBe(0);
    expect(shrink.stdout).toContain('auto-removed');
    const oneCount = JSON.parse(fs.readFileSync(path.join(dir, BASELINE_RELPATH), 'utf8')).entries.length;
    expect(oneCount, 'the baseline shrank when a violation was fixed').toBeLessThan(twoCount);
  });
});

describe('E2E (3) baselined-still-reported — a baselined violation is visible + counted, never hidden', () => {
  it('gate prints the BASELINED count + the violation, and stamps it non-blocking (not a silent green)', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    const gated = runCli(['gate', '--repo', dir], dir);
    expect(gated.status).toBe(0); // non-blocking
    // the baseline is ANNOUNCED (active banner) and the violation is COUNTED, not suppressed.
    expect(gated.stderr).toContain('BASELINE ACTIVE');
    expect(gated.stdout).toMatch(/baselined/i);
    // the per-blueprint line is the honest "graded fail; all N BASELINED — non-blocking", never a
    // plain "(pass)" — a reader can never mistake a baselined red for a graded green.
    expect(gated.stdout).toContain('BASELINED');
    expect(gated.stdout).not.toMatch(/score 100 \(pass\)/);
  });

  it('the seeded violation id is STILL named in the output (surfaced, per SPEC §9.1 "a skip is explicit")', () => {
    const dir = arrangeRepo('drift-forbidden-import');
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    const gated = runCli(['gate', '--repo', dir, '--all'], dir);
    // --all surfaces the actual constraint id of the baselined violation (the seeded no-direct-provider-sdk).
    expect(gated.stderr).toContain('no-direct-provider-sdk');
  });
});

describe('E2E — baseline never suppresses a FAIL-CLOSED refusal (an empty scan still blocks)', () => {
  it('a baseline present + an empty scan (no src) → still a score-0 FAIL, exit 1 (refusal is not baselineable)', () => {
    // arrange a red repo, baseline it, then REMOVE the src so the scan falls below the floor.
    const dir = arrangeRepo('drift-forbidden-import');
    expect(runCli(['baseline', '--repo', dir], dir).status).toBe(0);
    fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true });
    const r = runCli(['gate', '--repo', dir], dir);
    expect(r.status, 'a fail-closed refusal is never suppressed by a baseline').toBe(1);
    expect(r.stderr).toContain('FAILED');
    expect(r.stderr.toLowerCase()).toMatch(/fail-closed|scanned 0|expected >=/);
  });
});
