#!/usr/bin/env node
/** Deterministic synthetic scale track with a real planted RED control. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'bce-scale-proof-'));
const blueprintDir = join(scratch, '.blueprints');
const reportPath = join(scratch, 'gate-report.json');
const packageCount = 20;
const filesPerPackage = 100;
const totalFiles = packageCount * filesPerPackage;
const budgetMs = 30_000;

try {
  mkdirSync(blueprintDir, { recursive: true });
  for (let pkg = 0; pkg < packageCount; pkg += 1) {
    const src = join(scratch, 'packages', `package-${String(pkg).padStart(2, '0')}`, 'src');
    mkdirSync(src, { recursive: true });
    for (let file = 0; file < filesPerPackage; file += 1) {
      writeFileSync(join(src, `module-${String(file).padStart(3, '0')}.ts`),
        `export const value_${pkg}_${file} = ${pkg * filesPerPackage + file};\n`);
    }
  }
  writeFileSync(join(blueprintDir, 'scale.blueprint.json'), JSON.stringify({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'synthetic-scale', name: 'Synthetic scale boundary', version: '1.0.0', status: 'approved', ownerRole: 'benchmark-owner', stewardRole: 'benchmark-steward' },
    intentRefs: ['research/synthetic-scale'],
    scope: { repositories: ['synthetic-scale'], paths: ['packages/**/*.ts'], environments: ['test'] },
    extraction: { profile: 'plugin-surface', paths: ['packages/**/*.ts'], guardSymbols: [], governedModules: [], forbiddenImports: ['axios'], minFiles: totalFiles },
    architecture: { components: [], relationships: [] },
    constraints: [{ id: 'no-axios', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'axios', policyRef: 'research/synthetic-scale' }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'benchmark-steward', stage: 'ratify' }],
  }, null, 2) + '\n');

  const runGate = () => {
    const started = performance.now();
    const run = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'gate',
      '--repo', scratch, '--blueprint-dir', blueprintDir, '--extractor', 'ast', '--report-json', reportPath],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return { run, elapsedMs: performance.now() - started, report: JSON.parse(readFileSync(reportPath, 'utf8')) };
  };

  const greenSamples = [runGate(), runGate(), runGate()];
  for (const sample of greenSamples) {
    if (sample.run.status !== 0 || sample.report.outcome !== 'pass') throw new Error(`scale GREEN failed: ${sample.run.stderr}`);
    if (sample.report.reports?.[0]?.coverage?.filesScanned !== totalFiles) throw new Error('scale proof did not scan the declared file population');
  }
  const planted = join(scratch, 'packages', 'package-19', 'src', 'module-099.ts');
  writeFileSync(planted, `import axios from 'axios';\nexport const value_19_99 = axios;\n`);
  const red = runGate();
  if (red.run.status !== 1 || red.report.outcome !== 'violation') throw new Error(`scale RED failed: ${red.run.stderr}`);
  if (!JSON.stringify(red.report).includes('packages/package-19/src/module-099.ts#L1')) throw new Error('scale RED omitted the planted file/line');

  const timings = greenSamples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const p95 = timings[Math.ceil(timings.length * 0.95) - 1];
  if (p95 > budgetMs) throw new Error(`scale p95 ${p95.toFixed(1)}ms exceeds ${budgetMs}ms budget`);
  console.log(`scale-proof: PASS (${totalFiles} TS files, 3 GREEN samples p95 ${p95.toFixed(1)}ms/${budgetMs}ms, planted RED ${red.elapsedMs.toFixed(1)}ms)`);

  // Structured Python is a distinct provider and resolver, so it earns its own 2,000-file
  // release budget and final-file RED control instead of inheriting the TypeScript result.
  const pythonRoot = join(scratch, 'python-repo');
  const pythonBlueprintDir = join(pythonRoot, '.blueprints');
  const pythonReportPath = join(pythonRoot, 'gate-report.json');
  mkdirSync(pythonBlueprintDir, { recursive: true });
  for (let pkg = 0; pkg < packageCount; pkg += 1) {
    const src = join(pythonRoot, 'src', `package_${String(pkg).padStart(2, '0')}`);
    mkdirSync(src, { recursive: true });
    for (let file = 0; file < filesPerPackage; file += 1) {
      writeFileSync(
        join(src, `module_${String(file).padStart(3, '0')}.py`),
        `VALUE_${pkg}_${file} = ${pkg * filesPerPackage + file}\n`,
      );
    }
  }
  writeFileSync(join(pythonBlueprintDir, 'python-scale.blueprint.json'), JSON.stringify({
    apiVersion: 'blueprint-conformance/v1alpha1',
    kind: 'EngineeringBlueprint',
    metadata: { id: 'synthetic-python-scale', name: 'Synthetic Python scale boundary', version: '1.0.0', status: 'approved', ownerRole: 'benchmark-owner', stewardRole: 'benchmark-steward' },
    intentRefs: ['research/synthetic-python-scale'],
    scope: { repositories: ['synthetic-python-scale'], paths: ['src/**/*.py'], environments: ['test'] },
    extraction: { profile: 'python-module-graph', paths: ['src/**/*.py'], pythonRoots: ['src'], minFiles: totalFiles },
    architecture: { components: [{ id: 'pythonModules', type: 'pythonModule' }], relationships: [] },
    constraints: [
      { id: 'python-surface-exists', type: 'requiredComponent', severity: 'high', component: 'pythonModule', policyRef: 'research/synthetic-python-scale' },
      { id: 'no-import-of-final-module', type: 'forbiddenDependency', severity: 'critical', from: '*', to: 'module:src/package_19/module_099.py', scopePaths: ['src/**/*.py'], policyRef: 'research/synthetic-python-scale' },
    ],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }],
    approvals: [{ role: 'benchmark-steward', stage: 'ratify' }],
    minEngineVersion: '0.3.0',
  }, null, 2) + '\n');

  const runPythonGate = () => {
    const started = performance.now();
    const run = spawnSync(process.execPath, [join(root, 'dist', 'cli.js'), 'gate',
      '--repo', pythonRoot, '--blueprint-dir', pythonBlueprintDir, '--extractor', 'ast', '--report-json', pythonReportPath],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    return { run, elapsedMs: performance.now() - started, report: JSON.parse(readFileSync(pythonReportPath, 'utf8')) };
  };

  const pythonGreenSamples = [runPythonGate(), runPythonGate(), runPythonGate()];
  for (const sample of pythonGreenSamples) {
    if (sample.run.status !== 0 || sample.report.outcome !== 'pass') throw new Error(`Python scale GREEN failed: ${sample.run.stderr}`);
    if (sample.report.reports?.[0]?.coverage?.filesScanned !== totalFiles) throw new Error('Python scale proof did not scan the declared file population');
  }
  const pythonPlanted = join(pythonRoot, 'src', 'package_00', 'module_000.py');
  writeFileSync(pythonPlanted, 'from package_19 import module_099\nVALUE_0_0 = module_099\n');
  const pythonRed = runPythonGate();
  if (pythonRed.run.status !== 1 || pythonRed.report.outcome !== 'violation') throw new Error(`Python scale RED failed: ${pythonRed.run.stderr}`);
  if (!JSON.stringify(pythonRed.report).includes('src/package_00/module_000.py#L1')) throw new Error('Python scale RED omitted the planted file/line');

  const pythonTimings = pythonGreenSamples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const pythonP95 = pythonTimings[Math.ceil(pythonTimings.length * 0.95) - 1];
  if (pythonP95 > budgetMs) throw new Error(`Python scale p95 ${pythonP95.toFixed(1)}ms exceeds ${budgetMs}ms budget`);
  console.log(`scale-proof: PASS (${totalFiles} Python files, 3 GREEN samples p95 ${pythonP95.toFixed(1)}ms/${budgetMs}ms, planted RED ${pythonRed.elapsedMs.toFixed(1)}ms)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
