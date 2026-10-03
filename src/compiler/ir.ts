/** Experimental internal compiler contracts; not a published blueprint/report schema. */
import type { ArchitectureGraph, ObservedComponent } from '../graph.js';
import type { Constraint, EngineeringBlueprint, ExtractionProfile, Severity } from '../schema.js';
import type { Violation, EvidenceRefusal } from '../report.js';
import type { DeclaredStackFacts } from '../stack/selected-stack.js';
import type { StackManifest } from '../stack/stack-manifest.js';
import type { ObservationExpectation } from '../observations.js';

export const COMPILER_IR_VERSION = 'experimental-1' as const;
export type EvidencePlane = 'staticAst' | 'behaviorObservation' | 'declaredStack';
export type Capability = 'static.components' | 'static.edges' | 'static.unresolved-imports';
export interface SourceLink { artifact: string; pointer: string }
export interface PolicySourceAST {
  version: typeof COMPILER_IR_VERSION;
  artifact: EngineeringBlueprint;
  sourceRef: string;
  /** Exact JSON text, when the caller has it. Object adapters cannot recover whitespace. */
  sourceText?: string;
  constraints: Array<{ index: number; source: SourceLink }>;
}
export interface ConstraintBase {
  index: number;
  source: SourceLink;
  authored: Constraint;
  evidencePlane: EvidencePlane;
}
export type PolicyConstraintIR = (ConstraintBase & {
  kind: 'forbiddenDependency';
  target: string;
  sourceSelector: string;
  scope: string[];
  defaults: Array<'sourceSelector' | 'scope'>;
}) | (ConstraintBase & { kind: 'deferred'; reason: string });
export interface PolicyIR {
  version: typeof COMPILER_IR_VERSION;
  sourceDigest: string;
  profile: ExtractionProfile;
  constraints: PolicyConstraintIR[];
}
export interface FactIR {
  version: typeof COMPILER_IR_VERSION;
  /** Lossless compatibility envelope, including optional coverage and extension fields. */
  staticAst: { graph: ArchitectureGraph; capabilities: Capability[]; adapter: 'validated-input' | 'legacy-compatibility' };
  behaviorObservation: { nodes: ObservedComponent[]; envelope?: ObservationEvidence; claim: 'supplied-observations-not-reverified' };
  declaredStack?: { manifest: StackManifest; facts: DeclaredStackFacts; refusals: EvidenceRefusal[] };
}
/** Supplied after acquisition/validation; the compiler does not impersonate an observer. */
export interface ObservationEvidence {
  schemaVersion: '1';
  binding: ObservationExpectation;
  collector: { name: string; version: string };
  probeDefinition: unknown;
  stimuli: unknown[];
  observations: ObservedComponent[];
  [key: string]: unknown;
}
export interface NoEdgePredicate {
  kind: 'NoEdge';
  constraintIndex: number;
  constraintId: string;
  severity: Severity;
  source: SourceLink;
  target: string;
  sourceSelector: string;
  scope: string[];
  mode: 'legacy-edge' | 'module-import';
  moduleComponentType: 'typescriptModule' | 'pythonModule' | null;
  requiredCapabilities: Capability[];
}
export interface CompilerRefusal {
  code: 'unsupported-version' | 'unsupported-constraint' | 'missing-capability' | 'invalid-source' |
    'invalid-pass' | 'missing-dependency' | 'dependency-cycle' | 'no-enforcing-constraints';
  reason: string;
  source?: SourceLink;
  constraintIndex?: number;
}
export interface EvaluationPlanIR {
  version: typeof COMPILER_IR_VERSION;
  policyDigest: string;
  factDigest: string;
  predicates: NoEdgePredicate[];
  refusals: CompilerRefusal[];
}
export interface DiagnosticIR {
  id: string;
  kind: 'violation' | 'uncertainty';
  policySource: SourceLink;
  factSource: SourceLink;
  legacyViolation: Violation;
}
export interface ConstraintOutcomeIR {
  constraintIndex: number;
  constraintId: string;
  source: SourceLink;
  status: 'pass' | 'fail' | 'indeterminate' | 'refused';
  diagnostics: DiagnosticIR[];
}
export interface VerdictIR {
  version: typeof COMPILER_IR_VERSION;
  planDigest: string;
  /** A refused/deferred family cannot produce an authoritative pass. */
  verdict: 'pass' | 'fail' | 'indeterminate' | 'refused';
  outcomes: ConstraintOutcomeIR[];
  refusals: CompilerRefusal[];
}
export interface CompilerPassDescriptor {
  id: string;
  version: '1';
  inputSchema: string;
  outputSchema: string;
  dependencies: readonly string[];
  requiredCapabilities: readonly Capability[];
}
export interface CompilerPass<I, O> extends CompilerPassDescriptor { run(input: I): O }
export interface PassReceipt {
  pass: CompilerPassDescriptor;
  inputDigest: string;
  outputDigest: string;
  cache: 'not-used';
}
export interface CompileManifest {
  version: typeof COMPILER_IR_VERSION;
  engine: { name: 'bce-engine'; version: string };
  passes: PassReceipt[];
  capabilities: Capability[];
  refusals: CompilerRefusal[];
}
export interface ProofIR {
  version: typeof COMPILER_IR_VERSION;
  claim: 'deterministic-integrity-not-authenticated-provenance';
  sourceDigest: string;
  policyDigest: string;
  factDigest: string;
  planDigest: string;
  verdictDigest: string;
  manifestDigest: string;
  rootDigest: string;
  links: Array<{ diagnosticId: string; policySource: SourceLink; factSource: SourceLink }>;
}
export interface CompilerOptions {
  irVersion?: string;
  sourceRef?: string;
  sourceText?: string;
  /** Narrow the adapter's capabilities; additions cannot grant an unsupported capability. */
  capabilities?: readonly Capability[];
  declaredStack?: FactIR['declaredStack'];
  observations?: ObservationEvidence;
}
export type CompileResult = {
  status: 'compiled'; source: PolicySourceAST; policy: PolicyIR; facts: FactIR;
  plan: EvaluationPlanIR; verdict: VerdictIR; manifest: CompileManifest; proof: ProofIR;
} | { status: 'refused'; refusals: CompilerRefusal[] };
