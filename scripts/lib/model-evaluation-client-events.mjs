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

function validatePayload(event) {
  const value = event.payload;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`client event ${event.sequence} payload is not an object`);
  if (event.type === 'session.started') {
    exactKeys(value, ['clientVersion', 'requestedModel', 'mcpEnabled', 'systemPromptSha256', 'commonToolContractSha256', 'options', 'limits'], 'session.started');
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
  } else if (event.type === 'mcp.request') {
    exactKeys(value, ['dispatchId', 'request'], 'mcp.request');
    if (value.dispatchId !== null && typeof value.dispatchId !== 'string') throw new Error('mcp.request dispatch id is invalid');
    const request = value.request;
    exactKeys(request, ['jsonrpc', 'id', 'method', 'params'], 'MCP request');
    if (request.jsonrpc !== '2.0' || (!Number.isInteger(request.id) && typeof request.id !== 'string') || typeof request.method !== 'string' ||
        !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw new Error('MCP request is invalid');
  } else if (event.type === 'mcp.response') {
    exactKeys(value, ['dispatchId', 'response'], 'mcp.response');
    if (value.dispatchId !== null && typeof value.dispatchId !== 'string') throw new Error('mcp.response dispatch id is invalid');
    const response = value.response;
    if (!response || response.jsonrpc !== '2.0' || (!Number.isInteger(response.id) && typeof response.id !== 'string') ||
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
  if (!structured || typeof structured !== 'object') return null;
  if (structured.gateFailed === false) return 'pass';
  if (structured.gateFailed === true) return 'fail';
  const verdicts = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.verdict === 'pass' || value.verdict === 'fail') verdicts.push(value.verdict);
    for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
  };
  visit(structured);
  return verdicts.length > 0 && verdicts.every((value) => value === verdicts[0]) ? verdicts[0] : null;
}

export function verifyOllamaClientEvents(stdout, { cell, arm, task }) {
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
      canonicalJson(started.payload.options) !== canonicalJson(expectedOptions) || canonicalJson(started.payload.limits) !== canonicalJson(expectedLimits)) {
    throw new Error('sealed Ollama client session does not match frozen cell configuration');
  }

  const expectedTools = expectedMcp ? ['read_file', 'write_file', 'exec', 'run_gate'] : ['read_file', 'write_file', 'exec'];
  const requests = events.filter((event) => event.type === 'provider.request');
  const responses = events.filter((event) => event.type === 'provider.response');
  if (requests.length !== responses.length || requests.some((event, index) => event.payload.turn !== index + 1 || canonicalJson(event.payload.offeredToolNames) !== canonicalJson(expectedTools)) ||
      responses.some((event, index) => event.payload.turn !== index + 1 || event.payload.model !== cell.requestedModel)) throw new Error('provider request/response sequence is invalid');

  const dispatches = events.filter((event) => event.type === 'tool.dispatch');
  const rejections = events.filter((event) => event.type === 'tool.rejected');
  const dispatchIds = new Set();
  for (const dispatch of dispatches) {
    if (dispatchIds.has(dispatch.payload.dispatchId) || !expectedTools.includes(dispatch.payload.name)) throw new Error('tool dispatch identity is invalid');
    dispatchIds.add(dispatch.payload.dispatchId);
    const response = responses.find((event) => event.payload.turn === dispatch.payload.turn);
    const callIndex = Number(dispatch.payload.dispatchId.match(/-call-(\d+)$/)?.[1] ?? 0) - 1;
    const call = response?.payload.assistant.toolCalls?.[callIndex];
    if (!call || call.function?.name !== dispatch.payload.name || canonicalJson(call.function?.arguments) !== canonicalJson(dispatch.payload.arguments)) {
      throw new Error('tool dispatch is not bound to the model-requested call');
    }
  }
  for (const rejection of rejections) {
    const response = responses.find((event) => event.payload.turn === rejection.payload.turn);
    const callIndex = Number(rejection.payload.dispatchId.match(/-call-(\d+)$/)?.[1] ?? 0) - 1;
    if (!response?.payload.assistant.toolCalls?.[callIndex]) throw new Error('tool rejection is not bound to a model-requested call');
  }
  for (const response of responses) {
    const represented = events.filter((event) => ['tool.dispatch', 'tool.rejected'].includes(event.type) && event.payload.turn === response.payload.turn);
    if (represented.length !== response.payload.assistant.toolCalls.length) throw new Error(`not every model tool call has one dispatch or rejection at turn ${response.payload.turn}: ${represented.length}/${response.payload.assistant.toolCalls.length}`);
  }
  const results = events.filter((event) => event.type === 'tool.result');
  if (results.some((result) => !dispatches.some((dispatch) => dispatch.payload.dispatchId === result.payload.dispatchId && dispatch.payload.name === result.payload.name)) ||
      dispatches.some((dispatch) => !results.some((result) => result.payload.dispatchId === dispatch.payload.dispatchId && result.payload.name === dispatch.payload.name))) {
    throw new Error('tool dispatch/result pairing is invalid');
  }

  const mcpRequests = events.filter((event) => event.type === 'mcp.request');
  const mcpResponses = events.filter((event) => event.type === 'mcp.response');
  if (!expectedMcp && (mcpRequests.length > 0 || mcpResponses.length > 0 || dispatches.some((event) => event.payload.name === 'run_gate'))) throw new Error('baseline client chain contains BCE MCP evidence');
  const responseById = new Map(mcpResponses.map((event) => [event.payload.response.id, event]));
  if (mcpRequests.length !== mcpResponses.length || mcpRequests.some((event) => {
    const response = responseById.get(event.payload.request.id);
    return !response || response.payload.dispatchId !== event.payload.dispatchId;
  })) throw new Error('MCP request/response identity is invalid');

  const creditedGateResults = [];
  for (const dispatch of dispatches.filter((event) => event.payload.name === 'run_gate')) {
    if (canonicalJson(dispatch.payload.arguments) !== '{}') continue;
    const request = mcpRequests.find((event) => event.payload.dispatchId === dispatch.payload.dispatchId && event.payload.request.method === 'tools/call');
    if (!request || canonicalJson(request.payload.request.params) !== canonicalJson({ name: 'run_gate', arguments: {} })) continue;
    const response = responseById.get(request.payload.request.id);
    const toolResult = results.find((event) => event.payload.dispatchId === dispatch.payload.dispatchId && event.payload.name === 'run_gate');
    if (!response || Object.hasOwn(response.payload.response, 'error') || response.payload.response.result?.isError === true || toolResult?.payload.ok !== true ||
        canonicalJson(toolResult.payload.result) !== canonicalJson(response.payload.response.result)) continue;
    creditedGateResults.push(response.payload.response.result);
  }
  const verdicts = creditedGateResults.map(verdictFromGateResult).filter(Boolean);
  const firstFail = verdicts.indexOf('fail');
  const completed = events.at(-1).type === 'session.completed' ? events.at(-1).payload : null;
  if (completed && (completed.providerRequests !== requests.length || completed.malformedToolCalls !== rejections.length || completed.model !== cell.requestedModel ||
      completed.inputTokens !== responses.reduce((sum, event) => sum + (event.payload.promptEvalCount ?? 0), 0) ||
      completed.outputTokens !== responses.reduce((sum, event) => sum + (event.payload.evalCount ?? 0), 0))) throw new Error('session completion telemetry does not rederive from provider events');

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
