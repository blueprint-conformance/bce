import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseBlueprint } from '../src/schema.js';
import { resolveExtraction } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { evaluate } from '../src/report.js';
import { createEvidenceBundle, verifyEvidenceBundle } from '../src/evidence-bundle.js';

const ROOT = path.join(__dirname, '..');

describe('self-contained evidence bundle', () => {
  function bundle() {
    const blueprint = parseBlueprint(JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/luna-chat-extension.blueprint.json'), 'utf8')));
    const cfg = resolveExtraction(blueprint.extraction, blueprint.constraints);
    const graph = makeExtractor('ast', cfg).extract(path.join(ROOT, 'fixtures/extension-surface/conformant'), 'fixture');
    const report = evaluate(blueprint, graph, cfg.profile);
    return createEvidenceBundle({ blueprint, graph, report, engineVersion: '0.1.0', command: 'test', extractionProfile: cfg.profile });
  }

  it('re-hashes and re-evaluates all bundled artifacts while declining authenticity claims', () => {
    expect(verifyEvidenceBundle(bundle())).toEqual({ valid: true, integrity: 'verified', authenticity: 'not-established', failures: [] });
  });

  it.each(['blueprint', 'graph', 'report'] as const)('detects %s tampering', (part) => {
    const b = bundle();
    if (part === 'blueprint') b.artifacts.blueprint.metadata.name = 'tampered';
    if (part === 'graph') b.artifacts.graph.ctRepoRevision = 'tampered';
    if (part === 'report') b.artifacts.report.score = 7;
    const result = verifyEvidenceBundle(b);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toContain(part);
  });
});
