/**
 * Quality matrix for the scan→evidence→work-order ARROW: the traceId-stamped
 * hash-chained evidence record + the auto-generated PROPOSED remediation work-orders.
 */
import { describe, it, expect } from 'vitest';
import {
  toEvidenceRecord,
  verifyEvidenceChain,
  toWorkOrders,
  emitRun,
  canTransition,
  APPROVAL_FLOOR,
  EVIDENCE_GENESIS_HASH,
  type EvidenceRecord,
} from '../src/emit.js';
import type { ToolchainIdentity } from '../src/runtime-identity.js';
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
  score: 60,
  verdict: 'fail',
  violations: [
    { constraintId: 'no-direct-provider-sdk', severity: 'critical', component: 'extension:luna-chat', evidenceType: 'staticAst', evidenceRef: 'x.ts#L11', observed: 'forbidden edge -> openai', expected: 'no openai edge' },
    { constraintId: 'ext-registers', severity: 'high', component: 'extension:luna-chat', evidenceType: 'staticAst', evidenceRef: 'x.ts#L3', observed: 'no provides', expected: 'a governed registration' },
  ],
};

const toolchain: ToolchainIdentity = {
  engine: { name: 'bce-engine', version: '0.1.6' },
  dependencyLock: { file: 'npm-shrinkwrap.json', sha256: 'a'.repeat(64) },
  runtime: { node: '22.18.0', npm: '11.5.2', platform: 'linux', arch: 'x64' },
  extractor: { kind: 'ast', profile: 'plugin-surface', provider: 'typescript-ts-morph', version: '0.1.6' },
};

describe('evidence record + hash chain', () => {
  it('a genesis record chains from EVIDENCE_GENESIS_HASH and self-verifies', () => {
    const r = toEvidenceRecord(passReport);
    expect(r.previousHash).toBe(EVIDENCE_GENESIS_HASH);
    expect(r.traceId).toBe('luna-chat-extension');
    expect(verifyEvidenceChain([r])).toBe(-1);
  });

  it('is DETERMINISTIC — same report + prev → byte-identical record', () => {
    expect(JSON.stringify(toEvidenceRecord(failReport))).toBe(JSON.stringify(toEvidenceRecord(failReport)));
  });

  it('binds complete toolchain identity into current records and their hash', () => {
    const record = toEvidenceRecord(passReport, EVIDENCE_GENESIS_HASH, toolchain);
    expect(record.toolchain).toEqual(toolchain);
    const changed = toEvidenceRecord(passReport, EVIDENCE_GENESIS_HASH, {
      ...toolchain,
      runtime: { ...toolchain.runtime, npm: '11.6.0' },
    });
    expect(changed.hash).not.toBe(record.hash);
    expect(verifyEvidenceChain([record])).toBe(-1);
  });

  it('a two-record chain verifies when correctly linked', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, r1.hash);
    expect(r2.previousHash).toBe(r1.hash);
    expect(verifyEvidenceChain([r1, r2])).toBe(-1);
  });

  it('DETECTS a tampered record (score mutated) — chain break at that index', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, r1.hash);
    const tampered: EvidenceRecord = { ...r2, score: 999 }; // body changed, hash stale
    expect(verifyEvidenceChain([r1, tampered])).toBe(1);
  });

  it('DETECTS a broken link (wrong previousHash)', () => {
    const r1 = toEvidenceRecord(passReport);
    const r2 = toEvidenceRecord(failReport, 'wrong'.padEnd(64, '0'));
    expect(verifyEvidenceChain([r1, r2])).toBe(1);
  });

  it('an empty chain is vacuously intact', () => {
    expect(verifyEvidenceChain([])).toBe(-1);
  });
});

describe('work-order emission (the scan→WO arrow)', () => {
  it('a passing report emits ZERO work-orders', () => {
    expect(toWorkOrders(passReport)).toHaveLength(0);
  });

  it('a failing report emits one PROPOSED WO per violation, deterministic ids', () => {
    const wos = toWorkOrders(failReport);
    expect(wos).toHaveLength(2);
    expect(wos.every((w) => w.approvalState === 'PROPOSED')).toBe(true);
    expect(wos[0].traceId).toBe('luna-chat-extension');
    // deterministic id — re-run yields the same ids
    expect(toWorkOrders(failReport).map((w) => w.id)).toEqual(wos.map((w) => w.id));
    expect(wos[0].title).toContain('no-direct-provider-sdk');
  });
});

describe('APPROVAL_FLOOR (propose-not-apply)', () => {
  it('PROPOSED can only advance to ACKNOWLEDGED or REJECTED — never auto-RESOLVED', () => {
    expect(canTransition('PROPOSED', 'ACKNOWLEDGED')).toBe(true);
    expect(canTransition('PROPOSED', 'REJECTED')).toBe(true);
    expect(canTransition('PROPOSED', 'RESOLVED')).toBe(false);
    expect(canTransition('PROPOSED', 'APPROVED')).toBe(false);
  });

  it('terminal states have no outgoing transitions', () => {
    expect(canTransition('RESOLVED', 'APPROVED')).toBe(false);
    expect(canTransition('REJECTED', 'PROPOSED')).toBe(false);
  });

  it('APPROVAL_FLOOR is the full ordered set', () => {
    expect(APPROVAL_FLOOR).toEqual(['PROPOSED', 'ACKNOWLEDGED', 'APPROVED', 'RESOLVED', 'REJECTED']);
  });
});

describe('emitRun (the full emission)', () => {
  it('bundles the chained evidence + the proposed WOs', () => {
    const e = emitRun(failReport);
    expect(e.evidence.verdict).toBe('fail');
    expect(e.workOrders).toHaveLength(2);
    expect(verifyEvidenceChain([e.evidence])).toBe(-1);
  });
});
