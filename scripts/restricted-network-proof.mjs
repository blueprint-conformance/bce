#!/usr/bin/env node
/** Prove built BCE runtime paths work while every Node networking surface throws. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const hook = resolve(root, 'scripts', 'network-deny-hook.mjs');
const cli = resolve(root, 'dist', 'cli.js');
const mcp = resolve(root, 'dist', 'mcp-server.js');
const scratch = mkdtempSync(join(tmpdir(), 'bce-network-deny-'));
const hostileProxy = 'http://127.0.0.1:9';
const env = {
  ...process.env,
  HTTP_PROXY: hostileProxy,
  HTTPS_PROXY: hostileProxy,
  ALL_PROXY: hostileProxy,
  NO_PROXY: '',
  npm_config_registry: 'http://127.0.0.1:9/',
  npm_config_proxy: hostileProxy,
  npm_config_https_proxy: hostileProxy,
};
const run = (entry, args = [], input) => spawnSync(process.execPath, ['--import', hook, entry, ...args], {
  cwd: root, env, input, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});
const expect = (name, result, status, marker) => {
  if (result.status !== status || (marker && !`${result.stdout}\n${result.stderr}`.includes(marker))) {
    throw new Error(`${name}: expected exit ${status}${marker ? ` and ${marker}` : ''}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  if (`${result.stdout}\n${result.stderr}`.includes('BCE_NETWORK_DENIED')) throw new Error(`${name}: attempted network access`);
};

try {
  const probe = join(scratch, 'network-probe.mjs');
  writeFileSync(probe, "import https from 'node:https'; https.get('https://example.com');\n");
  const denied = run(probe);
  if (denied.status === 0 || !denied.stderr.includes('BCE_NETWORK_DENIED:https.get')) {
    throw new Error(`negative control did not detect HTTPS access\n${denied.stderr}`);
  }

  expect('validate', run(cli, ['validate', '--blueprint', 'fixtures/luna-chat-extension.blueprint.json']), 0, 'blueprint VALID');
  const bp = join(scratch, 'blueprints');
  const setup = spawnSync(process.execPath, ['-e', `require('node:fs').mkdirSync(${JSON.stringify(bp)});require('node:fs').copyFileSync('fixtures/luna-chat-extension.blueprint.json',${JSON.stringify(join(bp, 'network-proof.blueprint.json'))})`], { cwd: root, encoding: 'utf8' });
  if (setup.status !== 0) throw new Error(`fixture setup failed: ${setup.stderr}`);
  expect('GREEN gate', run(cli, ['gate', '--repo', 'fixtures/extension-surface/conformant', '--blueprint-dir', bp, '--extractor', 'ast']), 0, 'score 100 (pass)');
  expect('RED gate', run(cli, ['gate', '--repo', 'fixtures/extension-surface/drift-forbidden-import', '--blueprint-dir', bp, '--extractor', 'ast']), 1, 'no-direct-provider-sdk');
  expect('evidence verifier', run(resolve(root, 'tools', 'verify-chain.mjs'), ['evidence/example-chain']), 0, 'CHAIN INTACT');
  const frames = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ].map(JSON.stringify).join('\n') + '\n';
  expect('MCP discovery', run(mcp, [], frames), 0, 'validate_blueprint');
  console.log('restricted-network proof: PASS (network negative control fired; validate, GREEN/RED gate, evidence verify, and MCP discovery stayed local under hostile proxy/registry settings)');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
