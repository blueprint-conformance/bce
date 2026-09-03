#!/usr/bin/env node
/** Release-grade MCP compatibility proof over the built distributable. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const inspectorVersion = pkg.devDependencies?.['@modelcontextprotocol/inspector'];
if (inspectorVersion !== '2.5.0') {
  throw new Error(`Inspector proof requires exact @modelcontextprotocol/inspector 2.5.0; found ${inspectorVersion ?? 'none'}`);
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 19)) {
  throw new Error(`Inspector 2.5.0 requires Node >=22.19.0; running ${process.versions.node}`);
}

const server = join(root, 'dist', 'mcp-server.js');
const inspector = join(root, 'node_modules', '@modelcontextprotocol', 'inspector', 'clients', 'launcher', 'build', 'index.js');
const expectedTools = [
  'assess_teeth',
  'check_baseline',
  'doctor_repository',
  'get_report',
  'run_gate',
  'validate_blueprint',
];

const inspected = spawnSync(
  process.execPath,
  [inspector, '--cli', process.execPath, server, '--method', 'tools/list', '--strict', '--format', 'json'],
  { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
);
if (inspected.error) throw inspected.error;
if (inspected.status !== 0) {
  throw new Error(`Inspector ${inspectorVersion} failed (${inspected.status}):\n${inspected.stderr}\n${inspected.stdout}`);
}
const inspectorLines = inspected.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
const inspectorDoc = JSON.parse(inspectorLines.at(-1));
const inspectedTools = inspectorDoc.result?.tools?.map((tool) => tool.name).sort();
if (JSON.stringify(inspectedTools) !== JSON.stringify(expectedTools)) {
  throw new Error(`Inspector returned unexpected tool surface: ${JSON.stringify(inspectedTools)}`);
}

const request = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'bce-proof', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
].map((frame) => JSON.stringify(frame)).join('\n') + '\n';

const samples = [];
for (let attempt = 0; attempt < 10; attempt += 1) {
  const started = performance.now();
  const direct = spawnSync(process.execPath, [server], {
    cwd: root,
    input: request,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  samples.push(performance.now() - started);
  if (direct.error) throw direct.error;
  if (direct.status !== 0) throw new Error(`direct MCP discovery failed (${direct.status}): ${direct.stderr}`);
  const responses = direct.stdout.split('\n').map((line) => line.trim()).filter(Boolean).map(JSON.parse);
  if (responses.length !== 2) throw new Error(`notifications must be silent; received ${responses.length} responses`);
  if (responses[0]?.result?.protocolVersion !== '2025-11-25') throw new Error('initialize did not negotiate 2025-11-25');
  const names = responses[1]?.result?.tools?.map((tool) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedTools)) throw new Error(`direct discovery surface drift: ${JSON.stringify(names)}`);
}

samples.sort((a, b) => a - b);
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
const sloMs = 2000;
if (p95 > sloMs) throw new Error(`MCP startup + discovery p95 ${p95.toFixed(1)}ms exceeds ${sloMs}ms SLO`);

console.log(`MCP compatibility: PASS — Inspector ${inspectorVersion}, ${expectedTools.length} tools, discovery p95 ${p95.toFixed(1)}ms/10 (SLO ${sloMs}ms), Node ${process.versions.node}`);
