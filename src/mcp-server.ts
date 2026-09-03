/**
 * bce-mcp — a THIN, logic-free MCP (Model Context Protocol) stdio server over the bce engine API.
 *
 * WHY THIN: this server is spec-churn insurance. It carries ZERO engine logic — every tool is a
 * literal shell that (1) validates its JSON-RPC arguments, (2) calls the SAME exported engine
 * function the `bce` CLI calls, and (3) serializes the result. There is no verdict, score, parse,
 * teeth, or gate decision computed here; if the engine's semantics change, this file does not, so
 * the MCP surface can never silently diverge from the CLI. It imports EXCLUSIVELY from the package
 * entrypoint (`./index.js`) — the one public surface — never a deep engine module.
 *
 * WHY HAND-ROLLED (zero new runtime deps): the package's fail-closed brand and its Docker-only,
 * dependency-audited build make a heavy MCP SDK a poor fit — it would add a transitive tree the
 * leakage/dependency posture must then vouch for. The MCP stdio transport is, by spec, plain
 * newline-delimited JSON-RPC 2.0 (one message per line, no embedded newlines, stdout is
 * MCP-messages-ONLY, stderr is for logs). That is ~120 lines of framing implemented below with
 * only the Node stdlib — no `@modelcontextprotocol/sdk`, no `zod` at the transport layer. DECISION
 * RECORDED: hand-rolled minimal JSON-RPC stdio, compatibility-gated by the exact Inspector version
 * locked in npm-shrinkwrap.json plus boundary tests; revisit if the protocol surface grows beyond
 * initialize / tools/list / tools/call / ping.
 *
 * FAIL-CLOSED (the brand): there are NO skip flags. A malformed `.bce-mode.json` or a hand-broken
 * baseline still THROWS through the engine and becomes a JSON-RPC error result (`isError: true`) —
 * the caller never receives a green-looking result it did not fail-close on. A tool that cannot
 * honestly answer returns an error, never a fabricated pass.
 *
 * Tools (read-only, safe autonomous surface — a THIN mirror of engine APIs):
 *   doctor_repository   → doctorRepository    (adoption/readiness diagnosis)
 *   check_baseline      → assessBaselineMaintenance (shrink/new-debt diagnosis)
 *   validate_blueprint  → parseBlueprint      (schema-validate an authored blueprint)
 *   run_gate            → computeGateReport    (the machine gate doc — identical to `gate --report-json`)
 *   assess_teeth        → assessTeeth          (the toothlessness/refutability grade)
 *   get_report          → (read a serialized report file the CLI already wrote — logic-free)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseBlueprint,
  computeGateReport,
  assessTeeth,
  resolveExtraction,
  makeExtractor,
  resolveTreeRevision,
  stableStringify,
  doctorRepository,
  runGate,
  readBaseline,
  assessBaselineMaintenance,
} from './index.js';

// ── JSON-RPC 2.0 framing (newline-delimited, per MCP stdio transport spec) ──────────────────────

/**
 * MCP protocol revisions this server supports, NEWEST FIRST (index 0 is the server's latest).
 *
 * Negotiation (MCP lifecycle spec, "Version Negotiation" — verified against
 * modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle): if the server supports the
 * client's requested protocolVersion it MUST respond with the SAME version; otherwise it MUST
 * respond with another version it supports, which SHOULD be the server's latest. The client then
 * decides (it SHOULD disconnect if it cannot use the responded version) — the server never errors
 * the initialize on a version mismatch.
 *
 * The list carries the four published initialize-handshake revisions (all verified on
 * modelcontextprotocol.io/specification). The 2026-07-28 revision replaced the initialize
 * handshake with per-request `_meta` version declaration and is deliberately NOT listed — this
 * server implements the handshake-based lifecycle, and claiming a revision whose negotiation
 * model it does not implement would be dishonest.
 *
 * The tool surface here (initialize / tools/list / tools/call / ping over newline-delimited
 * stdio JSON-RPC) is identical across all four revisions, so "supported" is honest for each.
 */
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;
const LATEST_PROTOCOL_VERSION: string = SUPPORTED_PROTOCOL_VERSIONS[0];

/** Spec-correct negotiation: echo a supported requested version; otherwise answer with the
 * server's latest (a missing/non-string request field is treated as "no usable request" → latest,
 * letting the client decide — never a protocol error, never a fabricated echo). */
function negotiateProtocolVersion(requested: unknown): string {
  if (
    typeof requested === 'string' &&
    (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
  ) {
    return requested;
  }
  return LATEST_PROTOCOL_VERSION;
}

const SERVER_NAME = 'bce-mcp';
const SERVER_VERSION = '2';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// JSON-RPC error codes (subset we use).
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const MAX_INBOUND_MESSAGE_BYTES = 1024 * 1024;

/** stderr is the ONLY channel this server may log to — stdout is reserved for MCP messages. */
function log(msg: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${msg}\n`);
}

/** Write one JSON-RPC message as a single line to stdout (no embedded newline — spec requirement). */
function send(message: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function sendResult(id: string | number | null, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function sendError(id: string | number | null, error: JsonRpcError): void {
  send({ jsonrpc: '2.0', id, error });
}

/** A tools/call success: MCP wraps tool output in a content array. `structuredContent` carries the
 * parsed object so an agent parses fields directly; the text block is the stable-serialized mirror. */
function toolResult(doc: unknown): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: stableStringify(doc) }],
    structuredContent: doc as Record<string, unknown>,
    isError: false,
  };
}

/** A tools/call failure: MCP convention is a NORMAL result with `isError: true` (so the model sees
 * the error text), NOT a protocol-level JSON-RPC error. Fail-closed: the message names the cause. */
function toolError(message: string): Record<string, unknown> {
  return {
    content: [{ type: 'text', text: `bce error: ${message}` }],
    isError: true,
  };
}

// ── Argument helpers (THIN validation only — never engine logic) ────────────────────────────────

function requireString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ToolArgError(`missing required string argument '${key}'`);
  }
  return v;
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new ToolArgError(`argument '${key}' must be a string`);
  return v;
}

class ToolArgError extends Error {}

/** The read side of a JSON file with a fail-closed, legible error surface (mirrors the CLI's die()
 * messages). Used by validate_blueprint (raw read) and get_report (read a serialized report). */
function readJsonFile(p: string): unknown {
  if (!fs.existsSync(p)) throw new ToolArgError(`file not found: ${p}`);
  let text: string;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch (e) {
    throw new ToolArgError(`could not read ${p}: ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ToolArgError(`file is not valid JSON: ${p}: ${(e as Error).message}`);
  }
}

// Safe autonomous tools are read-only. Policy approval/mutation verbs are intentionally absent.

const TOOL_DEFINITIONS = [
  {
    name: 'doctor_repository',
    description: 'Read-only adoption/readiness audit. Returns typed ready, needs-action, or refusal checks; mutates nothing.',
    annotations: { title: 'Diagnose BCE adoption', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        repoDir: { type: 'string', description: 'Repository tree to inspect (default: MCP server working directory).' },
        blueprintDir: { type: 'string', description: 'Optional blueprint directory.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'check_baseline',
    description: 'Read-only baseline maintenance check. Identifies removable debt and unaccepted new violations without changing policy.',
    annotations: { title: 'Check BCE baseline', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        repoDir: { type: 'string', description: 'Repository tree to inspect (default: MCP server working directory).' },
        blueprintDir: { type: 'string', description: 'Optional blueprint directory.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'validate_blueprint',
    description:
      'Schema-validate an authored EngineeringBlueprint JSON file (the SAME parse the `bce` CLI ' +
      'runs before any gate). Returns { valid, id, version } on success, or a fail-closed error ' +
      'with the exact schema message. Fix the blueprint until this is valid before gating.',
    annotations: { title: 'Validate BCE blueprint', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        blueprintPath: { type: 'string', description: 'Path to the .blueprint.json file to validate.' },
      },
      required: ['blueprintPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_gate',
    description:
      'Run the blueprint-conformance PR gate over a repository tree and return the machine gate ' +
      'document — BYTE-IDENTICAL to `bce gate --report-json`. Discovers every blueprint under the ' +
      'blueprint dir, grades those whose scope intersects the changed files (or all, on a full ' +
      'sweep), honors the committed .bce-mode.json posture (advisory/enforced) and .blueprints/' +
      'baseline.json — no skip flags. Read gateFailed / exitCode / reports[] to self-correct. ' +
      'Fail-closed: a malformed mode/baseline config is an error, never a silent pass.',
    annotations: { title: 'Run BCE done-check', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        repoDir: { type: 'string', description: 'The repository tree to gate (default: MCP server working directory).' },
        blueprintDir: {
          type: 'string',
          description: 'Authored-blueprint directory (default <repoDir>/.blueprints).',
        },
        changed: {
          type: 'array',
          items: { type: 'string' },
          description: 'Repo-relative changed files to scope the gate. Omit for a full sweep.',
        },
        extractor: {
          type: 'string',
          enum: ['ast', 'line-scan'],
          description: "Extractor kind (default 'ast' — faithful; 'line-scan' has no symbol table).",
        },
        repoName: {
          type: 'string',
          description: 'Optional repo identity (stamps report.repo + fail-closed scope check).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'assess_teeth',
    description:
      'Grade a blueprint’s TEETH (the toothlessness gate, `bce teeth`): a constraint has teeth ' +
      'iff a realistic architecture-graph mutation would redden it. verdict "toothless" means a ' +
      'green gate would prove nothing. Deterministic, static — no runtime, no network. Fail-closed: ' +
      'a scan below the blueprint’s file floor is an error, never a false all-clear.',
    annotations: { title: 'Assess blueprint teeth', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        blueprintPath: { type: 'string', description: 'Path to the .blueprint.json to grade.' },
        repoDir: { type: 'string', description: 'The repository tree to build the observed graph from (default: MCP server working directory).' },
        extractor: {
          type: 'string',
          enum: ['ast', 'line-scan'],
          description: "Extractor kind (default 'ast').",
        },
      },
      required: ['blueprintPath'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_report',
    description:
      'Read a serialized report JSON document the engine already wrote (a compliance-report.json, a ' +
      'gate --report-json doc, or a teeth-report.json) and return it parsed. Purely logic-free — it ' +
      'RE-READS a graded fact, never re-derives one. Fail-closed: a missing or non-JSON file is an error.',
    annotations: { title: 'Read BCE report', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        reportPath: { type: 'string', description: 'Path to a report JSON file the engine wrote.' },
      },
      required: ['reportPath'],
      additionalProperties: false,
    },
  },
] as const;

/**
 * Build the observed ArchitectureGraph over a LIVE working tree (no revision pinning — the tree is
 * scanned in place). Mirrors the CLI's no-pin path: resolveExtraction → makeExtractor → extract,
 * with the SAME fail-closed floor (a scan below the blueprint-derived minFiles can never honestly
 * grade, so it throws rather than return a false-clean graph). Zero engine logic — pure composition
 * of exported calls.
 */
function buildLiveGraph(bp: ReturnType<typeof parseBlueprint>, repoDir: string, extractor: 'ast' | 'line-scan') {
  if (!fs.existsSync(repoDir)) throw new ToolArgError(`repoDir not found: ${repoDir}`);
  const cfg = resolveExtraction(bp.extraction, bp.constraints);
  const revision = resolveTreeRevision(repoDir);
  const graph = makeExtractor(extractor, cfg).extract(repoDir, revision);
  if (graph.coverage.filesScanned < cfg.minFiles) {
    throw new ToolArgError(
      `fail-closed: scanned ${graph.coverage.filesScanned} file(s), expected >= ${cfg.minFiles} for ` +
        `the '${cfg.profile}' profile. An empty/partial scan can never grade honestly (revision ${revision}).`,
    );
  }
  return graph;
}

/** Dispatch one tools/call. Returns the MCP tool-result object (success or isError). */
function callTool(name: string, rawArgs: unknown): Record<string, unknown> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  try {
    switch (name) {
      case 'doctor_repository': {
        const repoDir = optionalString(args, 'repoDir') ?? process.cwd();
        const blueprintDir = optionalString(args, 'blueprintDir') ?? path.join(repoDir, '.blueprints');
        return toolResult(doctorRepository(repoDir, blueprintDir));
      }
      case 'check_baseline': {
        const repoDir = optionalString(args, 'repoDir') ?? process.cwd();
        const blueprintDir = optionalString(args, 'blueprintDir') ?? path.join(repoDir, '.blueprints');
        const gate = runGate(repoDir, blueprintDir, null, 'ast');
        // Diagnosis only: expose the typed maintenance result, not the write
        // plan. MCP cannot create or grow policy and should not imply it can.
        return toolResult(assessBaselineMaintenance(gate.reports, readBaseline(repoDir), gate.refusals ?? []).result);
      }
      case 'validate_blueprint': {
        const p = requireString(args, 'blueprintPath');
        const raw = readJsonFile(p); // fail-closed read
        const bp = parseBlueprint(raw); // the engine's authoritative parse — THROWS on invalid
        return toolResult({
          valid: true,
          blueprintRef: `${bp.metadata.id}@${bp.metadata.version}`,
          id: bp.metadata.id,
          version: bp.metadata.version,
          constraints: bp.constraints.length,
        });
      }
      case 'run_gate': {
        const repoDir = optionalString(args, 'repoDir') ?? process.cwd();
        if (!fs.existsSync(repoDir)) return toolError(`repoDir not found: ${repoDir}`);
        const blueprintDir = optionalString(args, 'blueprintDir') ?? path.join(repoDir, '.blueprints');
        const extractor = (optionalString(args, 'extractor') ?? 'ast') as 'ast' | 'line-scan';
        if (extractor !== 'ast' && extractor !== 'line-scan') {
          return toolError(`extractor must be 'ast' or 'line-scan'`);
        }
        const repoName = optionalString(args, 'repoName');
        let changed: string[] | null = null;
        if (args.changed !== undefined) {
          if (!Array.isArray(args.changed) || !args.changed.every((c) => typeof c === 'string')) {
            return toolError(`argument 'changed' must be an array of strings`);
          }
          changed = (args.changed as string[]).map((s) => s.trim()).filter(Boolean);
          if (changed.length === 0) changed = null;
        }
        // The engine's SINGLE gate-doc composition — identical to `bce gate --report-json`. Throws
        // ModeConfigError / BaselineError on a malformed committed config (fail-closed, no skip).
        const { doc } = computeGateReport(repoDir, blueprintDir, changed, extractor, repoName);
        return toolResult(doc);
      }
      case 'assess_teeth': {
        const p = requireString(args, 'blueprintPath');
        const repoDir = optionalString(args, 'repoDir') ?? process.cwd();
        const extractor = (optionalString(args, 'extractor') ?? 'ast') as 'ast' | 'line-scan';
        if (extractor !== 'ast' && extractor !== 'line-scan') {
          return toolError(`extractor must be 'ast' or 'line-scan'`);
        }
        const bp = parseBlueprint(readJsonFile(p)); // fail-closed parse
        const cfg = resolveExtraction(bp.extraction, bp.constraints);
        const graph = buildLiveGraph(bp, repoDir, extractor);
        const teeth = assessTeeth(bp, graph, cfg.profile); // the engine's authoritative grade
        return toolResult(teeth);
      }
      case 'get_report': {
        const p = requireString(args, 'reportPath');
        const doc = readJsonFile(p); // logic-free: re-read a graded fact, never re-derive it
        return toolResult(doc);
      }
      default:
        return toolError(`unknown tool: ${name}`);
    }
  } catch (e) {
    // Every engine throw (schema validation, mode/baseline malformed, fail-closed floor) becomes a
    // legible isError result — the brand's fail-closed contract at the tool boundary.
    return toolError((e as Error).message);
  }
}

// ── Method dispatch ─────────────────────────────────────────────────────────────────────────────

function handleRequest(req: JsonRpcRequest): void {
  // JSON-RPC notifications never receive a response. BCE's only relevant MCP
  // notifications are lifecycle/cancellation signals; tools are synchronous and
  // read-only, so a cancellation arriving between calls is acknowledged by silence.
  if (req.id === undefined) return;
  const id = req.id ?? null;
  switch (req.method) {
    case 'initialize': {
      sendResult(id, {
        protocolVersion: negotiateProtocolVersion((req.params ?? {})['protocolVersion']),
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Start with doctor_repository. Use run_gate as the done-check after every code change; ' +
          'it defaults to the server working directory and scans the live tree. On RED, fix the ' +
          'named code violation and rerun—never silently edit a blueprint or baseline. Use ' +
          'validate_blueprint for contract syntax, assess_teeth to prove a contract can fail, ' +
          'check_baseline for debt maintenance, and get_report only to reread an existing report. ' +
          'All tools are read-only; policy changes require attended CLI review.',
      });
      return;
    }
    case 'tools/list': {
      sendResult(id, { tools: TOOL_DEFINITIONS });
      return;
    }
    case 'tools/call': {
      const params = req.params ?? {};
      const name = params.name;
      if (typeof name !== 'string') {
        sendError(id, { code: INVALID_PARAMS, message: 'tools/call requires a string params.name' });
        return;
      }
      const result = callTool(name, params.arguments);
      sendResult(id, result);
      return;
    }
    case 'ping': {
      sendResult(id, {});
      return;
    }
    default: {
      // Notifications (id === undefined) require NO response per JSON-RPC — swallow them (e.g.
      // notifications/initialized, notifications/cancelled).
      if (req.id === undefined) return;
      sendError(id, { code: METHOD_NOT_FOUND, message: `method not found: ${req.method}` });
    }
  }
}

// ── stdin reader: newline-delimited JSON-RPC (buffer until a full line arrives) ──────────────────

function main(): void {
  let buffer = '';
  const processLine = (raw: string): void => {
    const line = raw.trim();
    if (line.length === 0) return;
    if (Buffer.byteLength(line, 'utf8') > MAX_INBOUND_MESSAGE_BYTES) {
      sendError(null, { code: INVALID_REQUEST, message: `message exceeds ${MAX_INBOUND_MESSAGE_BYTES} byte limit` });
      return;
    }
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(line) as JsonRpcRequest;
    } catch {
      sendError(null, { code: PARSE_ERROR, message: 'invalid JSON on stdin' });
      return;
    }
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      // A response has no `method`; per JSON-RPC we only receive requests/notifications here.
      if (req.id !== undefined) {
        sendError(req.id ?? null, { code: INVALID_REQUEST, message: 'not a valid JSON-RPC 2.0 request' });
      }
      return;
    }
    try {
      handleRequest(req);
    } catch (e) {
      // A handler throw must never crash the server (fail-closed availability) — surface it.
      if (req.id !== undefined) {
        sendError(req.id ?? null, { code: -32603, message: `internal error: ${(e as Error).message}` });
      }
      log(`internal error handling ${req.method}: ${(e as Error).message}`);
    }
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    if (!buffer.includes('\n') && Buffer.byteLength(buffer, 'utf8') > MAX_INBOUND_MESSAGE_BYTES) {
      sendError(null, { code: INVALID_REQUEST, message: `message exceeds ${MAX_INBOUND_MESSAGE_BYTES} byte limit` });
      buffer = '';
      return;
    }
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      processLine(line);
    }
  });
  process.stdin.on('end', () => {
    // Clients normally newline-terminate stdio messages. Processing a complete
    // final frame at EOF is cheap interoperability insurance; malformed tails
    // still receive the normal parse error.
    if (buffer.trim().length > 0) processLine(buffer);
  });
  log('ready (stdio, newline-delimited JSON-RPC 2.0)');
}

main();
