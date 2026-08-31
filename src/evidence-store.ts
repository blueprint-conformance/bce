/**
 * The unified evidence store — JOIN THE TWO PLANES.
 *
 * An adopting estate's forensic evidence lives on TWO planes that never met:
 *
 *  1. the FLAT plane — plain append-only audit logs (JSONL lines: action audits, routing
 *     decisions, job telemetry, …). Human-legible, but UNCHAINED: a line can
 *     be deleted or reordered and nothing notices.
 *  2. the CHAINED plane — the hash-linked `EvidenceRecord` ledger from `emit.ts` (SHA-256
 *     `previousHash` linkage). Tamper-evident, but it only carries the conformance-run summary,
 *     not the rich per-action audit context.
 *
 * This module binds them by `traceId` (the blueprint-id chain key `emit.ts` stamps) so a single
 * unified `EvidenceItem[]` surfaces BOTH planes for one trace, plus a by-source COUNT surface, plus
 * a `compliancePack` that walks a chain end-to-end (via `verifyEvidenceChain`) and reports whether
 * it is intact. This is the pack a gate consumer / a CT board reads.
 *
 * PURE + self-contained: NO fs I/O here (the CALLER reads the JSONL — the honest-reporting invariant: an aggregator rolls
 * up REAL engine + REAL audit output only, it never fabricates a line). NO wall-clock, NO
 * Math.random, sorted output. Same in → byte-identical out. This package NEVER imports
 * CT/Prisma/a-private-contracts-package (consume-don't-duplicate — the `AuditLogLine`
 * shape below MIRRORS the well-known `.ai/audit/*.log` line, it does not import a CT type).
 */
import { createHash } from 'node:crypto';
import type { EvidenceRecord } from './emit.js';
import { verifyEvidenceChain } from './emit.js';

/* -------------------------------------------------------------------------- */
/* The flat audit plane (mirrored shape — the `.ai/audit/*.log` JSONL line)   */
/* -------------------------------------------------------------------------- */

/**
 * One line from a flat `.ai/audit/*.log` JSONL file. `ts` is always present (every audit line
 * carries a timestamp); `traceId` is the OPTIONAL join key — a line without one is unattributable
 * to a chain and is surfaced as such (never silently dropped, never silently attributed). All other
 * keys are arbitrary per-channel context (subject, action, verdict, bodyHash, …).
 */
export interface AuditLogLine {
  ts: string;
  traceId?: string;
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- */
/* The unified item (one row of either plane, keyed by trace)                 */
/* -------------------------------------------------------------------------- */

/**
 * A single unified evidence item spanning both planes. `source` names which plane it came from;
 * `traceId` is the join key ('' for an unattributable audit line — explicit, never guessed); `ref`
 * is a stable pointer back to the origin row (the audit line's `ts`, or the chain record's `id`).
 */
export interface EvidenceItem {
  source: 'audit' | 'chain' | 'boundary';
  traceId: string;
  ref: string;
}

/** The unattributable-trace sentinel — a flat audit line that carries no `traceId`. */
export const UNATTRIBUTED_TRACE = '';

function compareItems(a: EvidenceItem, b: EvidenceItem): number {
  // Deterministic total order: traceId, then source ('audit' < 'boundary' < 'chain',
  // a pure string compare — widening the union added 'boundary' alphabetically between the two
  // existing planes, so no numeric assumption and no reorder of 'audit'/'chain'), then ref.
  if (a.traceId !== b.traceId) return a.traceId < b.traceId ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
  return 0;
}

/**
 * Join the two planes into one sorted `EvidenceItem[]`. Each flat audit line becomes a
 * `source:'audit'` item (traceId '' when the line carried none); each chained record becomes a
 * `source:'chain'` item. Deterministic: the output is sorted by (traceId, source, ref) so the same
 * inputs — in any order — yield byte-identical output. Pure: no I/O, no wall-clock.
 */
/** Order-independent short content hash of an audit line (stable-key JSON → sha256[:8]). */
function lineHash(line: AuditLogLine): string {
  const keys = Object.keys(line).sort();
  const canonical = JSON.stringify(keys.map((k) => [k, line[k]]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}

export function joinPlanes(
  auditLines: readonly AuditLogLine[],
  evidenceRecords: readonly EvidenceRecord[],
): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  for (const line of auditLines) {
    // ref = ts + a short content-hash of the whole line, so two DISTINCT audit events sharing (ts,
    // traceId) stay forensically distinguishable (finding: ts-collision legibility) WITHOUT making
    // ref input-order-dependent (a content hash is order-independent → determinism holds). Two lines
    // that are byte-identical collapse to one ref — correct: they are the same event.
    items.push({
      source: 'audit',
      traceId: line.traceId ?? UNATTRIBUTED_TRACE,
      ref: `${line.ts}#${lineHash(line)}`,
    });
  }
  for (const rec of evidenceRecords) {
    items.push({ source: 'chain', traceId: rec.traceId, ref: rec.id });
  }
  items.sort(compareItems);
  return items;
}

/* -------------------------------------------------------------------------- */
/* The evidence-items count surface                                           */
/* -------------------------------------------------------------------------- */

export interface EvidenceItemsCount {
  audit: number;
  chain: number;
  boundary: number;
  total: number;
}

/** Count unified items by source + total. Pure, deterministic. Three-way switch so a 'boundary'
 * item (a gateway-boundary source) is counted as boundary — never silently as chain. */
export function evidenceItemsCount(items: readonly EvidenceItem[]): EvidenceItemsCount {
  let audit = 0;
  let chain = 0;
  let boundary = 0;
  for (const it of items) {
    if (it.source === 'audit') audit += 1;
    else if (it.source === 'boundary') boundary += 1;
    else chain += 1;
  }
  return { audit, chain, boundary, total: audit + chain + boundary };
}

/* -------------------------------------------------------------------------- */
/* The compliance-pack (walk a chain end-to-end)                              */
/* -------------------------------------------------------------------------- */

export interface CompliancePack {
  /** true iff the whole chain verifies (each previousHash links + each hash re-derives). */
  chainIntact: boolean;
  /** the index of the first broken link, or -1 for an intact (or empty) chain. */
  brokenAt: number;
  /** the number of records in the chain. */
  records: number;
  /** the distinct traceIds the chain covers, sorted + de-duplicated. */
  traces: string[];
}

/**
 * Walk a chained `EvidenceRecord[]` end-to-end into a compliance-pack: whether it is intact (via
 * `verifyEvidenceChain` from emit.js — the single source of chain-verification truth), where it
 * first breaks, how many records it holds, and which traceIds it covers. Deterministic: `traces`
 * is sorted + de-duplicated. An empty chain is vacuously intact (`brokenAt -1`, `records 0`,
 * `traces []`) — mirrors `verifyEvidenceChain([]) === -1`.
 */
export function compliancePack(chain: readonly EvidenceRecord[]): CompliancePack {
  const brokenAt = verifyEvidenceChain(chain);
  const traces = [...new Set(chain.map((r) => r.traceId))].sort();
  return {
    chainIntact: brokenAt === -1,
    brokenAt,
    records: chain.length,
    traces,
  };
}
