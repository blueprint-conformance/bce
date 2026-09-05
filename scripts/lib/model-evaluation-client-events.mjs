import { createHash } from 'node:crypto';

const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalJson = (value) => JSON.stringify(canonical(value));
const sha256Json = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');

export const OLLAMA_CLIENT_EVENT_PROTOCOL = 'bce-ollama-tool-client-events/v1';

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    throw new Error(`${label} has an invalid shape`);
  }
}

function integerOrNull(value) { return value === null || Number.isInteger(value); }

function validArgv(value) {
  return Array.isArray(value) && value.length >= 1 && value.length <= 32 &&
    value.every((entry) => typeof entry === 'string' && entry.length >= 1 && entry.length <= 4096);
}

function validateBrokerRequest(request) {
  exactKeys(request, ['schemaVersion', 'id', 'kind', 'argv'], 'exec broker request');
  if (request.schemaVersion !== '1' || !Number.isInteger(request.id) || request.id < 1 ||
      request.kind !== 'exec' || !validArgv(request.argv)) throw new Error('exec broker request is invalid');
}

function validateBrokerResult(result) {
  exactKeys(result, [
    'argv', 'exitCode', 'signal', 'timedOut', 'overflow', 'processGroupTerminated',
    'stdout', 'stderr', 'execSandbox', 'sandboxProfileSha256',
  ], 'exec broker result');
  if (!validArgv(result.argv) || !integerOrNull(result.exitCode) ||
      (result.signal !== null && typeof result.signal !== 'string') ||
      typeof result.timedOut !== 'boolean' || typeof result.overflow !== 'boolean' ||
      typeof result.processGroupTerminated !== 'boolean' || typeof result.stdout !== 'string' ||
      typeof result.stderr !== 'string' || !result.execSandbox || typeof result.execSandbox !== 'object' ||
      Array.isArray(result.execSandbox) || !/^[0-9a-f]{64}$/.test(result.sandboxProfileSha256)) {
    throw new Error('exec broker result is invalid');
  }
}

function validatePayload(event) {
  const value = event.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`client event ${event.sequence} payload is not an object`);
  if (event.type === 'session.started') {
    exactKeys(value, ['clientVersion', 'requestedModel', 'mcpEnabled', 'systemPromptSha256', 'commonToolContractSha256', 'options', 'execSandbox', 'limits'], 'session.started');
    if (typeof value.clientVersion !== 'string' || typeof value.requestedModel !== 'string' || typeof value.mcpEnabled !== 'boolean' ||
        !/^[0-9a-f]{64}$/.test(value.systemPromptSha256) || !/^[0-9a-f]{64}$/.test(value.commonToolContractSha256)) throw new Error('session.started identity is invalid');
  } else if (event.type === 'provider.request') {
    exactKeys(value, ['turn', 'requestSha256', 'offeredToolNames'], 'provider.request');
    if (!Number.isInteger(value.turn) || value.turn < 1 || !/^[0-9a-f]{64}$/.test(value.requestSha256) ||
        !Array.isArray(value.offeredToolNames) || value.offeredToolNames.some((name) => typeof name !== 'string')) throw new Error('provider.request is invalid');
  } else if (event.type === 'provider.response') {
    exactKeys(value, ['turn', 'responseSha256', 'model', 'promptEvalCount', 'evalCount', 'assistant'], 'provider.response');
    if (!Number.isInteger(value.turn) || value.turn < 1 || !/^[0-9a-f]{64}$/.test(value.responseSha256) || typeof value.model !== 'string' ||
        !integerOrNull(value.promptEvalCount) || !integerOrNull(value.evalCount) || !value.assistant || typeof value.assistant !== 'object' ||
        !Array.isArray(value.assistant.toolCalls)) throw new Error('provider.response is invalid');
  } else if (event.type === 'tool.dispatch') {
    exactKeys(value, ['turn', 'dispatchId', 'name', 'arguments', 'argumentsSha256'], 'tool.dispatch');
    if (!Number.isInteger(value.turn) || typeof value.dispatchId !== 'string' || typeof value.name !== 'string' ||
        !value.arguments || typeof value.arguments !== 'object' || Array.isArray(value.arguments) ||
        value.argumentsSha256 !== sha256Json(value.arguments)) throw new Error('tool.dispatch is invalid');
  } else if (event.type === 'tool.result') {
    exactKeys(value, ['turn', 'dispatchId', 'name', 'ok', 'result'], 'tool.result');
    if (!Number.isInteger(value.turn) || typeof value.dispatchId !== 'string' || typeof value.name !== 'string' || typeof value.ok !== 'boolean') throw new Error('tool.result is invalid');
  } else if (event.type === 'tool.rejected') {
    exactKeys(value, ['turn', 'dispatchId', 'name', 'reason'], 'tool.rejected');
    if (!Number.isInteger(value.turn) || typeof value.dispatchId !== 'string' || ![null, 'string'].includes(value.name === null ? null : typeof value.name) || typeof value.reason !== 'string') throw new Error('tool.rejected is invalid');
  } else if (event.type === 'broker.request') {
    exactKeys(value, ['request', 'requestSha256'], 'broker.request');
    validateBrokerRequest(value.request);
    if (value.requestSha256 !== sha256Json(value.request)) throw new Error('broker.request digest is invalid');
  } else if (event.type === 'broker.response') {
    exactKeys(value, ['response', 'responseSha256'], 'broker.response');
    const response = value.response;
    exactKeys(response, ['schemaVersion', 'id', 'kind', 'requestSha256', 'result'], 'exec broker response');
    if (response.schemaVersion !== '1' || !Number.isInteger(response.id) || response.id < 1 ||
        response.kind !== 'exec-result' || !/^[0-9a-f]{64}$/.test(response.requestSha256)) {
      throw new Error('exec broker response is invalid');
    }
    validateBrokerResult(response.result);
    if (value.responseSha256 !== sha256Json(response)) throw new Error('broker.response digest is invalid');
  } else if (event.type === 'mcp.request') {
    exactKeys(value, ['dispatchId', 'request'], 'mcp.request');
    if (value.dispatchId !== null && typeof value.dispatchId !== 'string') throw new Error('mcp.request dispatch id is invalid');
    const request = value.request;
    exactKeys(request, ['jsonrpc', 'id', 'method', 'params'], 'MCP request');
    if (request.jsonrpc !== '2.0' || !Number.isInteger(request.id) || request.id < 1 || typeof request.method !== 'string' ||
        !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw new Error('MCP request is invalid');
  } else if (event.type === 'mcp.response') {
    exactKeys(value, ['dispatchId', 'response'], 'mcp.response');
    if (value.dispatchId !== null && typeof value.dispatchId !== 'string') throw new Error('mcp.response dispatch id is invalid');
    const response = value.response;
    if (!response || response.jsonrpc !== '2.0' || !Number.isInteger(response.id) || response.id < 1 ||
        (!Object.hasOwn(response, 'result') && !Object.hasOwn(response, 'error')) || (Object.hasOwn(response, 'result') && Object.hasOwn(response, 'error'))) throw new Error('MCP response is invalid');
    exactKeys(response, Object.hasOwn(response, 'result') ? ['jsonrpc', 'id', 'result'] : ['jsonrpc', 'id', 'error'], 'MCP response');
  } else if (event.type === 'session.completed') {
    exactKeys(value, ['reason', 'turns', 'providerRequests', 'inputTokens', 'outputTokens', 'cachedTokens', 'malformedToolCalls', 'model'], 'session.completed');
    if (!['assistant-finished', 'turn-limit'].includes(value.reason) || !['turns', 'providerRequests', 'inputTokens', 'outputTokens', 'cachedTokens', 'malformedToolCalls'].every((key) => Number.isInteger(value[key]) && value[key] >= 0) || typeof value.model !== 'string') throw new Error('session.completed is invalid');
  } else if (event.type === 'client.error') {
    exactKeys(value, ['class', 'message'], 'client.error');
    if (value.class !== 'provider-or-apparatus' || typeof value.message !== 'string') throw new Error('client.error is invalid');
  } else throw new Error(`unknown client event type ${String(event.type)}`);
}

function verdictFromGateResult(result) {
  const structured = result?.structuredContent;
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return null;
  if (structured.gateFailed === false) return 'pass';
  if (structured.gateFailed === true) return 'fail';
  return null;
}

function routedToolCall(call, expectedTools) {
  const name = call?.function?.name;
  const args = call?.function?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args) || !expectedTools.includes(name)) return false;
  const keys = Object.keys(args).sort();
  if (name === 'read_file') return canonicalJson(keys) === canonicalJson(['path']);
  if (name === 'write_file') return canonicalJson(keys) === canonicalJson(['content', 'path']);
  if (name === 'exec') return canonicalJson(keys) === canonicalJson(['argv']) && validArgv(args.argv);
  if (name === 'run_gate') return canonicalJson(args) === '{}';
  return false;
}

export function verifyOllamaClientEvents(stdout, { cell, arm, task, execBrokerEvidence }) {
  const lines = String(stdout ?? '').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new Error('sealed Ollama client emitted no events');
  const events = [];
  for (const [index, line] of lines.entries()) {
    let event;
    try { event = JSON.parse(line); }
    catch { throw new Error(`sealed Ollama client event ${index} is not JSON`); }
    exactKeys(event, ['schemaVersion', 'protocol', 'sequence', 'previousEventSha256', 'type', 'payload', 'eventSha256'], `client event ${index}`);
    if (event.schemaVersion !== '1' || event.protocol !== OLLAMA_CLIENT_EVENT_PROTOCOL || event.sequence !== index ||
        event.previousEventSha256 !== (index === 0 ? null : events[index - 1].eventSha256) ||
        event.eventSha256 !== sha256Json({ ...event, eventSha256: null })) throw new Error(`sealed Ollama client event ${index} chain is invalid`);
    validatePayload(event);
    events.push(event);
  }
  const started = events[0];
  if (started.type !== 'session.started') throw new Error('sealed Ollama client chain does not start with session.started');
  if (!['session.completed', 'client.error'].includes(events.at(-1).type)) throw new Error('sealed Ollama client chain has no terminal event');
  if (events.slice(1, -1).some((event) => ['session.started', 'session.completed', 'client.error'].includes(event.type))) throw new Error('sealed Ollama client chain contains misplaced lifecycle events');
  const configuration = cell.toolLoop;
  if (!configuration) throw new Error(`${cell.id}: sealed Ollama cell lacks toolLoop configuration`);
  const expectedMcp = arm === 'bce-enabled';
  const expectedOptions = {
    stream: false,
    think: cell.reasoningEffort,
    keep_alive: configuration.modelOptions.keepAlive,
    options: { temperature: configuration.modelOptions.temperature, seed: configuration.modelOptions.seed, num_ctx: configuration.modelOptions.numCtx },
  };
  const expectedLimits = {
    maxTurns: task.budget.maxTurns,
    maxFileBytes: configuration.limits.maxFileBytes,
    maxToolOutputBytes: configuration.limits.maxToolOutputBytes,
    commandTimeoutMs: configuration.limits.commandTimeoutMs,
    providerTimeoutMs: configuration.limits.providerTimeoutMs,
  };
  if (started.payload.clientVersion !== cell.clientVersion || started.payload.requestedModel !== cell.requestedModel ||
      started.payload.mcpEnabled !== expectedMcp || started.payload.systemPromptSha256 !== configuration.systemPrompt.sha256 ||
      started.payload.commonToolContractSha256 !== configuration.commonToolContract.sha256 ||
      canonicalJson(started.payload.options) !== canonicalJson(expectedOptions) || canonicalJson(started.payload.execSandbox) !== canonicalJson(configuration.execSandbox) ||
      canonicalJson(started.payload.limits) !== canonicalJson(expectedLimits)) {
    throw new Error('sealed Ollama client session does not match frozen cell configuration');
  }

  if (!Array.isArray(execBrokerEvidence)) throw new Error('sealed Ollama client verification requires controller exec-broker evidence');
  const expectedTools = expectedMcp ? ['read_file', 'write_file', 'exec', 'run_gate'] : ['read_file', 'write_file', 'exec'];
  const requests = [];
  const responses = [];
  const dispatches = [];
  const rejections = [];
  const results = [];
  const mcpRequests = [];
  const mcpResponses = [];
  const creditedGateResults = [];
  const observedBrokerEvidence = [];
  let nextMcpId = 1;
  let nextBrokerId = 1;
  let cursor = 1;
  let turn = 1;
  let completed = null;
  let clientErrored = false;

  const take = (type, label = type) => {
    const event = events[cursor];
    if (!event || event.type !== type) throw new Error(`sealed Ollama client expected ${label} at event ${cursor}, found ${event?.type ?? 'end-of-chain'}`);
    cursor += 1;
    return event;
  };
  const takeToolResult = (expectedTurn, dispatchId, name) => {
    const event = take('tool.result', `${name} tool.result`);
    if (event.payload.turn !== expectedTurn || event.payload.dispatchId !== dispatchId || event.payload.name !== name) {
      throw new Error(`${name} tool.result is not bound to its dispatch`);
    }
    results.push(event);
    return event;
  };
  const takeMcpExchange = (method, params, dispatchId) => {
    const requestEvent = take('mcp.request', `MCP ${method} request`);
    const request = requestEvent.payload.request;
    if (requestEvent.payload.dispatchId !== dispatchId || request.id !== nextMcpId || request.method !== method ||
        canonicalJson(request.params) !== canonicalJson(params)) throw new Error(`MCP ${method} request is not the exact next exchange`);
    mcpRequests.push(requestEvent);
    const responseEvent = take('mcp.response', `MCP ${method} response`);
    const response = responseEvent.payload.response;
    if (responseEvent.payload.dispatchId !== dispatchId || response.id !== nextMcpId || Object.hasOwn(response, 'error')) {
      throw new Error(`MCP ${method} response is not the exact matching success response`);
    }
    mcpResponses.push(responseEvent);
    nextMcpId += 1;
    return response.result;
  };

  while (cursor < events.length) {
    const requestEvent = take('provider.request', `provider request for turn ${turn}`);
    if (requestEvent.payload.turn !== turn || canonicalJson(requestEvent.payload.offeredToolNames) !== canonicalJson(expectedTools)) {
      throw new Error(`provider request ${turn} differs from the frozen tool surface`);
    }
    requests.push(requestEvent);
    if (events[cursor]?.type === 'client.error') {
      if (cursor !== events.length - 1) throw new Error('client.error is not terminal');
      cursor += 1;
      clientErrored = true;
      break;
    }

    const responseEvent = take('provider.response', `provider response for turn ${turn}`);
    if (responseEvent.payload.turn !== turn || responseEvent.payload.model !== cell.requestedModel ||
        (responseEvent.payload.promptEvalCount !== null && responseEvent.payload.promptEvalCount < 0) ||
        (responseEvent.payload.evalCount !== null && responseEvent.payload.evalCount < 0)) {
      throw new Error(`provider response ${turn} is invalid`);
    }
    exactKeys(responseEvent.payload.assistant, ['content', 'thinking', 'toolCalls'], `provider response ${turn} assistant`);
    if (typeof responseEvent.payload.assistant.content !== 'string' || typeof responseEvent.payload.assistant.thinking !== 'string') {
      throw new Error(`provider response ${turn} assistant text is invalid`);
    }
    responses.push(responseEvent);
    const calls = responseEvent.payload.assistant.toolCalls;

    for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
      const call = calls[callIndex];
      const dispatchId = `turn-${turn}-call-${callIndex + 1}`;
      const representation = events[cursor];
      const routable = routedToolCall(call, expectedTools);
      if (representation?.type === 'tool.rejected') {
        cursor += 1;
        const expectedName = typeof call?.function?.name === 'string' ? call.function.name : null;
        if (routable || representation.payload.turn !== turn || representation.payload.dispatchId !== dispatchId ||
            representation.payload.name !== expectedName) throw new Error(`tool rejection ${dispatchId} is not the exact unroutable model call`);
        rejections.push(representation);
        continue;
      }
      const dispatch = take('tool.dispatch', `tool dispatch ${dispatchId}`);
      if (!routable || dispatch.payload.turn !== turn || dispatch.payload.dispatchId !== dispatchId ||
          dispatch.payload.name !== call.function.name || canonicalJson(dispatch.payload.arguments) !== canonicalJson(call.function.arguments)) {
        throw new Error(`tool dispatch ${dispatchId} is not the exact routable model call`);
      }
      dispatches.push(dispatch);
      const name = dispatch.payload.name;
      if (name === 'exec') {
        const brokerRequestEvent = take('broker.request', `exec broker request ${nextBrokerId}`);
        const brokerRequest = brokerRequestEvent.payload.request;
        if (brokerRequest.id !== nextBrokerId || canonicalJson(brokerRequest.argv) !== canonicalJson(dispatch.payload.arguments.argv)) {
          throw new Error(`exec broker request ${nextBrokerId} is not bound to ${dispatchId}`);
        }
        const brokerResponseEvent = take('broker.response', `exec broker response ${nextBrokerId}`);
        const brokerResponse = brokerResponseEvent.payload.response;
        if (brokerResponse.id !== nextBrokerId || brokerResponse.requestSha256 !== brokerRequestEvent.payload.requestSha256 ||
            canonicalJson(brokerResponse.result.argv) !== canonicalJson(brokerRequest.argv) ||
            canonicalJson(brokerResponse.result.execSandbox) !== canonicalJson(configuration.execSandbox) ||
            brokerResponse.result.processGroupTerminated !== true) {
          throw new Error(`exec broker response ${nextBrokerId} is not the exact contained result for ${dispatchId}`);
        }
        const result = takeToolResult(turn, dispatchId, name);
        const expectedOk = brokerResponse.result.exitCode === 0 && !brokerResponse.result.timedOut && !brokerResponse.result.overflow && brokerResponse.result.processGroupTerminated;
        if (result.payload.ok !== expectedOk || canonicalJson(result.payload.result) !== canonicalJson(brokerResponse.result)) {
          throw new Error(`exec tool.result ${dispatchId} differs from controller broker evidence`);
        }
        observedBrokerEvidence.push({
          request: brokerRequest,
          requestSha256: brokerRequestEvent.payload.requestSha256,
          response: brokerResponse,
          responseSha256: brokerResponseEvent.payload.responseSha256,
        });
        nextBrokerId += 1;
      } else if (name === 'run_gate') {
        const initialized = takeMcpExchange('initialize', {
          protocolVersion: '2025-11-25', capabilities: {},
          clientInfo: { name: 'bce-ollama-tool-client', version: '1.0.0' },
        }, null);
        if (!initialized || typeof initialized !== 'object' || typeof initialized.protocolVersion !== 'string') {
          throw new Error(`MCP initialize result for ${dispatchId} is invalid`);
        }
        const listed = takeMcpExchange('tools/list', {}, null);
        if (!listed || !Array.isArray(listed.tools)) throw new Error(`MCP tools/list result for ${dispatchId} is invalid`);
        const matchingTools = listed.tools.filter((tool) => tool?.name === 'run_gate' && sha256Json(tool) === configuration.mcpRunGateToolSha256);
        if (matchingTools.length !== 1 || listed.tools.filter((tool) => tool?.name === 'run_gate').length !== 1) {
          throw new Error(`MCP tools/list does not contain exactly one frozen run_gate contract for ${dispatchId}`);
        }
        const gateResult = takeMcpExchange('tools/call', { name: 'run_gate', arguments: {} }, dispatchId);
        const verdict = verdictFromGateResult(gateResult);
        if (!gateResult || typeof gateResult !== 'object' || gateResult.isError !== false || verdict === null) {
          throw new Error(`MCP run_gate result for ${dispatchId} is not an exact successful BCE verdict`);
        }
        const result = takeToolResult(turn, dispatchId, name);
        if (result.payload.ok !== true || canonicalJson(result.payload.result) !== canonicalJson(gateResult)) {
          throw new Error(`run_gate tool.result ${dispatchId} differs from the exact MCP response`);
        }
        creditedGateResults.push(gateResult);
      } else {
        const result = takeToolResult(turn, dispatchId, name);
        if (result.payload.ok === false) {
          exactKeys(result.payload.result, ['error'], `${name} failed result`);
          if (typeof result.payload.result.error !== 'string') throw new Error(`${name} failed result is invalid`);
        }
      }
    }

    if (calls.length === 0) {
      const completionEvent = take('session.completed', 'assistant-finished session completion');
      completed = completionEvent.payload;
      if (completed.reason !== 'assistant-finished') throw new Error('zero-tool-call final response did not complete as assistant-finished');
      break;
    }
    if (turn === task.budget.maxTurns) {
      const completionEvent = take('session.completed', 'turn-limit session completion');
      completed = completionEvent.payload;
      if (completed.reason !== 'turn-limit') throw new Error('maximum-turn response did not complete as turn-limit');
      break;
    }
    turn += 1;
  }

  if (cursor !== events.length) throw new Error(`sealed Ollama client chain contains ${events.length - cursor} unconsumed event(s)`);
  if (!completed && !clientErrored) throw new Error('sealed Ollama client chain has no valid terminal lifecycle');
  if (canonicalJson(observedBrokerEvidence) !== canonicalJson(execBrokerEvidence)) {
    throw new Error('sealed Ollama exec events do not bijectively match controller broker evidence');
  }
  if (!expectedMcp && (mcpRequests.length > 0 || mcpResponses.length > 0 || creditedGateResults.length > 0)) {
    throw new Error('baseline client chain contains BCE MCP evidence');
  }
  if (completed && (completed.turns !== requests.length || completed.providerRequests !== requests.length || requests.length !== responses.length ||
      completed.malformedToolCalls !== rejections.length || completed.model !== cell.requestedModel || completed.cachedTokens !== 0 ||
      completed.inputTokens !== responses.reduce((sum, event) => sum + (event.payload.promptEvalCount ?? 0), 0) ||
      completed.outputTokens !== responses.reduce((sum, event) => sum + (event.payload.evalCount ?? 0), 0))) {
    throw new Error('session completion telemetry does not rederive from provider events');
  }
  if (clientErrored && requests.length !== responses.length + 1) throw new Error('client.error does not follow one unmatched provider request');

  const verdicts = creditedGateResults.map(verdictFromGateResult);
  const firstFail = verdicts.indexOf('fail');

  return {
    events,
    eventChainHeadSha256: events.at(-1).eventSha256,
    usage: {
      agentTurns: completed?.turns ?? (requests.length || null),
      inputTokens: completed?.inputTokens ?? null,
      outputTokens: completed?.outputTokens ?? null,
      cachedTokens: completed?.cachedTokens ?? null,
      costUsd: null,
      resolvedModel: responses.length > 0 ? cell.resolvedModel : null,
    },
    observedWritePaths: dispatches.filter((event) => event.payload.name === 'write_file').map((event) => event.payload.arguments.path).filter((path) => typeof path === 'string'),
    mechanism: {
      eventEvidenceAvailable: true,
      skillReadObserved: expectedMcp ? dispatches.some((event) => event.payload.name === 'read_file' && /^(?:\.agents|\.claude)\/skills\/bce\/SKILL\.md$/.test(event.payload.arguments.path)) : null,
      mcpToolCalls: expectedMcp ? creditedGateResults.length : 0,
      bceGateCalls: expectedMcp ? creditedGateResults.length : 0,
      bceVerdictSequence: expectedMcp ? verdicts : [],
      redToGreenCorrectionObserved: expectedMcp ? firstFail >= 0 && verdicts.slice(firstFail + 1).includes('pass') : false,
      commonToolCalls: dispatches.filter((event) => ['read_file', 'write_file', 'exec'].includes(event.payload.name)).length,
      malformedToolCalls: rejections.length,
      toolFailures: results.filter((event) => event.payload.ok === false).length,
      providerRequests: requests.length,
      eventChainHeadSha256: events.at(-1).eventSha256,
    },
  };
}
