import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseBlueprint } from '../src/schema.js';
import { prepareDeclaredEvidence, evaluatePreparedEvidence } from '../src/stack/stack-evaluation.js';
import { computeGateReport } from '../src/gate.js';
import { createDeclaredStackBundle, verifyEvidenceBundle } from '../src/evidence-bundle.js';
import { stableStringify } from '../src/report.js';

const dirs: string[] = [];
afterAll(() => dirs.forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(kind: 'clean' | 'missing-roots' | 'unresolved') {
  const dir = mkdtempSync(path.join(tmpdir(), 'bce-mixed-path-')); dirs.push(dir);
  mkdirSync(path.join(dir, '.blueprints')); mkdirSync(path.join(dir, 'src/domain'), { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), '{"name":"mixed","version":"1.0.0"}');
  writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({name:'mixed',version:'1.0.0',lockfileVersion:3,packages:{'':{name:'mixed',version:'1.0.0'}}}));
  writeFileSync(path.join(dir, 'src/domain/order.ts'), "import '../bridge.js';\n");
  writeFileSync(path.join(dir, 'src/bridge.ts'), kind === 'unresolved' ? 'void import(process.env.TARGET);\n' : 'export const value = 1;\n');
  const bp = parseBlueprint({apiVersion:'blueprint-conformance/v1alpha1',kind:'EngineeringBlueprint',metadata:{id:'mixed-path',version:'1.0.0',status:'draft'},intentRefs:['intent/mixed-path'],scope:{repositories:['example/repo'],paths:['src/**']},architecture:{components:[],relationships:[]},constraints:[
    {id:'no-legacy',type:'forbiddenStackPackage',severity:'critical',packageName:'legacy'},
    {id:'bounded',type:'forbiddenDependencyPath',severity:'critical',maxHops:2,to:'module:src/app/**',scopePaths:[kind === 'missing-roots' ? 'src/absent/**' : 'src/domain/**']},
  ],evidenceRequirements:[{type:'staticAst',required:true,onMissing:'block'},{type:'declaredStack',required:true,onMissing:'block'}],approvals:[],minEngineVersion:'0.6.1',extraction:{profile:'typescript-module-graph',paths:['src/**/*.ts'],minFiles:1},stack:{source:'npm-lockfile-v3',lockfile:'package-lock.json',packageManifest:'package.json',imageFiles:[],runtimeFiles:[]}});
  const blueprintPath = path.join(dir, '.blueprints/mixed.blueprint.json'); writeFileSync(blueprintPath, stableStringify(bp));
  return {dir,bp,blueprintPath};
}
function cli(...args: string[]) { return spawnSync(process.execPath, [path.resolve('dist/cli.js'), ...args], { encoding:'utf8' }); }

describe('mixed declared-stack and bounded dependency refusals', () => {
  it('keeps the default-profile API clean control gradeable', () => {
    const {dir,bp} = fixture('clean');
    const report = evaluatePreparedEvidence(bp, prepareDeclaredEvidence(bp, dir, 'fixture'));
    expect(report).toMatchObject({schemaVersion:'2',verdict:'pass',score:100,refusals:[]});
  });
  it.each(['missing-roots','unresolved'] as const)('%s persists a structured refusal through API, replay, CLI gate and run, including advisory mode', kind => {
    const {dir,bp,blueprintPath} = fixture(kind);
    const evidence = prepareDeclaredEvidence(bp, dir, 'fixture');
    const report = evaluatePreparedEvidence(bp, evidence);
    expect(report).toMatchObject({schemaVersion:'2',verdict:'indeterminate',score:null,refusals:[{constraintId:'bounded',evidenceClass:'staticAst',code:'dependency-path-incomplete',sources:['src/**/*.ts']}]});
    if (report.schemaVersion !== '2') throw new Error('schema 2 required');
    expect(report.coverage.providers.map(p => p.evidenceClass)).toEqual(['staticAst','declaredStack']);
    expect(report.refusals[0]!.reason).toContain(kind === 'missing-roots' ? 'no source modules match' : 'unresolved imports');
    const bundle = createDeclaredStackBundle({blueprint:bp,evidence,report,engineVersion:'0.6.1',command:'bce run',extractionProfile:'typescript-module-graph'});
    expect(verifyEvidenceBundle(JSON.parse(stableStringify(bundle)))).toMatchObject({valid:true});
    expect(computeGateReport(dir, path.join(dir,'.blueprints'), null, 'ast').doc).toMatchObject({outcome:'refusal',exitCode:2});
    for (const mode of ['enforced','advisory']) {
      writeFileSync(path.join(dir,'.bce-mode.json'), JSON.stringify({mode}));
      const gateOut = path.join(dir,`gate-${mode}.json`);
      const gated = cli('gate','--repo',dir,'--report-json',gateOut);
      expect(gated.status, gated.stderr).toBe(2);
      const gateDoc = JSON.parse(readFileSync(gateOut,'utf8'));
      expect(gateDoc).toMatchObject({outcome:'refusal',exitCode:2});
      expect(gateDoc.reports[0]).toMatchObject({schemaVersion:'2',verdict:'indeterminate',score:null});
      const runOut = path.join(dir,`run-${mode}.json`);
      const ran = cli('run','--blueprint',blueprintPath,'--ct-repo',dir,'--no-pin','--out',runOut);
      expect(ran.status, ran.stderr).toBe(2);
      expect(JSON.parse(readFileSync(runOut,'utf8'))).toMatchObject({schemaVersion:'2',verdict:'indeterminate',score:null,refusals:[{constraintId:'bounded',code:'dependency-path-incomplete'}]});
    }
  });
});
