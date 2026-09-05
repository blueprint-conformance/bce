/**
 * Policy-independent direct-import graph for Python repositories.
 *
 * The released `python-import-surface` remains untouched. This opt-in provider uses a pinned
 * Lezer grammar to locate Python import statements anywhere a statement is legal, refuses syntax
 * errors, resolves repository modules through explicitly reviewed import roots, and records
 * dynamic/reflected imports as located uncertainty. It deliberately does not claim dependency
 * installation semantics, PyPI distribution mapping, transitive reachability, or cycle analysis.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { parser } from '@lezer/python';
import type {
  ArchitectureGraph,
  CoverageReport,
  ObservedComponent,
  ObservedEdge,
  RepositoryFactsExtractor,
} from './graph.js';
import { compareComponents, compareEdges } from './graph.js';
import {
  resolveFiles,
  scanPatterns,
  toRelSorted,
  type ResolvedExtraction,
} from './extractors.js';

export interface PythonImportFact {
  kind: 'import' | 'from-import';
  /** Absolute import name, or the name after the leading dots for a relative import. */
  module: string;
  /** Dot count for a relative from-import; zero for absolute imports. */
  level: number;
  /** Imported member names for a from-import; empty for a plain import. */
  names: string[];
  /** 1-based source line. */
  line: number;
}

interface ImportParseResult {
  facts: PythonImportFact[];
  bindings: Map<string, string>;
  dynamic: Array<{ specifier: string; kind: string; line: number; reason: string }>;
}

interface ChildToken {
  name: string;
  text: string;
  from: number;
  to: number;
}

interface IndexedPythonModule {
  absPath: string;
  relPath: string;
  importName: string;
  isPackage: boolean;
}

interface PythonModuleIndex {
  byImportName: Map<string, IndexedPythonModule>;
  byFile: Map<string, IndexedPythonModule>;
  namespaces: Set<string>;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineAt(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid;
  }
  return lo + 1;
}

function directTokens(node: SyntaxNode, source: string): ChildToken[] {
  const out: ChildToken[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    out.push({ name: child.name, text: source.slice(child.from, child.to), from: child.from, to: child.to });
  }
  return out;
}

function walk(node: SyntaxNode, visit: (node: SyntaxNode) => void): void {
  visit(node);
  for (let child = node.firstChild; child; child = child.nextSibling) walk(child, visit);
}

function dotted(tokens: readonly ChildToken[]): string {
  return tokens
    .filter((token) => token.name === 'VariableName' || token.name === '.')
    .map((token) => token.text)
    .join('');
}

function clauses(tokens: readonly ChildToken[]): Array<{ name: string; alias?: string }> {
  const result: Array<{ name: string; alias?: string }> = [];
  let current: ChildToken[] = [];
  const flush = (): void => {
    const asIndex = current.findIndex((token) => token.name === 'as');
    const nameTokens = asIndex < 0 ? current : current.slice(0, asIndex);
    const name = dotted(nameTokens.filter((token) => token.name !== '*' && token.name !== '(' && token.name !== ')'));
    if (name.length > 0) {
      const alias = asIndex < 0
        ? undefined
        : current.slice(asIndex + 1).find((token) => token.name === 'VariableName')?.text;
      result.push(alias ? { name, alias } : { name });
    } else if (current.some((token) => token.name === '*')) {
      result.push({ name: '*' });
    }
    current = [];
  };
  for (const token of tokens) {
    if (token.name === ',') flush();
    else if (token.name !== '(' && token.name !== ')') current.push(token);
  }
  flush();
  return result;
}

function firstError(root: SyntaxNode): SyntaxNode | undefined {
  let found: SyntaxNode | undefined;
  walk(root, (node) => {
    if (!found && node.type.isError) found = node;
  });
  return found;
}

/** Parse structured Python import facts. Syntax errors are refusals, never an empty graph. */
export function parsePythonModuleImports(source: string, relPath = '<python>'): PythonImportFact[] {
  return parsePythonSource(source, relPath).facts;
}

function parsePythonSource(source: string, relPath: string): ImportParseResult {
  const tree = parser.parse(source);
  const starts = lineStarts(source);
  const error = firstError(tree.topNode);
  if (error) {
    throw new Error(
      `python-module-graph could not parse ${relPath} at line ${lineAt(starts, error.from)} ` +
        `(offset ${error.from})`,
    );
  }

  const facts: PythonImportFact[] = [];
  const bindings = new Map<string, string>();
  const dynamic: ImportParseResult['dynamic'] = [];

  walk(tree.topNode, (node) => {
    if (node.name !== 'ImportStatement') return;
    const tokens = directTokens(node, source);
    const importIndex = tokens.findIndex((token) => token.name === 'import');
    if (importIndex < 0) return;
    const line = lineAt(starts, node.from);
    if (tokens[0]?.name === 'from') {
      const baseTokens = tokens.slice(1, importIndex);
      let level = 0;
      let baseStart = 0;
      while (/^\.+$/.test(baseTokens[baseStart]?.text ?? '')) {
        level += (baseTokens[baseStart]?.text ?? '').length;
        baseStart++;
      }
      const module = dotted(baseTokens.slice(baseStart));
      const imported = clauses(tokens.slice(importIndex + 1));
      const names = imported.map((entry) => entry.name);
      facts.push({ kind: 'from-import', module, level, names, line });
      if (level === 0 && module.length > 0) {
        for (const entry of imported) {
          if (entry.name === '*') continue;
          bindings.set(entry.alias ?? entry.name, `${module}.${entry.name}`);
        }
      }
      return;
    }
    for (const entry of clauses(tokens.slice(importIndex + 1))) {
      facts.push({ kind: 'import', module: entry.name, level: 0, names: [], line });
      const local = entry.alias ?? entry.name.split('.')[0];
      if (local) bindings.set(local, entry.name);
    }
  });

  walk(tree.topNode, (node) => {
    if (node.name === 'CallExpression') {
      const tokens = directTokens(node, source);
      const argList = tokens.find((token) => token.name === 'ArgList');
      if (!argList) return;
      const rawCallee = source.slice(node.from, argList.from).replace(/\s+/g, '');
      const firstSegment = rawCallee.split('.')[0] ?? rawCallee;
      const resolvedCallee = bindings.has(firstSegment)
        ? `${bindings.get(firstSegment)}${rawCallee.slice(firstSegment.length)}`
        : rawCallee;
      const argNode = node.getChild('ArgList')?.firstChild?.nextSibling;
      const literal = argNode?.name === 'String' ? source.slice(argNode.from, argNode.to) : '<computed>';
      const line = lineAt(starts, node.from);
      if (resolvedCallee === '__import__' || resolvedCallee === 'importlib.import_module') {
        dynamic.push({
          specifier: literal,
          kind: resolvedCallee === '__import__' ? '__import__' : 'importlib.import_module',
          line,
          reason: 'dynamic Python import is not a provable direct static dependency',
        });
      } else if (/^sys\.(?:path|meta_path|path_hooks)\./.test(resolvedCallee)) {
        dynamic.push({
          specifier: '<runtime-import-state>',
          kind: 'python-import-state-mutation',
          line,
          reason: `${resolvedCallee} mutates Python import resolution at runtime`,
        });
      } else if (resolvedCallee === 'exec' || resolvedCallee === 'eval') {
        dynamic.push({
          specifier: '<computed>',
          kind: resolvedCallee,
          line,
          reason: `${resolvedCallee} may execute imports that cannot be proven statically`,
        });
      }
    } else if (node.name === 'AssignStatement') {
      const text = source.slice(node.from, node.to).replace(/\s+/g, '');
      const first = text.split(/[.=\[]/, 1)[0] ?? '';
      const resolved = bindings.get(first) ?? first;
      const normalized = `${resolved}${text.slice(first.length)}`;
      if (/^sys\.(?:path|meta_path|path_hooks)(?:=|\[)/.test(normalized)) {
        dynamic.push({
          specifier: '<runtime-import-state>',
          kind: 'python-import-state-mutation',
          line: lineAt(starts, node.from),
          reason: 'assignment mutates Python import resolution at runtime',
        });
      }
    }
  });

  facts.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.module.localeCompare(b.module));
  dynamic.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind) || a.specifier.localeCompare(b.specifier));
  return { facts, bindings, dynamic };
}

/** Read a Python source file without silently accepting a non-UTF-8 coding-cookie contract. */
export function readUtf8PythonSource(absPath: string, relPath: string): string {
  const bytes = fs.readFileSync(absPath);
  const prefix = bytes.subarray(0, Math.min(bytes.length, 256)).toString('latin1');
  const cookie = /^(?:#![^\r\n]*[\r\n]+)?[^\r\n]*coding[:=]\s*([-\w.]+)/i.exec(prefix)?.[1];
  if (cookie && !/^(?:utf-?8|utf_8)$/i.test(cookie)) {
    throw new Error(`python-module-graph refuses non-UTF-8 coding cookie '${cookie}' in ${relPath}`);
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    throw new Error(`python-module-graph could not decode ${relPath} as UTF-8`);
  }
}

function normalizedRel(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/');
}

function contained(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

/** Build the deterministic import-name → repository-file index for explicit Python roots. */
export function buildPythonModuleIndex(
  repoDir: string,
  files: readonly string[],
  configuredRoots: readonly string[],
): PythonModuleIndex {
  const repoRoot = fs.realpathSync(repoDir);
  const repoPath = path.resolve(repoDir);
  if (configuredRoots.length === 0) {
    throw new Error('python-module-graph requires at least one explicit pythonRoots entry');
  }
  const roots = configuredRoots.map((configured) => {
    if (/[*?]/.test(configured)) throw new Error(`python-module-graph pythonRoots cannot contain globs: ${configured}`);
    const candidate = path.resolve(repoRoot, configured);
    if (!contained(repoRoot, candidate)) throw new Error(`python-module-graph pythonRoot escapes repository root: ${configured}`);
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
      throw new Error(`python-module-graph pythonRoot is not a directory: ${configured}`);
    }
    const real = fs.realpathSync(candidate);
    if (!contained(repoRoot, real)) throw new Error(`python-module-graph pythonRoot resolves outside repository root: ${configured}`);
    return { configured, real };
  });
  const duplicateRoot = roots.find((root, index) => roots.findIndex((other) => other.real === root.real) !== index);
  if (duplicateRoot) throw new Error(`python-module-graph duplicate pythonRoot: ${duplicateRoot.configured}`);

  const byImportName = new Map<string, IndexedPythonModule>();
  const byFile = new Map<string, IndexedPythonModule>();
  const namespaces = new Set<string>();
  const caseFolded = new Map<string, string>();

  for (const absPath of files) {
    if (path.extname(absPath).toLowerCase() !== '.py') {
      throw new Error(`python-module-graph only scans .py files: ${normalizedRel(repoRoot, absPath)}`);
    }
    if (fs.lstatSync(absPath).isSymbolicLink()) {
      throw new Error(`python-module-graph refuses symlinked source file: ${normalizedRel(repoRoot, absPath)}`);
    }
    const real = fs.realpathSync(absPath);
    const matching = roots.filter((root) => contained(root.real, real));
    if (matching.length !== 1) {
      throw new Error(
        `python-module-graph source ${normalizedRel(repoRoot, absPath)} must belong to exactly one pythonRoot ` +
          `(matched ${matching.length})`,
      );
    }
    const root = matching[0] as (typeof roots)[number];
    const underRoot = normalizedRel(root.real, real);
    const segments = underRoot.replace(/\.py$/i, '').split('/');
    const isPackage = segments[segments.length - 1] === '__init__';
    if (isPackage) segments.pop();
    const importName = segments.join('.');
    if (!importName) throw new Error(`python-module-graph cannot name root-level __init__.py under ${root.configured}`);
    const relPath = normalizedRel(repoPath, path.resolve(absPath));
    const entry: IndexedPythonModule = { absPath, relPath, importName, isPackage };
    const prior = byImportName.get(importName);
    if (prior) throw new Error(`python-module-graph import-name collision '${importName}': ${prior.relPath}, ${relPath}`);
    const folded = importName.toLocaleLowerCase('en-US');
    const priorCase = caseFolded.get(folded);
    if (priorCase && priorCase !== importName) {
      throw new Error(`python-module-graph case-fold collision '${priorCase}' / '${importName}'`);
    }
    caseFolded.set(folded, importName);
    byImportName.set(importName, entry);
    byFile.set(real, entry);
    for (let i = 1; i < segments.length; i++) namespaces.add(segments.slice(0, i).join('.'));
  }
  return { byImportName, byFile, namespaces };
}

function externalPackageTarget(specifier: string): string | null {
  const root = specifier.split('.')[0] ?? '';
  return /^[\p{ID_Start}_][\p{ID_Continue}_]*$/u.test(root) ? `package:${root}` : null;
}

function resolveAbsolute(index: PythonModuleIndex, specifier: string):
  | { target: string }
  | { reason: string } {
  const local = index.byImportName.get(specifier);
  if (local) return { target: `module:${local.relPath}` };
  if (index.namespaces.has(specifier)) {
    return { reason: `namespace package '${specifier}' has no source-file component` };
  }
  const external = externalPackageTarget(specifier);
  return external
    ? { target: external }
    : { reason: `import name '${specifier}' is not a canonical Python package selector` };
}

function absoluteFromBase(entry: IndexedPythonModule, level: number, module: string): string {
  if (level === 0) return module;
  const packageParts = entry.isPackage
    ? entry.importName.split('.')
    : entry.importName.split('.').slice(0, -1);
  const up = level - 1;
  if (up >= packageParts.length && packageParts.length > 0) {
    throw new Error(`python-module-graph relative import escapes pythonRoot from ${entry.relPath}`);
  }
  if (packageParts.length === 0 || up > packageParts.length) {
    throw new Error(`python-module-graph relative import has no package context in ${entry.relPath}`);
  }
  return [...packageParts.slice(0, packageParts.length - up), ...(module ? module.split('.') : [])].join('.');
}

/** Structured, fail-closed Python direct-module provider. */
export class PythonModuleGraphExtractor implements RepositoryFactsExtractor {
  readonly kind = 'ast' as const;

  constructor(private readonly cfg: ResolvedExtraction) {
    if (cfg.profile !== 'python-module-graph') {
      throw new Error(`PythonModuleGraphExtractor requires profile 'python-module-graph'`);
    }
  }

  extract(repoDir: string, revision: string): ArchitectureGraph {
    const files = resolveFiles(repoDir, this.cfg.paths);
    const index = buildPythonModuleIndex(repoDir, files, this.cfg.pythonRoots);
    const repoPath = path.resolve(repoDir);
    const components: ObservedComponent[] = [];
    const guardEdges: ObservedEdge[] = [];
    const unresolvedImports: NonNullable<CoverageReport['unresolvedImports']> = [];

    for (const absPath of files) {
      const relPath = normalizedRel(repoPath, path.resolve(absPath));
      const entry = index.byFile.get(fs.realpathSync(absPath));
      if (!entry) throw new Error(`python-module-graph internal index miss for ${relPath}`);
      const from = `module:${relPath}`;
      components.push({ id: from, type: 'pythonModule', path: relPath, line: 1 });
      const parsed = parsePythonSource(readUtf8PythonSource(absPath, relPath), relPath);

      const record = (target: string, line: number): void => {
        guardEdges.push({ from, to: target, type: 'imports', evidenceRef: `${relPath}#L${line}` });
      };
      const unresolved = (specifier: string, kind: string, line: number, reason: string): void => {
        unresolvedImports.push({ from, specifier, kind, ref: `${relPath}#L${line}`, reason });
      };

      for (const fact of parsed.facts) {
        if (fact.kind === 'import') {
          const resolution = resolveAbsolute(index, fact.module);
          if ('target' in resolution) record(resolution.target, fact.line);
          else unresolved(fact.module, fact.kind, fact.line, resolution.reason);
          continue;
        }
        const base = absoluteFromBase(entry, fact.level, fact.module);
        const baseResolution = resolveAbsolute(index, base);
        const baseIsNamespace = !('target' in baseResolution) && index.namespaces.has(base);
        if ('target' in baseResolution) record(baseResolution.target, fact.line);
        else if (!baseIsNamespace) unresolved(base, fact.kind, fact.line, baseResolution.reason);

        let resolvedChild = false;
        for (const name of fact.names.filter((candidate) => candidate !== '*')) {
          const candidate = base ? `${base}.${name}` : name;
          const child = index.byImportName.get(candidate);
          if (child) {
            record(`module:${child.relPath}`, fact.line);
            resolvedChild = true;
          }
        }
        if (baseIsNamespace && !resolvedChild) {
          unresolved(base, fact.kind, fact.line, `namespace package '${base}' did not resolve an imported source module`);
        }
      }
      for (const item of parsed.dynamic) unresolved(item.specifier, item.kind, item.line, item.reason);
    }

    components.sort(compareComponents);
    guardEdges.sort((a, b) => compareEdges(a, b) || a.evidenceRef.localeCompare(b.evidenceRef));
    unresolvedImports.sort((a, b) => {
      const ka = `${a.from}\0${a.ref}\0${a.kind}\0${a.specifier}\0${a.reason}`;
      const kb = `${b.from}\0${b.ref}\0${b.kind}\0${b.specifier}\0${b.reason}`;
      return ka.localeCompare(kb);
    });
    return {
      schemaVersion: '1',
      ctRepoRevision: revision,
      components,
      guardEdges,
      coverage: {
        extractor: 'ast',
        filesScanned: files.length,
        unsupported: [
          'direct statically declared imports only; no transitive reachability or cycle analysis',
          'package: targets name Python import namespaces, not PyPI distributions',
          'dynamic imports, eval/exec, and runtime import-state mutation are located uncertainty and fail relevant boundaries closed',
          'installed-distribution metadata, custom import hooks, and .pyi stub semantics are not modeled',
        ],
        scannedFiles: toRelSorted(repoDir, files),
        ...(unresolvedImports.length > 0 ? { unresolvedImports } : {}),
        ...(() => {
          const patternScan = scanPatterns(repoDir, files, this.cfg.patterns);
          return patternScan ? { patternScan } : {};
        })(),
      },
    };
  }
}
