import { z } from 'zod/v3';
import { STACK_CONSTRAINTS } from './schema.js';
import { resolveExtraction } from './extractors.js';
import { resolveEngineVersion, semverLt } from './gate.js';
import type { DeclaredStackReport } from './report.js';
import type { StackManifest } from './stack/stack-manifest.js';
import { validateSelectedStack, type DeclaredStackFacts } from './stack/selected-stack.js';
import { hasStackConstraints, evaluatePreparedEvidence, type PreparedEvidence } from './stack/stack-evaluation.js';
import { createHash } from 'node:crypto';
import type { ArchitectureGraph } from './graph.js';
import { evaluate, stableStringify, type LegacyComplianceReport } from './report.js';
import { parseBlueprint, type EngineeringBlueprint, type ExtractionProfile } from './schema.js';
import { resolveToolchainIdentity, type ToolchainIdentity } from './runtime-identity.js';

const sha256 = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
const detached = <T>(value: T): T => JSON.parse(stableStringify(value)) as T;

export interface LegacyEvidenceBundle {
  schemaVersion: '1';
  kind: 'BceEvidenceBundle';
  claim: 'self-contained-integrity-not-origin-authenticity';
  engine: { name: 'bce-engine'; version: string };
  environment: { node: string; npm: string; platform: string; arch: string };
  toolchain: ToolchainIdentity;
  invocation: { command: string; extractionProfile: ExtractionProfile };
  artifacts: { blueprint: EngineeringBlueprint; graph: ArchitectureGraph; report: LegacyComplianceReport };
  hashes: { blueprint: string; graph: string; report: string; bundle: string };
}

type WithoutBundleHash = Omit<LegacyEvidenceBundle, 'hashes'> & { hashes: Omit<LegacyEvidenceBundle['hashes'], 'bundle'> };

export function createEvidenceBundle(args: {
  blueprint: EngineeringBlueprint;
  graph: ArchitectureGraph;
  report: LegacyComplianceReport;
  engineVersion: string;
  command: string;
  extractionProfile: ExtractionProfile;
}): LegacyEvidenceBundle {
  // Detach the three documents: engine objects may share immutable array references, while the
  // persisted JSON documents do not. The bundle represents persisted bytes, not JS aliasing.
  const blueprint = detached(args.blueprint);
  const graph = detached(args.graph);
  const report = detached(args.report);
  const toolchain = resolveToolchainIdentity({
    engineVersion: args.engineVersion,
    extractorKind: report.coverage.extractor,
    extractionProfile: args.extractionProfile,
  });
  const body: WithoutBundleHash = {
    schemaVersion: '1', kind: 'BceEvidenceBundle', claim: 'self-contained-integrity-not-origin-authenticity',
    engine: { name: 'bce-engine', version: args.engineVersion },
    environment: { ...toolchain.runtime },
    toolchain,
    invocation: { command: args.command, extractionProfile: args.extractionProfile },
    artifacts: { blueprint, graph, report },
    hashes: { blueprint: sha256(blueprint), graph: sha256(graph), report: sha256(report) },
  };
  return { ...body, hashes: { ...body.hashes, bundle: sha256(body) } };
}

export interface EvidenceBundleVerification {
  valid: boolean;
  integrity: 'verified' | 'failed';
  authenticity: 'not-established';
  failures: string[];
}

/** Re-hash every artifact and independently re-evaluate blueprint + graph to reproduce the report. */
function verifyLegacyEvidenceBundle(bundle: LegacyEvidenceBundle): EvidenceBundleVerification {
  const failures: string[] = [];
  try {
    if (bundle.kind !== 'BceEvidenceBundle' || bundle.schemaVersion !== '1') failures.push('unsupported bundle envelope');
    if (bundle.claim !== 'self-contained-integrity-not-origin-authenticity') failures.push('dishonest or unknown claim');
    let blueprint: EngineeringBlueprint | undefined;
    try { blueprint = parseBlueprint(bundle.artifacts.blueprint); } catch (e) { failures.push(`blueprint invalid: ${(e as Error).message}`); }
    if (sha256(bundle.artifacts.blueprint) !== bundle.hashes.blueprint) failures.push('blueprint hash mismatch');
    if (sha256(bundle.artifacts.graph) !== bundle.hashes.graph) failures.push('graph hash mismatch');
    if (sha256(bundle.artifacts.report) !== bundle.hashes.report) failures.push('report hash mismatch');
    const { bundle: ignored, ...artifactHashes } = bundle.hashes;
    void ignored;
    const body: WithoutBundleHash = { ...bundle, hashes: artifactHashes };
    if (sha256(body) !== bundle.hashes.bundle) failures.push('bundle hash mismatch');
    if (blueprint) {
      const reproduced = evaluate(blueprint, bundle.artifacts.graph, bundle.invocation.extractionProfile, bundle.artifacts.report.repo);
      if (stableStringify(reproduced) !== stableStringify(bundle.artifacts.report)) failures.push('report does not reproduce from bundled blueprint and graph');
    }
  } catch (e) {
    failures.push(`malformed bundle: ${(e as Error).message}`);
  }
  return { valid: failures.length === 0, integrity: failures.length === 0 ? 'verified' : 'failed', authenticity: 'not-established', failures };
}

export type EvidenceBundle = LegacyEvidenceBundle | DeclaredStackEvidenceBundle;
export interface DeclaredStackEvidenceBundle {
  schemaVersion: '2'; kind: 'BceEvidenceBundle'; claim: 'self-contained-integrity-not-origin-authenticity';
  engine: LegacyEvidenceBundle['engine']; environment: LegacyEvidenceBundle['environment'];
  toolchain: Omit<ToolchainIdentity,'extractor'> & {providers: Array<({evidenceClass:'staticAst'} & ToolchainIdentity['extractor']) | {evidenceClass:'declaredStack';provider:'selected-stack-v1';version:string}>};
  invocation: {command:string;extractionProfile:ExtractionProfile|null};
  artifacts:{blueprint:EngineeringBlueprint;graph?:ArchitectureGraph;stackManifest:StackManifest;stackFacts:DeclaredStackFacts;report:DeclaredStackReport};
  hashes:{blueprint:string;graph?:string;stackManifest:string;stackFacts:string;report:string;bundle:string};
}
export function createDeclaredStackBundle(args:{blueprint:EngineeringBlueprint;evidence:PreparedEvidence;report:DeclaredStackReport;engineVersion:string;command:string;extractionProfile:ExtractionProfile}):DeclaredStackEvidenceBundle {
  const {manifest,facts,graph}=args.evidence;
  if(!manifest || !facts || !args.report.stack || (args.blueprint.constraints.some(c=>!STACK_CONSTRAINTS.has(c.type)) && !graph)) throw new Error('complete stack manifest/facts required for portable bundle');
  const toolchain=resolveToolchainIdentity({engineVersion:args.engineVersion,extractorKind:graph?.coverage.extractor ?? 'ast',extractionProfile:args.extractionProfile});
  const {extractor,...identity}=toolchain;
  const artifacts=detached({blueprint:args.blueprint,...(graph?{graph}:{}),stackManifest:manifest,stackFacts:facts,report:args.report});
  const body={schemaVersion:'2' as const,kind:'BceEvidenceBundle' as const,claim:'self-contained-integrity-not-origin-authenticity' as const,engine:identity.engine,environment:{...identity.runtime},toolchain:{...identity,providers:[...(graph?[{evidenceClass:'staticAst' as const,...extractor}]:[]),{evidenceClass:'declaredStack' as const,provider:'selected-stack-v1' as const,version:args.engineVersion}]},invocation:{command:args.command,extractionProfile:graph?args.extractionProfile:null},artifacts,hashes:{blueprint:sha256(artifacts.blueprint),...(graph?{graph:sha256(graph)}:{}),stackManifest:sha256(manifest),stackFacts:sha256(facts),report:sha256(args.report)}};
  return {...body,hashes:{...body.hashes,bundle:sha256(body)}};
}
function exactKeys(value:object,keys:string[],label:string):void {
  const actual=Object.keys(value).sort();
  if(stableStringify(actual)!==stableStringify(keys.sort())) throw new Error(`${label} has missing or unexpected fields`);
}
export function verifyEvidenceBundle(bundle:EvidenceBundle):EvidenceBundleVerification {
  if(bundle && typeof bundle==='object' && bundle.schemaVersion==='1') return verifyLegacyEvidenceBundle(bundle);
  const failures:string[]=[];
  try {
    if(bundle.schemaVersion!=='2' || bundle.kind!=='BceEvidenceBundle' || bundle.claim!=='self-contained-integrity-not-origin-authenticity') throw new Error('unsupported bundle envelope');
    exactKeys(bundle,['schemaVersion','kind','claim','engine','environment','toolchain','invocation','artifacts','hashes'],'bundle');
    exactKeys(bundle.engine,['name','version'],'engine');
    exactKeys(bundle.environment,['node','npm','platform','arch'],'environment');
    exactKeys(bundle.toolchain,['engine','dependencyLock','runtime','providers'],'toolchain');
    exactKeys(bundle.invocation,['command','extractionProfile'],'invocation');
    if(typeof bundle.invocation.command!=='string' || !bundle.invocation.command) throw new Error('invalid invocation command');
    const bp=parseBlueprint(bundle.artifacts.blueprint);
    if(!hasStackConstraints(bp)||!bp.stack) throw new Error('v2 requires declaredStack policy');
    const own=resolveEngineVersion();
    if(semverLt(own,bp.minEngineVersion!) || semverLt(bundle.engine.version,bp.minEngineVersion!)) throw new Error('engine below required minimum');
    const graph=bundle.artifacts.graph;
    if(graph) PortableGraphSchema.parse(graph);
    ToolchainBaseSchema.parse({engine:bundle.engine,environment:bundle.environment,dependencyLock:bundle.toolchain.dependencyLock});
    if(!['enforced','advisory',undefined].includes(bundle.artifacts.report.mode)) throw new Error('invalid report mode');
    const code=bp.constraints.some(c=>!STACK_CONSTRAINTS.has(c.type));
    if(code!==Boolean(graph)) throw new Error('required graph missing or unused graph injected');
    exactKeys(bundle.artifacts,['blueprint','stackManifest','stackFacts','report',...(code?['graph']:[])],'artifacts');
    exactKeys(bundle.hashes,['blueprint','stackManifest','stackFacts','report','bundle',...(code?['graph']:[])],'hashes');
    for(const key of ['blueprint','stackManifest','stackFacts','report',...(code?['graph' as const]:[])] as const) if(sha256(bundle.artifacts[key])!==bundle.hashes[key]) failures.push(`${key} hash mismatch`);
    const {bundle:ignored,...hashes}=bundle.hashes; void ignored;
    if(sha256({...bundle,hashes})!==bundle.hashes.bundle) failures.push('bundle hash mismatch');
    const {stackManifest:manifest,stackFacts:facts,report}=bundle.artifacts;
    failures.push(...validateSelectedStack(bp.stack,manifest,facts));
    if(manifest.ctRepoRevision!==facts.ctRepoRevision || manifest.ctRepoRevision!==report.ctRepoRevision || (graph && graph.ctRepoRevision!==manifest.ctRepoRevision)) failures.push('revision mismatch');
    if((graph ? resolveExtraction(bp.extraction,bp.constraints).profile : null)!==bundle.invocation.extractionProfile) failures.push('extraction profile mismatch');
    if(stableStringify(bundle.toolchain.engine)!==stableStringify(bundle.engine) || stableStringify(bundle.toolchain.runtime)!==stableStringify(bundle.environment)) failures.push('toolchain identity mismatch');
    const expectedProviders=[...(graph?[{evidenceClass:'staticAst',kind:graph.coverage.extractor,profile:bundle.invocation.extractionProfile,provider:bundle.invocation.extractionProfile==='python-import-surface'?'python-line-scan':bundle.invocation.extractionProfile==='python-module-graph'?'python-lezer':graph.coverage.extractor==='ast'?'typescript-ts-morph':'typescript-line-scan',version:bundle.engine.version}]:[]),{evidenceClass:'declaredStack',provider:'selected-stack-v1',version:bundle.engine.version}];
    if(stableStringify(expectedProviders)!==stableStringify(bundle.toolchain.providers)) failures.push('provider identity mismatch');
    const reproduced=evaluatePreparedEvidence(bp,{revision:manifest.ctRepoRevision,manifest,facts,...(graph?{graph}:{}),refusals:[]},bundle.invocation.extractionProfile ?? undefined,report.repo);
    if(report.mode) reproduced.mode=report.mode;
    if(stableStringify(reproduced)!==stableStringify(report)) failures.push('report does not reproduce from bundled facts');
  } catch(e){failures.push(`malformed bundle: ${(e as Error).message}`);}
  return {valid:failures.length===0,integrity:failures.length?'failed':'verified',authenticity:'not-established',failures};
}

const PortableGraphSchema=z.object({
 schemaVersion:z.literal('1'),ctRepoRevision:z.string(),
 components:z.array(z.object({id:z.string(),type:z.string(),path:z.string(),line:z.number().int().nonnegative()}).strict()),
 guardEdges:z.array(z.object({from:z.string(),to:z.string(),type:z.string(),evidenceRef:z.string()}).strict()),
 coverage:z.object({extractor:z.enum(['ast','line-scan']),filesScanned:z.number().int().nonnegative(),unsupported:z.array(z.string()),scannedFiles:z.array(z.string()).optional(),patternScan:z.object({patterns:z.array(z.string()),hits:z.array(z.object({pattern:z.string(),file:z.string(),line:z.number().int().positive()}).strict())}).strict().optional(),unresolvedEgress:z.array(z.object({callee:z.string(),ref:z.string()}).strict()).optional(),unresolvedImports:z.array(z.object({from:z.string(),specifier:z.string(),kind:z.string(),ref:z.string(),reason:z.string()}).strict()).optional()}).strict(),
}).strict();
const ToolchainBaseSchema=z.object({engine:z.object({name:z.literal('bce-engine'),version:z.string().regex(/^\d+\.\d+\.\d+$/)}).strict(),environment:z.object({node:z.string().min(1),npm:z.string().min(1),platform:z.string().min(1),arch:z.string().min(1)}).strict(),dependencyLock:z.object({file:z.literal('npm-shrinkwrap.json'),sha256:z.string().regex(/^[0-9a-f]{64}$/)}).strict()}).strict();
