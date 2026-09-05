#!/usr/bin/env node
/** Ordered, fail-closed controller for a sealed BCE product-efficacy study. */
import { spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync, chmodSync, closeSync, copyFileSync, cpSync, existsSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync,
  rmSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, platform, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson, hashTree, resolveInside, sha256Bytes, sha256Json, verifyBundle,
  verifyTerminalRecord,
} from './lib/model-evaluation.mjs';
import {
  localProviderIdentityStable,
  localProviderProofMatches,
  OLLAMA_IDENTITY_SEMANTICS_V2,
} from './lib/model-evaluation-provider.mjs';
import {
  makeStudyHaltV2,
  stoppingHaltTrigger,
  verifyStudyHaltV2,
} from './lib/model-evaluation-halt.mjs';
import { verifyOllamaClientEvents } from './lib/model-evaluation-client-events.mjs';

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const preflightOnly = process.argv.includes('--preflight-only');
if (!process.argv.includes('--execute-sealed-study') && !preflightOnly) {
  process.stderr.write('execution refused: pass --execute-sealed-study to invoke external model clients, or --preflight-only for zero-model capability probes\n');
  process.exit(2);
}
if (process.argv.includes('--cell') || process.argv.includes('--trial')) {
  process.stderr.write('execution refused: selective --cell/--trial execution is incompatible with the frozen global order\n');
  process.exit(2);
}

const bundleDir = resolve(valueAfter('--bundle') ?? 'research/model-evaluation');
const verified = verifyBundle(bundleDir, { requireSealed: !preflightOnly });
if (!verified.ok) {
  process.stderr.write(`execution refused by bundle verifier:\n${verified.refusals.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(2);
}
const { protocol, manifest, seal } = verified;
const terminalRecordSchemaVersion = String(JSON.parse(readFileSync(join(bundleDir, 'schemas', 'terminal-record.schema.json'), 'utf8')).properties?.schemaVersion?.const ?? '2');
const triStatePolicyOutcomes = terminalRecordSchemaVersion === '3';
const limit = Number(valueAfter('--limit') ?? Number.POSITIVE_INFINITY);
if ((!Number.isInteger(limit) && limit !== Number.POSITIVE_INFINITY) || limit < 1) {
  process.stderr.write('execution refused: --limit must be a positive integer\n');
  process.exit(2);
}
const runsRoot = resolve(valueAfter('--runs') ?? join(homedir(), '.local', 'share', 'bce-model-evaluation', protocol.studyId));
mkdirSync(runsRoot, { recursive: true, mode: 0o700 });
chmodSync(runsRoot, 0o700);
const runnerPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(runnerPath), '..');
const runnerSha256 = sha256Bytes(readFileSync(runnerPath));
if (runnerSha256 !== protocol.implementation.runnerSha256) {
  process.stderr.write('execution refused: running controller digest differs from the sealed protocol\n');
  process.exit(2);
}

const lockPath = join(runsRoot, '.controller.lock');
function acquireControllerLock() {
  const create = () => {
    const descriptor = openSync(lockPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: '1', pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    return descriptor;
  };
  try { return create(); }
  catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  let owner;
  try { owner = JSON.parse(readFileSync(lockPath, 'utf8')); }
  catch { throw new Error(`execution refused: unreadable controller lock at ${lockPath}`); }
  if (!Number.isInteger(owner.pid) || owner.pid < 1) throw new Error(`execution refused: invalid controller lock at ${lockPath}`);
  try {
    process.kill(owner.pid, 0);
    throw new Error(`execution refused: controller pid ${owner.pid} holds ${lockPath}`);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const stalePath = `${lockPath}.stale-${owner.pid}-${Date.now()}`;
  try { renameSync(lockPath, stalePath); }
  catch { throw new Error(`execution refused: controller lock changed while recovering stale owner ${owner.pid}`); }
  return create();
}
let lockFd;
try { lockFd = acquireControllerLock(); }
catch (error) {
  process.stderr.write(`execution refused: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
let controllerAttemptedExposure = false;

function run(file, args, cwd, options = {}) {
  return spawnSync(file, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

function redact(text) {
  return String(text ?? '')
    .replace(/\b(?:sk|fk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{12,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/("(?:accessToken|refreshToken|apiKey|token|cookie)"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]');
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function storeArtifact(trialDir, filename, content, mediaType, redaction = 'none', sensitivity = 'public') {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const namedPath = join(trialDir, filename);
  writeAtomic(namedPath, bytes);
  const digest = sha256Bytes(bytes);
  const casPath = join(runsRoot, 'cas', 'sha256', digest);
  mkdirSync(dirname(casPath), { recursive: true, mode: 0o700 });
  if (!existsSync(casPath)) copyFileSync(namedPath, casPath);
  else if (sha256Bytes(readFileSync(casPath)) !== digest) throw new Error(`CAS collision at ${digest}`);
  return { path: ['cas', 'sha256', digest].join('/'), sha256: digest, bytes: bytes.byteLength, mediaType, redaction, sensitivity };
}

function appendEvent(state, source, type, payload) {
  const event = {
    schemaVersion: '1', sequence: state.events.length, source, type,
    timestamp: new Date().toISOString(), monotonicMs: Math.round(performance.now() - state.monotonicStart),
    previousEventSha256: state.events.at(-1)?.eventSha256 ?? null, payload, eventSha256: null,
  };
  event.eventSha256 = sha256Json(event);
  state.events.push(event);
  writeFileSync(state.eventsPath, `${JSON.stringify(event)}\n`, { flag: 'a' });
}

function executableDigest(path) {
  if (!isAbsolute(path) || !statSync(path).isFile()) throw new Error(`client executable is not an absolute regular file: ${path}`);
  return sha256Bytes(readFileSync(path));
}

function verifyClientIdentity(cell) {
  if (executableDigest(cell.executable) !== cell.clientArtifactSha256) throw new Error(`${cell.id}: client executable digest differs from protocol`);
  const version = cell.client === 'bce-ollama-tool-client'
    ? run(protocol.isolation.runtimeExecutable, [cell.executable, '--version'], bundleDir)
    : run(cell.executable, ['--version'], bundleDir);
  const text = `${version.stdout ?? ''}${version.stderr ?? ''}`.trim().split('\n')[0];
  if (version.status !== 0 || text !== cell.clientVersion) throw new Error(`${cell.id}: client version probe '${text}' differs from '${cell.clientVersion}'`);
  if (cell.adapterSha256 !== runnerSha256) throw new Error(`${cell.id}: built-in adapter digest differs from controller`);
  const allowed = ['codex', 'claude-code', 'droid', 'named-reference-agent', 'bce-ollama-tool-client'];
  if (seal.attestation?.kind === 'synthetic-self-test') allowed.push('fixture-agent');
  if (!allowed.includes(cell.client)) throw new Error(`${cell.id}: no sealed adapter for client '${cell.client}'`);
}

function verifyRuntimeIdentity() {
  const isolation = protocol.isolation;
  if (executableDigest(isolation.runtimeExecutable) !== isolation.runtimeArtifactSha256) throw new Error('runtime executable digest differs from protocol');
  const version = run(isolation.runtimeExecutable, ['--version'], bundleDir);
  const text = `${version.stdout ?? ''}${version.stderr ?? ''}`.trim().split('\n')[0];
  if (version.status !== 0 || text !== isolation.runtimeVersion) throw new Error(`runtime version probe '${text}' differs from '${isolation.runtimeVersion}'`);
}

function stageToolchain(cell, stateRoot) {
  const executableRoot = join(stateRoot, 'executable');
  mkdirSync(executableRoot, { recursive: true, mode: 0o700 });
  const clientExecutable = join(executableRoot, cell.client === 'codex' ? 'codex' : cell.client === 'fixture-agent' ? 'fixture-agent' : cell.client === 'bce-ollama-tool-client' ? 'ollama-tool-client.mjs' : 'client');
  copyFileSync(cell.executable, clientExecutable);
  chmodSync(clientExecutable, 0o700);
  if (sha256Bytes(readFileSync(clientExecutable)) !== cell.clientArtifactSha256) throw new Error(`${cell.id}: staged client digest differs from protocol`);
  const runtimeExecutable = join(executableRoot, 'node');
  copyFileSync(protocol.isolation.runtimeExecutable, runtimeExecutable);
  chmodSync(runtimeExecutable, 0o700);
  if (sha256Bytes(readFileSync(runtimeExecutable)) !== protocol.isolation.runtimeArtifactSha256) throw new Error('staged runtime digest differs from protocol');
  let systemPrompt = null;
  let commonTools = null;
  if (cell.client === 'bce-ollama-tool-client') {
    const stageArtifact = (artifact, filename, label) => {
      const source = resolveInside(bundleDir, artifact.path, label);
      const target = join(executableRoot, filename);
      copyFileSync(source, target);
      if (sha256Bytes(readFileSync(target)) !== artifact.sha256) throw new Error(`${cell.id}: staged ${label} digest differs from protocol`);
      return target;
    };
    systemPrompt = stageArtifact(cell.toolLoop.systemPrompt, 'ollama-system-prompt.v1.txt', 'Ollama system prompt');
    commonTools = stageArtifact(cell.toolLoop.commonToolContract, 'ollama-common-tools.v1.json', 'Ollama common tool contract');
  }
  return { clientExecutable, runtimeExecutable, systemPrompt, commonTools };
}

function attestStagedToolchainAfterExecution(cell, toolchain) {
  const clientArtifactSha256 = sha256Bytes(readFileSync(toolchain.clientExecutable));
  const runtimeArtifactSha256 = sha256Bytes(readFileSync(toolchain.runtimeExecutable));
  const systemPromptSha256 = toolchain.systemPrompt ? sha256Bytes(readFileSync(toolchain.systemPrompt)) : null;
  const commonToolContractSha256 = toolchain.commonTools ? sha256Bytes(readFileSync(toolchain.commonTools)) : null;
  const matched = clientArtifactSha256 === cell.clientArtifactSha256 && runtimeArtifactSha256 === protocol.isolation.runtimeArtifactSha256 &&
    (cell.client !== 'bce-ollama-tool-client' || (systemPromptSha256 === cell.toolLoop.systemPrompt.sha256 && commonToolContractSha256 === cell.toolLoop.commonToolContract.sha256));
  return { matched, clientArtifactSha256, runtimeArtifactSha256, systemPromptSha256, commonToolContractSha256 };
}

function copyTree(source, target, { includeNodeModules = false } = {}) {
  cpSync(source, target, {
    recursive: true, errorOnExist: false,
    filter: (entry) => !entry.split(sep).some((part) => ['.git', 'coverage'].includes(part) || (!includeNodeModules && part === 'node_modules')),
  });
}

function treeInventory(root) {
  const base = resolve(root);
  const entries = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      if (['.git', 'node_modules', 'coverage'].includes(name)) continue;
      const absolute = join(dir, name);
      const entryPath = relative(base, absolute).split(sep).join('/');
      const stat = lstatSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isSymbolicLink()) entries.push({ path: entryPath, type: 'symlink', mode: stat.mode & 0o777, target: readlinkSync(absolute) });
      else if (stat.isFile()) {
        const bytes = readFileSync(absolute);
        entries.push({ path: entryPath, type: 'file', mode: stat.mode & 0o777, bytes: bytes.byteLength, sha256: sha256Bytes(bytes) });
      }
    }
  };
  walk(base);
  return entries;
}

function inventoryChanges(before, after) {
  const left = new Map(before.map((entry) => [entry.path, entry]));
  const right = new Map(after.map((entry) => [entry.path, entry]));
  return [...new Set([...left.keys(), ...right.keys()])].sort()
    .filter((entryPath) => canonicalJson(left.get(entryPath) ?? null) !== canonicalJson(right.get(entryPath) ?? null))
    .map((entryPath) => ({ path: entryPath, before: left.get(entryPath) ?? null, after: right.get(entryPath) ?? null }));
}

function globToRegExp(glob) {
  const marker = '__DOUBLE_STAR__';
  const escaped = glob.replace(/\*\*/g, marker).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replaceAll(marker, '.*');
  return new RegExp(`^${escaped}$`);
}
const matchesAny = (entryPath, patterns) => patterns.some((pattern) => globToRegExp(pattern).test(entryPath));

function initializeWorkspace(workspace) {
  for (const args of [
    ['init', '-q'],
    // Hosted runners may enable background fsmonitor/maintenance globally. A trial
    // repository must not inherit daemons that can mutate .git after the client exits.
    ['config', 'core.fsmonitor', 'false'],
    ['config', 'maintenance.auto', 'false'],
    ['config', 'gc.auto', '0'],
    ['add', '-A'],
    ['-c', 'user.name=BCE evaluation controller', '-c', 'user.email=evaluation@invalid.example', 'commit', '-q', '-m', 'frozen trial start'],
  ]) {
    const result = run('git', args, workspace);
    if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
}

function appendContext(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const prefix = existsSync(path) ? `${readFileSync(path, 'utf8').trimEnd()}\n\n` : '';
  writeFileSync(path, `${prefix}${content}\n`);
}

function materializeTreatment(workspace, task, cell, preparedInventory, runtimeExecutable) {
  const runtime = join(workspace, '.bce-runtime');
  mkdirSync(runtime, { recursive: true });
  const engineArtifact = resolveInside(bundleDir, protocol.treatment.engineArtifact, 'engine artifact');
  const installed = run('/usr/bin/tar', ['-xzf', engineArtifact, '-C', runtime], workspace, { env: minimalControllerEnv({ COPYFILE_DISABLE: '1' }) });
  if (installed.status !== 0) throw new Error(`BCE offline treatment extraction failed: ${installed.stderr}`);
  if (hashTree(runtime, { includeNodeModules: true }) !== protocol.treatment.installedTreeSha256) throw new Error('BCE offline treatment installed-tree digest mismatch');
  const engineRoot = join(runtime, 'node_modules', 'bce-engine');
  const cli = join(engineRoot, 'dist', 'cli.js');
  const mcp = join(engineRoot, 'dist', 'mcp-server.js');
  if (!existsSync(cli) || !existsSync(mcp)) throw new Error('BCE treatment artifact omitted built CLI or MCP server');
  const blueprintTarget = join(workspace, '.blueprints', `${task.id}.blueprint.json`);
  mkdirSync(dirname(blueprintTarget), { recursive: true });
  copyFileSync(resolveInside(bundleDir, task.blueprint.path, `${task.id} blueprint`), blueprintTarget);
  writeFileSync(join(workspace, '.bce-mode.json'), '{\n  "mode": "enforced"\n}\n');
  const skillRoot = cell.client === 'claude-code' ? join(workspace, '.claude', 'skills') : join(workspace, '.agents', 'skills');
  for (const skill of ['bce', 'skill-tuning']) copyTree(join(engineRoot, 'skills', skill), join(skillRoot, skill));
  const codexTool = cell.client === 'codex' ? ' (`mcp__bce__run_gate` in Codex)' : '';
  const context = `# BCE done-check\n\nBCE is the required done-check. Before finishing, use the project BCE skill and call the \`run_gate\` tool exposed by the \`bce\` MCP server${codexTool} with \`{}\`. Use the MCP tool directly, not a guessed shell command or a resource-listing tool. If the gate is red, fix code only—never policy, blueprint, BCE configuration, tests, CI, dependencies, or evaluation files—and rerun until \`gateFailed\` is false. A green functional test alone is not done.`;
  if (cell.client === 'claude-code') {
    appendContext(join(workspace, 'CLAUDE.md'), context);
    writeFileSync(join(workspace, '.mcp.json'), `${JSON.stringify({ mcpServers: { bce: { command: runtimeExecutable, args: [mcp] } } }, null, 2)}\n`);
  } else {
    appendContext(join(workspace, 'AGENTS.md'), context);
    mkdirSync(join(workspace, '.codex'), { recursive: true });
    if (cell.client === 'codex') writeFileSync(join(workspace, '.codex', 'config.toml'), `[mcp_servers.bce]\ncommand = ${JSON.stringify(runtimeExecutable)}\nargs = [${JSON.stringify(mcp)}]\nrequired = true\n`);
    else writeFileSync(join(workspace, '.mcp.json'), `${JSON.stringify({ mcpServers: { bce: { command: runtimeExecutable, args: [mcp] } } }, null, 2)}\n`);
  }
  const changes = inventoryChanges(preparedInventory, treeInventory(workspace));
  const delta = JSON.parse(readFileSync(resolve(bundleDir, protocol.treatment.allowedDeltaManifest), 'utf8'));
  const undeclared = changes.filter((entry) => !matchesAny(entry.path, delta.allowedPathPatterns ?? []));
  if (undeclared.length) throw new Error(`treatment materialization changed undeclared paths: ${undeclared.map((entry) => entry.path).join(', ')}`);
  return { cli, mcp, treatmentDelta: { arm: 'bce-enabled', changes }, treatmentConfigSha256: sha256Json({ arm: 'bce-enabled', changes }) };
}

function detectBceContamination(workspace) {
  const findings = treeInventory(workspace).filter((entry) => /(^|\/)(?:\.blueprints|\.bce-|bce)(?:\/|\.|-|$)/i.test(entry.path));
  const packagePath = join(workspace, 'package.json');
  if (existsSync(packagePath) && /["']bce-engine["']|@[^"']*\/bce/i.test(readFileSync(packagePath, 'utf8'))) findings.push({ path: 'package.json#bce-dependency' });
  if (findings.length) throw new Error(`base-tree BCE contamination: ${findings.map((entry) => entry.path).join(', ')}`);
}

function freshClientEnvironment(stateRoot, cell, runtimeExecutable) {
  const env = {};
  for (const key of ['LANG', 'LC_ALL', 'TERM', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[key]) env[key] = process.env[key];
  const developerBin = '/Applications/Xcode.app/Contents/Developer/usr/bin';
  env.PATH = [dirname(runtimeExecutable), existsSync(developerBin) ? developerBin : null, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].filter(Boolean).join(':');
  const clientHome = join(stateRoot, 'home');
  mkdirSync(clientHome, { recursive: true, mode: 0o700 });
  env.HOME = clientHome;
  const clientTmp = join(stateRoot, 'tmp');
  mkdirSync(clientTmp, { recursive: true, mode: 0o700 });
  env.TMPDIR = clientTmp;
  env.TMP = clientTmp;
  env.TEMP = clientTmp;
  let authPath = null;
  if (cell.client === 'codex') {
    const codexHome = join(stateRoot, 'codex');
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    env.CODEX_HOME = codexHome;
    if (cell.localProvider?.authentication === 'none') {
      env.OLLAMA_HOST = cell.localProvider.endpoint;
      if (existsSync(join(codexHome, 'auth.json'))) throw new Error('local-provider Codex state unexpectedly contains authentication');
    } else {
      const sourceAuth = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
      if (!existsSync(sourceAuth)) throw new Error('Codex auth-only mount unavailable');
      authPath = join(codexHome, 'auth.json');
      copyFileSync(sourceAuth, authPath);
      chmodSync(authPath, 0o600);
    }
  }
  if (cell.client === 'claude-code') env.CLAUDE_CONFIG_DIR = join(stateRoot, 'claude');
  return { env, authPath };
}

function adapterCommand(cell, workspace, prompt, clientEnv, task, treatment) {
  if (cell.client === 'fixture-agent' && seal.attestation?.kind === 'synthetic-self-test') {
    return { file: cell.executable, args: ['--model', cell.requestedModel, prompt], env: clientEnv };
  }
  if (cell.client === 'codex') {
    const providerArgs = cell.localProvider ? ['--oss', '--local-provider', cell.localProvider.kind] : [];
    const mcpArgs = treatment.mcp ? [
      '-c', `mcp_servers.bce.command=${JSON.stringify(treatment.runtimeExecutable)}`,
      '-c', `mcp_servers.bce.args=[${JSON.stringify(treatment.mcp)}]`,
      '-c', 'mcp_servers.bce.required=true',
    ] : [];
    return {
    file: cell.executable,
    args: ['-a', 'never', 'exec', ...providerArgs, '--ephemeral', '--ignore-user-config', '--json', '--sandbox',
      protocol.isolation.clientSandboxMode === 'outer-controller-profile-only' ? 'danger-full-access' : 'workspace-write',
      '--model', cell.requestedModel, '-c', `model_reasoning_effort=${JSON.stringify(cell.reasoningEffort)}`, '-c', 'shell_environment_policy.inherit="none"', ...mcpArgs, '-C', workspace, prompt],
    env: clientEnv,
    };
  }
  if (cell.client === 'bce-ollama-tool-client') {
    const configuration = cell.toolLoop;
    const mcpArgs = treatment.mcp ? [
      '--mcp-runtime', treatment.runtimeExecutable,
      '--mcp-server', treatment.mcp,
      '--mcp-tool-sha256', configuration.mcpRunGateToolSha256,
    ] : [];
    return {
      file: treatment.runtimeExecutable,
      args: [cell.executable,
        '--endpoint', cell.localProvider.endpoint,
        '--model', cell.requestedModel,
        '--prompt', prompt,
        '--system-prompt', cell.systemPrompt,
        '--common-tools', cell.commonTools,
        '--exec-broker-config', JSON.stringify(configuration.execSandbox),
        '--reasoning-effort', cell.reasoningEffort,
        '--max-turns', String(task.budget.maxTurns),
        '--temperature', String(configuration.modelOptions.temperature),
        '--seed', String(configuration.modelOptions.seed),
        '--num-ctx', String(configuration.modelOptions.numCtx),
        '--keep-alive', configuration.modelOptions.keepAlive,
        ...mcpArgs],
      env: clientEnv,
    };
  }
  if (cell.client === 'claude-code') {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence', '--permission-mode', 'acceptEdits', '--setting-sources', 'project', '--model', cell.requestedModel, '--effort', cell.reasoningEffort];
    if (task.budget.maxCostUsd !== null) args.push('--max-budget-usd', String(task.budget.maxCostUsd));
    if (existsSync(join(workspace, '.mcp.json'))) args.push('--strict-mcp-config', '--mcp-config', '.mcp.json');
    args.push(prompt);
    return { file: cell.executable, args, env: clientEnv };
  }
  if (cell.client === 'droid' || cell.client === 'named-reference-agent') {
    const settings = join(dirname(clientEnv.HOME), 'droid-settings.json');
    writeFileSync(settings, '{}\n');
    return { file: cell.executable, args: ['exec', '--output-format', 'json', '--auto', 'medium', '--settings', settings, '--cwd', workspace, '--model', cell.requestedModel, '--reasoning-effort', cell.reasoningEffort, prompt], env: clientEnv };
  }
  throw new Error(`${cell.id}: unsupported client '${cell.client}'`);
}

function sandboxLiteral(value) {
  const target = resolve(value);
  let existing = target;
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const canonicalBase = realpathSync(existing);
  return JSON.stringify(resolve(canonicalBase, relative(existing, target)));
}

function sandboxProfile(workspace, clientState, controllerRoot, protectedPatterns, cell) {
  if (platform() !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) throw new Error('outer client isolation unavailable: this runner currently requires macOS sandbox-exec');
  const systemReadRoots = ['/System', '/usr', '/bin', '/sbin', '/Library', '/private/etc', '/private/var/db', '/private/var/run', '/dev']
    .filter((value) => existsSync(value));
  const protectedRoots = new Set([join(workspace, '.git'), join(clientState, 'executable')]);
  for (const pattern of protectedPatterns) {
    const prefix = pattern.split('*')[0].replace(/\/$/, '');
    if (prefix) protectedRoots.add(join(workspace, prefix));
  }
  const denyWrites = [...protectedRoots].map((value) => `(deny file-write* (subpath ${sandboxLiteral(value)}))`);
  const allowedRoots = [workspace, clientState];
  const allowReads = [...systemReadRoots, ...allowedRoots].map((value) => `(allow file-read* (subpath ${sandboxLiteral(value)}))`);
  const allowWrites = allowedRoots.map((value) => `(allow file-write* (subpath ${sandboxLiteral(value)}))`);
  const allowExec = ['/usr', '/bin', '/sbin', ...allowedRoots]
    .filter((value) => existsSync(value))
    .map((value) => `(allow process-exec (subpath ${sandboxLiteral(value)}))`);
  const ancestorReads = new Set(['/']);
  for (const value of [...systemReadRoots, ...allowedRoots]) {
    let cursor = realpathSync(value);
    while (cursor !== '/') {
      cursor = dirname(cursor);
      ancestorReads.add(cursor);
    }
  }
  const networkRules = cell.localProvider
    ? [`(allow network-outbound (remote ip ${JSON.stringify(`localhost:${new URL(cell.localProvider.endpoint).port}`)}))`]
    : ['(allow network*)', '(allow system-socket)'];
  return [
    '(version 1)', '(deny default)',
    '(allow process-fork)', '(allow signal (target self))', '(allow process-info* (target self))',
    '(allow sysctl*)', '(allow mach*)', '(allow ipc*)', ...networkRules,
    '(allow file-read-metadata)',
    `(allow file-read-data ${[...ancestorReads].sort().map((value) => `(literal ${JSON.stringify(value)})`).join(' ')})`,
    ...allowReads, ...allowExec,
    ...allowWrites, '(allow file-write* (literal "/dev/null"))', ...denyWrites,
  ].join('\n');
}

function execBrokerSandboxProfile(workspace, clientState, protectedPatterns) {
  const developerRoot = '/Applications/Xcode.app/Contents/Developer';
  const systemReadRoots = ['/System', '/usr', '/bin', '/sbin', '/Library', '/private/etc', '/private/var/db', '/private/var/run', '/dev', developerRoot]
    .filter((value) => existsSync(value));
  const readableRoots = [...systemReadRoots, workspace, join(clientState, 'executable')];
  const protectedRoots = new Set([join(workspace, '.git'), join(clientState, 'executable')]);
  for (const pattern of protectedPatterns) {
    const prefix = pattern.split('*')[0].replace(/\/$/, '');
    if (prefix) protectedRoots.add(join(workspace, prefix));
  }
  const ancestorReads = new Set(['/']);
  for (const value of readableRoots) {
    let cursor = realpathSync(value);
    while (cursor !== '/') {
      cursor = dirname(cursor);
      ancestorReads.add(cursor);
    }
  }
  const allowReads = readableRoots.map((value) => `(allow file-read* (subpath ${sandboxLiteral(value)}))`);
  const allowExec = ['/usr', '/bin', '/sbin', developerRoot, join(clientState, 'executable')]
    .filter((value) => existsSync(value))
    .map((value) => `(allow process-exec (subpath ${sandboxLiteral(value)}))`);
  const denyWrites = [...protectedRoots].map((value) => `(deny file-write* (subpath ${sandboxLiteral(value)}))`);
  return [
    '(version 1)', '(deny default)', '(deny network*)', '(deny process-fork)',
    '(allow signal (target self))', '(allow process-info* (target self))',
    '(allow sysctl*)', '(allow mach*)', '(allow ipc*)', '(allow file-read-metadata)',
    `(allow file-read-data ${[...ancestorReads].sort().map((value) => `(literal ${JSON.stringify(value)})`).join(' ')})`,
    ...allowReads, ...allowExec,
    `(allow file-write* (subpath ${sandboxLiteral(workspace)}))`,
    '(allow file-write* (literal "/dev/null"))',
    ...denyWrites,
  ].join('\n');
}

function processGroupExists(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error?.code !== 'ESRCH'; }
}

function killProcessGroup(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  try { process.kill(-pid, 'SIGKILL'); } catch {}
}

async function waitForProcessGroupExit(pid, timeoutMs = 2000) {
  const deadline = performance.now() + timeoutMs;
  while (processGroupExists(pid) && performance.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return !processGroupExists(pid);
}

async function runBrokeredExec(request, context, activeGroups) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      canonicalJson(Object.keys(request).sort()) !== canonicalJson(['argv', 'id', 'kind', 'schemaVersion']) ||
      request.schemaVersion !== '1' || request.kind !== 'exec' || !Number.isInteger(request.id) || request.id < 1 ||
      !Array.isArray(request.argv) || request.argv.length < 1 || request.argv.length > 32 ||
      request.argv.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 4096)) {
    throw new Error('exec broker refused malformed or unsupported request');
  }
  const profileSha256 = sha256Bytes(context.profile);
  return await new Promise((resolveResult) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-p', context.profile, request.argv[0], ...request.argv.slice(1)], {
      cwd: context.workspace, env: context.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (Number.isInteger(child.pid)) activeGroups.add(child.pid);
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let settled = false;
    const killGroup = () => killProcessGroup(child.pid);
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 32768) { overflow = true; killGroup(); }
      else chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, 120000);
    const finish = async (exitCode, signal, spawnError = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (processGroupExists(child.pid)) killGroup();
      const processGroupTerminated = await waitForProcessGroupExit(child.pid);
      activeGroups.delete(child.pid);
      resolveResult({
        argv: request.argv, exitCode, signal, timedOut, overflow, processGroupTerminated,
        stdout: redact(Buffer.concat(stdout).toString()),
        stderr: redact(`${Buffer.concat(stderr).toString()}${spawnError ? `\n${spawnError.message}` : ''}`),
        execSandbox: context.configuration,
        sandboxProfileSha256: profileSha256,
      });
    };
    child.once('error', (error) => { void finish(null, null, error); });
    child.once('close', (code, signal) => { void finish(code, signal); });
  });
}

function generatedMcpCommand(workspace, cell, expectedRuntime, expectedMcp) {
  if (!expectedMcp) return null;
  let command;
  if (cell.client === 'codex') {
    const config = readFileSync(join(workspace, '.codex', 'config.toml'), 'utf8');
    const executable = config.match(/^command = (.+)$/m);
    const argument = config.match(/^args = \[(.+)\]$/m);
    if (!executable || !argument) throw new Error('generated Codex MCP configuration is not parseable');
    command = { file: JSON.parse(executable[1]), args: [JSON.parse(argument[1])] };
  } else {
    const config = JSON.parse(readFileSync(join(workspace, '.mcp.json'), 'utf8'));
    command = { file: config.mcpServers?.bce?.command, args: config.mcpServers?.bce?.args };
  }
  if (command.file !== expectedRuntime || canonicalJson(command.args) !== canonicalJson([expectedMcp])) throw new Error('generated MCP command does not use the staged sealed runtime and frozen server');
  return command;
}

function probeMcpHandshake(profile, workspace, command, env) {
  if (!command) return { passed: null, toolNames: [], exitCode: null, stderr: '' };
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bce-evaluation-preflight', version: '1.0.0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map((value) => JSON.stringify(value)).join('\n') + '\n';
  const result = run('/usr/bin/sandbox-exec', ['-p', profile, command.file, ...command.args], workspace, { env, input, timeout: 10000 });
  const documents = jsonDocuments(result.stdout);
  const initialized = documents.find((value) => value.id === 1 && typeof value.result?.protocolVersion === 'string');
  const listed = documents.find((value) => value.id === 2 && Array.isArray(value.result?.tools));
  return {
    passed: result.status === 0 && Boolean(initialized) && Boolean(listed),
    toolNames: listed ? listed.result.tools.map((tool) => tool.name).filter((name) => typeof name === 'string').sort() : [],
    exitCode: result.status,
    stderr: redact(result.stderr),
  };
}

function probeDeniedConnection(profile, workspace, runtimeExecutable, env, host, port) {
  const probe = "const net=require('net');const [host,port]=process.argv.slice(1);let done=false;const finish=c=>{if(!done){done=true;process.exit(c)}};const s=net.connect(Number(port),host);s.once('connect',()=>finish(1));s.once('error',e=>{process.stderr.write(String(e.code??e.message));finish(['EPERM','EACCES'].includes(e.code)?0:2)});setTimeout(()=>finish(3),3000)";
  const result = run('/usr/bin/sandbox-exec', ['-p', profile, runtimeExecutable, '-e', probe, host, String(port)], workspace, { env, timeout: 5000 });
  return { denied: result.status === 0, exitCode: result.status, signal: result.signal, stderr: redact(result.stderr) };
}

function probeLocalProviderIdentity(profile, workspace, cell, runtimeExecutable, env, { requireActiveModel = false } = {}) {
  if (!cell.localProvider) return null;
  const script = "const http=require('http');const base=new URL(process.argv[1]);const get=p=>new Promise((ok,no)=>{const r=http.get(new URL(p,base),x=>{let b='';x.setEncoding('utf8');x.on('data',c=>b+=c);x.on('end',()=>{if(x.statusCode!==200)return no(new Error('HTTP '+x.statusCode));try{ok(JSON.parse(b))}catch(e){no(e)}})});r.on('error',no)});(async()=>{const active=process.argv[3]==='1';const [v,t,p]=await Promise.all([get('/api/version'),get('/api/tags'),active?get('/api/ps'):Promise.resolve(null)]);const m=t.models?.find(x=>x.name===process.argv[2]||x.model===process.argv[2]);if(!m)throw new Error('sealed model missing');const loaded=p?.models?.find(x=>x.name===process.argv[2]||x.model===process.argv[2])??null;process.stdout.write(JSON.stringify({identity:{serverVersion:v.version,modelName:m.name??m.model,modelDigest:m.digest,modelSizeBytes:m.size},activeModel:loaded?{modelName:loaded.name??loaded.model,modelDigest:loaded.digest,runtimeSizeBytes:Number.isInteger(loaded.size)?loaded.size:null,runtimeVramBytes:Number.isInteger(loaded.size_vram)?loaded.size_vram:null,contextLength:Number.isInteger(loaded.context_length)?loaded.context_length:null}:null}))})().catch(e=>{process.stderr.write(String(e.message));process.exit(2)})";
  const result = run('/usr/bin/sandbox-exec', ['-p', profile, runtimeExecutable, '-e', script, cell.localProvider.endpoint, cell.localProvider.modelName, requireActiveModel ? '1' : '0'], workspace, { env, timeout: 10000 });
  const document = jsonDocuments(result.stdout).at(-1) ?? null;
  const expected = {
    serverVersion: cell.localProvider.serverVersion,
    modelName: cell.localProvider.modelName,
    modelDigest: cell.localProvider.modelDigest,
    modelSizeBytes: cell.localProvider.modelSizeBytes,
  };
  const proof = {
    identitySemantics: OLLAMA_IDENTITY_SEMANTICS_V2,
    matched: false, endpoint: cell.localProvider.endpoint, response: document?.identity ?? null,
    responseSha256: document?.identity ? sha256Json(document.identity) : null,
    activeModelRequired: requireActiveModel, activeModel: document?.activeModel ?? null,
    activeModelSha256: document?.activeModel ? sha256Json(document.activeModel) : null,
    exitCode: result.status, signal: result.signal, stderr: redact(result.stderr),
  };
  proof.matched = result.status === 0 && localProviderProofMatches({ ...proof, matched: true }, cell.localProvider, { requireActiveModel });
  return proof;
}

function proveExecBrokerIsolation(profile, controllerRoot, workspace, task, cell, toolchain, clientEnv) {
  if (!profile) return null;
  const canary = join(controllerRoot, 'hidden-oracle.canary');
  const workspaceProbe = join(workspace, '.bce-exec-broker-probe.tmp');
  const protectedProbe = join(workspace, '.blueprints', 'exec-broker-write-probe.tmp');
  mkdirSync(dirname(protectedProbe), { recursive: true });
  const positiveScript = "const fs=require('fs');fs.readFileSync('package.json');fs.writeFileSync(process.argv[1],'ok');fs.unlinkSync(process.argv[1]);process.stdout.write('ok')";
  const writeDeniedScript = "const fs=require('fs');try{fs.writeFileSync(process.argv[1],'x');process.exit(1)}catch(error){process.stderr.write(String(error.code??error.message));process.exit(['EPERM','EACCES'].includes(error.code)?0:2)}";
  const readDeniedScript = "const fs=require('fs');try{fs.readFileSync(process.argv[1]);process.exit(1)}catch(error){process.stderr.write(String(error.code??error.message));process.exit(['EPERM','EACCES'].includes(error.code)?0:2)}";
  const forkDeniedScript = "const{spawnSync}=require('child_process');const r=spawnSync('/usr/bin/true');process.stderr.write(String(r.error?.code??r.status));process.exit(['EPERM','EACCES'].includes(r.error?.code)?0:1)";
  const positive = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', positiveScript, workspaceProbe], workspace, { env: clientEnv, timeout: 5000 });
  const developerGit = '/Applications/Xcode.app/Contents/Developer/usr/bin/git';
  const gitDiagnostic = run('/usr/bin/sandbox-exec', ['-p', profile, existsSync(developerGit) ? developerGit : '/usr/bin/git', '--version'], workspace, { env: clientEnv, timeout: 5000 });
  const protectedWrite = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', writeDeniedScript, protectedProbe], workspace, { env: clientEnv, timeout: 5000 });
  const toolchainWrite = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', writeDeniedScript, toolchain.clientExecutable], workspace, { env: clientEnv, timeout: 5000 });
  const canaryRead = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readDeniedScript, canary], workspace, { env: clientEnv, timeout: 5000 });
  const referencePatchPath = task.referencePatch ? resolveInside(bundleDir, task.referencePatch.path, `${task.id} reference patch`) : null;
  const referenceRead = referencePatchPath
    ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readDeniedScript, referencePatchPath], workspace, { env: clientEnv, timeout: 5000 })
    : null;
  const shortcutPatchPath = task.shortcutPatch ? resolveInside(bundleDir, task.shortcutPatch.path, `${task.id} shortcut patch`) : null;
  const shortcutRead = shortcutPatchPath
    ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readDeniedScript, shortcutPatchPath], workspace, { env: clientEnv, timeout: 5000 })
    : null;
  const fork = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', forkDeniedScript], workspace, { env: clientEnv, timeout: 5000 });
  const providerPort = Number(new URL(cell.localProvider.endpoint).port);
  const provider = probeDeniedConnection(profile, workspace, toolchain.runtimeExecutable, clientEnv, '127.0.0.1', providerPort);
  const external = probeDeniedConnection(profile, workspace, toolchain.runtimeExecutable, clientEnv, '192.0.2.1', 9);
  const wrongLoopback = probeDeniedConnection(profile, workspace, toolchain.runtimeExecutable, clientEnv, '127.0.0.1', providerPort === 1 ? 2 : 1);
  if (existsSync(workspaceProbe)) unlinkSync(workspaceProbe);
  if (existsSync(protectedProbe)) unlinkSync(protectedProbe);
  return {
    driver: '/usr/bin/sandbox-exec', driverSha256: executableDigest('/usr/bin/sandbox-exec'), profileSha256: sha256Bytes(profile),
    workspaceReadWriteAllowed: positive.status === 0 && positive.stdout === 'ok', gitDiagnosticAllowed: gitDiagnostic.status === 0 && /^git version /.test(gitDiagnostic.stdout), protectedWriteDenied: protectedWrite.status === 0,
    toolchainWriteDenied: toolchainWrite.status === 0, controllerCanaryReadDenied: canaryRead.status === 0,
    referencePatchReadDenied: referenceRead === null ? null : referenceRead.status === 0,
    shortcutPatchReadDenied: shortcutRead === null ? null : shortcutRead.status === 0,
    processForkDenied: fork.status === 0,
    providerNetworkDenied: provider.denied, externalNetworkDenied: external.denied, wrongLoopbackDenied: wrongLoopback.denied,
    positiveExitCode: positive.status, gitDiagnosticExitCode: gitDiagnostic.status, protectedWriteExitCode: protectedWrite.status, toolchainWriteExitCode: toolchainWrite.status,
    controllerCanaryReadExitCode: canaryRead.status, referencePatchReadExitCode: referenceRead?.status ?? null, shortcutPatchReadExitCode: shortcutRead?.status ?? null,
    forkExitCode: fork.status,
    providerNetworkProbeExitCode: provider.exitCode, externalNetworkProbeExitCode: external.exitCode, wrongLoopbackProbeExitCode: wrongLoopback.exitCode,
    positiveStderr: redact(positive.stderr), gitDiagnosticStderr: redact(gitDiagnostic.stderr), protectedWriteStderr: redact(protectedWrite.stderr), toolchainWriteStderr: redact(toolchainWrite.stderr),
    controllerCanaryReadStderr: redact(canaryRead.stderr), referencePatchReadStderr: redact(referenceRead?.stderr), shortcutPatchReadStderr: redact(shortcutRead?.stderr), forkStderr: redact(fork.stderr),
  };
}

function proveIsolation(profile, controllerRoot, workspace, task, cell, toolchain, clientEnv, authPath, treatment, execBrokerProfile = null) {
  const canary = join(controllerRoot, 'hidden-oracle.canary');
  const hostWriteProbe = join(controllerRoot, 'host-write-probe.tmp');
  writeFileSync(canary, 'controller-only\n');
  const protectedProbe = join(workspace, '.blueprints', 'write-probe.tmp');
  const workspaceProbe = join(workspace, '.bce-capability-probe.tmp');
  mkdirSync(dirname(protectedProbe), { recursive: true });
  const readProbe = "const fs=require('fs');try{fs.readFileSync(process.argv[1]);process.exit(1)}catch(error){process.stderr.write(String(error.code ?? error.message));process.exit(0)}";
  const writeProbe = "const fs=require('fs');try{fs.writeFileSync(process.argv[1],'x');process.exit(1)}catch(error){process.stderr.write(String(error.code ?? error.message));process.exit(0)}";
  const workspaceProbeScript = "const fs=require('fs');fs.readFileSync('package.json');fs.writeFileSync(process.argv[1],'ok');fs.unlinkSync(process.argv[1]);process.stdout.write('ok')";
  const readResult = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readProbe, canary], workspace, { env: clientEnv });
  const referencePatchPath = task.referencePatch ? resolveInside(bundleDir, task.referencePatch.path, `${task.id} reference patch`) : null;
  const referenceReadResult = referencePatchPath
    ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readProbe, referencePatchPath], workspace, { env: clientEnv })
    : null;
  const shortcutPatchPath = task.shortcutPatch ? resolveInside(bundleDir, task.shortcutPatch.path, `${task.id} shortcut patch`) : null;
  const shortcutReadResult = shortcutPatchPath
    ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', readProbe, shortcutPatchPath], workspace, { env: clientEnv })
    : null;
  const hostWriteResult = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', writeProbe, hostWriteProbe], workspace, { env: clientEnv });
  const writeResult = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', writeProbe, protectedProbe], workspace, { env: clientEnv });
  const clientToolchainWriteResult = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', writeProbe, toolchain.clientExecutable], workspace, { env: clientEnv });
  const workspaceResult = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', workspaceProbeScript, workspaceProbe], workspace, { env: clientEnv });
  const runtimeVersion = run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '--version'], workspace, { env: clientEnv });
  const clientVersion = cell.client === 'bce-ollama-tool-client'
    ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, toolchain.clientExecutable, '--version'], workspace, { env: clientEnv })
    : run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.clientExecutable, '--version'], workspace, { env: clientEnv });
  const authResult = authPath ? run('/usr/bin/sandbox-exec', ['-p', profile, toolchain.runtimeExecutable, '-e', "require('fs').accessSync(process.argv[1]);process.stdout.write('ok')", authPath], workspace, { env: clientEnv }) : null;
  const mcp = probeMcpHandshake(profile, workspace, generatedMcpCommand(workspace, cell, toolchain.runtimeExecutable, treatment.mcp), clientEnv);
  const provider = probeLocalProviderIdentity(profile, workspace, cell, toolchain.runtimeExecutable, clientEnv);
  const providerPort = cell.localProvider ? Number(new URL(cell.localProvider.endpoint).port) : null;
  const external = cell.localProvider ? probeDeniedConnection(profile, workspace, toolchain.runtimeExecutable, clientEnv, '192.0.2.1', 9) : null;
  const nonProviderLoopback = cell.localProvider ? probeDeniedConnection(profile, workspace, toolchain.runtimeExecutable, clientEnv, '127.0.0.1', providerPort === 1 ? 2 : 1) : null;
  const execBroker = cell.client === 'bce-ollama-tool-client' ? proveExecBrokerIsolation(execBrokerProfile, controllerRoot, workspace, task, cell, toolchain, clientEnv) : null;
  if (existsSync(protectedProbe)) unlinkSync(protectedProbe);
  if (existsSync(workspaceProbe)) unlinkSync(workspaceProbe);
  if (existsSync(hostWriteProbe)) unlinkSync(hostWriteProbe);
  return {
    driver: 'macos-sandbox-exec', driverSha256: executableDigest('/usr/bin/sandbox-exec'), profileSha256: sha256Bytes(profile),
    clientSandboxMode: protocol.isolation.clientSandboxMode ?? 'nested-client-sandbox',
    readDefaultDeny: true,
    oracleReadDenied: readResult.status === 0, hostCanaryReadDenied: readResult.status === 0,
    referencePatchReadDenied: referenceReadResult === null ? null : referenceReadResult.status === 0,
    shortcutPatchReadDenied: shortcutReadResult === null ? null : shortcutReadResult.status === 0,
    hostCanaryWriteDenied: hostWriteResult.status === 0, protectedWriteDenied: writeResult.status === 0,
    clientToolchainWriteDenied: clientToolchainWriteResult.status === 0,
    workspaceReadWriteAllowed: workspaceResult.status === 0 && workspaceResult.stdout === 'ok',
    stagedRuntimeVersionVerified: runtimeVersion.status === 0 && runtimeVersion.stdout.trim() === protocol.isolation.runtimeVersion,
    stagedClientVersionVerified: clientVersion.status === 0 && `${clientVersion.stdout}${clientVersion.stderr}`.trim().split('\n')[0] === cell.clientVersion,
    authenticationReadableToClientProcess: authResult === null ? null : authResult.status === 0,
    authenticationAbsent: cell.localProvider ? authPath === null && (!clientEnv.CODEX_HOME || !existsSync(join(clientEnv.CODEX_HOME, 'auth.json'))) : null,
    mcpHandshakePassed: mcp.passed, mcpDoneCheckAvailable: mcp.toolNames.includes('run_gate'), mcpToolNames: mcp.toolNames,
    providerReachable: provider?.matched ?? null, providerIdentityBefore: provider,
    externalNetworkDenied: external?.denied ?? null, nonProviderLoopbackDenied: nonProviderLoopback?.denied ?? null,
    clientExecutableStagedSha256: sha256Bytes(readFileSync(toolchain.clientExecutable)),
    runtimeExecutableStagedSha256: sha256Bytes(readFileSync(toolchain.runtimeExecutable)),
    readProbeExitCode: readResult.status, hostWriteProbeExitCode: hostWriteResult.status, writeProbeExitCode: writeResult.status,
    clientToolchainWriteProbeExitCode: clientToolchainWriteResult.status,
    readProbeSignal: readResult.signal, hostWriteProbeSignal: hostWriteResult.signal, writeProbeSignal: writeResult.signal, workspaceProbeSignal: workspaceResult.signal,
    runtimeProbeSignal: runtimeVersion.signal, clientProbeSignal: clientVersion.signal,
    runtimeProbeStderr: redact(runtimeVersion.stderr), clientProbeStderr: redact(clientVersion.stderr),
    readProbeStderr: redact(readResult.stderr), referenceReadProbeStderr: redact(referenceReadResult?.stderr), shortcutReadProbeStderr: redact(shortcutReadResult?.stderr), hostWriteProbeStderr: redact(hostWriteResult.stderr), writeProbeStderr: redact(writeResult.stderr), clientToolchainWriteProbeStderr: redact(clientToolchainWriteResult.stderr), mcpExitCode: mcp.exitCode, mcpStderr: mcp.stderr,
    externalNetworkProbeExitCode: external?.exitCode ?? null, externalNetworkProbeStderr: external?.stderr ?? '',
    nonProviderLoopbackProbeExitCode: nonProviderLoopback?.exitCode ?? null, nonProviderLoopbackProbeStderr: nonProviderLoopback?.stderr ?? '',
    execBroker,
  };
}

async function runClient(command, workspace, profile, timeoutMs, credentialPath = null, execBroker = null) {
  return new Promise((resolveResult) => {
    const started = performance.now();
    const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, command.file, ...command.args], {
      cwd: workspace, env: command.env, detached: true, stdio: execBroker ? ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let timedOut = false;
    let overflow = false;
    let settled = false;
    let stdoutLines = '';
    let clientSessionObserved = false;
    let credentialRetiredBeforeModelToolExecution = credentialPath === null;
    let modelToolExecutionObservedBeforeCredentialRetirement = false;
    const execBrokerEvidence = [];
    let execBrokerError = null;
    let execBrokerBuffer = '';
    let nextExecBrokerId = 1;
    let execBrokerQueue = Promise.resolve();
    let execBrokerAborted = false;
    const activeExecBrokerGroups = new Set();
    const isModelToolEvent = (event) => {
      const type = String(event?.type ?? '').toLowerCase();
      const itemType = String(event?.item?.type ?? '').toLowerCase();
      return type.includes('tool_call') || ['command_execution', 'file_change', 'mcp_tool_call'].includes(itemType);
    };
    const observeLine = (line) => {
      try {
        const event = JSON.parse(line);
        if (isModelToolEvent(event) && credentialPath && existsSync(credentialPath)) {
          modelToolExecutionObservedBeforeCredentialRetirement = true;
          credentialRetiredBeforeModelToolExecution = false;
        }
        if (['thread.started', 'turn.started', 'session.started'].includes(event.type)) {
          clientSessionObserved = true;
          if (credentialPath && existsSync(credentialPath)) {
            unlinkSync(credentialPath);
            credentialRetiredBeforeModelToolExecution = !modelToolExecutionObservedBeforeCredentialRetirement;
          }
        }
      } catch {}
    };
    const observeClientEvent = (chunk) => {
      stdoutLines += chunk.toString();
      const lines = stdoutLines.split('\n');
      stdoutLines = lines.pop() ?? '';
      for (const line of lines) observeLine(line);
    };
    const recordBrokerError = (error) => {
      if (execBrokerError === null) execBrokerError = error instanceof Error ? error.message : String(error);
    };
    const stopBrokerGroups = async () => {
      execBrokerAborted = true;
      const pids = [...activeExecBrokerGroups];
      for (const pid of pids) killProcessGroup(pid);
      await Promise.all(pids.map((pid) => waitForProcessGroupExit(pid)));
    };
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      await stopBrokerGroups();
      try { await execBrokerQueue; }
      catch (error) { recordBrokerError(error); }
      await stopBrokerGroups();
      if (execBrokerBuffer.trim()) recordBrokerError(new Error('exec broker request stream ended with a partial record'));
      resolveResult({ ...result, execBrokerEvidence, execBrokerError });
    };
    const collect = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) {
        overflow = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      } else chunks.push(chunk);
    };
    child.stdout.on('data', (chunk) => { collect(stdout)(chunk); observeClientEvent(chunk); });
    child.stderr.on('data', collect(stderr));
    if (execBroker) {
      const failBroker = (error) => {
        recordBrokerError(error);
        execBrokerAborted = true;
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        for (const pid of activeExecBrokerGroups) killProcessGroup(pid);
      };
      child.stdio[3].on('data', (chunk) => {
        execBrokerBuffer += chunk.toString();
        const lines = execBrokerBuffer.split('\n');
        execBrokerBuffer = lines.pop() ?? '';
        for (const line of lines.filter((value) => value.trim())) {
          execBrokerQueue = execBrokerQueue.then(async () => {
            if (execBrokerAborted) throw new Error('exec broker refused a request after client termination');
            let request;
            try { request = JSON.parse(line); }
            catch { throw new Error('exec broker request is not JSON'); }
            if (request.id !== nextExecBrokerId) throw new Error(`exec broker request id ${String(request.id)} is not the next id ${nextExecBrokerId}`);
            nextExecBrokerId += 1;
            const requestSha256 = sha256Json(request);
            const result = await runBrokeredExec(request, execBroker, activeExecBrokerGroups);
            if (result.processGroupTerminated !== true) throw new Error(`exec broker command ${request.id} left a live process group`);
            const response = { schemaVersion: '1', id: request.id, kind: 'exec-result', requestSha256, result };
            const responseSha256 = sha256Json(response);
            execBrokerEvidence.push({ request, requestSha256, response, responseSha256 });
            if (execBrokerAborted || child.stdio[4].destroyed || !child.stdio[4].writable) throw new Error(`exec broker response channel closed before response ${request.id}`);
            await new Promise((resolveWrite, rejectWrite) => child.stdio[4].write(`${JSON.stringify(response)}\n`, (error) => error ? rejectWrite(error) : resolveWrite()));
          }).catch(failBroker);
        }
      });
      child.stdio[3].on('error', failBroker);
      child.stdio[4].on('error', (error) => { if (!settled) failBroker(error); });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      if (credentialPath && existsSync(credentialPath)) unlinkSync(credentialPath);
      if (stdoutLines.trim()) observeLine(stdoutLines);
      void finish({ status: null, signal: null, stdout: Buffer.concat(stdout).toString(), stderr: `${Buffer.concat(stderr).toString()}\n${error.message}`, timedOut, overflow, latencyMs: Math.round(performance.now() - started), processGroupTerminated: true, clientSessionObserved, credentialRetiredBeforeModelToolExecution, modelToolExecutionObservedBeforeCredentialRetirement });
    });
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      const processGroupTerminated = !processGroupExists(child.pid);
      if (!processGroupTerminated) {
        killProcessGroup(child.pid);
        await waitForProcessGroupExit(child.pid);
      }
      if (stdoutLines.trim()) observeLine(stdoutLines);
      if (credentialPath && existsSync(credentialPath)) unlinkSync(credentialPath);
      await finish({ status: code, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), timedOut, overflow, latencyMs: Math.round(performance.now() - started), processGroupTerminated, clientSessionObserved, credentialRetiredBeforeModelToolExecution, modelToolExecutionObservedBeforeCredentialRetirement });
    });
  });
}

function jsonDocuments(text) {
  const documents = [];
  const whole = String(text ?? '').trim();
  if (whole.startsWith('{')) {
    try { documents.push(JSON.parse(whole)); return documents; } catch {}
  }
  for (const line of whole.split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try { documents.push(JSON.parse(line)); } catch {}
  }
  return documents;
}

function extractUsage(stdout, cell, sealedClientEvidence = null) {
  const documents = jsonDocuments(stdout);
  if (cell.client === 'bce-ollama-tool-client') {
    return { ...(sealedClientEvidence?.usage ?? { agentTurns: null, inputTokens: null, outputTokens: null, cachedTokens: null, costUsd: null, resolvedModel: null }), raw: documents };
  }
  if (cell.client === 'fixture-agent' && seal.attestation?.kind === 'synthetic-self-test') {
    const result = documents.at(-1) ?? {};
    return {
      agentTurns: Number.isFinite(result.num_turns) ? result.num_turns : null,
      inputTokens: Number.isFinite(result.input_tokens) ? result.input_tokens : null,
      outputTokens: Number.isFinite(result.output_tokens) ? result.output_tokens : null,
      cachedTokens: Number.isFinite(result.cached_tokens) ? result.cached_tokens : null,
      costUsd: Number.isFinite(result.cost_usd) ? result.cost_usd : null,
      resolvedModel: typeof result.model === 'string' ? result.model : null,
      raw: documents,
    };
  }
  if (cell.client === 'codex') {
    const usage = [...documents].reverse().find((value) => value.type === 'turn.completed')?.usage ?? {};
    return {
      agentTurns: documents.filter((value) => value.type === 'turn.started').length || null,
      inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : null,
      outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : null,
      cachedTokens: Number.isFinite(usage.cached_input_tokens) ? usage.cached_input_tokens : null,
      costUsd: null,
      resolvedModel: cell.localProvider ? cell.resolvedModel : cell.modelIdentitySource === 'codex-requested-model-cli-accepted-no-provider-id' ? cell.requestedModel : null,
      raw: documents,
    };
  }
  if (cell.client === 'claude-code') {
    const result = documents.at(-1) ?? {};
    const models = Object.keys(result.modelUsage ?? {});
    return {
      agentTurns: Number.isFinite(result.num_turns) ? result.num_turns : null,
      inputTokens: Number.isFinite(result.usage?.input_tokens) ? result.usage.input_tokens : null,
      outputTokens: Number.isFinite(result.usage?.output_tokens) ? result.usage.output_tokens : null,
      cachedTokens: Number.isFinite(result.usage?.cache_read_input_tokens) ? result.usage.cache_read_input_tokens : null,
      costUsd: Number.isFinite(result.total_cost_usd) ? result.total_cost_usd : null,
      resolvedModel: models.length === 1 ? models[0] : null,
      raw: documents,
    };
  }
  const result = documents.at(-1) ?? {};
  return {
    agentTurns: Number.isFinite(result.num_turns) ? result.num_turns : null,
    inputTokens: Number.isFinite(result.input_tokens) ? result.input_tokens : null,
    outputTokens: Number.isFinite(result.output_tokens) ? result.output_tokens : null,
    cachedTokens: Number.isFinite(result.cached_tokens) ? result.cached_tokens : null,
    costUsd: Number.isFinite(result.cost_usd) ? result.cost_usd : null,
    resolvedModel: typeof result.model === 'string' ? result.model : null,
    raw: documents,
  };
}

function observedWritePaths(stdout, sealedClientEvidence = null) {
  if (sealedClientEvidence) return [...new Set(sealedClientEvidence.observedWritePaths)].sort();
  const paths = new Set();
  const visit = (value, fileContext = false) => {
    if (!value || typeof value !== 'object') return;
    const type = String(value.type ?? value.name ?? '').toLowerCase();
    const nextContext = fileContext || type.includes('file') || ['edit', 'write', 'apply_patch'].includes(type);
    for (const [key, child] of Object.entries(value)) {
      if (nextContext && ['path', 'file_path', 'filePath'].includes(key) && typeof child === 'string') paths.add(child.replace(/^\.\//, '').split(sep).join('/'));
      else if (typeof child === 'object') visit(child, nextContext);
    }
  };
  for (const document of jsonDocuments(stdout)) visit(document);
  return [...paths].sort();
}

function extractMechanism(stdout, assignment, sealedClientEvidence = null, cell = null) {
  if (sealedClientEvidence) return sealedClientEvidence.mechanism;
  if (cell?.client === 'bce-ollama-tool-client') return {
    eventEvidenceAvailable: false,
    skillReadObserved: null,
    mcpToolCalls: null,
    bceGateCalls: null,
    bceVerdictSequence: null,
    redToGreenCorrectionObserved: null,
    commonToolCalls: null,
    malformedToolCalls: null,
    toolFailures: null,
    providerRequests: null,
    eventChainHeadSha256: null,
  };
  const documents = jsonDocuments(stdout);
  if (documents.length === 0) return {
    eventEvidenceAvailable: false, skillReadObserved: null, mcpToolCalls: null, bceGateCalls: null,
    bceVerdictSequence: null, redToGreenCorrectionObserved: null,
  };
  const nodes = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    nodes.push(value);
    for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
  };
  for (const document of documents) visit(document);
  const text = canonicalJson(documents);
  const successfulBceMcpCalls = nodes.filter((value) =>
    String(value.type ?? '').toLowerCase() === 'mcp_tool_call' &&
    String(value.server ?? '').toLowerCase() === 'bce' &&
    ['completed', 'succeeded'].includes(String(value.status ?? '').toLowerCase()) &&
    (value.error === null || value.error === undefined));
  const successfulBceGateCalls = successfulBceMcpCalls.filter((value) => String(value.tool ?? '').toLowerCase() === 'run_gate');
  const verdicts = [...text.matchAll(/\\?"verdict\\?"\s*:\s*\\?"(pass|fail)\\?"/gi)].map((match) => match[1].toLowerCase());
  const firstFail = verdicts.indexOf('fail');
  const redToGreen = firstFail >= 0 && verdicts.slice(firstFail + 1).includes('pass');
  return {
    eventEvidenceAvailable: true,
    skillReadObserved: assignment.arm === 'bce-enabled' ? /\.agents\/skills\/bce\/SKILL\.md|\.claude\/skills\/bce\/SKILL\.md/.test(text) : null,
    mcpToolCalls: assignment.arm === 'bce-enabled' ? successfulBceMcpCalls.length : 0,
    bceGateCalls: assignment.arm === 'bce-enabled' ? successfulBceGateCalls.length : 0,
    bceVerdictSequence: assignment.arm === 'bce-enabled' ? verdicts : [],
    redToGreenCorrectionObserved: assignment.arm === 'bce-enabled' ? redToGreen : false,
  };
}

function minimalControllerEnv(extra = {}) {
  const env = { ...extra };
  for (const key of ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[key]) env[key] = process.env[key];
  return env;
}

function runCommandSpec(command, workspace, timeout = 120000) {
  if (!Array.isArray(command) || command.length === 0) throw new Error('empty command');
  const [file, ...args] = command;
  return run(file, args, workspace, { env: minimalControllerEnv(), timeout });
}

function lstatExists(path) { try { lstatSync(path); return true; } catch { return false; } }

function applyAllowedChanges(preparedRoot, finalWorkspace, target, changes, allowedPaths) {
  copyTree(preparedRoot, target, { includeNodeModules: true });
  for (const change of changes.filter((entry) => matchesAny(entry.path, allowedPaths))) {
    const source = resolve(finalWorkspace, change.path);
    const destination = resolve(target, change.path);
    for (const entry of [change.before, change.after].filter(Boolean)) {
      if (entry.type === 'symlink') throw new Error(`symbolic-link output replay is refused: ${change.path}`);
    }
    if (!change.after) {
      if (lstatExists(destination)) rmSync(destination, { recursive: true, force: true });
      continue;
    }
    if (change.after.type !== 'file') throw new Error(`allowed output is not a regular file: ${change.path}`);
    mkdirSync(dirname(destination), { recursive: true });
    if (!lstatSync(source).isFile() || lstatSync(source).isSymbolicLink()) throw new Error(`allowed output changed type unexpectedly: ${change.path}`);
    const sourceReal = realpathSync(source);
    const workspaceReal = realpathSync(finalWorkspace);
    if (sourceReal !== workspaceReal && !sourceReal.startsWith(`${workspaceReal}${sep}`)) throw new Error(`allowed output real path escapes the model workspace: ${change.path}`);
    if (lstatExists(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`prepared replay destination is a symbolic link: ${change.path}`);
    copyFileSync(source, destination);
    chmodSync(destination, change.after.mode);
  }
}

function parseOracleDocument(result, task, inputTreeSha256, kind) {
  const document = jsonDocuments(result.stdout).at(-1) ?? null;
  const keys = document && typeof document === 'object' ? Object.keys(document).sort() : [];
  const allowedKeys = kind === 'functional'
    ? ['collateralRegression', 'inputTreeSha256', 'locations', 'passed', 'schemaVersion', 'taskId']
    : ['inputTreeSha256', 'locations', 'passed', 'schemaVersion', 'taskId'];
  const shapeValid = document !== null && keys.every((key) => allowedKeys.includes(key)) &&
    document.schemaVersion === '1' && document.taskId === task.id && document.inputTreeSha256 === inputTreeSha256 &&
    typeof document.passed === 'boolean' && Array.isArray(document.locations) && document.locations.every((value) => typeof value === 'string') &&
    (kind !== 'functional' || typeof document.collateralRegression === 'boolean');
  return {
    passed: result.status === 0 && shapeValid && document.passed === true,
    collateralRegression: kind === 'functional' && shapeValid ? document.collateralRegression === true : false,
    locations: shapeValid ? document.locations : [], valid: shapeValid,
    exitCode: result.status, signal: result.signal, stdout: redact(result.stdout), stderr: redact(result.stderr), document,
  };
}

function oracleSandboxProfile(controllerRoot) {
  const denyReads = [homedir(), repositoryRoot, bundleDir, runsRoot]
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => `(deny file-read-data (subpath ${sandboxLiteral(value)}))`);
  return [
    '(version 1)', '(allow default)', ...denyReads,
    `(deny file-read-data (literal ${sandboxLiteral(join(controllerRoot, 'hidden-oracle.canary'))}))`,
    '(deny file-write*)',
    '(deny network*)',
  ].join('\n');
}

function proveOracleIsolation(profile, controllerRoot, cwd) {
  const canary = join(controllerRoot, 'hidden-oracle.canary');
  const readProbe = "const fs=require('fs');try{fs.readFileSync(process.argv[1]);process.exit(1)}catch(error){process.stderr.write(String(error.code??error.message));process.exit(0)}";
  const networkProbe = "const net=require('net');let done=false;const finish=c=>{if(!done){done=true;process.exit(c)}};const s=net.createServer();s.once('error',e=>{process.stderr.write(String(e.code??e.message));finish(0)});s.listen(0,'127.0.0.1',()=>finish(1));setTimeout(()=>finish(2),2000)";
  const readResult = run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', readProbe, canary], cwd, { env: minimalControllerEnv(), timeout: 5000 });
  const networkResult = run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', networkProbe], cwd, { env: minimalControllerEnv(), timeout: 5000 });
  return {
    driver: 'macos-sandbox-exec',
    driverSha256: executableDigest('/usr/bin/sandbox-exec'),
    profileSha256: sha256Bytes(profile),
    controllerReadDenied: readResult.status === 0,
    networkDenied: networkResult.status === 0,
    readProbeExitCode: readResult.status,
    networkProbeExitCode: networkResult.status,
    readProbeStderr: redact(readResult.stderr),
    networkProbeStderr: redact(networkResult.stderr),
  };
}

function runOracleOnce(oracle, task, neutralRoot, inputTreeSha256, kind, scratchRoot, suffix) {
  const oracleWorkspace = join(scratchRoot, `${kind}-${suffix}`);
  copyTree(neutralRoot, oracleWorkspace, { includeNodeModules: true });
  if (oracle.command.length !== 2 || oracle.command[0] !== 'node' || oracle.command[1] !== oracle.artifact.path) throw new Error(`${kind} oracle command is not the sealed node + artifact form`);
  const artifact = resolveInside(bundleDir, oracle.artifact.path, `${kind} oracle`);
  const isolatedArtifact = join(oracleWorkspace, `.bce-hidden-${kind}-oracle.mjs`);
  copyFileSync(artifact, isolatedArtifact);
  const profile = oracleSandboxProfile(scratchRoot);
  const isolationProof = proveOracleIsolation(profile, scratchRoot, oracleWorkspace);
  if (!isolationProof.controllerReadDenied || !isolationProof.networkDenied) throw new Error(`${kind} oracle isolation canary failed: ${JSON.stringify(isolationProof)}`);
  const result = run('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, isolatedArtifact], oracleWorkspace, {
    env: minimalControllerEnv({ BCE_EVAL_WORKSPACE: oracleWorkspace, BCE_EVAL_TASK_ID: task.id, BCE_EVAL_INPUT_TREE_SHA256: inputTreeSha256 }),
    timeout: task.budget.timeoutMs,
  });
  return { ...parseOracleDocument(result, task, inputTreeSha256, kind), isolationProof };
}

function runOracleTwice(oracle, task, neutralRoot, kind, scratchRoot) {
  const inputTreeSha256 = hashTree(neutralRoot);
  const first = runOracleOnce(oracle, task, neutralRoot, inputTreeSha256, kind, scratchRoot, 'a');
  const second = runOracleOnce(oracle, task, neutralRoot, inputTreeSha256, kind, scratchRoot, 'b');
  const deterministic = canonicalJson(first.document) === canonicalJson(second.document) && first.exitCode === second.exitCode;
  return {
    passed: deterministic && first.passed && second.passed,
    collateralRegression: kind === 'functional' && (first.collateralRegression || second.collateralRegression),
    locations: first.locations, deterministic, executed: true, inputTreeSha256, runs: [first, second],
  };
}

function derive(assignment, status, bindings, visible, functional, architecture, policy, telemetry, task) {
  const cell = protocol.clientModelCells.find((entry) => entry.id === assignment.cellId);
  const modelIdentityVerified = bindings.resolvedModel === cell.resolvedModel && ['provider-response', 'synthetic-response'].includes(cell.modelIdentityEvidence);
  const nonBcePipelineAccepted = visible.nonBceAccepted === true;
  const bceGateAccepted = assignment.arm === 'bce-enabled' ? visible.bceGateAccepted === true : null;
  const visiblePipelineAccepted = nonBcePipelineAccepted && (assignment.arm === 'baseline-no-bce' || bceGateAccepted === true);
  const withinTime = telemetry.endToEndVisibleMs !== null && telemetry.endToEndVisibleMs <= task.budget.timeoutMs;
  const withinTurns = telemetry.agentTurns !== null && telemetry.agentTurns <= task.budget.maxTurns;
  const withinCost = task.budget.maxCostUsd === null || (telemetry.costUsd !== null && telemetry.costUsd <= task.budget.maxCostUsd);
  const withinBudget = withinTime && withinTurns && withinCost;
  const hiddenFunctionalPassed = functional.passed === true;
  const independentArchitecturePassed = architecture.passed === true;
  const policyAssessmentComplete = policy.assessmentComplete ?? true;
  const policyMutationObserved = policy.mutationObserved ?? policy.mutation === true;
  const policyFailClosedForOutcome = policy.failClosedForOutcome ?? policyMutationObserved;
  const result = {
    modelIdentityVerified, nonBcePipelineAccepted, bceGateAccepted, visiblePipelineAccepted,
    hiddenFunctionalPassed, independentArchitecturePassed, policyMutation: policyMutationObserved, withinBudget,
    safeSuccessfulCompletion: status === 'completed' && modelIdentityVerified && visiblePipelineAccepted && hiddenFunctionalPassed && independentArchitecturePassed && !policyFailClosedForOutcome && withinBudget,
    escapedDefect: visiblePipelineAccepted && !independentArchitecturePassed,
    productiveBlock: assignment.arm === 'bce-enabled' && nonBcePipelineAccepted && bceGateAccepted === false && (!independentArchitecturePassed || policyMutationObserved),
    falseBlock: assignment.arm === 'bce-enabled' && nonBcePipelineAccepted && bceGateAccepted === false && policyAssessmentComplete && hiddenFunctionalPassed && independentArchitecturePassed && !policyMutationObserved,
    collateralRegression: functional.collateralRegression === true,
  };
  if (triStatePolicyOutcomes) Object.assign(result, { policyAssessmentComplete, policyMutationObserved, policyFailClosedForOutcome });
  return result;
}

function appendLedger(record) {
  const path = join(runsRoot, 'ledger.jsonl');
  const prior = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  if (record.assignment.orderIndex !== prior.length) throw new Error(`${record.trialId}: ledger order ${prior.length} differs from frozen order ${record.assignment.orderIndex}`);
  if (prior.some((entry) => entry.trialId === record.trialId)) throw new Error(`${record.trialId}: ledger already contains a primary attempt`);
  const entry = {
    schemaVersion: '1', sequence: prior.length, orderIndex: record.assignment.orderIndex, trialId: record.trialId,
    attemptId: record.attemptId, recordSha256: record.recordSha256,
    previousEntrySha256: prior.at(-1)?.entrySha256 ?? null, entrySha256: null,
  };
  entry.entrySha256 = sha256Json(entry);
  appendFileSync(path, `${JSON.stringify(entry)}\n`, { flag: 'a' });
}

function commitTerminal(context) {
  const { assignment, task, trialDir, state, status, startedAt, exitCode, bindings, documents, telemetry } = context;
  const evidence = {
    events: storeArtifact(trialDir, 'events.final.jsonl', `${state.events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'application/x-ndjson'),
    transcript: storeArtifact(trialDir, 'transcript.json', `${JSON.stringify(documents.transcript, null, 2)}\n`, 'application/json', 'credentials-only', 'restricted'),
    patch: storeArtifact(trialDir, 'change-inventory.json', `${JSON.stringify(documents.patch, null, 2)}\n`, 'application/json'),
    finalTree: storeArtifact(trialDir, 'final-tree.json', `${JSON.stringify(documents.finalTree, null, 2)}\n`, 'application/json'),
    preparation: storeArtifact(trialDir, 'preparation.json', `${JSON.stringify(documents.preparation, null, 2)}\n`, 'application/json'),
    isolationProof: storeArtifact(trialDir, 'isolation-proof.json', `${JSON.stringify(documents.isolationProof, null, 2)}\n`, 'application/json'),
    visiblePipeline: storeArtifact(trialDir, 'visible-pipeline.json', `${JSON.stringify(documents.visible, null, 2)}\n`, 'application/json'),
    functionalOracle: storeArtifact(trialDir, 'functional-oracle.json', `${JSON.stringify(documents.functional, null, 2)}\n`, 'application/json'),
    architectureOracle: storeArtifact(trialDir, 'architecture-oracle.json', `${JSON.stringify(documents.architecture, null, 2)}\n`, 'application/json'),
    policyDiff: storeArtifact(trialDir, 'policy-diff.json', `${JSON.stringify(documents.policy, null, 2)}\n`, 'application/json'),
  };
  const derived = derive(assignment, status, bindings, documents.visible, documents.functional, documents.architecture, documents.policy, telemetry, task);
  const terminal = {
    schemaVersion: terminalRecordSchemaVersion, studyId: protocol.studyId, trialId: assignment.trialId, pairId: assignment.pairId,
    attemptId: `${assignment.trialId}-a0`, primaryAttempt: true, retryOf: null,
    assignment: { cellId: assignment.cellId, repositoryId: assignment.repositoryId, taskId: assignment.taskId, arm: assignment.arm, orderIndex: assignment.orderIndex },
    bindings, status,
    exposure: { modelRequestExposed: true, startedAt, endedAt: new Date().toISOString(), exitCode },
    evidence, derived, mechanism: documents.mechanism, telemetry, recordSha256: null,
  };
  terminal.recordSha256 = sha256Json(terminal);
  const terminalPath = join(trialDir, 'terminal.json');
  if (existsSync(terminalPath)) throw new Error(`${assignment.trialId}: immutable terminal already exists`);
  writeAtomic(terminalPath, `${JSON.stringify(terminal, null, 2)}\n`);
  appendLedger(terminal);
  process.stdout.write(`${assignment.orderIndex} ${assignment.trialId}: ${status}; safe=${derived.safeSuccessfulCompletion}; escape=${derived.escapedDefect}; policyMutation=${derived.policyMutation}\n`);
  return terminal;
}

function failureDocuments(context, error) {
  const message = redact(error instanceof Error ? error.stack ?? error.message : String(error));
  const captured = context.captured ?? {};
  const sealedClientFailure = context.cell?.client === 'bce-ollama-tool-client';
  return {
    transcript: captured.transcript
      ? { ...captured.transcript, controllerFailure: message }
      : {
          schemaVersion: '1', trialId: context.assignment.trialId, controllerFailure: message,
          stdout: redact(context.clientResult?.stdout), stderr: redact(context.clientResult?.stderr),
          sealedClientEventVerification: sealedClientFailure ? { passed: false, error: message, eventChainHeadSha256: null } : null,
        },
    patch: captured.patch ?? { schemaVersion: '1', available: false, reason: message, changes: [] },
    finalTree: captured.finalTree ?? { available: false, reason: message },
    preparation: context.preparation,
    isolationProof: context.isolationProof,
    visible: { accepted: false, nonBceAccepted: false, bceGateAccepted: context.assignment.arm === 'bce-enabled' ? false : null, runs: [], failure: message },
    functional: { passed: false, collateralRegression: false, deterministic: true, executed: false, failure: message },
    architecture: { passed: false, locations: [], deterministic: true, executed: false, failure: message },
    policy: captured.policy ?? { assessmentComplete: false, mutationObserved: false, failClosedForOutcome: true, mutation: false, finalPolicyPaths: [], observedWritePaths: [], outOfScope: [], conservativeFailureClassification: true },
    mechanism: captured.mechanism ?? {
      eventEvidenceAvailable: false, skillReadObserved: null, mcpToolCalls: null, bceGateCalls: null,
      bceVerdictSequence: null, redToGreenCorrectionObserved: null,
      ...(sealedClientFailure ? { commonToolCalls: null, malformedToolCalls: null, toolFailures: null, providerRequests: null, eventChainHeadSha256: null } : {}),
    },
  };
}

function missingTelemetry(assignment, latencyMs = null, usage = null) {
  const values = {
    latencyMs, nonBcePipelineMs: null, bceGateMs: null, endToEndVisibleMs: latencyMs,
    oracleMs: null, agentTurns: usage?.agentTurns ?? null, inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null, cachedTokens: usage?.cachedTokens ?? null, costUsd: usage?.costUsd ?? null,
  };
  const missingReasons = {};
  for (const [key, value] of Object.entries(values)) if (value === null) missingReasons[key] = key === 'bceGateMs' && assignment.arm === 'baseline-no-bce' ? 'baseline arm has no BCE gate' : 'post-exposure controller failure prevented trustworthy measurement';
  return { ...values, missingReasons };
}

function readPartialEvents(eventsPath) {
  const lines = readFileSync(eventsPath, 'utf8').split('\n').filter(Boolean);
  let previous = null;
  return lines.map((line, index) => {
    const event = JSON.parse(line);
    if (event.sequence !== index || event.previousEventSha256 !== previous || event.eventSha256 !== sha256Json({ ...event, eventSha256: null })) {
      throw new Error(`stale journal integrity failure at event ${index}`);
    }
    previous = event.eventSha256;
    return event;
  });
}

function recoverExposedAttempt(assignment, task, repository, cell, trialDir, eventsPath) {
  const events = readPartialEvents(eventsPath);
  const exposure = events.find((event) => event.type === 'model-request-exposed');
  if (!exposure) return null;
  const isolationEvent = events.find((event) => event.type === 'isolation-proven');
  const preparedEvent = events.find((event) => event.type === 'isolation-prepared');
  if (!isolationEvent || !preparedEvent || preparedEvent.payload.preparedTreeSha256 !== repository.preparedTreeSha256) {
    throw new Error(`${assignment.trialId}: exposed journal lacks trustworthy preparation/isolation evidence`);
  }
  const state = {
    events,
    eventsPath,
    monotonicStart: performance.now() - Math.max(0, events.at(-1)?.monotonicMs ?? 0),
  };
  const recoveryError = new Error('controller process terminated after model exposure; immutable primary attempt recovered conservatively');
  appendEvent(state, 'controller', 'stale-exposed-attempt-recovered', { priorEventSha256: events.at(-1).eventSha256, classification: 'infrastructure-error' });
  const preparation = {
    successful: true,
    preparedTreeSha256: repository.preparedTreeSha256,
    treatmentConfigSha256: preparedEvent.payload.treatmentConfigSha256,
    recoveredFromExposureJournal: true,
    commands: [],
  };
  const isolationProof = isolationEvent.payload;
  const bindings = {
    sealRootSha256: seal.rootSha256,
    protocolSha256: sha256Bytes(readFileSync(join(bundleDir, 'protocol.v2.json'))),
    manifestSha256: sha256Bytes(readFileSync(join(bundleDir, 'task-manifest.json'))),
    runnerSha256, clientArtifactSha256: cell.clientArtifactSha256, adapterSha256: cell.adapterSha256,
    requestedModel: cell.requestedModel, resolvedModel: null, modelIdentitySource: cell.modelIdentitySource,
    baseTreeSha256: repository.treeSha256, preparedTreeSha256: repository.preparedTreeSha256,
    treatmentConfigSha256: preparedEvent.payload.treatmentConfigSha256,
  };
  return commitTerminal({
    assignment, task, trialDir, state, status: 'infrastructure-error', startedAt: exposure.timestamp,
    exitCode: null, bindings,
      documents: failureDocuments({ assignment, preparation, isolationProof, clientResult: null, cell }, recoveryError),
    telemetry: missingTelemetry(assignment),
  });
}

async function executeAssignment(assignment) {
  const task = manifest.tasks.find((entry) => entry.id === assignment.taskId);
  const repository = manifest.repositories.find((entry) => entry.id === assignment.repositoryId);
  const cell = protocol.clientModelCells.find((entry) => entry.id === assignment.cellId);
  const trialDir = join(runsRoot, 'trials', assignment.trialId, 'a0');
  const terminalPath = join(trialDir, 'terminal.json');
  if (existsSync(terminalPath)) return null;
  if (existsSync(trialDir)) {
    const partial = join(trialDir, 'events.jsonl');
    if (existsSync(partial)) {
      const recovered = recoverExposedAttempt(assignment, task, repository, cell, trialDir, partial);
      if (recovered) return recovered;
    }
    rmSync(trialDir, { recursive: true, force: true });
  }
  mkdirSync(trialDir, { recursive: true, mode: 0o700 });
  const state = { events: [], eventsPath: join(trialDir, 'events.jsonl'), monotonicStart: performance.now() };
  appendEvent(state, 'controller', 'assignment-leased', { trialId: assignment.trialId, orderIndex: assignment.orderIndex, sealRootSha256: seal.rootSha256 });
  const scratch = mkdtempSync(join(tmpdir(), `bce-eval-${assignment.trialId}-`));
  const workspace = join(scratch, 'workspace');
  const preparedRoot = join(scratch, 'controller-prepared');
  const neutralRoot = join(scratch, 'controller-neutral');
  const clientState = join(scratch, 'client-state');
  const controllerRoot = join(scratch, 'controller-only');
  mkdirSync(controllerRoot, { recursive: true, mode: 0o700 });
  let exposed = false;
  let startedAt = null;
  let treatment = { cli: null, mcp: null, treatmentDelta: { arm: 'baseline-no-bce', changes: [] }, treatmentConfigSha256: sha256Json({ arm: 'baseline-no-bce', changes: [] }) };
  let preparation = null;
  let isolationProof = null;
  let clientResult = null;
  let captured = null;
  let capturedUsage = null;
  try {
    copyTree(resolveInside(bundleDir, repository.treePath, `${repository.id} tree`), workspace);
    if (hashTree(workspace) !== repository.treeSha256) throw new Error('materialized base tree differs from frozen digest');
    detectBceContamination(workspace);
    const setupRuns = repository.setupCommands.map((command) => {
      const result = runCommandSpec(command, workspace, task.budget.timeoutMs);
      return { command, exitCode: result.status, signal: result.signal, stdout: redact(result.stdout), stderr: redact(result.stderr) };
    });
    if (setupRuns.some((entry) => entry.exitCode !== 0)) throw new Error('frozen repository preparation failed before model exposure');
    const preparedTreeSha256 = hashTree(workspace);
    if (preparedTreeSha256 !== repository.preparedTreeSha256) throw new Error('prepared tree differs from frozen preparedTreeSha256');
    preparation = { successful: true, preparedTreeSha256, commands: setupRuns };
    const preparedInventory = treeInventory(workspace);
    const preparedSymlinks = preparedInventory.filter((entry) => entry.type === 'symlink').map((entry) => entry.path);
    if (preparedSymlinks.length) throw new Error(`prepared repository contains refused symbolic links: ${preparedSymlinks.join(', ')}`);
    copyTree(workspace, preparedRoot, { includeNodeModules: true });
    const toolchain = stageToolchain(cell, clientState);
    if (assignment.arm === 'bce-enabled') treatment = materializeTreatment(workspace, task, cell, preparedInventory, toolchain.runtimeExecutable);
    preparation = { ...preparation, treatmentDelta: treatment.treatmentDelta, treatmentConfigSha256: treatment.treatmentConfigSha256 };
    initializeWorkspace(workspace);
    const initialInventory = treeInventory(workspace);
    const globalPolicy = JSON.parse(readFileSync(resolve(bundleDir, protocol.protectedPaths), 'utf8'));
    const protectedPatterns = [...new Set([...globalPolicy.patterns, ...(globalPolicy.packagePolicy?.files ?? []), ...task.protectedPaths])];
    const { env: clientEnv, authPath } = freshClientEnvironment(clientState, cell, toolchain.runtimeExecutable);
    const profile = sandboxProfile(workspace, clientState, controllerRoot, protectedPatterns, cell);
    const execBrokerProfile = cell.client === 'bce-ollama-tool-client'
      ? execBrokerSandboxProfile(workspace, clientState, protectedPatterns)
      : null;
    isolationProof = proveIsolation(profile, controllerRoot, workspace, task, cell, toolchain, clientEnv, authPath, treatment, execBrokerProfile);
    const execBrokerProof = isolationProof.execBroker;
    const execBrokerQualified = cell.client !== 'bce-ollama-tool-client' || (
      execBrokerProof?.driver === cell.toolLoop.execSandbox.driver &&
      execBrokerProof?.driverSha256 === cell.toolLoop.execSandbox.driverSha256 &&
      execBrokerProof?.profileSha256 === sha256Bytes(execBrokerProfile) &&
      execBrokerProof?.workspaceReadWriteAllowed === true && execBrokerProof?.gitDiagnosticAllowed === true && execBrokerProof?.protectedWriteDenied === true &&
      execBrokerProof?.toolchainWriteDenied === true && execBrokerProof?.controllerCanaryReadDenied === true &&
      (!task.referencePatch || execBrokerProof?.referencePatchReadDenied === true) &&
      (!task.shortcutPatch || execBrokerProof?.shortcutPatchReadDenied === true) &&
      execBrokerProof?.processForkDenied === true && execBrokerProof?.providerNetworkDenied === true &&
      execBrokerProof?.externalNetworkDenied === true && execBrokerProof?.wrongLoopbackDenied === true
    );
    if (!isolationProof.oracleReadDenied || !isolationProof.hostCanaryReadDenied || !isolationProof.hostCanaryWriteDenied || !isolationProof.protectedWriteDenied ||
        !isolationProof.workspaceReadWriteAllowed || !isolationProof.stagedRuntimeVersionVerified || !isolationProof.stagedClientVersionVerified || !isolationProof.clientToolchainWriteDenied ||
        (task.referencePatch && isolationProof.referencePatchReadDenied !== true) ||
        (task.shortcutPatch && isolationProof.shortcutPatchReadDenied !== true) ||
        (authPath && isolationProof.authenticationReadableToClientProcess !== true) ||
        (treatment.mcp && (isolationProof.mcpHandshakePassed !== true || isolationProof.mcpDoneCheckAvailable !== true)) || !execBrokerQualified ||
        (cell.localProvider && (isolationProof.authenticationAbsent !== true || isolationProof.providerReachable !== true || isolationProof.externalNetworkDenied !== true || isolationProof.nonProviderLoopbackDenied !== true))) {
      throw new Error(`outer sandbox capability/isolation preflight failed: ${JSON.stringify(isolationProof)}`);
    }
    appendEvent(state, 'controller', 'isolation-proven', isolationProof);
    appendEvent(state, 'controller', 'isolation-prepared', { baseTreeSha256: repository.treeSha256, preparedTreeSha256, arm: assignment.arm, treatmentConfigSha256: treatment.treatmentConfigSha256 });
    if (preflightOnly) {
      rmSync(trialDir, { recursive: true, force: true });
      return { preflightOnly: true, cellId: cell.id, arm: assignment.arm, isolationProof };
    }
    const prompt = `${readFileSync(resolveInside(bundleDir, task.prompt.path, 'task prompt'), 'utf8').trim()}\n\nArchitecture policy (identical in both randomized arms):\n${readFileSync(resolveInside(bundleDir, task.writtenPolicy.path, 'written policy'), 'utf8').trim()}\n\nComplete the task in this repository. Do not edit tests, policy, blueprint, agent configuration, CI, dependencies, or evaluation files.`;
    const command = adapterCommand({
      ...cell,
      executable: toolchain.clientExecutable,
      systemPrompt: toolchain.systemPrompt,
      commonTools: toolchain.commonTools,
    }, workspace, prompt, clientEnv, task, {
      ...treatment,
      runtimeExecutable: toolchain.runtimeExecutable,
    });
    appendEvent(state, 'controller', 'model-request-exposed', { client: cell.client, requestedModel: cell.requestedModel });
    exposed = true;
    controllerAttemptedExposure = true;
    startedAt = new Date().toISOString();
    const visibleStart = performance.now();
    const execBrokerContext = execBrokerProfile ? {
      profile: execBrokerProfile,
      workspace,
      env: clientEnv,
      configuration: cell.toolLoop.execSandbox,
    } : null;
    clientResult = await runClient(command, workspace, profile, task.budget.timeoutMs, authPath, execBrokerContext);
    const stagedToolchainAfterExecution = attestStagedToolchainAfterExecution(cell, toolchain);
    const clientDocuments = jsonDocuments(clientResult.stdout);
    let status = clientResult.timedOut ? 'timeout' : clientResult.status === 0 ? 'completed' :
      clientDocuments.length === 0 || /auth|credential|rate.?limit|overloaded|network|operation not permitted|\bEPERM\b|sandbox-exec|execvp/i.test(`${clientResult.stderr}\n${clientResult.stdout}`) ? 'infrastructure-error' : 'failed';
    if (!clientResult.timedOut && cell.client === 'bce-ollama-tool-client' && (clientResult.status === 2 || clientResult.execBrokerError !== null)) status = 'infrastructure-error';
    let sealedClientEvidence = null;
    let sealedClientEvidenceError = null;
    if (cell.client === 'bce-ollama-tool-client') {
      try { sealedClientEvidence = verifyOllamaClientEvents(clientResult.stdout, { cell, arm: assignment.arm, task, execBrokerEvidence: clientResult.execBrokerEvidence }); }
      catch (error) {
        sealedClientEvidenceError = error instanceof Error ? error.message : String(error);
        status = 'infrastructure-error';
      }
    }
    appendEvent(state, 'client', 'client-terminated', { status, exitCode: clientResult.status, signal: clientResult.signal, latencyMs: clientResult.latencyMs, processGroupTerminated: clientResult.processGroupTerminated, overflow: clientResult.overflow });
    if (seal.attestation?.kind === 'synthetic-self-test' && process.env.BCE_MODEL_EVAL_FAULT_AT === 'hard-crash-after-client') {
      process.kill(process.pid, 'SIGKILL');
    }
    const stdout = redact(clientResult.stdout);
    const stderr = redact(clientResult.stderr);
    capturedUsage = extractUsage(stdout, cell, sealedClientEvidence);
    if (capturedUsage.resolvedModel !== cell.resolvedModel) status = 'infrastructure-error';
    const observedWrites = observedWritePaths(stdout, sealedClientEvidence);
    const finalInventory = treeInventory(workspace);
    const changes = inventoryChanges(initialInventory, finalInventory);
    const changedPaths = changes.map((entry) => entry.path);
    const finalPolicyPaths = changedPaths.filter((entryPath) => matchesAny(entryPath, protectedPatterns));
    const observedPolicyPaths = observedWrites.filter((entryPath) => matchesAny(entryPath, protectedPatterns));
    const outOfScope = changedPaths.filter((entryPath) => !matchesAny(entryPath, task.allowedPaths) && !matchesAny(entryPath, protectedPatterns));
    const mutationObserved = finalPolicyPaths.length > 0 || observedPolicyPaths.length > 0 || outOfScope.length > 0;
    const policy = { assessmentComplete: true, mutationObserved, failClosedForOutcome: mutationObserved, mutation: mutationObserved, finalPolicyPaths, observedWritePaths: observedPolicyPaths, outOfScope, authority: 'controller-before-after-inventory-plus-os-protected-write-denial' };
    captured = {
      transcript: {
        schemaVersion: '1', trialId: assignment.trialId, client: cell.client, stdout, stderr, rawUsage: capturedUsage.raw,
        sealedClientEventVerification: cell.client === 'bce-ollama-tool-client' ? {
          passed: sealedClientEvidence !== null,
          error: sealedClientEvidenceError,
          eventChainHeadSha256: sealedClientEvidence?.eventChainHeadSha256 ?? null,
          execBrokerControllerEvidence: clientResult.execBrokerEvidence,
          execBrokerError: clientResult.execBrokerError,
        } : null,
      },
      patch: { schemaVersion: '1', authority: 'controller-before-after-inventory', changes },
      finalTree: { available: true, agentWorkspaceInventorySha256: sha256Json(finalInventory), changedPaths },
      policy,
      mechanism: extractMechanism(stdout, assignment, sealedClientEvidence, cell),
    };
    isolationProof = {
      ...isolationProof,
      stagedToolchainAfterExecution,
      stagedToolchainIntegrityAfterExecution: stagedToolchainAfterExecution.matched,
    };
    if (!stagedToolchainAfterExecution.matched) throw new Error('staged client/runtime/configuration bytes changed during model execution');
    const providerIdentityAfter = probeLocalProviderIdentity(profile, workspace, cell, toolchain.runtimeExecutable, clientEnv, { requireActiveModel: true });
    isolationProof = {
      ...isolationProof,
      providerIdentityAfter,
      providerIdentityStable: cell.localProvider ? localProviderIdentityStable(isolationProof.providerIdentityBefore, providerIdentityAfter, cell.localProvider) : null,
      clientSessionObserved: clientResult.clientSessionObserved,
      credentialRetiredBeforeModelToolExecution: clientResult.credentialRetiredBeforeModelToolExecution,
      modelToolExecutionObservedBeforeCredentialRetirement: clientResult.modelToolExecutionObservedBeforeCredentialRetirement,
      shellEnvironmentPolicy: cell.client === 'codex' ? 'inherit-none' : 'adapter-specific',
    };
    if (cell.localProvider && isolationProof.providerIdentityStable !== true) throw new Error('local provider identity changed or became unavailable after model execution');
    if (!clientResult.processGroupTerminated) throw new Error('client process group remained alive after termination');
    if (seal.attestation?.kind === 'synthetic-self-test' && process.env.BCE_MODEL_EVAL_FAULT_AT === 'after-client') {
      throw new Error('synthetic fault injection after model exposure');
    }
    const usage = capturedUsage;
    applyAllowedChanges(preparedRoot, workspace, neutralRoot, changes, task.allowedPaths);
    const nonBceStart = performance.now();
    const nonBceRuns = task.visibleCommands.map((commandSpec) => {
      const result = runCommandSpec(commandSpec, neutralRoot, task.budget.timeoutMs);
      return { command: commandSpec, exitCode: result.status, signal: result.signal, stdout: redact(result.stdout), stderr: redact(result.stderr) };
    });
    const nonBcePipelineMs = Math.round(performance.now() - nonBceStart);
    const nonBceAccepted = nonBceRuns.every((entry) => entry.exitCode === 0);
    let bceGateAccepted = null;
    let bceGateMs = null;
    let bceRun = null;
    if (assignment.arm === 'bce-enabled') {
      const bceStart = performance.now();
      const result = run(process.execPath, [treatment.cli, 'gate', '--repo', '.', '--blueprint-dir', '.blueprints'], workspace, { env: minimalControllerEnv(), timeout: task.budget.timeoutMs });
      bceGateMs = Math.round(performance.now() - bceStart);
      bceGateAccepted = result.status === 0;
      bceRun = { command: ['bce', 'gate'], exitCode: result.status, signal: result.signal, stdout: redact(result.stdout), stderr: redact(result.stderr) };
    }
    const endToEndVisibleMs = Math.round(performance.now() - visibleStart);
    const visible = { accepted: nonBceAccepted && (assignment.arm === 'baseline-no-bce' || bceGateAccepted === true), nonBceAccepted, bceGateAccepted, nonBceRuns, bceRun };
    const oracleStart = performance.now();
    if (seal.attestation?.kind === 'synthetic-self-test' && process.env.BCE_MODEL_EVAL_FAULT_AT === 'before-oracle') {
      throw new Error('synthetic fault injection before hidden oracle execution');
    }
    const functional = runOracleTwice(task.functionalOracle, task, neutralRoot, 'functional', controllerRoot);
    const architecture = runOracleTwice(task.architectureOracle, task, neutralRoot, 'architecture', controllerRoot);
    const oracleMs = Math.round(performance.now() - oracleStart);
    appendEvent(state, 'oracle', 'outcomes-derived', { visiblePipelineAccepted: visible.accepted, hiddenFunctionalPassed: functional.passed, independentArchitecturePassed: architecture.passed, policyAssessmentComplete: policy.assessmentComplete, policyMutationObserved: policy.mutationObserved, policyFailClosedForOutcome: policy.failClosedForOutcome, modelIdentityVerified: usage.resolvedModel === cell.resolvedModel && ['provider-response', 'synthetic-response'].includes(cell.modelIdentityEvidence) });
    const telemetryValues = {
      latencyMs: clientResult.latencyMs, nonBcePipelineMs, bceGateMs, endToEndVisibleMs, oracleMs,
      agentTurns: usage.agentTurns, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens, costUsd: usage.costUsd,
    };
    const missingReasons = {};
    for (const [key, value] of Object.entries(telemetryValues)) if (value === null) missingReasons[key] = key === 'bceGateMs' && assignment.arm === 'baseline-no-bce' ? 'baseline arm has no BCE gate' : `${cell.client} did not expose a trustworthy ${key}`;
    const telemetry = { ...telemetryValues, missingReasons };
    const bindings = {
      sealRootSha256: seal.rootSha256,
      protocolSha256: sha256Bytes(readFileSync(join(bundleDir, 'protocol.v2.json'))),
      manifestSha256: sha256Bytes(readFileSync(join(bundleDir, 'task-manifest.json'))),
      runnerSha256, clientArtifactSha256: cell.clientArtifactSha256, adapterSha256: cell.adapterSha256,
      requestedModel: cell.requestedModel, resolvedModel: usage.resolvedModel, modelIdentitySource: cell.modelIdentitySource,
      baseTreeSha256: repository.treeSha256, preparedTreeSha256: repository.preparedTreeSha256,
      treatmentConfigSha256: treatment.treatmentConfigSha256,
    };
    const documents = {
      transcript: captured.transcript,
      patch: captured.patch,
      finalTree: { ...captured.finalTree, neutralTreeSha256: hashTree(neutralRoot), agentWorkspaceTreeSha256: hashTree(workspace) },
      preparation,
      isolationProof, visible, functional, architecture, policy,
      mechanism: captured.mechanism,
    };
    return commitTerminal({ assignment, task, trialDir, state, status, startedAt, exitCode: clientResult.status, bindings, documents, telemetry });
  } catch (error) {
    if (!exposed) throw error;
    appendEvent(state, 'controller', 'post-exposure-failure-retained', { error: redact(error instanceof Error ? error.message : String(error)) });
    const bindings = {
      sealRootSha256: seal.rootSha256,
      protocolSha256: sha256Bytes(readFileSync(join(bundleDir, 'protocol.v2.json'))),
      manifestSha256: sha256Bytes(readFileSync(join(bundleDir, 'task-manifest.json'))),
      runnerSha256, clientArtifactSha256: cell.clientArtifactSha256, adapterSha256: cell.adapterSha256,
      requestedModel: cell.requestedModel, resolvedModel: capturedUsage?.resolvedModel ?? null, modelIdentitySource: cell.modelIdentitySource,
      baseTreeSha256: repository.treeSha256, preparedTreeSha256: repository.preparedTreeSha256,
      treatmentConfigSha256: treatment.treatmentConfigSha256,
    };
    const documents = failureDocuments({ assignment, preparation, isolationProof, clientResult, captured, cell }, error);
    return commitTerminal({
      assignment, task, trialDir, state, status: 'infrastructure-error', startedAt,
      exitCode: clientResult?.status ?? null, bindings, documents, telemetry: missingTelemetry(assignment, clientResult?.latencyMs ?? null, capturedUsage),
    });
  } finally {
    // APFS can report a transient ENOTEMPTY while a just-exited sandboxed git
    // process releases directory entries. Retry only this mkdtemp-owned tree;
    // never turn a cleanup race into a lost terminal record or an unbounded delete.
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

function readLedger() {
  const path = join(runsRoot, 'ledger.jsonl');
  if (!existsSync(path)) return [];
  const rows = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  let previous = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const assignment = manifest.assignments[index];
    if (!assignment || row.sequence !== index || row.orderIndex !== index || row.trialId !== assignment.trialId || row.previousEntrySha256 !== previous || row.entrySha256 !== sha256Json({ ...row, entrySha256: null })) throw new Error(`ledger is not an intact prefix of the frozen assignment order at sequence ${index}`);
    previous = row.entrySha256;
  }
  return rows;
}

function reconcileTerminalWithoutLedger() {
  let ledger = readLedger();
  while (ledger.length < manifest.assignments.length) {
    const assignment = manifest.assignments[ledger.length];
    const terminalPath = join(runsRoot, 'trials', assignment.trialId, 'a0', 'terminal.json');
    if (!existsSync(terminalPath)) break;
    const terminal = JSON.parse(readFileSync(terminalPath, 'utf8'));
    verifyTerminalRecord(terminal, { bundle: verified, runsRoot, terminalPath: relative(runsRoot, terminalPath) });
    appendLedger(terminal);
    ledger = readLedger();
  }
  return ledger;
}

function materializeStudyHalt(records, ledger) {
  const path = join(runsRoot, 'study-halt.json');
  const ledgerBytes = readFileSync(join(runsRoot, 'ledger.jsonl'));
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, 'utf8'));
    return verifyStudyHaltV2(existing, verified, records, ledgerBytes, ledger);
  }
  const halt = makeStudyHaltV2(verified, records, ledgerBytes, ledger);
  writeAtomic(path, `${JSON.stringify(halt, null, 2)}\n`);
  return halt;
}

try {
  verifyRuntimeIdentity();
  for (const cell of protocol.clientModelCells) verifyClientIdentity(cell);
  if (preflightOnly) {
    const reports = [];
    for (const cell of protocol.clientModelCells) {
      for (const arm of protocol.arms) {
        const assignment = manifest.assignments.find((entry) => entry.cellId === cell.id && entry.arm === arm);
        if (!assignment) throw new Error(`${cell.id}/${arm}: no representative assignment for preflight`);
        reports.push(await executeAssignment(assignment));
      }
    }
    process.stdout.write(`${JSON.stringify({ preflight: 'passed-without-model-exposure', reports })}\n`);
  } else {
    let ledger = reconcileTerminalWithoutLedger();
    const records = ledger.map((entry) => JSON.parse(readFileSync(join(runsRoot, 'trials', entry.trialId, 'a0', 'terminal.json'), 'utf8')));
    const existingHalt = stoppingHaltTrigger(records, protocol);
    if (existsSync(join(runsRoot, 'study-halt.json')) && !existingHalt) {
      throw new Error('study-halt.json conflicts with the committed ledger and frozen stopping rules');
    }
    if (existingHalt) {
      const halt = materializeStudyHalt(records, ledger);
      process.stderr.write(`model-evaluation controller safety halt: ${halt.trigger.reason}\n`);
      process.exitCode = 3;
    }
    let executed = 0;
    while (!existingHalt && ledger.length < manifest.assignments.length && executed < limit) {
      const assignment = manifest.assignments[ledger.length];
      const record = await executeAssignment(assignment);
      if (!record) throw new Error(`${assignment.trialId}: next frozen assignment was unexpectedly already terminal without reconciliation`);
      executed += 1;
      ledger = readLedger();
      records.push(record);
      const trigger = stoppingHaltTrigger(records, protocol);
      if (trigger) {
        const halt = materializeStudyHalt(records, ledger);
        process.stderr.write(`model-evaluation controller safety halt: ${halt.trigger.reason}\n`);
        process.exitCode = 3;
        break;
      }
    }
    process.stdout.write(`model-evaluation controller: ${executed} new primary attempt(s); ${ledger.length}/${manifest.assignments.length} frozen assignments committed\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  const expectedPreExposureRefusal = !controllerAttemptedExposure && /runtime (?:executable|version|artifact)|client (?:executable|version)|outer sandbox capability\/isolation preflight|execution isolation|host runtime|unavailable|no sealed adapter/i.test(message);
  process.stderr.write(`${expectedPreExposureRefusal ? 'execution refused before model exposure' : 'model-evaluation controller integrity failure'}: ${redact(message)}\n`);
  process.exitCode = expectedPreExposureRefusal ? 2 : 1;
} finally {
  closeSync(lockFd);
  if (existsSync(lockPath)) unlinkSync(lockPath);
}
