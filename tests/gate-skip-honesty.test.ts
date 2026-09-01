/**
 * FIX-B + FIX-E — first-class, EXPLICIT gate-mode skips (the widen-only ratchet: an un-gradeable
 * constraint is NEVER silently satisfied. Any ungradeable constraint produces a structural
 * refusal (exit 2 at the CLI boundary), while gradeable statics still provide diagnostics.
 *
 * Proves:
 *  - FIX-B: a behavioralInvariant (run-only, behaviorObservation-class) constraint is SKIPPED in
 *    `bce gate` with an explicit refusal + `runOnlySkipped` count; an ALL-behavioral blueprint is
 *    a score-0 refusal, never an unexplained green. (`bce run --observations` remains the grader —
 *    report.ts's behavioralInvariant fail-close is untouched.)
 *  - FIX-E a: an unknown (newer-engine) constraint type is DROPPED per-constraint with an explicit
 *    refusal + `unknownConstraintsSkipped` count; known constraints still yield diagnostics; an
 *    ALL-unknown blueprint is a hard fail-closed parse failure; any OTHER malformation still throws.
 *  - FIX-E b: `minEngineVersion` above the running engine yields the CLEAR "upgrade the pinned
 *    engine" score-0 report (not a zod enum trace); equal/below grades normally.
 *  - Back-compat: the pre-existing path (no behavioral, no unknown, no pin) is byte-transparent —
 *    no new GateResult keys, no summary amendment, tolerant parse === strict parse.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGate, resolveEngineVersion, semverLt } from '../src/gate.js';
import {
  parseBlueprint,
  parseBlueprintTolerant,
  constraintEvidenceClass,
  ConstraintTypeSchema,
  RUNTIME_OBSERVATION_CONSTRAINTS,
} from '../src/schema.js';
import { stableStringify } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const LUNA_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');
const CT_PATH = path.join(FIXROOT, 'control-tower-ontology.blueprint.json');
const LUNA = JSON.parse(fs.readFileSync(LUNA_PATH, 'utf8')) as Record<string, unknown> & {
  constraints: Record<string, unknown>[];
};
const EXT = 'src/extensions/luna-chat.extension.ts';

/** A run-only (behaviorObservation-class) constraint — gradeable ONLY by bce run --observations. */
const BI = { id: 'served-substance', type: 'behavioralInvariant', severity: 'critical', behaviorRef: 'dash' };
/** A constraint type from a NEWER engine this pinned engine's enum does not carry. */
const UNKNOWN = { id: 'future-quantum', type: 'quantumInvariant', severity: 'high' };

/** Luna fixture with top-level overrides (deep-cloned so tests never share mutable state). */
function lunaVariant(overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...structuredClone(LUNA), ...overrides };
}

/** Arrange a throwaway contributor repo with a CUSTOM blueprint JSON (gate.test.ts pattern). */
function writeRepo(
  bpJson: unknown,
  sourceVariant: 'conformant' | 'drift-forbidden-import' | 'none',
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-skip-'));
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.blueprints', 'under-test.blueprint.json'),
    JSON.stringify(bpJson, null, 2),
  );
  if (sourceVariant !== 'none') {
    fs.cpSync(path.join(FIXROOT, 'extension-surface', sourceVariant, 'src'), path.join(dir, 'src'), {
      recursive: true,
    });
  }
  return dir;
}

function gate(dir: string, changed: string[] | null = null) {
  return runGate(dir, path.join(dir, '.blueprints'), changed, 'ast');
}

describe('constraintEvidenceClass — the pure classifier (derived from type, no authored field)', () => {
  it('behavioralInvariant is behaviorObservation-class', () => {
    expect(constraintEvidenceClass('behavioralInvariant')).toBe('behaviorObservation');
    expect(RUNTIME_OBSERVATION_CONSTRAINTS.has('behavioralInvariant')).toBe(true);
  });

  it('EVERY other enum member is staticAst-class (the run-only set is exactly behavioralInvariant)', () => {
    for (const t of ConstraintTypeSchema.options.filter((x) => x !== 'behavioralInvariant')) {
      expect(constraintEvidenceClass(t)).toBe('staticAst');
    }
    expect([...RUNTIME_OBSERVATION_CONSTRAINTS]).toEqual(['behavioralInvariant']);
  });
});

describe('FIX-B — run-only constraint skip in gate mode', () => {
  it('MIXED conformant: statics diagnose PASS but the ungraded behavioralInvariant REFUSES the gate', () => {
    const dir = writeRepo(lunaVariant({ constraints: [...LUNA.constraints, BI] }), 'conformant');
    const r = gate(dir, [EXT]);
    expect(r.failed).toBe(true);
    expect(r.reports[0].verdict).toBe('pass');
    expect(r.runOnlySkipped).toBe(1);
    // the advisory is explicit, on BOTH surfaces: GateResult.warnings AND the report summary.
    expect(r.warnings).toBeDefined();
    expect(
      r.warnings!.some((w) =>
        w.includes("run-only constraint served-substance (behavioralInvariant) is not gradeable"),
      ),
    ).toBe(true);
    expect(r.reports[0].summary).toContain('1 run-only constraint(s) skipped in gate mode');
    expect(r.refusals).toHaveLength(1);
    // never a violation — the skip is not a RED (report.ts's run-path fail-close is untouched).
    expect(r.reports[0].violations.map((v) => v.constraintId)).not.toContain('served-substance');
  });

  it('MIXED drift: verdict tracks the STATICS (real forbidden-import violation), skip still explicit', () => {
    const dir = writeRepo(lunaVariant({ constraints: [...LUNA.constraints, BI] }), 'drift-forbidden-import');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    const ids = r.reports[0].violations.map((v) => v.constraintId);
    expect(ids).toContain('no-direct-provider-sdk');
    expect(ids).not.toContain('served-substance');
    expect(r.runOnlySkipped).toBe(1);
  });

  it('ALL-BEHAVIORAL: score-0 REFUSAL — never __no-enforcing-constraints__, never green', () => {
    // no source at all: with zero static constraints there is no static surface to scan.
    const dir = writeRepo(lunaVariant({ constraints: [BI] }), 'none');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    const report = r.reports[0];
    expect(report.verdict).toBe('fail');
    expect(report.score).toBe(0);
    expect(report.violations).toHaveLength(0);
    // the pass is EXPLAINED — a reader cannot mistake it for a graded pass.
    expect(report.summary).toContain('0 static constraint(s) graded in gate mode');
    expect(report.summary).toContain('1 run-only constraint(s) skipped');
    expect(report.summary).toContain('gate REFUSED');
    expect(report.coverage.unsupported.some((u) => u.includes("'served-substance'"))).toBe(true);
    // and it is NOT the fail-closed enforces-nothing marker (the blueprint DOES enforce — at run time).
    expect(stableStringify(report)).not.toContain('__no-enforcing-constraints__');
    expect(r.runOnlySkipped).toBe(1);
    expect(r.warnings).toBeDefined();
    expect(r.refusals).toHaveLength(1);
  });
});

describe('FIX-E a — unknown constraint type: per-constraint drop, never whole-file parse-reject', () => {
  const threeStatics = () => LUNA.constraints.slice(0, 3).map((c) => structuredClone(c));

  it('3 valid statics + 1 unknown: known statics diagnose PASS, but the unknown type REFUSES', () => {
    const dir = writeRepo(lunaVariant({ constraints: [...threeStatics(), UNKNOWN] }), 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].verdict).toBe('pass');
    expect(r.reports[0].score).toBe(100); // graded, NOT the score-0 parse-reject
    expect(r.reports[0].summary).not.toContain('failed to parse');
    expect(r.unknownConstraintsSkipped).toBe(1);
    expect(
      r.warnings!.some(
        (w) => w.includes("unknown constraint type 'quantumInvariant' (id future-quantum) is not gradeable") && w.includes('upgrade the gate pin'),
      ),
    ).toBe(true);
    expect(r.reports[0].summary).toContain('1 unknown constraint type(s) skipped');
    expect(r.refusals).toHaveLength(1);
  });

  it('3 valid statics + 1 unknown on a DRIFT tree: the statics still have teeth (real violation fires)', () => {
    const dir = writeRepo(lunaVariant({ constraints: [...threeStatics(), UNKNOWN] }), 'drift-forbidden-import');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].violations.map((v) => v.constraintId)).toContain('no-direct-provider-sdk');
    expect(r.unknownConstraintsSkipped).toBe(1);
  });

  it('ALL-unknown: hard fail-closed parse failure (this engine can grade nothing)', () => {
    const dir = writeRepo(
      lunaVariant({ constraints: [UNKNOWN, { id: 'u2', type: 'anotherFutureType', severity: 'low' }] }),
      'conformant',
    );
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].score).toBe(0);
    expect(r.reports[0].summary).toContain('failed to parse');
    expect(r.reports[0].summary).toContain('unknown types');
    expect(r.reports[0].summary).toContain('upgrade the pinned engine');
    // nothing was graded → the skip counters stay OFF (they count skips within a graded run).
    expect('unknownConstraintsSkipped' in r).toBe(false);
  });

  it('unknown type + a malformed KNOWN constraint: still fail-closed (tolerance never widens past the unknown-type drop)', () => {
    // forbiddenPattern without a pattern violates the superRefine — real corruption, must throw.
    const badKnown = { id: 'bad-pattern', type: 'forbiddenPattern', severity: 'high' };
    const dir = writeRepo(lunaVariant({ constraints: [...threeStatics(), badKnown, UNKNOWN] }), 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].summary).toContain('failed to parse');
  });

  it('unknown type + bad metadata: still fail-closed (the re-parse rejects the remainder)', () => {
    const bp = lunaVariant({ constraints: [...threeStatics(), UNKNOWN] });
    bp.metadata = { ...(bp.metadata as Record<string, unknown>), version: 'not-semver' };
    const dir = writeRepo(bp, 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].summary).toContain('failed to parse');
  });

  it('parseBlueprintTolerant: a NON-unknown-shaped failure rethrows the original strict error', () => {
    const bad = lunaVariant({});
    delete (bad as Record<string, unknown>).intentRefs;
    expect(() => parseBlueprintTolerant(bad)).toThrow();
    expect(() => parseBlueprintTolerant('not an object')).toThrow();
  });
});

describe('FIX-E b — minEngineVersion honesty gate', () => {
  it('resolveEngineVersion reads THIS package.json version (never the 0.0.0 fail-closed floor here)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { version: string };
    expect(resolveEngineVersion()).toBe(pkg.version);
  });

  it('semverLt compares NUMERICALLY (0.9.0 < 0.10.0 — not lexicographic)', () => {
    expect(semverLt('0.9.0', '0.10.0')).toBe(true);
    expect(semverLt('0.10.0', '0.11.0')).toBe(true);
    expect(semverLt('1.0.0', '0.9.9')).toBe(false);
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
  });

  it('pin ABOVE the running engine → the CLEAR version-error report, not a zod enum trace', () => {
    const dir = writeRepo(lunaVariant({ minEngineVersion: '99.0.0' }), 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].score).toBe(0);
    expect(r.reports[0].summary).toBe(
      `blueprint requires engine >= 99.0.0, gate is running ${resolveEngineVersion()} — upgrade the pinned engine`,
    );
    expect(r.reports[0].summary).not.toContain('failed to parse');
  });

  it('pin EQUAL to the running engine → normal grading (conformant passes)', () => {
    // Blueprint pins are plain x.y.z by format (schema regex mirrors enginePin), while a
    // pre-release engine version carries a `-suffix`; pin the numeric base triple — that IS
    // the engine's own version under semverLt's numeric-triple model.
    const basePin = resolveEngineVersion().replace(/-.+$/, '');
    const dir = writeRepo(lunaVariant({ minEngineVersion: basePin }), 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(false);
    expect(r.reports[0].verdict).toBe('pass');
  });

  it('pin BELOW the running engine → normal grading (drift still reddens — the pin never weakens teeth)', () => {
    const dir = writeRepo(lunaVariant({ minEngineVersion: '0.0.1' }), 'drift-forbidden-import');
    const r = gate(dir);
    expect(r.failed).toBe(true);
    expect(r.reports[0].violations.map((v) => v.constraintId)).toContain('no-direct-provider-sdk');
  });

  it('schema: minEngineVersion is semver-regex gated (mirrors enginePin); valid pin round-trips', () => {
    expect(() => parseBlueprint(lunaVariant({ minEngineVersion: 'not-semver' }))).toThrow();
    expect(parseBlueprint(lunaVariant({ minEngineVersion: '1.2.3' })).minEngineVersion).toBe('1.2.3');
  });
});

describe('back-compat — the pre-existing path is byte-transparent (widen-only proof)', () => {
  it('luna conformant gate: NO new GateResult keys, NO summary amendment (the gate.test.ts-pinned shape)', () => {
    const dir = writeRepo(structuredClone(LUNA), 'conformant');
    const r = gate(dir);
    expect(r.failed).toBe(false);
    expect(r.reports[0].verdict).toBe('pass');
    expect(r.reports[0].score).toBe(100);
    expect('runOnlySkipped' in r).toBe(false);
    expect('unknownConstraintsSkipped' in r).toBe(false);
    expect('warnings' in r).toBe(false);
    const bytes = stableStringify(r.reports[0]);
    expect(bytes).not.toContain('run-only');
    expect(bytes).not.toContain('unknown constraint');
  });

  it('parseBlueprintTolerant === parseBlueprint on BOTH committed fixtures (fast path is strict, zero skips)', () => {
    for (const p of [LUNA_PATH, CT_PATH]) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      const tolerant = parseBlueprintTolerant(raw);
      expect(tolerant.unknownConstraintsSkipped).toEqual([]);
      expect(stableStringify(tolerant.blueprint)).toBe(stableStringify(parseBlueprint(raw)));
    }
  });
});
