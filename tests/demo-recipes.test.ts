/**
 * The packaged recipe catalog is the breadth-first product proof behind First Win. It must keep
 * the original zero-argument demo stable, disclose the real support envelope, execute every
 * listed recipe through the production CLI, and refuse ambiguous or invented recipe ids.
 */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..');
const DIST_CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(REPO_ROOT, 'src', 'cli.ts');

function run(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const useDist = existsSync(DIST_CLI);
  const command = useDist ? process.execPath : path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const result = spawnSync(command, argv, { cwd: REPO_ROOT, encoding: 'utf8' });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

const RECIPE_IDS = [
  'extension-contract',
  'tenant-route-guard',
  'governed-egress',
  'python-provider-import',
  'module-layering',
  'configuration-allowlist',
] as const;

describe('packaged architecture demo recipes', () => {
  it('preserves the v0.2.0 zero-argument demo contract byte-for-byte', () => {
    const result = run(['demo']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      'GREEN conformant: score 100, exit 0\n' +
      'RED drift-forbidden-import: score 60, would exit 1, violation no-direct-provider-sdk\n' +
      'bce demo: package fixtures discriminate GREEN from RED\n',
    );
  });

  it('lists the executable recipes with honest maturity labels', () => {
    const result = run(['demo', '--list']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    for (const id of RECIPE_IDS) expect(result.stdout).toContain(id);
    expect(result.stdout.match(/^  [a-z][a-z-]+\s+/gm)).toHaveLength(RECIPE_IDS.length);
    expect(result.stdout).toContain('TypeScript/JavaScript · mature AST');
    expect(result.stdout).toContain('Next.js TypeScript · mature AST');
    expect(result.stdout).toContain('Python · MVP import graph');
    expect(result.stdout).toContain('TypeScript/JavaScript · direct module graph');
    expect(result.stdout).toContain('JSON/Markdown · real-source pattern pair');
    expect(result.stdout).toContain('run all: bce demo --recipe all');

    const firstWin = readFileSync(path.join(REPO_ROOT, 'docs', 'first-win.md'), 'utf8');
    for (const id of RECIPE_IDS) expect(firstWin).toContain(`\`${id}\``);
    expect(firstWin).toContain('Python import graph MVP');
    expect(firstWin).toContain('evaluator-refutable');
  });

  it('executes every listed recipe against its real GREEN and RED trees', () => {
    const result = run(['demo', '--recipe', 'all']);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.match(/^recipe /gm)).toHaveLength(RECIPE_IDS.length);
    expect(result.stdout.match(/^GREEN conformant: score 100, exit 0$/gm)).toHaveLength(RECIPE_IDS.length);
    expect(result.stdout.match(/^RED drift: score \d+, would exit 1, violation [a-z0-9-]+$/gm)).toHaveLength(RECIPE_IDS.length);
    expect(result.stdout.match(/^  observed /gm)).toHaveLength(RECIPE_IDS.length);
    expect(result.stdout.match(/^  evidence .+#L\d+$/gm)).toHaveLength(RECIPE_IDS.length);
    for (const id of RECIPE_IDS) {
      expect(result.stdout).toContain(`bce demo: ${id} discriminates GREEN from RED`);
    }
    expect(result.stdout).toContain(`bce demo: ${RECIPE_IDS.length}/${RECIPE_IDS.length} packaged recipes discriminate GREEN from RED`);
  });

  it('runs one selected recipe without silently running its neighbors', () => {
    const result = run(['demo', '--recipe', 'tenant-route-guard']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('recipe tenant-route-guard');
    expect(result.stdout).toContain('violation d6-tenant-guard');
    expect(result.stdout).not.toContain('recipe extension-contract');
    expect(result.stdout).not.toContain('recipe python-provider-import');
  });

  it('refuses missing, unknown, or ambiguous recipe selection', () => {
    const missing = run(['demo', '--recipe']);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('--recipe requires an id');

    const unknown = run(['demo', '--recipe', 'imaginary-stack']);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("unknown demo recipe 'imaginary-stack'");

    const ambiguous = run(['demo', '--list', '--recipe', 'extension-contract']);
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain('accepts --list or --recipe <id|all>, not both');

    const valuedList = run(['demo', '--list', 'false']);
    expect(valuedList.status).toBe(1);
    expect(valuedList.stderr).toContain('--list does not accept a value');

    const duplicateRecipe = run(['demo', '--recipe', 'all', '--recipe', 'extension-contract']);
    expect(duplicateRecipe.status).toBe(1);
    expect(duplicateRecipe.stderr).toContain('accepts exactly one --recipe selection');
  });
});
