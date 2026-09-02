/**
 * mcp-server.test.ts — the THIN MCP stdio server (`bce-mcp`) round-trips against real fixture trees.
 *
 * The server is spec-churn insurance: EXACTLY six tools, each a logic-free shell over the SAME
 * exported engine API the `bce` CLI calls. These
 * tests SPAWN the real server (source, via tsx — the project convention) and drive newline-delimited
 * JSON-RPC 2.0 over its stdin/stdout, asserting:
 *
 *   1. HANDSHAKE — initialize returns the server identity + protocolVersion; tools/list returns
 *      EXACTLY the six tools (an extra tool, or a missing one, is a surface regression).
 *   2. run_gate is BYTE-IDENTICAL to `bce gate --report-json` — RED and GREEN produce OPPOSITE
 *      machine verdicts (gateFailed / exitCode) matching the CLI's, over the same fixtures.
 *   3. validate_blueprint / assess_teeth round-trip a real blueprint against a real tree.
 *   4. get_report re-reads a serialized report the engine wrote (logic-free).
 *   5. FAIL-CLOSED (the brand) — a malformed blueprint, a missing repoDir, or a partial scan below
 *      the fail-closed file floor becomes an isError tool result, NEVER a fabricated green.
 *
 * No LLM, no network — pure stdio + filesystem. The server source is run through tsx so the test
 * exercises the SAME code the `bce-mcp` bin ships (dist/mcp-server.js is that source, tsup-built).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TSX_LOADER = join(ROOT, 'node_modules', 'tsx', 'dist', 'loader.mjs');
const SERVER = join(HERE, '..', 'src', 'mcp-server.ts');
const CLI = join(HERE, '..', 'src', 'cli.ts');
const FIXROOT = join(HERE, '..', 'fixtures');
const BLUEPRINT = join(FIXROOT, 'luna-chat-extension.blueprint.json');
const CONFORMANT = join(FIXROOT, 'extension-surface', 'conformant');
const DRIFT = join(FIXROOT, 'extension-surface', 'drift-forbidden-import');

interface RpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

/**
 * Spawn the server once, write every request as one newline-delimited JSON line, and resolve with
 * the response objects (matched by id, order-independent). Closes stdin so the server exits cleanly.
 * This is the true MCP client shape: one long-lived stdio process, many framed messages.
 */
function rpcRoundTrip(
  requests: Array<Record<string, unknown>>,
  cwd?: string,
): Promise<Map<number | string, RpcResponse>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', TSX_LOADER, SERVER], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`mcp server timed out. stderr:\n${stderr}\nstdout:\n${stdout}`));
    }, 55000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => (stderr += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const byId = new Map<number | string, RpcResponse>();
      for (const line of stdout.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        let obj: RpcResponse;
        try {
          obj = JSON.parse(t) as RpcResponse;
        } catch {
          reject(new Error(`server emitted non-JSON on stdout: ${t}`));
          return;
        }
        if (obj.id !== null && obj.id !== undefined) byId.set(obj.id, obj);
      }
      resolve(byId);
    });

    for (const req of requests) child.stdin.write(JSON.stringify(req) + '\n');
    child.stdin.end();
  });
}

/** Drive exact stdin bytes through the real server. Unlike rpcRoundTrip this retains parse errors
 * (id:null), which is required to test framing recovery and notification silence. */
function rawRpc(stdin: string): { responses: RpcResponse[]; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, ['--import', TSX_LOADER, SERVER], {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const responses = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RpcResponse);
  return { responses, stderr: result.stderr, status: result.status };
}

/** A single tools/call, returning the parsed structuredContent (or throwing with the isError text). */
async function callTool(name: string, args: Record<string, unknown>, cwd?: string): Promise<Record<string, unknown>> {
  const responses = await rpcRoundTrip([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
  ], cwd);
  const r = responses.get(2);
  if (!r) throw new Error(`no response for tools/call ${name}`);
  if (r.error) throw new Error(`protocol error: ${r.error.message}`);
  return r.result as Record<string, unknown>;
}

function toolStructured(result: Record<string, unknown>): Record<string, unknown> {
  return result.structuredContent as Record<string, unknown>;
}

function runCli(args: string[]): { code: number; stdout: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '' };
  }
}

let tmp: string;
let bpDir: string;

beforeAll(() => {
  // isolate the plugin-surface blueprint so the gate's full-sweep grades exactly the discriminating
  // contract (mirrors gate-report-json.test.ts + ci.yml's RED/GREEN leg).
  tmp = mkdtempSync(join(tmpdir(), 'bce-mcp-'));
  bpDir = join(tmp, 'bp');
  mkdirSync(bpDir, { recursive: true });
  writeFileSync(join(bpDir, 'luna-chat-extension.blueprint.json'), readFileSync(BLUEPRINT, 'utf8'));
});
afterEach(() => {
  /* per-test tmp files cleaned at process exit; bpDir shared across the suite */
});

describe('bce-mcp — handshake + tool surface', () => {
  it('initialize returns the server identity and a protocol version', async () => {
    const responses = await rpcRoundTrip([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }]);
    const init = responses.get(1);
    expect(init?.result).toBeDefined();
    expect((init!.result!.serverInfo as { name: string }).name).toBe('bce-mcp');
    expect(typeof init!.result!.protocolVersion).toBe('string');
    expect((init!.result!.capabilities as { tools: unknown }).tools).toBeDefined();
  });

  it('tools/list exposes read-only self-management but no policy approval or weakening tools', async () => {
    const responses = await rpcRoundTrip([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    ]);
    const list = responses.get(2);
    const tools = (list!.result!.tools as Array<{ name: string; inputSchema: unknown; annotations?: Record<string, unknown> }>);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['assess_teeth', 'check_baseline', 'doctor_repository', 'get_report', 'run_gate', 'validate_blueprint']);
    expect(names).not.toEqual(expect.arrayContaining(['adopt', 'ratify', 'amend', 'graduate', 'baseline']));
    // every tool declares an input schema (an agent needs it to call correctly)
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
    }
  });

  it('an unknown method is a JSON-RPC method-not-found error (not a crash)', async () => {
    const responses = await rpcRoundTrip([{ jsonrpc: '2.0', id: 9, method: 'no/such/method', params: {} }]);
    const r = responses.get(9);
    expect(r?.error).toBeDefined();
    expect(r!.error!.code).toBe(-32601);
  });
});

describe('bce-mcp — protocolVersion negotiation (MCP lifecycle spec)', () => {
  // The spec rule (modelcontextprotocol.io, lifecycle §Version Negotiation): if the server
  // supports the requested version it MUST respond with the SAME version; otherwise it MUST
  // respond with a version it supports (SHOULD be its latest) and the CLIENT decides.
  const LATEST = '2025-11-25';

  async function initWith(params: Record<string, unknown>): Promise<string> {
    const responses = await rpcRoundTrip([{ jsonrpc: '2.0', id: 1, method: 'initialize', params }]);
    const init = responses.get(1);
    expect(init?.result).toBeDefined();
    return init!.result!.protocolVersion as string;
  }

  it('echoes a supported NON-latest requested version (true echo, not a hardcoded latest)', async () => {
    expect(await initWith({ protocolVersion: '2025-06-18' })).toBe('2025-06-18');
    expect(await initWith({ protocolVersion: '2024-11-05' })).toBe('2024-11-05');
  });

  it('echoes the latest supported version when the client requests it', async () => {
    expect(await initWith({ protocolVersion: LATEST })).toBe(LATEST);
  });

  it('an UNSUPPORTED requested version gets the server latest back (client then decides)', async () => {
    expect(await initWith({ protocolVersion: '1999-01-01' })).toBe(LATEST);
    // still a normal result — never a protocol error on version mismatch
    const responses = await rpcRoundTrip([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1.0.0' } },
    ]);
    expect(responses.get(1)!.error).toBeUndefined();
    expect(responses.get(1)!.result!.protocolVersion).toBe(LATEST);
  });

  it('a missing or non-string protocolVersion field gets the server latest back', async () => {
    expect(await initWith({})).toBe(LATEST);
    expect(await initWith({ protocolVersion: 42 })).toBe(LATEST);
  });
});

describe('bce-mcp — framing, notification, and payload boundaries', () => {
  it('recovers after malformed JSON and processes a final non-newline frame at EOF', () => {
    const { responses, status } = rawRpc(
      '{not-json}\n' + JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'ping', params: {} }),
    );
    expect(status).toBe(0);
    expect(responses).toHaveLength(2);
    expect(responses[0].error?.code).toBe(-32700);
    expect(responses[0].id).toBeNull();
    expect(responses[1]).toMatchObject({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('rejects an oversized request without poisoning the next valid frame', () => {
    const oversized = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'ping',
      params: { padding: 'x'.repeat(1024 * 1024) },
    });
    const valid = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} });
    const { responses, status } = rawRpc(`${oversized}\n${valid}\n`);
    expect(status).toBe(0);
    expect(responses[0].error?.code).toBe(-32600);
    expect(responses[0].id).toBeNull();
    expect(responses[1]).toMatchObject({ id: 2, result: {} });
  });

  it('emits no response for lifecycle or cancellation notifications', () => {
    const frames = [
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99, reason: 'test' } },
      { jsonrpc: '2.0', id: 3, method: 'ping', params: {} },
    ];
    const { responses, status } = rawRpc(frames.map((frame) => JSON.stringify(frame)).join('\n') + '\n');
    expect(status).toBe(0);
    expect(responses).toEqual([{ jsonrpc: '2.0', id: 3, result: {} }]);
  });

  it('returns a multi-megabyte report without truncating outbound structuredContent', async () => {
    const reportPath = join(tmp, 'large-report.json');
    const expected = { schemaVersion: '1', payload: 'e'.repeat(2 * 1024 * 1024) };
    writeFileSync(reportPath, JSON.stringify(expected));
    const result = await callTool('get_report', { reportPath });
    expect(result.isError).toBe(false);
    expect(toolStructured(result)).toEqual(expected);
  });
});


describe('bce-mcp — validate_blueprint (thin over parseBlueprint)', () => {
  it('a valid blueprint validates with its id + version', async () => {
    const result = await callTool('validate_blueprint', { blueprintPath: BLUEPRINT });
    expect(result.isError).toBe(false);
    const doc = toolStructured(result);
    expect(doc.valid).toBe(true);
    expect(typeof doc.id).toBe('string');
    expect(typeof doc.version).toBe('string');
  });

  it('FAIL-CLOSED: a malformed blueprint is an isError result, never a fabricated pass', async () => {
    const bad = join(tmp, 'bad.blueprint.json');
    writeFileSync(bad, JSON.stringify({ apiVersion: 'blueprint-conformance/v1alpha1', kind: 'Nope' }));
    const result = await callTool('validate_blueprint', { blueprintPath: bad });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('bce error');
  });

  it('FAIL-CLOSED: a missing file is an isError result', async () => {
    const result = await callTool('validate_blueprint', { blueprintPath: join(tmp, 'nope.json') });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('file not found');
  });
});

describe('bce-mcp — run_gate is byte-identical to `bce gate --report-json`', () => {
  it('GREEN tree: gateFailed:false / exitCode:0 / verdict pass — matching the CLI', async () => {
    const result = await callTool('run_gate', { repoDir: CONFORMANT, blueprintDir: bpDir, extractor: 'ast' });
    expect(result.isError).toBe(false);
    const doc = toolStructured(result);
    expect(doc.schemaVersion).toBe('1');
    expect(doc.gateFailed).toBe(false);
    expect(doc.outcome).toBe('pass');
    expect(doc.exitCode).toBe(0);
    expect((doc.reports as Array<{ verdict: string }>)[0].verdict).toBe('pass');
    // and the CLI over the SAME tree really exits 0
    const cli = runCli(['gate', '--repo', CONFORMANT, '--blueprint-dir', bpDir, '--extractor', 'ast']);
    expect(cli.code).toBe(0);
    expect(doc.exitCode).toBe(cli.code);
  });

  it('RED tree: gateFailed:true / exitCode:1 with the seeded violation named — matching the CLI', async () => {
    const result = await callTool('run_gate', { repoDir: DRIFT, blueprintDir: bpDir, extractor: 'ast' });
    expect(result.isError).toBe(false);
    const doc = toolStructured(result);
    expect(doc.gateFailed).toBe(true);
    expect(doc.outcome).toBe('violation');
    expect(doc.exitCode).toBe(1);
    const reports = doc.reports as Array<{ verdict: string; violations: Array<{ constraintId: string }> }>;
    expect(reports[0].verdict).toBe('fail');
    const ids = reports[0].violations.map((v) => v.constraintId).join(' ');
    expect(ids).toContain('no-direct-provider-sdk');
    // and the CLI over the SAME tree really exits 1
    const cli = runCli(['gate', '--repo', DRIFT, '--blueprint-dir', bpDir, '--extractor', 'ast']);
    expect(cli.code).toBe(1);
    expect(doc.exitCode).toBe(cli.code);
  });

  it('RED and GREEN produce OPPOSITE machine verdicts under the SAME blueprint', async () => {
    const green = toolStructured(await callTool('run_gate', { repoDir: CONFORMANT, blueprintDir: bpDir }));
    const red = toolStructured(await callTool('run_gate', { repoDir: DRIFT, blueprintDir: bpDir }));
    expect(green.gateFailed).toBe(false);
    expect(red.gateFailed).toBe(true);
    expect(green.exitCode).not.toBe(red.exitCode);
  });

  it('zero-argument done-check defaults to cwd and detects a live uncommitted drift', async () => {
    const liveRepo = join(tmp, 'live-default-repo');
    cpSync(CONFORMANT, liveRepo, { recursive: true });
    mkdirSync(join(liveRepo, '.blueprints'), { recursive: true });
    writeFileSync(join(liveRepo, '.blueprints', 'luna-chat-extension.blueprint.json'), readFileSync(BLUEPRINT, 'utf8'));
    const green = toolStructured(await callTool('run_gate', {}, liveRepo));
    expect(green.gateFailed).toBe(false);

    const source = join(liveRepo, 'src/extensions/luna-chat.extension.ts');
    writeFileSync(source, `import OpenAI from 'openai';\n${readFileSync(source, 'utf8')}`);
    const red = toolStructured(await callTool('run_gate', {}, liveRepo));
    expect(red.gateFailed).toBe(true);
    expect(red.exitCode).toBe(1);
    expect(JSON.stringify(red)).toContain('no-direct-provider-sdk');
  });

  it('REFUSAL: zero blueprints returns exit 2 and matches the CLI machine contract', async () => {
    const emptyBp = join(tmp, 'mcp-empty-blueprints');
    mkdirSync(emptyBp);
    const mcpDoc = toolStructured(await callTool('run_gate', {
      repoDir: CONFORMANT,
      blueprintDir: emptyBp,
      extractor: 'ast',
    }));
    expect(mcpDoc.gateFailed).toBe(true);
    expect(mcpDoc.outcome).toBe('refusal');
    expect(mcpDoc.exitCode).toBe(2);
    expect((mcpDoc.refusals as string[]).join(' ')).toContain('0 blueprint(s) discovered');

    const cliOut = join(tmp, 'cli-refusal.json');
    const cli = runCli([
      'gate', '--repo', CONFORMANT, '--blueprint-dir', emptyBp,
      '--extractor', 'ast', '--report-json', cliOut,
    ]);
    expect(cli.code).toBe(2);
    expect(mcpDoc).toEqual(JSON.parse(readFileSync(cliOut, 'utf8')));
  });

  it('FAIL-CLOSED: a missing repoDir is an isError result, never a silent pass', async () => {
    const result = await callTool('run_gate', { repoDir: join(tmp, 'no-such-repo'), blueprintDir: bpDir });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('repoDir not found');
  });

  it('BYTE-IDENTICAL: the MCP run_gate doc equals the CLI `gate --report-json` doc exactly', async () => {
    // The strongest THIN guarantee (COUNCIL-SYNTHESIS #20): both surfaces assemble the machine doc
    // through the ONE shared `assembleGateReportDoc`, so the MCP tool's structuredContent must be
    // byte-identical to what the CLI writes with --report-json over the same tree. If a future field
    // is added to one assembly path and not the other, THIS test goes red. Checked on BOTH verdicts.
    for (const tree of [CONFORMANT, DRIFT]) {
      const mcpDoc = toolStructured(await callTool('run_gate', { repoDir: tree, blueprintDir: bpDir, extractor: 'ast' }));
      const cliOut = join(tmp, `cli-report-${tree.endsWith('conformant') ? 'green' : 'red'}.json`);
      runCli(['gate', '--repo', tree, '--blueprint-dir', bpDir, '--extractor', 'ast', '--report-json', cliOut]);
      const cliDoc = JSON.parse(readFileSync(cliOut, 'utf8'));
      // Deep structural equality (order-independent) — every graded fact + the full reports[] tree
      // must match. A field present on one side and not the other is a divergence and reddens here.
      expect(mcpDoc).toEqual(cliDoc);
      // and the top-level field SETS are identical (belt-and-suspenders on the shape contract).
      expect(Object.keys(mcpDoc).sort()).toEqual(Object.keys(cliDoc).sort());
    }
  });
});

describe('bce-mcp — assess_teeth (thin over assessTeeth)', () => {
  it('grades a real blueprint against a real tree and returns a verdict + witnesses', async () => {
    const result = await callTool('assess_teeth', {
      blueprintPath: BLUEPRINT,
      repoDir: CONFORMANT,
      extractor: 'ast',
    });
    expect(result.isError).toBe(false);
    const doc = toolStructured(result);
    expect(['toothed', 'toothless', 'evaluator-refutable']).toContain(doc.verdict);
    expect(Array.isArray(doc.witnesses)).toBe(true);
    expect((doc.witnesses as unknown[]).length).toBeGreaterThan(0);
  });

  it('FAIL-CLOSED: a partial scan below the file floor is an isError, never a false all-clear', async () => {
    // an empty tree scans zero files → the fail-closed floor throws → isError.
    const emptyRepo = join(tmp, 'empty-repo');
    mkdirSync(emptyRepo, { recursive: true });
    const result = await callTool('assess_teeth', { blueprintPath: BLUEPRINT, repoDir: emptyRepo, extractor: 'ast' });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toMatch(/fail-closed|repoDir/i);
  });
});

describe('bce-mcp — get_report (logic-free re-read of a serialized report)', () => {
  it('re-reads a gate --report-json document the CLI wrote (never re-derives it)', async () => {
    // The CLI writes the machine report; get_report reads it back verbatim.
    const reportPath = join(tmp, 'gate-report.json');
    runCli(['gate', '--repo', CONFORMANT, '--blueprint-dir', bpDir, '--extractor', 'ast', '--report-json', reportPath]);
    const result = await callTool('get_report', { reportPath });
    expect(result.isError).toBe(false);
    const doc = toolStructured(result);
    expect(doc.schemaVersion).toBe('1');
    expect(doc.gateFailed).toBe(false);
    // byte-identical to what the CLI wrote (logic-free re-read)
    const onDisk = JSON.parse(readFileSync(reportPath, 'utf8'));
    expect(doc.gateFailed).toBe(onDisk.gateFailed);
    expect(doc.exitCode).toBe(onDisk.exitCode);
  });

  it('FAIL-CLOSED: a non-JSON report file is an isError result', async () => {
    const notJson = join(tmp, 'not.json');
    writeFileSync(notJson, 'this is not json');
    const result = await callTool('get_report', { reportPath: notJson });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain('not valid JSON');
  });
});
