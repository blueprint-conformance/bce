/**
 * pnpm-lock.yaml (lockfileVersion '9.0') reader for the stack extractor — a second SOURCE of the
 * same `StackNode` / `StackEdge` shape, never a second schema.
 *
 * PURE MODULE: no filesystem, no network, no process state; imports are `node:crypto` (entry
 * hashes) and relative only. The
 * extractor (`stack-extractor.ts`) reads the bytes; this module parses and derives.
 *
 * NO YAML LIBRARY. The engine's runtime dependency allowlist admits only zod / ts-morph / @lezer /
 * node: / relative, so this file carries a STRICT SUBSET reader for exactly the grammar pnpm's own
 * serializer emits: indentation-nested block mappings, block sequences of scalars, single-line flow
 * maps/sequences (`{integrity: …}`, `[darwin]`, `{}`), plain / single-quoted / double-quoted
 * scalars, and block scalars (a distinct non-string value: inert in a `deprecated:` message, a
 * `malformed` refusal in any identity position). Everything else YAML allows — anchors, aliases, tags, the merge key `<<`,
 * multi-document streams, complex keys, multi-line flow collections or quoted scalars, inline
 * comments, tab indentation, duplicate keys, block nesting deeper than 64 — is a HARD parse error
 * carrying its line number. Plain `null` / `~` / an empty value is ABSENT (never the string "null")
 * and plain `true` / `false` are booleans, exactly as a YAML parser types them. A
 * lockfile this reader cannot walk is REFUSED whole; it is never half-read into wrong identities.
 *
 * What pnpm-lock v9 does NOT record (stated in coverage on every pnpm manifest, never guessed):
 *   - install scripts (`requiresBuild` left the format in v9) ⇒ `installScript` is always false;
 *   - `dev` / `peer` flags ⇒ both are DERIVED here by reachability from the importers;
 *   - the declared range of a transitive dependency ⇒ those edge specs are `''`.
 */
import { createHash } from 'node:crypto';
import { stackNodeId, type StackEdge, type StackNode, type StackRootDeclared, type StackUnmodeled } from './stack-manifest.js';

/* -------------------------------------------------------------------------- */
/* Fixed refusal / coverage strings (verbatim contract — tests pin these)       */
/* -------------------------------------------------------------------------- */

export const STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS =
  'pnpm-lock v9 does not record install scripts: installScript is false for every pnpm node (unknown, not proven absent)';
export const STACK_COVERAGE_PNPM_DERIVED_FLAGS =
  'pnpm-lock v9 carries no dev/peer flags: dev = not reachable through any importer dependencies/optionalDependencies, peer = reachable only through peerDependencies edges (derived, not read)';
export const STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS =
  "pnpm-lock v9 records resolved versions, not ranges, for transitive dependencies: edge spec is '' except importer (specifier) and peer (peerDependencies) edges";
export const STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS =
  "pnpm workspace importers other than '.' have no locked identity: they are not nodes and their direct-dependency edges are attributed to the root node";

export const STACK_COVERAGE_PNPM_DEPENDENCY_FREE =
  'pnpm-lock declares no registry dependency on any importer and carries no packages: the declared closure is the root package (plus any workspace link entries) alone';

/** A v9 lockfile that describes no closure: exit 2, nothing written — never a green root-only manifest. */
export function stackRefusalPnpmHollow(why: string): string {
  return `lockfile 'pnpm-lock.yaml' is hollow (${why}): a manifest with only the root node is never a green stack; no stack facts extracted`;
}
/** An entry the reader cannot trust at all — a REFUSAL of the whole lockfile, never a skipped entry. */
export function stackRefusalPnpmMalformed(what: string): string {
  return `lockfile 'pnpm-lock.yaml' ${what} is malformed: refused, never a partial manifest`;
}

/**
 * The lockfile reads cleanly but the TREE says part of its closure is gone (or the tree cannot say):
 * a lockfile cut inside `importers:` can be byte-identical to a smaller legitimate one, so the
 * importers are checked against the `package.json` files and `pnpm-workspace.yaml` of the same view.
 */
export function stackRefusalPnpmLostClosure(what: string): string {
  return `lockfile 'pnpm-lock.yaml' does not cover the tree it sits in (${what}): a lost closure is refused, never a partial manifest; no stack facts extracted`;
}

/** The lockfile parsed but is not lockfileVersion '9.0' (v5/v6 key packages by path with inline snapshots). */
export function stackRefusalPnpmLockfileVersion(version: string | null): string {
  if (version === null) return "lockfile 'pnpm-lock.yaml' has no lockfileVersion: refused; no stack facts extracted";
  if (/^[1-8](\.\d+)?$/.test(version)) {
    return `pnpm lockfileVersion ${version} is not 9.0: pnpm v5/v6 lockfiles are refused (packages are keyed by '/name@version' path with inline snapshots, not the importers/packages/snapshots split); regenerate with pnpm >= 9`;
  }
  return `pnpm lockfileVersion ${version} is not 9.0: unknown pnpm lockfile format refused; no stack facts extracted`;
}

/** The lockfile is outside the YAML subset this reader walks. */
export function stackRefusalPnpmSubset(line: number, reason: string): string {
  return `lockfile 'pnpm-lock.yaml' line ${line}: ${reason} — outside the pnpm-lock v9 YAML subset this reader walks (no YAML library); refused whole, no stack facts extracted`;
}

/* -------------------------------------------------------------------------- */
/* The subset reader                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A PLAIN scalar the YAML core schema types as null (`null` / `Null` / `NULL` / `~` / an empty value)
 * is `null` here — ABSENT, never the string "null" — and a plain `true` / `false` (any of the three
 * core-schema spellings) is a boolean. A QUOTED scalar is always a string. Numbers stay strings
 * (versions such as `9.0` must not be re-spelled by a float round-trip).
 */
export type PnpmYamlValue = string | boolean | null | PnpmBlockScalar | PnpmYamlMap | PnpmYamlValue[];

/**
 * A block scalar (`|`, `>`), kept as its raw body lines. It is deliberately NOT a string: this reader
 * neither folds nor clips, so the text is not what a YAML parser would produce, and no identity
 * position (`integrity`, `tarball`, `version`, `hash`, a dependency reference, `os` / `cpu`) accepts
 * it — there it is a `malformed` refusal. Elsewhere (a multi-line `deprecated:` message) it is inert.
 */
export class PnpmBlockScalar {
  constructor(
    /** the body as readable text: each line's indentation relative to the body, joined by `\n` */
    readonly text: string,
    /** the header token exactly as written: `|`, `>`, `|-`, `>+`, `|2`, … — it decides how YAML reads the body */
    readonly header: string = '|',
    /**
     * the body LOSSLESSLY: one `[relativeIndent, content]` pair per line. `relativeIndent` may be
     * negative (a line indented less than the body), `content` keeps its trailing whitespace, and a
     * whitespace-only line keeps whatever it carries beyond the body indentation.
     */
    readonly lines: ReadonlyArray<readonly [number, string]> = text === '' ? [] : text.split('\n').map((l) => [0, l] as const),
  ) {}
}
/** A Map, never an object: lockfile keys are attacker-shaped strings (`__proto__`, `constructor`). */
export type PnpmYamlMap = Map<string, PnpmYamlValue>;

export class PnpmLockSubsetError extends Error {
  constructor(
    readonly line: number,
    readonly reason: string,
  ) {
    super(stackRefusalPnpmSubset(line, reason));
    this.name = 'PnpmLockSubsetError';
  }
}

interface Line {
  no: number;
  /** the line exactly as written (no trimming): a block-scalar body is hashed from this */
  raw: string;
  /** leading SPACES only — a tab is never indentation */
  indent: number;
  text: string; // content after the indentation, right-trimmed
  /** a TAB sits in the leading whitespace: a refusal wherever the line is STRUCTURE, plain content inside a block-scalar body */
  tab: boolean;
  /** `#`-led: skipped as structure, kept as content inside a block-scalar body */
  comment: boolean;
  /** an empty / whitespace-only line: skipped as structure, kept (as an empty line) inside a block-scalar body */
  blank: boolean;
}

function toLines(source: string): Line[] {
  const out: Line[] = [];
  const raw = source.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const full = raw[i] ?? '';
    const no = i + 1;
    if (full.trim() === '') {
      out.push({ no, raw: full, indent: 0, text: '', tab: false, comment: false, blank: true });
      continue;
    }
    const spaces = /^ */.exec(full)?.[0].length ?? 0;
    const lead = /^[ \t]*/.exec(full)?.[0] ?? '';
    const tab = lead.includes('\t');
    // right-trimmed ONCE, here (linear — a /\s+$/ replace is quadratic on interior whitespace): the
    // document-marker test below and a block-scalar body both see the trimmed text
    const text = (tab ? full.slice(spaces) : full.slice(lead.length)).trimEnd();
    if (lead.length === 0 && (text === '---' || text.startsWith('--- ') || text === '...' || text.startsWith('%'))) {
      throw new PnpmLockSubsetError(no, 'document marker or directive (multi-document stream)');
    }
    out.push({ no, raw: full, indent: spaces, text, tab, comment: !tab && text.startsWith('#'), blank: false });
  }
  return out;
}

function unquoteSingle(body: string): string {
  return body.replace(/''/g, "'");
}

/** Read a quoted scalar starting at `pos` (a quote char). Returns the value and the index after the closing quote. */
function readQuoted(text: string, pos: number, lineNo: number): { value: string; end: number } {
  const q = text[pos];
  if (q === "'") {
    let i = pos + 1;
    for (;;) {
      const close = text.indexOf("'", i);
      if (close === -1) throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line single-quoted scalar');
      if (text[close + 1] === "'") {
        i = close + 2;
        continue;
      }
      return { value: unquoteSingle(text.slice(pos + 1, close)), end: close + 1 };
    }
  }
  // double-quoted: the JSON string grammar is the accepted escape subset
  let i = pos + 1;
  for (;;) {
    if (i >= text.length) throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line double-quoted scalar');
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === '"') break;
    i++;
  }
  const token = text.slice(pos, i + 1);
  try {
    const v: unknown = JSON.parse(token);
    if (typeof v !== 'string') throw new Error('not a string');
    return { value: v, end: i + 1 };
  } catch {
    throw new PnpmLockSubsetError(lineNo, 'double-quoted scalar uses an escape outside the JSON string grammar');
  }
}

const PLAIN_FORBIDDEN_START = /^[&*!|>%@`?]/;
/** Block nesting cap: a lockfile nests 5 deep; past this the reader refuses instead of recursing. */
export const PNPM_LOCK_MAX_NESTING = 64;
const YAML_NULL = new Set(['null', 'Null', 'NULL', '~']);
const YAML_TRUE = new Set(['true', 'True', 'TRUE']);
const YAML_FALSE = new Set(['false', 'False', 'FALSE']);

/** Core-schema typing of a PLAIN (unquoted) scalar that already passed `checkPlain`. */
function typePlain(value: string): string | boolean | null {
  if (value === '' || YAML_NULL.has(value)) return null;
  if (YAML_TRUE.has(value)) return true;
  if (YAML_FALSE.has(value)) return false;
  return value;
}

/** `<<` is the YAML 1.1 merge key: a real parser would splice another mapping in. Never stored, always refused. */
function checkKey(key: string, lineNo: number): string {
  if (key === '<<') throw new PnpmLockSubsetError(lineNo, "merge key '<<'");
  return key;
}

function checkPlain(value: string, lineNo: number, what: string): string {
  if (value === '') return value;
  const head = value[0] ?? '';
  if (head === '&' || head === '*') throw new PnpmLockSubsetError(lineNo, `anchor or alias in ${what}`);
  if (head === '!') throw new PnpmLockSubsetError(lineNo, `tag in ${what}`);
  if (PLAIN_FORBIDDEN_START.test(value)) throw new PnpmLockSubsetError(lineNo, `reserved indicator '${head}' starts a plain ${what}`);
  if (/\s#/.test(value)) throw new PnpmLockSubsetError(lineNo, `inline comment in ${what}`);
  return value;
}

/** Single-line flow collection / scalar parser. `pos` points at the first char of the value. */
function readFlow(text: string, pos: number, lineNo: number, depth: number): { value: PnpmYamlValue; end: number } {
  if (depth > 8) throw new PnpmLockSubsetError(lineNo, 'flow collection nested deeper than 8');
  const skipWs = (p: number): number => {
    while (p < text.length && text[p] === ' ') p++;
    return p;
  };
  let p = skipWs(pos);
  const ch = text[p];
  if (ch === '{') {
    const map: PnpmYamlMap = new Map();
    p = skipWs(p + 1);
    if (text[p] === '}') return { value: map, end: p + 1 };
    for (;;) {
      p = skipWs(p);
      if (p >= text.length) throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line flow mapping');
      let key: string;
      if (text[p] === "'" || text[p] === '"') {
        const r = readQuoted(text, p, lineNo);
        key = r.value;
        p = skipWs(r.end);
        if (text[p] !== ':') throw new PnpmLockSubsetError(lineNo, 'flow mapping key without a value');
        p++;
      } else {
        let k = p;
        while (k < text.length && !(text[k] === ':' && (text[k + 1] === ' ' || k + 1 === text.length)) && text[k] !== ',' && text[k] !== '}') k++;
        if (text[k] !== ':') throw new PnpmLockSubsetError(lineNo, 'flow mapping key without a value');
        key = checkPlain(text.slice(p, k).trim(), lineNo, 'flow key');
        p = k + 1;
      }
      if (key === '') throw new PnpmLockSubsetError(lineNo, 'empty flow mapping key');
      checkKey(key, lineNo);
      if (map.has(key)) throw new PnpmLockSubsetError(lineNo, `duplicate key '${key}'`);
      const v = readFlow(text, p, lineNo, depth + 1);
      map.set(key, v.value);
      p = skipWs(v.end);
      if (text[p] === ',') {
        p++;
        continue;
      }
      if (text[p] === '}') return { value: map, end: p + 1 };
      throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line flow mapping');
    }
  }
  if (ch === '[') {
    const list: PnpmYamlValue[] = [];
    p = skipWs(p + 1);
    if (text[p] === ']') return { value: list, end: p + 1 };
    for (;;) {
      if (skipWs(p) >= text.length) throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line flow sequence');
      const v = readFlow(text, p, lineNo, depth + 1);
      list.push(v.value);
      p = skipWs(v.end);
      if (text[p] === ',') {
        p++;
        continue;
      }
      if (text[p] === ']') return { value: list, end: p + 1 };
      throw new PnpmLockSubsetError(lineNo, 'unterminated or multi-line flow sequence');
    }
  }
  if (ch === "'" || ch === '"') return readQuoted(text, p, lineNo);
  // plain flow scalar: up to the next `,` `}` `]` (a plain flow scalar cannot contain them)
  let e = p;
  while (e < text.length && text[e] !== ',' && text[e] !== '}' && text[e] !== ']') e++;
  const value = checkPlain(text.slice(p, e).trim(), lineNo, 'flow scalar');
  if (value === '') throw new PnpmLockSubsetError(lineNo, 'empty flow scalar');
  return { value: typePlain(value), end: e };
}

class SubsetParser {
  private i = 0;
  constructor(private readonly lines: Line[]) {}

  parseDocument(): PnpmYamlMap {
    const first = this.peek();
    if (!first) return new Map();
    if (first.indent !== 0) throw new PnpmLockSubsetError(first.no, 'document does not start at column 0');
    if (first.text.startsWith('- ') || first.text === '-') throw new PnpmLockSubsetError(first.no, 'top-level sequence (a lockfile is a mapping)');
    const doc = this.parseMap(0, 0);
    const rest = this.peek();
    if (rest) throw new PnpmLockSubsetError(rest.no, 'inconsistent indentation');
    return doc;
  }

  /** The next STRUCTURAL line: comments are skipped, a tab-led line is the fixed refusal. */
  private peek(): Line | undefined {
    while (this.lines[this.i]?.comment || this.lines[this.i]?.blank) this.i++;
    const line = this.lines[this.i];
    if (line?.tab) throw new PnpmLockSubsetError(line.no, 'tab indentation');
    return line;
  }

  private parseMap(indent: number, depth: number): PnpmYamlMap {
    const map: PnpmYamlMap = new Map();
    for (;;) {
      const line = this.peek();
      if (!line || line.indent < indent) return map;
      if (line.indent > indent) throw new PnpmLockSubsetError(line.no, 'inconsistent indentation');
      if (line.text.startsWith('- ') || line.text === '-') throw new PnpmLockSubsetError(line.no, 'sequence item inside a mapping');
      if (line.text.startsWith('? ') || line.text === '?') throw new PnpmLockSubsetError(line.no, 'complex mapping key');
      if (depth > PNPM_LOCK_MAX_NESTING) throw new PnpmLockSubsetError(line.no, `block nesting deeper than ${PNPM_LOCK_MAX_NESTING}`);
      const { key, rest } = this.splitKey(line);
      checkKey(key, line.no);
      if (map.has(key)) throw new PnpmLockSubsetError(line.no, `duplicate key '${key}'`);
      this.i++;
      map.set(key, this.parseValue(rest, line, depth));
    }
  }

  private splitKey(line: Line): { key: string; rest: string } {
    const t = line.text;
    if (t[0] === "'" || t[0] === '"') {
      const r = readQuoted(t, 0, line.no);
      if (t[r.end] !== ':' || (r.end + 1 < t.length && t[r.end + 1] !== ' ')) throw new PnpmLockSubsetError(line.no, 'mapping key without a value separator');
      if (r.value === '') throw new PnpmLockSubsetError(line.no, 'empty mapping key');
      return { key: r.value, rest: t.slice(r.end + 1).trim() };
    }
    let k = 0;
    while (k < t.length && !(t[k] === ':' && (k + 1 === t.length || t[k + 1] === ' '))) k++;
    if (k >= t.length) throw new PnpmLockSubsetError(line.no, 'line is not a `key: value` mapping entry');
    const key = checkPlain(t.slice(0, k).trim(), line.no, 'mapping key');
    if (key === '') throw new PnpmLockSubsetError(line.no, 'empty mapping key');
    return { key, rest: t.slice(k + 1).trim() };
  }

  private parseValue(rest: string, line: Line, depth: number): PnpmYamlValue {
    // a block-scalar header is decided BEFORE the next line is looked at as structure: its body may
    // legitimately start with a `#`-led or TAB-led line
    const next = rest[0] === '|' || rest[0] === '>' ? undefined : this.peek();
    if (rest === '') {
      if (next && next.indent > line.indent) {
        return next.text.startsWith('- ') || next.text === '-' ? this.parseSeq(next.indent) : this.parseMap(next.indent, depth + 1);
      }
      // YAML allows a block sequence at the SAME indentation as its key
      if (next && next.indent === line.indent && (next.text.startsWith('- ') || next.text === '-')) return this.parseSeq(next.indent);
      return null; // an empty value is YAML null: ABSENT, never the string ''
    }
    const head = rest[0] ?? '';
    if (head === '|' || head === '>') {
      // `0` is not an indentation indicator in YAML (1-9 only)
      if (!/^[|>][+-]?[1-9]?$/.test(rest)) throw new PnpmLockSubsetError(line.no, 'malformed block scalar header');
      // RAW lines, not peek(): inside a block scalar a `#`-led line, a line whose content starts with a
      // TAB and a blank line are ordinary text. This reader never folds and never clips, so it cannot
      // say what STRING the scalar is — what it guarantees instead is that two scalars a YAML parser
      // would read differently never hash alike inside an opaque whole-entry hash. So the hash covers
      // the HEADER token (`|` vs `>`, `-` / `+` chomping, an indentation indicator) and the body
      // LOSSLESSLY: every line's indentation relative to the body (negative when a line is indented
      // less), its trailing whitespace, every interior blank line and what a whitespace-only line
      // carries beyond the body indentation. Trailing blank lines belong to the file's layout, not to
      // the scalar — except under `+` (keep), where YAML keeps them, so there they are counted.
      const keep = rest.includes('+');
      const indicator = /[1-9]/.exec(rest)?.[0];
      const body: Line[] = [];
      for (;;) {
        const l = this.lines[this.i];
        if (!l) break;
        if (!l.blank && l.indent <= line.indent) break;
        body.push(l);
        this.i++;
      }
      let trailingBlank = 0;
      while (body.length > 0 && body[body.length - 1]!.blank) {
        body.pop();
        this.i--;
        trailingBlank++;
      }
      // an indentation indicator states the body indentation (relative to the key's own); without one
      // it is the indentation of the first non-blank line
      const bodyIndent = indicator !== undefined ? line.indent + Number(indicator) : (body.find((l) => !l.blank)?.indent ?? 0);
      const pairs: Array<readonly [number, string]> = body.map((l) => {
        const lead = /^ */.exec(l.raw)?.[0].length ?? 0;
        // a whitespace-only line no longer than the body indentation is an EMPTY line in YAML
        if (l.blank) return lead > bodyIndent || l.raw.length > lead ? ([lead - bodyIndent, l.raw.slice(lead)] as const) : ([0, ''] as const);
        return [lead - bodyIndent, l.raw.slice(lead)] as const;
      });
      if (keep) for (let k = 0; k < trailingBlank; k++) pairs.push([0, '']);
      const text = pairs.map(([rel, content]) => `${' '.repeat(Math.max(0, rel))}${content}`).join('\n');
      return new PnpmBlockScalar(text, rest, pairs);
    }
    let value: PnpmYamlValue;
    if (head === '{' || head === '[' || head === "'" || head === '"') {
      const r = readFlow(rest, 0, line.no, 0);
      if (rest.slice(r.end).trim() !== '') throw new PnpmLockSubsetError(line.no, 'trailing content after a value (inline comment or multi-line collection)');
      value = r.value;
    } else {
      value = typePlain(checkPlain(rest, line.no, 'scalar'));
    }
    if (next && next.indent > line.indent) throw new PnpmLockSubsetError(next.no, 'multi-line plain scalar or mis-indented entry');
    return value;
  }

  private parseSeq(indent: number): PnpmYamlValue[] {
    const list: PnpmYamlValue[] = [];
    for (;;) {
      const line = this.peek();
      if (!line || line.indent < indent) return list;
      if (line.indent > indent) throw new PnpmLockSubsetError(line.no, 'inconsistent indentation');
      if (!(line.text.startsWith('- ') || line.text === '-')) return list;
      const item = line.text === '-' ? '' : line.text.slice(2).trim();
      if (item === '') throw new PnpmLockSubsetError(line.no, 'empty or nested block sequence item');
      const head = item[0] ?? '';
      this.i++;
      if (head === '{' || head === '[' || head === "'" || head === '"') {
        const r = readFlow(item, 0, line.no, 0);
        if (item.slice(r.end).trim() !== '') throw new PnpmLockSubsetError(line.no, 'trailing content after a sequence item');
        list.push(r.value);
      } else {
        if (/^[^\s'"]+:(\s|$)/.test(item)) throw new PnpmLockSubsetError(line.no, 'mapping inside a block sequence item');
        list.push(typePlain(checkPlain(item, line.no, 'sequence item')));
      }
      const next = this.peek();
      if (next && next.indent > indent) throw new PnpmLockSubsetError(next.no, 'multi-line sequence item');
    }
  }
}

/** Parse the pnpm-lock YAML subset. Throws `PnpmLockSubsetError` (line + reason) on anything outside it. */
export function parsePnpmLockSubset(source: string): PnpmYamlMap {
  return new SubsetParser(toLines(source)).parseDocument();
}

/* -------------------------------------------------------------------------- */
/* Derivation: lockfileVersion '9.0' importers / packages / snapshots           */
/* -------------------------------------------------------------------------- */

/**
 * An OPAQUE entry is the manifest's own `StackUnmodeled` (HASHED, top-level `unmodeled[]`): this
 * reader adds no shape of its own. `opaque()` inside `deriveFromPnpmLockV9` is the ONE place a pnpm
 * entry is turned into one; `entrySha256` there covers the CANONICAL (key-sorted, unquoted) bytes of
 * the raw entry, so YAML key order, quoting or flow/block style can never move the digest.
 */
export type PnpmUnmodeled = StackUnmodeled;
/** A pnpm node is a plain StackNode (kept as an alias for readers of this module). */
export type PnpmStackNode = StackNode;

export interface PnpmDerived {
  nodes: PnpmStackNode[];
  edges: StackEdge[];
  /** sorted by key */
  unmodeled: PnpmUnmodeled[];
  /** importer '.' only: the ranges the root declares — QUARANTINED, never hashed */
  rootDeclared: StackRootDeclared[];
  unsupported: string[];
  /** entries the reader cannot trust — non-empty ⇒ the lockfile is REFUSED whole */
  malformed: string[];
  /** why the lockfile describes no closure, else null — non-null ⇒ REFUSED */
  hollow: string | null;
  /**
   * Every importer (sorted by path) with the dependency NAMES its entry records across the three
   * buckets — what the caller checks the tree's own `package.json` files against (a lockfile cut
   * inside `importers:` can be byte-identical to a smaller legitimate one; only the tree can tell).
   */
  importers: PnpmImporterFacts[];
  /** `settings.excludeLinksFromLockfile: true` — pnpm then leaves `link:`-protocol dependencies out of the importer entries */
  excludeLinksFromLockfile: boolean;
}

export interface PnpmImporterFacts {
  /** the importer key: a `/`-separated path relative to the lockfile's directory, `.` for the root */
  path: string;
  /** sorted, unique */
  names: string[];
  /**
   * dependency names whose workspace link resolves to this importer ITSELF (pnpm writes `version: 'link:'`
   * for a package that depends on itself through `workspace:*`). Legitimate only when the name IS the
   * importer's own package name — which only the tree's `package.json` can say (guard c).
   */
  selfLinks: string[];
}

/** pnpm's normalised form of a `link:`-protocol specifier path: `./vendor/lib` → `vendor/lib`, a trailing `/` dropped, `..` kept. */
export function pnpmNormalizeLinkPath(specPath: string): string {
  const out: string[] = [];
  for (const seg of specPath.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** `link:<relative>` seen from importer `imp`, as an importer key (`.` for the root). Never absolute. */
export function pnpmLinkTarget(imp: string, link: string): string {
  const out: string[] = [];
  for (const seg of `${imp}/${link.slice('link:'.length)}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' && out.length > 0 && out[out.length - 1] !== '..') out.pop();
    else out.push(seg);
  }
  return out.length === 0 ? '.' : out.join('/');
}

/** Canonical bytes of a parsed value: mapping keys sorted at every depth, so file order never matters. */
export function canonicalPnpmValue(v: PnpmYamlValue | undefined): string {
  if (v === undefined || v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return JSON.stringify(v);
  // header + lossless body (see parseValue): `|` vs `>`, chomping, an indentation indicator, a line
  // indented less than the body and trailing whitespace each move these bytes
  if (v instanceof PnpmBlockScalar) return `|${JSON.stringify(v.header)}${JSON.stringify(v.lines)}`;
  if (Array.isArray(v)) return `[${v.map(canonicalPnpmValue).join(',')}]`;
  return `{${[...v.keys()].sort().map((k) => `${JSON.stringify(k)}:${canonicalPnpmValue(v.get(k))}`).join(',')}}`;
}
function entrySha(v: PnpmYamlValue | undefined): string {
  return createHash('sha256').update(canonicalPnpmValue(v)).digest('hex');
}

export interface PnpmRootIdentity {
  name: string | null;
  version: string | null;
}

const isMap = (v: PnpmYamlValue | undefined): v is PnpmYamlMap => v instanceof Map;
const isStr = (v: PnpmYamlValue | undefined): v is string => typeof v === 'string';
const sortedKeys = (m: PnpmYamlMap): string[] => [...m.keys()].sort();

const ASCII = /^[\x21-\x7e]+$/;
/** The shape of a package NAME in a v9 key: `name` or `@scope/name`. A v6-style `/name@1.0.0` path key is not one. */
const PACKAGE_NAME_SHAPE = /^(?:@[^\s/@]+\/)?[^\s/@]+$/;
/** One SRI-style hash, the only form pnpm writes. Anything else in `resolution.integrity` names no bytes. */
/**
 * …with the EXACT padded base64 length of its digest (20 / 32 / 48 / 64 bytes). A multi-hash SRI string
 * (`sha512-… sha1-…`) is refused: pnpm writes the registry's `dist.integrity` verbatim, or ONE `sha1-`
 * derived from `dist.shasum`, and no registry output carrying several hashes has been observed.
 */
const INTEGRITY = /^(?:sha1-[A-Za-z0-9+/]{27}=|sha256-[A-Za-z0-9+/]{43}=|sha384-[A-Za-z0-9+/]{64}|sha512-[A-Za-z0-9+/]{86}==)$/;
/** A registry version. Anything else after `name@` (URL, `file:`, `link:`, git) has no locked registry identity. */
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

const KNOWN_TOP_LEVEL = new Set([
  'lockfileVersion',
  'settings',
  'overrides',
  'catalogs',
  'patchedDependencies',
  'importers',
  'packages',
  'snapshots',
  'time',
  'pnpmfileChecksum',
  'packageExtensionsChecksum',
  'ignoredOptionalDependencies',
]);

/** `@scope/name@1.2.3(peer@1)(patch_hash=…)` → `{ name:'@scope/name', version:'1.2.3', pkgKey:'@scope/name@1.2.3' }`. */
export function splitPnpmKey(key: string): { name: string; version: string; pkgKey: string } | null {
  const paren = key.indexOf('(');
  const pkgKey = paren === -1 ? key : key.slice(0, paren);
  const at = pkgKey.indexOf('@', 1);
  if (at === -1 || at === pkgKey.length - 1) return null;
  return { name: pkgKey.slice(0, at), version: pkgKey.slice(at + 1), pkgKey };
}

/** The `lockfileVersion` scalar of a parsed document, or null. */
export function pnpmLockfileVersion(doc: PnpmYamlMap): string | null {
  const v = doc.get('lockfileVersion');
  return isStr(v) && v !== '' ? v : null;
}

const IMPORTER_BUCKETS: ReadonlyArray<{ key: 'dependencies' | 'devDependencies' | 'optionalDependencies'; dev: boolean; optional: boolean }> = [
  { key: 'dependencies', dev: false, optional: false },
  { key: 'devDependencies', dev: true, optional: false },
  { key: 'optionalDependencies', dev: false, optional: true },
];
const SNAPSHOT_BUCKETS: ReadonlyArray<{ key: string; optional: boolean }> = [
  { key: 'dependencies', optional: false },
  { key: 'optionalDependencies', optional: true },
];

/**
 * Derive nodes + edges from a parsed lockfileVersion-'9.0' document. Pure; every iteration is over
 * SORTED keys, so the result is independent of the order entries appear in the file.
 */
export function deriveFromPnpmLockV9(doc: PnpmYamlMap, root: PnpmRootIdentity): PnpmDerived {
  const unmodeled: PnpmUnmodeled[] = [];
  const rootDeclared: StackRootDeclared[] = [];
  const malformed: string[] = [];
  const opaque = (key: string, reason: PnpmUnmodeled['reason'], raw: PnpmYamlValue | undefined, spec: Partial<PnpmUnmodeled['spec']>): void => {
    unmodeled.push({
      kind: 'unsupported',
      key,
      reason,
      spec: { name: null, version: null, resolved: null, integrity: null, link: false, ...spec },
      entrySha256: entrySha(raw),
    });
  };
  const unsupported = new Set<string>([
    STACK_COVERAGE_PNPM_NO_INSTALL_SCRIPTS,
    STACK_COVERAGE_PNPM_DERIVED_FLAGS,
    STACK_COVERAGE_PNPM_NO_TRANSITIVE_SPECS,
  ]);
  for (const k of sortedKeys(doc)) {
    if (KNOWN_TOP_LEVEL.has(k)) continue;
    unsupported.add(`pnpm-lock top-level section '${k}' is not read: hashed as an opaque entry`);
    opaque(`sections/${k}`, 'pnpm-unread-section', doc.get(k), { name: k });
  }

  // ---- root ----
  // an empty string is as absent as null: it must default, never reach the strict schema as ''
  if (!root.name || !root.version) unsupported.add('root package has no name/version in package.json: identity defaulted');
  const rootNode: PnpmStackNode = {
    id: stackNodeId('npm', root.name || 'root', root.version || '0.0.0'),
    kind: 'npm',
    name: root.name || 'root',
    version: root.version || '0.0.0',
    integrity: null,
    resolvedFrom: 'lockfile',
    dev: false,
    optional: false,
    peer: false,
    platformConditional: null,
    root: true,
    devOptional: false,
    installScript: false,
    resolvedWhenUnpinned: null,
    layout: ['.'],
  };

  // ---- packages → nodes (identity facts only; flags are filled in below) ----
  const packagesRaw = doc.get('packages');
  const packages: PnpmYamlMap = isMap(packagesRaw) ? packagesRaw : new Map();
  const nodeByPkgKey = new Map<string, PnpmStackNode>();
  const refusedPkgKeys = new Set<string>();
  const peerNamesByPkgKey = new Map<string, PnpmYamlMap>();
  for (const key of sortedKeys(packages)) {
    const entry = packages.get(key);
    const parts = splitPnpmKey(key);
    if (!parts || parts.pkgKey !== key || !isMap(entry) || !PACKAGE_NAME_SHAPE.test(parts.name)) {
      malformed.push(`packages entry '${key}' (not a 'name@version' mapping)`);
      refusedPkgKeys.add(key);
      continue;
    }
    const resolution = entry.get('resolution');
    const res: PnpmYamlMap = isMap(resolution) ? resolution : new Map();
    const resStr = (k: string): string | null => (isStr(res.get(k)) && res.get(k) !== '' ? (res.get(k) as string) : null);
    const integrity = resStr('integrity');
    // present-but-unusable is a refusal; YAML null (or no key at all) is ABSENT and falls to the tarball rule below
    const integrityRaw = res.get('integrity');
    if (integrityRaw !== undefined && integrityRaw !== null && (integrity === null || !INTEGRITY.test(integrity))) {
      malformed.push(`packages entry '${key}' (integrity is not ONE sha1-/sha256-/sha384-/sha512- hash of its exact length)`);
      refusedPkgKeys.add(key);
      continue;
    }
    const badResField = ['tarball', 'repo', 'commit', 'directory', 'type'].find((f) => res.has(f) && res.get(f) !== null && !isStr(res.get(f)));
    if ((resolution !== undefined && resolution !== null && !isMap(resolution)) || badResField !== undefined) {
      malformed.push(`packages entry '${key}' (resolution${badResField ? `.${badResField}` : ''} is not ${badResField ? 'a string' : 'a mapping'})`);
      refusedPkgKeys.add(key);
      continue;
    }
    const resolvedRaw = resStr('tarball') ?? (resStr('repo') && resStr('commit') ? `${resStr('repo')}#${resStr('commit')}` : null) ?? resStr('directory');
    const declaredVersion = isStr(entry.get('version')) ? (entry.get('version') as string) : null;
    if (!SEMVER.test(parts.version) || res.has('type') || res.has('directory') || res.has('repo')) {
      unsupported.add(
        `pnpm package '${key}': non-registry resolution (tarball URL / git / file: / directory) — no locked registry identity in this slice; hashed as an opaque entry, no node`,
      );
      opaque(`packages/${key}`, 'local-or-git', entry, { name: parts.name, version: declaredVersion ?? parts.version, resolved: resolvedRaw, integrity });
      refusedPkgKeys.add(key);
      continue;
    }
    if (!ASCII.test(parts.name)) {
      unsupported.add(`non-ASCII package name at ${key}: hashed as an opaque entry, no node (npm registry names are ASCII)`);
      opaque(`packages/${key}`, 'non-ascii-name', entry, { name: parts.name, version: parts.version, resolved: resolvedRaw, integrity });
      refusedPkgKeys.add(key);
      continue;
    }
    const id = stackNodeId('npm', parts.name, parts.version);
    if (id === rootNode.id) {
      malformed.push(`packages entry '${key}' (it carries the root package's own identity)`);
      refusedPkgKeys.add(key);
      continue;
    }
    if (integrity === null && resolvedRaw === null) {
      malformed.push(`packages entry '${key}' (no integrity and no tarball to name it)`);
      refusedPkgKeys.add(key);
      continue;
    }
    if (integrity === null) unsupported.add(`pnpm package '${key}' has no integrity: its tarball URL is hashed instead`);
    const strList = (field: string): string[] | null => {
      const v = entry.get(field);
      if (v === undefined) return null;
      if (v === null) return null;
      if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return [...(v as string[])].sort();
      malformed.push(`packages entry '${key}' ('${field}' is not a list of strings)`);
      return null;
    };
    const os = strList('os');
    const cpu = strList('cpu');
    if (entry.has('libc')) {
      unsupported.add(`pnpm package '${key}' declares a libc condition: not representable in platformConditional (os/cpu kept)`);
    }
    const peers = entry.get('peerDependencies');
    if (isMap(peers)) peerNamesByPkgKey.set(key, peers);
    nodeByPkgKey.set(key, {
      id,
      kind: 'npm',
      name: parts.name,
      version: parts.version,
      integrity,
      resolvedFrom: 'lockfile',
      dev: false,
      optional: false,
      peer: false,
      platformConditional: os || cpu ? { os: os ?? [], cpu: cpu ?? [] } : null,
      devOptional: false,
      root: false,
      installScript: false,
      resolvedWhenUnpinned: integrity === null ? resolvedRaw : null,
      layout: [],
    });
  }

  // ---- patched dependencies: the installed bytes differ from the integrity-locked tarball ----
  const patched = doc.get('patchedDependencies');
  if (isMap(patched)) {
    for (const k of sortedKeys(patched)) {
      unsupported.add(
        `pnpm patchedDependencies '${k}': a local patch alters the installed package; the node integrity is the UNPATCHED registry tarball — the patch hash is hashed as an opaque entry`,
      );
      const pe = patched.get(k);
      const hash = isMap(pe) && isStr(pe.get('hash')) ? (pe.get('hash') as string) : null;
      if (hash === null) malformed.push(`patchedDependencies entry '${k}' (no hash)`);
      opaque(`patchedDependencies/${k}`, 'pnpm-patched', pe, { name: splitPnpmKey(k)?.name ?? k, version: splitPnpmKey(k)?.version ?? null, integrity: hash });
    }
  }

  // ---- snapshots: peer/patch variants of a package; layout + the verbatim optional flag ----
  const snapshotsRaw = doc.get('snapshots');
  const snapshots: PnpmYamlMap = isMap(snapshotsRaw) ? snapshotsRaw : new Map();
  const snapshotKeysByPkgKey = new Map<string, string[]>();
  for (const key of sortedKeys(snapshots)) {
    const parts = splitPnpmKey(key);
    const pkgKey = parts?.pkgKey ?? key;
    if (refusedPkgKeys.has(pkgKey)) continue;
    const node = nodeByPkgKey.get(pkgKey);
    if (!node) {
      malformed.push(`snapshots entry '${key}' (no packages entry names it)`);
      continue;
    }
    const snapEntry = snapshots.get(key);
    // TRUNCATION GUARD (a), snapshot side: pnpm writes an entry with nothing in it as `{}` — a bare
    // `name@version:` (YAML null) is what a lockfile cut right after the key looks like
    if (snapEntry === null) {
      malformed.push(`snapshots entry '${key}' (an entry with no value: pnpm writes '{}' — the lockfile is cut short)`);
      continue;
    }
    if (!isMap(snapEntry)) {
      malformed.push(`snapshots entry '${key}' (not a mapping)`);
      continue;
    }
    // `optional` is a YAML boolean or absent — pnpm writes `optional: true` and nothing else there; any
    // other scalar (`optional: tr`, a string) is a value cut mid-line, never a flag that is quietly false
    if (snapEntry.has('optional') && typeof snapEntry.get('optional') !== 'boolean') {
      malformed.push(`snapshots entry '${key}' ('optional' is not a boolean — the lockfile is cut short)`);
      continue;
    }
    node.layout.push(key);
    const list = snapshotKeysByPkgKey.get(pkgKey) ?? [];
    list.push(key);
    snapshotKeysByPkgKey.set(pkgKey, list);
  }
  const snapshotMap = (key: string): PnpmYamlMap => {
    const v = snapshots.get(key);
    return isMap(v) ? v : new Map();
  };
  for (const [pkgKey, node] of nodeByPkgKey) {
    const keys = snapshotKeysByPkgKey.get(pkgKey) ?? [];
    if (keys.length === 0) {
      unsupported.add(`pnpm package '${pkgKey}' has no snapshot: kept, flags defaulted`);
      continue;
    }
    // optional only when EVERY variant is optional — one required variant makes the package required
    node.optional = keys.every((k) => snapshotMap(k).get('optional') === true); // a real YAML true — the quoted string 'true' is not
  }

  /** Resolve a dependency reference to a snapshot key. `null` = no node (link:, refused, or missing). */
  const resolveRef = (depName: string, ref: string): string | null => {
    const direct = `${depName}@${ref}`;
    if (snapshots.has(direct)) return direct;
    if (snapshots.has(ref)) return ref; // npm: alias — the value is already `realname@version`
    return null;
  };
  const nodeOfSnapshot = (snapshotKey: string): StackNode | null => {
    const parts = splitPnpmKey(snapshotKey);
    return nodeByPkgKey.get(parts?.pkgKey ?? snapshotKey) ?? null;
  };
  const isRefused = (depName: string, ref: string): boolean => {
    const key = resolveRef(depName, ref) ?? `${depName}@${ref}`;
    return refusedPkgKeys.has(splitPnpmKey(key)?.pkgKey ?? key);
  };

  const edges: StackEdge[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (e: StackEdge): void => {
    const k = `${e.from}\0${e.to}\0${e.spec}\0${e.dev ? 1 : 0}${e.optional ? 1 : 0}${e.peer ? 1 : 0}`;
    if (seenEdges.has(k)) return;
    seenEdges.add(k);
    edges.push(e);
  };

  // ---- importers → root edges + reachability seeds ----
  const importersRaw = doc.get('importers');
  const importers: PnpmYamlMap = isMap(importersRaw) ? importersRaw : new Map();
  const seedsProd: string[] = [];
  const seedsAll: string[] = [];
  const importerFacts: PnpmImporterFacts[] = [];
  for (const imp of sortedKeys(importers)) {
    const impMap = importers.get(imp);
    if (!isMap(impMap)) {
      // `importers: {.: {}}` is an importer with no dependencies; a scalar or a list is not an importer
      malformed.push(`importer '${imp}' (not a mapping)`);
      continue;
    }
    if (imp !== '.') unsupported.add(STACK_COVERAGE_PNPM_WORKSPACE_IMPORTERS);
    const names = new Set<string>();
    const selfLinks: string[] = [];
    importerFacts.push({ path: imp, names: [], selfLinks: [] });
    for (const bucket of IMPORTER_BUCKETS) {
      if (!impMap.has(bucket.key)) continue;
      const deps = impMap.get(bucket.key);
      // TRUNCATION GUARD (a): pnpm never writes a bucket with nothing in it — a bare `dependencies:`
      // (YAML null) or `dependencies: {}` is what a lockfile cut right after the bucket key looks like
      if (deps === null || (isMap(deps) && deps.size === 0)) {
        malformed.push(`importer ${imp} '${bucket.key}' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)`);
        continue;
      }
      if (!isMap(deps)) {
        malformed.push(`importer ${imp} '${bucket.key}' (not a mapping)`);
        continue;
      }
      for (const dep of sortedKeys(deps)) {
        names.add(dep);
        const d = deps.get(dep);
        if (!isMap(d)) {
          malformed.push(`importer ${imp} dependency '${dep}' (not a specifier/version mapping)`);
          continue;
        }
        const specifier = isMap(d) && isStr(d.get('specifier')) ? (d.get('specifier') as string) : '';
        const version = isMap(d) && isStr(d.get('version')) ? (d.get('version') as string) : '';
        if (imp === '.') rootDeclared.push({ name: dep, spec: specifier, group: bucket.key });
        const depKey = `importers/${imp}/${bucket.key}/${dep}`;
        if (version.startsWith('link:')) {
          // TRUNCATION GUARD (b): a WORKSPACE link (`workspace:` range, or a plain range resolved to a
          // workspace package under link-workspace-packages) points at a package pnpm also writes as
          // an importer. A `link:`-PROTOCOL dependency (`specifier: link:…`) names a directory by path —
          // measured on pnpm 10.11.1, that directory is not an importer and may sit outside the tree.
          const target = pnpmLinkTarget(imp, version);
          if (specifier.startsWith('link:')) {
            // a link:-PROTOCOL dependency: no importer to land on, but the resolved value is a pure function
            // of the specifier — `link:` + pnpm's normalised path — so a value cut mid-line never matches
            const normalized = pnpmNormalizeLinkPath(specifier.slice('link:'.length));
            if (normalized === '' || version !== `link:${normalized}`) {
              malformed.push(`importer ${imp} dependency '${dep}' (link: protocol value '${version}' is not 'link:${normalized}', the normalised specifier — the lockfile is cut short)`);
              continue;
            }
          } else if (!importers.has(target)) {
            malformed.push(`importer ${imp} dependency '${dep}' (workspace link target '${target}' is not an importer — the lockfile is cut short)`);
            continue;
          } else if (target === imp) {
            // the importer ITSELF: what pnpm writes (`version: 'link:'`) for a package depending on itself
            // through `workspace:*` — and also what a link path cut mid-line (`link:.`) resolves to. Only
            // the tree can tell them apart: the dependency name must be the importer's own package name.
            selfLinks.push(dep);
          }
          unsupported.add(`workspace/link entry ${imp}:${dep} -> ${version}: local package not part of the declared closure in slice 1; hashed as an opaque entry, no node`);
          // the declared range (`specifier: workspace:*`) is quarantined like every other range: only the
          // dependency name (in the key) and the RESOLVED link target are hashed
          opaque(depKey, 'link', version, { name: dep, version, link: true });
          continue;
        }
        if (specifier.startsWith('catalog:')) {
          unsupported.add(`pnpm catalog reference ${imp}:${dep} (${specifier}): catalog range not dereferenced; edge spec kept verbatim`);
        }
        const snapKey = version === '' ? null : resolveRef(dep, version);
        const target = snapKey ? nodeOfSnapshot(snapKey) : null;
        if (!snapKey || !target) {
          if (!isRefused(dep, version)) malformed.push(`importer ${imp} dependency '${dep}' (version '${version}' names no snapshot)`);
          continue;
        }
        if (target.name !== dep) {
          // an npm: alias — the REAL identity is a node; the alias name itself is hashed as an opaque entry
          unsupported.add(`npm: alias ${imp}:${dep} -> ${version}: the real package is a node; the alias name is hashed as an opaque entry`);
          opaque(depKey, 'npm-alias', version, { name: dep, version }); // alias name + resolved target; the range is quarantined
        }
        seedsAll.push(snapKey);
        if (!bucket.dev) seedsProd.push(snapKey);
        addEdge({ from: rootNode.id, to: target.id, spec: specifier, dev: bucket.dev, optional: bucket.optional, peer: false });
      }
    }
    importerFacts[importerFacts.length - 1]!.names = [...names].sort();
    importerFacts[importerFacts.length - 1]!.selfLinks = selfLinks.sort();
  }

  // ---- snapshot → snapshot adjacency + package edges ----
  interface Adj {
    to: string;
    peer: boolean;
  }
  const adjacency = new Map<string, Adj[]>();
  for (const key of sortedKeys(snapshots)) {
    const from = nodeOfSnapshot(key);
    if (!from) continue;
    const fromPkgKey = splitPnpmKey(key)?.pkgKey ?? key;
    const peers = peerNamesByPkgKey.get(fromPkgKey);
    const out: Adj[] = [];
    for (const bucket of SNAPSHOT_BUCKETS) {
      if (!snapshotMap(key).has(bucket.key)) continue;
      const deps = snapshotMap(key).get(bucket.key);
      // TRUNCATION GUARD (a), snapshot side: a bucket with nothing in it is a shape pnpm never writes
      if (deps === null || (isMap(deps) && deps.size === 0)) {
        malformed.push(`snapshot ${key} '${bucket.key}' (a bucket with no entries: pnpm never writes one — the lockfile is cut short)`);
        continue;
      }
      if (!isMap(deps)) {
        malformed.push(`snapshot ${key} '${bucket.key}' (not a mapping)`);
        continue;
      }
      for (const dep of sortedKeys(deps)) {
        const ref = deps.get(dep);
        if (!isStr(ref) || ref === '') {
          malformed.push(`snapshot ${key} dependency '${dep}' (no version string)`);
          continue;
        }
        const depKey = `snapshots/${key}/${bucket.key}/${dep}`;
        if (ref.startsWith('link:')) {
          unsupported.add(`workspace/link entry ${key}:${dep} -> ${ref}: local package not part of the declared closure in slice 1; hashed as an opaque entry, no node`);
          opaque(depKey, 'link', ref, { name: dep, version: ref, link: true });
          continue;
        }
        const snapKey = resolveRef(dep, ref);
        const target = snapKey ? nodeOfSnapshot(snapKey) : null;
        if (!snapKey || !target) {
          if (!isRefused(dep, ref)) malformed.push(`snapshot ${key} dependency '${dep}' (version '${ref}' names no snapshot)`);
          continue;
        }
        if (target.name !== dep) {
          unsupported.add(`npm: alias ${key}:${dep} -> ${ref}: the real package is a node; the alias name is hashed as an opaque entry`);
          opaque(depKey, 'npm-alias', ref, { name: dep, version: ref });
        }
        const peerRange = peers?.get(dep);
        const isPeer = peerRange !== undefined;
        out.push({ to: snapKey, peer: isPeer });
        addEdge({ from: from.id, to: target.id, spec: isPeer && isStr(peerRange) ? peerRange : '', dev: false, optional: bucket.optional, peer: isPeer });
      }
    }
    adjacency.set(key, out);
  }

  // ---- derived flags: dev + peer by reachability over snapshot keys ----
  const reach = (seeds: string[], followPeers: boolean): Set<string> => {
    const seen = new Set<string>();
    const queue = [...seeds];
    while (queue.length > 0) {
      const k = queue.pop()!;
      if (seen.has(k)) continue;
      seen.add(k);
      for (const a of adjacency.get(k) ?? []) if (followPeers || !a.peer) queue.push(a.to);
    }
    return seen;
  };
  const reachAll = reach(seedsAll, true);
  const reachProd = reach(seedsProd, true);
  const reachNonPeer = reach(seedsAll, false);
  for (const [pkgKey, node] of nodeByPkgKey) {
    const keys = snapshotKeysByPkgKey.get(pkgKey) ?? [];
    if (keys.length === 0) continue;
    if (!keys.some((k) => reachAll.has(k))) {
      unsupported.add(`pnpm package '${pkgKey}' is not reachable from any importer: kept, dev/peer defaulted false`);
      continue;
    }
    node.dev = !keys.some((k) => reachProd.has(k));
    node.peer = !keys.some((k) => reachNonPeer.has(k));
  }

  // A DEPENDENCY-FREE project is what pnpm really writes as `importers: {.: {}}` and nothing else. It is
  // accepted ONLY when EVERY importer declares zero dependencies (all three buckets absent or empty)
  // and `packages` / `snapshots` are absent or empty: the closure then IS the root alone. One declared
  // dependency anywhere with no `packages` is still a hollow lockfile — a closure that was lost.
  const absentOrEmpty = (v: PnpmYamlValue | undefined): boolean => v === undefined || v === null || (isMap(v) && v.size === 0);
  // D4-1a: a `link:` / `workspace:` dependency has NO packages entry by construction (pnpm writes a
  // link-only workspace with importers alone), so its presence is not evidence of a lost closure —
  // it is already a HASHED opaque entry above. Only a declared dependency that WOULD need a packages
  // entry (anything else) makes an absent `packages` a hollow lockfile.
  const isLinkDep = (d: PnpmYamlValue | undefined): boolean =>
    isMap(d) && ((isStr(d.get('version')) && (d.get('version') as string).startsWith('link:')) || (isStr(d.get('specifier')) && (d.get('specifier') as string).startsWith('workspace:')));
  const declaresNonLink = (imp: PnpmYamlValue | undefined): boolean =>
    isMap(imp) &&
    IMPORTER_BUCKETS.some((b) => {
      const deps = imp.get(b.key);
      return isMap(deps) && [...deps.values()].some((d) => !isLinkDep(d));
    });
  const dependencyFree =
    isMap(importersRaw) &&
    importers.size > 0 &&
    [...importers.values()].every((imp) => isMap(imp) && !declaresNonLink(imp)) &&
    absentOrEmpty(packagesRaw) &&
    absentOrEmpty(snapshotsRaw);
  if (dependencyFree) unsupported.add(STACK_COVERAGE_PNPM_DEPENDENCY_FREE);
  const hollow =
    !isMap(importersRaw) || importers.size === 0
      ? "no 'importers' mapping"
      : dependencyFree
        ? null
        : !isMap(packagesRaw) || packages.size === 0
          ? "no 'packages' mapping"
          : !isMap(snapshotsRaw) || snapshots.size === 0
            ? "no 'snapshots' mapping"
            : null; // a non-empty `packages` always yields a node, a HASHED opaque entry, or a malformed refusal
  unmodeled.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const settings = doc.get('settings');
  const excludeLinksFromLockfile = isMap(settings) && settings.get('excludeLinksFromLockfile') === true;
  return {
    nodes: [rootNode, ...nodeByPkgKey.values()],
    edges,
    unmodeled,
    rootDeclared,
    unsupported: [...unsupported],
    malformed: malformed.sort(),
    hollow,
    importers: importerFacts,
    excludeLinksFromLockfile,
  };
}

export interface PnpmLockReadResult {
  derived: PnpmDerived | null;
  /** non-empty when the lockfile was refused whole (subset error, wrong lockfileVersion, hollow, malformed entries) */
  refusals: string[];
}

/** Text → derived facts, or ONE refusal string. Never throws on lockfile content. */
export function readPnpmLock(source: string, root: PnpmRootIdentity): PnpmLockReadResult {
  let doc: PnpmYamlMap;
  try {
    doc = parsePnpmLockSubset(source);
  } catch (e) {
    if (e instanceof PnpmLockSubsetError) return { derived: null, refusals: [e.message] };
    throw e;
  }
  const version = pnpmLockfileVersion(doc);
  // EXACTLY '9.0' (quoted or not — numbers are never re-spelled): '9', '9.1', '10.0' are other formats
  if (version !== '9.0') return { derived: null, refusals: [stackRefusalPnpmLockfileVersion(version)] };
  let derived: PnpmDerived;
  try {
    derived = deriveFromPnpmLockV9(doc, root);
  } catch (e) {
    // belt to the nesting cap: content can never surface as an exception to a library / MCP caller
    if (e instanceof RangeError) return { derived: null, refusals: [stackRefusalPnpmMalformed('document (nested too deeply for the reader)')] };
    throw e;
  }
  if (derived.hollow !== null) return { derived: null, refusals: [stackRefusalPnpmHollow(derived.hollow)] };
  if (derived.malformed.length > 0) return { derived: null, refusals: derived.malformed.map(stackRefusalPnpmMalformed) };
  return { derived, refusals: [] };
}

/* -------------------------------------------------------------------------- */
/* pnpm-workspace.yaml: which directories pnpm takes as workspace packages     */
/* -------------------------------------------------------------------------- */

export interface PnpmWorkspacePatterns {
  include: RegExp[];
  exclude: RegExp[];
  /** the include globs as written (cleaned of `./` and a trailing `/`), for prefix reasoning */
  includeGlobs: string[];
  /** deepest directory a pattern can name; `Infinity` when any include pattern carries `**` */
  maxDepth: number;
  /** the file carries a `packages:` key at all (absent: pnpm >= 10 takes the root alone; pnpm < 10 refuses to run) */
  hasPackagesKey: boolean;
}

/** One workspace glob → an anchored RegExp over a `/`-separated directory path. `null` = syntax this reader does not evaluate. */
export function pnpmWorkspaceGlobToRegExp(glob: string): RegExp | null {
  const cleaned = glob.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  if (cleaned === '' || /[{}[\]()\\!+@]\(|[{}[\]()\\]/.test(cleaned) || cleaned.startsWith('/')) return null;
  if (cleaned === '.') return /^$/;
  // dot-led names never match a wildcard (pnpm globs with dot:false)
  const ANY = '(?!\\.)[^/]+';
  let re = '^';
  let needSep = false;
  const segs = cleaned.split('/');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const last = i === segs.length - 1;
    if (seg === '' || seg === '.' || seg === '..') return null;
    if (seg === '**') {
      // zero or more directories: `a/**` names `a` itself as well as everything below it
      if (!last) {
        re += `${needSep ? '/' : ''}(?:${ANY}/)*`;
        needSep = false;
      } else {
        re += needSep ? `(?:/${ANY})*` : `(?:${ANY}(?:/${ANY})*)?`;
      }
      continue;
    }
    if (seg.includes('**')) return null;
    if (needSep) re += '/';
    if (seg[0] === '*' || seg[0] === '?') re += '(?!\\.)';
    for (const ch of seg) re += ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    needSep = true;
  }
  return new RegExp(`${re}$`);
}

/**
 * The `packages:` globs of a `pnpm-workspace.yaml`. Returns a refusal reason (string) when the file
 * cannot be evaluated: outside the YAML subset, `packages` not a list of strings, or a glob syntax
 * this reader does not evaluate (braces, classes, extglobs) — never a guess.
 * No `packages:` key ⇒ no patterns: pnpm >= 10 then takes the root alone (measured on 10.11.1).
 */
export function readPnpmWorkspacePatterns(source: string): PnpmWorkspacePatterns | string {
  let doc: PnpmYamlMap;
  try {
    doc = parsePnpmLockSubset(source);
  } catch (e) {
    if (e instanceof PnpmLockSubsetError) return `pnpm-workspace.yaml line ${e.line}: ${e.reason} — cannot be read, so the workspace packages cannot be checked`;
    throw e;
  }
  const out: PnpmWorkspacePatterns = { include: [], exclude: [], includeGlobs: [], maxDepth: 0, hasPackagesKey: doc.has('packages') };
  const raw = doc.get('packages');
  if (raw === undefined || raw === null) return out;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string' && x !== '')) return "pnpm-workspace.yaml 'packages' is not a list of strings, so the workspace packages cannot be checked";
  for (const item of raw as string[]) {
    const negated = item.startsWith('!');
    const glob = negated ? item.slice(1) : item;
    const re = pnpmWorkspaceGlobToRegExp(glob);
    if (re === null) return `pnpm-workspace.yaml package pattern '${item}' uses glob syntax this reader does not evaluate, so the workspace packages cannot be checked`;
    (negated ? out.exclude : out.include).push(re);
    if (!negated) {
      const cleaned = glob.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
      out.includeGlobs.push(cleaned);
      out.maxDepth = glob.includes('**') ? Infinity : Math.max(out.maxDepth, cleaned.split('/').length);
    }
  }
  return out;
}

/** Is directory `rel` (`/`-separated, '' for the root) a workspace package under these patterns? The root always is. */
export function isPnpmWorkspaceDir(patterns: PnpmWorkspacePatterns, rel: string): boolean {
  if (rel === '' || rel === '.') return true;
  if (rel.split('/').some((seg) => seg === 'node_modules' || seg === 'bower_components')) return false;
  return patterns.include.some((re) => re.test(rel)) && !patterns.exclude.some((re) => re.test(rel));
}

/** The `packages:` reading pnpm's own default gives: every directory below the root (`**`). */
export function pnpmWorkspaceEveryDirectory(): PnpmWorkspacePatterns {
  const all = readPnpmWorkspacePatterns('packages:\n  - "**"\n');
  if (typeof all === 'string') throw new Error(all);
  return all;
}

/**
 * Could an include glob name a directory BELOW `dir` (not `dir` itself)? Decided from the glob's
 * segments: the glob must be able to consume every segment of `dir` and still have something left to
 * match. Used for a gitlink under a workspace glob whose contents the view cannot see.
 */
export function pnpmWorkspaceGlobMayMatchBelow(patterns: PnpmWorkspacePatterns, dir: string): boolean {
  const dirSegs = dir === '' || dir === '.' ? [] : dir.split('/');
  const segMatches = (glob: string, seg: string): boolean => {
    if (glob === '**') return true;
    const re = pnpmWorkspaceGlobToRegExp(glob);
    return re !== null && re.test(seg);
  };
  const walk = (gs: string[], ds: string[]): boolean => {
    if (ds.length === 0) return gs.length > 0; // dir consumed; anything left can name a deeper directory
    if (gs.length === 0) return false;
    const [g, ...gRest] = gs as [string, ...string[]];
    if (g === '**') return walk(gRest, ds) || walk(gs, ds.slice(1)); // zero or more segments
    return segMatches(g, ds[0]!) && walk(gRest, ds.slice(1));
  };
  return patterns.includeGlobs.some((glob) => walk(glob.split('/'), dirSegs));
}
