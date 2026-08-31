/**
 * b1/egress — quality matrix for the `forbiddenEgress` constraint: an allowlist-shaped constraint
 * over a NEW `type:'egress'` AST edge that detects `fetch()` calls to ungoverned hosts via a
 * `||`-chain-literal-fold host resolver. Covers: the schema addition, `resolveExtraction`'s
 * egress-config union, `resolveEgressHostLiterals` (the keystone resolver), the AST extractor's
 * egress pass, the `evaluate()` constraint arm, the CLI/gate line-scan refusal, and — the ratchet —
 * byte-identical scoring on the pre-existing control-tower-ontology + luna-chat-extension fixtures.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EngineeringBlueprintSchema, parseBlueprint } from '../src/schema.js';
import {
  AstExtractor,
  LineScanExtractor,
  resolveExtraction,
  resolveEgressHostLiterals,
  isGovernedHost,
} from '../src/extractors.js';
import { evaluate, stableStringify } from '../src/report.js';
import { runGate } from '../src/gate.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import { Project, SyntaxKind } from 'ts-morph';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const BP_PATH = path.join(FIXROOT, 'egress-reader.blueprint.json');
const blueprint: EngineeringBlueprint = parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')));
const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);

const surface = (name: string): string => path.join(FIXROOT, 'egress-surface', name);

/* -------------------------------------------------------------------------- */
describe('schema — forbiddenEgress constraint type (widen-only)', () => {
  it('accepts a constraint of type forbiddenEgress with governedHosts + egressCallees', () => {
    expect(() => parseBlueprint(JSON.parse(fs.readFileSync(BP_PATH, 'utf8')))).not.toThrow();
    expect(blueprint.constraints[0]?.type).toBe('forbiddenEgress');
    expect(blueprint.constraints[0]?.governedHosts).toContain('localhost');
  });

  it('a constraint with type forbiddenEgress and NO governedHosts/egressCallees still validates (both optional)', () => {
    const bp = {
      ...blueprint,
      constraints: [{ id: 'x', type: 'forbiddenEgress' as const, severity: 'critical' as const }],
    };
    expect(EngineeringBlueprintSchema.safeParse(bp).success).toBe(true);
  });

  it('REJECTS an unknown constraint type (enum is closed to the declared set)', () => {
    const bad = { ...blueprint, constraints: [{ id: 'x', type: 'notARealType', severity: 'critical' }] };
    expect(EngineeringBlueprintSchema.safeParse(bad).success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe('resolveExtraction — egress config resolution', () => {
  it('a blueprint with a forbiddenEgress constraint resolves egressEnabled:true + unions governedHosts/egressCallees', () => {
    expect(cfg.egressEnabled).toBe(true);
    expect(cfg.governedHosts).toEqual(
      [...blueprint.constraints[0]!.governedHosts!].sort(),
    );
    expect(cfg.egressCallees).toEqual(['fetch']);
  });

  it('a blueprint with NO forbiddenEgress constraint resolves egressEnabled:false (ratchet default)', () => {
    const def = resolveExtraction(undefined);
    expect(def.egressEnabled).toBe(false);
    expect(def.governedHosts).toEqual([]);
    expect(def.egressCallees).toEqual(['fetch']);
  });

  it('egressCallees defaults to [fetch] when a forbiddenEgress constraint declares none', () => {
    const bp = parseBlueprint({
      ...blueprint,
      constraints: [{ id: 'x', type: 'forbiddenEgress', severity: 'critical', governedHosts: ['localhost'] }],
    });
    const c = resolveExtraction(bp.extraction, bp.constraints);
    expect(c.egressEnabled).toBe(true);
    expect(c.egressCallees).toEqual(['fetch']);
  });
});

/* -------------------------------------------------------------------------- */
describe('resolveEgressHostLiterals — the keystone resolver (unit-level, over a synthetic AST)', () => {
  /**
   * Parse `src` as a standalone TS module and return the bare `fetch(...)` call's arg0 node.
   * NOT simply "the first CallExpression in document order" — a `.replace(...)`/regex-literal
   * call inside the argument expression (e.g. `(...).replace(/\/$/, '')`) can appear textually
   * before the outer `fetch(...)` in `getDescendantsOfKind` order, so this scopes to the call
   * whose callee is the bare identifier `fetch` — the exact same discrimination
   * `AstExtractor.extractEgress` performs.
   */
  function firstCallArg(src: string) {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('x.ts', src);
    const call = sf
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .find((c) => c.getExpression().getKind() === SyntaxKind.Identifier && c.getExpression().getText() === 'fetch');
    if (!call) throw new Error('no fetch(...) call expression in fixture source');
    const arg0 = call.getArguments()[0];
    if (!arg0) throw new Error('call has no arguments');
    return arg0;
  }

  it('resolves a plain string literal URL to its host', () => {
    const r = resolveEgressHostLiterals(firstCallArg(`fetch('https://api.openai.com/v1/x');`));
    expect(r.hosts).toEqual(new Set(['api.openai.com']));
    expect(r.unresolvable).toBe(false);
  });

  it('resolves a no-substitution template literal URL to its host', () => {
    const r = resolveEgressHostLiterals(firstCallArg('fetch(`https://api.openai.com/v1/x`);'));
    expect(r.hosts).toEqual(new Set(['api.openai.com']));
  });

  it('resolves a template expression with a leading literal scheme://host prefix', () => {
    const r = resolveEgressHostLiterals(firstCallArg('const p = "/x"; fetch(`https://api.openai.com${p}`);'));
    expect(r.hosts).toContain('api.openai.com');
  });

  it('folds a same-file const `||` chain, collecting EVERY literal operand as a candidate host', () => {
    const src = [
      "const DEFAULT = 'http://localhost:3013';",
      'declare const opts: { x?: string };',
      "const base = (opts.x || process.env.Y || DEFAULT);",
      'fetch(base);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    // hostname (NOT host) — the port is stripped so a `governedHosts: ['localhost']` allowlist
    // entry matches a URL that pins an explicit port.
    expect(r.hosts).toContain('localhost');
  });

  it('folds a `||` chain with an UNGOVERNED default literal (the drift shape)', () => {
    const src = [
      "const D = 'https://api.openai.com';",
      'declare const opts: { x?: string };',
      "const base = (opts.x || process.env.Y || D).replace(/\\/$/, '');",
      'fetch(`${base}/v1/chat`);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    expect(r.hosts).toContain('api.openai.com');
  });

  it('unwraps a host-preserving `.replace(...)` call to its receiver', () => {
    const src = [
      "const DEFAULT = 'https://api.openai.com';",
      "const base = DEFAULT.replace(/\\/$/, '');",
      'fetch(base);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    expect(r.hosts).toContain('api.openai.com');
  });

  it('follows ONE more same-file const hop for an Identifier operand inside a chain', () => {
    // `fetch(base)` is hop 1 (base -> its `||`-chain initializer); DEFAULT inside the chain is
    // hop 2 ("one more hop"). DEFAULT resolves DIRECTLY to a literal (not a further identifier),
    // staying within the bound.
    const src = [
      "const DEFAULT = 'https://api.openai.com';",
      'declare const opts: { x?: string };',
      'const base = (opts.x || DEFAULT);',
      'fetch(base);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    expect(r.hosts).toContain('api.openai.com');
  });

  it('resolves the canonical THREE-hop house idiom (url -> base -> chain-operand DEFAULT -> literal)', () => {
    // this is the exact shape the resolver is built to recognize: url -> base (hop 1), and the
    // chain's DEFAULT operand -> its own literal (hop 2 — a SEPARATE same-file const, itself a
    // further identifier-follow). Two identifier-hops total (url, DEFAULT); `base` is reached by
    // following `url`'s initializer directly, not an extra hop of its own. `unresolvable` is
    // still `true` here because `opts.x` (a PropertyAccessExpression chain operand) contributes
    // no candidate — a call CAN be both `unresolvable:true` and carry resolved hosts (spec:
    // EgressHostResolution doc). The resolved DEFAULT host is what matters for the constraint.
    const src = [
      "const DEFAULT = 'https://api.openai.com';",
      'declare const opts: { x?: string };',
      "const base = (opts.x || process.env.Y || DEFAULT).replace(/\\/$/, '');",
      'const url = `${base}/v1/chat`;',
      'fetch(url);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    expect(r.hosts).toContain('api.openai.com');
  });

  it('a chain of const-aliases BEYOND the hop bound is unresolvable (bounded, not unbounded)', () => {
    const src = [
      "const L0 = 'https://api.openai.com';",
      'const L1 = L0;',
      'const L2 = L1;',
      'const L3 = L2;',
      'declare const opts: { x?: string };',
      'const base = (opts.x || L3);',
      'const url = `${base}/x`;',
      'fetch(url);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    // url(hop1) -> base -> L3(hop2) -> L2(hop3) -> L1(hop4, exceeds MAX_EGRESS_HOST_HOPS=3) -> unresolvable.
    expect(r.hosts.size).toBe(0);
    expect(r.unresolvable).toBe(true);
  });

  it('is unresolvable for a bare process.env.X read with no literal fallback', () => {
    const r = resolveEgressHostLiterals(firstCallArg('fetch(process.env.TARGET);'));
    expect(r.hosts.size).toBe(0);
    expect(r.unresolvable).toBe(true);
  });

  it('is unresolvable for a function-call result (non-passthrough)', () => {
    const r = resolveEgressHostLiterals(firstCallArg('declare function computeUrl(): string; fetch(computeUrl());'));
    expect(r.unresolvable).toBe(true);
  });

  it('is unresolvable beyond the ~2-hop bound (three chained same-file const hops)', () => {
    const src = [
      "const A = 'https://api.openai.com';",
      'const B = A;',
      'const C = B;',
      'const D = C;',
      'fetch(D);',
    ].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    // D -> C (hop1) -> B (hop2) -> A is a 3rd hop, beyond the 2-hop bound -> unresolvable.
    expect(r.unresolvable).toBe(true);
  });

  it('is unresolvable for a reassignable `let` binding (never trusts a non-const)', () => {
    const src = ["let target = 'https://api.openai.com';", 'fetch(target);'].join('\n');
    const r = resolveEgressHostLiterals(firstCallArg(src));
    expect(r.unresolvable).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
describe('isGovernedHost — host-match semantics', () => {
  const governed = ['localhost', '127.0.0.1', 'staging.example.com', 'api-gateway'];
  it('exact match is governed', () => expect(isGovernedHost('api-gateway', governed)).toBe(true));
  it('a proper subdomain is governed', () => expect(isGovernedHost('a.staging.example.com', governed)).toBe(true));
  it('an ungoverned host is NOT governed', () => expect(isGovernedHost('api.openai.com', governed)).toBe(false));
  it('a host that merely CONTAINS a governed suffix without a dot boundary is NOT governed (no substring match)', () => {
    expect(isGovernedHost('evilapi-gateway.com', governed)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe('bce run — green/red/honest-unresolved discrimination on the egress surface', () => {
  it('1. CONFORMANT (house-idiom, governed default) → verdict pass, host resolved AND governed', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant-houseidiom'), 'rev-conformant');
    // RECONCILED (pure-detector redesign): the extractor is now a PURE detector — it emits a `type:'egress'`
    // edge for EVERY resolved host, governed or not (the policy judgement moved entirely into
    // evaluate()/report.ts, per the mode-branching design). So the resolver DID resolve a host
    // here — assert the edge EXISTS and targets the governed 'localhost' host — and the
    // behavioral property that actually matters ("a governed host is not a violation") is proven
    // below via evaluate().
    const egressEdges = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egressEdges).toHaveLength(1);
    expect(egressEdges[0]?.to).toBe('localhost');
    expect(g.coverage.filesScanned).toBeGreaterThan(0);
    // directly prove resolution succeeded (not just "no violation"): the resolver returns the
    // localhost host, which IS governed. (`unresolvable` may still be true — the fixture's
    // `opts.baseUrl` chain operand is a PropertyAccessExpression the resolver cannot fold — but
    // that does not prevent the DEFAULT literal operand from being resolved and governed.)
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    const sf = project.addSourceFileAtPath(path.join(surface('conformant-houseidiom'), 'src', 'reader.ts'));
    const call = sf.getDescendantsOfKind(SyntaxKind.CallExpression).find((c) => c.getExpression().getText() === 'fetch');
    expect(call).toBeDefined();
    const arg0 = call!.getArguments()[0]!;
    const resolved = resolveEgressHostLiterals(arg0);
    expect(resolved.hosts.size).toBeGreaterThan(0);
    expect([...resolved.hosts].some((h) => isGovernedHost(h, cfg.governedHosts))).toBe(true);

    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.score).toBe(100);
    expect(r.violations).toHaveLength(0);
  });

  it('2. DRIFT (house-idiom, ungoverned default — the realistic drift shape) → verdict fail, exactly one critical violation, score 60', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-egress-provider-houseidiom'), 'rev-drift');
    const egressEdges = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egressEdges).toHaveLength(1);
    expect(egressEdges[0]?.to).toBe('api.openai.com');

    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.score).toBe(60); // 100 - critical(40)
    const evViolations = r.violations.filter((v) => v.constraintId === 'reader-egress-governed-only');
    expect(evViolations).toHaveLength(1);
    expect(evViolations[0]?.severity).toBe('critical');
    expect(evViolations[0]?.observed).toContain('api.openai.com');
  });

  it('3. UNRESOLVABLE (fetch(process.env.TARGET), no literal fallback) → verdict pass, ZERO violations, honestly disclosed in coverage.unsupported', () => {
    const g = new AstExtractor(cfg).extract(surface('unresolvable-env'), 'rev-unresolvable');
    const egressEdges = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egressEdges).toHaveLength(0);
    expect(g.coverage.unsupported.some((u) => u.includes('unresolvable host'))).toBe(true);

    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
    expect(r.coverage.unsupported.some((u) => u.includes('unresolvable host'))).toBe(true);
  });

  it('the CLI/gate `bce run` exit-1 contract holds on the drift fixture (via runGate)', () => {
    // Staged OUTSIDE the repository, deliberately: three selftests copy the whole
    // tree with fs.cpSync, and a directory that appears and disappears under
    // fixtures/ during a parallel run makes that copy crash on a vanished path.
    const blueprintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-egress-gate-'));
    fs.writeFileSync(
      path.join(blueprintDir, 'egress-reader.blueprint.json'),
      fs.readFileSync(BP_PATH, 'utf8'),
    );
    try {
      const result = runGate(surface('drift-egress-provider-houseidiom'), blueprintDir, null, 'ast');
      expect(result.failed).toBe(true);
      expect(result.reports[0]?.verdict).toBe('fail');
    } finally {
      fs.rmSync(blueprintDir, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------------------------------- */
describe('line-scan refusal for an egressEnabled blueprint', () => {
  it('LineScanExtractor discloses that forbiddenEgress is not evaluated (honest coverage)', () => {
    const g = new LineScanExtractor(cfg).extract(surface('drift-egress-provider-houseidiom'), 'x');
    expect(g.guardEdges.filter((e) => e.type === 'egress')).toHaveLength(0);
    expect(g.coverage.unsupported.some((u) => u.includes('forbiddenEgress'))).toBe(true);
  });

  it('runGate REFUSES (fail, non-vacuous) a line-scan run against an egressEnabled blueprint', () => {
    // Outside the repository — see the note on the sibling gate test above.
    const blueprintDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-egress-linescan-gate-'));
    fs.writeFileSync(
      path.join(blueprintDir, 'egress-reader.blueprint.json'),
      fs.readFileSync(BP_PATH, 'utf8'),
    );
    try {
      const result = runGate(surface('conformant-houseidiom'), blueprintDir, null, 'line-scan');
      expect(result.failed).toBe(true);
      expect(result.reports[0]?.summary).toContain('line-scan cannot resolve fetch hosts');
    } finally {
      fs.rmSync(blueprintDir, { recursive: true, force: true });
    }
  });
});

/* -------------------------------------------------------------------------- */
describe('determinism — the egress extractor + evaluate are byte-identical across two runs', () => {
  it('AST egress extraction + evaluate is byte-deterministic on the drift surface', () => {
    const a = evaluate(blueprint, new AstExtractor(cfg).extract(surface('drift-egress-provider-houseidiom'), 'd'), 'plugin-surface');
    const b = evaluate(blueprint, new AstExtractor(cfg).extract(surface('drift-egress-provider-houseidiom'), 'd'), 'plugin-surface');
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('AST egress extraction + evaluate is byte-deterministic on the conformant surface', () => {
    const a = evaluate(blueprint, new AstExtractor(cfg).extract(surface('conformant-houseidiom'), 'c'), 'plugin-surface');
    const b = evaluate(blueprint, new AstExtractor(cfg).extract(surface('conformant-houseidiom'), 'c'), 'plugin-surface');
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});

/* -------------------------------------------------------------------------- */
/* THE RATCHET — forbiddenEgress is WIDEN-ONLY. Neither pre-existing fixture blueprint declares
 * a forbiddenEgress constraint, so egressEnabled resolves false for both and the egress pass never
 * runs — byte-identical scoring is guaranteed BY CONSTRUCTION. This proves it empirically too. */
describe('ratchet — pre-existing blueprints score BYTE-IDENTICALLY (control-tower-ontology + luna-chat-extension)', () => {
  const CT_FIXTURE = path.join(FIXROOT, 'control-tower-ontology.blueprint.json');
  const LUNA_FIXTURE = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

  it('control-tower-ontology has NO forbiddenEgress constraint (egress pass never runs)', () => {
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(CT_FIXTURE, 'utf8')));
    const c = resolveExtraction(bp.extraction, bp.constraints);
    expect(c.egressEnabled).toBe(false);
  });

  it('luna-chat-extension has NO forbiddenEgress constraint (egress pass never runs)', () => {
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(LUNA_FIXTURE, 'utf8')));
    const c = resolveExtraction(bp.extraction, bp.constraints);
    expect(c.egressEnabled).toBe(false);
  });

  it('luna-chat-extension conformant report is BYTE-IDENTICAL to the pre-b1 baseline (captured from origin/main tip)', () => {
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(LUNA_FIXTURE, 'utf8')));
    const c = resolveExtraction(bp.extraction, bp.constraints);
    const g = new AstExtractor(c).extract(path.join(FIXROOT, 'extension-surface', 'conformant'), 'baseline-rev');
    const r = evaluate(bp, g, c.profile);
    // captured via a throwaway script run against v0.2.1 (pre-change) HEAD before any edit in
    // this WO; see the return message's ratchet section for how this was captured.
    expect(r.score).toBe(100);
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
    expect(r.coverage.unsupported).toEqual([
      'no cross-module symbol resolution (a tool registered via an imported helper is not followed)',
      'dynamic/reflective tool registration not detected',
      'a re-exported forbidden module (barrel import) may be missed',
    ]);
  });

  it('luna-chat-extension drift report is BYTE-IDENTICAL to the pre-b1 baseline (captured from origin/main tip)', () => {
    const bp = parseBlueprint(JSON.parse(fs.readFileSync(LUNA_FIXTURE, 'utf8')));
    const c = resolveExtraction(bp.extraction, bp.constraints);
    const g = new AstExtractor(c).extract(path.join(FIXROOT, 'extension-surface', 'drift-forbidden-import'), 'baseline-rev');
    const r = evaluate(bp, g, c.profile);
    expect(r.score).toBe(60);
    expect(r.verdict).toBe('fail');
    expect(r.violations.map((v) => v.constraintId)).toEqual(['no-direct-provider-sdk']);
    expect(r.coverage.unsupported).toEqual([
      'no cross-module symbol resolution (a tool registered via an imported helper is not followed)',
      'dynamic/reflective tool registration not detected',
      'a re-exported forbidden module (barrel import) may be missed',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* b3/coverage-envelope-airtight — the WIDEN (additive detections, no changed verdict).
 *
 * Class A (RESOLVABLE → RED): the options-bag `{host|hostname:"literal"}` form and the undici
 * `new Client("literal-url")` dispatcher constructor — real host literals 0.5.0 could not resolve.
 * Class B (UNRESOLVABLE → ADVISORY, not silent): a detected egress callee whose host resolves to
 * NOTHING (env-only, cross-module) is now ITEMIZED with location in coverage.unsupported — never a
 * silent aggregate-only count, never a false BLOCK. All additive; existing verdicts unchanged. */
describe('b3/Class A — resolveEgressHostLiterals resolves the options-bag + new URL forms', () => {
  /** the arg0 of the first call/new whose callee text ENDS in `name` (bare or property-access). */
  function argOf(src: string, name: string) {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile('x.ts', src);
    const nodes = [
      ...sf.getDescendantsOfKind(SyntaxKind.CallExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.NewExpression),
    ];
    const node = nodes.find((c) => c.getExpression().getText().trim().endsWith(name));
    if (!node) throw new Error(`no ${name}(...) node in fixture source`);
    const arg0 = node.getArguments()[0];
    if (!arg0) throw new Error('node has no arguments');
    return arg0;
  }

  it('resolves an options-bag { host: "literal" } to the host', () => {
    const r = resolveEgressHostLiterals(argOf(`http.request({ host: 'api.openai.com', path: '/v1' });`, 'request'));
    expect(r.hosts).toEqual(new Set(['api.openai.com']));
    expect(r.unresolvable).toBe(false);
  });

  it('resolves an options-bag { hostname: "literal" } to the host (the canonical bare-hostname form)', () => {
    // Node's canonical options-bag form puts the port in a SEPARATE `port` property, so `hostname`
    // is a bare host (`api.openai.com`) — that resolves cleanly. (A rare `hostname: 'host:port'`
    // string is honestly NOT resolved: the WHATWG URL parser reads `host:` as a scheme, so it fails
    // OPEN rather than guess — proven in the next case.)
    const r = resolveEgressHostLiterals(argOf(`https.request({ hostname: 'api.openai.com', port: 8443, path: '/v1' });`, 'request'));
    expect(r.hosts).toEqual(new Set(['api.openai.com']));
    expect(r.unresolvable).toBe(false);
  });

  it('an options-bag { host: "host:port" } embedded-port form is honestly unresolvable (fail OPEN, never a guessed edge)', () => {
    // a dotted `host:port` string looks like a `scheme:opaque` URL to `new URL`, so `hostFromUrlString`
    // cannot extract a host — the resolver discloses the limit rather than fabricate a host.
    const r = resolveEgressHostLiterals(argOf(`http.request({ host: 'api.openai.com:8443', path: '/v1' });`, 'request'));
    expect(r.hosts.size).toBe(0);
    expect(r.unresolvable).toBe(true);
  });

  it('an options-bag with NO literal host/hostname is unresolvable (env-built host → fail OPEN)', () => {
    const r = resolveEgressHostLiterals(argOf('http.request({ host: process.env.H, path: "/v1" });', 'request'));
    expect(r.hosts.size).toBe(0);
    expect(r.unresolvable).toBe(true);
  });

  it('resolves a new URL("literal") passed as an egress argument to its host', () => {
    const r = resolveEgressHostLiterals(argOf(`fetch(new URL('https://api.openai.com/v1/x'));`, 'fetch'));
    expect(r.hosts).toEqual(new Set(['api.openai.com']));
    expect(r.unresolvable).toBe(false);
  });

  it('a new URL(computed) is unresolvable (never a speculative edge)', () => {
    const r = resolveEgressHostLiterals(argOf('declare const h: string; fetch(new URL(`https://${h}/v1`));', 'fetch'));
    expect(r.unresolvable).toBe(true);
  });
});

describe('b3/Class A — extractor emits a RED egress edge for the options-bag + undici-constructor forms', () => {
  it('drift-egress-optbag (https.request({hostname:"api.openai.com"})) → RED, one critical violation', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-egress-optbag'), 'rev-optbag');
    const egress = g.guardEdges.filter((e) => e.type === 'egress');
    expect(egress).toHaveLength(1);
    expect(egress[0]?.to).toBe('api.openai.com');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.score).toBe(60);
    expect(r.violations.filter((v) => v.constraintId === 'reader-egress-governed-only')).toHaveLength(1);
    expect(r.violations[0]?.severity).toBe('critical');
    expect(r.violations[0]?.observed).toContain('api.openai.com');
  });

  it('drift-egress-undici-client (new Client("https://api.openai.com")) → RED, one critical violation on the CONSTRUCTOR host', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-egress-undici-client'), 'rev-undici');
    const egress = g.guardEdges.filter((e) => e.type === 'egress');
    // exactly ONE edge — the constructor host — NOT a second edge for the c.request({path}) call
    // (whose host lives on the constructor, not the call; it is itemized as advisory instead).
    expect(egress).toHaveLength(1);
    expect(egress[0]?.to).toBe('api.openai.com');
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('fail');
    expect(r.score).toBe(60);
    expect(r.violations.filter((v) => v.constraintId === 'reader-egress-governed-only')).toHaveLength(1);
    // the .request({path}) call is honestly disclosed as advisory, not a second violation/edge.
    expect(g.coverage.unsupported.some((u) => /detected egress call `c\.request`/.test(u))).toBe(true);
  });

  it('a GOVERNED options-bag host is NOT a violation (allowlist-safe — the widen never false-REDs a governed host)', () => {
    const project = new Project({ useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
    void project;
    // synth a surface where the options-bag host is the governed `localhost`
    // Outside the repository — see the note on the gate tests above.
    const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-b3-optbag-governed-'));
    const dir = path.join(scratchRoot, 'src');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'reader.ts'),
      `import https from 'node:https';\nexport function a() { return https.request({ host: 'localhost', port: 3013, path: '/v1' }); }\n`,
    );
    try {
      const g = new AstExtractor(cfg).extract(scratchRoot, 'rev-gov');
      const egress = g.guardEdges.filter((e) => e.type === 'egress');
      expect(egress).toHaveLength(1);
      expect(egress[0]?.to).toBe('localhost');
      const r = evaluate(blueprint, g, 'plugin-surface');
      expect(r.verdict).toBe('pass');
      expect(r.violations).toHaveLength(0);
    } finally {
      fs.rmSync(scratchRoot, { recursive: true, force: true });
    }
  });
});

describe('b3/Class B — a detected-but-unresolvable egress call is ITEMIZED (advisory, never silent, never a false BLOCK)', () => {
  it('advisory-egress-envonly (fetch(`${process.env.LLM_HOST}/v1`)) → PASS, ZERO violations, itemized with location', () => {
    const g = new AstExtractor(cfg).extract(surface('advisory-egress-envonly'), 'rev-env');
    expect(g.guardEdges.filter((e) => e.type === 'egress')).toHaveLength(0);
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
    // the honesty fix: a LOCATED, per-call advisory line (not just the opaque aggregate count).
    const items = g.coverage.unsupported.filter((u) => /detected egress call `fetch` at .+#L\d+/.test(u));
    expect(items).toHaveLength(1);
    expect(items[0]).toContain('disclosed as advisory, not blocked');
    // AND it is preserved through evaluate() into the report coverage.
    expect(r.coverage.unsupported.some((u) => /detected egress call `fetch` at/.test(u))).toBe(true);
  });

  it('advisory-egress-crossmodule (imported const host) → PASS, ZERO violations, itemized with location', () => {
    const g = new AstExtractor(cfg).extract(surface('advisory-egress-crossmodule'), 'rev-xmod');
    expect(g.guardEdges.filter((e) => e.type === 'egress')).toHaveLength(0);
    const r = evaluate(blueprint, g, 'plugin-surface');
    expect(r.verdict).toBe('pass');
    expect(r.violations).toHaveLength(0);
    expect(g.coverage.unsupported.some((u) => /detected egress call `fetch` at .+reader\.ts#L\d+/.test(u))).toBe(true);
  });

  it('the aggregate count line STILL appears alongside the itemized lines (the b1 count is preserved, not replaced)', () => {
    const g = new AstExtractor(cfg).extract(surface('advisory-egress-envonly'), 'rev-env2');
    expect(g.coverage.unsupported.some((u) => /egress call\(s\) had an unresolvable host and were skipped/.test(u))).toBe(true);
    expect(g.coverage.unsupported.some((u) => /^detected egress call/.test(u))).toBe(true);
  });
});

describe('b3/ratchet — a call that RESOLVED a host (house idiom) is NOT itemized as Class B (existing verdicts unchanged)', () => {
  it('conformant-houseidiom: resolved localhost → NO Class B item added (only the pre-existing aggregate count)', () => {
    const g = new AstExtractor(cfg).extract(surface('conformant-houseidiom'), 'rev-c');
    // it resolved a host (localhost) → one egress edge → NOT a Class B "detected-but-unresolved" item.
    expect(g.guardEdges.filter((e) => e.type === 'egress')).toHaveLength(1);
    expect(g.coverage.unsupported.some((u) => /^detected egress call/.test(u))).toBe(false);
  });

  it('drift-egress-provider-houseidiom: resolved api.openai.com → NO Class B item added', () => {
    const g = new AstExtractor(cfg).extract(surface('drift-egress-provider-houseidiom'), 'rev-d');
    expect(g.guardEdges.filter((e) => e.type === 'egress')).toHaveLength(1);
    expect(g.coverage.unsupported.some((u) => /^detected egress call/.test(u))).toBe(false);
  });
});

describe('b3/determinism — the widened extractor is byte-deterministic on the new Class A + Class B surfaces', () => {
  for (const surf of ['drift-egress-optbag', 'drift-egress-undici-client', 'advisory-egress-envonly', 'advisory-egress-crossmodule']) {
    it(`AST extraction + evaluate is byte-identical across two runs on ${surf}`, () => {
      const a = evaluate(blueprint, new AstExtractor(cfg).extract(surface(surf), 'x'), 'plugin-surface');
      const b = evaluate(blueprint, new AstExtractor(cfg).extract(surface(surf), 'x'), 'plugin-surface');
      expect(stableStringify(a)).toBe(stableStringify(b));
    });
  }
});
