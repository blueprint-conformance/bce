import { resolveEngineVersion, semverLt } from '../gate.js';
/** Shared declared-evidence dispatcher. Live evaluation and offline replay use these same facts. */
import { createHash } from 'node:crypto';
import { evaluate, stableStringify, SEVERITY_WEIGHT, type ComplianceReport, type DeclaredStackReport, type EvidenceRefusal, type Violation } from '../report.js';
import { STACK_CONSTRAINTS, constraintEvidenceClass, type EngineeringBlueprint, type ExtractionProfile } from '../schema.js';
import type { ArchitectureGraph } from '../graph.js';
import { resolveExtraction } from '../extractors.js';
import { makeExtractor } from '../extractor-registry.js';
import type { StackManifest } from './stack-manifest.js';
import { extractSelectedStack, validateSelectedStack, type DeclaredStackFacts } from './selected-stack.js';

const compare=(a:string,b:string):number=>a<b?-1:a>b?1:0;
export const canonicalHash = (value: unknown): string => createHash('sha256').update(stableStringify(value)).digest('hex');
export const hasStackConstraints = (bp: EngineeringBlueprint): boolean => bp.constraints.some(c => STACK_CONSTRAINTS.has(c.type));
export interface PreparedEvidence { revision: string; graph?: ArchitectureGraph; manifest?: StackManifest; facts?: DeclaredStackFacts; refusals: EvidenceRefusal[] }

function unsupportedCodeEvidence(bp: EngineeringBlueprint): EvidenceRefusal[] {
  const code = bp.constraints.filter(c => !STACK_CONSTRAINTS.has(c.type));
  const cfg = resolveExtraction(bp.extraction, code);
  if (!['python-import-surface', 'python-module-graph'].includes(cfg.profile)) return [];
  return code.filter(c => c.type === 'forbiddenEgress').map(c => ({
    constraintId: c.id, evidenceClass: 'staticAst', code: 'unsupported-code-capability',
    reason: `forbiddenEgress is not supported by the ${cfg.profile} profile`, sources: [...cfg.paths],
  }));
}

export function prepareDeclaredEvidence(
  bp: EngineeringBlueprint,
  repoDir: string,
  revision: string,
  kind: 'ast'|'line-scan' = 'ast',
  stackLinkAnchor = repoDir,
): PreparedEvidence {
  if(bp.minEngineVersion && semverLt(resolveEngineVersion(),bp.minEngineVersion)) throw new Error(`engine below required minimum ${bp.minEngineVersion}`);
  const result: PreparedEvidence = {revision, refusals:unsupportedCodeEvidence(bp)};
  try {
    if (!bp.stack) throw new Error('missing selected stack configuration');
    Object.assign(result, extractSelectedStack(repoDir, revision, bp.stack, stackLinkAnchor));
  } catch (e) {
    for (const c of bp.constraints.filter(c => STACK_CONSTRAINTS.has(c.type))) result.refusals.push({constraintId:c.id,evidenceClass:'declaredStack',code:'source-acquisition-failed',reason:(e as Error).message,sources:bp.stack ? [bp.stack.lockfile,bp.stack.packageManifest,...bp.stack.imageFiles,...bp.stack.runtimeFiles].sort() : []});
  }
  const code = bp.constraints.filter(c => !STACK_CONSTRAINTS.has(c.type));
  if (code.length) {
    const cfg = resolveExtraction(bp.extraction, code);
    try {
      if (kind === 'line-scan' && (cfg.governedModules.length || cfg.egressEnabled || ['typescript-module-graph','python-module-graph'].includes(cfg.profile))) throw new Error('selected code policy requires ast extraction');
      result.graph = makeExtractor(kind,cfg).extract(repoDir,revision);

    } catch(e) {
      for (const c of code) result.refusals.push({constraintId:c.id,evidenceClass:constraintEvidenceClass(c.type),code:'code-acquisition-failed',reason:(e as Error).message,sources:[...cfg.paths]});
    }

  }
  return result;
}

export function evaluatePreparedEvidence(bp: EngineeringBlueprint, evidence: PreparedEvidence, profile?: ExtractionProfile, repoName?: string): ComplianceReport {
  if (!hasStackConstraints(bp)) {
    if (!evidence.graph) throw new Error('graph evidence required');
    return evaluate(bp,evidence.graph,profile,repoName);
  }
  if(bp.minEngineVersion && semverLt(resolveEngineVersion(),bp.minEngineVersion)) throw new Error(`engine below required minimum ${bp.minEngineVersion}`);
  const violations: Violation[] = [];
  // Derive capability limits again during replay; caller-supplied graph facts or
  // an empty refusal array cannot grant an unsupported provider capability.
  const refusals: EvidenceRefusal[] = [...evidence.refusals, ...unsupportedCodeEvidence(bp)];
  const providers: DeclaredStackReport['coverage']['providers'] = [];
  const {manifest:m,facts:f} = evidence;
  const code = bp.constraints.filter(c => !STACK_CONSTRAINTS.has(c.type));
  if (code.length && evidence.graph) {
    const cfg=resolveExtraction(bp.extraction,code);
    if(evidence.graph.coverage.filesScanned < cfg.minFiles) for(const c of code) refusals.push({constraintId:c.id,evidenceClass:constraintEvidenceClass(c.type),code:'insufficient-code-coverage',reason:`scanned ${evidence.graph.coverage.filesScanned} files, required >=${cfg.minFiles}`,sources:[...cfg.paths]});
    for(const c of code.filter(c=>constraintEvidenceClass(c.type)==='behaviorObservation')) {
      const observations=evidence.graph.components.filter(n=>n.type==='behaviorObservation' && n.id.startsWith(`behavior:${c.behaviorRef}:`));
      if(observations.length < 2) refusals.push({constraintId:c.id,evidenceClass:'behaviorObservation',code:'missing-runtime-observations',reason:'bound runtime observations are required',sources:[]});
    }
    const legacy = evaluate({...bp,constraints:code},evidence.graph,profile,repoName);
    violations.push(...legacy.violations);
    providers.push({evidenceClass:'staticAst',...legacy.coverage});
  } else if(code.length && !refusals.some(r=>r.evidenceClass!=='declaredStack')) {
    for(const c of code) refusals.push({constraintId:c.id,evidenceClass:constraintEvidenceClass(c.type),code:'missing-code-evidence',reason:'required graph evidence is absent',sources:[]});
  }
  const invalid = m && f && bp.stack ? validateSelectedStack(bp.stack,m,f) : ['complete stack facts unavailable'];
  if (m && f) providers.push({evidenceClass:'declaredStack',filesScanned:m.coverage.filesScanned,unsupported:[...m.coverage.unsupported,...f.limitations.filter(l=>!l.manifestWarningIndexes.length).map(l=>l.message)]});
  for (const c of bp.constraints.filter(c => STACK_CONSTRAINTS.has(c.type))) {
    const sources = bp.stack ? [bp.stack.lockfile,bp.stack.packageManifest,...bp.stack.imageFiles,...bp.stack.runtimeFiles].sort() : [];
    const refuse = (code:string,reason:string) => refusals.push({constraintId:c.id,evidenceClass:'declaredStack',code,reason,sources});
    if (!m || !f || invalid.length) {
      if (!refusals.some(r=>r.constraintId===c.id)) refuse('invalid-stack-evidence',invalid.join('; '));
      continue;
    }
    const domain = c.type === 'stackClosureMatch' ? 'closure' : c.type === 'requirePinnedImages' || c.stackTarget?.kind === 'oci-image' ? 'images' : c.type === 'allowedNodeVersions' || c.stackTarget?.kind === 'node-runtime' ? 'runtime' : 'packages';
    const opaque = domain === 'packages' && m.unmodeled.length > 0;
    if (f.domains[domain] !== 'complete') refuse('incomplete-'+domain,`selected ${domain} evidence is ${f.domains[domain]}`);
    if (opaque) refuse('opaque-package-entry','opaque package identities prevent all-occurrence and absence proofs');
    const add = (component:string,observed:string,expected:string,evidenceRef:string) => violations.push({constraintId:c.id,severity:c.severity,component,evidenceType:'declaredStack',evidenceRef,observed,expected});
    const npm = m.nodes.filter(n=>n.kind==='npm' && !n.root);
    const anchor = (layout:string[]) => bp.stack!.source==='npm-lockfile-v3' ? `${bp.stack!.lockfile}#/packages/${(layout[0] ?? '').replace(/~/g,'~0').replace(/\//g,'~1')}` : bp.stack!.lockfile;
    if (c.type === 'forbiddenStackPackage') for(const n of npm.filter(n=>n.name===c.packageName)) add(`npm:${n.name}`,`${n.name}@${n.version} present`,`no non-root npm:${c.packageName}`,anchor(n.layout));
    if (c.type === 'pinnedVersion' && c.stackTarget?.kind === 'npm') {
      const matches=npm.filter(n=>n.name===c.stackTarget!.name);
      if(!matches.length && !opaque && f.domains.packages==='complete') add(`npm:${c.stackTarget.name}`,'absent',c.expectedVersion!,bp.stack!.lockfile);
      for(const n of matches) if(n.version!==c.expectedVersion) add(`npm:${n.name}`,n.version,c.expectedVersion!,anchor(n.layout));
    }
    if (c.type === 'stackClosureMatch' && m.stackDigest!==c.expectedStackDigest) add('stack:closure',m.stackDigest,c.expectedStackDigest!,bp.stack!.lockfile);
    if(c.type==='requirePinnedImages' || c.stackTarget?.kind==='oci-image') {
      const images=c.type==='requirePinnedImages' ? m.images : m.images.filter(i=>i.name===c.stackTarget!.name);
      if(!images.length && f.domains.images==='complete') add(`oci-image:${c.stackTarget?.name ?? '*'}`,'no matching external image',c.expectedVersion ?? 'at least one digest-pinned external image',bp.stack!.imageFiles.join(','));
      for(const img of images) if(c.type==='requirePinnedImages' ? !/^sha256:[0-9a-f]{64}$/.test(img.digest ?? '') : img.digest!==c.expectedVersion) add(`oci-image:${img.name}`,img.digest ?? img.ref,c.expectedVersion ?? 'sha256 digest pin',img.evidenceRef);
    }
    if(c.type==='allowedNodeVersions' || c.stackTarget?.kind==='node-runtime') {
      const node=m.runtime.node;
      if(!node.pin || !node.declared) refuse('non-exact-runtime','runtime declaration is absent or non-exact');
      else if(c.type==='allowedNodeVersions' ? !c.versions!.includes(node.declared) : node.declared!==c.expectedVersion) add('node-runtime:node',node.declared,c.expectedVersion ?? c.versions!.join('|'),node.resolvedFrom==='engines' ? 'package.json#/engines/node' : node.resolvedFrom==='nvmrc' ? '.nvmrc' : '.node-version');
    }
  }
  const violationKey = (v: Violation): string => stableStringify({
    constraintId: v.constraintId,
    component: v.component,
    observed: v.observed,
    expected: v.expected,
    evidenceRef: v.evidenceRef,
  });
  const unique = [...new Map(violations.map(v=>[violationKey(v),v])).values()].sort((a,b)=>compare(violationKey(a),violationKey(b)));
  const orderedRefusals=[...new Map(refusals.map(r=>[stableStringify(r),r])).values()].sort((a,b)=>compare(`${a.constraintId}\0${a.code}\0${a.sources.join(',')}`,`${b.constraintId}\0${b.code}\0${b.sources.join(',')}`));
  const score=orderedRefusals.length ? null : Math.max(0,unique.reduce((n,v)=>n-SEVERITY_WEIGHT[v.severity],100));
  return {schemaVersion:'2',blueprintRef:`${bp.metadata.id}@${bp.metadata.version}`,ctRepoRevision:evidence.revision,...(repoName!==undefined?{repo:repoName}:{}),score,verdict:orderedRefusals.length?'indeterminate':unique.length?'fail':'pass',violations:unique,evidenceRef:f?`declared-stack-facts.json@sha256:${canonicalHash(f)}`:'n/a',summary:`${bp.constraints.length} constraint(s) evaluated; ${unique.length} violation(s); ${orderedRefusals.length} refusal(s); score ${score === null?'indeterminate':score}`,coverage:{providers},stack:m&&f?{stackDigest:m.stackDigest,manifestDigest:m.manifestDigest,sourceConfigDigest:f.sourceConfigDigest,claim:'selected-declarations-not-installed-state'}:null,refusals:orderedRefusals};
}
