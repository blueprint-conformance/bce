/** Pure reader identity; a package-version sync test prevents a stale compatibility floor. */
export const COMPILER_ENGINE_VERSION = '0.6.1';

/** Numeric x.y.z compare (no deps): is `a` strictly below `b`? Missing parts read as 0. */
export function semverLt(a: string, b: string): boolean {
  const parts = (s: string): number[] => s.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const [a0 = 0, a1 = 0, a2 = 0] = parts(a);
  const [b0 = 0, b1 = 0, b2 = 0] = parts(b);
  if (a0 !== b0) return a0 < b0;
  if (a1 !== b1) return a1 < b1;
  return a2 < b2;
}
