#!/usr/bin/env node

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve('.');
const fixture = mkdtempSync(join(tmpdir(), 'bce-codex-plugin-'));
const run = () => spawnSync(process.execPath, [join(root, 'scripts/validate-codex-plugin.mjs'), '--root', fixture], { encoding: 'utf8' });

try {
  cpSync(join(root, '.codex-plugin'), join(fixture, '.codex-plugin'), { recursive: true });
  cpSync(join(root, 'skills'), join(fixture, 'skills'), { recursive: true });
  const valid = run();
  if (valid.status !== 0) throw new Error(`valid plugin rejected:\n${valid.stderr}`);

  const path = join(fixture, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.skills = '../skills';
  manifest.mcpServers = './.mcp.json';
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const invalid = run();
  if (invalid.status === 0 || !invalid.stderr.includes('skills must be ./skills/') || !invalid.stderr.includes('existing .mcp.json')) {
    throw new Error(`unsafe paths or phantom MCP companion were not rejected:\n${invalid.stdout}${invalid.stderr}`);
  }
  cpSync(join(root, '.codex-plugin'), join(fixture, '.codex-plugin'), { recursive: true, force: true });
  const skillPath = join(fixture, 'skills', 'skill-tuning', 'SKILL.md');
  const skill = readFileSync(skillPath, 'utf8').replace('description: "Grade', 'description: Grade').replace('fires and nobody can say why."', 'fires and nobody can say why.');
  writeFileSync(skillPath, skill);
  const invalidYaml = run();
  if (invalidYaml.status === 0 || !invalidYaml.stderr.includes('quoted YAML')) {
    throw new Error(`ambiguous YAML description was not rejected:\n${invalidYaml.stdout}${invalidYaml.stderr}`);
  }
  process.stdout.write('codex-plugin validator self-test: PASS (valid archive accepted; path escape, phantom MCP, and ambiguous YAML rejected)\n');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
