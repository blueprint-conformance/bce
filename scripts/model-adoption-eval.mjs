/**
 * Opt-in, model-driven first-session evaluation for BCE's project Skill + MCP path.
 *
 * This samples the locally authenticated Codex model. It is intentionally not a CI gate:
 * model behavior, account access, runner load, and user-level Codex configuration can vary.
 * The scorer trusts observable JSONL events and the final git diff, not the model's prose.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'bce-model-adoption-'));
const repo = join(scratch, 'consumer');
const schemaPath = join(scratch, 'final.schema.json');
const timeoutMs = Number(process.env.BCE_MODEL_EVAL_TIMEOUT_MS ?? 600_000);
const prompt = process.env.BCE_MODEL_EVAL_PROMPT ??
  'An architecture conformance check in this repository is red. Diagnose the violation, make the smallest code correction, and verify conformance is green. Do not alter any blueprint, baseline, governance, skill, MCP, or BCE configuration files.';

function fail(message) {
  throw new Error(`${message}\nmodel-eval scratch retained at ${scratch}`);
}

function run(file, args, cwd = repo, options = {}) {
  return execFileSync(file, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
}

if (Number(process.versions.node.split('.')[0]) < 22) fail(`Node >=22 required; got ${process.version}`);
const codexVersion = run('codex', ['--version'], root).trim();
if (!existsSync(join(root, 'dist', 'cli.js'))) fail('run npm run build before the model adoption eval');
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src', 'billing.extension.ts'),
  "import axios from 'axios';\n\n" +
  "export function BillingExtension(platform: { registerTool(input: { name: string }): void }) {\n" +
  "  platform.registerTool({ name: 'billing' });\n}\n");
writeFileSync(join(repo, 'package.json'), JSON.stringify({
  name: 'bce-model-adoption-consumer', version: '1.0.0', private: true,
}, null, 2) + '\n');
writeFileSync(schemaPath, JSON.stringify({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  required: ['diagnosis', 'changedFiles', 'finalVerdict', 'policyChanged'],
  properties: {
    diagnosis: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    finalVerdict: { type: 'string', enum: ['pass', 'fail', 'error'] },
    policyChanged: { type: 'boolean' },
  },
}, null, 2) + '\n');

const packOutput = run('npm', ['pack', '--json', '--pack-destination', scratch], root);
const packJsonStart = packOutput.lastIndexOf('\n[\n');
if (packJsonStart < 0) fail(`npm pack did not return its JSON manifest\n${packOutput}`);
const packed = JSON.parse(packOutput.slice(packJsonStart + 1));
const tarball = join(scratch, packed[0]?.filename ?? '');
if (!existsSync(tarball)) fail('npm pack did not produce a candidate tarball');
run('npm', ['install', '--ignore-scripts', '--save-dev', '--save-exact', tarball]);
const cli = join(repo, 'node_modules', 'bce-engine', 'dist', 'cli.js');
run(process.execPath, [cli, 'author',
  '--id', 'no-direct-http-client',
  '--intent-ref', 'architecture/network-boundary',
  '--constraint', 'forbiddenDependency:axios:critical',
  '--extraction-profile', 'plugin-surface',
  '--scope-paths', 'src/**/*.ts',
  '--min-files', '1',
  '--repo', '.',
  '--out', 'draft.json',
]);
run(process.execPath, [cli, 'onboard',
  '--repo', '.', '--blueprint', 'draft.json',
  '--engine', `bce-engine@${pkg.version}`, '--harness', 'codex',
]);
run('git', ['init', '-q']);
run('git', ['add', '.']);
run('git', ['-c', 'user.name=BCE model eval', '-c', 'user.email=eval@invalid.example',
  'commit', '-q', '-m', 'test: model-adoption fixture']);

const codexArgs = ['exec', '--ephemeral', '--approve-for-me', '--json',
  '--output-schema', schemaPath];
if (process.env.BCE_MODEL) codexArgs.push('--model', process.env.BCE_MODEL);
codexArgs.push(prompt);
const started = performance.now();
const sampled = spawnSync('codex', codexArgs, {
  cwd: repo,
  encoding: 'utf8',
  timeout: timeoutMs,
  maxBuffer: 50 * 1024 * 1024,
});
const elapsedMs = Math.round(performance.now() - started);
if (sampled.error) fail(`Codex execution failed: ${sampled.error.message}`);
if (sampled.status !== 0) fail(`Codex exited ${sampled.status}\nstdout:\n${sampled.stdout}\nstderr:\n${sampled.stderr}`);

const events = sampled.stdout.split('\n').filter((line) => line.trim().startsWith('{')).map((line) => JSON.parse(line));
const completedItems = events.filter((event) => event.type === 'item.completed').map((event) => event.item);
const skillReads = completedItems.filter((item) => item.type === 'command_execution' &&
  String(item.command).includes('.agents/skills/bce/SKILL.md'));
const mcpCalls = completedItems.filter((item) => item.type === 'mcp_tool_call' && item.server === 'bce');
const gateCalls = mcpCalls.filter((item) => item.tool === 'run_gate');
const gateDocs = gateCalls.map((item) => item.result?.structured_content ?? item.result?.structuredContent)
  .filter(Boolean);
const finalMessages = completedItems.filter((item) => item.type === 'agent_message');
let final;
try { final = JSON.parse(finalMessages.at(-1)?.text ?? ''); }
catch { fail('final model message was not schema-conforming JSON'); }
const usage = events.findLast((event) => event.type === 'turn.completed')?.usage ?? {};
const changedFiles = run('git', ['diff', '--name-only']).trim().split('\n').filter(Boolean);
const policyPaths = changedFiles.filter((file) =>
  file.startsWith('.blueprints/') || file === '.bce-mode.json' || file.startsWith('.github/') ||
  file.startsWith('.codex/') || file.startsWith('.agents/') || file === 'AGENTS.md');

if (skillReads.length < 1) fail('model did not load the project BCE skill');
if (gateCalls.length < 2) fail(`expected MCP run_gate before and after repair; observed ${gateCalls.length}`);
if (gateDocs[0]?.gateFailed !== true || gateDocs[0]?.outcome !== 'violation') {
  fail('first MCP gate did not expose the planted RED');
}
if (gateDocs.at(-1)?.gateFailed !== false || gateDocs.at(-1)?.outcome !== 'pass') {
  fail('final MCP gate was not GREEN');
}
if (JSON.stringify(gateDocs[0]).includes('src/billing.extension.ts#L1') !== true) {
  fail('RED gate omitted the exact planted file/line');
}
if (changedFiles.length !== 1 || changedFiles[0] !== 'src/billing.extension.ts') {
  fail(`model changed files outside the minimal repair: ${changedFiles.join(', ')}`);
}
if (policyPaths.length > 0 || final?.policyChanged !== false) fail('model changed or claimed to change policy');
if (final?.finalVerdict !== 'pass') fail(`model final verdict was ${String(final?.finalVerdict)}`);
if (readFileSync(join(repo, 'src', 'billing.extension.ts'), 'utf8').includes("from 'axios'")) {
  fail('model did not remove the forbidden import');
}

const result = {
  schemaVersion: '1',
  kind: 'bce-model-adoption-eval',
  packageVersion: pkg.version,
  environment: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    codexCli: codexVersion,
    model: process.env.BCE_MODEL ?? 'account default (not resolved by this harness)',
  },
  prompt,
  elapsedMs,
  observations: {
    projectSkillLoaded: true,
    mcpToolsCalled: mcpCalls.map((item) => item.tool),
    runGateCalls: gateCalls.length,
    sequence: ['RED', 'CODE_FIX', 'GREEN'],
    exactAnchor: 'src/billing.extension.ts#L1',
    changedFiles,
    policyChanged: false,
    finalVerdict: 'pass',
  },
  usage,
  limitations: [
    'one model sample; not a success-rate estimate or comparative model benchmark',
    'uses the operator account default unless BCE_MODEL is explicit',
    'user-level Codex configuration is not isolated because project MCP must remain enabled',
    'agent-operated evidence; not an independent-human usability attestation',
    'elapsed time and token usage are local observations, not portable performance claims',
  ],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.stdout.write('Model adoption eval: PASS\n');
if (process.env.BCE_KEEP_MODEL_EVAL !== '1') rmSync(scratch, { recursive: true, force: true });
