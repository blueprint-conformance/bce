/**
 * examples-readme-proof — every command comparison in the examples' walkthroughs is PROVEN, not
 * decorative (the same discipline #24/#25 established for the witness kit, extended to the
 * user-facing guaranteed path).
 *
 * WHY THIS EXISTS. The quickstart README is "the guaranteed path" — its promise is that the
 * printed outputs match what the engine actually prints. That promise had no proof: when #29
 * moved `bce teeth` to the three-way verdict, the quickstart's step-1 output block silently went
 * stale (it still showed `toothed — 1/1 …` while the engine printed `evaluator-refutable`), and
 * every CI leg stayed green. A first external user would have hit the mismatch in minute two of
 * the five-minute path. This suite closes that class for BOTH examples:
 *
 *   1. Every walkthrough command runs against the in-tree example fixtures and its promised
 *      verdict facts (exit code, verdict word, score, named file/line) are asserted.
 *   2. The TeethReport line each README displays is asserted to be the BYTE-EXACT line the
 *      engine prints — so the next verdict-semantics change fails HERE until the walkthroughs
 *      are updated with it. A guaranteed path that can silently stale is not guaranteed.
 *
 * No LLM, no network — pure CLI + filesystem. Runs the CLI SOURCE via tsx (project convention).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'src', 'cli.ts');
const QUICKSTART = join(HERE, '..', 'examples', 'quickstart');
const CONFIG_GUARD = join(HERE, '..', 'examples', 'config-guard');

function runCli(args: string[]): { code: number; out: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** The README's displayed TeethReport line must be the byte-exact line the engine prints. */
function assertReadmeCarriesTeethLine(readmePath: string, engineOut: string): void {
  const teethLine = engineOut.split('\n').find((l) => l.startsWith('TeethReport:'));
  expect(teethLine, 'engine printed no TeethReport line').toBeTruthy();
  const readme = readFileSync(readmePath, 'utf8');
  expect(
    readme.includes(teethLine as string),
    `README at ${readmePath} does not carry the engine's actual TeethReport line:\n  ${teethLine}\n` +
      'The walkthrough is stale against the engine — update the displayed output block.',
  ).toBe(true);
}

describe('quickstart README — the guaranteed path is proven, command by command', () => {
  const BP = join(QUICKSTART, 'blueprint', 'no-direct-http-client.blueprint.json');

  it('step 1a: validate prints the promised VALID line', () => {
    const r = runCli(['validate', '--blueprint', BP]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('blueprint VALID: no-direct-http-client@0.1.0 (1 constraint(s))');
  });

  it('step 1b: teeth prints evaluator-refutable (exit 0) and the README carries the exact line', () => {
    const r = runCli(['teeth', '--blueprint', BP, '--ct-repo', join(QUICKSTART, 'clean'), '--no-pin', '--extractor', 'ast']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('-> evaluator-refutable');
    assertReadmeCarriesTeethLine(join(QUICKSTART, 'README.md'), r.out);
  });

  it('enforcement readiness refuses evaluator-only teeth when strict proof is required', () => {
    const r = runCli([
      'teeth', '--blueprint', BP, '--ct-repo', join(QUICKSTART, 'clean'), '--no-pin',
      '--extractor', 'ast', '--require-extractor-real',
    ]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('enforcement readiness requires extractor-real teeth');
  });

  it('step 2: gate on the clean tree passes with 1/1 evaluated, 0 failing', () => {
    const r = runCli(['gate', '--repo', join(QUICKSTART, 'clean'), '--blueprint-dir', join(QUICKSTART, 'blueprint'), '--extractor', 'ast']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1/1 blueprint(s) evaluated, 0 failing');
  });

  it('step 3: gate on the drifted tree fails at score 60 and names the violating line', () => {
    const r = runCli(['gate', '--repo', join(QUICKSTART, 'drift'), '--blueprint-dir', join(QUICKSTART, 'blueprint'), '--extractor', 'ast', '--all']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('score 60');
    expect(r.out).toContain('src/greeting.plugin.ts#L16');
  });
});

describe('config-guard README — the config-surface walkthrough is proven, command by command', () => {
  const BP = join(CONFIG_GUARD, 'blueprint', 'minimal-feature-manifest.blueprint.json');

  it('step 1a: validate prints the promised VALID line', () => {
    const r = runCli(['validate', '--blueprint', BP]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('blueprint VALID: minimal-feature-manifest@0.1.0 (2 constraint(s))');
  });

  it('step 1b: teeth prints evaluator-refutable (exit 0) and the README carries the exact line', () => {
    const r = runCli(['teeth', '--blueprint', BP, '--ct-repo', join(CONFIG_GUARD, 'clean'), '--no-pin']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('-> evaluator-refutable');
    assertReadmeCarriesTeethLine(join(CONFIG_GUARD, 'README.md'), r.out);
  });

  it('step 2: gate on the clean tree passes', () => {
    const r = runCli(['gate', '--repo', join(CONFIG_GUARD, 'clean'), '--blueprint-dir', join(CONFIG_GUARD, 'blueprint')]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('1/1 blueprint(s) evaluated, 0 failing');
  });

  it('step 3: one widened array entry reddens the gate and names the manifest', () => {
    const r = runCli(['gate', '--repo', join(CONFIG_GUARD, 'drift'), '--blueprint-dir', join(CONFIG_GUARD, 'blueprint'), '--all']);
    expect(r.code).toBe(1);
    expect(r.out).toContain('score 60');
    expect(r.out).toContain('config/feature-manifest.json');
  });

  it('step 3b: a COLLAPSED single-line enabledFeatures widening also reddens (the layout the per-entry arm cannot see)', () => {
    // Pins the inline arm's `Features` alternation member: with it removed, a valid-JSON
    // widening that collapses the whole array onto one line passes GREEN through BOTH arms
    // (the per-entry arm needs a bare-token line; adversarial review found exactly this gap).
    const tmp = mkdtempSync(join(tmpdir(), 'config-guard-collapse-'));
    try {
      cpSync(join(CONFIG_GUARD, 'clean'), tmp, { recursive: true });
      const mPath = join(tmp, 'config', 'feature-manifest.json');
      const m = JSON.parse(readFileSync(mPath, 'utf8')) as { enabledFeatures: string[] };
      m.enabledFeatures.push('admin-console');
      const pretty = JSON.stringify(m, null, 2);
      const collapsed = `"enabledFeatures": [${m.enabledFeatures.map((x) => JSON.stringify(x)).join(', ')}]`;
      const mutated = pretty.replace(/"enabledFeatures": \[[^]*?\n {2}\]/, collapsed);
      JSON.parse(mutated); // stays valid JSON — this is a realistic edit, not corruption
      writeFileSync(mPath, `${mutated}\n`);
      const r = runCli(['gate', '--repo', tmp, '--blueprint-dir', join(CONFIG_GUARD, 'blueprint'), '--all']);
      expect(r.code).toBe(1);
      expect(r.out).toContain('no-inline-widening-of-the-empty-arrays');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('step 4: deleting the policy record trips the fail-closed minFiles floor', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'config-guard-floor-'));
    try {
      cpSync(join(CONFIG_GUARD, 'clean'), tmp, { recursive: true });
      rmSync(join(tmp, 'docs', 'FEATURE-POLICY.md'));
      const r = runCli(['gate', '--repo', tmp, '--blueprint-dir', join(CONFIG_GUARD, 'blueprint')]);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("fail-closed: scanned 1 file(s), expected >= 2");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('the drift tree differs from clean by exactly one manifest line (the walkthrough claim)', () => {
    const clean = readFileSync(join(CONFIG_GUARD, 'clean', 'config', 'feature-manifest.json'), 'utf8');
    const drift = readFileSync(join(CONFIG_GUARD, 'drift', 'config', 'feature-manifest.json'), 'utf8');
    const cleanLines = clean.split('\n');
    const driftLines = drift.split('\n');
    const added = driftLines.filter((l) => !cleanLines.includes(l));
    expect(added.map((l) => l.trim())).toContain('"admin-console"');
    const policyClean = readFileSync(join(CONFIG_GUARD, 'clean', 'docs', 'FEATURE-POLICY.md'), 'utf8');
    const policyDrift = readFileSync(join(CONFIG_GUARD, 'drift', 'docs', 'FEATURE-POLICY.md'), 'utf8');
    expect(policyDrift).toBe(policyClean);
  });
});
