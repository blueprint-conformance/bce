#!/usr/bin/env node
/** Exercise the actual checked-in project MCP configuration and canonical skill installation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import './sync-self-agent-skills.mjs';
const config = JSON.parse(readFileSync('.mcp.json', 'utf8')).mcpServers.bce;
assert.deepEqual(config, { command: 'node', args: ['dist/mcp-server.js'] });
const codex = readFileSync('.codex/config.toml', 'utf8');
assert.match(codex, /\[mcp_servers\.bce\]\s+command = "node"\s+args = \["dist\/mcp-server\.js"\]/);
const input = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bce-self-agent-proof', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_gate', arguments: {} } },
].map(JSON.stringify).join('\n') + '\n';
const run = spawnSync(process.execPath, config.args, { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
assert.equal(run.status, 0, run.stderr);
const responses = run.stdout.trim().split('\n').map(JSON.parse);
const tools = responses.find((response) => response.id === 2)?.result?.tools;
assert.equal(tools?.length, 10);
assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint === false));
const gate = responses.find((response) => response.id === 3)?.result;
assert.equal(gate?.isError, false);
assert.ok(gate.structuredContent.reports.length > 0);
assert.ok(gate.structuredContent.reports.every((report) => report.verdict === 'pass'));
assert.equal(gate.structuredContent.refusals?.length ?? 0, 0);
console.log('Self-agent proof: project configuration starts the built server, exposes ten read-only tools, and gates this live checkout GREEN.');
