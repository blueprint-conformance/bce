/**
 * self-blueprint.test.ts — self-hosting v0: the engine's OWN blueprint stays true.
 *
 * `.blueprints/engine.blueprint.json` declares the engine's real architecture
 * (extraction-seam isolation, pure evaluator, single exit point, runtime-dep
 * allowlist). Three properties are proven here:
 *
 *  1. SYNC — the blueprint's per-file constraint coverage tracks the ACTUAL
 *     `src/*.ts` file set. Several constraints are per-file because a
 *     `forbiddenPattern` carries ONE `path` glob and glob negation ("every file
 *     EXCEPT cli.ts") is deliberately unsupported. Adding a src file without
 *     extending the blueprint fails THIS test — the new-file gap is closed by
 *     construction, not by convention.
 *  2. GREEN + TOOTHED — the gate passes on the authored tree AND `assessTeeth`
 *     proves every constraint refutable (a realistic change would redden it).
 *     A green that cannot fail proves nothing (the toothless trap).
 *  3. TEETH scopePaths REGRESSION — the forbiddenDependency reddening mutation
 *     must inject its synthetic edge INSIDE the constraint's scopePaths (found
 *     by self-hosting: the historical `teeth:injected` evidenceRef matches no
 *     real glob, so a scoped, genuinely-toothed constraint was spuriously
 *     labeled TRIVIALLY_GREEN).
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint } from '../src/schema.js';
import type { EngineeringBlueprint } from '../src/schema.js';
import { runGate } from '../src/gate.js';
import { assessTeeth, ConstraintTeeth } from '../src/teeth.js';
import { assessExtractorTeethCorpus } from '../src/extractor-teeth.js';
import { makeExtractor, resolveExtraction } from '../src/extractors.js';
import type { ArchitectureGraph } from '../src/graph.js';

const ROOT = path.join(__dirname, '..');
const BLUEPRINT_PATH = path.join(ROOT, '.blueprints', 'engine.blueprint.json');
const EXTRACTOR_TEETH_MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.blueprints', 'engine.teeth-mutations.json'), 'utf8'),
) as { cases: unknown[] };
// Each case materializes a fresh real-source mutation and runs the AST extractor. This
// synchronous proof completed in 663-715s on loaded Node 20/22 local runs on 2026-09-05;
// Vitest can only observe its timeout after that synchronous work returns. Scale this one
// finite ceiling with the declared corpus and keep 50% measured margin without weakening
// the global timeout, mutation coverage, or assertions.
const EXTRACTOR_TEETH_TIMEOUT_MS = Math.min(
  1_200_000,
  Math.max(120_000, EXTRACTOR_TEETH_MANIFEST.cases.length * 24_000),
);

function loadBlueprint(): EngineeringBlueprint {
  return parseBlueprint(JSON.parse(fs.readFileSync(BLUEPRINT_PATH, 'utf8')));
}

/**
 * Sub-directory planes (today: `src/stack/`) are covered by ONE glob per policy rather than a row
 * per file, so a new file there inherits coverage with no further amendment. The glob coverage is
 * REQUIRED as soon as the blueprint carries the stack never-exit row (the 0.1.2 amendment); the
 * ratified 0.1.1 text predates it, and both must parse as SYNC while the amendment is in review.
 */
const STACK_GLOB = 'src/stack/**/*.ts';
const STACK_NEVER_EXIT_ID = 'only-cli-may-call-process-exit--stack';
const STACK_NO_NETWORK_ID = 'stack-plane-no-network-no-subprocess';
const STACK_NO_GLOBAL_NETWORK_ID = 'stack-plane-no-global-network-api';

function srcFilesRecursive(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}${e.name}/`);
      else if (e.name.endsWith('.ts')) out.push(`${rel}${e.name}`);
    }
  };
  walk(path.join(ROOT, 'src'), '');
  return out.sort();
}

function stackPlaneCovered(bp: EngineeringBlueprint): boolean {
  return bp.constraints.some((x) => x.id === STACK_NEVER_EXIT_ID);
}

/** scopePaths a seam constraint must carry: the flat file list, plus the stack glob once amended. */
function expectedSeamScope(bp: EngineeringBlueprint, except: string): string[] {
  const flat = srcFiles().filter((f) => f !== except).map((f) => `src/${f}`);
  return (stackPlaneCovered(bp) ? [...flat, STACK_GLOB] : flat).sort();
}

function srcFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'src'))
    .filter((f) => f.endsWith('.ts'))
    .sort();
}

// The sanctioned process-owning ENTRYPOINTS (bins). These are the ONLY src files that may call
// `process.exit` — a bin owns its own process lifecycle; a library module never does. cli.ts is the
// `bce` bin; mcp-server.ts is the `bce-mcp` stdio server bin. Both are deliberately EXCLUDED from
// the per-file `only-cli-may-call-process-exit--*` coverage, exactly as cli.ts always has been.
// A new entrypoint bin is added here (one line) the same way a new library file is added to the
// blueprint — the new-file gap is closed by construction, not convention.
const ENTRYPOINTS = ['cli.ts', 'mcp-server.ts'];

describe('self-blueprint: the engine gates its own architecture', () => {
  it('parses STRICTLY as an EngineeringBlueprint (typos are hard errors)', () => {
    const bp = loadBlueprint();
    expect(bp.metadata.id).toBe('bce-engine-architecture');
    expect(bp.extraction?.profile).toBe('plugin-surface');
  });

  it('SYNC: every non-entrypoint src file carries a no-process-exit constraint', () => {
    const bp = loadBlueprint();
    const libraryFiles = srcFiles().filter((f) => !ENTRYPOINTS.includes(f));
    for (const f of libraryFiles) {
      const id = `only-cli-may-call-process-exit--${f.replace(/\.ts$/, '')}`;
      const c = bp.constraints.find((x) => x.id === id);
      expect(c, `missing constraint '${id}' — a new src file must be added to the self-blueprint`).toBeDefined();
      expect(c?.type).toBe('forbiddenPattern');
      expect(c?.path).toBe(`src/${f}`);
    }
    // and the ENTRYPOINT bins themselves are deliberately NOT covered — each owns its own process
    // lifecycle (cli.ts is the `bce` bin, mcp-server.ts is the `bce-mcp` bin). The library-modules-
    // never-exit policy applies to everything else.
    for (const ep of ENTRYPOINTS) {
      const id = `only-cli-may-call-process-exit--${ep.replace(/\.ts$/, '')}`;
      expect(bp.constraints.find((x) => x.id === id), `entrypoint '${ep}' must NOT carry a no-exit constraint`).toBeUndefined();
    }
  });

  it('SYNC: the ts-morph seam constraint scopes EVERY src file except extractors.ts', () => {
    const bp = loadBlueprint();
    const c = bp.constraints.find((x) => x.id === 'only-extractors-may-import-ts-morph');
    expect(c).toBeDefined();
    expect([...(c?.scopePaths ?? [])].sort()).toEqual(expectedSeamScope(bp, 'extractors.ts'));
  });

  it('SYNC: the Lezer seam constraint scopes EVERY src file except python-module-graph.ts', () => {
    const bp = loadBlueprint();
    const c = bp.constraints.find((x) => x.id === 'only-python-module-graph-may-import-lezer');
    expect(c).toBeDefined();
    expect([...(c?.scopePaths ?? [])].sort()).toEqual(expectedSeamScope(bp, 'python-module-graph.ts'));
  });

  it('SYNC: extraction.minFiles equals the actual src file count (fail-closed scan floor)', () => {
    const bp = loadBlueprint();
    if (!stackPlaneCovered(bp)) {
      expect(bp.extraction?.minFiles).toBe(srcFiles().length);
      return;
    }
    // Once the stack plane is covered by GLOB rows, a new file under src/stack/ inherits coverage
    // and must NOT force an amendment, so the floor is a RANGE rather than an equality: it covers
    // every flat src file plus at least one plane file (a collapsed scan still fails closed), and
    // it can never exceed the real scanned count (a floor above reality would refuse every run).
    const floor = bp.extraction?.minFiles ?? 0;
    expect(floor).toBeGreaterThan(srcFiles().length);
    expect(floor).toBeLessThanOrEqual(srcFilesRecursive().length);
  });

  it('SYNC: once amended, the stack plane carries its never-exit AND no-network rows as globs', () => {
    const bp = loadBlueprint();
    if (!stackPlaneCovered(bp)) return; // ratified 0.1.1: the amendment is the PR that adds them
    for (const id of [STACK_NEVER_EXIT_ID, STACK_NO_NETWORK_ID, STACK_NO_GLOBAL_NETWORK_ID]) {
      const c = bp.constraints.find((x) => x.id === id);
      expect(c, `missing constraint '${id}'`).toBeDefined();
      expect(c?.type).toBe('forbiddenPattern');
      expect(c?.path).toBe(STACK_GLOB);
    }
  });

  it('SYNC: the stack-plane rows keep their severities and bite the PLAIN forms — reference-level, not call-syntax only', () => {
    // Judged on every blueprint that carries the rows: the installed policy once amended, and the authored
    // candidate while it is under review (so the ceremony's input is tested before it is ratified).
    const candidatePath = path.join(ROOT, '.bce', 'authored', 'bstack-01b.engine.blueprint.json');
    const blueprints: EngineeringBlueprint[] = [loadBlueprint()];
    if (fs.existsSync(candidatePath)) blueprints.push(JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as EngineeringBlueprint);
    const covered = blueprints.filter(stackPlaneCovered);
    const row = (bp: EngineeringBlueprint, id: string) => {
      const c = bp.constraints.find((x) => x.id === id) as { pattern?: string; severity?: string } | undefined;
      expect(c, id).toBeDefined();
      return { re: new RegExp(c!.pattern!), severity: c!.severity };
    };
    for (const bp of covered) {
      expect(row(bp, STACK_NEVER_EXIT_ID).severity).toBe('high');
      expect(row(bp, STACK_NO_NETWORK_ID).severity).toBe('critical');
      expect(row(bp, STACK_NO_GLOBAL_NETWORK_ID).severity).toBe('critical');
      const api = row(bp, STACK_NO_GLOBAL_NETWORK_ID).re;
      // a REFERENCE is enough: the injectable-fetch idiom never calls `fetch(` on the line that smuggles it in
      for (const line of [
        "return fetch('https://example.invalid');",
        'export const get = (u: string, fetchImpl: typeof fetch = fetch) => fetchImpl(u);',
        'const doFetch = o.fetch ?? fetch;',
        '(o.fetch ?? globalThis.fetch)(u);',
        'const f = fetch; f(u);',
        'fetch.call(globalThis, u);',
        'window.fetch(u);',
        "navigator.sendBeacon('/x', body);",
        'const s = new WebSocket(u);',
        'const W = WebSocket;',
        'new XMLHttpRequest();',
        'const es: EventSource = make();',
      ]) expect(api.test(line), line).toBe(true);
      for (const line of ['const fetched = cache.get(key);', 'prefetchAll(nodes);', 'function refetch(): void {}']) expect(api.test(line), line).toBe(false);
      const net = row(bp, STACK_NO_NETWORK_ID).re;
      for (const line of [
        "import 'net';",
        "import'net';",
        "import net from 'node:net';",
        "import * as h from \"https\";",
        "import { request } from'node:http';",
        "} from 'node:tls';",
        "export { lookup } from 'node:dns/promises';",
        "const d = await import('node:dns/promises');",
        'const h = await import(`node:http`);',
        "const cp = require('child_process');",
        'const cp = require(`node:child_process`);',
        "import cluster from 'node:cluster';",
        "import * as insp from 'node:inspector';",
        "import { request } from 'undici';",
        "const u = await import('undici');",
        "import h2 from 'node:http2';",
        "import dgram from 'dgram';",
        "import { createRequire } from 'node:module';",
        'const req = createRequire(import.meta.url);',
      ]) expect(net.test(line), line).toBe(true);
      // what the plane legitimately imports stays clean
      for (const line of [
        "import * as fs from 'node:fs';",
        "import * as path from 'node:path';",
        "import { createHash } from 'node:crypto';",
        "import { stableStringify } from '../report.js';",
        "import { z } from 'zod/v3';",
        "const internet = 'net';",
        "// the network is never touched here",
      ]) expect(net.test(line), line).toBe(false);
    }
    // the candidate, while it exists, must actually carry the rows (a candidate that lost them would skip every check above)
    if (fs.existsSync(candidatePath)) expect(stackPlaneCovered(blueprints[1]!)).toBe(true);
  });

  it('GATE: the engine gates its own tree GREEN (full sweep, AST extractor)', () => {
    const result = runGate(ROOT, path.join(ROOT, '.blueprints'), null, 'ast', 'blueprint-conformance/bce');
    expect(result.blueprintsDiscovered).toBeGreaterThanOrEqual(1);
    expect(result.blueprintsSelected).toBe(result.blueprintsDiscovered);
    expect(result.failed, JSON.stringify(result.reports.flatMap((r) => r.violations), null, 2)).toBe(false);
    for (const r of result.reports) expect(r.score).toBe(100);
  });

  it('TEETH: every self-blueprint constraint is refutable — no trivially-green, no indeterminate', () => {
    const bp = loadBlueprint();
    const cfg = resolveExtraction(bp.extraction, bp.constraints);
    const graph = makeExtractor('ast', cfg).extract(ROOT, 'selftest');
    const teeth = assessTeeth(bp, graph, 'plugin-surface');
    // The graph-level proof remains explicit: these classes use synthetic evidence here.
    // classes, so with zero extractor-real teeth its honest verdict is `evaluator-refutable`
    // (refutable in principle, exit-0 class). The property this test guards is unchanged: NOTHING
    // is trivially-green or indeterminate.
    expect(teeth.verdict).toBe('evaluator-refutable');
    const nonRefutable = teeth.witnesses.filter(
      (w) => w.verdict !== ConstraintTeeth.TOOTHED && w.verdict !== ConstraintTeeth.EVALUATOR_REFUTABLE,
    );
    expect(nonRefutable, JSON.stringify(nonRefutable, null, 2)).toEqual([]);
  });

  it('EXTRACTOR TEETH: every constraint is killed by one separately materialized real source mutation', () => {
    const bp = loadBlueprint();
    const report = assessExtractorTeethCorpus({ blueprint: bp, repoDir: ROOT, manifest: EXTRACTOR_TEETH_MANIFEST, extractor: 'ast' });
    expect(report.verdict, JSON.stringify(report.cases.filter((entry) => entry.status !== 'killed'), null, 2)).toBe('extractor-real-proven');
    expect(report.mapped).toBe(bp.constraints.length);
    expect(report.killed).toBe(bp.constraints.length);
    expect(report.survived).toBe(0);
    expect(report.refused).toBe(0);
    expect(report.inputBindings.extractorIdentity).toBe('bce-ast:ts-morph@28.0.0');
  }, EXTRACTOR_TEETH_TIMEOUT_MS);
});

describe('teeth: forbiddenDependency reddening mutation respects scopePaths (self-hosting regression)', () => {
  const emptyGraph: ArchitectureGraph = {
    schemaVersion: '1',
    ctRepoRevision: 'test',
    components: [],
    guardEdges: [],
    coverage: { scannedFiles: [], unsupported: [] } as ArchitectureGraph['coverage'],
  };

  function scopedBp(scopePaths: string[]): EngineeringBlueprint {
    return parseBlueprint({
      apiVersion: 'blueprint-conformance/v1alpha1',
      kind: 'EngineeringBlueprint',
      metadata: { id: 'scoped-dep', version: '1.0.0', status: 'approved' },
      intentRefs: ['test'],
      scope: { repositories: ['example-org/example'] },
      architecture: { components: [], relationships: [] },
      constraints: [
        {
          id: 'scoped-forbidden-dep',
          type: 'forbiddenDependency',
          severity: 'critical',
          from: '*',
          to: 'forbidden-module',
          scopePaths,
        },
      ],
      evidenceRequirements: [],
      approvals: [],
      extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 },
    });
  }

  it('a scopePaths-narrowed forbiddenDependency is refutable — EVALUATOR_REFUTABLE, never TRIVIALLY_GREEN (the historical regression)', () => {
    // Discriminating: with the historical 'teeth:injected' evidenceRef this witness was
    // TRIVIALLY_GREEN (the synthetic edge's from-file matched no scope glob, so the oracle
    // never reddened) — the fix injects at a concrete in-scope path instead. The honesty split
    // grades the flip EVALUATOR_REFUTABLE (synthetic evidence); the regression this guards is
    // the false TRIVIALLY_GREEN, which must never return.
    const teeth = assessTeeth(scopedBp(['src/deep/**/*.ts', 'src/other.ts']), emptyGraph, 'plugin-surface');
    expect(teeth.witnesses[0].verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
    expect(teeth.witnesses[0].verdict).not.toBe(ConstraintTeeth.TRIVIALLY_GREEN);
  });

  it('an unscoped forbiddenDependency grades the same class (no behavior change on the historical path)', () => {
    const teeth = assessTeeth(scopedBp([]), emptyGraph, 'plugin-surface');
    expect(teeth.witnesses[0].verdict).toBe(ConstraintTeeth.EVALUATOR_REFUTABLE);
  });
});
