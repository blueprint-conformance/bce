/**
 * The recall-gate threshold ratchet (B2-WO-04): DEFAULT_THRESHOLDS may only TIGHTEN.
 *
 * The floor {minRecall: 0.9, maxFpRate: 0.1} is the pinned measured-recall gate. A red gate
 * is fixed by fixing the ENGINE, never by loosening the gate — this test makes a loosening
 * commit fail CI with an explicit message. Tightening (raising minRecall, lowering maxFpRate)
 * passes by construction. Sibling to the corpus size floor in corpus.test.ts (append-only
 * corpus) — together: the denominator only grows, the bar only rises.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../src/recall-gate.js';

describe('DEFAULT_THRESHOLDS is a tighten-only ratchet', () => {
  it('minRecall has not been loosened below the pinned 0.9 floor', () => {
    expect(
      DEFAULT_THRESHOLDS.minRecall,
      'minRecall dropped below 0.9 — a red recall gate is an ENGINE bug to fix, never a threshold to lower',
    ).toBeGreaterThanOrEqual(0.9);
  });

  it('maxFpRate has not been loosened above the pinned 0.1 ceiling', () => {
    expect(
      DEFAULT_THRESHOLDS.maxFpRate,
      'maxFpRate rose above 0.1 — a noisy gate is an ENGINE bug to fix, never a ceiling to raise',
    ).toBeLessThanOrEqual(0.1);
  });
});
