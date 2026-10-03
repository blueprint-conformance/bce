/** Experimental policy/evidence compiler. Acquisition and public rendering stay outside. */
import type { EngineeringBlueprint, ExtractionProfile } from '../schema.js';
import { constraintEvidenceClass, ExtractionProfileSchema, ValidatedEngineeringBlueprintSchema } from '../schema.js';
import { z } from 'zod/v3';
import type { ArchitectureGraph } from '../graph.js';
import { compilerDigest, stableStringify } from './canonical.js';
import { evaluateNoEdge } from './dependency.js';
import { freezeArtifact, runCompilerPass, validatePassPipeline } from './pass-manager.js';
import { COMPILER_IR_VERSION } from './ir.js';
import { COMPILER_ENGINE_VERSION, semverLt } from './version.js';
import type { Capability, CompilerOptions, CompilerPassDescriptor, CompilerRefusal, CompileResult,
  ConstraintOutcomeIR, EvaluationPlanIR, FactIR, PassReceipt, PolicyIR, PolicySourceAST, ProofIR, VerdictIR } from './ir.js';

const descriptor = (id: string, inputSchema: string, outputSchema: string,
  dependencies: string[]): CompilerPassDescriptor => Object.freeze({ id, version: '1', inputSchema,
  outputSchema, dependencies: Object.freeze(dependencies), requiredCapabilities: Object.freeze([]) });
export const COMPILER_PASSES: readonly CompilerPassDescriptor[] = Object.freeze([
  descriptor('source', 'EngineeringBlueprint+SourceMetadata/v1alpha1', 'PolicySourceAST/experimental-1', []),
  descriptor('normalize-policy', 'PolicySourceAST+ExtractionProfile/experimental-1', 'PolicyIR/experimental-1', ['source']),
  descriptor('normalize-facts', 'ArchitectureGraph+ExtractionProfile+EvidenceOptions+Adapter/1', 'FactIR/experimental-1', []),
  descriptor('lower', 'PolicyIR+FactIR/experimental-1', 'EvaluationPlanIR/experimental-1', ['normalize-policy', 'normalize-facts']),
  descriptor('evaluate', 'EvaluationPlanIR+FactIR+PolicyIR/experimental-1', 'VerdictIR/experimental-1', ['lower']),
]);

// This experimental reader admits the current graph contract, preserving passthrough fields.
const GraphInputSchema = z.object({ schemaVersion: z.literal('1'), ctRepoRevision: z.string(),
  components: z.array(z.object({ id: z.string(), type: z.string(), path: z.string(), line: z.number().int().positive() }).passthrough()),
  guardEdges: z.array(z.object({ from: z.string(), to: z.string(), type: z.string(), evidenceRef: z.string() }).passthrough()),
  coverage: z.object({ extractor: z.enum(['ast', 'line-scan']), filesScanned: z.number().int().nonnegative(), unsupported: z.array(z.string()),
    unresolvedImports: z.array(z.object({ from: z.string(), specifier: z.string(), kind: z.string(), ref: z.string(), reason: z.string() }).passthrough()).optional(),
  }).passthrough(),
}).passthrough();
const OptionsSchema = z.object({ irVersion: z.string().optional(), sourceRef: z.string().min(1).optional(),
  sourceText: z.string().optional(), capabilities: z.array(z.enum(['static.components', 'static.edges', 'static.unresolved-imports'])).optional(),
  declaredStack: z.unknown().optional(), observations: z.unknown().optional(),
}).strict();

/** Restrict the experimental boundary to finite JSON data, without invoking accessors. */
function isJsonArtifact(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || key === '__proto__') return false;
      if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return false;
      const field = descriptors[key]!;
      if (!field.enumerable || !('value' in field) || !isJsonArtifact(field.value, ancestors)) return false;
    }
    return !Array.isArray(value) || Object.keys(descriptors).length === value.length + 1;
  } finally { ancestors.delete(value); }
}

function normalizePolicy(source: PolicySourceAST, profile: ExtractionProfile): PolicyIR {
  return { version: COMPILER_IR_VERSION, sourceDigest: compilerDigest(source), profile,
    constraints: source.artifact.constraints.map((authored, index) => {
      const base = { index, source: source.constraints[index]!.source, authored, evidencePlane: constraintEvidenceClass(authored.type) };
      if (authored.type !== 'forbiddenDependency' || !authored.to) {
        return { ...base, kind: 'deferred' as const, reason: authored.type === 'forbiddenDependency'
          ? 'forbiddenDependency requires a nonempty target' : `${authored.type} remains owned by the current evaluator` };
      }
      return { ...base, kind: 'forbiddenDependency' as const, target: authored.to,
        sourceSelector: authored.from || '*', scope: authored.scopePaths ?? [],
        defaults: [...(!authored.from ? ['sourceSelector' as const] : []),
          ...(authored.scopePaths === undefined ? ['scope' as const] : [])] };
    }) };
}

function normalizeFacts(graph: ArchitectureGraph, profile: ExtractionProfile, options: CompilerOptions, legacy: boolean): FactIR {
  const supported: Capability[] = !legacy && graph.coverage.filesScanned === 0 ? [] : ['static.components', 'static.edges',
    ...(['typescript-module-graph', 'python-module-graph'].includes(profile) && (legacy || graph.coverage.extractor === 'ast')
      ? ['static.unresolved-imports' as const] : [])];
  const capabilities = supported.filter(cap => options.capabilities === undefined || options.capabilities.includes(cap));
  return { version: COMPILER_IR_VERSION, staticAst: { graph, capabilities, adapter: legacy ? 'legacy-compatibility' : 'validated-input' },
    behaviorObservation: { nodes: graph.components.filter(component => component.type === 'behaviorObservation'),
      ...(options.observations ? { envelope: options.observations } : {}), claim: 'supplied-observations-not-reverified' },
    ...(options.declaredStack ? { declaredStack: options.declaredStack } : {}) };
}

function lower(policy: PolicyIR, facts: FactIR): EvaluationPlanIR {
  const plan: EvaluationPlanIR = { version: COMPILER_IR_VERSION, policyDigest: compilerDigest(policy),
    factDigest: compilerDigest(facts), predicates: [], refusals: [] };
  const moduleComponentType = policy.profile === 'typescript-module-graph' ? 'typescriptModule' as const
    : policy.profile === 'python-module-graph' ? 'pythonModule' as const : null;
  for (const constraint of policy.constraints) {
    if (constraint.kind === 'deferred') {
      plan.refusals.push({ code: 'unsupported-constraint', reason: constraint.reason,
        source: constraint.source, constraintIndex: constraint.index });
      continue;
    }
    const requiredCapabilities: Capability[] = moduleComponentType
      ? ['static.components', 'static.edges', 'static.unresolved-imports'] : ['static.edges'];
    const missing = requiredCapabilities.filter(cap => !facts.staticAst.capabilities.includes(cap));
    if (missing.length > 0) {
      plan.refusals.push({ code: 'missing-capability', reason: `forbiddenDependency requires ${missing.join(', ')}`,
        source: constraint.source, constraintIndex: constraint.index });
      continue;
    }
    plan.predicates.push({ kind: 'NoEdge', constraintIndex: constraint.index, constraintId: constraint.authored.id,
      severity: constraint.authored.severity, source: constraint.source, target: constraint.target,
      sourceSelector: constraint.sourceSelector, scope: constraint.scope,
      mode: moduleComponentType ? 'module-import' : 'legacy-edge', moduleComponentType, requiredCapabilities });
  }
  if (policy.constraints.length === 0) plan.refusals.push({ code: 'no-enforcing-constraints', reason: 'no constraints were supplied' });
  return plan;
}

function evaluatePlan(plan: EvaluationPlanIR, facts: FactIR, policy: PolicyIR): VerdictIR {
  const outcomes: ConstraintOutcomeIR[] = policy.constraints.map(constraint => {
    const predicate = plan.predicates.find(item => item.constraintIndex === constraint.index);
    return predicate ? evaluateNoEdge(predicate, facts) : { constraintIndex: constraint.index,
      constraintId: constraint.authored.id, source: constraint.source, status: 'refused', diagnostics: [] };
  });
  return { version: COMPILER_IR_VERSION, planDigest: compilerDigest(plan), outcomes, refusals: plan.refusals,
    verdict: plan.refusals.length > 0 ? 'refused' : outcomes.some(outcome => outcome.status === 'fail') ? 'fail'
      : outcomes.some(outcome => outcome.status === 'indeterminate') ? 'indeterminate' : 'pass' };
}

/**
 * Compile current authored/fact objects without IO. Deferred families are explicit refusals;
 * callers may inspect the proven slice but cannot claim the whole policy passed.
 */
export function compileBlueprint(blueprint: EngineeringBlueprint, graph: ArchitectureGraph,
  profile?: ExtractionProfile, options: CompilerOptions = {}): CompileResult {
  try {
    if (!blueprint || !graph || !options || typeof options !== 'object') {
      return { status: 'refused', refusals: [{ code: 'invalid-source', reason: 'compiler inputs must be artifact objects' }] };
    }
    if (!isJsonArtifact(blueprint) || !isJsonArtifact(graph) || !isJsonArtifact(options)) {
      return { status: 'refused', refusals: [{ code: 'invalid-source', reason: 'experimental compiler requires finite plain JSON artifacts without unsafe keys or accessors' }] };
    }
    if (blueprint.apiVersion !== 'blueprint-conformance/v1alpha1' || graph.schemaVersion !== '1') {
      return { status: 'refused', refusals: [{ code: 'unsupported-version', reason: 'blueprint or graph version is unsupported' }] };
    }
    if (typeof blueprint.minEngineVersion === 'string' && semverLt(COMPILER_ENGINE_VERSION, blueprint.minEngineVersion)) {
      return { status: 'refused', refusals: [{ code: 'unsupported-version',
        reason: `blueprint requires engine ${blueprint.minEngineVersion}; compiler reader is ${COMPILER_ENGINE_VERSION}` }] };
    }
    if (!ValidatedEngineeringBlueprintSchema.safeParse(blueprint).success || !GraphInputSchema.safeParse(graph).success || !OptionsSchema.safeParse(options).success) {
      return { status: 'refused', refusals: [{ code: 'invalid-source', reason: 'blueprint or graph does not satisfy its current input contract' }] };
    }
    const resolvedProfile = profile ?? blueprint.extraction?.profile ?? 'next-route-handler';
    if (graph.coverage.filesScanned < (blueprint.extraction?.minFiles ?? 1)) {
      return { status: 'refused', refusals: [{ code: 'missing-capability',
        reason: `scanned ${graph.coverage.filesScanned} file(s), expected >= ${blueprint.extraction?.minFiles ?? 1}` }] };
    }
    if (profile && blueprint.extraction?.profile && profile !== blueprint.extraction.profile) {
      return { status: 'refused', refusals: [{ code: ExtractionProfileSchema.options.includes(profile) ? 'invalid-source' : 'unsupported-version',
        reason: 'supplied profile is unsupported or contradicts the blueprint extraction profile' }] };
    }
    return compileInputs(blueprint, graph, resolvedProfile, options, false);
  } catch { return { status: 'refused', refusals: [{ code: 'invalid-source', reason: 'compiler inputs must be acyclic serializable artifacts' }] }; }
}

/** Internal compatibility frontend retains evaluate's historical tolerant object contract. */
export function compileLegacyDependencies(blueprint: EngineeringBlueprint, graph: ArchitectureGraph,
  profile: ExtractionProfile): CompileResult {
  return compileInputs(blueprint, graph, profile, {}, true);
}

function compileInputs(blueprint: EngineeringBlueprint, graph: ArchitectureGraph,
  profile: ExtractionProfile, options: CompilerOptions, legacy: boolean): CompileResult {
  const refusals: CompilerRefusal[] = validatePassPipeline(COMPILER_PASSES);
  if ((options.irVersion ?? COMPILER_IR_VERSION) !== COMPILER_IR_VERSION || graph.schemaVersion !== '1' ||
    blueprint.apiVersion !== 'blueprint-conformance/v1alpha1' || !ExtractionProfileSchema.options.includes(profile)) {
    refusals.push({ code: 'unsupported-version', reason: 'compiler IR, blueprint, graph version or extraction profile is unsupported' });
  }
  if (options.sourceText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(options.sourceText);
      if ((!legacy && !isJsonArtifact(parsed)) || stableStringify(parsed) !== stableStringify(blueprint)) {
        refusals.push({ code: 'invalid-source', reason: 'sourceText does not represent the supplied blueprint' });
      }
    } catch { refusals.push({ code: 'invalid-source', reason: 'sourceText must be valid blueprint JSON' }); }
  }
  if (refusals.length > 0) return { status: 'refused', refusals };
  // Snapshot all caller-owned data before passes. JSON artifact values preserve omission and ordering.
  const input = structuredClone({ blueprint, graph, profile, options });
  const receipts: PassReceipt[] = [];
  const sourceInput = { artifact: input.blueprint, sourceRef: input.options.sourceRef ?? 'blueprint.json',
    ...(input.options.sourceText !== undefined ? { sourceText: input.options.sourceText } : {}) };
  const source = runCompilerPass({ ...COMPILER_PASSES[0]!, run: (s: typeof sourceInput): PolicySourceAST => ({
    version: COMPILER_IR_VERSION, ...s,
    constraints: s.artifact.constraints.map((_, index) => ({ index,
      source: { artifact: s.sourceRef, pointer: `/constraints/${index}` } })) }) }, sourceInput, receipts);
  const policy = runCompilerPass({ ...COMPILER_PASSES[1]!, run: ({ source: s, profile: p }: { source: PolicySourceAST; profile: ExtractionProfile }) => normalizePolicy(s, p) },
    { source, profile: input.profile }, receipts);
  const factOptions: CompilerOptions = {
    capabilities: normalizeFacts(input.graph, input.profile, input.options, legacy).staticAst.capabilities,
    ...(input.options.declaredStack ? { declaredStack: input.options.declaredStack } : {}),
    ...(input.options.observations ? { observations: input.options.observations } : {}),
  };
  const factInput = { graph: input.graph, profile: input.profile, options: factOptions, legacy };
  const facts = runCompilerPass({ ...COMPILER_PASSES[2]!, run: ({ graph: g, profile: p, options: o, legacy: l }: typeof factInput) => normalizeFacts(g, p, o, l) },
    factInput, receipts);
  const plan = runCompilerPass({ ...COMPILER_PASSES[3]!, run: ({ policy: p, facts: f }: { policy: PolicyIR; facts: FactIR }) => lower(p, f) }, { policy, facts }, receipts);
  const verdict = runCompilerPass({ ...COMPILER_PASSES[4]!, run: ({ plan: p, facts: f, policy: s }: { plan: EvaluationPlanIR; facts: FactIR; policy: PolicyIR }) => evaluatePlan(p, f, s) },
    { plan, facts, policy }, receipts);
  const manifest = { version: COMPILER_IR_VERSION, engine: { name: 'bce-engine' as const, version: COMPILER_ENGINE_VERSION },
    passes: receipts, capabilities: facts.staticAst.capabilities, refusals: verdict.refusals };
  const digests = { sourceDigest: compilerDigest(source), policyDigest: compilerDigest(policy), factDigest: compilerDigest(facts),
    planDigest: compilerDigest(plan), verdictDigest: compilerDigest(verdict), manifestDigest: compilerDigest(manifest) };
  const proof: ProofIR = { version: COMPILER_IR_VERSION, claim: 'deterministic-integrity-not-authenticated-provenance',
    ...digests, rootDigest: compilerDigest(digests), links: verdict.outcomes.flatMap(outcome => outcome.diagnostics.map(d => ({
      diagnosticId: d.id, policySource: d.policySource, factSource: d.factSource }))) };
  return freezeArtifact({ status: 'compiled', source, policy, facts, plan, verdict, manifest, proof });
}

/** Replay all semantic inputs: recomputing only hashes would accept fabricated diagnostics. */
export function verifyCompilerProof(result: CompileResult): boolean {
  try {
  if (!isJsonArtifact(result)) return false;
  if (result.status !== 'compiled') return false;
  const replay = compileBlueprint(result.source.artifact, result.facts.staticAst.graph, result.policy.profile, {
    irVersion: result.source.version, sourceRef: result.source.sourceRef,
    ...(result.source.sourceText !== undefined ? { sourceText: result.source.sourceText } : {}),
    capabilities: result.facts.staticAst.capabilities,
    ...(result.facts.declaredStack ? { declaredStack: result.facts.declaredStack } : {}),
    ...(result.facts.behaviorObservation.envelope ? { observations: result.facts.behaviorObservation.envelope } : {}),
  });
  return stableStringify(replay) === stableStringify(result);
  } catch { return false; }
}
