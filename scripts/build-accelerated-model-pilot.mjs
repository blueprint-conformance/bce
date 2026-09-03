#!/usr/bin/env node
/** Build the separate, permanently non-confirmatory eight-attempt instrumentation pilot. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expectedSeal, fileArtifact, hashTree, regenerateAssignments, sha256Bytes, verifyBundle } from './lib/model-evaluation.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(valueAfter('--out') ?? join(root, 'research', 'model-evaluation', 'pilots', 'accelerated-v1'));
if (existsSync(output)) throw new Error(`pilot builder refuses to overwrite existing path: ${output}`);
const studyId = 'bce-accelerated-instrumentation-pilot-2026-09-03';
const canonicalRoot = join(root, 'research', 'model-evaluation');
mkdirSync(join(output, 'schemas'), { recursive: true });
mkdirSync(join(output, 'artifacts'), { recursive: true });
mkdirSync(join(output, 'repos'), { recursive: true });
for (const name of ['protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json', 'seal.schema.json', 'treatment-delta.schema.json', 'protected-paths.schema.json']) {
  copyFileSync(join(canonicalRoot, 'schemas', name), join(output, 'schemas', name));
}
copyFileSync(join(canonicalRoot, 'protocol-amendments.jsonl'), join(output, 'protocol-amendments.jsonl'));
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

const codexPath = resolve(valueAfter('--codex') ?? '/opt/homebrew/bin/codex');
const version = spawnSync(codexPath, ['--version'], { encoding: 'utf8' });
if (version.status !== 0) throw new Error(`Codex version probe failed: ${version.stderr}`);
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
protocol.treatment.engineArtifact = `artifacts/${tarballName}`;
protocol.treatment.engineArtifactSha256 = sha256Bytes(readFileSync(tarballPath));
protocol.implementation = {
  verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
  assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
  runnerSha256,
  analyzerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs'))),
};
protocol.isolation.executionDriver = 'macos-sandbox-exec';
protocol.isolation.executionDriverSha256 = sha256Bytes(readFileSync('/usr/bin/sandbox-exec'));
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
    policy: 'src/service.mjs must access provider generation only through src/gateway.mjs and must never import or reference provider-sdk directly.',
    prompt: 'Implement summarize(name). Trim the name and return the provider result. Preserve the provider boundary.', visibleTest: 'visible-tests/service.check.mjs',
    functionalOracle: functional('boundary-repair', 'src/service.mjs', "async m => (await m.summarize(' Ada '))==='summary:Ada' && (await m.summarize('Lin'))==='summary:Lin'"),
    architectureOracle: architecture('boundary-repair', 'src/service.mjs', "s => !s.includes('provider-sdk') && s.includes('gateway')"),
  }),
  task({
    id: 'boundary-feature', repositoryId: 'boundary-microcosm', taskType: 'feature', constraintClass: 'process-lifecycle', target: 'src/title.mjs',
    constraintId: 'title-no-process-exit', pattern: 'process\\.exit\\s*\\(',
    policy: 'src/title.mjs must remain a pure formatting module and must never call process.exit.',
    prompt: 'Implement formatTitle(value): trim whitespace, split on runs of whitespace, and capitalize each word.', visibleTest: 'visible-tests/title.check.mjs',
    functionalOracle: functional('boundary-feature', 'src/title.mjs', "m => m.formatTitle('  hello   brave world ')==='Hello Brave World' && m.formatTitle('odin')==='Odin'"),
    architectureOracle: architecture('boundary-feature', 'src/title.mjs', "s => !/process\\.exit\\s*\\(/.test(s)"),
  }),
  task({
    id: 'configuration-repair', repositoryId: 'configuration-microcosm', taskType: 'repair', constraintClass: 'configuration-boundary', target: 'src/worker.mjs',
    constraintId: 'worker-no-direct-environment', pattern: 'process\\.env',
    policy: 'src/worker.mjs must obtain region configuration only through src/config.mjs and must never access process.env directly.',
    prompt: 'Implement runJob(id) so it returns job:<trimmed-id>:<configured-region>. Preserve the configuration boundary.', visibleTest: 'visible-tests/worker.check.mjs',
    functionalOracle: functional('configuration-repair', 'src/worker.mjs', "m => m.runJob(' 7 ')==='job:7:eu' && m.runJob('abc')==='job:abc:eu'"),
    architectureOracle: architecture('configuration-repair', 'src/worker.mjs', "s => !s.includes('process.env') && s.includes('config.mjs')"),
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
