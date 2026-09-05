import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bce-package-proof-'));
const npmExecPath = process.env.npm_execpath;
const npm = (args, options) => npmExecPath
  ? execFileSync(process.execPath, [npmExecPath, ...args], options)
  : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);

npm(['run', 'build'], { cwd: root, stdio: 'inherit' });
const packOutput = npm(['pack', '--json', '--pack-destination', scratch], { cwd: root, encoding: 'utf8' });
// Git/npm lifecycle output may precede npm's JSON when `prepare` builds the
// package. Parse the final JSON document, not the build log.
const jsonStart = packOutput.lastIndexOf('\n[');
const packed = JSON.parse(packOutput.slice(jsonStart >= 0 ? jsonStart + 1 : 0));
const tarball = join(scratch, packed[0].filename);
npm(['init', '-y'], { cwd: scratch, stdio: 'ignore' });
npm(['install', '--ignore-scripts', tarball], { cwd: scratch, stdio: 'inherit' });
const installedRoot = join(scratch, 'node_modules', 'bce-engine');
const installedCli = join(installedRoot, 'dist', 'cli.js');
const installedMcp = join(installedRoot, 'dist', 'mcp-server.js');

function callInstalledRunGate(repoDir, blueprintDir) {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'run_gate', arguments: { repoDir, blueprintDir, extractor: 'ast' } },
    },
  ].map((request) => JSON.stringify(request)).join('\n') + '\n';
  const run = spawnSync(process.execPath, [installedMcp], {
    cwd: repoDir,
    input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    throw new Error(`installed MCP exited ${run.status}; stderr:\n${run.stderr}`);
  }
  const responses = run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const response = responses.find((item) => item.id === 2);
  if (!response || response.error || response.result?.isError || !response.result?.structuredContent) {
    throw new Error(`installed MCP run_gate failed: ${JSON.stringify(response)}`);
  }
  return response.result.structuredContent;
}

const output = execFileSync(process.execPath, [installedCli, 'demo'], { cwd: scratch, encoding: 'utf8' });

for (const marker of [
  'GREEN conformant: score 100, exit 0',
  'RED drift-forbidden-import:',
  'violation no-direct-provider-sdk',
  'package fixtures discriminate GREEN from RED',
]) {
  if (!output.includes(marker)) throw new Error(`packed consumer proof missing marker: ${marker}`);
}

const recipeOutput = execFileSync(process.execPath, [installedCli, 'demo', '--recipe', 'all'], {
  cwd: scratch,
  encoding: 'utf8',
});
for (const marker of [
  'recipe extension-contract',
  'recipe tenant-route-guard',
  'recipe governed-egress',
  'recipe python-provider-import',
  'recipe configuration-allowlist',
  'recipe module-layering',
  'bce demo: 6/6 packaged recipes discriminate GREEN from RED',
]) {
  if (!recipeOutput.includes(marker)) throw new Error(`packed recipe proof missing marker: ${marker}`);
}

// Prove the installed MCP bin, not only source imports or CLI recipes, can drive the new module
// profile through its normal zero-mutation run_gate surface. This is the actual agent setup path.
const moduleBlueprintDir = join(scratch, 'module-blueprints');
mkdirSync(moduleBlueprintDir, { recursive: true });
writeFileSync(
  join(moduleBlueprintDir, 'typescript-module-layering.blueprint.json'),
  readFileSync(join(installedRoot, 'fixtures', 'typescript-module-layering.blueprint.json')),
);
const moduleTrees = join(installedRoot, 'fixtures', 'typescript-module-surface');
const mcpGreen = callInstalledRunGate(join(moduleTrees, 'conformant'), moduleBlueprintDir);
const mcpRed = callInstalledRunGate(join(moduleTrees, 'drift-reverse-layer'), moduleBlueprintDir);
if (mcpGreen.gateFailed !== false || mcpGreen.outcome !== 'pass' || mcpGreen.exitCode !== 0) {
  throw new Error(`packed MCP module GREEN contract failed: ${JSON.stringify(mcpGreen)}`);
}
if (mcpRed.gateFailed !== true || mcpRed.outcome !== 'violation' || mcpRed.exitCode !== 1) {
  throw new Error(`packed MCP module RED contract failed: ${JSON.stringify(mcpRed)}`);
}
if (!JSON.stringify(mcpRed).includes('domain-cannot-import-app') ||
    !JSON.stringify(mcpRed).includes('packages/domain/order.ts#L1')) {
  throw new Error('packed MCP module RED omitted the named reverse edge and source line');
}

const installed = JSON.parse(readFileSync(join(scratch, 'node_modules', 'bce-engine', 'package.json'), 'utf8'));
const releaseState = JSON.parse(readFileSync(join(scratch, 'node_modules', 'bce-engine', 'release-state.json'), 'utf8'));
if (installed.engines?.node !== '>=22') throw new Error('packed package does not enforce Node >=22');
const sourceVersion = releaseState.candidateVersion ?? releaseState.currentVersion;
if (sourceVersion !== installed.version) {
  throw new Error(`packed version ${installed.version} differs from release-state source version ${sourceVersion}`);
}
const publicApi = await import(pathToFileURL(join(installedRoot, 'dist', 'index.js')).href);
for (const symbol of [
  'buildProposalContext', 'compileDraftPlan', 'inspectBlueprint', 'explainConstraint',
  'compareBlueprintPolicy', 'buildReviewPacket', 'verifyReviewPacket', 'recordReviewDecision',
]) {
  if (typeof publicApi[symbol] !== 'function') throw new Error(`packed public API is missing ${symbol}`);
}
for (const symbol of ['BlueprintReviewPacketSchema', 'BlueprintDecisionRecordSchema']) {
  if (!(symbol in publicApi)) throw new Error(`packed public API is missing ${symbol}`);
}
for (const forbidden of ['ratifyBlueprint', 'amendBlueprint', 'authenticateGitHubDecision', 'reauthenticateGitHubDecision']) {
  if (forbidden in publicApi) throw new Error(`packed deterministic API exposes privileged shell operation ${forbidden}`);
}

// Exercise the installed proposal/review path, not only source-tree imports. The executing artifact
// identity must bind dist/**, ignore the shipped explanatory src/**, and never inherit consumer HEAD.
writeFileSync(join(scratch, '.gitignore'), 'node_modules/\nreview-repo/\nfake-responses.mjs\n');
execFileSync('git', ['init', '-q', '-b', 'main', scratch]);
execFileSync('git', ['-C', scratch, 'add', 'package.json', 'package-lock.json', '.gitignore']);
execFileSync('git', ['-C', scratch, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'consumer']);
const consumerHead = execFileSync('git', ['-C', scratch, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const reviewRepo = join(scratch, 'review-repo');
mkdirSync(join(reviewRepo, 'docs'), { recursive: true });
mkdirSync(join(reviewRepo, 'src'), { recursive: true });
writeFileSync(join(reviewRepo, 'docs', 'intent.md'), 'Keep the extension surface explicit.\n');
writeFileSync(join(reviewRepo, 'src', 'index.ts'), 'export default function GatewayExtension() { return 1; }\n');
writeFileSync(join(reviewRepo, '.gitignore'), '.bce/\n');
execFileSync('git', ['init', '-q', '-b', 'main', reviewRepo]);
execFileSync('git', ['-C', reviewRepo, 'remote', 'add', 'origin', 'https://github.com/example/installed-proof.git']);
execFileSync('git', ['-C', reviewRepo, 'add', '.']);
execFileSync('git', ['-C', reviewRepo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture']);
const preload = join(scratch, 'fake-responses.mjs');
writeFileSync(preload, `
globalThis.fetch = async (_url, init) => {
  const context = JSON.parse(JSON.parse(String(init.body)).input).proposalContext;
  const source = context.files.find((file) => file.path === 'src/index.ts');
  const intent = context.authoritativeIntentRefs[0];
  const assertion = {
    claim: 'The extension surface is explicit.', basis: 'source-backed-intent',
    anchors: [{ kind: 'intent-reference', ref: intent.ref, sha256: intent.sha256, lineStart: 1 }],
    uncertainty: { level: 'low', reason: 'The disclosed intent states the boundary.' },
    alternatives: ['Use another explicit extension surface.'], knownBlindSpots: []
  };
  const plan = {
    schemaVersion: '1', kind: 'BlueprintDraftPlan', proposalId: 'installed-artifact-proof',
    contextDigest: context.contextDigest,
    metadata: { id: 'installed-artifact-proof', version: '0.1.0' },
    scope: { repositories: [context.repository.identity], paths: ['src/**/*.ts'], assertions: [{
      claim: 'The source is disclosed.', basis: 'observed-fact',
      anchors: [{ kind: 'repository-file', ref: source.path, sha256: source.sha256, lineStart: 1 }],
      uncertainty: { level: 'none', reason: 'The file is present in the disclosure.' }, alternatives: [], knownBlindSpots: []
    }] },
    architecture: { components: [], relationships: [] },
    clauses: [{ constraint: { id: 'extension-exists', type: 'requiredComponent', severity: 'critical', component: 'pluginSurface' }, assertions: [assertion] }],
    evidenceRequirements: [{ type: 'staticAst', required: true, onMissing: 'block' }], approvals: [],
    extraction: { profile: 'plugin-surface', paths: ['src/**/*.ts'], minFiles: 1 }, knownBlindSpots: []
  };
  return new Response(JSON.stringify({ id: 'resp_installed', status: 'completed', model: 'fixture-model', output_text: JSON.stringify(plan) }));
};
`);
execFileSync(process.execPath, [
  '--import', pathToFileURL(preload).href, installedCli, 'propose', '--repo', reviewRepo, '--intent-file', 'docs/intent.md',
  '--assistant', 'openai-responses', '--assistant-model', 'fixture-model', '--new',
], { cwd: scratch, env: { ...process.env, OPENAI_API_KEY: 'test-key' }, stdio: 'ignore' });
const packetPath = join(reviewRepo, '.bce', 'proposals', 'installed-artifact-proof', 'review-packet.json');
const packet = JSON.parse(readFileSync(packetPath, 'utf8'));
if (packet.identity.engine.sourceRevision === consumerHead) throw new Error('installed engine inherited consumer repository HEAD');
appendFileSync(join(installedRoot, 'src', 'cli.ts'), '\n// packed source mutation must not alter executing artifact identity\n');
execFileSync(process.execPath, [installedCli, 'review', 'show', '--repo', reviewRepo, '--packet', '.bce/proposals/installed-artifact-proof/review-packet.json'], { cwd: scratch, stdio: 'ignore' });
appendFileSync(join(installedRoot, 'dist', 'index.js'), '\n// packed dist mutation must stale review identity\n');
const staleInstalled = spawnSync(process.execPath, [installedCli, 'review', 'show', '--repo', reviewRepo, '--packet', '.bce/proposals/installed-artifact-proof/review-packet.json'], { cwd: scratch, encoding: 'utf8' });
if (staleInstalled.status !== 2 || !staleInstalled.stderr.includes('engine identity changed')) {
  throw new Error('installed review did not bind the executing dist artifact');
}
for (const rel of [
  'skills/bce/SKILL.md',
  'skills/bce/references/lifecycle.md',
  'scripts/model-adoption-eval.mjs',
  '.claude-plugin/plugin.json',
  'integrations/README.md',
  'docs/onboarding.md',
  'docs/ai-first-review.md',
  'prompts/blueprint-author.md',
  'spec/schemas/engineering-blueprint.schema.json',
  'spec/schemas/blueprint-review-packet.schema.json',
  'spec/schemas/blueprint-decision-record.schema.json',
  'spec/skill-standard/SKILL-STANDARD.md',
  'spec/skill-standard/skill-standard.blueprint.json',
  'examples/quickstart/README.md',
  'evidence/example-chain/README.md',
  'tools/verify-chain.mjs',
  'action.yml',
  'llms.txt',
]) {
  readFileSync(join(installedRoot, rel));
}

// Release-facing instructions are part of the package interface. A staged
// candidate may carry its own version plus the predecessor registry release;
// a stable source tree carries one version. Any third version is stale guidance.
// Historical Lane-A ceremony docs are outside this set because they describe
// earlier admitted engines.
for (const rel of [
  'README.md',
  'docs/agent-loop.md',
  'docs/first-win.md',
  'docs/onboarding.md',
  'docs/quickstart.md',
  'examples/first-win/README.md',
  'examples/quickstart/README.md',
  'skills/README.md',
  'skills/bce/SKILL.md',
  'skills/bce/references/lifecycle.md',
  'llms.txt',
]) {
  const text = readFileSync(join(installedRoot, rel), 'utf8');
  const exactPackage = `bce-engine@${installed.version}`;
  if (text.includes(exactPackage) && !text.includes(`npm view ${exactPackage} version dist.integrity`)) {
    throw new Error(
      `packed release guidance lacks an exact registry-integrity preflight in ${rel}: ${exactPackage}`,
    );
  }
  const allowedVersions = new Set([installed.version, releaseState.currentVersion]);
  for (const pattern of [
    /bce-engine@(\d+\.\d+\.\d+)/g,
    /bce-engine\/v\/(\d+\.\d+\.\d+)/g,
    /blueprint-conformance\/bce@v(\d+\.\d+\.\d+)/g,
    /Status: v(\d+\.\d+\.\d+) released/g,
  ]) {
    for (const match of text.matchAll(pattern)) {
      if (!allowedVersions.has(match[1])) {
        throw new Error(
          `packed release guidance is stale in ${rel}: ${match[0]} is neither source ${installed.version} nor registry release ${releaseState.currentVersion}`,
        );
      }
    }
  }
}
process.stdout.write(output);
process.stdout.write('packed MCP module-layering run_gate: GREEN/RED PASS\n');
process.stdout.write(`packed consumer proof: PASS (${packed[0].filename})\n`);
