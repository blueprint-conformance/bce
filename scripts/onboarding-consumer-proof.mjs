/**
 * A black-box, fresh-consumer proof for the published and Git dependency paths.
 *
 * The proof deliberately invokes only installed `bce` / `bce-mcp` binaries after
 * installation. It does not import BCE internals or reuse repository fixtures for
 * the authored-repository lifecycle.
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bce-onboarding-consumer-proof-'));
const expectedTools = [
  'assess_teeth',
  'check_baseline',
  'doctor_repository',
  'get_report',
  'run_gate',
  'validate_blueprint',
];
const npmBin = realpathSync(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim());

function fail(message) {
  throw new Error(`${message}\nproof scratch retained at ${scratch}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function run(file, args, options = {}) {
  try {
    const stdout = execFileSync(file, args, {
      cwd: options.cwd ?? scratch,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const result = {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: String(error.stdout ?? ''),
      stderr: String(error.stderr ?? error.message ?? ''),
    };
    if (options.accept?.includes(result.status)) return result;
    fail(
      `command failed (${result.status}): ${file} ${args.join(' ')}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function npm(args, cwd, options = {}) {
  return run(process.execPath, [npmBin, ...args], { cwd, ...options });
}

function installedBin(consumerDir, name) {
  const bin = join(consumerDir, 'node_modules', '.bin', name);
  assert(existsSync(bin), `installed package is missing ${name} binary`);
  return bin;
}

function bce(bin, args, cwd, options = {}) {
  return run(process.execPath, [bin, ...args], { cwd, ...options });
}

function requireMarkers(text, markers, label) {
  for (const marker of markers) {
    assert(text.includes(marker), `${label} missing marker: ${marker}\nactual:\n${text}`);
  }
}

async function rpcRoundTrip(serverBin, cwd, requests) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [serverBin], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`MCP timeout\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    }, 60_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(`MCP exited ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        return;
      }
      const responses = new Map();
      try {
        for (const line of stdout.split('\n').filter((x) => x.trim())) {
          const doc = JSON.parse(line);
          if (doc.id !== null && doc.id !== undefined) responses.set(doc.id, doc);
        }
      } catch (error) {
        rejectPromise(new Error(`MCP emitted non-JSON output: ${error.message}\n${stdout}`));
        return;
      }
      resolvePromise(responses);
    });
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

async function proveMcp(serverBin, repoDir, blueprintPath, reportPath) {
  const calls = [
    ['doctor_repository', { repoDir }],
    ['check_baseline', { repoDir }],
    ['validate_blueprint', { blueprintPath }],
    ['run_gate', { repoDir, extractor: 'ast' }],
    ['assess_teeth', { blueprintPath, repoDir, extractor: 'ast' }],
    ['get_report', { reportPath }],
  ];
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ...calls.map(([name, args], index) => ({
      jsonrpc: '2.0',
      id: index + 3,
      method: 'tools/call',
      params: { name, arguments: args },
    })),
  ];
  const responses = await rpcRoundTrip(serverBin, repoDir, requests);
  assert(responses.get(1)?.result?.serverInfo?.name === 'bce-mcp', 'MCP initialize did not identify bce-mcp');
  const names = responses.get(2)?.result?.tools?.map((tool) => tool.name).sort();
  assert(JSON.stringify(names) === JSON.stringify(expectedTools), `MCP tool set mismatch: ${JSON.stringify(names)}`);
  for (let index = 0; index < calls.length; index++) {
    const [name] = calls[index];
    const response = responses.get(index + 3);
    assert(response && !response.error, `MCP ${name} returned a protocol error`);
    assert(response.result?.isError === false, `MCP ${name} returned isError: ${JSON.stringify(response.result)}`);
    assert(response.result?.structuredContent, `MCP ${name} omitted structuredContent`);
  }
}

function initializeConsumer(dir) {
  mkdirSync(dir, { recursive: true });
  npm(['init', '-y'], dir);
}

function proveDemo(bin, cwd, label) {
  const result = bce(bin, ['demo'], cwd);
  requireMarkers(
    result.stdout,
    [
      'GREEN conformant: score 100, exit 0',
      'RED drift-forbidden-import:',
      'violation no-direct-provider-sdk',
      'package fixtures discriminate GREEN from RED',
    ],
    label,
  );
}

function createGitSnapshot(target) {
  cpSync(root, target, {
    recursive: true,
    filter(source) {
      const rel = relative(root, source).split('\\').join('/');
      if (!rel) return true;
      const first = rel.split('/')[0];
      return first !== '.git' && first !== 'node_modules' && first !== '.ai';
    },
  });
  run('git', ['init', '-q'], { cwd: target });
  run('git', ['add', '.'], { cwd: target });
  run(
    'git',
    ['-c', 'user.name=BCE Consumer Proof', '-c', 'user.email=proof@example.invalid', 'commit', '-q', '-m', 'consumer snapshot'],
    { cwd: target },
  );
  return run('git', ['rev-parse', 'HEAD'], { cwd: target }).stdout.trim();
}

assert(Number(process.versions.node.split('.')[0]) >= 22, `proof requires Node >=22; got ${process.versions.node}`);
process.stdout.write(`onboarding consumer proof: Node ${process.versions.node}\n`);

// Build once, then prove the exact npm tarball can run without lifecycle scripts.
npm(['run', 'build'], root);
const packStdout = npm(['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], root).stdout;
// npm may stream prepare/build output before its requested JSON document. Anchor to the
// package-result object rather than assuming stdout is a JSON-only channel.
const packJsonStart = packStdout.lastIndexOf('[\n  {\n    "id":');
assert(packJsonStart >= 0, `npm pack did not emit its JSON result:\n${packStdout}`);
const packResult = JSON.parse(packStdout.slice(packJsonStart));
assert(packResult.length === 1, 'npm pack did not produce exactly one artifact');
const tarball = join(scratch, packResult[0].filename);
assert(existsSync(tarball), `npm pack artifact missing: ${tarball}`);

const packedConsumer = join(scratch, 'packed-consumer');
initializeConsumer(packedConsumer);
npm(['install', '--ignore-scripts', tarball], packedConsumer);
const packedBce = installedBin(packedConsumer, 'bce');
const packedMcp = installedBin(packedConsumer, 'bce-mcp');
proveDemo(packedBce, packedConsumer, 'packed demo');

const installedRoot = join(packedConsumer, 'node_modules', 'bce-engine');
const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
assert(installedPackage.engines?.node === '>=22', 'packed package does not declare Node >=22');
const documentedScopePaths = 'src/**/*.js,src/**/*.jsx,src/**/*.ts,src/**/*.tsx';
const installedOnboarding = readFileSync(join(installedRoot, 'docs', 'onboarding.md'), 'utf8');
assert(
  installedOnboarding.includes(`--scope-paths '${documentedScopePaths}'`),
  'packed onboarding guide lost the executable multi-extension scope example',
);
for (const rel of [
  'skills/bce/SKILL.md',
  'skills/bce/references/lifecycle.md',
  'prompts/blueprint-author.md',
  'scripts/ai-adoption-proof.mjs',
  'scripts/model-adoption-eval.mjs',
  'integrations/AGENTS.md.snippet',
  'docs/onboarding.md',
  'spec/schemas/engineering-blueprint.schema.json',
  'spec/skill-standard/SKILL-STANDARD.md',
  'spec/skill-standard/skill-standard.blueprint.json',
  'examples/skill-standard/clean/skills/greet/SKILL.md',
  'examples/skill-standard/drift/skills/greet/SKILL.md',
]) {
  assert(existsSync(join(installedRoot, rel)), `packed package omitted consumer asset: ${rel}`);
}

// The shipped skill-tuning skill must be executable from the advertised npm-only
// installation, not merely readable. Its seeded corpus is the substance proof:
// the same packaged blueprint must reject drift and accept the clean tree.
const skillStandardBlueprint = join(
  installedRoot,
  'spec',
  'skill-standard',
  'skill-standard.blueprint.json',
);
const skillDrift = bce(
  packedBce,
  [
    'run',
    '--blueprint', skillStandardBlueprint,
    '--ct-repo', join(installedRoot, 'examples', 'skill-standard', 'drift'),
    '--no-pin',
    '--extractor', 'ast',
    '--out', join(packedConsumer, 'skill-drift-report.json'),
  ],
  packedConsumer,
  { accept: [1] },
);
assert(skillDrift.status === 1, `packaged skill-standard drift corpus did not redden (got ${skillDrift.status})`);
const skillClean = bce(
  packedBce,
  [
    'run',
    '--blueprint', skillStandardBlueprint,
    '--ct-repo', join(installedRoot, 'examples', 'skill-standard', 'clean'),
    '--no-pin',
    '--extractor', 'ast',
    '--out', join(packedConsumer, 'skill-clean-report.json'),
  ],
  packedConsumer,
);
assert(skillClean.status === 0, `packaged skill-standard clean corpus did not pass (got ${skillClean.status})`);

// Author and onboard a repository using only the installed package binary.
const repoDir = join(packedConsumer, 'sample-repo');
mkdirSync(join(repoDir, 'src'), { recursive: true });
const sourcePath = join(repoDir, 'src', 'billing.extension.ts');
writeFileSync(
  sourcePath,
  "import axios from 'axios';\nexport function BillingExtension(pi) { pi.registerTool({ name: 'billing' }); return axios; }\n",
);
const draftPath = join(repoDir, 'bce-draft.json');
const author = bce(
  packedBce,
  [
    'author',
    '--id', 'no-direct-http-client',
    '--intent-ref', 'architecture/network-boundary',
    '--constraint', 'forbiddenDependency:axios:critical',
    '--extraction-profile', 'plugin-surface',
    '--scope-paths', documentedScopePaths,
    '--min-files', '1',
    '--repo', repoDir,
    '--out', draftPath,
  ],
  repoDir,
);
requireMarkers(author.stdout, ['schema-VALID', 'author sanity: scope matches 1 file(s)'], 'author');

const onboard = bce(
  packedBce,
  [
    'onboard',
    '--repo', repoDir,
    '--blueprint', draftPath,
    '--engine', 'bce-engine@0.1.0',
    '--harness', 'agents',
  ],
  repoDir,
);
requireMarkers(
  onboard.stdout,
  ['PROPOSED advisory adoption', 'MCP config:', 'doctor_repository, check_baseline, validate_blueprint, run_gate, assess_teeth, get_report', 'human ratification still required'],
  'onboard',
);
const blueprintPath = join(repoDir, '.blueprints', 'no-direct-http-client.blueprint.json');
for (const rel of [
  '.blueprints/no-direct-http-client.blueprint.json',
  '.bce-mode.json',
  '.bce-adoption.json',
  '.github/workflows/blueprint-conformance.yml',
  '.mcp.json',
  'AGENTS.md',
]) {
  assert(existsSync(join(repoDir, rel)), `onboard omitted ${rel}`);
}

bce(packedBce, ['validate', '--blueprint', blueprintPath], repoDir);
const redReport = join(repoDir, 'red-report.json');
const red = bce(
  packedBce,
  ['run', '--blueprint', blueprintPath, '--ct-repo', repoDir, '--no-pin', '--extractor', 'ast', '--out', redReport],
  repoDir,
  { accept: [1] },
);
assert(red.status === 1, `seeded drift did not produce RED exit 1 (got ${red.status})`);
const redDoc = JSON.parse(readFileSync(redReport, 'utf8'));
assert(redDoc.verdict === 'fail' && redDoc.violations.some((v) => v.constraintId === 'forbidden-dependency-axios'), 'RED report missed axios violation');

// Advisory gate must preserve the red grade while intentionally leaving adoption non-blocking.
const advisoryReport = join(repoDir, 'advisory-gate.json');
const advisory = bce(
  packedBce,
  ['gate', '--repo', repoDir, '--extractor', 'ast', '--all', '--report-json', advisoryReport],
  repoDir,
);
const advisoryDoc = JSON.parse(readFileSync(advisoryReport, 'utf8'));
assert(advisory.status === 0 && advisoryDoc.mode === 'advisory' && advisoryDoc.reports[0]?.verdict === 'fail', 'advisory gate did not preserve RED/non-blocking semantics');

writeFileSync(
  sourcePath,
  "export function BillingExtension(pi) { pi.registerTool({ name: 'billing' }); return pi; }\n",
);
const greenReport = join(repoDir, 'green-report.json');
const bundlePath = join(repoDir, 'bce-evidence-bundle.json');
const green = bce(
  packedBce,
  [
    'run', '--blueprint', blueprintPath, '--ct-repo', repoDir, '--no-pin', '--extractor', 'ast',
    '--out', greenReport, '--emit-bundle', bundlePath,
  ],
  repoDir,
);
requireMarkers(green.stdout, ['score 100 (pass)', 'emitted self-contained integrity bundle'], 'GREEN run');
const greenDoc = JSON.parse(readFileSync(greenReport, 'utf8'));
assert(greenDoc.verdict === 'pass' && greenDoc.violations.length === 0, 'fixed repository did not go GREEN');
const verify = bce(packedBce, ['verify-bundle', '--bundle', bundlePath], repoDir);
assert(JSON.parse(verify.stdout).valid === true, 'evidence bundle did not independently verify');

const teeth = bce(
  packedBce,
  ['teeth', '--blueprint', blueprintPath, '--ct-repo', repoDir, '--no-pin', '--extractor', 'ast'],
  repoDir,
);
requireMarkers(teeth.stdout, ['TeethReport:', '->'], 'teeth');
const doctor = bce(packedBce, ['doctor', '--repo', repoDir, '--out', join(repoDir, 'doctor.json')], repoDir, { accept: [1] });
assert(doctor.status !== 2, 'doctor refused the onboarded repository');

await proveMcp(packedMcp, repoDir, blueprintPath, greenReport);

// Simulate `npm install git+...` from the current worktree, including uncommitted candidate fixes,
// by committing an isolated snapshot and letting npm run the package's prepare/build lifecycle.
const gitSource = join(scratch, 'git-source');
const gitCommit = createGitSnapshot(gitSource);
assert(/^[0-9a-f]{40}$/.test(gitCommit), `snapshot did not produce an immutable Git commit: ${gitCommit}`);
const gitConsumer = join(scratch, 'git-consumer');
initializeConsumer(gitConsumer);
npm(['install', `git+${pathToFileURL(gitSource).href}#${gitCommit}`], gitConsumer);
const gitBce = installedBin(gitConsumer, 'bce');
const gitMcp = installedBin(gitConsumer, 'bce-mcp');
proveDemo(gitBce, gitConsumer, 'Git-install demo');
const gitResponses = await rpcRoundTrip(gitMcp, gitConsumer, [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
]);
const gitTools = gitResponses.get(2)?.result?.tools?.map((tool) => tool.name).sort();
assert(JSON.stringify(gitTools) === JSON.stringify(expectedTools), 'Git-installed MCP did not expose all six tools');

process.stdout.write(`packed artifact: ${basename(tarball)} (${packResult[0].files.length} files)\n`);
process.stdout.write('packed binaries: bce + bce-mcp PASS\n');
process.stdout.write('cold lifecycle: author -> onboard -> RED -> fix -> GREEN -> evidence PASS\n');
process.stdout.write('MCP: six tools listed and called successfully PASS\n');
process.stdout.write('Git install: prepare build + bce + bce-mcp PASS\n');
process.stdout.write('onboarding consumer proof: PASS\n');

if (process.env.BCE_KEEP_PROOF_TMP === '1') {
  process.stdout.write(`proof scratch retained at ${scratch}\n`);
} else {
  // Exact mkdtemp-owned target only; never a repository or caller-controlled path.
  rmSync(scratch, { recursive: true, force: true });
}
