import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { extractSelectedStack, validateSelectedStack, stackSourceConfigDigest } from '../src/stack/selected-stack.js';
import { extractStackManifest, deriveFromLockfileV3 } from '../src/stack/stack-extractor.js';
import { finalizeStackManifest } from '../src/stack/stack-manifest.js';
import type { StackSourceConfig } from '../src/schema.js';
const config: StackSourceConfig = { source: 'npm-lockfile-v3', lockfile: 'package-lock.json', packageManifest: 'package.json', imageFiles: [], runtimeFiles: [] };
const pkg = { name: 'app', version: '1.0.0', dependencies: { a: '1.0.0' } };
const lock = () => ({ name: 'app', version: '1.0.0', lockfileVersion: 3, packages: { '': pkg, 'node_modules/a': { version: '1.0.0', integrity: 'sha512-a' } } });
function fixture(run: (root: string, write: (p: string, content: unknown) => void) => void) {
 const root = fs.mkdtempSync(path.join(tmpdir(), 'bce-selected-test-'));
 const write = (p: string, content: unknown) => { fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true}); fs.writeFileSync(path.join(root,p), typeof content === 'string' ? content : JSON.stringify(content)); };
 try { write('package.json',pkg); write('package-lock.json',lock());run(root,write); } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
const extract = (root: string, c = config) => extractSelectedStack(root, 'test-revision', c);
describe('selected stack finite source provider', () => {
 it('binds exact selected files and explicit inventory absences; no ambient image or runtime scan', () => fixture((root,write) => {
  write('Dockerfile','FROM evil:latest');write('.nvmrc','garbage');
  const {manifest:m,facts:f}=extract(root);
  expect(m.images).toEqual([]);expect(m.runtime.node.declared).toBeNull();expect(m.sources.map(s=>s.path)).toEqual(['package-lock.json','package.json']);
  expect(f.inventory).toHaveLength(8);expect(f.inventory.find(r=>r.path==='.node-version')).toMatchObject({present:false,sha256:null,role:'conflict-check'});
  expect(f.domains).toEqual({packages:'complete',images:'not-selected',runtime:'not-selected',closure:'complete'});expect(validateSelectedStack(config,m,f)).toEqual([]);
 }));
 it('accepts a genuinely dependency-free npm closure without weakening legacy snapshots', () => fixture((root,write) => {
  const p={name:'app',version:'1.0.0'};const l={lockfileVersion:3,packages:{'':p}};write('package.json',p);write('package-lock.json',l);
  expect(extract(root).facts.domains.packages).toBe('complete');expect(deriveFromLockfileV3(l).hollow).toBe('no package beyond the root');
 }));
 it('rejects lost root dependencies and mismatched declared root specs', () => fixture((root,write) => {
  write('package-lock.json',{lockfileVersion:3,packages:{'':{name:'app',version:'1.0.0'}}});expect(()=>extract(root)).toThrow(/disagrees/);
 }));
 it('requires selected files, regular files and strict paths', () => fixture((root,write) => {
  expect(()=>extract(root,{...config,imageFiles:['Dockerfile']})).toThrow(/missing/);
  fs.mkdirSync(path.join(root,'.npmrc'));expect(()=>extract(root)).toThrow(/regular/);fs.rmSync(path.join(root,'.npmrc'),{recursive:true});
  for(const p of ['../Dockerfile','a//Dockerfile','./Dockerfile','/Dockerfile','a\\Dockerfile','a/../Dockerfile']) expect(()=>extract(root,{...config,imageFiles:[p]})).toThrow();
  write('Dockerfile','FROM node:22');
 }));
 it.skipIf(process.platform==='win32')('refuses symlink source components and conflict-check files', () => fixture((root,write) => {
  write('inner/Dockerfile','FROM node:22');fs.symlinkSync('inner',path.join(root,'alias'));
  expect(()=>extract(root,{...config,imageFiles:['alias/Dockerfile']})).toThrow(/regular/);
  fs.symlinkSync('package.json',path.join(root,'.npmrc'));expect(()=>extract(root)).toThrow(/regular/);
 }));
 it('records multiple root locks and config files as typed package/closure incompleteness', () => fixture((root,write) => {
  write('pnpm-lock.yaml',"lockfileVersion: '9.0'\n");write('.npmrc','ignore-scripts=true');
  const r=extract(root);expect(r.facts.domains.packages).toBe('incomplete');expect(r.facts.limitations.map(l=>l.code)).toEqual(expect.arrayContaining(['ambiguous-package-manager','unsupported-package-manager-config']));
 }));
 it('permits whitespace-only config but refuses a manager-family mismatch', () => fixture((root,write) => {
  write('.npmrc',' \n');expect(extract(root).facts.domains.packages).toBe('complete');write('package.json',{...pkg,packageManager:'pnpm@10.0.0'});expect(extract(root).facts.domains.packages).toBe('incomplete');
 }));
 it('keeps opaque closure identity complete while marking package selector uncertainty', () => fixture((root,write) => {
  const l=lock() as unknown as {packages:Record<string,unknown>};l.packages['node_modules/alias']={name:'different',version:'1.0.0',integrity:'sha512-z'};write('package-lock.json',l);
  const r=extract(root);expect(r.manifest.unmodeled).toHaveLength(1);expect(r.facts.limitations.some(l=>l.code==='opaque-package-entry')).toBe(true);expect(r.facts.domains.packages).toBe('complete');expect(r.facts.domains.closure).toBe('complete');
 }));
 it('distinguishes unknown coverage gaps from intentional optional-peer omissions', () => {
  fixture((root,write) => {
   const p={...pkg,optionalDependencies:{missing:'1.0.0'}};write('package.json',p);write('package-lock.json',{...lock(),packages:{...lock().packages,'':p}});
   const r=extract(root);expect(r.facts.limitations.some(l=>l.code==='unclassified-coverage')).toBe(true);expect(r.facts.domains.closure).toBe('incomplete');
  });
  fixture((root,write) => {
   const p={...pkg,engines:{node:'22.22.2'}};
   const l=lock();l.packages['']=p;l.packages['node_modules/a']={version:'1.0.0',integrity:'sha512-a',peerDependencies:{optional:'^1.0.0'},peerDependenciesMeta:{optional:{optional:true}}};
   write('package.json',p);write('package-lock.json',l);write('Dockerfile',`FROM node@sha256:${'a'.repeat(64)}`);
   const r=extract(root,{...config,imageFiles:['Dockerfile'],runtimeFiles:['package.json']});
   expect(deriveFromLockfileV3(l).unsupported).toContain("unresolved optional peer 'optional' from node_modules/a: no node in the closure; edge omitted");
   expect(r.manifest.coverage.unsupported).toEqual([]);
   expect(r.facts.limitations).toEqual([]);
   expect(r.facts.domains).toEqual({packages:'complete',images:'complete',runtime:'complete',closure:'complete'});
  });
 });
 it('uses selected Dockerfile refs with genuine line anchors; ignores unrelated images', () => fixture((root,write) => {
  write('Dockerfile',`# hi\nFROM node:22@sha256:${'a'.repeat(64)} AS build\nFROM build AS final\n`);write('nested/Dockerfile','FROM ${HIDDEN}');
  const r=extract(root,{...config,imageFiles:['Dockerfile']});expect(r.manifest.images).toHaveLength(1);expect(r.manifest.images[0]!.evidenceRef).toBe('Dockerfile#L2');expect(r.facts.domains.images).toBe('complete');
 }));
 it('refuses variables, malformed FROM and ambiguous numeric stages with typed limitations', () => fixture((root,write) => {
  for(const text of ['FROM ${BASE}','FROM','FROM node:22 nonsense','FROM 0']) {write('Dockerfile',text);const r=extract(root,{...config,imageFiles:['Dockerfile']});expect(r.facts.domains.images).toBe('incomplete');expect(r.facts.domains.closure).toBe('incomplete');}
 }));
 it('preserves known image mismatches alongside incomplete image selection', () => fixture((root,write) => {
  write('Dockerfile','FROM node:22 AS build\nFROM ${UNRESOLVED}');const r=extract(root,{...config,imageFiles:['Dockerfile']});expect(r.manifest.images[0]!.name).toBe('node');expect(r.facts.domains.images).toBe('incomplete');
 }));
 it('conservatively marks current compose line scanner incomplete', () => fixture((root,write) => {
  write('compose.yaml','services:\n  app:\n    image: node:22');const r=extract(root,{...config,imageFiles:['compose.yaml']});expect(r.manifest.images).toHaveLength(1);expect(r.facts.domains.images).toBe('incomplete');
 }));
 it('cross-checks every runtime declaration even when not selected and normalizes one v', () => fixture((root,write) => {
  write('.nvmrc','v22.22.2\n');write('.node-version','22.22.2');const c={...config,runtimeFiles:['.nvmrc']};expect(extract(root,c).facts.domains.runtime).toBe('complete');
  write('package.json',{...pkg,engines:{node:'24.0.0'}});const r=extract(root,c);expect(r.facts.domains.runtime).toBe('incomplete');expect(r.facts.limitations.some(l=>l.code==='runtime-conflict')).toBe(true);
 }));
 it('refuses whitespace around package.json engines.node instead of normalizing it exact', () => fixture((root,write) => {
  write('package.json',{...pkg,engines:{node:' 22.22.2 '}});
  const r=extract(root,{...config,runtimeFiles:['package.json']});
  expect(r.facts.domains.runtime).toBe('incomplete');
  expect(r.facts.limitations.some(l=>l.code==='non-exact-runtime')).toBe(true);
 }));
 it('does not invent runtime declarations for empty/multiline/range input', () => fixture((root,write) => {
  for(const v of ['', '22', 'lts/*','22.22.2\n24.0.0']) { write('.nvmrc',v); expect(extract(root,{...config,runtimeFiles:['.nvmrc']}).facts.domains.runtime).toBe('incomplete'); }
 }));
 it('supports root-only pnpm through the existing parser and root truncation guard', () => fixture((root,write) => {
  fs.rmSync(path.join(root,'package-lock.json'));write('package.json',{name:'app',version:'1.0.0'});write('pnpm-lock.yaml',"lockfileVersion: '9.0'\nimporters:\n  .: {}\n");const c={...config,source:'pnpm-lockfile-v9' as const,lockfile:'pnpm-lock.yaml' as const};
  const r=extract(root,c);expect(r.facts.domains.packages).toBe('complete');expect(r.manifest.coverage.unsupported).toEqual([]);
  write('package.json',pkg);expect(()=>extract(root,c)).toThrow(/lost declared closure/);
 }));
 it('preserves the original checkout anchor for pnpm link paths after pinned materialization', () => {
  const source=path.resolve('fixtures/stack/pnpm-v9-real-shapes/link-reenter');
  const materialized=fs.mkdtempSync(path.join(tmpdir(),'bce-selected-link-anchor-'));
  try {
   fs.cpSync(source,materialized,{recursive:true});
   const c={...config,source:'pnpm-lockfile-v9' as const,lockfile:'pnpm-lock.yaml' as const};
   expect(()=>extractSelectedStack(materialized,'test-revision',c)).toThrow(/link: protocol value/);
   const r=extractSelectedStack(materialized,'test-revision',c,source);
   expect(r.manifest.unmodeled).toHaveLength(3);
   expect(r.facts.limitations.some(l=>l.code==='opaque-package-entry')).toBe(true);
  } finally { fs.rmSync(materialized,{recursive:true,force:true}); }
 });
 it('does not alter legacy snapshot notices through optional producer observers', () => fixture((root,write) => {
  const before=extractStackManifest(root,'test-revision');extract(root);expect(extractStackManifest(root,'test-revision')).toEqual(before);
 }));
 it('validates exact inventory, source bindings, warning map, derived domains and hashes offline', () => fixture((root,write) => {
  write('Dockerfile','FROM ${BASE}');const c={...config,imageFiles:['Dockerfile']};const good=extract(root,c);
  for(const mutate of [(r:typeof good)=>r.facts.inventory.pop(),(r:typeof good)=>r.facts.inventory[0]!.present=true,(r:typeof good)=>r.facts.limitations[0]!.manifestWarningIndexes=[],(r:typeof good)=>r.facts.domains.images='complete',(r:typeof good)=>r.facts.sourceConfigDigest='0'.repeat(64),(r:typeof good)=>r.manifest.images.push({ref:'evil',name:'evil',tag:'latest',tagImplicit:true,digest:null,pin:false,resolved:false,resolvedFrom:'dockerfile',evidenceRef:'elsewhere#L1'})]) {
   const r=structuredClone(good);mutate(r);expect(validateSelectedStack(c,r.manifest,r.facts).length).toBeGreaterThan(0);
  }
  expect(stackSourceConfigDigest(c)).toBe(good.facts.sourceConfigDigest);
 }));
 it('rejects coherently rehashed unselected runtime injection', () => fixture(root => {
  const r=extract(root);const {manifestDigest,stackDigest,stackId,...body}=r.manifest;body.runtime.node={declared:'22.22.2',resolvedFrom:'nvmrc',pin:true};r.manifest=finalizeStackManifest(body);r.facts.manifestDigest=r.manifest.manifestDigest;
  expect(validateSelectedStack(config,r.manifest,r.facts)).toContain('runtime source is not selected');
 }));
 it('keeps a referenced opaque alias closure gradeable without inferring its package name', () => fixture((root,write) => {
  const p={...pkg,dependencies:{...pkg.dependencies,alias:'npm:different@1.0.0'}};
  write('package.json',p);write('package-lock.json',{...lock(),packages:{...lock().packages,'':p,'node_modules/alias':{name:'different',version:'1.0.0',integrity:'sha512-z'}}});
  const r=extract(root);expect(r.facts.domains.closure).toBe('complete');expect(r.facts.limitations.every(l=>l.code==='opaque-package-entry')).toBe(true);
 }));
 it('blocks workspace pnpm without reading unbound importer files', () => fixture((root,write) => {
  fs.rmSync(path.join(root,'package-lock.json'));write('package.json',{name:'app',version:'1.0.0'});
  write('pnpm-lock.yaml',"lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/a: {}\n");
  const r=extract(root,{...config,source:'pnpm-lockfile-v9',lockfile:'pnpm-lock.yaml'});
  expect(r.facts.domains.packages).toBe('incomplete');expect(r.facts.limitations.some(l=>l.code==='unsupported-package-manager-config')).toBe(true);expect(r.facts.inventory.some(i=>i.path==='packages/a/package.json')).toBe(false);
 }));
 it('rejects coherently rehashed invalid node/edge/image/runtime facts', () => fixture((root,write) => {
  write('Dockerfile','FROM node:22');write('.nvmrc','22.22.2');const c={...config,imageFiles:['Dockerfile'],runtimeFiles:['.nvmrc']};const good=extract(root,c);
  for(const mutate of [(m:typeof good.manifest)=>m.nodes[0]!.id='npm:fake@1.0.0',(m:typeof good.manifest)=>m.edges[0]!.to='missing',(m:typeof good.manifest)=>m.runtime.node.pin=false,(m:typeof good.manifest)=>m.images[0]!.name='forged',(m:typeof good.manifest)=>m.nodes.find(n=>n.kind==='node-runtime')!.version='24.0.0']) {
   const r=structuredClone(good);mutate(r.manifest);const {manifestDigest,stackDigest,stackId,...body}=r.manifest;r.manifest=finalizeStackManifest(body);r.facts.manifestDigest=r.manifest.manifestDigest;expect(validateSelectedStack(c,r.manifest,r.facts).length).toBeGreaterThan(0);
  }
 }));

});
