/**
 * A record's `id` is not part of its hashed body, so the engine-side chain verifier must bind it
 * to the content explicitly, exactly as the offline tools/verify-chain.mjs does. Otherwise a record
 * carrying another blueprint's id still verified as intact.
 */
import { describe, expect, it } from 'vitest';
import { toEvidenceRecord, verifyEvidenceChain } from '../src/emit.js';
import type { ComplianceReport } from '../src/report.js';

const report = (ref: string): ComplianceReport => ({
  schemaVersion: '1',
  blueprintRef: ref,
  ctRepoRevision: 'abc123',
  score: 100,
  verdict: 'pass',
  violations: [],
  evidenceRef: 'architecture-graph.json@sha256:deadbeef',
  summary: 'ok',
  coverage: { extractor: 'ast', filesScanned: 1, unsupported: [] },
});

describe('verifyEvidenceChain binds each record id to its content', () => {
  const first = toEvidenceRecord(report('alpha@0.1.0'));
  const second = toEvidenceRecord(report('beta@0.1.0'), first.hash);

  it('accepts an untouched chain', () => {
    expect(verifyEvidenceChain([first, second])).toBe(-1);
  });

  it('reports the first record whose id does not match its content', () => {
    const swapped = { ...second, id: `evidence:other@9.9.9:${second.hash.slice(0, 16)}` };
    expect(verifyEvidenceChain([first, swapped])).toBe(1);
  });
});
