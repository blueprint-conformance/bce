import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { compileBlueprint, compileLegacyDependencies, verifyCompilerProof, COMPILER_PASSES } from '../src/compiler/compile.js';
import { compilerDigest, stableStringify } from '../src/compiler/canonical.js';
import { runCompilerPass, validatePassPipeline } from '../src/compiler/pass-manager.js';
import { EngineeringBlueprintSchema, ConstraintTypeSchema, constraintEvidenceClass } from '../src/schema.js';
import type { EngineeringBlueprint, ExtractionProfile } from '../src/schema.js';
import type { ArchitectureGraph } from '../src/graph.js';
import type { CompileResult, CompilerPassDescriptor, PassReceipt, ObservationEvidence } from '../src/compiler/ir.js';
import { evaluate } from '../src/report.js';
import { makeExtractor } from '../src/extractor-registry.js';
import { resolveExtraction } from '../src/extractors.js';
import { finalizeStackManifest } from '../src/stack/stack-manifest.js';
import { COMPILER_ENGINE_VERSION, semverLt } from '../src/compiler/version.js';

const directories: string[] = [];
afterAll(() => directories.forEach(path => rmSync(path, { recursive: true, force: true })));
function blueprint(): EngineeringBlueprint {
  return EngineeringBlueprintSchema.parse({ apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: 'compiler-slice', version: '0.1.0', status: 'draft' }, intentRefs: ['intent/dependency-boundary'],
    scope: { repositories: ['example/repo'], paths: ['src/**/*.ts'] }, architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-sdk', type: 'forbiddenDependency', severity: 'high', to: 'package:sample-sdk', scopePaths: ['src/**'] }],
    evidenceRequirements: [], approvals: [], minEngineVersion: '0.3.0',
    extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.ts'], minFiles: 1 },
  });
}
function graph(): ArchitectureGraph {
  return { schemaVersion: '1', ctRepoRevision: 'source-revision',
    components: [{ id: 'module:src/main.ts', type: 'typescriptModule', path: 'src/main.ts', line: 1 }],
    guardEdges: [], coverage: { extractor: 'ast', filesScanned: 1, unsupported: ['direct imports only'], scannedFiles: ['src/main.ts'] } };
}
function compiled(value: CompileResult): Extract<CompileResult, { status: 'compiled' }> {
  expect(value.status).toBe('compiled');
  if (value.status !== 'compiled') throw new Error(JSON.stringify(value));
  return value;
}
function realTree(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'bce-compiler-'));
  directories.push(root); mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.ts'), source);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { 'sample-sdk': '1.0.0' } }));
  return root;
}

describe('experimental compiler vertical slice', () => {
  it('runs a real provider through all IRs and the existing evaluator for green, red and uncertain cases', () => {
    for (const [source, status, legacy] of [
      ['export const value = 1;\n', 'pass', 'pass'],
      ["import sdk from 'sample-sdk';\nexport const value = sdk;\n", 'fail', 'fail'],
      ["const target = './unknown';\nvoid import(target);\n", 'indeterminate', 'fail'],
    ] as const) {
      const bp = blueprint(); const cfg = resolveExtraction(bp.extraction, bp.constraints);
      const facts = makeExtractor('ast', cfg).extract(realTree(source), 'same-revision');
      const result = compiled(compileBlueprint(bp, facts, cfg.profile));
      expect(result.verdict.verdict).toBe(status);
      expect(evaluate(bp, facts, cfg.profile).verdict).toBe(legacy);
      expect(evaluate(bp, facts, cfg.profile).violations).toEqual(result.verdict.outcomes.flatMap(outcome =>
        outcome.diagnostics.map(d => d.legacyViolation)));
      expect(result.manifest.passes.map(receipt => receipt.pass.id)).toEqual(COMPILER_PASSES.map(pass => pass.id));
      expect(result.plan.predicates[0]?.kind).toBe('NoEdge');
      expect(result.plan.predicates[0]?.source.pointer).toBe('/constraints/0');
      expect(verifyCompilerProof(result)).toBe(true);
      if (status !== 'pass') expect(result.proof.links[0]?.factSource.pointer).toMatch(/^\/(guardEdges|coverage\/unresolvedImports)\/0$/);
    }
  });

  it('losslessly preserves authored extensions, exact source bytes, coverage and caller ownership', () => {
    const bp = blueprint(); bp.metadata.extra = { note: 'retained', values: [3, 1] };
    const facts = graph(); facts.coverage.unresolvedEgress = [{ callee: 'request', ref: 'src/main.ts#L7' }];
    const sourceText = JSON.stringify(bp, null, 4) + '\n';
    const result = compiled(compileBlueprint(bp, facts, 'typescript-module-graph', { sourceRef: 'policy.json', sourceText }));
    expect(result.source.artifact).toEqual(bp); expect(result.source.sourceText).toBe(sourceText);
    expect(result.facts.staticAst.graph).toEqual(facts);
    expect(result.source.artifact).not.toBe(bp); expect(result.facts.staticAst.graph).not.toBe(facts);
    expect(Object.isFrozen(bp)).toBe(false); expect(Object.isFrozen(result.source.artifact.metadata)).toBe(true);
    bp.metadata.id = 'caller-mutation'; facts.guardEdges.push({ from: 'x', to: 'y', type: 'imports', evidenceRef: 'x#L1' });
    expect(result.source.artifact.metadata.id).toBe('compiler-slice'); expect(result.facts.staticAst.graph.guardEdges).toHaveLength(0);
    expect(verifyCompilerProof(result)).toBe(true);
  });

  it('binds supplemental declared-stack and observation envelopes without pretending to grade them', () => {
    const bp = blueprint(); const facts = graph();
    const manifest = finalizeStackManifest({ schemaVersion: '1', kind: 'StackManifest', ctRepoRevision: 'source-revision',
      nodes: [], edges: [], sources: [], runtime: { node: { declared: null, resolvedFrom: null, pin: false } }, images: [], unmodeled: [], rootDeclared: [],
      coverage: { filesScanned: 0, unsupported: [] } });
    const stack = { manifest, facts: { schemaVersion: '1' as const, kind: 'DeclaredStackFacts' as const, provider: 'selected-stack-v1' as const,
      ctRepoRevision: 'source-revision', manifestDigest: manifest.manifestDigest, sourceConfigDigest: 'a'.repeat(64), inventory: [],
      domains: { packages: 'not-selected' as const, images: 'not-selected' as const, runtime: 'not-selected' as const, closure: 'not-selected' as const }, limitations: [] }, refusals: [] };
    const observation: ObservationEvidence = { schemaVersion: '1',
      binding: { revision: 'source-revision', sourceTreeHash: 'b'.repeat(64), artifactHash: 'c'.repeat(64),
        probeDefinitionHash: 'd'.repeat(64), stimulusSetHash: 'e'.repeat(64), environmentId: 'fixture' },
      collector: { name: 'fixture-observer', version: '1' }, probeDefinition: { extra: 'kept' }, stimuli: [{ id: 'one' }],
      observations: [{ id: 'behavior:example:one', type: 'behaviorObservation', path: 'hash|1', line: 1 }], extra: ['retained'] };
    const result = compiled(compileBlueprint(bp, facts, 'typescript-module-graph', { declaredStack: stack, observations: observation }));
    expect(result.facts.declaredStack).toEqual(stack); expect(result.facts.behaviorObservation.envelope).toEqual(observation);
    expect(result.facts.behaviorObservation.claim).toBe('supplied-observations-not-reverified');
    expect(verifyCompilerProof(result)).toBe(true);
    const mutated = structuredClone(result); mutated.facts.behaviorObservation.envelope!.extra = ['changed'];
    expect(verifyCompilerProof(mutated)).toBe(false);
  });

  it('is deterministic, binds all layer digests and rejects fabricated observations or receipts', () => {
    const bp = blueprint(); const facts = graph();
    facts.guardEdges.push({ from: 'module:src/main.ts', to: 'package:sample-sdk', type: 'imports', evidenceRef: 'src/main.ts#L1' });
    const result = compiled(compileBlueprint(bp, facts, 'typescript-module-graph'));
    expect(stableStringify(result)).toBe(stableStringify(compileBlueprint(bp, facts, 'typescript-module-graph')));
    expect(result.proof.factDigest).toBe(compilerDigest(result.facts));
    for (const mutate of [
      (value: typeof result) => { value.verdict.outcomes[0]!.diagnostics[0]!.factSource.pointer = '/guardEdges/999'; },
      (value: typeof result) => { value.manifest.passes[0]!.inputDigest = '0'.repeat(64); },
      (value: typeof result) => { value.source.artifact.constraints[0]!.to = 'package:other'; },
      (value: typeof result) => { value.proof.rootDigest = '0'.repeat(64); },
    ]) { const changed = structuredClone(result); mutate(changed); expect(verifyCompilerProof(changed)).toBe(false); }
    expect(verifyCompilerProof(null as never)).toBe(false);
    const cyclic = structuredClone(result); (cyclic.source.artifact.metadata as Record<string, unknown>).cycle = cyclic;
    expect(verifyCompilerProof(cyclic)).toBe(false);
  });

  it('refuses capabilities and deferred families instead of manufacturing an authoritative pass', () => {
    const bp = blueprint(); const facts = graph();
    const missing = compiled(compileBlueprint(bp, facts, 'typescript-module-graph', { capabilities: ['static.edges'] }));
    expect(missing.verdict.verdict).toBe('refused'); expect(missing.plan.predicates).toHaveLength(0);
    expect(missing.verdict.refusals[0]?.code).toBe('missing-capability'); expect(verifyCompilerProof(missing)).toBe(true);
    facts.coverage.extractor = 'line-scan';
    expect(compiled(compileBlueprint(bp, facts, 'typescript-module-graph')).verdict.verdict).toBe('refused');
    // Compatibility frontend deliberately retains evaluate's supplied-graph behavior.
    expect(evaluate(bp, facts, 'typescript-module-graph').verdict).toBe('pass');
    facts.coverage.extractor = 'ast';
    facts.coverage.filesScanned = 0;
    expect(compileBlueprint(bp, facts, 'typescript-module-graph').status).toBe('refused');
    expect(evaluate(bp, facts, 'typescript-module-graph').verdict).toBe('pass');
    facts.coverage.filesScanned = 1;
    bp.constraints.push({ id: 'legacy-owned', type: 'requiredComponent', severity: 'high', component: 'typescriptModule' });
    const mixed = compiled(compileBlueprint(bp, facts, 'typescript-module-graph'));
    expect(mixed.verdict.verdict).toBe('refused'); expect(mixed.verdict.outcomes[0]?.status).toBe('pass');
    expect(mixed.verdict.outcomes[1]?.status).toBe('refused'); expect(evaluate(bp, facts, 'typescript-module-graph').verdict).toBe('pass');
  });

  it('refuses unknown versions, profiles, malformed input and unrelated exact source text', () => {
    const bp = blueprint(); const facts = graph();
    for (const result of [
      compileBlueprint(bp, facts, 'typescript-module-graph', { irVersion: 'future' }),
      compileBlueprint(bp, { ...facts, schemaVersion: '2' } as never, 'typescript-module-graph'),
      compileBlueprint({ ...bp, apiVersion: 'future' } as never, facts),
      compileBlueprint(bp, facts, 'future' as ExtractionProfile),
    ]) { expect(result.status).toBe('refused'); if (result.status === 'refused') expect(result.refusals[0]?.code).toBe('unsupported-version'); }
    for (const result of [compileBlueprint(bp, facts, undefined, { sourceText: '{}' }),
      compileBlueprint(bp, facts, undefined, { sourceText: '{' }), compileBlueprint(null as never, facts),
      compileBlueprint(bp, { ...facts, guardEdges: null } as never),
      compileBlueprint({ ...bp, constraints: [{ id: 'bad', type: 'unknown', severity: 'high' }] } as never, facts),
    ]) expect(result.status).toBe('refused');
  });

  it('refuses exotic, unsafe-key, accessor and nonfinite payloads that cannot be losslessly bound', () => {
    for (const extra of [new Date(), new Map([['key', 1]]), new Set([1]), Infinity,
      JSON.parse('{"__proto__":{"hidden":1}}'), Object.defineProperty({}, 'secret', { enumerable: true, get() { throw new Error('must not execute'); } }),
    ]) {
      const bp = blueprint(); bp.metadata.extra = extra;
      expect(compileBlueprint(bp, graph()).status).toBe('refused');
    }
    const result = compiled(compileBlueprint(blueprint(), graph()));
    const changed = structuredClone(result); changed.source.artifact.metadata.extra = JSON.parse('{"__proto__":{"hidden":2}}');
    expect(verifyCompilerProof(changed)).toBe(false);
    for (const artifact of ['manifest', 'proof'] as const) {
      const collision = structuredClone(result);
      Object.defineProperty(collision[artifact], '__proto__', { enumerable: true, value: { hidden: 1 } });
      expect(stableStringify(collision)).toBe(stableStringify(result));
      expect(verifyCompilerProof(collision)).toBe(false);
    }
    const sparse = blueprint(); sparse.metadata.extra = Array(1); expect(compileBlueprint(sparse, graph()).status).toBe('refused');
    const nonIndex = [1]; Object.defineProperty(nonIndex, 'extra', { enumerable: true, value: 2 });
    const arrayBp = blueprint(); arrayBp.metadata.extra = nonIndex; expect(compileBlueprint(arrayBp, graph()).status).toBe('refused');
    const sparseWithKey = Array(1); sparseWithKey.extra = 'ignored';
    const sparseKeyBp = blueprint(); sparseKeyBp.metadata.extra = sparseWithKey; expect(compileBlueprint(sparseKeyBp, graph()).status).toBe('refused');
    const textBp = blueprint(); const raw = JSON.parse(JSON.stringify(textBp));
    Object.defineProperty(raw.metadata, '__proto__', { enumerable: true, value: { hidden: 1 } });
    expect(compileBlueprint(textBp, graph(), undefined, { sourceText: JSON.stringify(raw) }).status).toBe('refused');
    let reads = 0;
    const accessorBp = blueprint(); Object.defineProperty(accessorBp, 'apiVersion', { enumerable: true, get() { reads++; return 'blueprint-conformance/v1alpha1'; } });
    expect(compileBlueprint(accessorBp, graph()).status).toBe('refused'); expect(reads).toBe(0);
    const accessorOptions = Object.defineProperty({}, 'declaredStack', { enumerable: true, get() { reads++; return null; } });
    expect(compileBlueprint(blueprint(), graph(), undefined, accessorOptions).status).toBe('refused'); expect(reads).toBe(0);
  });

  it('infers authored profile and refuses contradictions instead of relaxing module wildcard semantics', () => {
    const bp = blueprint(); bp.constraints[0]!.to = 'module:src/private/**';
    const facts = graph(); facts.guardEdges.push({ from: 'module:src/main.ts', to: 'module:src/private/helper.ts', type: 'imports', evidenceRef: 'src/main.ts#L1' });
    expect(compiled(compileBlueprint(bp, facts)).verdict.verdict).toBe('fail');
    expect(compileBlueprint(bp, facts, 'plugin-surface').status).toBe('refused');
    expect(evaluate(bp, facts, 'plugin-surface').verdict).toBe('pass');
  });

  it('honors declared version and file-count floors while preserving legacy report mutability', () => {
    const bp = blueprint(); const facts = graph();
    bp.minEngineVersion = '99.0.0';
    const future = compileBlueprint(bp, facts); expect(future.status).toBe('refused');
    if (future.status === 'refused') expect(future.refusals[0]?.code).toBe('unsupported-version');
    expect(evaluate(bp, facts, 'typescript-module-graph').verdict).toBe('pass');
    bp.minEngineVersion = '0.3.0'; bp.extraction!.minFiles = 2;
    const incomplete = compileBlueprint(bp, facts); expect(incomplete.status).toBe('refused');
    if (incomplete.status === 'refused') expect(incomplete.refusals[0]?.code).toBe('missing-capability');
    expect(evaluate(bp, facts, 'typescript-module-graph').verdict).toBe('pass');
    bp.extraction!.minFiles = 1;
    facts.guardEdges.push({ from: 'module:src/main.ts', to: 'package:sample-sdk', type: 'imports', evidenceRef: 'src/main.ts#L1' });
    const report = evaluate(bp, facts, 'typescript-module-graph'); expect(Object.isFrozen(report.violations[0])).toBe(false);
    report.violations[0]!.observed = 'consumer annotation'; expect(report.violations[0]!.observed).toBe('consumer annotation');
    expect(compiled(compileBlueprint(bp, facts)).verdict.outcomes[0]?.diagnostics[0]?.legacyViolation.observed).not.toBe('consumer annotation');
  });

  it('retains all declared constraint families and evidence planes honestly in PolicyIR', () => {
    // Legacy frontend inventories the full enum without claiming these incomplete fixture arms are authorable.
    const bp = blueprint(); bp.constraints = ConstraintTypeSchema.options.map(type => ({ id: type, type, severity: 'high' }));
    const result = compiled(compileLegacyDependencies(bp, graph(), 'typescript-module-graph'));
    expect(result.policy.constraints.map(c => c.authored.type)).toEqual(ConstraintTypeSchema.options);
    expect(result.policy.constraints.map(c => c.evidencePlane)).toEqual(ConstraintTypeSchema.options.map(constraintEvidenceClass));
    expect(result.verdict.verdict).toBe('refused'); expect(result.policy.constraints.every(c => c.kind === 'deferred')).toBe(true);
  });
});

describe('fixed pure compiler passes', () => {
  const pass: CompilerPassDescriptor = { id: 'one', version: '1', inputSchema: 'Input/1', outputSchema: 'Output/1', dependencies: [], requiredCapabilities: [] };
  it('rejects duplicate, empty, future, missing and cyclic pass declarations plus reversed execution order', () => {
    expect(validatePassPipeline(COMPILER_PASSES)).toEqual([]);
    for (const invalid of [[pass, pass], [{ ...pass, id: '' }], [{ ...pass, version: '2' } as never],
      [{ ...pass, dependencies: ['missing'] }],
      [{ ...pass, dependencies: ['two'] }, { ...pass, id: 'two', dependencies: ['one'] }],
      [{ ...pass, id: 'two', dependencies: ['one'] }, pass],
    ]) expect(validatePassPipeline(invalid).length).toBeGreaterThan(0);
  });
  it('hashes an immutable snapshot before execution, preserving caller ownership', () => {
    const input = { values: [1] }; const receipts: PassReceipt[] = [];
    const output = runCompilerPass({ ...pass, run: (value: typeof input) => ({ count: value.values.length }) }, input, receipts);
    expect(output.count).toBe(1); expect(receipts[0]?.inputDigest).toBe(compilerDigest(input)); expect(Object.isFrozen(input)).toBe(false);
    expect(() => runCompilerPass({ ...pass, run: (value: typeof input) => { value.values.push(2); return value; } }, input, [])).toThrow();
    expect(input.values).toEqual([1]);
  });
  it('keeps compiler runtime imports closed over pure modules', () => {
    const directory = join(import.meta.dirname, '../src/compiler');
    for (const file of readdirSync(directory).filter(file => file.endsWith('.ts'))) {
      const text = readFileSync(join(directory, file), 'utf8');
      expect(text, relative(directory, file)).not.toMatch(/\b(?:Date\.now|Math\.random|process\.env|process\.exit|fetch\s*\(|execFile|readFile|writeFile)\b/);
      const imports = [...text.matchAll(/^import(?!\s+type\b).*?from\s+['"]([^'"]+)['"]/gm)].map(match => match[1]);
      expect(imports.every(specifier => specifier === 'node:crypto' || specifier === 'zod/v3' || specifier === '../schema.js' || specifier?.startsWith('./'))).toBe(true);
    }
  });
  it('binds the pure reader identity to the actual package version and retains numeric comparison semantics', () => {
    expect(COMPILER_ENGINE_VERSION).toBe(JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version);
    expect(semverLt('0.5.0', '0.10.0')).toBe(true); expect(semverLt('0.5.0', '0.5.0')).toBe(false);
    expect(semverLt('1', '1.0.1')).toBe(true);
  });
});
