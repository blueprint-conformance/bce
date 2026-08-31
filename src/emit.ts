/**
 * The scan→evidence→work-order ARROW — the single biggest missing link.
 *
 * `bce run` already produces a deterministic ComplianceReport. This module closes the two arrows
 * the report did not yet emit:
 *
 *  1. an immutable, traceId-stamped EVIDENCE RECORD chained over prior runs (the same
 *     append-only hash-chain shape a governed audit-history ledger uses — SHA-256
 *     `previousHash` linkage), so a sequence of `bce run`s is a tamper-evident ledger; and
 *  2. structured WORK-ORDER objects auto-generated from the report's violations, each
 *     `approvalState: PROPOSED` and advancing only through the APPROVAL_FLOOR transition matrix
 *     (propose-not-apply — propose-not-merge; a violation becomes a governed proposal,
 *     never an auto-applied change).
 *
 * Self-contained: this package NEVER imports host-estate packages (consume-don't-duplicate
 * is satisfied by mirroring the well-known hash-chain + APPROVAL_FLOOR
 * SHAPES; the host-side materialization of these records is a separate, operator-gated
 * surface). Pure + deterministic: same (report, previousHash) in → byte-identical records out.
 */
import { createHash } from 'node:crypto';
import type { ComplianceReport, Violation } from './report.js';
import type { Severity } from './schema.js';
import { stableStringify } from './report.js';

/* -------------------------------------------------------------------------- */
/* Evidence record (the append-only hash-chain)                               */
/* -------------------------------------------------------------------------- */

export interface EvidenceRecord {
  schemaVersion: '1';
  /** stable id for this run's evidence — content-derived, deterministic. */
  id: string;
  /** the trace this evidence belongs to (blueprint id — one chain per subsystem). */
  traceId: string;
  blueprintRef: string;
  ctRepoRevision: string;
  score: number;
  verdict: 'pass' | 'fail';
  violationCount: number;
  /** the report's own content-addressed evidence pointer (the graph hash). */
  reportEvidenceRef: string;
  /** SHA-256 of the PREVIOUS record in the chain, or the genesis sentinel. */
  previousHash: string;
  /** SHA-256 of THIS record's canonical body (previousHash included) — the chain link. */
  hash: string;
}

/** The genesis previousHash for the first evidence record in a chain. */
export const EVIDENCE_GENESIS_HASH = '0'.repeat(64);

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Build the immutable evidence record for a ComplianceReport, chained onto `previousHash`
 * (EVIDENCE_GENESIS_HASH for the first run). Deterministic: no wall-clock — the record's identity
 * is the content hash, so the same report + same previousHash always yields the same record.
 */
export function toEvidenceRecord(report: ComplianceReport, previousHash: string = EVIDENCE_GENESIS_HASH): EvidenceRecord {
  const body = {
    schemaVersion: '1' as const,
    traceId: report.blueprintRef.split('@')[0] ?? report.blueprintRef,
    blueprintRef: report.blueprintRef,
    ctRepoRevision: report.ctRepoRevision,
    score: report.score,
    verdict: report.verdict,
    violationCount: report.violations.length,
    reportEvidenceRef: report.evidenceRef,
    previousHash,
  };
  const canonical = stableStringify(body);
  const hash = sha256(canonical);
  return { ...body, id: `evidence:${report.blueprintRef}:${hash.slice(0, 16)}`, hash };
}

/**
 * Verify an evidence chain is intact and un-tampered: each record's `previousHash` matches the
 * prior record's `hash`, and each record's `hash` re-derives from its body. Returns the index of
 * the first broken link, or -1 if the whole chain verifies. Empty chain → -1 (vacuously intact).
 */
export function verifyEvidenceChain(chain: readonly EvidenceRecord[]): number {
  let prev = EVIDENCE_GENESIS_HASH;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i]!;
    if (r.previousHash !== prev) return i;
    const { id, hash, ...body } = r;
    void id;
    if (sha256(stableStringify(body)) !== hash) return i;
    prev = r.hash;
  }
  return -1;
}

/* -------------------------------------------------------------------------- */
/* Work-order emission (the scan→WO arrow)                                    */
/* -------------------------------------------------------------------------- */

/** APPROVAL_FLOOR — the governed lifecycle a proposed remediation WO advances through. */
export const APPROVAL_FLOOR = ['PROPOSED', 'ACKNOWLEDGED', 'APPROVED', 'RESOLVED', 'REJECTED'] as const;
export type ApprovalState = (typeof APPROVAL_FLOOR)[number];

/** The permitted transitions (propose-not-apply: nothing auto-advances past PROPOSED). */
const APPROVAL_TRANSITIONS: Record<ApprovalState, readonly ApprovalState[]> = {
  PROPOSED: ['ACKNOWLEDGED', 'REJECTED'],
  ACKNOWLEDGED: ['APPROVED', 'REJECTED'],
  APPROVED: ['RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

/** True iff `from → to` is a permitted APPROVAL_FLOOR transition. */
export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  return APPROVAL_TRANSITIONS[from].includes(to);
}

export interface RemediationWorkOrder {
  schemaVersion: '1';
  /** deterministic id derived from the violation (stable across identical runs). */
  id: string;
  traceId: string;
  blueprintRef: string;
  constraintId: string;
  severity: Severity;
  component: string;
  /** the evidence anchor (path#Lnn) the violation cited. */
  evidenceRef: string;
  title: string;
  body: string;
  /** every auto-generated WO starts PROPOSED — a governed proposal, never auto-applied. */
  approvalState: ApprovalState;
}

/**
 * Auto-generate one structured, PROPOSED remediation work-order per violation in a report.
 * Deterministic: ids/order derive from the sorted violation set. Zero violations → [].
 */
export function toWorkOrders(report: ComplianceReport): RemediationWorkOrder[] {
  const traceId = report.blueprintRef.split('@')[0] ?? report.blueprintRef;
  return report.violations.map((v: Violation) => {
    // include evidenceRef in the id key so two violations sharing (constraintId, component) but at
    // different lines get DISTINCT, non-colliding WO ids (finding: id-collision seam).
    const key = `${v.constraintId}:${v.component}:${v.evidenceRef}`;
    const id = `wo:${report.blueprintRef}:${sha256(key).slice(0, 16)}`;
    return {
      schemaVersion: '1' as const,
      id,
      traceId,
      blueprintRef: report.blueprintRef,
      constraintId: v.constraintId,
      severity: v.severity,
      component: v.component,
      evidenceRef: v.evidenceRef,
      title: `[${v.severity}] ${v.constraintId} — ${v.component}`,
      body: `Blueprint conformance violation in ${report.blueprintRef} @ ${report.ctRepoRevision}.\nObserved: ${v.observed}\nExpected: ${v.expected}\nEvidence: ${v.evidenceRef}`,
      approvalState: 'PROPOSED' as const,
    };
  });
}

/**
 * The full emission for a run: the chained evidence record + the proposed remediation WOs.
 * Pass the prior run's evidence hash to chain; omit for the genesis run.
 */
export interface RunEmission {
  evidence: EvidenceRecord;
  workOrders: RemediationWorkOrder[];
}

export function emitRun(report: ComplianceReport, previousHash: string = EVIDENCE_GENESIS_HASH): RunEmission {
  return { evidence: toEvidenceRecord(report, previousHash), workOrders: toWorkOrders(report) };
}
