#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, normalize, relative, resolve, sep } from 'node:path';

const rootIndex = process.argv.indexOf('--root');
const root = resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] ?? '' : '.');
const manifestPath = join(root, '.codex-plugin', 'plugin.json');
const failures = [];

const fail = (message) => failures.push(message);
const requiredString = (object, key, label = key) => {
  if (typeof object?.[key] !== 'string' || object[key].trim() === '') fail(`${label} must be a non-empty string`);
};
const optionalHttps = (object, key, label = key) => {
  if (object?.[key] === undefined) return;
  try {
    if (new URL(object[key]).protocol !== 'https:') fail(`${label} must be an absolute HTTPS URL`);
  } catch {
    fail(`${label} must be an absolute HTTPS URL`);
  }
};
const resolveInside = (raw, label) => {
  if (typeof raw !== 'string' || !raw.startsWith('./')) {
    fail(`${label} must start with ./`);
    return null;
  }
  const target = resolve(root, normalize(raw));
  const rel = relative(root, target);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    fail(`${label} escapes the plugin root`);
    return null;
  }
  return target;
};

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  fail(`cannot parse .codex-plugin/plugin.json: ${error.message}`);
  manifest = {};
}

const allowedTop = new Set([
  'name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords',
  'skills', 'mcpServers', 'apps', 'interface',
]);
for (const key of Object.keys(manifest)) if (!allowedTop.has(key)) fail(`unsupported plugin field ${key}`);
requiredString(manifest, 'name');
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name ?? '')) fail('name must be lower-case kebab-case');
requiredString(manifest, 'version');
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version ?? '')) fail('version must be strict semver');
requiredString(manifest, 'description');
requiredString(manifest.author, 'name', 'author.name');
optionalHttps(manifest.author, 'url', 'author.url');
optionalHttps(manifest, 'homepage');
optionalHttps(manifest, 'repository');

if (manifest.skills !== './skills/') fail('skills must be ./skills/');
const skillsRoot = resolveInside(manifest.skills, 'skills');
for (const name of ['bce', 'skill-tuning']) {
  const skill = skillsRoot && join(skillsRoot, name, 'SKILL.md');
  if (!skill || !existsSync(skill)) fail(`missing packaged skill skills/${name}/SKILL.md`);
  else {
    const text = readFileSync(skill, 'utf8');
    if (!text.startsWith('---\n') || !new RegExp(`\\nname:\\s*${name.replace('-', '\\-')}\\s*\\n`).test(text)) {
      fail(`skills/${name}/SKILL.md has invalid or mismatched frontmatter`);
    }
    const frontmatter = text.slice(4, text.indexOf('\n---', 4));
    const description = frontmatter.split('\n').find((line) => line.startsWith('description:')) ?? '';
    const value = description.slice('description:'.length).trim();
    if (value.includes(': ') && !/^(["']).*\1$/.test(value)) {
      fail(`skills/${name}/SKILL.md description with a colon must be quoted YAML`);
    }
  }
}

if (manifest.mcpServers !== undefined) {
  const path = resolveInside(manifest.mcpServers, 'mcpServers');
  if (!path || basename(path) !== '.mcp.json' || !existsSync(path)) fail('mcpServers must reference an existing .mcp.json');
}
if (manifest.apps !== undefined) {
  const path = resolveInside(manifest.apps, 'apps');
  if (!path || basename(path) !== '.app.json' || !existsSync(path)) fail('apps must reference an existing .app.json');
}

const ui = manifest.interface;
for (const key of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
  requiredString(ui, key, `interface.${key}`);
}
if (!Array.isArray(ui?.capabilities) || ui.capabilities.length === 0 || ui.capabilities.some((item) => typeof item !== 'string' || item.trim() === '')) {
  fail('interface.capabilities must be a non-empty string array');
}
if (!Array.isArray(ui?.defaultPrompt) || ui.defaultPrompt.length === 0 || ui.defaultPrompt.length > 3) {
  fail('interface.defaultPrompt must contain one to three prompts');
} else if (ui.defaultPrompt.some((prompt) => typeof prompt !== 'string' || prompt.length === 0 || prompt.length > 128)) {
  fail('interface.defaultPrompt entries must contain 1-128 characters');
}
if (ui?.brandColor !== undefined && !/^#[0-9A-F]{6}$/i.test(ui.brandColor)) fail('interface.brandColor must be #RRGGBB');
optionalHttps(ui, 'websiteURL', 'interface.websiteURL');
optionalHttps(ui, 'privacyPolicyURL', 'interface.privacyPolicyURL');
optionalHttps(ui, 'termsOfServiceURL', 'interface.termsOfServiceURL');
if (JSON.stringify(manifest).includes('[TODO:')) fail('manifest contains a TODO placeholder');

if (failures.length > 0) {
  process.stderr.write(`codex-plugin-validation: FAIL (${failures.length})\n${failures.map((item) => `- ${item}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`codex-plugin-validation: PASS (${manifest.name}@${manifest.version}; skills-only)\n`);
