# MCP compatibility contract

`bce-mcp` is a read-only stdio adapter over the same exported engine functions used by the CLI. It exposes exactly ten tools and contains no scoring, verdict, policy-mutation, decision-recording, or baseline-growth logic. The four review tools are `inspect_blueprint`, `explain_constraint`, `compare_blueprint_policy`, and `verify_review_packet`; proposal generation and human decisions remain outside MCP.

## Enforced compatibility

Every CI and release run builds the distributable server and executes `npm run test:mcp-compatibility`. That proof:

1. starts `dist/mcp-server.js` through the exact `@modelcontextprotocol/inspector@2.5.0` version in `npm-shrinkwrap.json`;
2. uses Inspector strict mode to discover the complete ten-tool surface;
3. repeats a real initialize, initialized-notification, and tools/list session ten times; and
4. fails when startup plus discovery p95 exceeds 2,000 ms.

The Vitest protocol suite separately exercises every tool, supported-version negotiation, malformed JSON recovery, the 1 MiB inbound-message ceiling, notification silence, final-frame handling at EOF, and multi-megabyte outbound reports.

Supported handshake revisions, newest first, are `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`. Unsupported requested versions receive the newest supported revision so the client can accept it or disconnect.

## Deliberate limits

- Transport is newline-delimited JSON-RPC 2.0 over stdio. Stdout contains protocol messages only; diagnostics go to stderr.
- Requests above 1 MiB are rejected. Outbound report content is not truncated.
- Notifications receive no response. Tools execute synchronously and are read-only, so cancellation is recognized as a silent notification boundary but cannot preempt a tool already executing.
- The transport remains hand-written to avoid adding an MCP SDK runtime tree. This choice is conditional: Inspector compatibility and protocol boundary tests are release gates, and growth beyond initialize/list/call/ping triggers an SDK reassessment.
- Compatibility with a named host is claimed only after a recorded run in that host. Inspector compatibility does not substitute for a host-specific proof.

For Codex, register the server as a project-scoped stdio MCP server in `.codex/config.toml` only in a trusted project, or use `codex mcp add`; Codex reads server tool definitions and instructions during startup. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp/).
