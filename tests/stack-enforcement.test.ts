import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlueprint, parseBlueprintTolerant } from '../src/schema.js';
import { prepareDeclaredEvidence, evaluatePreparedEvidence } from '../src/stack/stack-evaluation.js';
import { computeGateReport, blueprintTouchesChanges } from '../src/gate.js';
import { createDeclaredStackBundle, verifyEvidenceBundle } from '../src/evidence-bundle.js';
import { stableStringify } from '../src/report.js';

const digest='sha256:'+'a'.repeat(64);
const rule=(type:string,extra:object={})=>({id:type,type,severity:'high',...extra});
const policy=(rules:object[])=>({apiVersion:'blueprint-conformance/v1alpha1',kind:'EngineeringBlueprint',metadata:{id:'stack',version:'1.0.0',status:'draft'},intentRefs:['policy/stack'],scope:{repositories:['example/app'],paths:['src/**']},architecture:{components:[],relationships:[]},constraints:rules,evidenceRequirements:[{type:'declaredStack',required:true,onMissing:'block'}],approvals:[],minEngineVersion:'0.5.0',stack:{source:'npm-lockfile-v3',lockfile:'package-lock.json',packageManifest:'package.json',imageFiles:['Dockerfile'],runtimeFiles:['.nvmrc']}});
let root:string;
const write=(p:string,value:unknown)=>fs.writeFileSync(path.join(root,p),typeof value==='string'?value:JSON.stringify(value));
function source(version='7.0.0') {
  write('package.json',{name:'app',version:'1.0.0'});
  write('package-lock.json',{name:'app',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'app',version:'1.0.0'},'node_modules/is-number':{version,integrity:'sha512-abc'}}});
  write('Dockerfile',`FROM node:22@${digest}\n`); write('.nvmrc','22.22.2\n');
}
function run(raw:unknown) {const bp=parseBlueprint(raw);const evidence=prepareDeclaredEvidence(bp,root,'fixture');return {bp,evidence,report:evaluatePreparedEvidence(bp,evidence)};}
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'bce-enforce-'));source();});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
describe('declared-stack enforcement',()=>{
 it('all five rules grade the same selected source with closure identity',()=>{
   const first=run(policy([rule('forbiddenStackPackage',{packageName:'legacy-package'})]));
   const raw=policy([rule('pinnedVersion',{stackTarget:{kind:'npm',name:'is-number'},expectedVersion:'7.0.0'}),rule('stackClosureMatch',{expectedStackDigest:first.evidence.manifest!.stackDigest}),rule('forbiddenStackPackage',{packageName:'legacy-package'}),rule('requirePinnedImages'),rule('allowedNodeVersions',{versions:['22.22.2']})]);
   const result=run(raw);expect(result.report.verdict).toBe('pass');expect(result.report.schemaVersion).toBe('2');
   source('6.0.0');expect(run(raw).report.violations.map(v=>v.constraintId)).toEqual(['pinnedVersion','stackClosureMatch']);
 });
 it('diagnostic violations coexist with opacity refusal and null score',()=>{
   source();const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));lock.packages['node_modules/opaque']={version:'file:../opaque'};write('package-lock.json',lock);
   const {report}=run(policy([rule('forbiddenStackPackage',{packageName:'is-number'})]));
   expect(report.verdict).toBe('indeterminate');expect(report.score).toBeNull();expect(report.violations).toHaveLength(1);
 });
 it('missing selected source is refusal and does not fabricate bundle',()=>{
   fs.unlinkSync(path.join(root,'package-lock.json'));const result=run(policy([rule('forbiddenStackPackage',{packageName:'bad'})]));
   expect(result.report.verdict).toBe('indeterminate');expect(result.evidence.manifest).toBeUndefined();
 });
 it('ordinary gate selects lockfile deletion and advisory cannot soften refusal',()=>{
   const raw=policy([rule('forbiddenStackPackage',{packageName:'is-number'})]);fs.mkdirSync(path.join(root,'.blueprints'));write('.blueprints/stack.blueprint.json',raw);
   expect(blueprintTouchesChanges(root,parseBlueprint(raw),['package-lock.json'])).toBe(true);
   expect(computeGateReport(root,path.join(root,'.blueprints'),['package-lock.json'],'ast').doc.exitCode).toBe(1);
   fs.unlinkSync(path.join(root,'package-lock.json'));write('.bce-mode.json',{mode:'advisory'});
   expect(computeGateReport(root,path.join(root,'.blueprints'),['package-lock.json'],'ast').doc.exitCode).toBe(2);
 });
 it('replays separate facts and rejects source/report substitutions',()=>{
   const result=run(policy([rule('forbiddenStackPackage',{packageName:'bad'})]));
   if(result.report.schemaVersion!=='2')throw new Error('wrong version');
   const bundle=createDeclaredStackBundle({blueprint:result.bp,evidence:result.evidence,report:result.report,engineVersion:'0.5.0',command:'bce run',extractionProfile:'next-route-handler'});
   expect(verifyEvidenceBundle(JSON.parse(stableStringify(bundle)))).toMatchObject({valid:true,authenticity:'not-established'});
   bundle.artifacts.stackFacts.inventory[0]!.sha256='f'.repeat(64);expect(verifyEvidenceBundle(bundle).valid).toBe(false);
 });
 it('cross-field authoring fails closed in strict and tolerant modes',()=>{
   const raw=policy([rule('forbiddenStackPackage',{packageName:'bad'})]);
   for(const changed of [{...raw,stack:undefined},{...raw,minEngineVersion:'0.3.1'},{...raw,evidenceRequirements:[]},{...raw,constraints:[rule('forbiddenStackPackage',{packageName:'bad',expectedVersion:'1.0.0'})]}]) {
     expect(()=>parseBlueprint(changed)).toThrow();expect(()=>parseBlueprintTolerant(changed)).toThrow();
   }
 });
 it.each([null, undefined, [], {schemaVersion:'3'}])('malformed envelope returns structured refusal: %j',value=>{
   expect(verifyEvidenceBundle(value as never)).toMatchObject({valid:false,integrity:'failed'});
 });
 it('image and runtime pins enforce every occurrence and ignore executing Node',()=>{
   const raw=policy([rule('pinnedVersion',{stackTarget:{kind:'oci-image',name:'node'},expectedVersion:digest}),{...rule('pinnedVersion',{stackTarget:{kind:'node-runtime',name:'node'},expectedVersion:'22.22.2'}),id:'runtime-pin'}]);
   expect(run(raw).report.verdict).toBe('pass');
   write('Dockerfile',`FROM node:22@${digest} AS build\nFROM node:23\n`);write('.nvmrc','24.8.0\n');
   const {report}=run(raw);expect(report.verdict).toBe('fail');expect(report.violations.map(v=>v.component).sort()).toEqual(['node-runtime:node','oci-image:node']);
   write('Dockerfile','FROM node:22\nFROM node:22\n');write('.nvmrc','22.22.2\n');
   const duplicate=run(policy([rule('requirePinnedImages')]));
   expect(duplicate.evidence.manifest!.images.map(image=>image.evidenceRef)).toEqual(['Dockerfile#L1','Dockerfile#L2']);
   expect(duplicate.report.violations).toEqual([expect.objectContaining({constraintId:'requirePinnedImages',component:'oci-image:node',observed:'node:22',expected:'sha256 digest pin',evidenceRef:'Dockerfile#L1'})]);
   expect(duplicate.report.score).toBe(80);
 });
 it.each([
   ['standalone comment', `FROM node:22@${digest} AS build\n# ignored comment \\\nFROM alpine:latest\n`],
   ['comment inside continuation', `FROM \\\n# ignored comment \\\nnode:22@${digest} AS build\nFROM alpine:latest\n`],
 ])('image gate sees an unpinned stage after a %s',(_label,dockerfile)=>{
   const raw=policy([rule('requirePinnedImages')]);
   write('Dockerfile',dockerfile);
   const {bp,evidence,report}=run(raw);
   expect(evidence.manifest!.images.map(image=>image.ref)).toEqual(['alpine:latest',`node:22@${digest}`]);
   expect(report.verdict).toBe('fail');
   if(report.schemaVersion!=='2')throw new Error('wrong version');
   const bundle=createDeclaredStackBundle({blueprint:bp,evidence,report,engineVersion:'0.5.0',command:'bce run',extractionProfile:'next-route-handler'});
   expect(verifyEvidenceBundle(JSON.parse(stableStringify(bundle)))).toMatchObject({valid:true,integrity:'verified',authenticity:'not-established'});
   fs.mkdirSync(path.join(root,'.blueprints'));write('.blueprints/stack.blueprint.json',raw);
   expect(computeGateReport(root,path.join(root,'.blueprints'),['Dockerfile'],'ast').doc.exitCode).toBe(1);
 });
 it('preserves escape-directive refusal while default escape keeps the following stage visible',()=>{
   const raw=policy([rule('requirePinnedImages')]);
   write('Dockerfile',['# escape='+String.fromCharCode(92),`FROM node:22@${digest}`,'FROM alpine:latest',''].join('\n'));
   expect(run(raw).report.verdict).toBe('fail');
   write('Dockerfile',['# escape='+String.fromCharCode(96),`FROM node:22@${digest}`,''].join('\n'));
   expect(run(raw).report.verdict).toBe('indeterminate');
 });
 it('conflicting unselected runtime declaration refuses runtime and closure',()=>{
   write('.node-version','24.8.0\n');const {report}=run(policy([rule('allowedNodeVersions',{versions:['22.22.2']})]));
   expect(report.verdict).toBe('indeterminate');expect(report.score).toBeNull();
 });
 it('package pin requires every copy and absent target is an ordinary violation',()=>{
   const raw=policy([rule('pinnedVersion',{stackTarget:{kind:'npm',name:'is-number'},expectedVersion:'7.0.0'})]);
   source('5.0.0');
   const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));lock.packages['node_modules/parent/node_modules/is-number']={version:'6.0.0'};write('package-lock.json',lock);
   const mismatches=run(raw).report;expect(mismatches.verdict).toBe('fail');expect(mismatches.violations).toHaveLength(2);expect(new Set(mismatches.violations.map(v=>v.evidenceRef)).size).toBe(2);
   write('package-lock.json',{lockfileVersion:3,packages:{'':{name:'app',version:'1.0.0'}}});expect(run(raw).report.violations[0]?.observed).toBe('absent');
 });
 it('mixed code and stack replay preserve both providers and code failure',()=>{
   fs.mkdirSync(path.join(root,'src'));write('src/main.ts','export const marker = "forbidden-token";\n');
   const raw={...policy([rule('forbiddenStackPackage',{packageName:'bad'}),rule('forbiddenPattern',{pattern:'forbidden-token'})]),extraction:{profile:'plugin-surface',paths:['src/**/*.ts'],minFiles:1},evidenceRequirements:[{type:'declaredStack',required:true,onMissing:'block'},{type:'staticAst',required:true,onMissing:'block'}]};
   const result=run(raw);expect(result.report.verdict).toBe('fail');if(result.report.schemaVersion!=='2')throw new Error('v2');expect(result.report.coverage.providers).toHaveLength(2);
   const bundle=createDeclaredStackBundle({blueprint:result.bp,evidence:result.evidence,report:result.report,engineVersion:'0.5.0',command:'bce run',extractionProfile:'plugin-surface'});
   expect(verifyEvidenceBundle(bundle)).toMatchObject({valid:true});
 });

});
