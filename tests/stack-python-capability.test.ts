import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseBlueprint } from '../src/schema.js';
import { computeGateReport } from '../src/gate.js';
import { prepareDeclaredEvidence, evaluatePreparedEvidence, canonicalHash } from '../src/stack/stack-evaluation.js';
import { createDeclaredStackBundle, verifyEvidenceBundle } from '../src/evidence-bundle.js';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-stack-python-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.mkdirSync(path.join(root, '.blueprints'));
  fs.writeFileSync(path.join(root, 'src/main.py'), 'import urllib.request\nurllib.request.urlopen("https://forbidden.example")\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name:'app',version:'1.0.0'}));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({lockfileVersion:3,packages:{'':{name:'app',version:'1.0.0'}}}));
});
afterEach(() => fs.rmSync(root, {recursive:true,force:true}));

describe.each(['python-import-surface', 'python-module-graph'] as const)('%s with declared stack', profile => {
  it('refuses unsupported egress in preparation, ordinary gate and independent replay', () => {
    const raw = {
      apiVersion:'blueprint-conformance/v1alpha1',kind:'EngineeringBlueprint',
      metadata:{id:'mixed',version:'1.0.0',status:'draft'},intentRefs:['policy/mixed'],
      scope:{repositories:['example/app'],paths:['src/**']},architecture:{components:[],relationships:[]},
      constraints:[
        {id:'egress',type:'forbiddenEgress',severity:'high',to:'forbidden.example'},
        {id:'stack',type:'forbiddenStackPackage',severity:'high',packageName:'forbidden-package'},
      ],
      evidenceRequirements:[{type:'staticAst',required:true,onMissing:'block'},{type:'declaredStack',required:true,onMissing:'block'}],
      approvals:[],minEngineVersion:'0.5.0',
      extraction:{profile,paths:['src/**/*.py'],minFiles:1,...(profile==='python-module-graph'?{pythonRoots:['src']}:{})},
      stack:{source:'npm-lockfile-v3',lockfile:'package-lock.json',packageManifest:'package.json',imageFiles:[],runtimeFiles:[]},
    };
    if (profile === 'python-module-graph') {
      expect(() => parseBlueprint(raw)).toThrow('forbiddenEgress is not supported by python-module-graph');
      fs.writeFileSync(path.join(root,'.blueprints/mixed.blueprint.json'), JSON.stringify(raw));
      expect(computeGateReport(root,path.join(root,'.blueprints'),null,'ast').doc.exitCode).toBe(2);
      return;
    }
    const bp = parseBlueprint(raw);
    const evidence = prepareDeclaredEvidence(bp, root, 'fixture', 'ast');
    expect(evidence.refusals).toEqual(expect.arrayContaining([expect.objectContaining({constraintId:'egress',code:'unsupported-code-capability'})]));
    expect(evidence.graph?.coverage.filesScanned).toBe(1);
    // Replay callers cannot erase a provider limitation by dropping acquisition refusals.
    const report = evaluatePreparedEvidence(bp, {...evidence,refusals:[]}, profile);
    expect(report).toMatchObject({schemaVersion:'2',verdict:'indeterminate',score:null});
    if (report.schemaVersion !== '2') throw new Error('v2 required');
    const bundle = createDeclaredStackBundle({blueprint:bp,evidence,report,engineVersion:'0.5.0',command:'bce run',extractionProfile:profile});
    expect(verifyEvidenceBundle(bundle).valid).toBe(true);
    // Even coherent rehashing of a fabricated pass cannot bypass capability checks.
    bundle.artifacts.report = {...report,verdict:'pass',score:100,refusals:[]};
    bundle.hashes.report = canonicalHash(bundle.artifacts.report);
    const {bundle: _ignored, ...hashes} = bundle.hashes;
    bundle.hashes.bundle = canonicalHash({...bundle,hashes});
    expect(verifyEvidenceBundle(bundle)).toMatchObject({valid:false});
    fs.writeFileSync(path.join(root,'.blueprints/mixed.blueprint.json'), JSON.stringify(bp));
    expect(computeGateReport(root,path.join(root,'.blueprints'),null,'ast').doc.exitCode).toBe(2);
  });
});
