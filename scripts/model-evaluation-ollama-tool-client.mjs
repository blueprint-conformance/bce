#!/usr/bin/env node
/** Dependency-free, content-addressed Ollama tool loop for sealed BCE evaluations. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { Socket } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';

const VERSION = 'bce-ollama-tool-client 1.0.0';
const EVENT_PROTOCOL = 'bce-ollama-tool-client-events/v1';
const MAX_FILE_BYTES = 262144;
const MAX_TOOL_OUTPUT_BYTES = 32768;
const COMMAND_TIMEOUT_MS = 120000;
const PROVIDER_TIMEOUT_MS = 180000;
const MCP_SHUTDOWN_TIMEOUT_MS = 2000;
if (process.argv.includes('--version')) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1] ?? null;
};
const endpoint = valueAfter('--endpoint');
const model = valueAfter('--model');
const prompt = valueAfter('--prompt');
const reasoningEffort = valueAfter('--reasoning-effort') ?? 'low';
const maxTurns = Number(valueAfter('--max-turns') ?? '12');
const systemPromptPath = valueAfter('--system-prompt');
const commonToolsPath = valueAfter('--common-tools');
const temperature = Number(valueAfter('--temperature') ?? '0');
const seed = Number(valueAfter('--seed') ?? '424242');
const numCtx = Number(valueAfter('--num-ctx') ?? '32768');
const keepAlive = valueAfter('--keep-alive') ?? '10m';
const execBrokerConfigurationText = valueAfter('--exec-broker-config');
const mcpRuntime = valueAfter('--mcp-runtime');
const mcpServer = valueAfter('--mcp-server');
const expectedMcpToolSha256 = valueAfter('--mcp-tool-sha256');
if (!endpoint || !model || !prompt || !systemPromptPath || !commonToolsPath || !execBrokerConfigurationText ||
    !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 64 ||
    !['low', 'medium', 'high'].includes(reasoningEffort) ||
    !Number.isFinite(temperature) || !Number.isInteger(seed) || !Number.isInteger(numCtx) || numCtx < 1024 ||
    Boolean(mcpRuntime) !== Boolean(mcpServer) || Boolean(mcpServer) !== Boolean(expectedMcpToolSha256) ||
    (expectedMcpToolSha256 && !/^[0-9a-f]{64}$/.test(expectedMcpToolSha256))) {
  process.stderr.write('usage: model-evaluation-ollama-tool-client --endpoint URL --model NAME --prompt TEXT --system-prompt FILE --common-tools FILE --exec-broker-config JSON --reasoning-effort low|medium|high --max-turns N --temperature N --seed N --num-ctx N --keep-alive VALUE [--mcp-runtime NODE --mcp-server FILE --mcp-tool-sha256 DIGEST]\n');
  process.exit(2);
}

const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalJson = (value) => JSON.stringify(canonical(value));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sha256Json = (value) => sha256(canonicalJson(value));
const clipped = (value, maximum = MAX_TOOL_OUTPUT_BYTES) => String(value ?? '').slice(0, maximum);
const workspace = resolve(process.cwd());
const safeEnvironment = () => Object.fromEntries(
  ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]),
);
let execSandbox;
try { execSandbox = JSON.parse(execBrokerConfigurationText); }
catch { process.stderr.write('Ollama tool client received invalid exec broker configuration\n'); process.exit(2); }
if (canonicalJson(Object.keys(execSandbox).sort()) !== canonicalJson(['driver', 'driverSha256', 'filesystemPolicy', 'networkPolicy', 'processPolicy']) ||
    execSandbox.driver !== '/usr/bin/sandbox-exec' || !/^[0-9a-f]{64}$/.test(execSandbox.driverSha256 ?? '') ||
    execSandbox.networkPolicy !== 'deny-all' || execSandbox.processPolicy !== 'deny-fork' ||
    execSandbox.filesystemPolicy !== 'controller-read-default-deny-workspace-write-protected-roots-denied') {
  process.stderr.write('Ollama tool client received unsupported exec broker configuration\n');
  process.exit(2);
}

let sequence = 0;
let previousEventSha256 = null;
let nextMcpRequestId = 1;
function emit(type, payload) {
  const event = {
    schemaVersion: '1', protocol: EVENT_PROTOCOL, sequence, previousEventSha256, type, payload, eventSha256: null,
  };
  event.eventSha256 = sha256Json(event);
  process.stdout.write(`${JSON.stringify(event)}\n`);
  previousEventSha256 = event.eventSha256;
  sequence += 1;
  return event;
}

function safePath(relativePath, { mustExist = false } = {}) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || relativePath.includes('\0') ||
      relativePath.startsWith('/') || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error('path must be non-empty, repository-relative, and traversal-free');
  }
  const target = resolve(workspace, relativePath);
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`)) throw new Error('path escapes the workspace');
  let cursor = workspace;
  const segments = target.slice(workspace.length).split(sep).filter(Boolean);
  for (const segment of segments.slice(0, -1)) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) throw new Error('parent directory does not exist');
    if (lstatSync(cursor).isSymbolicLink()) throw new Error('symbolic-link parent is refused');
    if (!lstatSync(cursor).isDirectory()) throw new Error('parent is not a directory');
  }
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error('symbolic-link target is refused');
  if (mustExist && !existsSync(target)) throw new Error('file does not exist');
  if (existsSync(target) && !lstatSync(target).isFile()) throw new Error('target is not a regular file');
  return target;
}

function readFile(relativePath) {
  const target = safePath(relativePath, { mustExist: true });
  const bytes = readFileSync(target);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`file exceeds ${MAX_FILE_BYTES} byte limit`);
  return { path: relativePath, content: bytes.toString('utf8'), bytes: bytes.byteLength, sha256: sha256(bytes) };
}

function writeFileAtomic(relativePath, content) {
  if (typeof content !== 'string') throw new Error('content must be a string');
  const bytes = Buffer.from(content);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`content exceeds ${MAX_FILE_BYTES} byte limit`);
  const target = safePath(relativePath);
  const temporary = join(dirname(target), `.bce-client-write-${process.pid}-${sequence}.tmp`);
  let descriptor = null;
  try {
    descriptor = openSync(temporary, 'wx', 0o600);
    writeFileSync(descriptor, bytes);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, target);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

let nextBrokerRequestId = 1;
const brokerPending = new Map();
let brokerBuffer = '';
const brokerInput = new Socket({ fd: 4, readable: true, writable: false });
brokerInput.unref();
brokerInput.on('data', (chunk) => {
  brokerBuffer += chunk.toString();
  const lines = brokerBuffer.split('\n');
  brokerBuffer = lines.pop() ?? '';
  for (const line of lines.filter((value) => value.trim())) {
    let response;
    try { response = JSON.parse(line); }
    catch {
      for (const waiter of brokerPending.values()) waiter.reject(new Error('exec broker emitted non-JSON response'));
      brokerPending.clear();
      continue;
    }
    const waiter = brokerPending.get(response?.id);
    if (!waiter) continue;
    brokerPending.delete(response.id);
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  }
});
brokerInput.on('error', (error) => {
  for (const waiter of brokerPending.values()) waiter.reject(error);
  brokerPending.clear();
});

async function brokerExec(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > 32 || argv.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 4096)) {
    throw new Error('argv must contain 1..32 non-empty strings of at most 4096 characters');
  }
  const id = nextBrokerRequestId++;
  const request = { schemaVersion: '1', id, kind: 'exec', argv };
  emit('broker.request', { request, requestSha256: sha256Json(request) });
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const timer = setTimeout(() => {
      brokerPending.delete(id);
      rejectResponse(new Error(`exec broker request ${id} timed out`));
    }, COMMAND_TIMEOUT_MS + 5000);
    brokerPending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer });
    try { writeSync(3, `${JSON.stringify(request)}\n`); }
    catch (error) {
      clearTimeout(timer);
      brokerPending.delete(id);
      rejectResponse(error);
    }
  });
  if (!response || response.schemaVersion !== '1' || response.id !== id || response.kind !== 'exec-result' ||
      response.requestSha256 !== sha256Json(request) || canonicalJson(response.result?.execSandbox) !== canonicalJson(execSandbox) ||
      !/^[0-9a-f]{64}$/.test(response.result?.sandboxProfileSha256 ?? '')) {
    throw new Error('exec broker response did not bind the exact request and sealed sandbox');
  }
  emit('broker.response', { response, responseSha256: sha256Json(response) });
  return response.result;
}

function parseCommonTools(path) {
  const document = JSON.parse(readFileSync(path, 'utf8'));
  const names = Array.isArray(document) ? document.map((tool) => tool?.function?.name) : [];
  if (canonicalJson(names) !== canonicalJson(['read_file', 'write_file', 'exec'])) throw new Error('common tool manifest has wrong tool names or order');
  return document;
}

function mcpRunGateTool() {
  return {
    type: 'function',
    function: {
      name: 'run_gate',
      description: 'Call the real BCE MCP run_gate done-check for the current repository after making changes.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  };
}

async function mcpRunGate(dispatchId, args) {
  const child = spawn(mcpRuntime, [mcpServer], {
    cwd: workspace, env: safeEnvironment(), detached: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  let stderr = '';
  const pending = new Map();
  let protocolFailure = null;
  let childClosed = false;
  let shutdownRequested = false;
  let protocolCompleted = false;
  let closeStatus = null;
  let resolveClosed;
  const closed = new Promise((resolveClose) => { resolveClosed = resolveClose; });
  const failProtocol = (error) => {
    if (protocolFailure === null) protocolFailure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(protocolFailure);
    }
    pending.clear();
  };
  const settleResponse = (message) => {
    if (!message || message.jsonrpc !== '2.0' || (!Number.isInteger(message.id) && typeof message.id !== 'string')) {
      failProtocol(new Error('MCP emitted an invalid JSON-RPC response'));
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) {
      failProtocol(new Error(`MCP emitted an unmatched response id ${String(message.id)}`));
      return;
    }
    pending.delete(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  };
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((value) => value.trim())) {
      try { settleResponse(JSON.parse(line)); }
      catch { failProtocol(new Error('MCP emitted non-JSON stdout')); }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = clipped(`${stderr}${chunk.toString()}`, 8192); });
  child.once('error', (error) => failProtocol(new Error(`MCP process error: ${error.message}`)));
  child.once('close', (code, signal) => {
    childClosed = true;
    closeStatus = { code, signal };
    if (!shutdownRequested) failProtocol(new Error(`MCP process closed before controlled shutdown (code=${String(code)}, signal=${String(signal)})`));
    resolveClosed();
  });
  const request = async (method, params, eventDispatchId = null) => {
    if (protocolFailure) throw protocolFailure;
    if (childClosed) throw new Error('MCP process is already closed');
    const id = nextMcpRequestId++;
    const message = { jsonrpc: '2.0', id, method, params };
    emit('mcp.request', { dispatchId: eventDispatchId, request: message });
    const response = await new Promise((resolveResponse, rejectResponse) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectResponse(new Error(`MCP request ${id} timed out`));
      }, COMMAND_TIMEOUT_MS);
      pending.set(id, { resolve: resolveResponse, reject: rejectResponse, timer });
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectResponse(error);
        }
      });
    });
    emit('mcp.response', { dispatchId: eventDispatchId, response });
    if (response.id !== id) throw new Error(`MCP response id ${String(response.id)} did not match request ${id}`);
    if (response.error) throw new Error(`MCP ${method} returned JSON-RPC error: ${clipped(JSON.stringify(response.error), 4096)}`);
    return response.result;
  };
  try {
    await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bce-ollama-tool-client', version: '1.0.0' } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
    const listed = await request('tools/list', {});
    const runGateTools = Array.isArray(listed?.tools) ? listed.tools.filter((entry) => entry?.name === 'run_gate') : [];
    if (runGateTools.length !== 1 || sha256Json(runGateTools[0]) !== expectedMcpToolSha256) throw new Error('MCP run_gate contract differs from the sealed digest or is ambiguous');
    const result = await request('tools/call', { name: 'run_gate', arguments: args }, dispatchId);
    if (!result || result.isError !== false || typeof result.structuredContent?.gateFailed !== 'boolean') throw new Error(`MCP run_gate returned an invalid or non-verdict result: ${clipped(JSON.stringify(result), 4096)}`);
    protocolCompleted = true;
    return result;
  } finally {
    shutdownRequested = true;
    try { child.stdin.end(); } catch {}
    const closedGracefully = childClosed || await Promise.race([
      closed.then(() => true),
      new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), MCP_SHUTDOWN_TIMEOUT_MS)),
    ]);
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('MCP request cancelled during controlled shutdown'));
    }
    pending.clear();
    if (protocolFailure) throw protocolFailure;
    if (!protocolCompleted) throw new Error('MCP exchange did not reach a verified run_gate result');
    if (!closedGracefully) throw new Error('MCP process did not close after its input stream ended');
    if (closeStatus?.code !== null && closeStatus?.code !== 0) throw new Error(`MCP process failed: ${stderr || `exit ${closeStatus.code}`}`);
  }
}

const systemPrompt = readFileSync(systemPromptPath, 'utf8').trim();
const commonTools = parseCommonTools(commonToolsPath);
const tools = mcpServer ? [...commonTools, mcpRunGateTool()] : commonTools;
const projectInstructions = existsSync(join(workspace, 'AGENTS.md')) ? readFileSync(join(workspace, 'AGENTS.md'), 'utf8') : '';
const messages = [
  { role: 'system', content: [systemPrompt, projectInstructions ? `Project instructions:\n${projectInstructions}` : ''].filter(Boolean).join('\n\n') },
  { role: 'user', content: prompt },
];
const options = { stream: false, think: reasoningEffort, keep_alive: keepAlive, options: { temperature, seed, num_ctx: numCtx } };
let inputTokens = 0;
let outputTokens = 0;
let providerRequests = 0;
let malformedToolCalls = 0;

emit('session.started', {
  clientVersion: VERSION, requestedModel: model, mcpEnabled: Boolean(mcpServer),
  systemPromptSha256: sha256(readFileSync(systemPromptPath)), commonToolContractSha256: sha256(readFileSync(commonToolsPath)),
  options, execSandbox, limits: { maxTurns, maxFileBytes: MAX_FILE_BYTES, maxToolOutputBytes: MAX_TOOL_OUTPUT_BYTES, commandTimeoutMs: COMMAND_TIMEOUT_MS, providerTimeoutMs: PROVIDER_TIMEOUT_MS },
});
try {
  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const body = { model, messages, tools, ...options };
    emit('provider.request', { turn, requestSha256: sha256Json(body), offeredToolNames: tools.map((tool) => tool.function.name) });
    providerRequests += 1;
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Ollama chat returned HTTP ${response.status}: ${clipped(await response.text(), 4096)}`);
    const document = await response.json();
    if (document.model !== model || !document.message || document.message.role !== 'assistant') {
      throw new Error('Ollama chat response did not bind the requested model and assistant message');
    }
    inputTokens += Number.isInteger(document.prompt_eval_count) ? document.prompt_eval_count : 0;
    outputTokens += Number.isInteger(document.eval_count) ? document.eval_count : 0;
    emit('provider.response', {
      turn, responseSha256: sha256Json(document), model: document.model,
      promptEvalCount: Number.isInteger(document.prompt_eval_count) ? document.prompt_eval_count : null,
      evalCount: Number.isInteger(document.eval_count) ? document.eval_count : null,
      assistant: { content: clipped(document.message.content), thinking: clipped(document.message.thinking), toolCalls: document.message.tool_calls ?? [] },
    });
    messages.push(document.message);
    const calls = Array.isArray(document.message.tool_calls) ? document.message.tool_calls : [];
    if (calls.length === 0) {
      emit('session.completed', { reason: 'assistant-finished', turns: turn, providerRequests, inputTokens, outputTokens, cachedTokens: 0, malformedToolCalls, model });
      process.exit(0);
    }
    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const call = calls[callIndex];
      const dispatchId = `turn-${turn}-call-${callIndex + 1}`;
      const name = call?.function?.name;
      const args = call?.function?.arguments;
      try {
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('tool arguments must be an object');
        if (!tools.some((tool) => tool.function.name === name)) throw new Error(`unknown or unavailable tool: ${String(name)}`);
        if (name === 'read_file' && canonicalJson(Object.keys(args).sort()) !== canonicalJson(['path'])) throw new Error('read_file requires exactly {path}');
        if (name === 'write_file' && canonicalJson(Object.keys(args).sort()) !== canonicalJson(['content', 'path'])) throw new Error('write_file requires exactly {path,content}');
        if (name === 'exec' && (canonicalJson(Object.keys(args).sort()) !== canonicalJson(['argv']) || !Array.isArray(args.argv) || args.argv.length < 1 || args.argv.length > 32 || args.argv.some((value) => typeof value !== 'string' || value.length === 0 || value.length > 4096))) throw new Error('exec requires exactly {argv} with 1..32 non-empty strings of at most 4096 characters');
        if (name === 'run_gate' && canonicalJson(args) !== '{}') throw new Error('run_gate requires exactly {}');
      } catch (error) {
        malformedToolCalls += 1;
        const message = error instanceof Error ? error.message : String(error);
        emit('tool.rejected', { turn, dispatchId, name: typeof name === 'string' ? name : null, reason: clipped(message, 4096) });
        messages.push({ role: 'tool', tool_name: typeof name === 'string' ? name : 'unknown', content: JSON.stringify({ error: message }) });
        continue;
      }
      emit('tool.dispatch', { turn, dispatchId, name, arguments: args, argumentsSha256: sha256Json(args) });
      try {
        let result;
        if (name === 'read_file') result = readFile(args.path);
        else if (name === 'write_file') result = writeFileAtomic(args.path, args.content);
        else if (name === 'exec') result = await brokerExec(args.argv);
        else result = await mcpRunGate(dispatchId, args);
        const ok = name === 'exec'
          ? result.exitCode === 0 && !result.timedOut && !result.overflow && result.processGroupTerminated === true
          : true;
        emit('tool.result', { turn, dispatchId, name, ok, result });
        messages.push({ role: 'tool', tool_name: name, content: clipped(JSON.stringify(result)) });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const result = { error: clipped(message, 4096) };
        emit('tool.result', { turn, dispatchId, name, ok: false, result });
        messages.push({ role: 'tool', tool_name: name, content: JSON.stringify(result) });
      }
    }
  }
  emit('session.completed', { reason: 'turn-limit', turns: maxTurns, providerRequests, inputTokens, outputTokens, cachedTokens: 0, malformedToolCalls, model });
  process.exit(3);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  emit('client.error', { class: 'provider-or-apparatus', message: clipped(message, 4096) });
  process.stderr.write(`Ollama tool client provider failure: ${message}\n`);
  process.exit(2);
}
