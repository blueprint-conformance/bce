/**
 * Quality matrix for the unified evidence store: joining the flat `.ai/audit/*.log`
 * plane to the hash-chained EvidenceRecord plane by traceId, the by-source count surface, and the
 * end-to-end compliance-pack walk.
 */
import { describe, it, expect } from 'vitest';
import {
  joinPlanes,
  evidenceItemsCount,
  compliancePack,
  UNATTRIBUTED_TRACE,
  type AuditLogLine,
} from '../src/evidence-store.js';
import { toEvidenceRecord, type EvidenceRecord } from '../src/emit.js';
import type { ComplianceReport } from '../src/report.js';

const passReport: ComplianceReport = {
  schemaVersion: '1',
  blueprintRef: 'luna-chat-extension@0.1.0',
  ctRepoRevision: 'abc123',
  score: 100,
  verdict: 'pass',
  violations: [],
  evidenceRef: 'architecture-graph.json@sha256:deadbeef',
  summary: 'ok',
  coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
};

const failReport: ComplianceReport = {
  ...passReport,
  blueprintRef: 'cis-store@0.2.0',
  score: 60,
  verdict: 'fail',
  violations: [
    { constraintId: 'no-direct-provider-sdk', severity: 'critical', component: 'c', evidenceType: 'staticAst', evidenceRef: 'x.ts#L11', observed: '', expected: '' },
  ],
};

// two flat audit lines: one attributed to the luna trace, one unattributed (no traceId)
const auditLines: AuditLogLine[] = [
  { ts: '2026-07-18T10:00:00Z', traceId: 'luna-chat-extension', subject: 'luna', action: 'DEPLOY', verdict: 'sent-201' },
  { ts: '2026-07-18T09:00:00Z', subject: 'ad-hoc', action: 'OTHER' }, // no traceId
];

describe('joinPlanes (bind the two planes by traceId)', () => {
  it('produces one audit item per line + one chain item per record', () => {
    const rec = toEvidenceRecord(passReport);
    const items = joinPlanes(auditLines, [rec]);
    expect(items).toHaveLength(3);
    expect(evidenceItemsCount(items)).toEqual({ audit: 2, chain: 1, boundary: 0, total: 3 });
  });

  it('an audit line WITHOUT a traceId is surfaced as unattributed (never guessed, never dropped)', () => {
    const items = joinPlanes(auditLines, []);
    const unattributed = items.filter((i) => i.traceId === UNATTRIBUTED_TRACE);
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].ref).toMatch(/^2026-07-18T09:00:00Z#[0-9a-f]{8}$/);
  });

  it('an audit line binds to its chain record by shared traceId', () => {
    const rec = toEvidenceRecord(passReport); // traceId 'luna-chat-extension'
    const items = joinPlanes(auditLines, [rec]);
    const luna = items.filter((i) => i.traceId === 'luna-chat-extension');
    // one from the audit plane, one from the chain plane — the join
    expect(luna.map((i) => i.source).sort()).toEqual(['audit', 'chain']);
  });

  it('is DETERMINISTIC + sorted — input order does not change output', () => {
    const rA = toEvidenceRecord(passReport);
    const rB = toEvidenceRecord(failReport);
    const forward = joinPlanes(auditLines, [rA, rB]);
    const reversed = joinPlanes([...auditLines].reverse(), [rB, rA]);
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    // explicitly sorted by (traceId, source, ref)
    const traceOrder = forward.map((i) => i.traceId);
    expect(traceOrder).toEqual([...traceOrder].sort());
  });

  it('empty planes → empty join', () => {
    expect(joinPlanes([], [])).toEqual([]);
  });
});

describe('evidenceItemsCount', () => {
  it('counts by source + total', () => {
    const rec = toEvidenceRecord(passReport);
    expect(evidenceItemsCount(joinPlanes(auditLines, [rec]))).toEqual({ audit: 2, chain: 1, boundary: 0, total: 3 });
  });

  it('empty items → all zero', () => {
    expect(evidenceItemsCount([])).toEqual({ audit: 0, chain: 0, boundary: 0, total: 0 });
  });

  it('counts a boundary-source item as boundary — never silently as chain (3-way switch)', () => {
    const items = [
      { source: 'audit' as const, traceId: 't', ref: 'a1' },
      { source: 'boundary' as const, traceId: 't', ref: 'b1' },
      { source: 'boundary' as const, traceId: 't', ref: 'b2' },
      { source: 'chain' as const, traceId: 't', ref: 'c1' },
    ];
    expect(evidenceItemsCount(items)).toEqual({ audit: 1, chain: 1, boundary: 2, total: 4 });
  });
});

describe('compliancePack (walk a chain end-to-end)', () => {
  it('an intact two-record chain packs as chainIntact with sorted distinct traces', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, r1.hash);
    const pack = compliancePack([r1, r2]);
    expect(pack.chainIntact).toBe(true);
    expect(pack.brokenAt).toBe(-1);
    expect(pack.records).toBe(2);
    // 'cis-store' < 'luna-chat-extension' — sorted + distinct
    expect(pack.traces).toEqual(['cis-store', 'luna-chat-extension']);
  });

  it('DETECTS a tampered chain and reports brokenAt', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, r1.hash);
    const tampered: EvidenceRecord = { ...r2, score: 999 }; // body changed, hash stale
    const pack = compliancePack([r1, tampered]);
    expect(pack.chainIntact).toBe(false);
    expect(pack.brokenAt).toBe(1);
  });

  it('de-duplicates traces across a multi-record single-trace chain', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(passReport, r1.hash); // same traceId
    const pack = compliancePack([r1, r2]);
    expect(pack.traces).toEqual(['luna-chat-extension']);
    expect(pack.records).toBe(2);
  });

  it('an empty chain is vacuously intact', () => {
    const pack = compliancePack([]);
    expect(pack.chainIntact).toBe(true);
    expect(pack.brokenAt).toBe(-1);
    expect(pack.records).toBe(0);
    expect(pack.traces).toEqual([]);
  });

  it('is DETERMINISTIC — same chain → byte-identical pack', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, r1.hash);
    expect(JSON.stringify(compliancePack([r1, r2]))).toBe(JSON.stringify(compliancePack([r1, r2])));
  });
});
