import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'bce-package-proof-'));
const npmExecPath = process.env.npm_execpath;
const npm = (args, options) => npmExecPath
  ? execFileSync(process.execPath, [npmExecPath, ...args], options)
  : execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, options);

npm(['run', 'build'], { cwd: root, stdio: 'inherit' });
const packOutput = npm(['pack', '--json', '--pack-destination', scratch], { cwd: root, encoding: 'utf8' });
// Git/npm lifecycle output may precede npm's JSON when `prepare` builds the
// package. Parse the final JSON document, not the build log.
const jsonStart = packOutput.lastIndexOf('\n[');
const packed = JSON.parse(packOutput.slice(jsonStart >= 0 ? jsonStart + 1 : 0));
const tarball = join(scratch, packed[0].filename);
npm(['init', '-y'], { cwd: scratch, stdio: 'ignore' });
npm(['install', '--ignore-scripts', tarball], { cwd: scratch, stdio: 'inherit' });
const installedRoot = join(scratch, 'node_modules', 'bce-engine');
const output = execFileSync(process.execPath, [join(installedRoot, 'dist', 'cli.js'), 'demo'], { cwd: scratch, encoding: 'utf8' });

for (const marker of [
  'GREEN conformant: score 100, exit 0',
  'RED drift-forbidden-import:',
  'violation no-direct-provider-sdk',
  'package fixtures discriminate GREEN from RED',
]) {
  if (!output.includes(marker)) throw new Error(`packed consumer proof missing marker: ${marker}`);
}

const installed = JSON.parse(readFileSync(join(scratch, 'node_modules', 'bce-engine', 'package.json'), 'utf8'));
if (installed.engines?.node !== '>=22') throw new Error('packed package does not enforce Node >=22');
for (const rel of [
  'skills/bce/SKILL.md',
  'skills/bce/references/lifecycle.md',
  'scripts/model-adoption-eval.mjs',
  '.claude-plugin/plugin.json',
  'integrations/README.md',
  'docs/onboarding.md',
  'prompts/blueprint-author.md',
  'spec/schemas/engineering-blueprint.schema.json',
  'spec/skill-standard/SKILL-STANDARD.md',
  'spec/skill-standard/skill-standard.blueprint.json',
  'examples/quickstart/README.md',
  'evidence/example-chain/README.md',
  'tools/verify-chain.mjs',
  'action.yml',
  'llms.txt',
]) {
  readFileSync(join(installedRoot, rel));
}

// Release-facing instructions are part of the package interface. Every exact
// engine/Action/provenance pin they teach must describe THIS tarball, never the
// previously published patch. Historical Lane-A ceremony docs are deliberately
// outside this set because they describe the last admitted engine.
for (const rel of [
  'README.md',
  'docs/agent-loop.md',
  'docs/first-win.md',
  'docs/onboarding.md',
  'docs/quickstart.md',
  'examples/first-win/README.md',
  'examples/quickstart/README.md',
  'skills/README.md',
  'skills/bce/SKILL.md',
  'skills/bce/references/lifecycle.md',
  'llms.txt',
]) {
  const text = readFileSync(join(installedRoot, rel), 'utf8');
  for (const pattern of [
    /bce-engine@(\d+\.\d+\.\d+)/g,
    /bce-engine\/v\/(\d+\.\d+\.\d+)/g,
    /blueprint-conformance\/bce@v(\d+\.\d+\.\d+)/g,
    /Status: v(\d+\.\d+\.\d+) released/g,
  ]) {
    for (const match of text.matchAll(pattern)) {
      if (match[1] !== installed.version) {
        throw new Error(
          `packed release guidance is stale in ${rel}: ${match[0]} describes ${match[1]}, tarball is ${installed.version}`,
        );
      }
    }
  }
}
process.stdout.write(output);
process.stdout.write(`packed consumer proof: PASS (${packed[0].filename})\n`);
