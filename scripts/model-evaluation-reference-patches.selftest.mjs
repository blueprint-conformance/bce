#!/usr/bin/env node
/** Exercise real reference-patch application, oracles, BCE gate, and unsafe-patch refusals. */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expectedSeal, fileArtifact, hashTree, sha256Bytes, verifyBundle } from './lib/model-evaluation.mjs';

const root = process.cwd();
const scratch = mkdtempSync(join(tmpdir(), 'bce-reference-selftest-'));
const bundle = join(scratch, 'bundle');
cpSync(join(root, 'research', 'model-evaluation', 'pilots', 'accelerated-v3'), bundle, { recursive: true });
for (const schema of ['protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json']) {
  cpSync(join(root, 'research', 'model-evaluation', 'schemas', schema), join(bundle, 'schemas', schema));
}

const patches = {
  'boundary-repair': "diff --git a/src/service.mjs b/src/service.mjs\n--- a/src/service.mjs\n+++ b/src/service.mjs\n@@ -1 +1,2 @@\n-export async function summarize(name) { throw new Error('TODO'); }\n+import { callProvider } from './gateway.mjs';\n+export async function summarize(name) { return callProvider(String(name).trim()); }\n",
  'boundary-feature': "diff --git a/src/title.mjs b/src/title.mjs\n--- a/src/title.mjs\n+++ b/src/title.mjs\n@@ -1 +1 @@\n-export function formatTitle(value) { throw new Error('TODO'); }\n+export function formatTitle(value) { return String(value).trim().split(/\\s+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' '); }\n",
  'configuration-repair': "diff --git a/src/worker.mjs b/src/worker.mjs\n--- a/src/worker.mjs\n+++ b/src/worker.mjs\n@@ -1 +1,2 @@\n-export function runJob(id) { throw new Error('TODO'); }\n+import { getRegion } from './config.mjs';\n+export function runJob(id) { return `job:${String(id).trim()}:${getRegion()}`; }\n",
  'configuration-feature': "diff --git a/src/cache.mjs b/src/cache.mjs\n--- a/src/cache.mjs\n+++ b/src/cache.mjs\n@@ -1 +1 @@\n-export function cacheKey(value) { throw new Error('TODO'); }\n+export function cacheKey(value) { return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }\n",
};

const protocolPath = join(bundle, 'protocol.v2.json');
const manifestPath = join(bundle, 'task-manifest.json');
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
protocol.isolation.modelNetworkPolicy = null;
protocol.isolation.runtimeExecutable = process.execPath;
protocol.isolation.runtimeVersion = process.version;
protocol.isolation.runtimeArtifactSha256 = sha256Bytes(readFileSync(process.execPath));
const extractedTreatment = join(scratch, 'extracted-treatment');
mkdirSync(extractedTreatment, { recursive: true });
const extracted = spawnSync('/usr/bin/tar', ['-xzf', join(bundle, protocol.treatment.engineArtifact), '-C', extractedTreatment], { encoding: 'utf8' });
if (extracted.status !== 0) throw new Error(`reference self-test treatment extraction failed: ${extracted.stderr}`);
protocol.treatment.installedTreeSha256 = hashTree(extractedTreatment, { includeNodeModules: true });
rmSync(extractedTreatment, { recursive: true, force: true });
protocol.implementation = {
  verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
  assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
  runnerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs'))),
  analyzerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'analyze-model-evaluation.mjs'))),
  analysisCoreSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-analysis.mjs'))),
  referenceVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-reference-patches.mjs'))),
  providerVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-provider.mjs'))),
  haltVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-halt.mjs'))),
  publicExporterSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'export-model-evaluation-public.mjs'))),
  publicVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'verify-model-evaluation-public.mjs'))),
  studyHaltSchemaSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'study-halt.schema.json'))),
  safetyHaltArchiveSchemaSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'safety-halt-archive.schema.json'))),
  canaryRunnerSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation-canary.mjs'))),
  ollamaToolClientSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'model-evaluation-ollama-tool-client.mjs'))),
  ollamaToolClientEventVerifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation-client-events.mjs'))),
  ollamaSystemPromptSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'client', 'ollama-system-prompt.v1.txt'))),
  ollamaCommonToolsSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'client', 'ollama-common-tools.v1.json'))),
  ollamaClientEventSchemaSha256: sha256Bytes(readFileSync(join(root, 'research', 'model-evaluation', 'schemas', 'client-event.schema.json'))),
};
protocol.treatment.artifactProvenance.sourceTreeState = 'clean';
for (const task of manifest.tasks) {
  const path = join(bundle, 'artifacts', 'tasks', task.id, 'reference.patch');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, patches[task.id]);
  task.referencePatch = fileArtifact(path, bundle, 'text/x-diff');
  task.referencePatchSha256 = task.referencePatch.sha256;
}
writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(bundle, 'seal.json'), `${JSON.stringify({ schemaVersion: '1', studyId: protocol.studyId, status: 'unsealed', sealedAt: null, entries: [], rootSha256: null, publicTimestamp: null, attestation: null }, null, 2)}\n`);
const draft = verifyBundle(bundle, { requireSealed: false });
if (!draft.ok) throw new Error(`reference self-test bundle invalid: ${draft.refusals.join('; ')}`);

const verifier = join(root, 'scripts', 'verify-model-evaluation-reference-patches.mjs');
const runVerifier = () => spawnSync(process.execPath, [verifier, '--bundle', bundle], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const positive = runVerifier();
if (positive.status !== 0 || !positive.stdout.includes('4/4')) throw new Error(`valid reference solutions were refused:\n${positive.stdout}\n${positive.stderr}`);

const task = manifest.tasks.find((entry) => entry.id === 'boundary-repair');
const unsafePatchPath = join(bundle, task.referencePatch.path);
const packageBefore = readFileSync(join(bundle, 'repos', 'boundary-microcosm', 'package.json'), 'utf8').trimEnd();
writeFileSync(unsafePatchPath, `diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n-${packageBefore}\n+${packageBefore.replace(/}$/, ',"tampered":true}')}\n`);
task.referencePatch = fileArtifact(unsafePatchPath, bundle, 'text/x-diff');
task.referencePatchSha256 = task.referencePatch.sha256;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const unsafe = runVerifier();
if (unsafe.status === 0 || !unsafe.stderr.includes('reference solution patch changed forbidden paths')) throw new Error('reference verifier accepted an out-of-scope package mutation');

const linkPatch = "diff --git a/src/service.mjs b/src/service.mjs\nold mode 100644\nnew mode 120000\nindex 33c6c8b..a6a6a9f\n--- a/src/service.mjs\n+++ b/src/service.mjs\n@@ -1 +1 @@\n-export async function summarize(name) { throw new Error('TODO'); }\n+gateway.mjs\n";
writeFileSync(unsafePatchPath, linkPatch);
task.referencePatch = fileArtifact(unsafePatchPath, bundle, 'text/x-diff');
task.referencePatchSha256 = task.referencePatch.sha256;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const linked = runVerifier();
if (linked.status === 0 || !/symbolic link refused|git apply reference solution patch failed/.test(linked.stderr)) throw new Error('reference verifier accepted a symbolic-link solution');

process.stdout.write('model-evaluation reference-patch self-test: PASS (4/4 real patches; visible tests; twice-run functional/architecture oracles; real BCE gates; out-of-scope and symlink patches refused)\n');
rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
