/**
 * Cross-profile determinism + verdict-stability properties (B2-WO-05).
 *
 * For a representative fixture×blueprint set spanning ALL FOUR live surfaces (extension,
 * egress, route, python — the behavior surface's merge path has its own determinism proof in
 * its suite):
 *  (a) two independent extract+evaluate runs are DEEPLY identical (full structures, not
 *      lengths — a length compare would miss a reordered array);
 *  (b) stableStringify(report) is BYTE-identical across runs (the serialization contract);
 *  (c) file-creation-order independence: the same tree materialized in reverse directory-
 *      entry order extracts to an identical graph (the sorted-arrays contract, proven from
 *      the outside rather than trusted);
 *  (d) registry↔legacy agreement on the TS profiles extends to the egress + route fixtures
 *      (the registry stability test covers the extension surface; this closes the rest).
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import { resolveExtraction, makeExtractor as legacyMakeExtractor } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { evaluate, stableStringify } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

interface Case {
  label: string;
  tree: string;
  blueprintFile: string;
}
const CASES: Case[] = [
  { label: 'extension', tree: 'extension-surface/conformant', blueprintFile: 'luna-chat-extension.blueprint.json' },
  { label: 'extension-drift', tree: 'extension-surface/drift-forbidden-import', blueprintFile: 'luna-chat-extension.blueprint.json' },
  { label: 'egress', tree: 'egress-surface/conformant-houseidiom', blueprintFile: 'egress-reader.blueprint.json' },
  { label: 'egress-drift', tree: 'egress-surface/drift-egress-provider-houseidiom', blueprintFile: 'egress-reader.blueprint.json' },
  { label: 'route', tree: 'route-surface/conformant-guarded', blueprintFile: 'route-guard.blueprint.json' },
  { label: 'route-drift', tree: 'route-surface/drift-missing-guard', blueprintFile: 'route-guard.blueprint.json' },
  { label: 'python', tree: 'python-surface/conformant', blueprintFile: 'python-service.blueprint.json' },
  { label: 'python-drift', tree: 'python-surface/drift-forbidden-import', blueprintFile: 'python-service.blueprint.json' },
];

const load = (c: Case): { bp: EngineeringBlueprint; cfg: ReturnType<typeof resolveExtraction> } => {
  const bp = parseBlueprint(JSON.parse(fs.readFileSync(path.join(FIXROOT, c.blueprintFile), 'utf8')));
  return { bp, cfg: resolveExtraction(bp.extraction, bp.constraints) };
};

/**
 * Re-materialize a tree with directory entries CREATED in reverse-sorted order — same bytes,
 * different creation order. If any output array's order leaked from readdir order instead of
 * the sorted contract, the graphs would differ.
 */
function copyTreeReversed(src: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-det-'));
  tempDirs.push(tmp);
  const walk = (from: string, to: string): void => {
    fs.mkdirSync(to, { recursive: true });
    const entries = fs.readdirSync(from, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? 1 : -1));
    for (const e of entries) {
      const f = path.join(from, e.name);
      const t = path.join(to, e.name);
      if (e.isDirectory()) walk(f, t);
      else fs.writeFileSync(t, fs.readFileSync(f));
    }
  };
  walk(src, tmp);
  return tmp;
}

describe('determinism + verdict-stability properties across all four live surfaces', () => {
  for (const c of CASES) {
    const { bp, cfg } = load(c);
    const dir = path.join(FIXROOT, c.tree);

    it(`${c.label}: two runs are deeply identical AND byte-identical under stableStringify`, () => {
      const g1 = makeExtractor('ast', cfg).extract(dir, 'det');
      const g2 = makeExtractor('ast', cfg).extract(dir, 'det');
      expect(g2).toEqual(g1);
      const r1 = evaluate(bp, g1, cfg.profile);
      const r2 = evaluate(bp, g2, cfg.profile);
      expect(r2).toEqual(r1);
      expect(stableStringify(r2)).toBe(stableStringify(r1));
    });

    it(`${c.label}: file-creation-order independence (reverse-materialized tree, identical graph)`, () => {
      const reversed = copyTreeReversed(dir);
      const g1 = makeExtractor('ast', cfg).extract(dir, 'det');
      const g2 = makeExtractor('ast', cfg).extract(reversed, 'det');
      expect(g2).toEqual(g1);
    });
  }

  for (const c of CASES.filter((x) => !x.label.startsWith('python'))) {
    const { bp, cfg } = load(c);
    it(`${c.label}: registry and legacy paths agree (graph AND report), both kinds`, () => {
      const dir = path.join(FIXROOT, c.tree);
      for (const kind of ['ast', 'line-scan'] as const) {
        // gate.ts refuses line-scan for egress blueprints — mirror that boundary here: the
        // agreement property for egress is ast-only (the refusal itself is tested in the gate suite).
        if (kind === 'line-scan' && cfg.egressEnabled) continue;
        const viaRegistry = makeExtractor(kind, cfg).extract(dir, 'agree');
        const viaLegacy = legacyMakeExtractor(kind, cfg).extract(dir, 'agree');
        expect(viaRegistry).toEqual(viaLegacy);
        expect(evaluate(bp, viaRegistry, cfg.profile)).toEqual(evaluate(bp, viaLegacy, cfg.profile));
      }
    });
  }
});
