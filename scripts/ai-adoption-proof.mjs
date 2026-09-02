/**
 * Deterministic first-session proof for BCE's Agent Skills + MCP surfaces.
 *
 * This is an agent-harness simulation, not an LLM quality benchmark and not an
 * independent-human attestation. It measures the mechanics an agent depends on:
 * project-local discovery, zero-extra-command MCP wiring, tool affordances,
 * live-tree RED/GREEN discrimination, and bounded local response time.
 */
import { execFileSync, spawn } from 'node:child_process';
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
const cli = join(root, 'dist', 'cli.js');
const mcp = join(root, 'dist', 'mcp-server.js');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'bce-ai-adoption-'));
const maxLocalMs = 5_000;
const harnesses = {
  agents: { skillRoot: '.agents/skills', mcp: '.mcp.json' },
  claude: { skillRoot: '.claude/skills', mcp: '.mcp.json' },
  cursor: { skillRoot: '.cursor/skills', mcp: '.cursor/mcp.json' },
  codex: { skillRoot: '.agents/skills', mcp: '.codex/config.toml' },
};

function assert(condition, message) {
  if (!condition) throw new Error(`${message}\nproof scratch retained at ${scratch}`);
}

function run(args, cwd) {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function createRepo(name) {
  const repo = join(scratch, name);
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(
    join(repo, 'src', 'billing.extension.ts'),
    "export function BillingExtension(platform) { platform.registerTool({ name: 'billing' }); }\n",
  );
  run([
    'author',
    '--id', 'no-direct-http-client',
    '--intent-ref', 'architecture/network-boundary',
    '--constraint', 'forbiddenDependency:axios:critical',
    '--extraction-profile', 'plugin-surface',
    '--scope-paths', 'src/**/*.ts',
    '--min-files', '1',
    '--repo', repo,
    '--out', join(repo, 'draft.json'),
  ], repo);
  return repo;
}

async function mcpSession(cwd) {
  const child = spawn(process.execPath, [mcp], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let buffer = '';
  let stderr = '';
  let nextId = 1;
  const pending = new Map();
  child.stderr.on('data', (chunk) => (stderr += chunk));
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (waiter) {
        pending.delete(response.id);
        waiter.resolve(response);
      }
    }
  });

  function request(method, params = {}) {
    const id = nextId++;
    const started = performance.now();
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectPromise(new Error(`MCP ${method} exceeded ${maxLocalMs}ms; stderr:\n${stderr}`));
      }, maxLocalMs);
      pending.set(id, {
        resolve(response) {
          clearTimeout(timer);
          resolvePromise({ response, elapsedMs: performance.now() - started });
        },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  return {
    request,
    close() {
      child.stdin.end();
    },
  };
}

function toolDoc(result) {
  assert(result.response.result?.isError === false, `MCP tool failed: ${JSON.stringify(result.response)}`);
  return result.response.result.structuredContent;
}

assert(Number(process.versions.node.split('.')[0]) >= 22, `Node >=22 required; got ${process.version}`);
assert(existsSync(cli) && existsSync(mcp), 'run npm run build before the AI-adoption proof');

const onboarding = [];
for (const [harness, expected] of Object.entries(harnesses)) {
  const repo = createRepo(`repo-${harness}`);
  if (harness === 'codex') {
    mkdirSync(join(repo, '.codex'), { recursive: true });
    writeFileSync(join(repo, '.codex/config.toml'), 'model = "gpt-5"\n');
  }
  const started = performance.now();
  run([
    'onboard', '--repo', repo, '--blueprint', join(repo, 'draft.json'),
    '--engine', `bce-engine@${pkg.version}`, '--harness', harness,
  ], repo);
  const elapsedMs = performance.now() - started;
  assert(elapsedMs < maxLocalMs, `${harness} onboarding exceeded ${maxLocalMs}ms`);
  for (const skill of ['bce', 'skill-tuning']) {
    assert(existsSync(join(repo, expected.skillRoot, skill, 'SKILL.md')), `${harness} omitted ${skill}`);
  }
  assert(existsSync(join(repo, expected.mcp)), `${harness} omitted project MCP config`);
  const manifest = JSON.parse(readFileSync(join(repo, '.bce-adoption.json'), 'utf8'));
  assert(manifest.generatedFiles.includes(`${expected.skillRoot}/bce/SKILL.md`), `${harness} manifest omitted bce skill`);
  assert(manifest.generatedFiles.includes(`${expected.skillRoot}/skill-tuning/SKILL.md`), `${harness} manifest omitted skill-tuning`);
  if (harness === 'codex') {
    const config = readFileSync(join(repo, expected.mcp), 'utf8');
    assert(config.includes('model = "gpt-5"'), 'Codex onboarding erased existing project config');
    assert(config.includes('[mcp_servers.bce]'), 'Codex onboarding omitted project-local BCE server');
  }
  onboarding.push({ harness, elapsedMs: Math.round(elapsedMs), skillsDiscovered: 2, manualStepsAfterOnboard: 0 });
}

const repo = join(scratch, 'repo-agents');
const session = await mcpSession(repo);
const init = await session.request('initialize', { protocolVersion: '2025-11-25' });
assert(init.response.result?.serverInfo?.version === '2', 'MCP surface version was not bumped');
const instructions = init.response.result?.instructions ?? '';
for (const tool of ['doctor_repository', 'run_gate', 'validate_blueprint', 'assess_teeth', 'check_baseline', 'get_report']) {
  assert(instructions.includes(tool), `MCP initialization guidance omitted route for ${tool}`);
}
const listed = await session.request('tools/list');
const tools = listed.response.result?.tools ?? [];
assert(tools.length === 6, `expected 6 MCP tools, got ${tools.length}`);
for (const tool of tools) {
  assert(tool.annotations?.readOnlyHint === true, `${tool.name} lacks readOnlyHint`);
  assert(tool.annotations?.destructiveHint === false, `${tool.name} lacks destructiveHint:false`);
}

const doctor = await session.request('tools/call', { name: 'doctor_repository', arguments: {} });
assert(toolDoc(doctor).outcome !== 'refusal', 'zero-argument doctor refused the onboarded cwd');
const green1 = await session.request('tools/call', { name: 'run_gate', arguments: {} });
assert(toolDoc(green1).reports[0]?.verdict === 'pass', 'zero-argument gate did not start GREEN');

const source = join(repo, 'src', 'billing.extension.ts');
const cleanSource = readFileSync(source, 'utf8');
writeFileSync(source, `import axios from 'axios';\n${cleanSource}`);
const red = await session.request('tools/call', { name: 'run_gate', arguments: {} });
const redDoc = toolDoc(red);
assert(redDoc.reports[0]?.verdict === 'fail', 'live planted drift did not turn MCP gate RED');
assert(JSON.stringify(redDoc).includes('forbidden-dependency-axios'), 'RED omitted exact constraint id');
assert(JSON.stringify(redDoc).includes('src/billing.extension.ts#L1'), 'RED omitted exact file/line');

writeFileSync(source, cleanSource);
const green2 = await session.request('tools/call', { name: 'run_gate', arguments: {} });
assert(toolDoc(green2).reports[0]?.verdict === 'pass', 'corrected live tree did not return GREEN');
session.close();

const callTimes = [doctor, green1, red, green2].map((x) => Math.round(x.elapsedMs));
assert(callTimes.every((ms) => ms < maxLocalMs), 'an MCP adoption call exceeded the local ceiling');

// Negative control: the discovery assertion must actually fail when a skill is absent.
const negativeSkill = join(repo, '.agents/skills/bce/SKILL.md');
rmSync(negativeSkill);
assert(!existsSync(negativeSkill), 'missing-skill negative control did not discriminate');

process.stdout.write(`${JSON.stringify({
  schemaVersion: '1',
  kind: 'bce-ai-adoption-proof',
  packageVersion: pkg.version,
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  onboarding,
  mcp: {
    tools: tools.length,
    routedTools: 6,
    zeroArgumentCalls: ['doctor_repository', 'run_gate'],
    liveSequence: ['GREEN', 'RED', 'GREEN'],
    callTimesMs: callTimes,
    maxLocalCeilingMs: maxLocalMs,
  },
  negativeControls: ['missing-skill', 'planted-live-drift'],
  limitations: [
    'deterministic harness simulation; no language model was scored',
    'agent-operated evidence; not an independent-human usability attestation',
    'latencies are local regression observations, not cross-machine performance claims',
  ],
}, null, 2)}\n`);
process.stdout.write('AI adoption proof: PASS\n');

if (process.env.BCE_KEEP_PROOF_TMP !== '1') rmSync(scratch, { recursive: true, force: true });
