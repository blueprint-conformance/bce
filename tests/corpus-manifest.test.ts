/**
 * The corpus/MANIFEST.json drift gate.
 *
 * `corpus/MANIFEST.json` is the machine-readable index of the suite-v2 seeded-defect corpus
 * (defect ids ↔ fixtures ↔ constraint types ↔ expected verdicts + the clean control set), and
 * `corpus/CORPUS-MAP.md` documents its mapping to the frozen paper corpus. An index nobody
 * verifies is an index nobody can trust — this suite pins the manifest byte-honest against the
 * live ground truth: `src/corpus.ts` (SEEDED_CORPUS) and the four corpus blueprints on disk.
 * A corpus change that forgets the manifest, or a manifest edit that invents a defect, fails CI.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SEEDED_CORPUS } from '../src/corpus.js';

const ROOT = path.join(__dirname, '..');

interface ManifestDefect {
  id: string;
  set: 'paper-baseline' | 'expansion';
  blueprintRef: string;
  fixture: string;
  constraintId: string;
  constraintType: string;
  expectedSeverity: string;
  expectedFixtureVerdict: string;
  description: string;
}

interface ManifestClean {
  fixture: string;
  blueprintRef: string;
  expectedVerdict: string;
}

interface Manifest {
  manifestVersion: number;
  suite: string;
  claim: string;
  counts: {
    defects: number;
    originalBaseline: number;
    paperFrozenCorpus: number;
    expansion: number;
    distinctSeededFixtures: number;
    cleanFixtures: number;
    reportsInRecallRun: number;
  };
  blueprints: Array<{ ref: string; file: string; profile: string }>;
  defects: ManifestDefect[];
  cleanFixtures: ManifestClean[];
}

const manifest: Manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'corpus', 'MANIFEST.json'), 'utf8'));

/** Mirrors the corpus fixture-resolution rule (corpus.test.ts / recall-e2e-proof.test.ts). */
const resolveFixture = (f: string): string =>
  f.includes('/') ? path.posix.join('fixtures', f) : path.posix.join('fixtures', 'extension-surface', f);

/** constraintId → declared constraint type, per blueprint ref, read from the fixture blueprints. */
const constraintTypeByRef = new Map<string, Map<string, string>>(
  manifest.blueprints.map((b) => {
    const bp = JSON.parse(fs.readFileSync(path.join(ROOT, b.file), 'utf8')) as {
      metadata: { id: string; version: string };
      constraints: Array<{ id: string; type: string }>;
    };
    expect(`${bp.metadata.id}@${bp.metadata.version}`).toBe(b.ref);
    return [b.ref, new Map(bp.constraints.map((c) => [c.id, c.type]))];
  }),
);

describe('corpus/MANIFEST.json mirrors SEEDED_CORPUS exactly', () => {
  it('identifies itself as suite-v2, manifestVersion 1, and states the protocol-reproduction claim', () => {
    expect(manifest.suite).toBe('suite-v2');
    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.claim).toContain('Protocol reproduction');
    expect(manifest.claim).toContain('not a byte-identical copy');
  });

  it('carries exactly the SEEDED_CORPUS defect ids, 1:1, in registry order', () => {
    expect(manifest.defects.map((d) => d.id)).toEqual(SEEDED_CORPUS.map((d) => d.id));
  });

  it('every defect row matches its SEEDED_CORPUS entry field-for-field', () => {
    for (const [i, row] of manifest.defects.entries()) {
      const src = SEEDED_CORPUS[i]!;
      expect(row.blueprintRef, row.id).toBe(src.blueprintRef);
      expect(row.fixture, row.id).toBe(resolveFixture(src.fixture));
      expect(row.constraintId, row.id).toBe(src.constraintId);
      expect(row.expectedSeverity, row.id).toBe(src.expectedSeverity);
      expect(row.description, row.id).toBe(src.description);
      expect(row.expectedFixtureVerdict, row.id).toBe('fail');
    }
  });

  it('marks exactly the first 9 registry entries as the paper-baseline set (append-only expansion)', () => {
    const baseline = manifest.defects.filter((d) => d.set === 'paper-baseline').map((d) => d.id);
    expect(baseline).toEqual(SEEDED_CORPUS.slice(0, 9).map((d) => d.id));
    for (const d of manifest.defects.slice(9)) expect(d.set, d.id).toBe('expansion');
  });

  it("every defect's constraintType matches the type its blueprint declares for that constraintId", () => {
    for (const row of manifest.defects) {
      const types = constraintTypeByRef.get(row.blueprintRef);
      expect(types, `blueprint ${row.blueprintRef} listed in manifest.blueprints`).toBeDefined();
      expect(row.constraintType, `${row.id} (${row.constraintId})`).toBe(types!.get(row.constraintId));
    }
  });

  it('counts block is arithmetically consistent with the rows', () => {
    const distinct = new Set(manifest.defects.map((d) => d.fixture)).size;
    expect(manifest.counts.defects).toBe(manifest.defects.length);
    expect(manifest.counts.defects).toBe(SEEDED_CORPUS.length);
    expect(manifest.counts.originalBaseline).toBe(manifest.defects.filter((d) => d.set === 'paper-baseline').length);
    expect(manifest.counts.expansion).toBe(manifest.counts.defects - manifest.counts.originalBaseline);
    // The paper's frozen measurement is rows 1-25, NOT the 9 originalBaseline rows — the key the
    // legend used to conflate. Pinned so the distinction cannot silently regress.
    expect(manifest.counts.paperFrozenCorpus).toBe(25);
    expect(manifest.counts.distinctSeededFixtures).toBe(distinct);
    expect(manifest.counts.cleanFixtures).toBe(manifest.cleanFixtures.length);
    expect(manifest.counts.reportsInRecallRun).toBe(distinct + manifest.cleanFixtures.length);
  });

  it('every fixture path — seeded and clean — resolves to a real directory on disk', () => {
    for (const row of [...manifest.defects, ...manifest.cleanFixtures]) {
      expect(fs.existsSync(path.join(ROOT, row.fixture)), row.fixture).toBe(true);
    }
  });

  it('clean fixtures expect pass, reference known blueprints, and are disjoint from seeded fixtures', () => {
    const seeded = new Set(manifest.defects.map((d) => d.fixture));
    for (const c of manifest.cleanFixtures) {
      expect(c.expectedVerdict, c.fixture).toBe('pass');
      expect(constraintTypeByRef.has(c.blueprintRef), c.fixture).toBe(true);
      expect(seeded.has(c.fixture), `${c.fixture} must not be both seeded and clean`).toBe(false);
    }
  });
});
