#!/usr/bin/env node
/** Build the separate, permanently non-confirmatory eight-attempt instrumentation pilot. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedSeal, fileArtifact, hashTree, regenerateAssignments, sha256Bytes, verifyBundle } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceCommitResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
const sourceStatusResult = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' });
if (sourceCommitResult.status !== 0 || sourceStatusResult.status !== 0) throw new Error('pilot builder could not establish source Git provenance');
const sourceCommit = sourceCommitResult.stdout.trim();
const sourceTreeState = sourceStatusResult.stdout.trim() === '' ? 'clean' : 'dirty-development-only';
const pilotVersion = valueAfter('--pilot-version') ?? 'v3';
if (!/^v[1-9][0-9]*$/.test(pilotVersion)) throw new Error('--pilot-version must be v1, v2, and so on');
const output = resolve(valueAfter('--out') ?? join(root, 'research', 'model-evaluation', 'pilots', `accelerated-${pilotVersion}`));
if (existsSync(output)) throw new Error(`pilot builder refuses to overwrite existing path: ${output}`);
const studyId = `bce-accelerated-instrumentation-pilot-${pilotVersion}-2026-09-03`;
const canonicalRoot = join(root, 'research', 'model-evaluation');
mkdirSync(join(output, 'schemas'), { recursive: true });
mkdirSync(join(output, 'artifacts'), { recursive: true });
mkdirSync(join(output, 'repos'), { recursive: true });
for (const name of ['protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json', 'seal.schema.json', 'treatment-delta.schema.json', 'protected-paths.schema.json']) {
  copyFileSync(join(canonicalRoot, 'schemas', name), join(output, 'schemas', name));
}
if (pilotVersion === 'v1') copyFileSync(join(canonicalRoot, 'protocol-amendments.jsonl'), join(output, 'protocol-amendments.jsonl'));
else {
  const amendments = {
    v2: {
      amendmentId: 'v2-pretrial-isolation-fix-forward',
      recordedAt: '2026-09-03T01:15:00Z',
      supersedesPilot: 'bce-accelerated-instrumentation-pilot-2026-09-03',
      retainedPriorResultSha256: 'c1ac3958d670dab11e895edc0167e5eb31f569227b89cf32217f61da88244985',
      reason: 'Pilot v1 retained 8/8 failed launches because home-directory read denial blocked the NVM-installed Codex launcher. V2 freezes and stages native Codex plus a standalone Node runtime, positively probes the generated MCP path, and seals the BCE treatment as an offline installed dependency closure.',
    },
    v3: {
      amendmentId: 'v3-client-sandbox-ownership-fix-forward',
      recordedAt: '2026-09-03T02:14:14Z',
      supersedesPilot: 'bce-accelerated-instrumentation-pilot-v2-2026-09-03',
      retainedPriorResultSha256: 'e66be3c2ddfba870922933866e7e20bbf37a805a1a2c385f502dad5b28fff022',
      reason: 'Pilot v2 retained 8/8 completed client sessions but 0/8 task successes because Codex could not initialize its inner workspace-write sandbox inside the active outer macOS sandbox. V3 makes the frozen deny-by-default outer profile the sole confinement boundary and disables nested client sandboxing.',
    },
  };
  const amendment = amendments[pilotVersion];
  if (!amendment) throw new Error(`${pilotVersion}: no explicit fix-forward amendment is defined`);
  writeFileSync(join(output, 'protocol-amendments.jsonl'), `${JSON.stringify({
    schemaVersion: '1', ...amendment, beforeFirstModelExposure: true, resultsInspected: true,
    changesOutcomeDefinition: false, eligibleForConfirmatoryPooling: false,
  })}\n`);
}
for (const name of ['treatment-delta.v1.json', 'protected-paths.v1.json']) {
  const document = JSON.parse(readFileSync(join(canonicalRoot, name), 'utf8'));
  document.studyId = studyId;
  writeFileSync(join(output, name), `${JSON.stringify(document, null, 2)}\n`);
}

const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', join(output, 'artifacts')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
const jsonStart = packed.stdout.lastIndexOf('\n[');
const packResult = JSON.parse(jsonStart >= 0 ? packed.stdout.slice(jsonStart + 1) : packed.stdout);
const tarballName = packResult[0]?.filename;
if (!tarballName) throw new Error('npm pack did not report an artifact filename');
const tarballPath = join(output, 'artifacts', tarballName);

const treatmentScratch = mkdtempSync(join(tmpdir(), 'bce-treatment-closure-'));
const treatmentRuntime = join(treatmentScratch, 'runtime');
const treatmentArchiveName = `bce-treatment-runtime-${pilotVersion}.tgz`;
const treatmentArchivePath = join(output, 'artifacts', treatmentArchiveName);
let installedTreeSha256;
try {
  const installed = spawnSync('npm', ['install', '--prefix', treatmentRuntime, '--ignore-scripts', '--no-audit', '--no-fund', '--no-save', '--package-lock=false', tarballPath], {
    cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (installed.status !== 0) throw new Error(`offline treatment closure build failed:\n${installed.stderr}`);
  const installOnlyLock = join(treatmentRuntime, 'node_modules', '.package-lock.json');
  if (existsSync(installOnlyLock)) rmSync(installOnlyLock);
  installedTreeSha256 = hashTree(treatmentRuntime, { includeNodeModules: true });
  const archived = spawnSync('/usr/bin/tar', ['-czf', treatmentArchivePath, '-C', treatmentRuntime, '.'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  if (archived.status !== 0) throw new Error(`offline treatment closure archive failed:\n${archived.stderr}`);
} finally {
  rmSync(treatmentScratch, { recursive: true, force: true });
  if (existsSync(tarballPath)) rmSync(tarballPath);
}

function nativeCodexExecutable(launcher) {
  const entry = realpathSync(launcher);
  if (!entry.endsWith(`${join('bin', 'codex.js')}`)) return entry;
  const targets = {
    'darwin-arm64': ['@openai', 'codex-darwin-arm64', 'aarch64-apple-darwin'],
    'darwin-x64': ['@openai', 'codex-darwin-x64', 'x86_64-apple-darwin'],
  };
  const target = targets[`${platform()}-${arch()}`];
  if (!target) throw new Error(`no frozen native Codex artifact mapping for ${platform()}-${arch()}`);
  const packageRoot = resolve(dirname(entry), '..');
  const candidate = join(packageRoot, 'node_modules', target[0], target[1], 'vendor', target[2], 'bin', 'codex');
  if (!existsSync(candidate)) throw new Error(`native Codex artifact not found at ${candidate}`);
  return realpathSync(candidate);
}
const codexLauncher = realpathSync(resolve(valueAfter('--codex') ?? '/opt/homebrew/bin/codex'));
const codexPath = nativeCodexExecutable(codexLauncher);
const version = spawnSync(codexPath, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error(`Codex version probe failed: ${version.stderr}`);
const nvmRuntimeMatch = codexLauncher.match(/^(.*\/versions\/node\/v[^/]+)\/lib\/node_modules\//);
const runtimePath = realpathSync(resolve(valueAfter('--node') ?? (nvmRuntimeMatch ? join(nvmRuntimeMatch[1], 'bin', 'node') : process.execPath)));
const runtimeVersion = spawnSync(runtimePath, ['--version'], { encoding: 'utf8' });
if (runtimeVersion.status !== 0) throw new Error(`Node runtime probe failed: ${runtimeVersion.stderr}`);
const protocol = JSON.parse(readFileSync(join(canonicalRoot, 'protocol.v2.json'), 'utf8'));
Object.assign(protocol, {
  studyId,
  canonical: true,
  phase: 'pilot',
  status: 'frozen-ready-not-run',
  results: null,
  researchQuestion: 'Can the sealed controller complete all eight development-only attempts with intact isolation, deterministic external oracles, terminal records, and offline replay?',
  claimScope: 'instrumentation-only-eight-attempt-development-pilot-no-product-efficacy-claim',
});
protocol.matrix = {
  clientModelCells: 1,
  repositories: 2,
  tasksPerRepository: 2,
  taskTypes: ['repair', 'feature'],
  trialsPerArmPerCell: 4,
  totalRandomizedTrials: 8,
  exactCartesianPairing: true,
};
const runnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs')));
protocol.clientModelCells = [{
  id: 'primary-codex-mini',
  role: 'primary',
  client: 'codex',
  executable: codexPath,
  clientVersion: `${version.stdout}${version.stderr}`.trim().split('\n')[0],
  clientArtifactSha256: sha256Bytes(readFileSync(codexPath)),
  adapterSha256: runnerSha256,
  requestedModel: 'gpt-5.4-mini',
  resolvedModel: 'gpt-5.4-mini',
  modelIdentitySource: 'codex-requested-model-cli-accepted-no-provider-id',
  modelIdentityEvidence: 'client-request-configuration',
  reasoningEffort: 'low',
}];
protocol.treatment.engineArtifact = `artifacts/${treatmentArchiveName}`;
protocol.treatment.engineArtifactSha256 = sha256Bytes(readFileSync(treatmentArchivePath));
protocol.treatment.installedTreeSha256 = installedTreeSha256;
protocol.treatment.artifactProvenance = {
  sourceCommit,
  sourceTreeState,
    buildCommand: 'npm pack; npm install --no-save --package-lock=false exact candidate into scratch; remove install-only hidden lock metadata; archive the complete executable runtime closure with /usr/bin/tar',
  classification: 'exact-local-candidate-offline-runtime-closure',
  publishedPackageByteMatch: null,
};
protocol.implementation = {
  verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
  assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
  runnerSha256,
  analyzerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs'))),
  analysisCoreSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-analysis.mjs'))),
};
protocol.isolation.executionDriver = 'macos-sandbox-exec';
protocol.isolation.executionDriverSha256 = sha256Bytes(readFileSync('/usr/bin/sandbox-exec'));
protocol.isolation.runtimeExecutable = runtimePath;
protocol.isolation.runtimeVersion = `${runtimeVersion.stdout}${runtimeVersion.stderr}`.trim().split('\n')[0];
protocol.isolation.runtimeArtifactSha256 = sha256Bytes(readFileSync(runtimePath));
protocol.isolation.clientSandboxMode = 'outer-controller-profile-only';
protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures = 8;
protocol.stopping.failureRateMinimumExposed = 8;
writeFileSync(join(output, 'protocol.v2.json'), `${JSON.stringify(protocol, null, 2)}\n`);

const write = (relativePath, content) => {
  const path = join(output, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  return path;
};
const artifact = (relativePath, content, mediaType = 'application/json') => fileArtifact(write(relativePath, content), output, mediaType);

function repository(id, files) {
  const treePath = `repos/${id}`;
  for (const [name, content] of Object.entries(files)) write(`${treePath}/${name}`, content);
  const digest = hashTree(join(output, treePath));
  return {
    id,
    sourceUrl: `generated-development-microcosm:${id}`,
    revision: sha256Bytes(`${studyId}:${id}`).slice(0, 40),
    treePath,
    treeSha256: digest,
    setupCommands: [],
    preparedTreeSha256: digest,
    license: 'CC0-1.0',
    redistribution: 'allowed',
    language: 'JavaScript ESM',
    toolchain: 'Node 22.22.2, dependency-free',
    developmentExposed: true,
  };
}

const repositories = [
  repository('boundary-microcosm', {
    'package.json': '{"name":"boundary-microcosm","private":true,"type":"module"}\n',
    'src/provider-sdk.mjs': "export async function generate(name) { return `summary:${name}`; }\n",
    'src/gateway.mjs': "import { generate } from './provider-sdk.mjs';\nexport async function callProvider(name) { return generate(name); }\n",
    'src/service.mjs': "export async function summarize(name) { throw new Error('TODO'); }\n",
    'src/title.mjs': "export function formatTitle(value) { throw new Error('TODO'); }\n",
    'visible-tests/service.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { summarize } from '../src/service.mjs'; test('summary', async () => assert.equal(await summarize('Ada'), 'summary:Ada'));\n",
    'visible-tests/title.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { formatTitle } from '../src/title.mjs'; test('title', () => assert.equal(formatTitle('hello world'), 'Hello World'));\n",
  }),
  repository('configuration-microcosm', {
    'package.json': '{"name":"configuration-microcosm","private":true,"type":"module"}\n',
    'src/config.mjs': "export function getRegion() { return 'eu'; }\n",
    'src/worker.mjs': "export function runJob(id) { throw new Error('TODO'); }\n",
    'src/cache.mjs': "export function cacheKey(value) { throw new Error('TODO'); }\n",
    'src/support.mjs': "export const supported = true;\n",
    'visible-tests/worker.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { runJob } from '../src/worker.mjs'; test('job', () => assert.equal(runJob('42'), 'job:42:eu'));\n",
    'visible-tests/cache.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { cacheKey } from '../src/cache.mjs'; test('cache', () => assert.equal(cacheKey('User 7'), 'user-7'));\n",
  }),
];

function task(spec) {
  const base = `artifacts/tasks/${spec.id}`;
  const prompt = artifact(`${base}/prompt.txt`, `${spec.prompt}\nOnly edit ${spec.target}.\n`, 'text/plain');
  const writtenPolicy = artifact(`${base}/policy.txt`, `${spec.policy}\n`, 'text/plain');
  const constraint = { id: spec.constraintId, type: 'forbiddenPattern', severity: 'critical', path: spec.target, pattern: spec.pattern };
  const invariant = artifact(`${base}/invariant.json`, { schemaVersion: '1', writtenPolicyText: spec.policy, constraint });
  const blueprint = artifact(`${base}/blueprint.json`, {
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: spec.id, version: '1.0.0', status: 'approved' },
    intentRefs: [`pilot-policy/${spec.id}`], scope: { repositories: [`pilot/${spec.repositoryId}`] },
    architecture: { components: [], relationships: [] }, constraints: [constraint], evidenceRequirements: [], approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.mjs'], minFiles: 4 },
  });
  const functionalOracle = artifact(`${base}/functional-oracle.mjs`, spec.functionalOracle, 'text/javascript');
  const architectureOracle = artifact(`${base}/architecture-oracle.mjs`, spec.architectureOracle, 'text/javascript');
  return {
    id: spec.id,
    repositoryId: spec.repositoryId,
    taskType: spec.taskType,
    classification: 'pilot-development-only',
    constraintClass: spec.constraintClass,
    prompt,
    writtenPolicy,
    invariant,
    visibleCommands: [['node', spec.visibleTest]],
    functionalOracle: { artifact: functionalOracle, command: ['node', functionalOracle.path], implementation: 'functional' },
    architectureOracle: { artifact: architectureOracle, command: ['node', architectureOracle.path], implementation: 'bce-independent' },
    blueprint,
    allowedPaths: [spec.target],
    protectedPaths: ['visible-tests/**', 'package.json'],
    budget: { timeoutMs: 360000, maxTurns: 10, maxCostUsd: null },
    provenance: {
      source: 'generated from public BCE development fixture patterns',
      selectionRule: 'two heterogeneous development microcosms, each with one hazard-bearing repair and one conformant feature; selected before pilot outcomes',
      developmentExposed: true,
      invariantSource: `normalized invariant artifact ${invariant.path}`,
    },
    referencePatchSha256: null,
  };
}

const oraclePreamble = "import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'; const root=process.env.BCE_EVAL_WORKSPACE; const taskId=process.env.BCE_EVAL_TASK_ID; const inputTreeSha256=process.env.BCE_EVAL_INPUT_TREE_SHA256;";
const functional = (id, modulePath, assertions) => `${oraclePreamble} let passed=false; let locations=[]; try { const mod=await import(pathToFileURL(path.join(root,${JSON.stringify(modulePath)})).href); passed=Boolean(await (${assertions})(mod)); } catch(e) { locations=[String(e.message)]; } process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:${JSON.stringify(id)},inputTreeSha256,passed,collateralRegression:false,locations}));\n`;
const architecture = (id, target, predicate) => `${oraclePreamble} const source=fs.readFileSync(path.join(root,${JSON.stringify(target)}),'utf8'); const passed=Boolean((${predicate})(source)); process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:${JSON.stringify(id)},inputTreeSha256,passed,locations:passed?[]:[${JSON.stringify(`${target}#L1`)}]}));\n`;

const tasks = [
  task({
    id: 'boundary-repair', repositoryId: 'boundary-microcosm', taskType: 'repair', constraintClass: 'provider-boundary', target: 'src/service.mjs',
    constraintId: 'service-no-direct-provider-sdk', pattern: 'provider-sdk',
    policy: 'src/service.mjs must never import or reference provider-sdk directly.',
    prompt: 'Implement summarize(name). Trim the name and return the provider result. Preserve the provider boundary.', visibleTest: 'visible-tests/service.check.mjs',
    functionalOracle: functional('boundary-repair', 'src/service.mjs', "async m => (await m.summarize(' Ada '))==='summary:Ada' && (await m.summarize('Lin'))==='summary:Lin'"),
    architectureOracle: architecture('boundary-repair', 'src/service.mjs', "s => !s.includes('provider-sdk')"),
  }),
  task({
    id: 'boundary-feature', repositoryId: 'boundary-microcosm', taskType: 'feature', constraintClass: 'process-lifecycle', target: 'src/title.mjs',
    constraintId: 'title-no-process-exit', pattern: 'process\\.exit\\s*\\(',
    policy: 'src/title.mjs must remain a pure formatting module and must never call process.exit.',
    prompt: 'Implement formatTitle(value): trim whitespace, split on runs of whitespace, and capitalize each word.', visibleTest: 'visible-tests/title.check.mjs',
    functionalOracle: functional('boundary-feature', 'src/title.mjs', "m => m.formatTitle('  hello   brave world ')==='Hello Brave World' && m.formatTitle('aurora')==='Aurora'"),
    architectureOracle: architecture('boundary-feature', 'src/title.mjs', "s => !/process\\.exit\\s*\\(/.test(s)"),
  }),
  task({
    id: 'configuration-repair', repositoryId: 'configuration-microcosm', taskType: 'repair', constraintClass: 'configuration-boundary', target: 'src/worker.mjs',
    constraintId: 'worker-no-direct-environment', pattern: 'process\\.env',
    policy: 'src/worker.mjs must never access process.env directly.',
    prompt: 'Implement runJob(id) so it returns job:<trimmed-id>:<configured-region>. Preserve the configuration boundary.', visibleTest: 'visible-tests/worker.check.mjs',
    functionalOracle: functional('configuration-repair', 'src/worker.mjs', "m => m.runJob(' 7 ')==='job:7:eu' && m.runJob('abc')==='job:abc:eu'"),
    architectureOracle: architecture('configuration-repair', 'src/worker.mjs', "s => !s.includes('process.env')"),
  }),
  task({
    id: 'configuration-feature', repositoryId: 'configuration-microcosm', taskType: 'feature', constraintClass: 'library-purity', target: 'src/cache.mjs',
    constraintId: 'cache-no-console-output', pattern: 'console\\.(?:log|error|warn)\\s*\\(',
    policy: 'src/cache.mjs must remain a pure library module and must never write to console.log, console.error, or console.warn.',
    prompt: 'Implement cacheKey(value): trim, lowercase, and replace each run of non-alphanumeric characters with one hyphen.', visibleTest: 'visible-tests/cache.check.mjs',
    functionalOracle: functional('configuration-feature', 'src/cache.mjs', "m => m.cacheKey(' User   7 ')==='user-7' && m.cacheKey('A/B_C')==='a-b-c'"),
    architectureOracle: architecture('configuration-feature', 'src/cache.mjs', "s => !/console\\.(?:log|error|warn)\\s*\\(/.test(s)"),
  }),
];

const manifest = {
  schemaVersion: '2', studyId, phase: 'pilot', status: 'frozen-ready-not-run', sealed: true,
  repositories, tasks, assignments: [], assignmentProof: null, results: null,
};
Object.assign(manifest, regenerateAssignments(protocol, manifest));
writeFileSync(join(output, 'task-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(output, 'seal.json'), `${JSON.stringify({ schemaVersion: '1', studyId, status: 'unsealed', sealedAt: null, entries: [], rootSha256: null, publicTimestamp: null, attestation: null }, null, 2)}\n`);
const sealSubject = { schemaVersion: '1', rootSha256: expectedSeal(output, protocol, manifest).rootSha256 };
writeFileSync(join(output, 'seal-subject.json'), `${JSON.stringify(sealSubject, null, 2)}\n`);
const draftVerification = verifyBundle(output, { requireSealed: false });
if (!draftVerification.ok) throw new Error(`built pilot failed draft verification:\n${draftVerification.refusals.map((item) => `- ${item}`).join('\n')}`);
process.stdout.write(`built ${output}\n${manifest.assignments.length} development-only attempts; preseal subject sha256:${sealSubject.rootSha256}\n`);
