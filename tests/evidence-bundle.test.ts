import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseBlueprint } from '../src/schema.js';
import { resolveExtraction } from '../src/extractors.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { evaluate, stableStringify } from '../src/report.js';
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
    const evidence = bundle();
    expect(evidence.toolchain).toMatchObject({
      engine: { name: 'bce-engine', version: '0.1.0' },
      dependencyLock: { file: 'npm-shrinkwrap.json', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) },
      runtime: { node: process.versions.node, npm: expect.any(String), platform: process.platform, arch: process.arch },
      extractor: { kind: 'ast', profile: 'plugin-surface', provider: 'typescript-ts-morph', version: '0.1.0' },
    });
    expect(verifyEvidenceBundle(evidence)).toEqual({ valid: true, integrity: 'verified', authenticity: 'not-established', failures: [] });
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

  // Re-hash a tampered v1 bundle completely, so only a consistency check can refuse it.
  const rehash = (b: ReturnType<typeof bundle>) => {
    const sha = (v: unknown) => createHash('sha256').update(stableStringify(v)).digest('hex');
    b.hashes.report = sha(b.artifacts.report);
    const { bundle: ignored, ...artifactHashes } = b.hashes;
    void ignored;
    b.hashes.bundle = sha({ ...b, hashes: artifactHashes });
    return b;
  };

  it('refuses a v1 bundle graded under a profile other than the blueprint declares', () => {
    const b = bundle();
    const wrong = 'typescript-module-graph' as const;
    b.invocation.extractionProfile = wrong;
    b.toolchain.extractor.profile = wrong;
    b.artifacts.report = evaluate(b.artifacts.blueprint, b.artifacts.graph, wrong);
    const result = verifyEvidenceBundle(rehash(b));
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('extraction profile mismatch');
  });

  it('refuses a v1 bundle whose toolchain disagrees with its envelope', () => {
    const b = bundle();
    b.engine = { ...b.engine, version: '9.9.9' };
    const result = verifyEvidenceBundle(rehash(b));
    expect(result.valid).toBe(false);
    expect(result.failures).toContain('toolchain identity mismatch');
  });

  it('CLI emits and independently verifies a portable bundle', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-bundle-'));
    const out = path.join(dir, 'bundle.json');
    const run = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/cli.ts'), 'run',
      '--blueprint', path.join(ROOT, 'fixtures/luna-chat-extension.blueprint.json'), '--ct-repo',
      path.join(ROOT, 'fixtures/extension-surface/conformant'), '--no-pin', '--out', path.join(dir, 'report.json'),
      '--emit-bundle', out], { encoding: 'utf8' });
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    const verify = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'src/cli.ts'), 'verify-bundle', '--bundle', out], { encoding: 'utf8' });
    expect(verify.status, `${verify.stdout}${verify.stderr}`).toBe(0);
    expect(JSON.parse(verify.stdout)).toMatchObject({ valid: true, authenticity: 'not-established' });
  });

  it('returns a typed failure for a structurally malformed JSON object', () => {
    const result = verifyEvidenceBundle({} as never);
    expect(result).toMatchObject({ valid: false, integrity: 'failed', authenticity: 'not-established' });
    expect(result.failures.join(' ')).toContain('malformed bundle');
  });
});
