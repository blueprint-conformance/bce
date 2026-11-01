#!/usr/bin/env node
// Data only: no engine import, package execution, download or current-evaluator replay.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stable = value => JSON.stringify(canonical(value), null, 2) + '\n';
export const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const equal = (a, b) => stable(a) === stable(b);
function read(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('evidence must be a regular JSON file no larger than 4 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function loadCapture(directory) {
  return { receipt: read(path.join(directory, 'capture.json')), bundle: read(path.join(directory, 'bundle.json')), report: read(path.join(directory, 'report.json')) };
}
function validate(capture, admission) {
  const failures = [];
  try {
    const { receipt: r, bundle: b, report } = capture, source = r.before;
    if (!Array.isArray(r.measurementErrors) || r.measurementErrors.length) failures.push('capture measurements incomplete');
    if (['tarballSha256', 'dependencyLockSha256', 'dependencyTreeSha256'].some(key => !/^[0-9a-f]{64}$/.test(r.artifact[key])) ||
        !Array.isArray(r.artifact.distInventory) || !r.artifact.distInventory.length ||
        r.artifact.distInventory.some(file => typeof file.path !== 'string' || !/^[0-9a-f]{64}$/.test(file.sha256))) failures.push('invalid artifact identity');
    if (admission.artifact.name !== 'bce-engine' || !admission.provenance || !equal(r.artifact, admission.artifact)) failures.push('artifact differs from the externally reviewed identity');
    if (!equal(r.artifact, r.artifactAfter)) failures.push('executed artifact or dependency tree changed');
    if (!equal(source, r.after) || !/^[0-9a-f]{40}$/.test(source.revision)) failures.push('source identity or immutability mismatch');
    if (!Array.isArray(source.files) || new Set(source.files.map(file => file.path)).size !== source.files.length ||
        source.files.some(file => !/^[0-9a-f]{64}$/.test(file.sha256))) failures.push('invalid source inventory');
    if (!/^[0-9a-f]{64}$/.test(source.policyBytesSha256) || source.policyDigest !== digest(source.policy) || source.files.find(file => file.path === 'policy.json')?.sha256 !== source.policyBytesSha256) failures.push('policy identity mismatch');
    const expected = source.files.filter(file => /^packages\/(?:[^/]+\/)*[^/]+\.ts$/.test(file.path)).map(file => file.path).sort();
    if (!expected.length || !equal(expected, source.expectedModules)) failures.push('expected module inventory mismatch');
    for (const [label, result] of [['execution', r.process], ['configuration', r.configuration]]) {
      if (!Array.isArray(result.argv) || !result.argv.length || result.argv.some(value => typeof value !== 'string') ||
          typeof result.stdout !== 'string' || typeof result.stderr !== 'string' || typeof result.timeout !== 'boolean' || typeof result.outputLimit !== 'boolean' ||
          !(result.error === null || typeof result.error === 'string') || !(result.signal === null || typeof result.signal === 'string') ||
          !Number.isInteger(result.timeoutMs) || result.timeoutMs <= 0 || result.timeoutMs > 60_000 ||
          !Number.isInteger(result.limitBytes) || result.limitBytes <= 0 || result.limitBytes > 1024 * 1024) failures.push(`${label} receipt incomplete`);
      if (result.error || result.timeout || result.outputLimit || result.signal || !Number.isInteger(result.exit) ||
          (label === 'configuration' ? result.exit !== 0 : ![0, 1].includes(result.exit))) failures.push(`${label} incomplete`);
    }
    if (r.resolvedExtraction?.profile !== 'typescript-module-graph' || !equal(JSON.parse(r.configuration.stdout), r.resolvedExtraction)) failures.push('missing or inconsistent resolved acquisition');
    if (b.schemaVersion !== '1' || b.kind !== 'BceEvidenceBundle' || b.claim !== 'self-contained-integrity-not-origin-authenticity') failures.push('unsupported bundle envelope');
    if (b.invocation.extractionProfile !== 'typescript-module-graph' || b.toolchain.extractor.provider !== 'typescript-ts-morph' ||
        b.toolchain.extractor.profile !== 'typescript-module-graph' || b.toolchain.extractor.kind !== 'ast') failures.push('unsupported profile/provider');
    if (b.engine.name !== 'bce-engine' || b.engine.version !== r.artifact.version || b.toolchain.engine.version !== r.artifact.version ||
        b.toolchain.dependencyLock.sha256 !== r.artifact.dependencyLockSha256 || b.environment.node !== r.artifact.node ||
        b.environment.platform !== r.artifact.platform || b.environment.arch !== r.artifact.arch) failures.push('engine/lock/runtime capture mismatch');
    for (const key of ['blueprint', 'graph', 'report']) if (digest(b.artifacts[key]) !== b.hashes[key]) failures.push(`${key} hash mismatch`);
    const { bundle: bundleHash, ...hashes } = b.hashes;
    if (digest({ ...b, hashes }) !== bundleHash) failures.push('bundle hash mismatch');
    if (!equal(report, b.artifacts.report)) failures.push('raw report differs from captured bundle');
    const { graph: graph, blueprint: bp } = b.artifacts;
    if (!equal(bp, source.policy) || digest(bp) !== source.policyDigest) failures.push('captured policy mismatch');
    if (graph.ctRepoRevision !== source.revision || report.ctRepoRevision !== source.revision) failures.push('source revision mismatch');
    if (bp.extraction.profile !== 'typescript-module-graph' || !equal(bp.extraction.paths, ['packages/**/*.ts']) ||
        !equal(bp.evidenceRequirements, [{ type: 'staticAst', required: true, onMissing: 'block' }])) failures.push('unsupported acquisition/evidence envelope');
    if (!equal([...graph.coverage.scannedFiles].sort(), expected) || graph.coverage.filesScanned !== expected.length ||
        expected.length < Math.max(1, bp.extraction.minFiles ?? 1) || !equal(graph.components.map(component => component.path).sort(), expected) ||
        graph.components.some(component => component.type !== 'typescriptModule' || component.id !== `module:${component.path}`)) failures.push('incomplete module inventory');
    if (graph.coverage.unresolvedImports?.length) failures.push('unresolved evidence');
    const ids = new Set(graph.components.map(component => component.id));
    if (!Array.isArray(graph.guardEdges) || graph.guardEdges.some(edge => edge.type !== 'imports' || !ids.has(edge.from) ||
        typeof edge.to !== 'string' || typeof edge.evidenceRef !== 'string')) failures.push('malformed dependency inventory');
    if (!Array.isArray(graph.coverage.unsupported) || graph.coverage.unsupported.some(value => typeof value !== 'string') || graph.coverage.extractor !== 'ast') failures.push('malformed coverage');
    if (!Array.isArray(report.violations) || report.schemaVersion !== '1' || !['pass', 'fail'].includes(report.verdict) || !Number.isFinite(report.score) ||
        r.process.exit !== (report.verdict === 'pass' ? 0 : 1)) failures.push('malformed report or exit mismatch');
    for (const violation of report.violations) if (['constraintId', 'severity', 'component', 'evidenceType', 'evidenceRef', 'observed', 'expected'].some(key => typeof violation[key] !== 'string')) failures.push('malformed violation');
    for (const key of ['extractor', 'filesScanned', 'unsupported', 'unresolvedImports']) if (!equal(report.coverage[key], graph.coverage[key])) failures.push('report and graph coverage differ');
  } catch (error) { failures.push(`malformed or missing evidence: ${error.message}`); }
  return [...new Set(failures)];
}
export function compare(base, candidate, baseAdmission, candidateAdmission) {
  const refusals = [...validate(base, baseAdmission).map(reason => `base: ${reason}`), ...validate(candidate, candidateAdmission).map(reason => `candidate: ${reason}`)];
  if (!refusals.length) {
    if (!equal(base.receipt.before, candidate.receipt.before)) refusals.push('source or policy differs');
    if (!equal(base.receipt.resolvedExtraction, candidate.receipt.resolvedExtraction)) refusals.push('resolved acquisition differs');
    if (!equal(base.bundle.environment, candidate.bundle.environment)) refusals.push('runtime environment differs');
  }
  if (refusals.length) return { status: 'incomparable', refusals };
  const a = base.bundle.artifacts, b = candidate.bundle.artifacts;
  const sections = { report: !equal(a.report, b.report), graph: !equal(a.graph, b.graph), coverage: !equal(a.graph.coverage, b.graph.coverage),
    components: !equal(a.graph.components, b.graph.components), dependencies: !equal(a.graph.guardEdges, b.graph.guardEdges) };
  return { status: Object.values(sections).some(Boolean) ? 'changed-observations' : 'equivalent-observations', sections,
    artifactIdentityChanged: !equal(base.receipt.artifact, candidate.receipt.artifact), baseExit: base.receipt.process.exit, candidateExit: candidate.receipt.process.exit,
    claim: 'Captured fixture observations only; no origin authentication, upgrade approval or compatibility guarantee.' };
}
function isMain() {
  try { return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; } // Imports need not have an existing filesystem entry point.
}
if (isMain()) {
  let result;
  try {
    const [base, candidate, baseAdmission, candidateAdmission, ...extra] = process.argv.slice(2);
    if (!base || !candidate || !baseAdmission || !candidateAdmission || extra.length) throw new Error('usage: compare.mjs <base-capture-dir> <candidate-capture-dir> <base-identity.json> <candidate-identity.json>');
    result = compare(loadCapture(base), loadCapture(candidate), read(baseAdmission), read(candidateAdmission));
  } catch (error) { result = { status: 'incomparable', refusals: [error.message] }; }
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === 'incomparable' ? 2 : result.status === 'changed-observations' ? 1 : 0;
}
