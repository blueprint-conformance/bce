#!/usr/bin/env node
/**
 * Turns the public install path a new user reads into a shell script that runs it.
 *
 * The commands are taken from the documents themselves (fenced `sh` / `bash` blocks, and a
 * `powershell` block where a document gives one in place of the block before it), so a doc
 * that drifts from what actually works on an OS turns this proof red. Each command runs as a
 * separate step in ONE shell session, the way a user pastes them, and each is checked for its
 * documented exit code and output markers. A command this proof does not recognise must exit 0.
 *
 * Used by .github/workflows/public-install.yml. Dependency-free: node: builtins only.
 *
 *   node scripts/public-install-walkthrough.mjs --doc README.md --section "Run a real gate" \
 *     --shell bash|pwsh --pin .engine-pin.json --out walkthrough.sh [--execution-policy restricted]
 *
 * --execution-policy restricted (pwsh only) generates a script for Windows PowerShell 5.1 under the
 * policy a Windows client has when nobody has set one. There, `npm` and `npx` resolve to the
 * unsigned npm.ps1 / npx.ps1 shims Node ships, and PowerShell refuses them with "running scripts is
 * disabled". The script first proves that bare `npm` really is refused, then runs the documented
 * commands with the workaround the document itself gives (`npm.cmd` / `npx.cmd`), and only when the
 * document gives it. A document that loses its Windows note therefore turns that leg red.
 */
import { readFileSync, writeFileSync } from 'node:fs';

function arg(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && !value) fail(`missing --${name}`);
  return value;
}

function fail(message) {
  process.stderr.write(`public-install-walkthrough: ${message}\n`);
  process.exit(2);
}

const docPath = arg('doc');
const section = arg('section', false);
const shell = arg('shell');
const out = arg('out');
const pin = JSON.parse(readFileSync(arg('pin'), 'utf8'));
if (shell !== 'bash' && shell !== 'pwsh') fail(`--shell must be bash or pwsh, got ${shell}`);
const policy = arg('execution-policy', false);
if (policy !== undefined && (policy !== 'restricted' || shell !== 'pwsh')) {
  fail('--execution-policy takes only "restricted", and only with --shell pwsh');
}
if (pin.package !== 'bce-engine' || !/^\d+\.\d+\.\d+$/.test(pin.pin ?? '') || pin.published !== true) {
  fail('.engine-pin.json does not name an exact published bce-engine version');
}
if (!/^sha512-/.test(pin.integrity ?? '')) fail('.engine-pin.json has no sha512 integrity');

let text = readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
if (section) {
  const start = text.search(new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'));
  if (start < 0) fail(`${docPath} has no "## ${section}" section`);
  const rest = text.slice(start + 3);
  const end = rest.search(/^## /m);
  text = text.slice(start, end < 0 ? undefined : start + 3 + end);
}

// Fenced blocks in document order, with the language tag.
const blocks = [...text.matchAll(/^```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)^```\s*$/gm)].map((m) => ({
  lang: m[1].toLowerCase(),
  body: m[2],
}));
const POSIX = new Set(['sh', 'bash', 'shell']);
const PWSH = new Set(['powershell', 'pwsh', 'ps1']);
const chosen = [];
for (let i = 0; i < blocks.length; i += 1) {
  const block = blocks[i];
  if (POSIX.has(block.lang)) {
    const next = blocks[i + 1];
    if (shell === 'pwsh' && next && PWSH.has(next.lang)) continue; // replaced by the PowerShell block
    chosen.push(block);
  } else if (PWSH.has(block.lang)) {
    const previous = blocks[i - 1];
    if (!previous || !POSIX.has(previous.lang)) fail(`${docPath}: a powershell block must directly follow the sh/bash block it replaces`);
    if (shell === 'pwsh') chosen.push(block);
  }
}
const commands = chosen
  .flatMap((block) => block.body.split('\n'))
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));
if (commands.length === 0) fail(`${docPath}${section ? ` § ${section}` : ''} has no runnable sh/bash commands`);

// Under a Restricted policy the reader gets past npm.ps1 / npx.ps1 only by doing what the
// document says, so the `npm.cmd` / `npx.cmd` workaround is applied only where the document states it.
const BLOCKED = 'running scripts is disabled';
const shim = { npm: false, npx: false };
if (policy === 'restricted') {
  const note = text.includes(BLOCKED);
  shim.npm = note && text.includes('npm.cmd');
  shim.npx = note && text.includes('npx.cmd');
  if (!shim.npm || !shim.npx) {
    const where = `${docPath}${section ? ` § ${section}` : ''}`;
    process.stderr.write(
      `public-install-walkthrough: ${where} has no Windows note on "${BLOCKED}" naming npm.cmd and npx.cmd; ` +
        'its commands run as written and PowerShell will refuse them\n',
    );
  }
}
const asTyped = (command) => command.replace(/^(npm|npx)(?=\s|$)/, (word) => (shim[word] ? `${word}.cmd` : word));

const version = pin.pin;
const RED = ['forbidden edge extension:greeting.plugin -> axios is present', 'src/greeting.plugin.ts#L16', '1 failing'];
const GREEN = ['0 failing'];
const DRIFT_IMPORT = "import axios from 'axios';";
const DRIFT_CALL = "const res = await axios.get('https://example.com/greeting');";
const FIXED_CALL = "const res = await host.fetch('/greeting');";

const steps = [];
const seen = { install: false, red: new Set(), greenAfterRed: false, demo: false, fixedBy: false };
for (const command of commands) {
  const pkgRef = command.match(/bce-engine@([^\s'"]+)/);
  if (pkgRef && pkgRef[1] !== version) {
    fail(`${docPath} names bce-engine@${pkgRef[1]} but .engine-pin.json pins ${version}: "${command}"`);
  }
  const sub = (command.match(/(?:^|\s)bce\s+([a-z][a-z-]*)/) ?? [])[1];
  const bce = sub !== undefined;
  const repo = (command.match(/--repo\s+(\S+)/) ?? [])[1];
  let expect = 0;
  let markers = [];
  if (/^npm view bce-engine@/.test(command)) {
    markers = [version, pin.integrity];
  } else if (/^npm install\b/.test(command) && pkgRef) {
    seen.install = true;
  } else if (sub === 'validate') {
    markers = ['blueprint VALID'];
  } else if (sub === 'teeth') {
    markers = ['TeethReport'];
  } else if (sub === 'gate' && repo && /drift/.test(repo) && /\s--all(\s|$)/.test(command)) {
    expect = 1;
    markers = RED;
    seen.red.add(repo);
  } else if (sub === 'gate') {
    markers = GREEN;
    if (repo && seen.red.has(repo)) {
      if (!seen.fixedBy) {
        // The document asks the reader to make this edit by hand; make exactly that edit.
        for (const quoted of [DRIFT_IMPORT, DRIFT_CALL, FIXED_CALL]) {
          if (!text.includes(quoted)) fail(`${docPath} no longer describes the manual fix line ${quoted}`);
        }
        steps.push({ edit: `${repo}/src/greeting.plugin.ts` });
      }
      seen.greenAfterRed = true;
    }
  } else if (sub === 'demo') {
    seen.demo = true;
    const recipe = (command.match(/--recipe\s+(\S+)/) ?? [])[1];
    if (/\s--list(\s|$)/.test(command)) markers = ['bce demo recipes', 'module-layering'];
    else if (recipe) markers = [`bce demo: ${recipe} discriminates GREEN from RED`];
    else markers = ['GREEN conformant: score 100, exit 0', 'package fixtures discriminate GREEN from RED'];
  }
  if (/greeting\.plugin\.ts/.test(command) && !bce) seen.fixedBy = true;
  steps.push({ command, run: shell === 'pwsh' ? asTyped(command) : command, expect, markers });
}
if (!seen.install) fail(`${docPath} never installs the pinned bce-engine@${version}`);
if (!seen.demo && !(seen.red.size > 0 && seen.greenAfterRed)) {
  fail(`${docPath} shows neither \`bce demo\` nor a RED gate followed by a GREEN re-gate`);
}

const bashQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
const pwshQuote = (s) => `'${s.replace(/'/g, "''")}'`;
// The manual edit, as a standalone script beside the generated one (no shell quoting involved).
const fixScript = `${out}.fix.cjs`;
writeFileSync(
  fixScript,
  [
    "const fs = require('node:fs');",
    'const f = process.argv[2];',
    "let s = fs.readFileSync(f, 'utf8');",
    `for (const x of ${JSON.stringify([DRIFT_IMPORT, DRIFT_CALL])}) {`,
    "  if (!s.includes(x)) { console.error('manual fix target missing: ' + x); process.exit(1); }",
    '}',
    `s = s.split(/\\r?\\n/).filter((l) => !l.trim().startsWith(${JSON.stringify(DRIFT_IMPORT)})).join('\\n');`,
    `s = s.replace(${JSON.stringify(DRIFT_CALL)}, ${JSON.stringify(FIXED_CALL)});`,
    "if (/^\\s*import\\s+axios\\b/m.test(s) || s.includes('axios.get(')) { console.error('manual fix left axios in ' + f); process.exit(1); }",
    'fs.writeFileSync(f, s);',
    "console.log('applied the manual fix the document describes to ' + f);",
    '',
  ].join('\n'),
);

const lines = [];
if (shell === 'bash') {
  lines.push(
    '#!/usr/bin/env bash',
    '# Generated by scripts/public-install-walkthrough.mjs — do not edit.',
    'set -u',
    'shopt -s expand_aliases  # behave like the interactive shell the reader types into',
    'LOG="$(mktemp)"',
    'check() {',
    '  local code="$1" expect="$2" label="$3"; shift 3',
    '  if [ "$code" != "$expect" ]; then echo "::error::$label exited $code, expected $expect"; exit 1; fi',
    '  local m; for m in "$@"; do',
    '    if ! grep -qF -- "$m" "$LOG"; then echo "::error::$label output lacks: $m"; exit 1; fi',
    '  done',
    '  echo "ok: $label -> exit $code"',
    '}',
  );
  for (const step of steps) {
    if (step.edit) {
      lines.push(`echo '::group::(manual edit described in the doc) ${step.edit}'`, `node ${bashQuote(fixScript)} ${bashQuote(step.edit)} || { echo "::error::manual fix failed"; exit 1; }`, `echo '::endgroup::'`);
      continue;
    }
    lines.push(
      `echo ${bashQuote(`::group::$ ${step.command}`)}`,
      `eval ${bashQuote(step.command)} >"$LOG" 2>&1; code=$?`,
      'cat "$LOG"; echo "::endgroup::"',
      `check "$code" ${step.expect} ${[step.command, ...step.markers].map(bashQuote).join(' ')}`,
    );
  }
  lines.push(`echo "GREEN: ${docPath}${section ? ` § ${section}` : ''} ran end to end in bash"`);
} else {
  lines.push(
    '# Generated by scripts/public-install-walkthrough.mjs — do not edit.',
    "$ErrorActionPreference = 'Stop'",
    '$LOG = [System.IO.Path]::GetTempFileName()',
    `$BLOCKED = ${pwshQuote(BLOCKED)}`,
    'function Check-Step([string]$Code, [int]$Expect, [string]$Label, [string[]]$Markers) {',
    '  $body = Get-Content -Raw -LiteralPath $LOG',
    '  if ($null -eq $body) { $body = "" }',
    '  if ($body.Contains($BLOCKED)) { Write-Host "::error::$Label was refused by the PowerShell execution policy; the Windows note (npm.cmd / npx.cmd) is missing from the document"; exit 1 }',
    '  if ($Code -ne "$Expect") { Write-Host "::error::$Label exited $Code, expected $Expect"; exit 1 }',
    '  foreach ($m in $Markers) { if (-not $body.Contains($m)) { Write-Host "::error::$Label output lacks: $m"; exit 1 } }',
    '  Write-Host "ok: $Label -> exit $Code"',
    '}',
  );
  if (policy === 'restricted') {
    lines.push(
      '# First prove this session refuses scripts the way a Windows client with no policy set does.',
      '$effective = "$(Get-ExecutionPolicy)"',
      'Write-Host "PowerShell $($PSVersionTable.PSVersion), effective execution policy $effective"',
      `if ($effective -ne 'Restricted') { Write-Host "::error::effective execution policy is $effective, not Restricted"; exit 1 }`,
      `$probe = 'bare npm ran'`,
      'try { npm --version | Out-Null } catch { $probe = $_.Exception.Message }',
      'if (-not $probe.Contains($BLOCKED)) { Write-Host "::error::$probe; this leg no longer reproduces a default Windows client"; exit 1 }',
      'Write-Host "ok: bare npm is refused, as on a default Windows client: $probe"',
    );
  }
  for (const step of steps) {
    if (step.edit) {
      lines.push(
        `Write-Host '::group::(manual edit described in the doc) ${step.edit}'`,
        `node ${pwshQuote(fixScript)} ${pwshQuote(step.edit)}`,
        'if ($LASTEXITCODE -ne 0) { Write-Host "::error::manual fix failed"; exit 1 }',
        "Write-Host '::endgroup::'",
      );
      continue;
    }
    lines.push(
      `Write-Host ${pwshQuote(`::group::> ${step.run}`)}`,
      '$global:LASTEXITCODE = 0',
      // Windows PowerShell 5.1 turns redirected native stderr into error records, which 'Stop' would
      // throw on; keep every stream as plain text lines for the marker check instead.
      `try { $ErrorActionPreference = 'Continue'; Invoke-Expression ${pwshQuote(step.run)} *>&1 | ForEach-Object { "$_" } | Out-File -LiteralPath $LOG -Encoding utf8 -Width 4096; $code = "$global:LASTEXITCODE" } catch { $_.ToString() | Add-Content -LiteralPath $LOG; $code = 'threw' } finally { $ErrorActionPreference = 'Stop' }`,
      'Get-Content -LiteralPath $LOG | Write-Host; Write-Host "::endgroup::"',
      `Check-Step $code ${step.expect} ${pwshQuote(step.command)} @(${step.markers.map(pwshQuote).join(', ')})`,
    );
  }
  lines.push(`Write-Host "GREEN: ${docPath}${section ? ` § ${section}` : ''} ran end to end in PowerShell"`, 'exit 0');
}
writeFileSync(out, `${lines.join('\n')}\n`);
process.stdout.write(`${steps.length} step(s) from ${docPath}${section ? ` § ${section}` : ''} -> ${out}\n`);
