/**
 * The adversarial false-GREEN mutation hunt (B2-WO-03) — the standing property that a
 * conformant tree plus ONE seeded drift NEVER stays green.
 *
 * Each mutant: copy a real conformant fixture tree to a temp dir, apply one deterministic
 * mutation (asserted to genuinely change the file — a no-op mutant would vacuously pass),
 * run the REAL gate, and assert the verdict flips to fail naming the EXACT constraint. Two
 * GREEN controls pin the documented non-flags (a type-only import erases at compile time and
 * cannot egress; a commented-out python import is prose): a hunt with no green control could
 * not distinguish "the gate catches drift" from "the gate rejects everything".
 *
 * A mutant that stays GREEN here is a false-GREEN engine bug — the highest-severity failure
 * class this project recognizes (a gate that passes drift). Deterministic: fixed mutation
 * list, no randomness, temp dirs per mutant.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runGate } from '../src/gate.js';

const FIXROOT = path.join(__dirname, '..', 'fixtures');
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
});

/** Copy `tree` to a temp dir and a blueprint into `<tmp>/.bp/`, returning both paths. */
function stage(tree: string, blueprintFile: string): { repo: string; bpDir: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-mutant-'));
  tempDirs.push(tmp);
  const repo = path.join(tmp, 'repo');
  fs.cpSync(path.join(FIXROOT, tree), repo, { recursive: true });
  const bpDir = path.join(tmp, '.bp');
  fs.mkdirSync(bpDir);
  fs.copyFileSync(path.join(FIXROOT, blueprintFile), path.join(bpDir, blueprintFile));
  return { repo, bpDir };
}

/** Apply a mutation to one file and assert it genuinely changed the content. */
function mutate(repo: string, relFile: string, fn: (src: string) => string): void {
  const p = path.join(repo, relFile);
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  expect(after, `mutation of ${relFile} must genuinely change the file`).not.toBe(before);
  fs.writeFileSync(p, after);
}

interface Mutant {
  id: string;
  tree: string;
  blueprint: string;
  file: string;
  mutation: (src: string) => string;
  /** RED: the constraintId the gate must name; GREEN: a documented non-flag control. */
  expect: { verdict: 'fail'; constraintId: string } | { verdict: 'pass' };
}

const EXT = 'src/extensions/luna-chat.extension.ts';
const MUTANTS: Mutant[] = [
  // ── extension surface: every forbidden-import syntactic form must redden ──
  {
    id: 'ext-add-static-import',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    mutation: (s) => `import OpenAI from 'openai';\nvoid OpenAI;\n${s}`,
    expect: { verdict: 'fail', constraintId: 'no-direct-provider-sdk' },
  },
  {
    id: 'ext-add-reexport',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    mutation: (s) => `${s}\nexport { OpenAI } from 'openai';\n`,
    expect: { verdict: 'fail', constraintId: 'no-direct-provider-sdk' },
  },
  {
    id: 'ext-add-dynamic-import',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    mutation: (s) => `${s}\nvoid import('openai');\n`,
    expect: { verdict: 'fail', constraintId: 'no-direct-provider-sdk' },
  },
  {
    id: 'ext-add-subpath-import',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    mutation: (s) => `import { toFile } from 'openai/uploads';\nvoid toFile;\n${s}`,
    expect: { verdict: 'fail', constraintId: 'no-direct-provider-sdk' },
  },
  {
    id: 'ext-degrade-to-decoy-registration',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    // the governed `pi.registerTool(` receiver becomes a local decoy — registration is no
    // longer through the harness, so the requiredDependency constraint must redden.
    mutation: (s) =>
      s.replace(
        'export const lunaChatExtension: ExtensionFactory = (pi) => {',
        'export const lunaChatExtension: ExtensionFactory = (pi) => {\n  void pi;\n  const decoy = { registerTool(_: unknown) {} };\n  const target = decoy;',
      ).replace('pi.registerTool({', 'target.registerTool({'),
    expect: { verdict: 'fail', constraintId: 'ext-registers-through-governed-path' },
  },
  // ── GREEN control: a type-only import erases at compile time — documented non-flag ──
  {
    id: 'ext-typeonly-import-stays-green',
    tree: 'extension-surface/conformant',
    blueprint: 'luna-chat-extension.blueprint.json',
    file: EXT,
    mutation: (s) => `import type { ClientOptions } from 'openai';\nexport type LunaOpts = ClientOptions;\n${s}`,
    expect: { verdict: 'pass' },
  },
  // ── route surface: guard stripped from one handler ──
  {
    id: 'route-strip-tenant-guard',
    tree: 'route-surface/conformant-guarded',
    blueprint: 'route-guard.blueprint.json',
    file: 'src/app/api/tenants/[id]/items/route.ts',
    // strip the guard from ONE handler (the first `const session = await requireTenantAccess(...)`
    // line) — the other handlers stay guarded, so the report reddens on exactly the stripped one.
    mutation: (s) => s.replace(/^\s*const session = await requireTenantAccess\([^)]*\);\s*\n/m, '  const session = { ok: true };\n'),
    expect: { verdict: 'fail', constraintId: 'd6-tenant-guard' },
  },
  // ── egress surface: governed default swapped to an ungoverned provider host ──
  {
    id: 'egress-swap-default-to-provider',
    tree: 'egress-surface/conformant-houseidiom',
    blueprint: 'egress-reader.blueprint.json',
    file: 'src/reader.ts',
    mutation: (s) => s.replace("'http://localhost:3013'", "'https://api.openai.com'"),
    expect: { verdict: 'fail', constraintId: 'reader-egress-governed-only' },
  },
  // ── python surface: forbidden import appended; commented import stays green ──
  {
    id: 'py-add-forbidden-import',
    tree: 'python-surface/conformant',
    blueprint: 'python-service.blueprint.json',
    file: 'service/app.py',
    mutation: (s) => `${s}\nimport openai\n`,
    expect: { verdict: 'fail', constraintId: 'no-direct-provider-sdk' },
  },
  {
    id: 'py-commented-import-stays-green',
    tree: 'python-surface/conformant',
    blueprint: 'python-service.blueprint.json',
    file: 'service/app.py',
    mutation: (s) => `${s}\n# import openai  (prose, not an import)\n`,
    expect: { verdict: 'pass' },
  },
];

describe('mutation hunt — one seeded drift NEVER stays green; documented non-flags stay green', () => {
  for (const m of MUTANTS) {
    it(m.id, () => {
      const { repo, bpDir } = stage(m.tree, m.blueprint);
      mutate(repo, m.file, m.mutation);
      const result = runGate(repo, bpDir, null, 'ast');
      expect(result.reports).toHaveLength(1);
      const report = result.reports[0]!;
      if (m.expect.verdict === 'fail') {
        expect(report.verdict, `${m.id}: a surviving mutant is a FALSE-GREEN engine bug`).toBe('fail');
        expect(
          report.violations.some((v) => v.constraintId === (m.expect as { constraintId: string }).constraintId),
          `${m.id}: must name ${(m.expect as { constraintId: string }).constraintId}; got ${JSON.stringify(report.violations.map((v) => v.constraintId))}`,
        ).toBe(true);
      } else {
        expect(report.verdict, `${m.id}: the documented non-flag must NOT flag`).toBe('pass');
        expect(report.score).toBe(100);
      }
    });
  }

  it('the baseline trees themselves gate GREEN (mutation is the only difference)', () => {
    for (const tree of [
      ['extension-surface/conformant', 'luna-chat-extension.blueprint.json'],
      ['route-surface/conformant-guarded', 'route-guard.blueprint.json'],
      ['egress-surface/conformant-houseidiom', 'egress-reader.blueprint.json'],
      ['python-surface/conformant', 'python-service.blueprint.json'],
    ] as const) {
      const { repo, bpDir } = stage(tree[0], tree[1]);
      const result = runGate(repo, bpDir, null, 'ast');
      expect(result.reports[0]!.verdict, tree[0]).toBe('pass');
    }
  });
});
