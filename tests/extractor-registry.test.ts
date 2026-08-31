/**
 * The extractor-registry verdict-stability proof (B1-WO-01): routing the TypeScript profiles
 * through the profile-aware registry front door produces facts DEEPLY IDENTICAL to the legacy
 * kind-only constructor — the seam refactor changes NOTHING for TS-only trees. Plus the
 * registry's dispatch contract: python routes to its single provider under either kind flag,
 * and an unregistered profile fails LOUD.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint, type EngineeringBlueprint } from '../src/schema.js';
import {
  AstExtractor,
  LineScanExtractor,
  resolveExtraction,
  makeExtractor as legacyMakeExtractor,
  type ResolvedExtraction,
} from '../src/extractors.js';
import { makeExtractor, EXTRACTOR_PROVIDERS } from '../src/extractor-registry.js';
import { PythonImportExtractor } from '../src/python-extractor.js';
import { evaluate } from '../src/report.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const readBp = (f: string): EngineeringBlueprint =>
  parseBlueprint(JSON.parse(fs.readFileSync(path.join(FIXROOT, f), 'utf8')));

const luna = readBp('luna-chat-extension.blueprint.json');
const lunaCfg = resolveExtraction(luna.extraction, luna.constraints);
const routeGuard = readBp('route-guard.blueprint.json');
const routeCfg = resolveExtraction(routeGuard.extraction, routeGuard.constraints);

describe('verdict stability — registry vs legacy constructor, byte-identical TS facts', () => {
  const cases: Array<{ label: string; cfg: ResolvedExtraction; tree: string; bp: EngineeringBlueprint }> = [
    { label: 'plugin-surface conformant', cfg: lunaCfg, tree: 'extension-surface/conformant', bp: luna },
    { label: 'plugin-surface drift', cfg: lunaCfg, tree: 'extension-surface/drift-forbidden-import', bp: luna },
  ];

  for (const kind of ['ast', 'line-scan'] as const) {
    for (const { label, cfg, tree, bp } of cases) {
      it(`${kind} / ${label}: identical graph AND identical report`, () => {
        const dir = path.join(FIXROOT, tree);
        const viaRegistry = makeExtractor(kind, cfg).extract(dir, 'stability');
        const viaLegacy = legacyMakeExtractor(kind, cfg).extract(dir, 'stability');
        expect(viaRegistry).toEqual(viaLegacy);
        expect(evaluate(bp, viaRegistry, cfg.profile)).toEqual(evaluate(bp, viaLegacy, cfg.profile));
      });
    }
  }

  it('returns the exact legacy classes for the TS profiles', () => {
    expect(makeExtractor('ast', lunaCfg)).toBeInstanceOf(AstExtractor);
    expect(makeExtractor('line-scan', lunaCfg)).toBeInstanceOf(LineScanExtractor);
    expect(makeExtractor('ast', routeCfg)).toBeInstanceOf(AstExtractor);
    expect(makeExtractor('line-scan', routeCfg)).toBeInstanceOf(LineScanExtractor);
  });
});

describe('registry dispatch contract', () => {
  it('python-import-surface routes to PythonImportExtractor under EITHER kind flag (disclosed kindNote)', () => {
    const py = readBp('python-service.blueprint.json');
    const cfg = resolveExtraction(py.extraction, py.constraints);
    expect(makeExtractor('ast', cfg)).toBeInstanceOf(PythonImportExtractor);
    expect(makeExtractor('line-scan', cfg)).toBeInstanceOf(PythonImportExtractor);
    const row = EXTRACTOR_PROVIDERS.find((p) => p.profiles.includes('python-import-surface'));
    expect(row?.kindNote).toContain('inert');
  });

  it('an unregistered profile fails LOUD (enum and registry must move together)', () => {
    const bogus = { ...lunaCfg, profile: 'no-such-profile' as never };
    expect(() => makeExtractor('ast', bogus)).toThrow(/no extractor provider registered/);
  });

  it('every ExtractionProfile enum value has exactly one registry row', () => {
    const profiles = ['next-route-handler', 'plugin-surface', 'python-import-surface'] as const;
    for (const p of profiles) {
      expect(EXTRACTOR_PROVIDERS.filter((r) => r.profiles.includes(p)).length, p).toBe(1);
    }
  });
});
