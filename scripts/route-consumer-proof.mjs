#!/usr/bin/env node
/** Exercise route evidence through the actual installed release bytes, never a rebuilt checkout. */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  if (!['--tarball', '--registry-version', '--out', '--evidence-dir'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) {
    throw new Error('Usage: route-consumer-proof.mjs (--tarball <absolute.tgz> | --registry-version <x.y.z>) [--out proof.json] [--evidence-dir <empty-directory>]');
  }
  options[args[i]] = args[i + 1];
}
if (Boolean(options['--tarball']) === Boolean(options['--registry-version'])) throw new Error('Choose exactly one artifact source');
if (options['--tarball'] && (!isAbsolute(options['--tarball']) || !options['--tarball'].endsWith('.tgz'))) throw new Error('--tarball must be an absolute .tgz path');
if (options['--registry-version'] && !/^\d+\.\d+\.\d+$/.test(options['--registry-version'])) throw new Error('Registry version must be exact x.y.z');
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Run the consumer proof using Node 22 or newer');

const scratch = mkdtempSync(join(tmpdir(), 'bce-route-consumer-'));
const proof = { schemaVersion: '1', kind: 'installed-route-consumer-proof', passed: false, scratch, source: {}, environment: { node: process.version, nodeExecutable: process.execPath, platform: process.platform, architecture: process.arch }, cases: [], failures: [] };
const out = options['--out'] ? resolve(options['--out']) : join(scratch, 'proof.json');
const evidenceDir = options['--evidence-dir'] ? resolve(options['--evidence-dir']) : undefined;
let canWriteEvidence = false;
const hash = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const run = (file, argv, cwd = scratch) => execFileSync(file, argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });

function npmCliPath() {
  const candidates = [process.env.npm_execpath];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const executable = join(directory, 'npm');
    if (existsSync(executable)) candidates.push(realpathSync(executable));
  }
  // Respect the active Corepack shim before falling back to the npm bundled with Node.
  candidates.push(join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'));
  const found = candidates.find(path => path && path.endsWith('.js') && existsSync(path));
  if (!found) throw new Error('Cannot locate npm-cli.js; run through npm or provide npm_execpath');
  return realpathSync(found);
}

function allFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? allFiles(join(directory, entry.name)) : [join(directory, entry.name)]);
}

function writeEvidenceBundle() {
  if (!evidenceDir || !canWriteEvidence) return;
  mkdirSync(evidenceDir, { recursive: true });
  const copy = (from, to) => {
    if (!existsSync(from)) return;
    const destination = join(evidenceDir, to);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(from, destination, { recursive: true });
  };
  copy(process.argv[1], 'proof-script.mjs');
  copy(join(scratch, 'package-lock.json'), 'consumer-package-lock.json');
  for (const entry of proof.cases) {
    const directory = join(scratch, 'cases', entry.name);
    const prefix = `cases/${entry.name}`;
    copy(join(directory, 'src'), `${prefix}/src`);
    copy(join(directory, '.blueprints/route-guard.blueprint.json'), `${prefix}/blueprint.json`);
    copy(entry.report, `${prefix}/gate.json`);
    copy(entry.stdout, `${prefix}/stdout.txt`);
    copy(entry.stderr, `${prefix}/stderr.txt`);
    entry.evidence = { source: `${prefix}/src`, blueprint: `${prefix}/blueprint.json`, report: `${prefix}/gate.json`, stdout: `${prefix}/stdout.txt`, stderr: `${prefix}/stderr.txt` };
  }
  proof.evidence = {
    directory: evidenceDir,
    pathBase: 'All evidence paths are relative to this bundle root; original invocation paths describe the temporary execution workspace.',
    files: allFiles(evidenceDir).map(path => ({ path: relative(evidenceDir, path).split('\\').join('/'), sha256: hash(readFileSync(path), 'sha256') })),
  };
}

try {
  if (evidenceDir && existsSync(evidenceDir) && readdirSync(evidenceDir).length > 0) throw new Error('--evidence-dir must be empty; do not mix evidence from separate artifacts');
  canWriteEvidence = Boolean(evidenceDir);
  const npmPath = npmCliPath();
  const npm = argv => run(process.execPath, [npmPath, ...argv]);
  proof.environment.npmExecutable = npmPath;
  proof.environment.npm = npm(['--version']).trim();
  let tarball = options['--tarball'];
  let registry;
  if (options['--registry-version']) {
    const identity = `bce-engine@${options['--registry-version']}`;
    registry = JSON.parse(npm(['view', identity, '--json', '--registry=https://registry.npmjs.org/']));
    const packed = JSON.parse(npm(['pack', identity, '--ignore-scripts', '--json', '--silent', '--pack-destination', scratch, '--cache', join(scratch, 'cache'), '--registry=https://registry.npmjs.org/']));
    if (packed.length !== 1 || !/^[A-Za-z0-9._-]+\.tgz$/.test(packed[0].filename)) throw new Error('Registry pack did not identify one safe archive');
    tarball = join(scratch, packed[0].filename);
    proof.source = { kind: 'npm-registry', requested: identity, registry: 'https://registry.npmjs.org/', metadataVersion: registry.version, metadataIntegrity: registry.dist?.integrity, metadataShasum: registry.dist?.shasum, registryGitHead: registry.gitHead ?? null };
  } else proof.source = { kind: 'supplied-tarball' };
  const bytes = readFileSync(tarball);
  const integrity = `sha512-${hash(bytes, 'sha512', 'base64')}`;
  Object.assign(proof.source, { tarball: realpathSync(tarball), sha256: hash(bytes, 'sha256'), integrity, shasum: hash(bytes, 'sha1') });
  if (registry && (registry.version !== options['--registry-version'] || registry.dist?.integrity !== integrity || registry.dist?.shasum !== proof.source.shasum)) throw new Error('Downloaded archive disagrees with exact registry identity');
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'bce-route-proof-consumer', version: '1.0.0', private: true }));
  npm(['install', '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', '--cache', join(scratch, 'cache'), '--registry=https://registry.npmjs.org/', tarball]);
  const installed = join(scratch, 'node_modules/bce-engine');
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  const lockBytes = readFileSync(join(scratch, 'package-lock.json'));
  const lock = JSON.parse(lockBytes);
  Object.assign(proof.source, { package: pkg.name, installedVersion: pkg.version, installedLockIntegrity: lock.packages?.['node_modules/bce-engine']?.integrity, consumerLockSha256: hash(lockBytes, 'sha256'), installedCliSha256: hash(readFileSync(join(installed, 'dist/cli.js')), 'sha256') });
  if (pkg.name !== 'bce-engine' || !/^\d+\.\d+\.\d+$/.test(pkg.version) || (registry && pkg.version !== options['--registry-version'])) throw new Error('Installed package name/version differs from requested artifact');
  if (proof.source.installedLockIntegrity !== integrity) throw new Error('Installed lock integrity differs from supplied archive');
  const fixture = join(installed, 'fixtures/route-surface/conformant-guarded');
  const blueprint = join(installed, 'fixtures/route-guard.blueprint.json');
  const prefix = "import { requireTenantAccess } from '@/lib/tenant-guards';\n";
  const guarded = 'await requireTenantAccess(tenant); return { secret: true };';
  const forms = {
    function: (verb, body) => `export async function ${verb}(tenant) { ${body} }`,
    arrow: (verb, body) => `export const ${verb} = async (tenant) => { ${body} };`,
    expression: (verb, body) => `export const ${verb} = async function(tenant) { ${body} };`,
  };
  const scenarios = [];
  for (const [form, render] of Object.entries(forms)) {
    for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      scenarios.push({ name: `${form}-${verb}-guarded`, source: prefix + render(verb, guarded), exit: 0, outcome: 'pass' });
      scenarios.push({ name: `${form}-${verb}-missing`, source: prefix + render(verb, 'return { secret: true };'), exit: 1, outcome: 'violation', violation: 'd6-tenant-guard', verb });
    }
  }
  scenarios.push(
    { name: 'mixed-unguarded-POST', source: prefix + forms.function('GET', guarded) + '\n' + forms.arrow('POST', 'return {};'), exit: 1, outcome: 'violation', violation: 'd6-tenant-guard', verb: 'POST' },
    { name: 'unsupported-wrapper', source: prefix + forms.function('GET', guarded) + '\nexport const POST = withGuard(handler);', exit: 2, outcome: 'refusal' },
    { name: 'zero-handlers', source: 'export const config = {};', allFiles: true, exit: 1, outcome: 'violation', violation: 'd6-tenant-guard' },
    { name: 'unreachable-guard-unverified', source: prefix + forms.function('GET', 'return { secret: true }; await requireTenantAccess(tenant);'), exit: 0, outcome: 'pass' },
    { name: 'rebound-function', source: prefix + forms.function('GET', guarded) + '\nGET = async () => ({ secret: true });', exit: 2, outcome: 'refusal', reason: 'handler binding is reassigned' },
    { name: 'javascript-arrow-guarded', extension: 'js', source: prefix + forms.arrow('GET', guarded), exit: 0, outcome: 'pass' },
    { name: 'javascript-arrow-missing', extension: 'js', source: prefix + forms.arrow('GET', 'return { secret: true };'), exit: 1, outcome: 'violation', violation: 'd6-tenant-guard', verb: 'GET' },
    { name: 'javascript-rebound-function', extension: 'js', source: prefix + forms.function('GET', guarded) + '\nGET = async () => ({ secret: true });', exit: 2, outcome: 'refusal', reason: 'handler binding is reassigned' },
    { name: 'javascript-commonjs-POST', extension: 'js', source: prefix + forms.function('GET', guarded) + '\nexports.POST = async () => ({ secret: true });', exit: 2, outcome: 'refusal', reason: 'CommonJS handler assignment is not supported' },
  );
  proof.source.blueprintSha256 = hash(readFileSync(blueprint), 'sha256');
  for (const scenario of scenarios) {
    const directory = join(scratch, 'cases', scenario.name);
    const extension = scenario.extension ?? 'ts';
    const scopedBlueprint = JSON.parse(readFileSync(blueprint, 'utf8'));
    if (extension === 'js') {
      // Match the authored JavaScript tree explicitly, preserving every rule and coverage floor.
      scopedBlueprint.scope.paths = ['src/app/api/**/*.js'];
      scopedBlueprint.extraction.paths = ['src/app/api/**/*.js'];
      for (const name of ['items', 'projects', 'settings']) {
        const file = join(directory, `src/app/api/tenants/[id]/${name}/route.js`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, prefix + forms.function('GET', guarded));
      }
    } else cpSync(fixture, directory, { recursive: true });
    mkdirSync(join(directory, '.blueprints'), { recursive: true });
    const caseBlueprint = join(directory, '.blueprints/route-guard.blueprint.json');
    if (extension === 'js') writeFileSync(caseBlueprint, JSON.stringify(scopedBlueprint, null, 2) + '\n');
    else cpSync(blueprint, caseBlueprint);
    const itemRoute = join(directory, `src/app/api/tenants/[id]/items/route.${extension}`);
    if (scenario.allFiles) for (const path of allFiles(join(directory, 'src'))) writeFileSync(path, scenario.source);
    else writeFileSync(itemRoute, scenario.source);
    const reportPath = join(directory, 'gate.json');
    const invocation = ['gate', '--repo', directory, '--repo-name', 'service-beta', '--report-json', reportPath];
    const result = spawnSync(process.execPath, [join(installed, 'dist/cli.js'), ...invocation], { cwd: directory, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
    writeFileSync(join(directory, 'stdout.txt'), stdout);
    writeFileSync(join(directory, 'stderr.txt'), stderr);
    const checks = [];
    if (result.error) checks.push(result.error.message);
    if (result.status !== scenario.exit) checks.push(`exit ${result.status}, expected ${scenario.exit}`);
    let report;
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { checks.push('missing or invalid JSON report'); }
    if (report?.outcome !== scenario.outcome || report?.exitCode !== scenario.exit) checks.push('JSON outcome/exit differs from expected');
    if (report?.mode !== 'enforced') checks.push('gate must run in enforced mode');
    if (report?.baselineActive !== false) checks.push('gate must not use a baseline');
    if (report?.blueprintsDiscovered !== 1 || report?.blueprintsSelected !== 1 || report?.reports?.length !== 1) checks.push('expected exactly one discovered, selected, and reported blueprint');
    if (scenario.exit === 0) {
      if (!stdout.includes('authorization behavior unverified')) checks.push('stdout hides authorization behavior unverified');
      if (!report?.reports?.some(value => value.summary?.includes('authorization behavior unverified'))) checks.push('JSON hides authorization behavior unverified');
    }
    const violations = report?.reports?.flatMap(value => value.violations ?? []) ?? [];
    if (scenario.violation && !violations.some(value => value.constraintId === scenario.violation &&
      (!scenario.verb || (value.component === `route:items:${scenario.verb}` && value.evidenceRef?.startsWith(`src/app/api/tenants/[id]/items/route.${extension}#L`) && /#L\d+$/.test(value.evidenceRef))))) checks.push('missing same-row guard violation, handler identity, or source location');
    if (scenario.exit === 2 && (!report?.refusals?.some(value => /unsupported route export at .*route\.(?:ts|js)#L\d+/.test(value) && (!scenario.reason || value.includes(scenario.reason))))) checks.push('refusal lacks expected reason and unsupported-export source location');
    proof.cases.push({ name: scenario.name, expectedExit: scenario.exit, actualExit: result.status, outcome: report?.outcome, passed: checks.length === 0, checks, invocation, blueprintSha256: hash(readFileSync(caseBlueprint), 'sha256'), sourceSha256: hash(readFileSync(itemRoute), 'sha256'), report: reportPath, stdout: join(directory, 'stdout.txt'), stderr: join(directory, 'stderr.txt') });
    for (const failure of checks) proof.failures.push(`${scenario.name}: ${failure}`);
  }
  if (hash(readFileSync(tarball), 'sha256') !== proof.source.sha256) throw new Error('Archive changed during installed-consumer proof');
  proof.passed = proof.failures.length === 0;
} catch (error) {
  proof.failures.push(error.message);
} finally {
  try { writeEvidenceBundle(); } catch (error) {
    proof.passed = false;
    proof.failures.push(`evidence bundle: ${error.message}`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(proof, null, 2) + '\n');
  if (evidenceDir && canWriteEvidence) writeFileSync(join(evidenceDir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
  process.stdout.write(`route-consumer-proof: ${proof.passed ? 'PASS' : 'FAIL'} — ${proof.cases.filter(value => value.passed).length}/${proof.cases.length} cases; ${out}\n`);
  process.stdout.write(JSON.stringify({ kind: proof.kind, passed: proof.passed, source: proof.source, environment: proof.environment, cases: proof.cases.map(({ name, actualExit, passed }) => ({ name, exit: actualExit, passed })) }) + '\n');
  for (const failure of proof.failures) process.stderr.write(`- ${failure}\n`);
  if (!proof.passed) process.exitCode = 1;
}
