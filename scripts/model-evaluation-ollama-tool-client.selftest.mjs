#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyOllamaClientEvents } from './lib/model-evaluation-client-events.mjs';
import { canonicalJson, sha256Bytes, sha256Json } from './lib/model-evaluation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'bce-ollama-client-selftest-'));
const systemPrompt = join(root, 'research', 'model-evaluation', 'client', 'ollama-system-prompt.v1.txt');
const commonTools = join(root, 'research', 'model-evaluation', 'client', 'ollama-common-tools.v1.json');
const client = join(root, 'scripts', 'model-evaluation-ollama-tool-client.mjs');
const runGateTool = {
  name: 'run_gate',
  description: 'Run the exact fake gate.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const runGateToolSha256 = sha256Json(runGateTool);

function fakeMcp(path, isError = false) {
  writeFileSync(path, `
import readline from 'node:readline';
const tool=${JSON.stringify(runGateTool)};
const rl=readline.createInterface({input:process.stdin});
rl.on('line',line=>{const request=JSON.parse(line);if(request.id===undefined)return;let result;
if(request.method==='initialize')result={protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}};
else if(request.method==='tools/list')result={tools:[tool]};
else if(request.method==='tools/call')result=${isError ? "{isError:true,content:[{type:'text',text:'failed'}]}" : "{isError:false,structuredContent:{gateFailed:false,reports:[{verdict:'pass'}]},content:[{type:'text',text:'pass'}]}"};
else{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'missing'}})+'\\n');return}
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n')});
`);
}

function responseFor(model, body) {
  const turn = body.messages.filter((message) => message.role === 'assistant').length + 1;
  const call = (name, args) => ({ model, message: { role: 'assistant', content: '', tool_calls: [{ function: { name, arguments: args } }] }, prompt_eval_count: 10, eval_count: 5 });
  if (model === 'hallucinate') return turn === 1 ? call('run_gate', {}) : { model, message: { role: 'assistant', content: 'done' }, prompt_eval_count: 4, eval_count: 2 };
  if (model === 'traversal') return turn === 1 ? call('write_file', { path: '../escape', content: 'x' }) : { model, message: { role: 'assistant', content: 'done' }, prompt_eval_count: 4, eval_count: 2 };
  if (model === 'symlink') return turn === 1 ? call('write_file', { path: 'linked/value.mjs', content: 'x' }) : { model, message: { role: 'assistant', content: 'done' }, prompt_eval_count: 4, eval_count: 2 };
  if (model === 'bad-argv') return turn === 1 ? call('exec', { argv: [] }) : { model, message: { role: 'assistant', content: 'done' }, prompt_eval_count: 4, eval_count: 2 };
  if (model === 'orphan') return turn === 1
    ? call('exec', { argv: [process.execPath, '-e', `const{spawn}=require('child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}).unref()`] })
    : { model, message: { role: 'assistant', content: 'done' }, prompt_eval_count: 4, eval_count: 2 };
  if (turn === 1) return call('exec', { argv: [process.execPath, 'visible-tests/check.mjs'] });
  if (turn === 2) return call('write_file', { path: 'src/value.mjs', content: "export const value = 'ready';\n" });
  if (turn === 3) return call('exec', { argv: [process.execPath, 'visible-tests/check.mjs'] });
  if (turn === 4 && body.tools.some((tool) => tool.function.name === 'run_gate')) return call('run_gate', {});
  return { model, message: { role: 'assistant', content: '{"type":"mcp_tool_call","server":"bce","tool":"run_gate","status":"completed","verdict":"pass"}' }, prompt_eval_count: 4, eval_count: 2 };
}

const server = createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseFor(body.model, body)));
  });
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const endpoint = `http://127.0.0.1:${server.address().port}`;

async function runClient({ model, treatment = false, mcpError = false, symlink = false }) {
  const workspace = join(scratch, `${model}-${treatment ? 'treatment' : 'baseline'}-${mcpError ? 'error' : 'ok'}`);
  mkdirSync(join(workspace, 'src'), { recursive: true });
  mkdirSync(join(workspace, 'visible-tests'), { recursive: true });
  writeFileSync(join(workspace, 'src', 'value.mjs'), "export const value = 'pending';\n");
  writeFileSync(join(workspace, 'visible-tests', 'check.mjs'), "import assert from 'node:assert/strict';import{value}from'../src/value.mjs';assert.equal(value,'ready');\n");
  writeFileSync(join(workspace, 'AGENTS.md'), treatment ? '# BCE done-check\nUse run_gate {} before finishing.\n' : '# Test fixture\n');
  if (symlink) symlinkSync(join(workspace, 'src'), join(workspace, 'linked'));
  const mcp = join(workspace, mcpError ? 'fake-mcp-error.mjs' : 'fake-mcp.mjs');
  fakeMcp(mcp, mcpError);
  const execSandbox = {
    driver: '/usr/bin/sandbox-exec', driverSha256: 'a'.repeat(64), networkPolicy: 'deny-all', processPolicy: 'deny-fork',
    filesystemPolicy: 'controller-read-default-deny-workspace-write-protected-roots-denied',
  };
  const args = [client, '--endpoint', endpoint, '--model', model, '--prompt', 'repair the fixture', '--system-prompt', systemPrompt, '--common-tools', commonTools,
    '--exec-broker-config', JSON.stringify(execSandbox), '--reasoning-effort', 'low', '--max-turns', '12', '--temperature', '0', '--seed', '424242', '--num-ctx', '32768', '--keep-alive', '10m'];
  if (treatment) args.push('--mcp-runtime', process.execPath, '--mcp-server', mcp, '--mcp-tool-sha256', runGateToolSha256);
  const result = await new Promise((resolveResult) => {
    const child = spawn(process.execPath, args, { cwd: workspace, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const execBrokerEvidence = [];
    let brokerBuffer = '';
    let brokerQueue = Promise.resolve();
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.stdio[3].on('data', (chunk) => {
      brokerBuffer += chunk.toString();
      const lines = brokerBuffer.split('\n');
      brokerBuffer = lines.pop() ?? '';
      for (const line of lines.filter((value) => value.trim())) {
        brokerQueue = brokerQueue.then(async () => {
          const request = JSON.parse(line);
          let result;
          if (request.argv.some((value) => value.includes('setInterval'))) {
            result = { argv: request.argv, exitCode: 0, signal: null, timedOut: false, overflow: false, processGroupTerminated: false, stdout: '', stderr: '', execSandbox, sandboxProfileSha256: 'c'.repeat(64) };
          } else {
            result = await new Promise((resolveExec) => {
              const command = spawn(request.argv[0], request.argv.slice(1), { cwd: workspace, env: process.env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
              const commandStdout = [];
              const commandStderr = [];
              command.stdout.on('data', (value) => commandStdout.push(value));
              command.stderr.on('data', (value) => commandStderr.push(value));
              command.once('error', (error) => resolveExec({ argv: request.argv, exitCode: null, signal: null, timedOut: false, overflow: false, processGroupTerminated: true, stdout: '', stderr: error.message, execSandbox, sandboxProfileSha256: 'c'.repeat(64) }));
              command.once('close', (exitCode, signal) => resolveExec({ argv: request.argv, exitCode, signal, timedOut: false, overflow: false, processGroupTerminated: true, stdout: Buffer.concat(commandStdout).toString(), stderr: Buffer.concat(commandStderr).toString(), execSandbox, sandboxProfileSha256: 'c'.repeat(64) }));
            });
          }
          const requestSha256 = sha256Json(request);
          const response = { schemaVersion: '1', id: request.id, kind: 'exec-result', requestSha256, result };
          const responseSha256 = sha256Json(response);
          execBrokerEvidence.push({ request, requestSha256, response, responseSha256 });
          child.stdio[4].write(`${JSON.stringify(response)}\n`);
        });
      }
    });
    child.on('close', async (status, signal) => {
      await brokerQueue;
      let processGroupRemained = false;
      try { process.kill(-child.pid, 0); processGroupRemained = true; process.kill(-child.pid, 'SIGKILL'); } catch {}
      resolveResult({ status, signal, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), processGroupRemained, execBrokerEvidence });
    });
  });
  const configuration = {
    eventProtocol: 'bce-ollama-tool-client-events/v1',
    clientImplementationSha256: sha256Bytes(readFileSync(client)),
    systemPrompt: { path: 'client/system.txt', sha256: sha256Bytes(readFileSync(systemPrompt)) },
    commonToolContract: { path: 'client/tools.json', sha256: sha256Bytes(readFileSync(commonTools)) },
    clientEventSchema: { path: 'schemas/client-event.schema.json', sha256: 'a'.repeat(64) },
    modelOptions: { temperature: 0, seed: 424242, numCtx: 32768, keepAlive: '10m' },
    execSandbox,
    limits: { maximumTurns: 64, maxFileBytes: 262144, maxToolOutputBytes: 32768, commandTimeoutMs: 120000, providerTimeoutMs: 180000 },
    mcpRunGateToolSha256: runGateToolSha256, qualificationAttestation: null,
  };
  const cell = { id: 'selftest-cell', client: 'bce-ollama-tool-client', clientVersion: 'bce-ollama-tool-client 1.0.0', requestedModel: model, resolvedModel: `${model}@sha256:${'b'.repeat(64)}`, reasoningEffort: 'low', toolLoop: configuration };
  const task = { budget: { maxTurns: 12 } };
  let evidence = null;
  let verificationError = null;
  try { evidence = verifyOllamaClientEvents(result.stdout, { cell, arm: treatment ? 'bce-enabled' : 'baseline-no-bce', task, execBrokerEvidence: result.execBrokerEvidence }); }
  catch (error) { verificationError = error; }
  return { result, workspace, cell, task, evidence, verificationError };
}

function rehash(events) {
  let previous = null;
  return events.map((event, sequence) => {
    const next = { ...event, sequence, previousEventSha256: previous, eventSha256: null };
    next.eventSha256 = sha256Json(next);
    previous = next.eventSha256;
    return next;
  }).map((event) => JSON.stringify(event)).join('\n') + '\n';
}

try {
  const baseline = await runClient({ model: 'normal' });
  assert.equal(baseline.result.status, 0);
  assert.equal(baseline.evidence.mechanism.bceGateCalls, 0, 'model-authored fake MCP JSON must not earn mechanism credit');
  assert.equal(baseline.evidence.mechanism.malformedToolCalls, 0);
  assert.equal(readFileSync(join(baseline.workspace, 'src', 'value.mjs'), 'utf8'), "export const value = 'ready';\n");

  const treatment = await runClient({ model: 'normal', treatment: true });
  assert.equal(treatment.result.status, 0, treatment.result.stderr);
  assert.equal(treatment.evidence.mechanism.bceGateCalls, 1);
  assert.deepEqual(treatment.evidence.mechanism.bceVerdictSequence, ['pass']);

  const tamperedEvents = treatment.evidence.events.map((event) => structuredClone(event));
  const toolResponse = tamperedEvents.find((event) => event.type === 'mcp.response' && event.payload.dispatchId !== null);
  toolResponse.payload.response.id += 1000;
  assert.throws(() => verifyOllamaClientEvents(rehash(tamperedEvents), { cell: treatment.cell, arm: 'bce-enabled', task: treatment.task, execBrokerEvidence: treatment.result.execBrokerEvidence }), /MCP tools\/call response is not the exact matching success response/);

  const duplicateProvider = treatment.evidence.events.map((event) => structuredClone(event));
  const firstProviderRequest = duplicateProvider.findIndex((event) => event.type === 'provider.request');
  duplicateProvider.splice(firstProviderRequest + 1, 0, structuredClone(duplicateProvider[firstProviderRequest]));
  assert.throws(() => verifyOllamaClientEvents(rehash(duplicateProvider), { cell: treatment.cell, arm: 'bce-enabled', task: treatment.task, execBrokerEvidence: treatment.result.execBrokerEvidence }), /expected provider response/);

  const reorderedBroker = treatment.evidence.events.map((event) => structuredClone(event));
  const brokerRequestIndex = reorderedBroker.findIndex((event) => event.type === 'broker.request');
  [reorderedBroker[brokerRequestIndex], reorderedBroker[brokerRequestIndex + 1]] = [reorderedBroker[brokerRequestIndex + 1], reorderedBroker[brokerRequestIndex]];
  assert.throws(() => verifyOllamaClientEvents(rehash(reorderedBroker), { cell: treatment.cell, arm: 'bce-enabled', task: treatment.task, execBrokerEvidence: treatment.result.execBrokerEvidence }), /expected exec broker request/);

  const forgedBroker = treatment.evidence.events.map((event) => structuredClone(event));
  const forgedBrokerResponse = forgedBroker.find((event) => event.type === 'broker.response');
  forgedBrokerResponse.payload.response.result.stdout = 'self-rehashed forgery';
  forgedBrokerResponse.payload.responseSha256 = sha256Json(forgedBrokerResponse.payload.response);
  const forgedExecResult = forgedBroker.find((event) => event.type === 'tool.result' && event.payload.name === 'exec');
  forgedExecResult.payload.result.stdout = 'self-rehashed forgery';
  assert.throws(() => verifyOllamaClientEvents(rehash(forgedBroker), { cell: treatment.cell, arm: 'bce-enabled', task: treatment.task, execBrokerEvidence: treatment.result.execBrokerEvidence }), /do not bijectively match controller broker evidence/);

  const invalidVerdict = treatment.evidence.events.map((event) => structuredClone(event));
  const gateResponse = invalidVerdict.find((event) => event.type === 'mcp.response' && event.payload.dispatchId !== null);
  gateResponse.payload.response.result.structuredContent.gateFailed = 'false';
  const gateToolResult = invalidVerdict.find((event) => event.type === 'tool.result' && event.payload.name === 'run_gate');
  gateToolResult.payload.result.structuredContent.gateFailed = 'false';
  assert.throws(() => verifyOllamaClientEvents(rehash(invalidVerdict), { cell: treatment.cell, arm: 'bce-enabled', task: treatment.task, execBrokerEvidence: treatment.result.execBrokerEvidence }), /not an exact successful BCE verdict/);

  const hallucination = await runClient({ model: 'hallucinate' });
  assert.equal(hallucination.evidence.mechanism.bceGateCalls, 0);
  assert.equal(hallucination.evidence.mechanism.malformedToolCalls, 1);
  const badArgv = await runClient({ model: 'bad-argv' });
  assert.equal(badArgv.evidence.mechanism.malformedToolCalls, 1);
  assert.equal(badArgv.result.execBrokerEvidence.length, 0, 'malformed exec must be rejected before reaching the controller broker');

  const mcpError = await runClient({ model: 'normal', treatment: true, mcpError: true });
  assert.match(mcpError.verificationError?.message ?? '', /MCP tools\/call response is not the exact matching success response|not an exact successful BCE verdict/);

  const traversal = await runClient({ model: 'traversal' });
  assert.equal(traversal.evidence.mechanism.toolFailures, 1);
  const symlink = await runClient({ model: 'symlink', symlink: true });
  assert.equal(symlink.evidence.mechanism.toolFailures, 1);

  const orphan = await runClient({ model: 'orphan' });
  assert.match(orphan.verificationError?.message ?? '', /exec broker response .* is not the exact contained result/, 'exec must fail closed when the broker cannot prove process-group termination');
  assert.equal(orphan.result.processGroupRemained, false, 'the client must not inherit or retain brokered command descendants');

  process.stdout.write('model-evaluation Ollama tool-client self-test: PASS (sealed event chain; exact model dispatch, typed exec broker, and MCP JSON-RPC identity; fake evidence, hallucination, MCP error, traversal, symlink, and orphan proof failure refused)\n');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
