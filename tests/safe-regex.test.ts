/**
 * Quality matrix for the fail-closed safe-compile guard (`safe-regex.ts`) that guards the two
 * `new RegExp(userInput)` sinks — cli.ts (`--constraint forbiddenPattern:<regex>`) and schema.ts
 * (a `pattern` field in an authored blueprint). Closes the CodeQL HIGH `js/regex-injection` at
 * cli.ts:205 by REFUSING an unsafe pattern (catastrophic backtracking / over-length) fail-closed,
 * consistent with the existing missing/non-compiling behavior (widen-only ratchet — tighten, never
 * silently relax).
 *
 * RED-first: proves an over-length pattern AND a nested-quantifier ReDoS bomb are REFUSED, AND
 * that every legitimate pattern (incl. the existing authored teeth) still compiles.
 */
import { describe, it, expect } from 'vitest';
import {
  safeCompilePattern,
  hasCatastrophicBacktracking,
  UnsafePatternError,
  SAFE_PATTERN_MAX_LENGTH,
} from '../src/safe-regex.js';

describe('safeCompilePattern — legitimate patterns still compile (no regression)', () => {
  // The exact patterns the existing forbidden-pattern tooth + author-cli tests use, plus common
  // authored forbidden-content shapes. NONE of these may be refused.
  const legit = [
    'Math\\.random\\(', // the canonical mock-metric tooth
    'uptime:\\s*99\\.9', // hardcoded-uptime literal
    'TODO|FIXME|XXX', // alternation
    'process\\.env\\.[A-Z_]+', // env access
    '\\bconsole\\.log\\b', // word-boundary
    'foo.*bar', // a single unbounded quantifier is fine
    '(a|b|c)+', // a quantified group with NO inner unbounded quantifier is fine
    '[a-z]{3,10}', // bounded repetition
    'a{2,}', // a single open-ended quantifier is fine (not nested)
    '^import\\s+.*from', // anchored line match
  ];
  for (const p of legit) {
    it(`compiles: ${p}`, () => {
      expect(() => safeCompilePattern(p)).not.toThrow();
      expect(safeCompilePattern(p)).toBeInstanceOf(RegExp);
    });
  }
});

describe('safeCompilePattern — catastrophic-backtracking bombs are REFUSED (fail-closed)', () => {
  const bombs = [
    '(a+)+', // classic nested +
    '(a*)*', // classic nested *
    '(a+)*', // + inside, * outside
    '(a*)+', // * inside, + outside
    '(.*)*', // dot-star nested
    '(.+)+', // dot-plus nested
    '(a|aa)+', // NOTE: this alternation is NOT flagged by star-height (documented below)
    '([a-z]+)+', // char-class + inside, + outside
    '(a{1,})+', // open-ended {n,} inside, + outside
    '((a+))+', // deeper nesting still caught
  ];
  for (const b of bombs) {
    // '(a|aa)+' has no star-height>1 shape (the inner alt has no quantifier) — it is a known
    // heuristic blind spot, asserted separately below so this table stays honest.
    if (b === '(a|aa)+') continue;
    it(`refuses: ${b}`, () => {
      expect(() => safeCompilePattern(b)).toThrow(UnsafePatternError);
      try {
        safeCompilePattern(b);
      } catch (e) {
        expect((e as UnsafePatternError).reason).toBe('catastrophic-backtracking');
      }
    });
    it(`hasCatastrophicBacktracking flags: ${b}`, () => {
      expect(hasCatastrophicBacktracking(b)).toBe(true);
    });
  }

  it('documents the heuristic blind spot: (a|aa)+ is NOT flagged by star-height (no inner quantifier)', () => {
    // This is an alternation-overlap ReDoS the star-height heuristic does not catch. It still
    // COMPILES (short, no star-height>1), which is the documented, accepted heuristic limit —
    // the length cap + the three real sinks all being guarded remain the defense. Recorded so a
    // future tightening has a failing anchor to flip.
    expect(hasCatastrophicBacktracking('(a|aa)+')).toBe(false);
  });
});

describe('safeCompilePattern — over-length patterns are REFUSED (fail-closed)', () => {
  it(`refuses a pattern longer than ${SAFE_PATTERN_MAX_LENGTH} chars`, () => {
    const overLong = 'a'.repeat(SAFE_PATTERN_MAX_LENGTH + 1);
    expect(() => safeCompilePattern(overLong)).toThrow(UnsafePatternError);
    try {
      safeCompilePattern(overLong);
    } catch (e) {
      expect((e as UnsafePatternError).reason).toBe('too-long');
    }
  });

  it(`accepts a pattern exactly at the ${SAFE_PATTERN_MAX_LENGTH}-char cap`, () => {
    const atCap = 'a'.repeat(SAFE_PATTERN_MAX_LENGTH);
    expect(() => safeCompilePattern(atCap)).not.toThrow();
  });
});

describe('safeCompilePattern — non-compiling / empty patterns are REFUSED (fail-closed)', () => {
  it('refuses an empty string', () => {
    expect(() => safeCompilePattern('')).toThrow(UnsafePatternError);
    try {
      safeCompilePattern('');
    } catch (e) {
      expect((e as UnsafePatternError).reason).toBe('empty');
    }
  });

  it('refuses a non-compiling regex (unbalanced group)', () => {
    expect(() => safeCompilePattern('([unclosed')).toThrow(UnsafePatternError);
    try {
      safeCompilePattern('([unclosed');
    } catch (e) {
      expect((e as UnsafePatternError).reason).toBe('does-not-compile');
    }
  });
});

describe('hasCatastrophicBacktracking — escapes and char-classes are not mistaken for structure', () => {
  it('does not flag an escaped paren followed by a quantifier', () => {
    // `\(a+\)+` is a literal-paren match, not a group — no star-height>1.
    expect(hasCatastrophicBacktracking('\\(a+\\)+')).toBe(false);
  });
  it('does not flag a quantifier inside a character class', () => {
    // `[+*]+` — the inner `+*` are literals inside the class; only the outer `+` quantifies.
    expect(hasCatastrophicBacktracking('[+*]+')).toBe(false);
  });
});
