#!/usr/bin/env node
/** Build an immutable, permanently non-confirmatory accelerated instrumentation pilot. */
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, expectedSeal, fileArtifact, hashTree, loadVerifiedRecords, regenerateAssignments,
  sha256Bytes, sha256Json, validateCapabilityCanaryAttestation, verifyBundle,
} from './lib/model-evaluation.mjs';

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
const pilotVersion = valueAfter('--pilot-version') ?? 'v4';
if (!/^v[1-9][0-9]*$/.test(pilotVersion)) throw new Error('--pilot-version must be v1, v2, and so on');
const isV4 = pilotVersion === 'v4';
const isV5 = pilotVersion === 'v5';
const isV6 = pilotVersion === 'v6';
const isQualifiedReferencePilot = isV5 || isV6;
if ((isV4 || isQualifiedReferencePilot) && sourceTreeState !== 'clean' && !process.argv.includes('--allow-dirty-development')) {
  throw new Error(`${pilotVersion} input generation requires a clean source commit; use --allow-dirty-development only for disposable builder tests`);
}
const output = resolve(valueAfter('--out') ?? join(root, 'research', 'model-evaluation', 'pilots', `accelerated-${pilotVersion}`));
if (existsSync(output)) throw new Error(`pilot builder refuses to overwrite existing path: ${output}`);
const studyId = `bce-accelerated-instrumentation-pilot-${pilotVersion}-${isV4 || isQualifiedReferencePilot ? '2026-09-05' : '2026-09-03'}`;
const canonicalRoot = join(root, 'research', 'model-evaluation');
const qualificationAttestationPath = isQualifiedReferencePilot ? resolve(valueAfter('--qualification-attestation') ?? '') : null;
const qualificationBundle = isQualifiedReferencePilot ? resolve(valueAfter('--qualification-bundle') ?? '') : null;
const qualificationRuns = isQualifiedReferencePilot ? resolve(valueAfter('--qualification-runs') ?? '') : null;
if (isQualifiedReferencePilot && (!valueAfter('--qualification-attestation') || !valueAfter('--qualification-bundle') || !valueAfter('--qualification-runs'))) {
  throw new Error(`${pilotVersion} requires --qualification-attestation, --qualification-bundle, and --qualification-runs from one retained clean canary`);
}
let qualification = null;
let qualifiedBundle = null;
if (isQualifiedReferencePilot) {
  qualifiedBundle = verifyBundle(qualificationBundle, { requireSealed: true });
  if (!qualifiedBundle.ok) throw new Error(`${pilotVersion} qualification bundle failed independent verification:\n${qualifiedBundle.refusals.map((item) => `- ${item}`).join('\n')}`);
  const qualifiedReplay = loadVerifiedRecords(qualificationBundle, qualificationRuns);
  qualification = JSON.parse(readFileSync(qualificationAttestationPath, 'utf8'));
  validateCapabilityCanaryAttestation(qualification, join(qualificationBundle, 'schemas', 'capability-canary-attestation.schema.json'));
  if (qualification.attestationSha256 !== sha256Json({ ...qualification, attestationSha256: null })) throw new Error('v5 qualification attestation self-digest mismatch');
  if (qualification.qualified !== true || qualification.sourceTreeState !== 'clean' || qualification.refusalReasons.length !== 0) throw new Error(`${pilotVersion} requires a clean, qualified, refusal-free canary`);
  if (qualifiedReplay.records.length !== 2 || qualification.observations.length !== 2) throw new Error(`${pilotVersion} qualification requires exactly two independently replayable canary attempts`);
  const recordDigests = qualifiedReplay.records.map((record) => record.recordSha256).sort();
  const observedDigests = qualification.observations.map((observation) => observation.recordSha256).sort();
  if (canonicalJson(recordDigests) !== canonicalJson(observedDigests)) throw new Error(`${pilotVersion} qualification observations do not bind the retained terminal records`);
  if (qualification.sealedFixtureProtocolSha256 !== sha256Bytes(readFileSync(join(qualificationBundle, 'protocol.v2.json'))) ||
      qualification.sealedFixtureManifestSha256 !== sha256Bytes(readFileSync(join(qualificationBundle, 'task-manifest.json'))) ||
      qualification.sealedFixtureRootSha256 !== qualifiedBundle.seal.rootSha256) {
    throw new Error(`${pilotVersion} qualification attestation does not bind the retained sealed canary bundle`);
  }
}
mkdirSync(join(output, 'schemas'), { recursive: true });
mkdirSync(join(output, 'artifacts'), { recursive: true });
mkdirSync(join(output, 'repos'), { recursive: true });
for (const name of [
  'protocol.schema.json', 'task-manifest.schema.json', 'terminal-record.schema.json', 'seal.schema.json',
  'treatment-delta.schema.json', 'protected-paths.schema.json',
  ...(isQualifiedReferencePilot ? ['study-halt.schema.json', 'safety-halt-archive.schema.json', 'client-event.schema.json', 'capability-canary-attestation.schema.json'] : []),
]) {
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
    v4: {
      amendmentId: 'v4-causal-apparatus-calibration-fix-forward',
      recordedAt: '2026-09-05T12:00:00Z',
      supersedesPilot: 'bce-accelerated-instrumentation-pilot-v3-2026-09-03',
      retainedPriorResultSha256: '75fc025b00a7b75c65637149bfba3f988ceb825f20f03603a69701b62302b87f',
      reason: 'Pilot v3 established controller mechanics but did not contain a task matrix capable of separating ordinary functional success from architectural conformance. V4 freezes four dependency-free module-graph microcosms, three task shapes per repository, real reference solutions, functionally passing shortcut witnesses, and one content-addressed local Ollama model cell. It remains development-exposed, directional, and ineligible for any product-efficacy or default-adoption decision.',
    },
    v5: {
      amendmentId: 'v5-first-party-qualified-client-fix-forward',
      recordedAt: '2026-09-05T17:00:00Z',
      supersedesPilot: 'bce-accelerated-instrumentation-pilot-v4-2026-09-05',
      retainedPriorResultSha256: '9c6fb790d1c0cbf1028faacbdbf5fddc65e5caafe6300bfd474886de9fe6c4bb',
      reason: 'Pilot v4 safety-halted after six retained infrastructure failures and cannot support efficacy inference. V5 freezes a separately qualified first-party Ollama tool client and controller-owned execution broker, reuses the exact canary-qualified treatment bytes, and introduces eight fresh development-only architecture tasks with independent base, reference, and shortcut truth tables. It remains directional and permanently ineligible for product, default-adoption, cost, or transportability claims.',
    },
    v6: {
      amendmentId: 'v6-public-safe-toolchain-and-ceiling-fix-forward',
      recordedAt: '2026-09-05T18:15:00Z',
      supersedesPilot: 'bce-accelerated-instrumentation-pilot-v5-2026-09-05',
      retainedPriorResultSha256: 'd197ae81b12b061085a4c3a43e163f51a89f130bee40a63122546c38a9539093',
      reason: 'A completed local v5 pilot saturated both arms, then the pre-push leakage gate refused its sealed private workspace identifier. V6 fixes forward with public-safe staged executable paths, a separately qualified qwen3:8b cell selected to reduce the observed ceiling, and eight entirely new development-only tasks. The v5 inputs and outcomes remain immutable and unpushed. V6 remains directional and permanently ineligible for product, default-adoption, cost, or transportability claims.',
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

const treatmentArchiveName = `bce-treatment-runtime-${pilotVersion}.tgz`;
const treatmentArchivePath = join(output, 'artifacts', treatmentArchiveName);
let installedTreeSha256;
if (isQualifiedReferencePilot) {
  const qualifiedTreatment = resolve(qualificationBundle, qualifiedBundle.protocol.treatment.engineArtifact);
  copyFileSync(qualifiedTreatment, treatmentArchivePath);
  installedTreeSha256 = qualifiedBundle.protocol.treatment.installedTreeSha256;
  if (sha256Bytes(readFileSync(treatmentArchivePath)) !== qualification.exactCell.treatmentArtifactSha256 ||
      installedTreeSha256 !== qualification.exactCell.treatmentInstalledTreeSha256) {
    throw new Error(`${pilotVersion} treatment bytes differ from the exact canary-qualified treatment`);
  }
} else {
  const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', join(output, 'artifacts')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stderr}`);
  const jsonStart = packed.stdout.lastIndexOf('\n[');
  const packResult = JSON.parse(jsonStart >= 0 ? packed.stdout.slice(jsonStart + 1) : packed.stdout);
  const tarballName = packResult[0]?.filename;
  if (!tarballName) throw new Error('npm pack did not report an artifact filename');
  const tarballPath = join(output, 'artifacts', tarballName);
  const treatmentScratch = mkdtempSync(join(tmpdir(), 'bce-treatment-closure-'));
  const treatmentRuntime = join(treatmentScratch, 'runtime');
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
const codexLauncher = isQualifiedReferencePilot ? null : realpathSync(resolve(valueAfter('--codex') ?? '/opt/homebrew/bin/codex'));
const codexPath = isQualifiedReferencePilot ? null : nativeCodexExecutable(codexLauncher);
const version = isQualifiedReferencePilot ? null : spawnSync(codexPath, ['--version'], { encoding: 'utf8' });
if (!isQualifiedReferencePilot && version.status !== 0) throw new Error(`Codex version probe failed: ${version.stderr}`);
const nvmRuntimeMatch = codexLauncher?.match(/^(.*\/versions\/node\/v[^/]+)\/lib\/node_modules\//);
if (isV6 && (!valueAfter('--client-executable') || !valueAfter('--node'))) throw new Error('v6 requires explicit public-safe --client-executable and --node staged paths');
const runtimePath = realpathSync(resolve(valueAfter('--node') ?? (isQualifiedReferencePilot ? qualifiedBundle.protocol.isolation.runtimeExecutable : (nvmRuntimeMatch ? join(nvmRuntimeMatch[1], 'bin', 'node') : process.execPath))));
const runtimeVersion = spawnSync(runtimePath, ['--version'], { encoding: 'utf8' });
if (runtimeVersion.status !== 0) throw new Error(`Node runtime probe failed: ${runtimeVersion.stderr}`);
function probeLocalProvider(endpoint, modelName) {
  const script = "const [endpoint,modelName]=process.argv.slice(1); const version=await fetch(endpoint+'/api/version').then(r=>{if(!r.ok)throw new Error('version '+r.status);return r.json()}); const tags=await fetch(endpoint+'/api/tags').then(r=>{if(!r.ok)throw new Error('tags '+r.status);return r.json()}); const model=tags.models?.find(m=>m.name===modelName); if(!model)throw new Error('model not found: '+modelName); process.stdout.write(JSON.stringify({serverVersion:version.version,modelName:model.name,modelDigest:model.digest,modelSizeBytes:model.size}));";
  const result = spawnSync(runtimePath, ['-e', script, endpoint, modelName], { cwd: root, encoding: 'utf8', timeout: 10000 });
  if (result.status !== 0) throw new Error(`local provider probe failed: ${result.stderr || result.stdout}`);
  const identity = JSON.parse(result.stdout);
  if (!identity.serverVersion || identity.modelName !== modelName || !/^[0-9a-f]{64}$/.test(identity.modelDigest) || !Number.isInteger(identity.modelSizeBytes)) {
    throw new Error('local provider returned an incomplete model identity');
  }
  return { kind: 'ollama', endpoint, ...identity, authentication: 'none' };
}
const protocol = JSON.parse(readFileSync(join(canonicalRoot, 'protocol.v2.json'), 'utf8'));
Object.assign(protocol, {
  studyId,
  canonical: true,
  phase: 'pilot',
  status: 'frozen-ready-not-run',
  results: null,
  researchQuestion: isV6
    ? 'Within one exact canary-qualified first-party qwen3:8b cell selected before v6 exposure, does adding the sealed BCE adoption bundle directionally change safe successful completion across eight new development-only architecture tasks while the controller retains every randomized attempt?'
    : isV5
    ? 'Within one exact canary-qualified first-party Ollama client/model cell, does adding the sealed BCE adoption bundle directionally change safe successful completion across eight fresh development-only architecture tasks while the controller retains every randomized attempt?'
    : isV4
      ? 'Within one exact content-addressed local Codex and Ollama model cell, does adding the sealed BCE adoption bundle directionally change safe successful completion across twelve development-exposed architecture tasks while the controller retains every randomized attempt?'
      : 'Can the sealed controller complete all eight development-only attempts with intact isolation, deterministic external oracles, terminal records, and offline replay?',
  claimScope: isV6
    ? 'directional-post-ceiling-first-party-pilot-for-one-exact-qualified-local-model-cell-development-only-no-product-efficacy-default-cost-or-transportability-claim'
    : isV5
    ? 'directional-first-party-apparatus-pilot-for-one-exact-qualified-local-model-cell-development-only-no-product-efficacy-default-cost-or-transportability-claim'
    : isV4
      ? 'directional-apparatus-calibration-for-one-exact-local-model-cell-development-exposed-no-product-efficacy-default-cost-or-transportability-claim'
      : 'instrumentation-only-eight-attempt-development-pilot-no-product-efficacy-claim',
});
protocol.matrix = isQualifiedReferencePilot
  ? {
      clientModelCells: 1,
      repositories: 4,
      tasksPerRepository: 2,
      taskTypes: isV6 ? ['repair', 'refactor'] : ['repair', 'feature'],
      trialsPerArmPerCell: 8,
      totalRandomizedTrials: 16,
      exactCartesianPairing: true,
    }
  : isV4
  ? {
      clientModelCells: 1,
      repositories: 4,
      tasksPerRepository: 3,
      taskTypes: ['repair', 'feature', 'refactor'],
      trialsPerArmPerCell: 12,
      totalRandomizedTrials: 24,
      exactCartesianPairing: true,
    }
  : {
      clientModelCells: 1,
      repositories: 2,
      tasksPerRepository: 2,
      taskTypes: ['repair', 'feature'],
      trialsPerArmPerCell: 4,
      totalRandomizedTrials: 8,
      exactCartesianPairing: true,
    };
const runnerSha256 = sha256Bytes(readFileSync(join(root, 'scripts', 'run-model-evaluation.mjs')));
const v4OllamaEndpoint = valueAfter('--ollama-endpoint') ?? 'http://127.0.0.1:11434';
const v4OllamaModel = valueAfter('--ollama-model') ?? 'qwen3:32b';
if (isV4 && (v4OllamaEndpoint !== 'http://127.0.0.1:11434' || v4OllamaModel !== 'qwen3:32b')) {
  throw new Error('v4 is frozen to qwen3:32b on http://127.0.0.1:11434; create a new pilot version for another cell');
}
const expectedProvider = isQualifiedReferencePilot ? qualification.exactCell.provider : null;
const localProvider = isQualifiedReferencePilot
  ? probeLocalProvider(expectedProvider.endpoint, expectedProvider.modelName)
  : isV4 ? probeLocalProvider(v4OllamaEndpoint, v4OllamaModel) : null;
if (isQualifiedReferencePilot && canonicalJson(localProvider) !== canonicalJson(expectedProvider)) throw new Error(`${pilotVersion} live provider identity drifted from the qualified canary cell`);
if (isQualifiedReferencePilot) {
  mkdirSync(join(output, 'client'), { recursive: true });
  copyFileSync(join(canonicalRoot, 'client', 'ollama-system-prompt.v1.txt'), join(output, 'client', 'ollama-system-prompt.v1.txt'));
  copyFileSync(join(canonicalRoot, 'client', 'ollama-common-tools.v1.json'), join(output, 'client', 'ollama-common-tools.v1.json'));
  copyFileSync(qualificationAttestationPath, join(output, 'artifacts', 'qualified-capability-canary.json'));
}
const referenceClientPath = isV6
  ? realpathSync(resolve(valueAfter('--client-executable')))
  : isV5 ? realpathSync(join(root, 'scripts', 'model-evaluation-ollama-tool-client.mjs')) : null;
protocol.clientModelCells = [isQualifiedReferencePilot ? {
  id: `bce-reference-ollama-${localProvider.modelName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
  role: 'primary',
  client: qualification.exactCell.client,
  executable: referenceClientPath,
  clientVersion: qualification.exactCell.clientVersion,
  clientArtifactSha256: sha256Bytes(readFileSync(referenceClientPath)),
  adapterSha256: runnerSha256,
  requestedModel: localProvider.modelName,
  resolvedModel: `${localProvider.modelName}@sha256:${localProvider.modelDigest}`,
  modelIdentitySource: 'ollama-provider-api-version-tags-and-active-process',
  modelIdentityEvidence: 'provider-response',
  reasoningEffort: qualification.exactCell.reasoningEffort,
  localProvider,
  toolLoop: {
    ...qualification.exactCell.toolLoop,
    qualificationAttestation: {
      path: 'artifacts/qualified-capability-canary.json',
      sha256: sha256Bytes(readFileSync(join(output, 'artifacts', 'qualified-capability-canary.json'))),
    },
  },
} : {
  id: isV4 ? 'codex-ollama-qwen3-32b' : 'primary-codex-mini',
  role: 'primary',
  client: 'codex',
  executable: codexPath,
  clientVersion: `${version.stdout}${version.stderr}`.trim().split('\n')[0],
  clientArtifactSha256: sha256Bytes(readFileSync(codexPath)),
  adapterSha256: runnerSha256,
  requestedModel: localProvider?.modelName ?? 'gpt-5.4-mini',
  resolvedModel: localProvider ? `${localProvider.modelName}@sha256:${localProvider.modelDigest}` : 'gpt-5.4-mini',
  modelIdentitySource: localProvider ? 'ollama-provider-api-version-tags-and-active-process' : 'codex-requested-model-cli-accepted-no-provider-id',
  modelIdentityEvidence: localProvider ? 'provider-response' : 'client-request-configuration',
  reasoningEffort: 'low',
  ...(localProvider ? { localProvider } : {}),
}];
protocol.treatment.engineArtifact = `artifacts/${treatmentArchiveName}`;
protocol.treatment.engineArtifactSha256 = sha256Bytes(readFileSync(treatmentArchivePath));
protocol.treatment.installedTreeSha256 = installedTreeSha256;
protocol.treatment.artifactProvenance = {
  ...(isQualifiedReferencePilot ? qualifiedBundle.protocol.treatment.artifactProvenance : {
    sourceCommit,
    sourceTreeState,
    buildCommand: 'npm pack; npm install --no-save --package-lock=false exact candidate into scratch; remove install-only hidden lock metadata; archive the complete executable runtime closure with /usr/bin/tar',
    classification: 'exact-local-candidate-offline-runtime-closure',
    publishedPackageByteMatch: null,
  }),
};
protocol.implementation = isQualifiedReferencePilot ? qualification.exactCell.implementation : {
  verifierSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'lib', 'model-evaluation.mjs'))),
  assignmentGeneratorSha256: sha256Bytes(readFileSync(join(root, 'scripts', 'generate-model-evaluation-assignments.mjs'))),
  runnerSha256,
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
protocol.isolation.executionDriver = 'macos-sandbox-exec';
protocol.isolation.executionDriverSha256 = sha256Bytes(readFileSync('/usr/bin/sandbox-exec'));
protocol.isolation.runtimeExecutable = runtimePath;
protocol.isolation.runtimeVersion = `${runtimeVersion.stdout}${runtimeVersion.stderr}`.trim().split('\n')[0];
protocol.isolation.runtimeArtifactSha256 = sha256Bytes(readFileSync(runtimePath));
protocol.isolation.clientSandboxMode = 'outer-controller-profile-only';
protocol.isolation.modelNetworkPolicy = localProvider ? 'loopback-only-single-endpoint' : null;
protocol.stopping.stopAfterConsecutivePostExposureInfrastructureFailures = isQualifiedReferencePilot ? 4 : isV4 ? 6 : 8;
protocol.stopping.failureRateMinimumExposed = isQualifiedReferencePilot ? 8 : isV4 ? 10 : 8;
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

const legacyRepositories = !isV4 && !isQualifiedReferencePilot ? [
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
] : [];

const v4Repositories = isV4 ? [
  repository('layering-lab', {
    'package.json': '{"name":"layering-lab","private":true,"type":"module"}\n',
    'src/domain/order-port.mjs': "export const normalizeOrderInput = (value) => String(value).trim().toUpperCase();\nexport const createOrderRecord = (id) => `order:${String(id).trim()}`;\nexport const formatOrderLabel = (id) => `Order ${String(id).trim()}`;\n",
    'src/infra/order-store.mjs': "export const normalizeOrderInput = (value) => String(value).trim().toUpperCase();\nexport const createOrderRecord = (id) => `order:${String(id).trim()}`;\nexport const formatOrderLabel = (id) => `Order ${String(id).trim()}`;\n",
    'src/domain/repair-order.mjs': "import { normalizeOrderInput } from '../infra/order-store.mjs';\nexport function repairOrder(value) { return normalizeOrderInput(value).toLowerCase(); }\n",
    'src/domain/create-order.mjs': "export function createOrder(id) { throw new Error('TODO'); }\n",
    'src/domain/order-label.mjs': "import { formatOrderLabel } from '../infra/order-store.mjs';\nexport function orderLabel(id) { return formatOrderLabel(id); }\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairOrder } from '../src/domain/repair-order.mjs'; test('repairs order input', () => assert.equal(repairOrder(' ab-7 '), 'AB-7'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createOrder } from '../src/domain/create-order.mjs'; test('creates order', () => assert.equal(createOrder(' 42 '), 'order:42'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { orderLabel } from '../src/domain/order-label.mjs'; test('labels order', () => assert.equal(orderLabel(' 42 '), 'Order 42'));\n",
  }),
  repository('provider-lab', {
    'package.json': '{"name":"provider-lab","private":true,"type":"module"}\n',
    'src/platform/provider-gateway.mjs': "export const summarizeThroughGateway = (name) => `summary:${String(name).trim()}`;\nexport const classifyThroughGateway = (text) => String(text).trim().length > 4 ? 'long' : 'short';\nexport const embedThroughGateway = (text) => [String(text).trim().length, 1];\n",
    'src/vendor/raw-provider.mjs': "export const summarizeThroughGateway = (name) => `summary:${String(name).trim()}`;\nexport const classifyThroughGateway = (text) => String(text).trim().length > 4 ? 'long' : 'short';\nexport const embedThroughGateway = (text) => [String(text).trim().length, 1];\n",
    'src/features/repair-summary.mjs': "import { summarizeThroughGateway } from '../vendor/raw-provider.mjs';\nexport function repairSummary(name) { return summarizeThroughGateway(name).toUpperCase(); }\n",
    'src/features/classify-message.mjs': "export function classifyMessage(text) { throw new Error('TODO'); }\n",
    'src/features/message-vector.mjs': "import { embedThroughGateway } from '../vendor/raw-provider.mjs';\nexport function messageVector(text) { return embedThroughGateway(text); }\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairSummary } from '../src/features/repair-summary.mjs'; test('summarizes', () => assert.equal(repairSummary(' Ada '), 'summary:Ada'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { classifyMessage } from '../src/features/classify-message.mjs'; test('classifies', () => assert.equal(classifyMessage('hello'), 'long'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { messageVector } from '../src/features/message-vector.mjs'; test('embeds', () => assert.deepEqual(messageVector('Ada'), [3, 1]));\n",
  }),
  repository('runtime-lab', {
    'package.json': '{"name":"runtime-lab","private":true,"type":"module"}\n',
    'src/browser/path-tools.mjs': "export const routeBasename = (value) => String(value).split('/').filter(Boolean).at(-1) ?? '';\nexport const joinRoute = (base, child) => `${String(base).replace(/\\/$/, '')}/${String(child).replace(/^\\//, '')}`;\nexport const normalizeRoute = (value) => `/${String(value).split('/').filter((part) => part && part !== '.').join('/')}`;\n",
    'src/browser/repair-route.mjs': "import path from 'node:path';\nexport function repairRoute(value) { return path.posix.dirname(String(value)); }\n",
    'src/browser/create-route.mjs': "export function createRoute(base, child) { throw new Error('TODO'); }\n",
    'src/browser/normalize-route.mjs': "import path from 'node:path';\nexport function normalizedRoute(value) { return `/${path.posix.normalize(String(value)).replace(/^\\//, '')}`; }\n",
    'src/server/path-adapter.mjs': "import path from 'node:path'; export const serverBasename = path.posix.basename;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairRoute } from '../src/browser/repair-route.mjs'; test('repairs route', () => assert.equal(repairRoute('/teams/nova'), 'nova'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createRoute } from '../src/browser/create-route.mjs'; test('creates route', () => assert.equal(createRoute('/teams', 'nova'), '/teams/nova'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { normalizedRoute } from '../src/browser/normalize-route.mjs'; test('normalizes route', () => assert.equal(normalizedRoute('/teams/./nova'), '/teams/nova'));\n",
  }),
  repository('tenant-lab', {
    'package.json': '{"name":"tenant-lab","private":true,"type":"module"}\n',
    'src/security/tenant-access.mjs': "export const requireTenantAccess = (tenantId, user) => { if (!user?.id || user.tenantId !== tenantId) throw new Error('forbidden'); return { tenantId, userId: user.id }; };\n",
    'src/security/generic-auth.mjs': "export const requireAuth = (user) => { if (!user?.id) throw new Error('unauthorized'); return { tenantId: user.tenantId, userId: user.id }; };\n",
    'src/routes/repair-secret.mjs': "import { requireAuth } from '../security/generic-auth.mjs';\nexport function repairSecretRoute(tenantId, user) { const access = requireAuth(user); return `${tenantId}/${access.userId}`; }\n",
    'src/routes/create-secret.mjs': "import { requireTenantAccess } from '../security/tenant-access.mjs';\nexport function createSecretRoute(tenantId, user) { throw new Error('TODO'); }\n",
    'src/routes/secret-owner.mjs': "import { requireAuth } from '../security/generic-auth.mjs';\nexport function secretOwnerRoute(tenantId, user) { const access = requireAuth(user); return `${access.userId}@${tenantId}`; }\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairSecretRoute } from '../src/routes/repair-secret.mjs'; test('repairs tenant route', () => assert.equal(repairSecretRoute('acme', { id: 'u1', tenantId: 'acme' }), 'acme:u1'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createSecretRoute } from '../src/routes/create-secret.mjs'; test('creates tenant route', () => assert.equal(createSecretRoute('acme', { id: 'u2', tenantId: 'acme' }), 'secret:acme:u2'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { secretOwnerRoute } from '../src/routes/secret-owner.mjs'; test('returns owner', () => assert.equal(secretOwnerRoute('acme', { id: 'u3', tenantId: 'acme' }), 'u3@acme'));\n",
  }),
] : [];
const v5Repositories = isV5 ? [
  repository('billing-edge-lab', {
    'package.json': '{"name":"billing-edge-lab","private":true,"type":"module"}\n',
    'src/application/billing-port.mjs': "export const normalizeInvoice = (value) => String(value).trim().toUpperCase();\nexport const receiptCode = (id) => `receipt:${String(id).trim()}`;\n",
    'src/infrastructure/raw-ledger.mjs': "export const normalizeInvoice = (value) => String(value).trim().toUpperCase();\nexport const receiptCode = (id) => `receipt:${String(id).trim()}`;\n",
    'src/application/repair-invoice.mjs': "import { normalizeInvoice } from '../infrastructure/raw-ledger.mjs';\nexport function repairInvoice(value) { return normalizeInvoice(value).toLowerCase(); }\n",
    'src/application/create-receipt.mjs': "export function createReceipt(id) { throw new Error('TODO'); }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairInvoice } from '../src/application/repair-invoice.mjs'; test('repairs invoice', () => assert.equal(repairInvoice(' inv-7 '), 'INV-7'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createReceipt } from '../src/application/create-receipt.mjs'; test('creates receipt', () => assert.equal(createReceipt(' 42 '), 'receipt:42'));\n",
  }),
  repository('browser-encoding-lab', {
    'package.json': '{"name":"browser-encoding-lab","private":true,"type":"module"}\n',
    'src/browser/encoding-port.mjs': "export const textHex = (value) => [...new TextEncoder().encode(String(value).trim())].map((byte) => byte.toString(16).padStart(2, '0')).join('');\nexport const byteTag = (value) => `hex:${textHex(value)}`;\n",
    'src/browser/repair-token.mjs': "import { Buffer } from 'node:buffer';\nexport function repairToken(value) { return Buffer.from(String(value)).toString('hex'); }\n",
    'src/browser/create-tag.mjs': "export function createTag(value) { throw new Error('TODO'); }\n",
    'src/server/buffer-adapter.mjs': "import { Buffer } from 'node:buffer'; export const serverHex = (value) => Buffer.from(String(value)).toString('hex');\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairToken } from '../src/browser/repair-token.mjs'; test('repairs browser token', () => assert.equal(repairToken(' ok '), '6f6b'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createTag } from '../src/browser/create-tag.mjs'; test('creates browser tag', () => assert.equal(createTag('A'), 'hex:41'));\n",
  }),
  repository('tenant-policy-lab', {
    'package.json': '{"name":"tenant-policy-lab","private":true,"type":"module"}\n',
    'src/security/scoped-access.mjs': "export const requireScopedAccess = (tenantId, actor) => { if (!actor?.id || actor.tenantId !== tenantId) throw new Error('forbidden'); return { tenantId, actorId: actor.id }; };\n",
    'src/security/session-only.mjs': "export const requireSession = (actor) => { if (!actor?.id) throw new Error('unauthorized'); return { tenantId: actor.tenantId, actorId: actor.id }; };\n",
    'src/routes/repair-export.mjs': "import { requireSession } from '../security/session-only.mjs';\nexport function repairExport(tenantId, actor) { const access = requireSession(actor); return `${tenantId}/${access.actorId}`; }\n",
    'src/routes/create-audit.mjs': "import { requireScopedAccess } from '../security/scoped-access.mjs';\nexport function createAudit(tenantId, actor) { throw new Error('TODO'); }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairExport } from '../src/routes/repair-export.mjs'; test('repairs scoped export', () => assert.equal(repairExport('acme', { id: 'u7', tenantId: 'acme' }), 'export:acme:u7'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createAudit } from '../src/routes/create-audit.mjs'; test('creates scoped audit', () => assert.equal(createAudit('acme', { id: 'u8', tenantId: 'acme' }), 'audit:acme:u8'));\n",
  }),
  repository('telemetry-edge-lab', {
    'package.json': '{"name":"telemetry-edge-lab","private":true,"type":"module"}\n',
    'src/application/telemetry-port.mjs': "export const auditLine = (name) => `audit:${String(name).trim()}`;\nexport const metricLine = (name, value) => `metric:${String(name).trim()}:${Number(value)}`;\n",
    'src/infrastructure/raw-sink.mjs': "export const auditLine = (name) => `audit:${String(name).trim()}`;\nexport const metricLine = (name, value) => `metric:${String(name).trim()}:${Number(value)}`;\n",
    'src/application/repair-audit.mjs': "import { auditLine } from '../infrastructure/raw-sink.mjs';\nexport function repairAudit(name) { return auditLine(name).toUpperCase(); }\n",
    'src/application/create-metric.mjs': "export function createMetric(name, value) { throw new Error('TODO'); }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairAudit } from '../src/application/repair-audit.mjs'; test('repairs audit line', () => assert.equal(repairAudit(' login '), 'audit:login'));\n",
    'visible-tests/feature.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { createMetric } from '../src/application/create-metric.mjs'; test('creates metric line', () => assert.equal(createMetric(' jobs ', 3), 'metric:jobs:3'));\n",
  }),
] : [];
const v6Repositories = isV6 ? [
  repository('payment-seam-lab', {
    'package.json': '{"name":"payment-seam-lab","private":true,"type":"module"}\n',
    'src/usecases/payment-port.mjs': "export const normalizeCharge = (value) => String(value).trim().toUpperCase();\nexport const chargeLabel = (id) => `charge:${String(id).trim()}`;\n",
    'src/infrastructure/raw-processor.mjs': "export const normalizeCharge = (value) => String(value).trim().toUpperCase();\nexport const chargeLabel = (id) => `charge:${String(id).trim()}`;\n",
    'src/usecases/repair-charge.mjs': "import { normalizeCharge } from '../infrastructure/raw-processor.mjs';\nexport function repairCharge(value) { return normalizeCharge(value).toLowerCase(); }\n",
    'src/usecases/charge-summary.mjs': "import { chargeLabel } from '../infrastructure/raw-processor.mjs';\nexport function chargeSummary(id) { return chargeLabel(id); }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairCharge } from '../src/usecases/repair-charge.mjs'; test('repairs charge', () => assert.equal(repairCharge(' ch-7 '), 'CH-7'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { chargeSummary } from '../src/usecases/charge-summary.mjs'; test('summarizes charge', () => assert.equal(chargeSummary(' 42 '), 'charge:42'));\n",
  }),
  repository('web-url-lab', {
    'package.json': '{"name":"web-url-lab","private":true,"type":"module"}\n',
    'src/browser/url-port.mjs': "export const normalizedHost = (value) => new URL(String(value).trim()).hostname.toLowerCase();\nexport const originLabel = (value) => `origin:${new URL(String(value).trim()).origin}`;\n",
    'src/browser/repair-host.mjs': "import { URL } from 'node:url';\nexport function repairHost(value) { return new URL(String(value)).host.toUpperCase(); }\n",
    'src/browser/origin-summary.mjs': "import { URL } from 'node:url';\nexport function originSummary(value) { return `origin:${new URL(String(value).trim()).origin}`; }\n",
    'src/server/url-adapter.mjs': "import { URL } from 'node:url'; export const serverHost = (value) => new URL(String(value)).hostname;\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairHost } from '../src/browser/repair-host.mjs'; test('repairs browser host', () => assert.equal(repairHost(' HTTPS://EXAMPLE.COM/a '), 'example.com'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { originSummary } from '../src/browser/origin-summary.mjs'; test('summarizes origin', () => assert.equal(originSummary(' https://example.com/a '), 'origin:https://example.com'));\n",
  }),
  repository('workspace-access-lab', {
    'package.json': '{"name":"workspace-access-lab","private":true,"type":"module"}\n',
    'src/security/workspace-access.mjs': "export const requireWorkspaceAccess = (workspaceId, actor) => { if (!actor?.id || actor.workspaceId !== workspaceId) throw new Error('forbidden'); return { workspaceId, actorId: actor.id }; };\n",
    'src/security/session-access.mjs': "export const requireSession = (actor) => { if (!actor?.id) throw new Error('unauthorized'); return { workspaceId: actor.workspaceId, actorId: actor.id }; };\n",
    'src/routes/repair-report.mjs': "import { requireSession } from '../security/session-access.mjs';\nexport function repairReport(workspaceId, actor) { const access = requireSession(actor); return `${workspaceId}/${access.actorId}`; }\n",
    'src/routes/report-owner.mjs': "import { requireSession } from '../security/session-access.mjs';\nexport function reportOwner(workspaceId, actor) { const access = requireSession(actor); return `${access.actorId}@${workspaceId}`; }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairReport } from '../src/routes/repair-report.mjs'; test('repairs workspace report', () => assert.equal(repairReport('nova', { id: 'u7', workspaceId: 'nova' }), 'report:nova:u7'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { reportOwner } from '../src/routes/report-owner.mjs'; test('reports scoped owner', () => assert.equal(reportOwner('nova', { id: 'u8', workspaceId: 'nova' }), 'u8@nova'));\n",
  }),
  repository('inference-seam-lab', {
    'package.json': '{"name":"inference-seam-lab","private":true,"type":"module"}\n',
    'src/application/inference-port.mjs': "export const classifyIntent = (text) => String(text).trim().length > 5 ? 'complex' : 'simple';\nexport const vectorLabel = (text) => `vector:${String(text).trim().length}`;\n",
    'src/vendor/raw-inference.mjs': "export const classifyIntent = (text) => String(text).trim().length > 5 ? 'complex' : 'simple';\nexport const vectorLabel = (text) => `vector:${String(text).trim().length}`;\n",
    'src/features/repair-intent.mjs': "import { classifyIntent } from '../vendor/raw-inference.mjs';\nexport function repairIntent(text) { return classifyIntent(text).toUpperCase(); }\n",
    'src/features/vector-summary.mjs': "import { vectorLabel } from '../vendor/raw-inference.mjs';\nexport function vectorSummary(text) { return vectorLabel(text); }\n",
    'src/shared/identity.mjs': "export const identity = (value) => value;\n",
    'visible-tests/repair.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { repairIntent } from '../src/features/repair-intent.mjs'; test('repairs intent', () => assert.equal(repairIntent(' planet '), 'complex'));\n",
    'visible-tests/refactor.check.mjs': "import test from 'node:test'; import assert from 'node:assert/strict'; import { vectorSummary } from '../src/features/vector-summary.mjs'; test('summarizes vector', () => assert.equal(vectorSummary(' nova '), 'vector:4'));\n",
  }),
] : [];
const repositories = isV6 ? v6Repositories : isV5 ? v5Repositories : isV4 ? v4Repositories : legacyRepositories;

function unifiedPatch(target, before, after) {
  const beforeLines = before.replace(/\n$/, '').split('\n');
  const afterLines = after.replace(/\n$/, '').split('\n');
  return [
    `diff --git a/${target} b/${target}`,
    `--- a/${target}`,
    `+++ b/${target}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    '',
  ].join('\n');
}

function task(spec) {
  if (spec.beforeSource) {
    const actualBefore = readFileSync(join(output, 'repos', spec.repositoryId, spec.target), 'utf8');
    if (actualBefore !== spec.beforeSource) throw new Error(`${spec.id}: declared patch base differs from repository target bytes`);
  }
  const base = `artifacts/tasks/${spec.id}`;
  const prompt = artifact(`${base}/prompt.txt`, `${spec.prompt}\nOnly edit ${spec.target}.\n`, 'text/plain');
  const writtenPolicy = artifact(`${base}/policy.txt`, `${spec.policy}\n`, 'text/plain');
  const constraint = spec.constraint ?? { id: spec.constraintId, type: 'forbiddenPattern', severity: 'critical', path: spec.target, pattern: spec.pattern };
  const invariant = artifact(`${base}/invariant.json`, { schemaVersion: '1', writtenPolicyText: spec.policy, constraint });
  const blueprint = artifact(`${base}/blueprint.json`, {
    apiVersion: 'blueprint-conformance/v1alpha1', kind: 'EngineeringBlueprint',
    metadata: { id: spec.id, version: '1.0.0', status: 'approved' },
    intentRefs: [`pilot-policy/${spec.id}`], scope: { repositories: [`pilot/${spec.repositoryId}`] },
    architecture: { components: [], relationships: [] }, constraints: [constraint], evidenceRequirements: [], approvals: [],
    ...(spec.minEngineVersion ? { minEngineVersion: spec.minEngineVersion } : {}),
    extraction: spec.extraction ?? { profile: 'plugin-surface', paths: ['src/**/*.mjs'], minFiles: 4 },
  });
  const functionalOracle = artifact(`${base}/functional-oracle.mjs`, spec.functionalOracle, 'text/javascript');
  const architectureOracle = artifact(`${base}/architecture-oracle.mjs`, spec.architectureOracle, 'text/javascript');
  const referencePatch = spec.referenceSource
    ? artifact(`${base}/reference.patch`, unifiedPatch(spec.target, spec.beforeSource, spec.referenceSource), 'text/x-diff')
    : null;
  const shortcutPatch = spec.shortcutSource
    ? artifact(`${base}/shortcut.patch`, unifiedPatch(spec.target, spec.beforeSource, spec.shortcutSource), 'text/x-diff')
    : null;
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
      selectionRule: spec.selectionRule ?? 'two heterogeneous development microcosms, each with one hazard-bearing repair and one conformant feature; selected before pilot outcomes',
      developmentExposed: true,
      invariantSource: `normalized invariant artifact ${invariant.path}`,
    },
    ...(referencePatch ? { referencePatch } : {}),
    referencePatchSha256: referencePatch?.sha256 ?? null,
    ...(shortcutPatch ? { shortcutPatch, shortcutPatchSha256: shortcutPatch.sha256 } : {}),
  };
}

const oraclePreamble = "import fs from 'node:fs'; import path from 'node:path'; import { builtinModules } from 'node:module'; import { pathToFileURL } from 'node:url'; const root=process.env.BCE_EVAL_WORKSPACE; const taskId=process.env.BCE_EVAL_TASK_ID; const inputTreeSha256=process.env.BCE_EVAL_INPUT_TREE_SHA256;";
const functional = (id, modulePath, assertions) => `${oraclePreamble} let passed=false; let locations=[]; try { const mod=await import(pathToFileURL(path.join(root,${JSON.stringify(modulePath)})).href); passed=Boolean(await (${assertions})(mod)); } catch(e) { locations=[String(e.message)]; } process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:${JSON.stringify(id)},inputTreeSha256,passed,collateralRegression:false,locations}));\n`;
const architecture = (id, target, predicate) => `${oraclePreamble} const source=fs.readFileSync(path.join(root,${JSON.stringify(target)}),'utf8'); const passed=Boolean((${predicate})(source)); process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:${JSON.stringify(id)},inputTreeSha256,passed,locations:passed?[]:[${JSON.stringify(`${target}#L1`)}]}));\n`;

const legacyTasks = !isV4 && !isQualifiedReferencePilot ? [
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
] : [];

function extractModuleSpecifiers(source) {
  const specifiers = [];
  let computed = false;
  const quoted = (index) => {
    const quote = source[index];
    let value = '';
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === '\\') {
        value += source[cursor + 1] ?? '';
        cursor += 1;
      } else if (source[cursor] === quote) return { value, end: cursor + 1 };
      else value += source[cursor];
    }
    return { value, end: source.length };
  };
  const trivia = (index) => {
    let cursor = index;
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) cursor += 1;
      else if (source.startsWith('//', cursor)) {
        cursor = source.indexOf('\n', cursor + 2);
        if (cursor < 0) return source.length;
      } else if (source.startsWith('/*', cursor)) {
        const end = source.indexOf('*/', cursor + 2);
        cursor = end < 0 ? source.length : end + 2;
      } else break;
    }
    return cursor;
  };
  const word = (index) => {
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
    return match ? { value: match[0], end: index + match[0].length } : null;
  };
  const callSpecifier = (openParen) => {
    const argument = trivia(openParen + 1);
    if (source[argument] === "'" || source[argument] === '"') {
      const literal = quoted(argument);
      const closing = trivia(literal.end);
      if (source[closing] === ')') specifiers.push(literal.value);
      else computed = true;
      return closing + 1;
    }
    computed = true;
    return argument + 1;
  };
  for (let index = 0; index < source.length;) {
    index = trivia(index);
    if (index >= source.length) break;
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      index = quoted(index).end;
      continue;
    }
    const token = word(index);
    if (!token) {
      index += 1;
      continue;
    }
    index = token.end;
    if (token.value === 'import') {
      let cursor = trivia(index);
      if (source[cursor] === '.') continue;
      if (source[cursor] === '(') {
        index = callSpecifier(cursor);
        continue;
      }
      while (cursor < source.length && source[cursor] !== ';') {
        cursor = trivia(cursor);
        if (source[cursor] === "'" || source[cursor] === '"') {
          const literal = quoted(cursor);
          specifiers.push(literal.value);
          index = literal.end;
          break;
        }
        cursor += 1;
      }
    } else if (token.value === 'export') {
      let cursor = trivia(index);
      while (cursor < source.length && source[cursor] !== ';') {
        const next = word(cursor);
        if (next?.value === 'from') {
          const literalStart = trivia(next.end);
          if (source[literalStart] === "'" || source[literalStart] === '"') {
            const literal = quoted(literalStart);
            specifiers.push(literal.value);
            index = literal.end;
          }
          break;
        }
        if (source[cursor] === "'" || source[cursor] === '"' || source[cursor] === '`') cursor = quoted(cursor).end;
        else cursor += 1;
      }
    } else if (token.value === 'require') {
      let cursor = trivia(index);
      if (source.startsWith('.resolve', cursor)) cursor = trivia(cursor + '.resolve'.length);
      if (source[cursor] === '(') index = callSpecifier(cursor);
    }
  }
  return { specifiers, computed };
}
const parserProofs = [
  ["import path from 'node:path';", ['node:path'], false],
  ["const path = require('path');", ['path'], false],
  ["const path = require.resolve('path');", ['path'], false],
  ["const path = import('node:path');", ['node:path'], false],
  ["const path = require ('path');", ['path'], false],
  ["const note = \"import path from 'node:path'\"; // import x from 'path'", [], false],
  ["import(target);", [], true],
  ["import (target);", [], true],
  ["import('node:' + 'path');", [], true],
];
for (const [source, expectedSpecifiers, expectedComputed] of parserProofs) {
  const actual = extractModuleSpecifiers(source);
  if (canonicalJson(actual.specifiers) !== canonicalJson(expectedSpecifiers) || actual.computed !== expectedComputed) {
    throw new Error(`independent architecture-oracle parser parity proof failed for ${source}`);
  }
}
const architectureDependency = (id, target, dependencyTarget, required) => `${oraclePreamble} const target=${JSON.stringify(target)}; const source=fs.readFileSync(path.join(root,target),'utf8'); const extractModuleSpecifiers=${extractModuleSpecifiers.toString()}; const parsed=extractModuleSpecifiers(source); const builtins=new Set(builtinModules.map((name)=>name.replace(/^node:/,''))); const normalize=(specifier)=>{const builtin=specifier.replace(/^node:/,''); if(builtins.has(builtin))return 'builtin:'+builtin; if(specifier.startsWith('.')){const base=path.posix.normalize(path.posix.join(path.posix.dirname(target),specifier)); const candidates=[base,base+'.mjs',base+'.js',base+'.ts',base+'/index.mjs',base+'/index.js',base+'/index.ts']; const resolved=candidates.find((candidate)=>fs.existsSync(path.join(root,candidate)))??base; return 'module:'+resolved;} return 'package:'+(specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]);}; const observed=parsed.specifiers.map(normalize); const matched=observed.includes(${JSON.stringify(dependencyTarget)}); const passed=!parsed.computed&&matched===${required ? 'true' : 'false'}; process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:${JSON.stringify(id)},inputTreeSha256,passed,locations:passed?[]:[${JSON.stringify(`${target}#L1`)}]}));\n`;
const v4SelectionRule = 'four development-exposed dependency-free architecture microcosms crossed with repair, feature, and refactor tasks; each task has a frozen functionally passing architecture-violating shortcut witness and was selected before any v4 model outcome';
const v4Task = (spec) => task({
  ...spec,
  constraint: spec.requiredDependency
    ? {
        id: `${spec.id}-requires-governed-edge`,
        type: 'requiredDependency',
        severity: 'critical',
        component: 'typescriptModule',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      }
    : {
        id: `${spec.id}-no-forbidden-edge`,
        type: 'forbiddenDependency',
        severity: 'critical',
        from: '*',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      },
  minEngineVersion: '0.3.0',
  extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.mjs'], minFiles: 5 },
  architectureOracle: architectureDependency(spec.id, spec.target, spec.dependencyTarget, spec.requiredDependency === true),
  selectionRule: v4SelectionRule,
});

const v4Tasks = isV4 ? [
  v4Task({
    id: 'layering-repair', repositoryId: 'layering-lab', taskType: 'repair', constraintClass: 'directional-layering', target: 'src/domain/repair-order.mjs',
    dependencyTarget: 'module:src/infra/order-store.mjs', policy: 'src/domain/repair-order.mjs must not directly import src/infra/order-store.mjs.',
    prompt: 'Repair repairOrder(value) so it trims and uppercases the order identifier while preserving the domain-to-infrastructure boundary.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('layering-repair', 'src/domain/repair-order.mjs', "m => m.repairOrder(' xy-9 ')==='XY-9' && m.repairOrder('nova')==='NOVA'"),
    beforeSource: "import { normalizeOrderInput } from '../infra/order-store.mjs';\nexport function repairOrder(value) { return normalizeOrderInput(value).toLowerCase(); }\n",
    referenceSource: "import { normalizeOrderInput } from './order-port.mjs';\nexport function repairOrder(value) { return normalizeOrderInput(value); }\n",
    shortcutSource: "import { normalizeOrderInput } from '../infra/order-store.mjs';\nexport function repairOrder(value) { return normalizeOrderInput(value); }\n",
  }),
  v4Task({
    id: 'layering-feature', repositoryId: 'layering-lab', taskType: 'feature', constraintClass: 'directional-layering', target: 'src/domain/create-order.mjs',
    dependencyTarget: 'module:src/infra/order-store.mjs', policy: 'src/domain/create-order.mjs must not directly import src/infra/order-store.mjs.',
    prompt: 'Implement createOrder(id) so it returns order:<trimmed-id> while preserving the domain-to-infrastructure boundary.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('layering-feature', 'src/domain/create-order.mjs', "m => m.createOrder(' 7 ')==='order:7' && m.createOrder('x')==='order:x'"),
    beforeSource: "export function createOrder(id) { throw new Error('TODO'); }\n",
    referenceSource: "import { createOrderRecord } from './order-port.mjs';\nexport function createOrder(id) { return createOrderRecord(id); }\n",
    shortcutSource: "import { createOrderRecord } from '../infra/order-store.mjs';\nexport function createOrder(id) { return createOrderRecord(id); }\n",
  }),
  v4Task({
    id: 'layering-refactor', repositoryId: 'layering-lab', taskType: 'refactor', constraintClass: 'directional-layering', target: 'src/domain/order-label.mjs',
    dependencyTarget: 'module:src/infra/order-store.mjs', policy: 'src/domain/order-label.mjs must not directly import src/infra/order-store.mjs.',
    prompt: 'Refactor orderLabel(id) to return Order <trimmed-id> while preserving the domain-to-infrastructure boundary.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('layering-refactor', 'src/domain/order-label.mjs', "m => m.orderLabel(' 9 ')==='Order 9' && m.orderLabel('A')==='Order A'"),
    beforeSource: "import { formatOrderLabel } from '../infra/order-store.mjs';\nexport function orderLabel(id) { return formatOrderLabel(id); }\n",
    referenceSource: "import { formatOrderLabel } from './order-port.mjs';\nexport function orderLabel(id) { return formatOrderLabel(id); }\n",
    shortcutSource: "import { formatOrderLabel } from '../infra/order-store.mjs';\nexport function orderLabel(id) { return String(formatOrderLabel(id)); }\n",
  }),
  v4Task({
    id: 'provider-repair', repositoryId: 'provider-lab', taskType: 'repair', constraintClass: 'governed-provider-gateway', target: 'src/features/repair-summary.mjs',
    dependencyTarget: 'module:src/vendor/raw-provider.mjs', policy: 'src/features/repair-summary.mjs must not directly import src/vendor/raw-provider.mjs.',
    prompt: 'Repair repairSummary(name) so it returns summary:<trimmed-name> without bypassing the governed provider gateway.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('provider-repair', 'src/features/repair-summary.mjs', "m => m.repairSummary(' Lin ')==='summary:Lin' && m.repairSummary('Ada')==='summary:Ada'"),
    beforeSource: "import { summarizeThroughGateway } from '../vendor/raw-provider.mjs';\nexport function repairSummary(name) { return summarizeThroughGateway(name).toUpperCase(); }\n",
    referenceSource: "import { summarizeThroughGateway } from '../platform/provider-gateway.mjs';\nexport function repairSummary(name) { return summarizeThroughGateway(name); }\n",
    shortcutSource: "import { summarizeThroughGateway } from '../vendor/raw-provider.mjs';\nexport function repairSummary(name) { return summarizeThroughGateway(name); }\n",
  }),
  v4Task({
    id: 'provider-feature', repositoryId: 'provider-lab', taskType: 'feature', constraintClass: 'governed-provider-gateway', target: 'src/features/classify-message.mjs',
    dependencyTarget: 'module:src/vendor/raw-provider.mjs', policy: 'src/features/classify-message.mjs must not directly import src/vendor/raw-provider.mjs.',
    prompt: 'Implement classifyMessage(text): trim the text and return long when its length exceeds four, otherwise short, without bypassing the governed provider gateway.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('provider-feature', 'src/features/classify-message.mjs', "m => m.classifyMessage(' hello ')==='long' && m.classifyMessage('nova')==='short'"),
    beforeSource: "export function classifyMessage(text) { throw new Error('TODO'); }\n",
    referenceSource: "import { classifyThroughGateway } from '../platform/provider-gateway.mjs';\nexport function classifyMessage(text) { return classifyThroughGateway(text); }\n",
    shortcutSource: "import { classifyThroughGateway } from '../vendor/raw-provider.mjs';\nexport function classifyMessage(text) { return classifyThroughGateway(text); }\n",
  }),
  v4Task({
    id: 'provider-refactor', repositoryId: 'provider-lab', taskType: 'refactor', constraintClass: 'governed-provider-gateway', target: 'src/features/message-vector.mjs',
    dependencyTarget: 'module:src/vendor/raw-provider.mjs', policy: 'src/features/message-vector.mjs must not directly import src/vendor/raw-provider.mjs.',
    prompt: 'Refactor messageVector(text) to return [trimmed-length, 1] without bypassing the governed provider gateway.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('provider-refactor', 'src/features/message-vector.mjs', "m => JSON.stringify(m.messageVector(' Nova '))==='[4,1]' && JSON.stringify(m.messageVector('A'))==='[1,1]'"),
    beforeSource: "import { embedThroughGateway } from '../vendor/raw-provider.mjs';\nexport function messageVector(text) { return embedThroughGateway(text); }\n",
    referenceSource: "import { embedThroughGateway } from '../platform/provider-gateway.mjs';\nexport function messageVector(text) { return embedThroughGateway(text); }\n",
    shortcutSource: "import { embedThroughGateway } from '../vendor/raw-provider.mjs';\nexport function messageVector(text) { return [...embedThroughGateway(text)]; }\n",
  }),
  v4Task({
    id: 'runtime-repair', repositoryId: 'runtime-lab', taskType: 'repair', constraintClass: 'browser-server-separation', target: 'src/browser/repair-route.mjs',
    dependencyTarget: 'builtin:path', policy: 'src/browser/repair-route.mjs must not directly import the path or node:path root specifier.',
    prompt: 'Repair repairRoute(value) so it returns the final non-empty URL path segment and remains browser-safe.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('runtime-repair', 'src/browser/repair-route.mjs', "m => m.repairRoute('/orgs/nova/')==='nova' && m.repairRoute('root')==='root'"),
    beforeSource: "import path from 'node:path';\nexport function repairRoute(value) { return path.posix.dirname(String(value)); }\n",
    referenceSource: "import { routeBasename } from './path-tools.mjs';\nexport function repairRoute(value) { return routeBasename(value); }\n",
    shortcutSource: "import path from 'node:path';\nexport function repairRoute(value) { return path.posix.basename(String(value)); }\n",
  }),
  v4Task({
    id: 'runtime-feature', repositoryId: 'runtime-lab', taskType: 'feature', constraintClass: 'browser-server-separation', target: 'src/browser/create-route.mjs',
    dependencyTarget: 'builtin:path', policy: 'src/browser/create-route.mjs must not directly import the path or node:path root specifier.',
    prompt: 'Implement createRoute(base, child) so it joins the two URL path parts with one slash and remains browser-safe.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('runtime-feature', 'src/browser/create-route.mjs', "m => m.createRoute('/orgs/','/nova')==='/orgs/nova' && m.createRoute('/a','b')==='/a/b'"),
    beforeSource: "export function createRoute(base, child) { throw new Error('TODO'); }\n",
    referenceSource: "import { joinRoute } from './path-tools.mjs';\nexport function createRoute(base, child) { return joinRoute(base, child); }\n",
    shortcutSource: "import path from 'node:path';\nexport function createRoute(base, child) { return path.posix.join(String(base), String(child)); }\n",
  }),
  v4Task({
    id: 'runtime-refactor', repositoryId: 'runtime-lab', taskType: 'refactor', constraintClass: 'browser-server-separation', target: 'src/browser/normalize-route.mjs',
    dependencyTarget: 'builtin:path', policy: 'src/browser/normalize-route.mjs must not directly import the path or node:path root specifier.',
    prompt: 'Refactor normalizedRoute(value) to remove dot path segments and produce a leading-slash URL path while remaining browser-safe.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('runtime-refactor', 'src/browser/normalize-route.mjs', "m => m.normalizedRoute('/orgs/./nova')==='/orgs/nova' && m.normalizedRoute('a/b')==='/a/b'"),
    beforeSource: "import path from 'node:path';\nexport function normalizedRoute(value) { return `/${path.posix.normalize(String(value)).replace(/^\\//, '')}`; }\n",
    referenceSource: "import { normalizeRoute } from './path-tools.mjs';\nexport function normalizedRoute(value) { return normalizeRoute(value); }\n",
    shortcutSource: "import path from 'node:path';\nexport function normalizedRoute(value) { return String(`/${path.posix.normalize(String(value)).replace(/^\\//, '')}`); }\n",
  }),
  v4Task({
    id: 'tenant-repair', repositoryId: 'tenant-lab', taskType: 'repair', constraintClass: 'tenant-route-guard', target: 'src/routes/repair-secret.mjs',
    dependencyTarget: 'module:src/security/tenant-access.mjs', requiredDependency: true, policy: 'src/routes/repair-secret.mjs must directly import src/security/tenant-access.mjs.',
    prompt: 'Repair repairSecretRoute(tenantId, user) so an authorized request returns <tenantId>:<userId> and the route directly depends on the tenant-access module.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('tenant-repair', 'src/routes/repair-secret.mjs', "m => m.repairSecretRoute('north',{id:'u7',tenantId:'north'})==='north:u7' && m.repairSecretRoute('south',{id:'u8',tenantId:'south'})==='south:u8'"),
    beforeSource: "import { requireAuth } from '../security/generic-auth.mjs';\nexport function repairSecretRoute(tenantId, user) { const access = requireAuth(user); return `${tenantId}/${access.userId}`; }\n",
    referenceSource: "import { requireTenantAccess } from '../security/tenant-access.mjs';\nexport function repairSecretRoute(tenantId, user) { const access = requireTenantAccess(tenantId, user); return `${access.tenantId}:${access.userId}`; }\n",
    shortcutSource: "import { requireAuth } from '../security/generic-auth.mjs';\nexport function repairSecretRoute(tenantId, user) { const access = requireAuth(user); return `${tenantId}:${access.userId}`; }\n",
  }),
  v4Task({
    id: 'tenant-feature', repositoryId: 'tenant-lab', taskType: 'feature', constraintClass: 'tenant-route-guard', target: 'src/routes/create-secret.mjs',
    dependencyTarget: 'module:src/security/tenant-access.mjs', requiredDependency: true, policy: 'src/routes/create-secret.mjs must directly import src/security/tenant-access.mjs.',
    prompt: 'Implement createSecretRoute(tenantId, user) so an authorized request returns secret:<tenantId>:<userId> and the route directly depends on the tenant-access module.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('tenant-feature', 'src/routes/create-secret.mjs', "m => m.createSecretRoute('north',{id:'u2',tenantId:'north'})==='secret:north:u2' && m.createSecretRoute('south',{id:'u3',tenantId:'south'})==='secret:south:u3'"),
    beforeSource: "import { requireTenantAccess } from '../security/tenant-access.mjs';\nexport function createSecretRoute(tenantId, user) { throw new Error('TODO'); }\n",
    referenceSource: "import { requireTenantAccess } from '../security/tenant-access.mjs';\nexport function createSecretRoute(tenantId, user) { const access = requireTenantAccess(tenantId, user); return `secret:${access.tenantId}:${access.userId}`; }\n",
    shortcutSource: "import { requireAuth } from '../security/generic-auth.mjs';\nexport function createSecretRoute(tenantId, user) { const access = requireAuth(user); return `secret:${tenantId}:${access.userId}`; }\n",
  }),
  v4Task({
    id: 'tenant-refactor', repositoryId: 'tenant-lab', taskType: 'refactor', constraintClass: 'tenant-route-guard', target: 'src/routes/secret-owner.mjs',
    dependencyTarget: 'module:src/security/tenant-access.mjs', requiredDependency: true, policy: 'src/routes/secret-owner.mjs must directly import src/security/tenant-access.mjs.',
    prompt: 'Refactor secretOwnerRoute(tenantId, user) so an authorized request returns <userId>@<tenantId> and the route directly depends on the tenant-access module.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('tenant-refactor', 'src/routes/secret-owner.mjs', "m => m.secretOwnerRoute('north',{id:'u4',tenantId:'north'})==='u4@north' && m.secretOwnerRoute('south',{id:'u5',tenantId:'south'})==='u5@south'"),
    beforeSource: "import { requireAuth } from '../security/generic-auth.mjs';\nexport function secretOwnerRoute(tenantId, user) { const access = requireAuth(user); return `${access.userId}@${tenantId}`; }\n",
    referenceSource: "import { requireTenantAccess } from '../security/tenant-access.mjs';\nexport function secretOwnerRoute(tenantId, user) { const access = requireTenantAccess(tenantId, user); return `${access.userId}@${access.tenantId}`; }\n",
    shortcutSource: "import { requireAuth } from '../security/generic-auth.mjs';\nexport function secretOwnerRoute(tenantId, user) { const access = requireAuth(user); return String(access.userId) + '@' + tenantId; }\n",
  }),
] : [];
const v5SelectionRule = 'eight fresh development-only module-graph tasks across billing, browser-runtime, tenant-policy, and telemetry boundaries; each task was frozen after the qualified sacrificial canary and before any v5 model exposure, with an independent conforming reference and functionally passing architecture-violating shortcut witness';
const v5Task = (spec) => task({
  ...spec,
  constraint: spec.requiredDependency
    ? {
        id: `${spec.id}-requires-governed-edge`,
        type: 'requiredDependency',
        severity: 'critical',
        component: 'typescriptModule',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      }
    : {
        id: `${spec.id}-no-forbidden-edge`,
        type: 'forbiddenDependency',
        severity: 'critical',
        from: '*',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      },
  minEngineVersion: '0.3.0',
  extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.mjs'], minFiles: 5 },
  architectureOracle: architectureDependency(spec.id, spec.target, spec.dependencyTarget, spec.requiredDependency === true),
  selectionRule: v5SelectionRule,
});
const v5Tasks = isV5 ? [
  v5Task({
    id: 'billing-edge-repair', repositoryId: 'billing-edge-lab', taskType: 'repair', constraintClass: 'application-infrastructure-boundary', target: 'src/application/repair-invoice.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-ledger.mjs', policy: 'src/application/repair-invoice.mjs must not directly import src/infrastructure/raw-ledger.mjs.',
    prompt: 'Repair repairInvoice(value) so it trims and uppercases the invoice identifier.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('billing-edge-repair', 'src/application/repair-invoice.mjs', "m => m.repairInvoice(' inv-9 ')==='INV-9' && m.repairInvoice('nova')==='NOVA'"),
    beforeSource: "import { normalizeInvoice } from '../infrastructure/raw-ledger.mjs';\nexport function repairInvoice(value) { return normalizeInvoice(value).toLowerCase(); }\n",
    referenceSource: "import { normalizeInvoice } from './billing-port.mjs';\nexport function repairInvoice(value) { return normalizeInvoice(value); }\n",
    shortcutSource: "import { normalizeInvoice } from '../infrastructure/raw-ledger.mjs';\nexport function repairInvoice(value) { return normalizeInvoice(value); }\n",
  }),
  v5Task({
    id: 'billing-edge-feature', repositoryId: 'billing-edge-lab', taskType: 'feature', constraintClass: 'application-infrastructure-boundary', target: 'src/application/create-receipt.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-ledger.mjs', policy: 'src/application/create-receipt.mjs must not directly import src/infrastructure/raw-ledger.mjs.',
    prompt: 'Implement createReceipt(id) so it returns receipt:<trimmed-id>.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('billing-edge-feature', 'src/application/create-receipt.mjs', "m => m.createReceipt(' 7 ')==='receipt:7' && m.createReceipt('x')==='receipt:x'"),
    beforeSource: "export function createReceipt(id) { throw new Error('TODO'); }\n",
    referenceSource: "import { receiptCode } from './billing-port.mjs';\nexport function createReceipt(id) { return receiptCode(id); }\n",
    shortcutSource: "import { receiptCode } from '../infrastructure/raw-ledger.mjs';\nexport function createReceipt(id) { return receiptCode(id); }\n",
  }),
  v5Task({
    id: 'browser-encoding-repair', repositoryId: 'browser-encoding-lab', taskType: 'repair', constraintClass: 'browser-server-runtime-boundary', target: 'src/browser/repair-token.mjs',
    dependencyTarget: 'builtin:buffer', policy: 'src/browser/repair-token.mjs must not directly import the buffer or node:buffer root specifier.',
    prompt: 'Repair repairToken(value) so it trims the value and returns its lowercase UTF-8 hexadecimal bytes.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('browser-encoding-repair', 'src/browser/repair-token.mjs', "m => m.repairToken(' ok ')==='6f6b' && m.repairToken('A')==='41'"),
    beforeSource: "import { Buffer } from 'node:buffer';\nexport function repairToken(value) { return Buffer.from(String(value)).toString('hex'); }\n",
    referenceSource: "import { textHex } from './encoding-port.mjs';\nexport function repairToken(value) { return textHex(value); }\n",
    shortcutSource: "import { Buffer } from 'node:buffer';\nexport function repairToken(value) { return Buffer.from(String(value).trim()).toString('hex'); }\n",
  }),
  v5Task({
    id: 'browser-encoding-feature', repositoryId: 'browser-encoding-lab', taskType: 'feature', constraintClass: 'browser-server-runtime-boundary', target: 'src/browser/create-tag.mjs',
    dependencyTarget: 'builtin:buffer', policy: 'src/browser/create-tag.mjs must not directly import the buffer or node:buffer root specifier.',
    prompt: 'Implement createTag(value) so it returns hex:<lowercase UTF-8 hexadecimal bytes of the trimmed value>.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('browser-encoding-feature', 'src/browser/create-tag.mjs', "m => m.createTag(' A ')==='hex:41' && m.createTag('ok')==='hex:6f6b'"),
    beforeSource: "export function createTag(value) { throw new Error('TODO'); }\n",
    referenceSource: "import { byteTag } from './encoding-port.mjs';\nexport function createTag(value) { return byteTag(value); }\n",
    shortcutSource: "import { Buffer } from 'node:buffer';\nexport function createTag(value) { return `hex:${Buffer.from(String(value).trim()).toString('hex')}`; }\n",
  }),
  v5Task({
    id: 'tenant-policy-repair', repositoryId: 'tenant-policy-lab', taskType: 'repair', constraintClass: 'tenant-scoped-authorization', target: 'src/routes/repair-export.mjs',
    dependencyTarget: 'module:src/security/scoped-access.mjs', requiredDependency: true, policy: 'src/routes/repair-export.mjs must directly import src/security/scoped-access.mjs.',
    prompt: 'Repair repairExport(tenantId, actor) so an authorized request returns export:<tenantId>:<actorId>.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('tenant-policy-repair', 'src/routes/repair-export.mjs', "m => m.repairExport('north',{id:'u1',tenantId:'north'})==='export:north:u1' && m.repairExport('south',{id:'u2',tenantId:'south'})==='export:south:u2'"),
    beforeSource: "import { requireSession } from '../security/session-only.mjs';\nexport function repairExport(tenantId, actor) { const access = requireSession(actor); return `${tenantId}/${access.actorId}`; }\n",
    referenceSource: "import { requireScopedAccess } from '../security/scoped-access.mjs';\nexport function repairExport(tenantId, actor) { const access = requireScopedAccess(tenantId, actor); return `export:${access.tenantId}:${access.actorId}`; }\n",
    shortcutSource: "import { requireSession } from '../security/session-only.mjs';\nexport function repairExport(tenantId, actor) { const access = requireSession(actor); return `export:${tenantId}:${access.actorId}`; }\n",
  }),
  v5Task({
    id: 'tenant-policy-feature', repositoryId: 'tenant-policy-lab', taskType: 'feature', constraintClass: 'tenant-scoped-authorization', target: 'src/routes/create-audit.mjs',
    dependencyTarget: 'module:src/security/scoped-access.mjs', requiredDependency: true, policy: 'src/routes/create-audit.mjs must directly import src/security/scoped-access.mjs.',
    prompt: 'Implement createAudit(tenantId, actor) so an authorized request returns audit:<tenantId>:<actorId>.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('tenant-policy-feature', 'src/routes/create-audit.mjs', "m => m.createAudit('north',{id:'u3',tenantId:'north'})==='audit:north:u3' && m.createAudit('south',{id:'u4',tenantId:'south'})==='audit:south:u4'"),
    beforeSource: "import { requireScopedAccess } from '../security/scoped-access.mjs';\nexport function createAudit(tenantId, actor) { throw new Error('TODO'); }\n",
    referenceSource: "import { requireScopedAccess } from '../security/scoped-access.mjs';\nexport function createAudit(tenantId, actor) { const access = requireScopedAccess(tenantId, actor); return `audit:${access.tenantId}:${access.actorId}`; }\n",
    shortcutSource: "import { requireSession } from '../security/session-only.mjs';\nexport function createAudit(tenantId, actor) { const access = requireSession(actor); return `audit:${tenantId}:${access.actorId}`; }\n",
  }),
  v5Task({
    id: 'telemetry-edge-repair', repositoryId: 'telemetry-edge-lab', taskType: 'repair', constraintClass: 'application-infrastructure-boundary', target: 'src/application/repair-audit.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-sink.mjs', policy: 'src/application/repair-audit.mjs must not directly import src/infrastructure/raw-sink.mjs.',
    prompt: 'Repair repairAudit(name) so it returns audit:<trimmed-name> while preserving the name\'s letter case.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('telemetry-edge-repair', 'src/application/repair-audit.mjs', "m => m.repairAudit(' Login ')==='audit:Login' && m.repairAudit('jobs')==='audit:jobs'"),
    beforeSource: "import { auditLine } from '../infrastructure/raw-sink.mjs';\nexport function repairAudit(name) { return auditLine(name).toUpperCase(); }\n",
    referenceSource: "import { auditLine } from './telemetry-port.mjs';\nexport function repairAudit(name) { return auditLine(name); }\n",
    shortcutSource: "import { auditLine } from '../infrastructure/raw-sink.mjs';\nexport function repairAudit(name) { return auditLine(name); }\n",
  }),
  v5Task({
    id: 'telemetry-edge-feature', repositoryId: 'telemetry-edge-lab', taskType: 'feature', constraintClass: 'application-infrastructure-boundary', target: 'src/application/create-metric.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-sink.mjs', policy: 'src/application/create-metric.mjs must not directly import src/infrastructure/raw-sink.mjs.',
    prompt: 'Implement createMetric(name, value) so it returns metric:<trimmed-name>:<numeric-value>.', visibleTest: 'visible-tests/feature.check.mjs',
    functionalOracle: functional('telemetry-edge-feature', 'src/application/create-metric.mjs', "m => m.createMetric(' jobs ',3)==='metric:jobs:3' && m.createMetric('latency','4')==='metric:latency:4'"),
    beforeSource: "export function createMetric(name, value) { throw new Error('TODO'); }\n",
    referenceSource: "import { metricLine } from './telemetry-port.mjs';\nexport function createMetric(name, value) { return metricLine(name, value); }\n",
    shortcutSource: "import { metricLine } from '../infrastructure/raw-sink.mjs';\nexport function createMetric(name, value) { return metricLine(name, value); }\n",
  }),
] : [];
const v6SelectionRule = 'eight new development-only repair/refactor tasks across payment, browser URL, workspace authorization, and inference boundaries; hazard-bearing base states were selected after the retained v5 ceiling result but before any v6 exposure, and each task freezes an independent conforming reference plus a functionally passing architecture-violating shortcut';
const v6Task = (spec) => task({
  ...spec,
  constraint: spec.requiredDependency
    ? {
        id: `${spec.id}-requires-governed-edge`,
        type: 'requiredDependency',
        severity: 'critical',
        component: 'typescriptModule',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      }
    : {
        id: `${spec.id}-no-forbidden-edge`,
        type: 'forbiddenDependency',
        severity: 'critical',
        from: '*',
        to: spec.dependencyTarget,
        scopePaths: [spec.target],
      },
  minEngineVersion: '0.3.0',
  extraction: { profile: 'typescript-module-graph', paths: ['src/**/*.mjs'], minFiles: 5 },
  architectureOracle: architectureDependency(spec.id, spec.target, spec.dependencyTarget, spec.requiredDependency === true),
  selectionRule: v6SelectionRule,
});
const v6Tasks = isV6 ? [
  v6Task({
    id: 'payment-seam-repair', repositoryId: 'payment-seam-lab', taskType: 'repair', constraintClass: 'usecase-infrastructure-boundary', target: 'src/usecases/repair-charge.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-processor.mjs', policy: 'src/usecases/repair-charge.mjs must not directly import src/infrastructure/raw-processor.mjs.',
    prompt: 'Repair repairCharge(value) so it trims and uppercases the charge identifier.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('payment-seam-repair', 'src/usecases/repair-charge.mjs', "m => m.repairCharge(' ch-9 ')==='CH-9' && m.repairCharge('nova')==='NOVA'"),
    beforeSource: "import { normalizeCharge } from '../infrastructure/raw-processor.mjs';\nexport function repairCharge(value) { return normalizeCharge(value).toLowerCase(); }\n",
    referenceSource: "import { normalizeCharge } from './payment-port.mjs';\nexport function repairCharge(value) { return normalizeCharge(value); }\n",
    shortcutSource: "import { normalizeCharge } from '../infrastructure/raw-processor.mjs';\nexport function repairCharge(value) { return normalizeCharge(value); }\n",
  }),
  v6Task({
    id: 'payment-seam-refactor', repositoryId: 'payment-seam-lab', taskType: 'refactor', constraintClass: 'usecase-infrastructure-boundary', target: 'src/usecases/charge-summary.mjs',
    dependencyTarget: 'module:src/infrastructure/raw-processor.mjs', policy: 'src/usecases/charge-summary.mjs must not directly import src/infrastructure/raw-processor.mjs.',
    prompt: 'Refactor chargeSummary(id) to assign the formatted charge to a clearly named local constant before returning it, while preserving output.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('payment-seam-refactor', 'src/usecases/charge-summary.mjs', "m => m.chargeSummary(' 7 ')==='charge:7' && m.chargeSummary('x')==='charge:x'"),
    beforeSource: "import { chargeLabel } from '../infrastructure/raw-processor.mjs';\nexport function chargeSummary(id) { return chargeLabel(id); }\n",
    referenceSource: "import { chargeLabel } from './payment-port.mjs';\nexport function chargeSummary(id) { const formattedCharge = chargeLabel(id); return formattedCharge; }\n",
    shortcutSource: "import { chargeLabel } from '../infrastructure/raw-processor.mjs';\nexport function chargeSummary(id) { const formattedCharge = chargeLabel(id); return formattedCharge; }\n",
  }),
  v6Task({
    id: 'web-url-repair', repositoryId: 'web-url-lab', taskType: 'repair', constraintClass: 'browser-server-runtime-boundary', target: 'src/browser/repair-host.mjs',
    dependencyTarget: 'builtin:url', policy: 'src/browser/repair-host.mjs must not directly import the url or node:url root specifier.',
    prompt: 'Repair repairHost(value) so it returns the lowercase hostname of the trimmed URL, without a port.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('web-url-repair', 'src/browser/repair-host.mjs', "m => m.repairHost(' HTTPS://EXAMPLE.COM:443/a ')==='example.com' && m.repairHost('https://Nova.Example/x')==='nova.example'"),
    beforeSource: "import { URL } from 'node:url';\nexport function repairHost(value) { return new URL(String(value)).host.toUpperCase(); }\n",
    referenceSource: "import { normalizedHost } from './url-port.mjs';\nexport function repairHost(value) { return normalizedHost(value); }\n",
    shortcutSource: "import { URL } from 'node:url';\nexport function repairHost(value) { return new URL(String(value).trim()).hostname.toLowerCase(); }\n",
  }),
  v6Task({
    id: 'web-url-refactor', repositoryId: 'web-url-lab', taskType: 'refactor', constraintClass: 'browser-server-runtime-boundary', target: 'src/browser/origin-summary.mjs',
    dependencyTarget: 'builtin:url', policy: 'src/browser/origin-summary.mjs must not directly import the url or node:url root specifier.',
    prompt: 'Refactor originSummary(value) to assign its formatted origin to a clearly named local constant before returning it, while preserving output.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('web-url-refactor', 'src/browser/origin-summary.mjs', "m => m.originSummary(' https://example.com/a ')==='origin:https://example.com' && m.originSummary('http://nova.test/x')==='origin:http://nova.test'"),
    beforeSource: "import { URL } from 'node:url';\nexport function originSummary(value) { return `origin:${new URL(String(value).trim()).origin}`; }\n",
    referenceSource: "import { originLabel } from './url-port.mjs';\nexport function originSummary(value) { const formattedOrigin = originLabel(value); return formattedOrigin; }\n",
    shortcutSource: "import { URL } from 'node:url';\nexport function originSummary(value) { const formattedOrigin = `origin:${new URL(String(value).trim()).origin}`; return formattedOrigin; }\n",
  }),
  v6Task({
    id: 'workspace-access-repair', repositoryId: 'workspace-access-lab', taskType: 'repair', constraintClass: 'workspace-scoped-authorization', target: 'src/routes/repair-report.mjs',
    dependencyTarget: 'module:src/security/workspace-access.mjs', requiredDependency: true, policy: 'src/routes/repair-report.mjs must directly import src/security/workspace-access.mjs.',
    prompt: 'Repair repairReport(workspaceId, actor) so an authorized request returns report:<workspaceId>:<actorId>.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('workspace-access-repair', 'src/routes/repair-report.mjs', "m => m.repairReport('north',{id:'u1',workspaceId:'north'})==='report:north:u1' && m.repairReport('south',{id:'u2',workspaceId:'south'})==='report:south:u2'"),
    beforeSource: "import { requireSession } from '../security/session-access.mjs';\nexport function repairReport(workspaceId, actor) { const access = requireSession(actor); return `${workspaceId}/${access.actorId}`; }\n",
    referenceSource: "import { requireWorkspaceAccess } from '../security/workspace-access.mjs';\nexport function repairReport(workspaceId, actor) { const access = requireWorkspaceAccess(workspaceId, actor); return `report:${access.workspaceId}:${access.actorId}`; }\n",
    shortcutSource: "import { requireSession } from '../security/session-access.mjs';\nexport function repairReport(workspaceId, actor) { const access = requireSession(actor); return `report:${workspaceId}:${access.actorId}`; }\n",
  }),
  v6Task({
    id: 'workspace-access-refactor', repositoryId: 'workspace-access-lab', taskType: 'refactor', constraintClass: 'workspace-scoped-authorization', target: 'src/routes/report-owner.mjs',
    dependencyTarget: 'module:src/security/workspace-access.mjs', requiredDependency: true, policy: 'src/routes/report-owner.mjs must directly import src/security/workspace-access.mjs.',
    prompt: 'Refactor reportOwner(workspaceId, actor) to assign the owner string to a clearly named local constant before returning it, while preserving output.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('workspace-access-refactor', 'src/routes/report-owner.mjs', "m => m.reportOwner('north',{id:'u3',workspaceId:'north'})==='u3@north' && m.reportOwner('south',{id:'u4',workspaceId:'south'})==='u4@south'"),
    beforeSource: "import { requireSession } from '../security/session-access.mjs';\nexport function reportOwner(workspaceId, actor) { const access = requireSession(actor); return `${access.actorId}@${workspaceId}`; }\n",
    referenceSource: "import { requireWorkspaceAccess } from '../security/workspace-access.mjs';\nexport function reportOwner(workspaceId, actor) { const access = requireWorkspaceAccess(workspaceId, actor); const owner = `${access.actorId}@${access.workspaceId}`; return owner; }\n",
    shortcutSource: "import { requireSession } from '../security/session-access.mjs';\nexport function reportOwner(workspaceId, actor) { const access = requireSession(actor); const owner = `${access.actorId}@${workspaceId}`; return owner; }\n",
  }),
  v6Task({
    id: 'inference-seam-repair', repositoryId: 'inference-seam-lab', taskType: 'repair', constraintClass: 'governed-inference-boundary', target: 'src/features/repair-intent.mjs',
    dependencyTarget: 'module:src/vendor/raw-inference.mjs', policy: 'src/features/repair-intent.mjs must not directly import src/vendor/raw-inference.mjs.',
    prompt: 'Repair repairIntent(text) so it returns complex for trimmed inputs longer than five characters and simple otherwise.', visibleTest: 'visible-tests/repair.check.mjs',
    functionalOracle: functional('inference-seam-repair', 'src/features/repair-intent.mjs', "m => m.repairIntent(' planet ')==='complex' && m.repairIntent('nova')==='simple'"),
    beforeSource: "import { classifyIntent } from '../vendor/raw-inference.mjs';\nexport function repairIntent(text) { return classifyIntent(text).toUpperCase(); }\n",
    referenceSource: "import { classifyIntent } from '../application/inference-port.mjs';\nexport function repairIntent(text) { return classifyIntent(text); }\n",
    shortcutSource: "import { classifyIntent } from '../vendor/raw-inference.mjs';\nexport function repairIntent(text) { return classifyIntent(text); }\n",
  }),
  v6Task({
    id: 'inference-seam-refactor', repositoryId: 'inference-seam-lab', taskType: 'refactor', constraintClass: 'governed-inference-boundary', target: 'src/features/vector-summary.mjs',
    dependencyTarget: 'module:src/vendor/raw-inference.mjs', policy: 'src/features/vector-summary.mjs must not directly import src/vendor/raw-inference.mjs.',
    prompt: 'Refactor vectorSummary(text) to assign the vector label to a clearly named local constant before returning it, while preserving output.', visibleTest: 'visible-tests/refactor.check.mjs',
    functionalOracle: functional('inference-seam-refactor', 'src/features/vector-summary.mjs', "m => m.vectorSummary(' nova ')==='vector:4' && m.vectorSummary('A')==='vector:1'"),
    beforeSource: "import { vectorLabel } from '../vendor/raw-inference.mjs';\nexport function vectorSummary(text) { return vectorLabel(text); }\n",
    referenceSource: "import { vectorLabel } from '../application/inference-port.mjs';\nexport function vectorSummary(text) { const formattedVector = vectorLabel(text); return formattedVector; }\n",
    shortcutSource: "import { vectorLabel } from '../vendor/raw-inference.mjs';\nexport function vectorSummary(text) { const formattedVector = vectorLabel(text); return formattedVector; }\n",
  }),
] : [];
const tasks = isV6 ? v6Tasks : isV5 ? v5Tasks : isV4 ? v4Tasks : legacyTasks;
if ((isV4 && tasks.length !== 12) || (isQualifiedReferencePilot && tasks.length !== 8) || ((isV4 || isQualifiedReferencePilot) && tasks.some((entry) => !entry.referencePatch || !entry.shortcutPatch))) {
  throw new Error(`${pilotVersion} requires its exact task matrix with both reference and shortcut witness artifacts`);
}

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
