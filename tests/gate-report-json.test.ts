/**
 * `bce gate --report-json <path>` — the machine-parseable agent/CI/Action contract (SPEC §5, §7).
 *
 * This flag is the enabling surface for the THIN GitHub Action (COUNCIL-SYNTHESIS item #19) and the
 * THIN MCP server (#20): both wrap the gate's OWN machine output rather than re-deriving a verdict.
 * The contract these tests pin:
 *
 *   1. It is a PURE OUTPUT SIDE-CHANNEL — verdict, exit code, stdout and stderr are BYTE-IDENTICAL
 *      with or without the flag (widen-only: absent flag ⇒ the pre-flag path is untouched).
 *   2. The written document is valid, stable-serialized JSON carrying the graded facts the gate
 *      already decided (verdict, exit code, mode, counts, the full reports[]).
 *   3. RED and GREEN produce OPPOSITE machine verdicts, matching the real process exit code.
 *   4. Fail-closed: an unwritable path is a LOUD error, never a silent skip — a consumer that asked
 *      for the machine report must never proceed as if it received one.
 *
 * No LLM, no network — pure CLI + filesystem. Runs the CLI SOURCE via tsx (project convention).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.ts');
const FIXROOT = join(HERE, '..', 'fixtures');
const BLUEPRINT = join(FIXROOT, 'luna-chat-extension.blueprint.json');
const CONFORMANT = join(FIXROOT, 'extension-surface', 'conformant');
const DRIFT = join(FIXROOT, 'extension-surface', 'drift-forbidden-import');

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

let tmp: string;
let bpDir: string;

// The gate's full-sweep mode evaluates every blueprint in the dir. Isolate the plugin-surface
// blueprint so exactly the discriminating contract is graded (mirrors ci.yml's RED/GREEN leg).
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'bce-report-json-'));
  bpDir = join(tmp, 'bp');
  mkdirSync(bpDir, { recursive: true });
  writeFileSync(join(bpDir, 'luna-chat-extension.blueprint.json'), readFileSync(BLUEPRINT, 'utf8'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function gateArgs(repo: string, extra: string[] = []): string[] {
  return ['gate', '--repo', repo, '--blueprint-dir', bpDir, '--extractor', 'ast', ...extra];
}

describe('gate --report-json — the machine agent/CI/Action contract', () => {
  it('GREEN tree: exit 0, machine report says gateFailed:false / verdict pass', () => {
    const out = join(tmp, 'green.json');
    const r = runCli(gateArgs(CONFORMANT, ['--report-json', out]));
    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.schemaVersion).toBe('1');
    expect(doc.gateFailed).toBe(false);
    expect(doc.outcome).toBe('pass');
    expect(doc.refusals).toEqual([]);
    expect(doc.exitCode).toBe(0);
    expect(doc.mode).toBe('enforced');
    expect(Array.isArray(doc.reports)).toBe(true);
    expect(doc.reports.length).toBe(1);
    expect(doc.reports[0].verdict).toBe('pass');
    // exitCode in the report MUST equal the real process exit code (no divergence).
    expect(doc.exitCode).toBe(r.code);
  });

  it('RED tree: exit 1, machine report says gateFailed:true / verdict fail with the named violation', () => {
    const out = join(tmp, 'red.json');
    const r = runCli(gateArgs(DRIFT, ['--report-json', out]));
    expect(r.code).toBe(1);
    expect(existsSync(out)).toBe(true);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.gateFailed).toBe(true);
    expect(doc.outcome).toBe('violation');
    expect(doc.exitCode).toBe(1);
    expect(doc.blockingBlueprints).toBe(1);
    expect(doc.reports[0].verdict).toBe('fail');
    expect(doc.reports[0].violations.length).toBeGreaterThan(0);
    // the seeded violation constraint is present in the machine report (agent self-correction reads this).
    const ids = doc.reports[0].violations.map((v: { constraintId: string }) => v.constraintId);
    expect(ids.join(' ')).toContain('no-direct-provider-sdk');
    expect(doc.exitCode).toBe(r.code);
  });

  it('RED and GREEN produce OPPOSITE machine verdicts under the SAME blueprint', () => {
    const g = join(tmp, 'g.json');
    const b = join(tmp, 'b.json');
    runCli(gateArgs(CONFORMANT, ['--report-json', g]));
    runCli(gateArgs(DRIFT, ['--report-json', b]));
    const green = JSON.parse(readFileSync(g, 'utf8'));
    const red = JSON.parse(readFileSync(b, 'utf8'));
    expect(green.gateFailed).toBe(false);
    expect(red.gateFailed).toBe(true);
    expect(green.exitCode).not.toBe(red.exitCode);
  });

  it('REFUSAL: zero discovered blueprints is exit 2 in both process and machine report', () => {
    const emptyBlueprintDir = join(tmp, 'empty-blueprints');
    mkdirSync(emptyBlueprintDir);
    const out = join(tmp, 'refusal.json');
    const r = runCli([
      'gate', '--repo', CONFORMANT, '--blueprint-dir', emptyBlueprintDir,
      '--extractor', 'ast', '--report-json', out,
    ]);
    expect(r.code).toBe(2);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.gateFailed).toBe(true);
    expect(doc.outcome).toBe('refusal');
    expect(doc.exitCode).toBe(2);
    expect(doc.exitCode).toBe(r.code);
    expect(doc.blueprintsDiscovered).toBe(0);
    expect(doc.refusals.join(' ')).toContain('0 blueprint(s) discovered');
  });

  it('REFUSAL is never softened by advisory mode', () => {
    const emptyBlueprintDir = join(tmp, 'empty-advisory-blueprints');
    const repo = join(tmp, 'advisory-repo');
    mkdirSync(emptyBlueprintDir);
    mkdirSync(repo);
    writeFileSync(join(repo, '.bce-mode.json'), JSON.stringify({ mode: 'advisory' }));
    const out = join(tmp, 'advisory-refusal.json');
    const r = runCli([
      'gate', '--repo', repo, '--blueprint-dir', emptyBlueprintDir,
      '--extractor', 'ast', '--report-json', out,
    ]);
    expect(r.code).toBe(2);
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    expect(doc.mode).toBe('advisory');
    expect(doc.outcome).toBe('refusal');
    expect(doc.exitCode).toBe(2);
  });

  it('PURE SIDE-CHANNEL: stdout + exit code are byte-identical with and without the flag', () => {
    const out = join(tmp, 'side.json');
    const withFlag = runCli(gateArgs(CONFORMANT, ['--report-json', out]));
    const without = runCli(gateArgs(CONFORMANT));
    expect(withFlag.stdout).toBe(without.stdout);
    expect(withFlag.code).toBe(without.code);
    // and it really wrote the report (the flag DID something — it just didn't perturb the verdict path).
    expect(existsSync(out)).toBe(true);
  });

  it('the machine report is STABLE-serialized (byte-identical across two identical runs)', () => {
    const a = join(tmp, 'a.json');
    const c = join(tmp, 'c.json');
    runCli(gateArgs(CONFORMANT, ['--report-json', a]));
    runCli(gateArgs(CONFORMANT, ['--report-json', c]));
    expect(readFileSync(a, 'utf8')).toBe(readFileSync(c, 'utf8'));
  });

  it('FAIL-CLOSED: an unwritable --report-json path is a LOUD error (exit 1), never a silent skip', () => {
    // A path whose parent directory does not exist cannot be written → the gate must die loudly.
    const bad = join(tmp, 'no-such-dir', 'nested', 'report.json');
    const r = runCli(gateArgs(CONFORMANT, ['--report-json', bad]));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--report-json');
    expect(existsSync(bad)).toBe(false);
  });
});
