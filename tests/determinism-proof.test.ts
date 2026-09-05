/**
 * The determinism + re-derivability PROOF.
 *
 * The whole Blueprint Conformance Engine is a CONFORMANCE ENGINE (not a compiler): its value is
 * that a verdict is re-derivable — a green (or red) gate must mean "the same inputs always produce
 * the same, byte-identical evidence", never "a run happened to pass this time". Determinism is
 * load-bearing (the honest-reporting invariant / widen-only ratchet): if two runs over the SAME (blueprint, repo revision)
 * could disagree by a byte, the ComplianceReport is not evidence and the append-only evidence chain
 * (emit.ts) and the score time-series (score.ts) rest on sand.
 *
 * This test proves that end-to-end over the REAL pipeline — parseBlueprint → resolveExtraction →
 * AstExtractor → evaluate → toEvidenceRecord → architectureScore — run TWICE from the same inputs,
 * over a real committed fixture surface. Every stage must be byte-identical across the two
 * independent computations. No mocks, no hand-built reports: the aggregators roll up REAL engine
 * output (never fabricate data).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { evaluate, stableStringify } from '../src/report.js';
import { AstExtractor, resolveExtraction } from '../src/extractors.js';
import { parseBlueprint } from '../src/schema.js';
import { toEvidenceRecord } from '../src/emit.js';
import { architectureScore } from '../src/score.js';
import type { ComplianceReport } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

/** Parse the authored blueprint fresh from disk — a re-parse is part of re-derivability. */
const readBlueprint = () => parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));

const surface = (name: string): string => path.join(FIXROOT, 'extension-surface', name);

/**
 * Build a ComplianceReport the way the CLI does: re-read + re-parse the blueprint, resolve the
 * extraction config, run a FRESH AstExtractor over the fixture surface, then evaluate(). A pinned
 * revision string stands in for a repo sha — the determinism anchor is the input, never wall-clock.
 */
function buildReport(surfaceName: string, revision: string): ComplianceReport {
  const blueprint = readBlueprint();
  const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
  const graph = new AstExtractor(cfg).extract(surface(surfaceName), revision);
  return evaluate(blueprint, graph, 'plugin-surface');
}

/* -------------------------------------------------------------------------- */
describe('determinism + re-derivability proof', () => {
  // the primary re-derivability fixture: a RED surface (a forbidden `openai` import), so the proof
  // covers a report WITH violations — a byte-stable failing report is what the evidence chain and
  // the WO emission depend on. A pass-only proof would not exercise the violation-sorting path.
  const REVISION = 'proof-rev-1';
  const SURFACE = 'drift-forbidden-import';

  it('serializes repeated references deterministically but still refuses true cycles', () => {
    const shared = { z: 1, a: 2 };
    expect(stableStringify({ right: shared, left: shared })).toBe(
      '{\n  "left": {\n    "a": 2,\n    "z": 1\n  },\n  "right": {\n    "a": 2,\n    "z": 1\n  }\n}\n',
    );
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow('cannot serialize a cycle');
  });

  it('ComplianceReport is BYTE-IDENTICAL across two independent computations', () => {
    const a = buildReport(SURFACE, REVISION);
    const b = buildReport(SURFACE, REVISION);
    // stableStringify is the canonical serialization the whole engine hashes on — byte equality
    // here is the load-bearing claim (not merely structural/deep equality).
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('the report is a REAL red verdict (the proof exercises the violation path, not a vacuous pass)', () => {
    const r = buildReport(SURFACE, REVISION);
    expect(r.verdict).toBe('fail');
    expect(r.violations.length).toBeGreaterThan(0);
    // the forbidden provider-SDK import is the drift this surface plants — proves we ran a REAL scan.
    expect(r.violations.some((v) => v.constraintId === 'no-direct-provider-sdk')).toBe(true);
  });

  it('the report content-hash (evidenceRef, over the observed graph) is byte-stable', () => {
    const a = buildReport(SURFACE, REVISION);
    const b = buildReport(SURFACE, REVISION);
    // evidenceRef embeds sha256(stableStringify(graph)) — a stable ref proves the OBSERVED GRAPH
    // (extractor output) re-derived byte-for-byte, upstream of evaluate's own determinism.
    expect(a.evidenceRef).toBe(b.evidenceRef);
    expect(a.evidenceRef).toMatch(/^architecture-graph\.json@sha256:[0-9a-f]{64}$/);
  });

  it('the emit.ts EVIDENCE RECORD is byte-identical across two computations (chain re-derivability)', () => {
    // A tamper-evident hash-chain is only meaningful if the genesis record re-derives deterministically
    // from the same report — else re-running `bce run` would fork the chain. Prove the record (hash
    // included) is byte-stable from two independently-built reports.
    const e1 = toEvidenceRecord(buildReport(SURFACE, REVISION));
    const e2 = toEvidenceRecord(buildReport(SURFACE, REVISION));
    expect(stableStringify(e1)).toBe(stableStringify(e2));
    // the chain link itself (the sha256 of the canonical body) must match.
    expect(e1.hash).toBe(e2.hash);
    // and the record correctly traces back to the subsystem it evidences.
    expect(e1.traceId).toBe('luna-chat-extension');
  });

  it('the score.ts ARCHITECTURE SCORE is byte-identical across two computations (observability re-derivability)', () => {
    // The fleet Architecture Score is a pure rollup of REAL ComplianceReports (never a
    // dashboard over nothing). Rolling up two independently-built reports must be byte-stable, else
    // the score time-series would drift for a repo that never changed.
    const s1 = architectureScore([buildReport(SURFACE, REVISION)]);
    const s2 = architectureScore([buildReport(SURFACE, REVISION)]);
    expect(stableStringify(s1)).toBe(stableStringify(s2));
    // the rollup is over the engine's own output — one subsystem, its verdict preserved.
    expect(s1.total).toBe(1);
    expect(s1.subsystems[0]?.subsystem).toBe('luna-chat-extension');
    expect(s1.subsystems[0]?.verdict).toBe('fail');
  });

  it('re-derivability holds on the GREEN surface too (a conformant scan is equally byte-stable)', () => {
    // Determinism must not be a property of the failing path only — a passing report is the one a
    // gate lets through, so its re-derivability is what makes a green gate trustworthy.
    const a = buildReport('conformant', 'proof-rev-conformant');
    const b = buildReport('conformant', 'proof-rev-conformant');
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(a.verdict).toBe('pass');
    expect(a.violations).toHaveLength(0);
    // its evidence record + architecture score are also byte-stable.
    expect(stableStringify(toEvidenceRecord(a))).toBe(stableStringify(toEvidenceRecord(b)));
    expect(stableStringify(architectureScore([a]))).toBe(stableStringify(architectureScore([b])));
  });

  it('the FULL pipeline artifact bundle (report + evidence + score) re-derives byte-for-byte at once', () => {
    // The end-to-end claim, in one assertion: parse → extract → evaluate → emit → score, computed
    // twice from the same inputs, produces a byte-identical serialized bundle. This is the single
    // statement that "the engine is re-derivable".
    const bundle = (rev: string) => {
      const report = buildReport(SURFACE, rev);
      return stableStringify({
        report,
        evidence: toEvidenceRecord(report),
        score: architectureScore([report]),
      });
    };
    expect(bundle(REVISION)).toBe(bundle(REVISION));
  });
});
