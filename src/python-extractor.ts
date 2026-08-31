/**
 * The Python import-surface extractor — the `python-import-surface` profile's single provider.
 *
 * Python import statements are LINE-ORIENTED by language design (an `import`/`from` statement
 * cannot be split mid-keyword except by explicit `\` or parenthesized continuation), so a careful
 * line scan IS the honest MVP here — not a degraded fallback. What this extractor delivers, and
 * what it deliberately does not, is stated in `coverage.unsupported` on every graph it emits:
 *
 *  DETECTED (facts emitted):
 *   - every scanned `.py` file → one `module:<dotted.path>` component (`pkg/mod.py` →
 *     `module:pkg.mod`; a package `__init__.py` names the package itself);
 *   - `import a.b.c` / `import a.b as x` / `import a, b` — absolute dotted module imports;
 *   - `from a.b import c, d as e` — the MODULE `a.b` and each candidate submodule `a.b.c` /
 *     `a.b.d` (statically, `c` may be a symbol or a submodule; both candidates are matched
 *     against the forbidden set, an over-approximation on the CANDIDATE list that still emits
 *     an edge only when a candidate matches a declared forbidden module — never a guessed edge
 *     to an undeclared target);
 *   - relative imports (`from . import x`, `from ..pkg import y`) — resolved against the
 *     importing file's package path to an absolute dotted module before matching;
 *   - `(`-parenthesized and trailing-`\` continuation lines;
 *   - `#` comments and string literals (including triple-quoted blocks) are excluded from the
 *     scan — an import inside a docstring is not an import.
 *
 *  NOT DETECTED (honest misses, asserted by tests):
 *   - dynamic imports: `__import__('x')`, `importlib.import_module('x')`;
 *   - `sys.path` manipulation and namespace-package resolution nuances;
 *   - an import reached via `exec`/`eval` or any other reflective form.
 *
 *  CONTEXT-INSENSITIVE (disclosed, not a miss): an import inside a function body, a
 *  conditional branch, or a `try:` block is still reported — the module CAN be reached, which
 *  is exactly what a forbidden-dependency constraint is about. (The TS extractor's top-level
 *  `getImportDeclarations` walk plus its dynamic-`import()` descendant scan has the same
 *  reach-is-drift posture.)
 *
 * Edge/constraint support: `forbiddenDependency` (via `imports` edges), `forbiddenFile` (via
 * `coverage.scannedFiles`), `forbiddenPattern` (via `coverage.patternScan`), `forbiddenPath`
 * and `requiredComponent` (over `module:` components of type `pythonModule`). `forbiddenEgress`
 * and `guardSymbols`/`governedModules` are NOT supported — the gate/CLI refuse LOUDLY (see
 * gate.ts / cli.ts) rather than silently scan nothing.
 *
 * Determinism: no wall-clock; components/edges sorted before return; file resolution sorted
 * (resolveFiles). Same tree + same blueprint ⇒ byte-identical graph.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ArchitectureGraph, ObservedComponent, ObservedEdge, RepositoryFactsExtractor } from './graph.js';
import { compareComponents, compareEdges } from './graph.js';
import { resolveExtraction, resolveFiles, scanPatterns, toRelSorted, type ResolvedExtraction } from './extractors.js';

/** `pkg/sub/mod.py` → `pkg.sub.mod`; `pkg/__init__.py` → `pkg`; `main.py` → `main`. */
export function pythonModuleId(relPath: string): string {
  const noExt = relPath.replace(/\.py$/, '');
  const parts = noExt.split('/');
  if (parts[parts.length - 1] === '__init__') parts.pop();
  return parts.join('.') || noExt.replace(/\//g, '.');
}

/** One parsed import: the absolute dotted module candidates a single statement references. */
interface ParsedImport {
  /** candidate absolute dotted module specs (see module docstring on from-import candidates) */
  candidates: string[];
  /** 1-based line of the statement's first line */
  line: number;
}

/**
 * Strip comments + string literals from one PHYSICAL line, tracking triple-quoted block state
 * across lines. Returns the scannable remainder (string/comment content blanked) and the updated
 * block-string delimiter (`'''` / `"""`) if the line ends inside one, else null.
 *
 * Single-quoted strings are blanked within the line; a `#` outside any string starts a comment.
 * Deliberately simple (no f-string nesting analysis): the goal is that an `import` TOKEN inside
 * a string or comment never reaches the statement parser — asserted by tests.
 */
export function stripPythonNoise(line: string, openBlock: string | null): { text: string; openBlock: string | null } {
  let out = '';
  let i = 0;
  let block = openBlock;
  while (i < line.length) {
    if (block !== null) {
      const end = line.indexOf(block, i);
      if (end === -1) return { text: out, openBlock: block }; // still inside the block string
      i = end + block.length;
      block = null;
      continue;
    }
    const c = line[i] as string;
    const three = line.slice(i, i + 3);
    if (three === "'''" || three === '"""') {
      block = three;
      i += 3;
      continue;
    }
    if (c === '#') return { text: out, openBlock: null }; // comment to end-of-line
    if (c === "'" || c === '"') {
      // single-line string: skip to the matching unescaped close quote (or end of line)
      let j = i + 1;
      while (j < line.length && (line[j] !== c || line[j - 1] === '\\')) j++;
      i = j + 1;
      out += ' '; // keep a separator so tokens on either side don't fuse
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, openBlock: block };
}

/**
 * Resolve a relative `from`-import to an absolute dotted module. `level` is the dot count
 * (1 = current package). Returns null when the relative import escapes the scanned tree root
 * (over-dotted) — an unresolvable spec produces NO candidates (fail toward under-detection).
 */
export function resolveRelativeModule(relPath: string, level: number, module: string | null): string | null {
  // the importing file's package path: drop the filename; __init__.py lives IN its package.
  const parts = relPath.replace(/\.py$/, '').split('/');
  parts.pop(); // filename (for __init__ the remaining parts ARE the package — dot level 1 = it)
  const up = level - 1;
  if (up > parts.length) return null; // escapes the tree — unresolvable, no candidate
  const base = parts.slice(0, parts.length - up);
  const segs = [...base, ...(module ? module.split('.') : [])];
  return segs.length > 0 ? segs.join('.') : null;
}

const IMPORT_RE = /^\s*import\s+(.+)$/;
const FROM_RE = /^\s*from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\s+(.+)$/;

/** Parse the LOGICAL lines of one Python file into import statements (module docstring rules). */
export function parsePythonImports(source: string, relPath: string): ParsedImport[] {
  const physical = source.split('\n');
  const out: ParsedImport[] = [];
  let openBlock: string | null = null;

  // 1) build logical lines: strip noise, then fold `\`-continuations and `(`-groups.
  const logical: Array<{ text: string; line: number }> = [];
  let buf = '';
  let bufLine = 0;
  let parenDepth = 0;
  for (let i = 0; i < physical.length; i++) {
    const stripped = stripPythonNoise(physical[i] as string, openBlock);
    openBlock = stripped.openBlock;
    let text = stripped.text;
    if (buf === '') bufLine = i + 1;
    if (text.endsWith('\\')) {
      buf += text.slice(0, -1) + ' ';
      continue;
    }
    buf += text;
    for (const ch of text) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    }
    if (parenDepth > 0) {
      buf += ' ';
      continue; // inside a parenthesized import group — keep folding
    }
    logical.push({ text: buf, line: bufLine });
    buf = '';
  }
  if (buf !== '') logical.push({ text: buf, line: bufLine });

  // 2) parse each logical line as an import statement (non-imports are ignored).
  for (const { text, line } of logical) {
    const cleaned = text.replace(/[()]/g, ' ');
    const fromM = FROM_RE.exec(cleaned);
    if (fromM) {
      const level = (fromM[1] ?? '').length;
      const module = fromM[2] ?? null;
      const names = (fromM[3] ?? '')
        .split(',')
        .map((n) => (n.trim().split(/\s+as\s+/)[0] ?? '').trim())
        .filter((n) => /^[A-Za-z_][\w]*$/.test(n) || n === '*');
      const base = level > 0 ? resolveRelativeModule(relPath, level, module) : module;
      if (base === null || base === undefined) continue; // unresolvable relative — no candidate
      const candidates = new Set<string>([base]);
      for (const n of names) {
        if (n !== '*') candidates.add(`${base}.${n}`);
      }
      out.push({ candidates: [...candidates], line });
      continue;
    }
    const impM = IMPORT_RE.exec(cleaned);
    if (impM && !/^\s*import\s*$/.test(cleaned)) {
      const candidates = new Set<string>();
      for (const clause of (impM[1] ?? '').split(',')) {
        const mod = (clause.trim().split(/\s+as\s+/)[0] ?? '').trim();
        if (/^[A-Za-z_][\w.]*$/.test(mod)) candidates.add(mod);
      }
      if (candidates.size > 0) out.push({ candidates: [...candidates], line });
    }
  }
  return out;
}

export class PythonImportExtractor implements RepositoryFactsExtractor {
  readonly kind = 'line-scan' as const;
  constructor(private readonly cfg: ResolvedExtraction = resolveExtraction(undefined)) {}

  extract(repoDir: string, revision: string): ArchitectureGraph {
    const files = resolveFiles(repoDir, this.cfg.paths).filter((f) => f.endsWith('.py'));
    const components: ObservedComponent[] = [];
    const edges: ObservedEdge[] = [];

    for (const absPath of files) {
      const relPath = path.relative(repoDir, absPath).split(path.sep).join('/');
      const id = `module:${pythonModuleId(relPath)}`;
      components.push({ id, type: 'pythonModule', path: relPath, line: 1 });
      const imports = parsePythonImports(fs.readFileSync(absPath, 'utf8'), relPath);
      for (const stmt of imports) {
        // one edge per (statement, forbidden module) — matching the TS extractor's emitForbidden
        // shape: edge.to is the DECLARED forbidden module, evidence anchors the statement line.
        const hit = new Set<string>();
        for (const spec of stmt.candidates) {
          for (const forbidden of this.cfg.forbiddenImports) {
            if (spec === forbidden || spec.startsWith(`${forbidden}.`)) hit.add(forbidden);
          }
        }
        for (const forbidden of [...hit].sort()) {
          edges.push({ from: id, to: forbidden, type: 'imports', evidenceRef: `${relPath}#L${stmt.line}` });
        }
      }
    }

    components.sort(compareComponents);
    edges.sort(compareEdges);
    return {
      schemaVersion: '1',
      ctRepoRevision: revision,
      components,
      guardEdges: edges,
      coverage: {
        extractor: 'line-scan',
        filesScanned: files.length,
        unsupported: [
          'python: dynamic imports are not detected (__import__, importlib.import_module, exec/eval)',
          'python: sys.path manipulation and namespace-package resolution are not modeled',
          'python: imports are context-insensitive — a conditional/function-local/try import is still reported (reach-is-drift)',
          'python: from-import candidates over-approximate (a symbol import matches only a DECLARED forbidden module, never an invented target)',
          'python: guardSymbols/provides edges and forbiddenEgress are not supported by this profile (the gate refuses egress blueprints loudly)',
        ],
        scannedFiles: toRelSorted(repoDir, files),
        ...(() => {
          const patternScan = scanPatterns(repoDir, files, this.cfg.patterns);
          return patternScan ? { patternScan } : {};
        })(),
      },
    };
  }
}
