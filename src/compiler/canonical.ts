/** Shared pure canonicalization and selectors; existing public helpers re-export these. */
import { createHash } from 'node:crypto';

export function stableStringify(value: unknown): string {
  const ancestors = new WeakSet();
  const sort = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (ancestors.has(v)) throw new Error('cannot serialize a cycle');
    ancestors.add(v);
    try {
      if (Array.isArray(v)) return v.map(sort);
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) out[k] = sort((v as Record<string, unknown>)[k]);
      return out;
    } finally { ancestors.delete(v); }
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export const compilerDigest = (value: unknown): string =>
  createHash('sha256').update(stableStringify(value)).digest('hex');

/** Anchored repo-relative glob, with the existing **, *, ? and separator semantics. */
export function pathGlobToRe(glob: string): RegExp {
  glob = glob.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') { re += '(?:.*/)?'; i++; }
        else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c as string)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function moduleTargetMatches(target: string, selector: string | undefined): boolean {
  if (!selector) return false;
  if (selector.startsWith('module:')) {
    return target.startsWith('module:') &&
      pathGlobToRe(selector.slice('module:'.length)).test(target.slice('module:'.length));
  }
  return target === selector;
}
