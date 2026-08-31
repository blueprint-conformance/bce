/**
 * safe-regex.ts — the ONE fail-closed compile guard for a user-supplied `forbiddenPattern`
 * regex, shared by BOTH authoring seams that turn caller input into a live `RegExp`:
 *   - `cli.ts` (a `--constraint forbiddenPattern:<regex>` command-line argument), and
 *   - `schema.ts` superRefine (a `pattern` field in an authored blueprint JSON).
 *
 * WHY THIS EXISTS — `new RegExp(userInput)` is a `js/regex-injection` sink (CodeQL HIGH):
 * a caller who controls the pattern controls the automaton, and a catastrophic-backtracking
 * shape (nested unbounded quantifiers — `(a+)+`, `(.*)*`, `(a|a)*`) run against attacker- or
 * author-influenceable file content can wedge the process for exponential time (ReDoS). The
 * `forbiddenPattern` tooth evaluates its regex PER-LINE over the raw scanned-file set (see
 * report.ts `patternScan`), so an unsafe pattern is not hypothetical — it is a live DoS on the
 * gate itself. The fix is NOT to trust the input; it is to VALIDATE-then-compile fail-closed,
 * consistent with the existing missing/non-compiling-regex behavior (security-is-a-ratchet:
 * a gate can tighten, never silently relax).
 *
 * The guard is deterministic and dependency-free (a heuristic static checker + a bounded
 * compile) — three layers, ALL must pass or `safeCompilePattern` throws:
 *   (a) LENGTH CAP — a pattern longer than {@link SAFE_PATTERN_MAX_LENGTH} chars is refused.
 *       A forbidden-content grep does not need a 512+ char regex; an over-length pattern is far
 *       more likely an injection payload than a legitimate authored tooth.
 *   (b) CATASTROPHIC-SHAPE REJECT — a small deterministic scanner refuses a quantifier applied
 *       to a group that itself contains an unbounded quantifier (star-height > 1) — the shape
 *       that produces exponential backtracking. This is a heuristic (it errs toward refusing a
 *       borderline pattern — fail-closed), NOT a full automaton analysis.
 *   (c) BOUNDED COMPILE — `new RegExp` inside try/catch (the compile itself is the last gate;
 *       a non-compiling pattern is a hard error, exactly as before).
 *
 * A refusal is a legible {@link UnsafePatternError} — the caller (cli.ts `die()`, schema.ts
 * `ctx.addIssue`) surfaces the message; it is never a silent skip.
 */

/** Max characters in a user-supplied `forbiddenPattern` regex. A grep tooth needs far less. */
export const SAFE_PATTERN_MAX_LENGTH = 512;

/** Reasons a pattern is refused — stable strings for legible, testable error messages. */
export type UnsafePatternReason =
  | 'empty'
  | 'too-long'
  | 'catastrophic-backtracking'
  | 'does-not-compile';

/** A fail-closed refusal of a user-supplied pattern. `reason` is a stable machine-readable tag. */
export class UnsafePatternError extends Error {
  readonly reason: UnsafePatternReason;
  constructor(reason: UnsafePatternReason, message: string) {
    super(message);
    this.name = 'UnsafePatternError';
    this.reason = reason;
  }
}

/**
 * Deterministic catastrophic-backtracking heuristic: does this pattern apply a quantifier to a
 * group whose body itself contains an unbounded quantifier (`*`, `+`, `{n,}`)? That nesting
 * (star-height > 1) is the shape that backtracks exponentially, e.g. `(a+)+`, `(a*)*`, `(.*)+`,
 * `(a|aa)*`. We do a single left-to-right scan tracking, per open group, whether the group body
 * has already contained an unbounded quantifier; if the group is THEN closed and immediately
 * followed by another unbounded quantifier, we refuse. Character classes `[...]` are skipped
 * (a quantifier inside a class is a literal), and `\`-escapes are honored so `\(` / `\*` are not
 * mistaken for structure. Heuristic, fail-closed: it may refuse a benign nested-quantifier
 * pattern, which is acceptable for an authored forbidden-content tooth.
 */
export function hasCatastrophicBacktracking(pattern: string): boolean {
  // Per-open-group flag: has this group's body already produced an unbounded quantifier?
  const groupHadUnbounded: boolean[] = [];
  let i = 0;
  const n = pattern.length;

  const isUnboundedQuantAt = (idx: number): boolean => {
    const ch = pattern[idx];
    if (ch === '*' || ch === '+') return true;
    // `{n,}` (open-ended) — bounded `{n}` / `{n,m}` do not backtrack catastrophically.
    if (ch === '{') {
      const close = pattern.indexOf('}', idx);
      if (close === -1) return false;
      const body = pattern.slice(idx + 1, close);
      // open-ended range: "n," with no upper bound
      return /^\d+,\s*$/.test(body);
    }
    return false;
  };

  while (i < n) {
    const ch = pattern[i];

    if (ch === '\\') {
      // Escaped char — consume the pair; never structural.
      i += 2;
      continue;
    }

    if (ch === '[') {
      // Character class — skip to the matching unescaped `]`. Quantifiers inside are literal.
      i++;
      while (i < n) {
        if (pattern[i] === '\\') {
          i += 2;
          continue;
        }
        if (pattern[i] === ']') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '(') {
      groupHadUnbounded.push(false);
      i++;
      continue;
    }

    if (ch === ')') {
      const innerHadUnbounded = groupHadUnbounded.pop() ?? false;
      i++;
      // A group whose body had an unbounded quantifier, then quantified again → star-height > 1.
      if (innerHadUnbounded && isUnboundedQuantAt(i)) {
        return true;
      }
      // Propagate UP: a group whose body contains an unbounded quantifier means the ENCLOSING
      // group's body contains one too — regardless of whether this closed group is itself
      // re-quantified. This makes `((a+))+` reduce to `(<unbounded>)+` at the middle group and
      // fire on the outer `+`, and it also lets a trailing quantifier applied to the just-closed
      // group count toward the enclosing body.
      if ((innerHadUnbounded || isUnboundedQuantAt(i)) && groupHadUnbounded.length > 0) {
        groupHadUnbounded[groupHadUnbounded.length - 1] = true;
      }
      continue;
    }

    if (isUnboundedQuantAt(i)) {
      // Mark the innermost currently-open group as having an unbounded quantifier in its body.
      if (groupHadUnbounded.length > 0) {
        groupHadUnbounded[groupHadUnbounded.length - 1] = true;
      }
      // Advance past a `{n,}` fully so we don't re-scan its digits.
      if (ch === '{') {
        const close = pattern.indexOf('}', i);
        i = close === -1 ? i + 1 : close + 1;
      } else {
        i++;
      }
      continue;
    }

    i++;
  }

  return false;
}

/**
 * The single fail-closed compile guard. Validates a user-supplied pattern through the three
 * layers (length cap → catastrophic-shape reject → bounded compile) and returns the compiled
 * `RegExp` on success. Throws {@link UnsafePatternError} on ANY refusal — never returns an
 * uncompiled or unsafe pattern.
 *
 * @param pattern the raw user-supplied regex source (CLI arg or authored `pattern` field)
 * @param flags   optional RegExp flags (default none)
 */
export function safeCompilePattern(pattern: string, flags?: string): RegExp {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new UnsafePatternError('empty', 'pattern must be a non-empty string.');
  }
  if (pattern.length > SAFE_PATTERN_MAX_LENGTH) {
    throw new UnsafePatternError(
      'too-long',
      `pattern is ${pattern.length} chars, exceeding the ${SAFE_PATTERN_MAX_LENGTH}-char safety cap (a forbidden-content grep needs far less; an over-length pattern is refused fail-closed).`,
    );
  }
  if (hasCatastrophicBacktracking(pattern)) {
    throw new UnsafePatternError(
      'catastrophic-backtracking',
      `pattern has a nested unbounded quantifier (star-height > 1, e.g. (a+)+ / (.*)* ) that can cause catastrophic backtracking (ReDoS); refused fail-closed. Rewrite it without a quantifier applied to an already-unbounded group.`,
    );
  }
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    throw new UnsafePatternError(
      'does-not-compile',
      `pattern does not compile as a RegExp: ${(e as Error).message}`,
    );
  }
}
