/**
 * skill-standard.test.ts — the half of the standard that is NOT a gate, plus the proof that the
 * half which IS a gate can actually go red.
 *
 * WHY THIS EXISTS. `spec/skill-standard/SKILL-STANDARD.md` says out loud that the standard splits
 * in two, because the engine has no required-content constraint type: the FORBIDDEN half compiles
 * to blueprint clauses and blocks a merge, and the REQUIRED half ("a description exists", "the body
 * is under 500 lines") cannot. A standard that only stated that split would be honest and useless.
 * This file is the other side of the sentence — the required half, actually run, over this
 * repository's own skills.
 *
 * Four things are proven here:
 *
 *   1. REQUIRED HALF — every property the blueprint structurally cannot express, asserted over
 *      `skills/`. These are checks, not clauses, and the report should always say which.
 *   2. RED-PROVABILITY — the seeded corpus in `examples/skill-standard/` reddens EVERY clause, and
 *      the clean tree stays green. A clause with no demonstrated red is decoration, so the table in
 *      the example's README is re-derived from a real run here rather than transcribed.
 *   3. TEMPLATE/DOGFOOD SYNC — the adopter's copy (`spec/`) and the copy that gates this repository
 *      (`.blueprints/`) carry byte-identical constraints. Two copies of a rule drift; a test that
 *      compares them cannot.
 *   4. THE CREDENTIAL CLAUSE'S OTHER SHAPES — S7 refuses five credential forms and the seeded
 *      corpus can only carry one of them, because this repository's own leakage gate bans the other
 *      four as literal strings. The remaining four are proven here against probes assembled from
 *      fragments at runtime — the same technique `scripts/leakage-gate-selftest.sh` uses, for the
 *      same reason: the test must not trip the gate it is testing.
 *
 * No LLM, no network — the CLI source via tsx, plus the filesystem.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeCompilePattern } from '../src/safe-regex.js';
import type { Constraint } from '../src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const TEMPLATE = path.join(ROOT, 'spec', 'skill-standard', 'skill-standard.blueprint.json');
const DOGFOOD = path.join(ROOT, '.blueprints', 'skill-standard.blueprint.json');
const CORPUS = path.join(ROOT, 'examples', 'skill-standard');
const SKILLS = path.join(ROOT, 'skills');

interface Blueprint {
  readonly metadata: { readonly id: string; readonly status: string };
  readonly constraints: readonly Constraint[];
  readonly extraction?: { readonly paths?: readonly string[]; readonly minFiles?: number };
  readonly intentRefs: readonly string[];
}

const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(p, 'utf8')) as T;
const template = readJson<Blueprint>(TEMPLATE);
const dogfood = readJson<Blueprint>(DOGFOOD);

/** Run one blueprint against one tree and return the parsed report. */
function runBlueprint(blueprint: string, ctRepo: string): {
  code: number;
  report: { verdict: string; score: number; violations: Array<{ constraintId: string; evidenceRef: string }>; coverage: { filesScanned: number } };
} {
  const out = path.join(fs.mkdtempSync(path.join(ROOT, '.tmp-skill-standard-')), 'report.json');
  let code = 0;
  try {
    execFileSync(
      process.execPath,
      ['--import', 'tsx', CLI, 'run', '--blueprint', blueprint, '--ct-repo', ctRepo, '--no-pin', '--extractor', 'ast', '--out', out],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );
  } catch (e) {
    code = (e as { status?: number }).status ?? 1;
  }
  const report = readJson<ReturnType<typeof runBlueprint>['report']>(out);
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return { code, report };
}

/** Every skill directory in this repository: `skills/<name>/SKILL.md`. */
function skillDirs(): string[] {
  return fs
    .readdirSync(SKILLS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** The format's frontmatter surface: a leading `---` block of `key: value` lines. */
function readFrontmatter(text: string): { keys: Record<string, string>; bodyLines: number } {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new Error('does not open with a `---` frontmatter fence on line 1');
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('frontmatter fence is never closed');
  const keys: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`frontmatter line is not a \`key: value\` pair: ${JSON.stringify(line)}`);
    keys[m[1] as string] = (m[2] as string).trim();
  }
  return { keys, bodyLines: lines.length - end - 1 };
}

/**
 * The portable core of the Agent Skills format. A skill this repository PUBLISHES — via the plugin,
 * the marketplace entry, and a public repository — is held to the core only, so it stays uploadable
 * to a consumer that rejects unknown keys rather than ignoring them.
 */
const PORTABLE_CORE = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

/* -------------------------------------------------------------------------- */
/* 1. The required half — checks, over this repository's own skills            */
/* -------------------------------------------------------------------------- */
describe('skill-standard — the required half (checked here, NOT gated by the blueprint)', () => {
  const dirs = skillDirs();

  it('finds the skills it is meant to check (an empty sweep would pass everything)', () => {
    expect(dirs.length).toBeGreaterThanOrEqual(2);
    expect(dirs).toContain('bce');
    expect(dirs).toContain('skill-tuning');
  });

  for (const dir of dirs) {
    describe(`skills/${dir}`, () => {
      const md = path.join(SKILLS, dir, 'SKILL.md');

      it('holds a SKILL.md whose frontmatter fence is line 1 and closes', () => {
        expect(fs.existsSync(md), `skills/${dir} holds no SKILL.md`).toBe(true);
        expect(() => readFrontmatter(fs.readFileSync(md, 'utf8'))).not.toThrow();
      });

      it('carries name + description, and the name matches its directory', () => {
        const { keys } = readFrontmatter(fs.readFileSync(md, 'utf8'));
        expect(keys.name).toBeTruthy();
        expect(keys.description).toBeTruthy();
        expect(keys.name).toBe(dir);
      });

      it('carries a license — every skill here is published', () => {
        const { keys } = readFrontmatter(fs.readFileSync(md, 'utf8'));
        expect(keys.license, `skills/${dir}/SKILL.md has no license: it ships in the plugin`).toBe('Apache-2.0');
      });

      it('confines its frontmatter to the portable core', () => {
        const { keys } = readFrontmatter(fs.readFileSync(md, 'utf8'));
        const extension = Object.keys(keys).filter((k) => !PORTABLE_CORE.includes(k));
        expect(
          extension,
          `skills/${dir}/SKILL.md uses platform-extension key(s) [${extension.join(', ')}] — ` +
            'the file no longer uploads to a portable-core consumer (references/portability-matrix.md)',
        ).toEqual([]);
      });

      it('keeps its body under 500 lines — deeper material belongs in references/', () => {
        const { bodyLines } = readFrontmatter(fs.readFileSync(md, 'utf8'));
        expect(bodyLines).toBeLessThan(500);
      });

      it('carries no vendored dependency tree — the check the gate structurally cannot make', () => {
        // MEASURED, not assumed: the extractor's directory walk skips `node_modules` by name before
        // any glob applies, so a `forbiddenFile: skills/**/node_modules/**` clause scores 100/pass
        // against a tree that carries one. That is why there is no S12 and why this lives here.
        const vendored: string[] = [];
        const walk = (d: string): void => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            if (!e.isDirectory()) continue;
            if (e.name === 'node_modules') { vendored.push(path.relative(ROOT, path.join(d, e.name))); continue; }
            walk(path.join(d, e.name));
          }
        };
        walk(path.join(SKILLS, dir));
        expect(vendored).toEqual([]);
      });
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 2. RED-provability — the seeded corpus reddens every clause                 */
/* -------------------------------------------------------------------------- */
describe('skill-standard — the gated half can go red, one demonstrated red per clause', () => {
  const clean = runBlueprint(TEMPLATE, path.join(CORPUS, 'clean'));
  const drift = runBlueprint(TEMPLATE, path.join(CORPUS, 'drift'));

  it('the clean corpus passes, and the scan actually resolved files', () => {
    expect(clean.report.verdict).toBe('pass');
    expect(clean.report.score).toBe(100);
    expect(clean.report.violations).toEqual([]);
    // A blueprint aimed at a moved path ALSO scores 100. The floor is what separates the two.
    expect(clean.report.coverage.filesScanned).toBeGreaterThanOrEqual(template.extraction?.minFiles ?? 2);
  });

  it('the drift corpus fails', () => {
    expect(drift.code).toBe(1);
    expect(drift.report.verdict).toBe('fail');
    expect(drift.report.score).toBe(0);
  });

  it('EVERY constraint in the blueprint has at least one demonstrated red', () => {
    const reddened = new Set(drift.report.violations.map((v) => v.constraintId));
    const decoration = template.constraints.map((c) => c.id).filter((id) => !reddened.has(id));
    expect(
      decoration,
      `clause(s) with no seeded red — a clause that cannot be shown failing is decoration: ${decoration.join(', ')}`,
    ).toEqual([]);
  });

  it('the corpus is not over-fitted: the clean tree exercises the same clause ids', () => {
    // The instrument has to be able to distinguish the two trees, or "clean passes" is vacuous.
    expect(drift.report.violations.length).toBeGreaterThan(template.constraints.length - 1);
    expect(new Set(drift.report.violations.map((v) => v.constraintId)).size).toBe(template.constraints.length);
  });

  it('the anchors the example README prints are the anchors the engine produces', () => {
    // Re-derived, never transcribed: the README's table stales silently otherwise.
    const anchorFor = (id: string): string[] =>
      drift.report.violations.filter((v) => v.constraintId === id).map((v) => v.evidenceRef).sort();
    expect(anchorFor('S1-frontmatter-key-portability')).toEqual(['skills/greet/SKILL.md#L4']);
    expect(anchorFor('S3-description-placeholder')).toEqual(['skills/stub/SKILL.md#L3']);
    expect(anchorFor('S4-description-budget')).toEqual(['skills/bloated/SKILL.md#L3']);
    expect(anchorFor('S9-no-harness-imitation')).toEqual(['skills/leaky/SKILL.md#L11', 'skills/leaky/SKILL.md#L13']);
    expect(anchorFor('S11a-no-dotenv-in-a-skill-tree')).toEqual(['skills/leaky/.env']);
    expect(anchorFor('S11b-no-pem-in-a-skill-tree')).toEqual(['skills/leaky/key.pem']);
    expect(anchorFor('S11c-no-ssh-key-in-a-skill-tree')).toEqual(['skills/leaky/id_rsa']);
  });

  it('the seeded dotenv is TRACKED — the root .gitignore would otherwise hide it from CI', () => {
    const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'examples/skill-standard/drift/skills/leaky/.env'], {
      encoding: 'utf8',
    }).trim();
    expect(tracked, 'the S11a fixture is not tracked; an untracked fixture proves nothing in CI').toBe(
      'examples/skill-standard/drift/skills/leaky/.env',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Template / dogfood sync                                                  */
/* -------------------------------------------------------------------------- */
describe('skill-standard — the adopter copy and the copy that gates this repo agree', () => {
  it('carries byte-identical constraints and extraction', () => {
    expect(JSON.stringify(dogfood.constraints)).toBe(JSON.stringify(template.constraints));
    expect(JSON.stringify(dogfood.extraction)).toBe(JSON.stringify(template.extraction));
  });

  it('differs only where it should: the dogfood copy is approved, the template is proposed', () => {
    expect(template.metadata.status).toBe('proposed');
    expect(dogfood.metadata.status).toBe('approved');
    expect(dogfood.metadata.id).toBe(template.metadata.id);
  });

  it('points at the normative document, which exists', () => {
    expect(template.intentRefs).toContain('spec/skill-standard/SKILL-STANDARD.md');
    expect(fs.existsSync(path.join(ROOT, 'spec', 'skill-standard', 'SKILL-STANDARD.md'))).toBe(true);
  });

  it('the plugin publishes skill-tuning, and publishes nothing from the corpus', () => {
    // The manifest is where a fixture would become a shipped skill. `tests/skill-contract.test.ts`
    // owns the containment property in general; this asserts the specific entry THIS change adds,
    // so a manifest edit cannot silently unpublish the skill the standard is delivered through.
    const plugin = readJson<{ skills?: readonly string[] }>(path.join(ROOT, '.claude-plugin', 'plugin.json'));
    expect(plugin.skills).toContain('./skills/skill-tuning');
    expect(fs.existsSync(path.join(SKILLS, 'skill-tuning', 'SKILL.md'))).toBe(true);
    const fromCorpus = (plugin.skills ?? []).filter((s) => s.includes('examples') || s.includes('fixtures'));
    expect(fromCorpus, 'the plugin publishes a fixture directory — every installer would load it').toEqual([]);
  });

  it('there is no S12 — the number is left unused, not reassigned', () => {
    // The removal is a MEASURED one (node_modules is invisible to the extractor). Reassigning the
    // number would make a removal look like a renumbering to anyone holding the original spec.
    const ids = template.constraints.map((c) => c.id);
    expect(ids.filter((id) => id.startsWith('S12'))).toEqual([]);
    expect(ids.some((id) => id.startsWith('S11'))).toBe(true);
    expect(ids.some((id) => id.startsWith('S13'))).toBe(false); // S13 is extraction.minFiles, not a constraint
    expect(template.extraction?.minFiles).toBeGreaterThanOrEqual(2);
  });
});

/* -------------------------------------------------------------------------- */
/* 4. S7's other credential shapes — probes assembled at runtime               */
/* -------------------------------------------------------------------------- */
describe('skill-standard — S7 refuses every credential shape it claims, not just the seeded one', () => {
  const s7 = template.constraints.find((c) => c.id === 'S7-no-credential-material');

  it('is a compiled forbiddenPattern (a missing clause would make every case below vacuous)', () => {
    expect(s7).toBeDefined();
    expect(s7?.type).toBe('forbiddenPattern');
    expect(() => safeCompilePattern(s7?.pattern as string)).not.toThrow();
  });

  /**
   * Probes are assembled from fragments so this FILE carries no banned literal — the exact
   * technique, and the exact reason, of scripts/leakage-gate-selftest.sh. The seeded corpus can
   * only demonstrate the one shape this repository's own leakage gate does not ban.
   */
  const alnum = (n: number): string => 'A1b2C3d4E5f6G7h8'.repeat(8).slice(0, n);
  const PROBES: ReadonlyArray<readonly [string, string]> = [
    ['vendor api key (the seeded shape)', `sk-${'a'}nt-${alnum(24)}`],
    ['forge personal token', `${'gh'}${'p_'}${alnum(36)}`],
    ['forge oauth token', `${'gh'}${'o_'}${alnum(36)}`],
    ['cloud access key id', `${'AK'}${'IA'}${'ABCDEFGHIJKLMNOP'}`],
    ['private key header', `-----BEGIN RSA ${'PRIV'}${'ATE'} KEY-----`],
  ];

  for (const [label, probe] of PROBES) {
    it(`fires on a ${label}`, () => {
      const re = safeCompilePattern(s7?.pattern as string);
      expect(re.test(probe), `S7 did not match the ${label} probe`).toBe(true);
    });
  }

  it('does NOT fire on ordinary skill prose (a pattern matching everything would pass every case above)', () => {
    const re = safeCompilePattern(s7?.pattern as string);
    for (const line of [
      'Authenticate with the key your platform issued, read from the environment.',
      'See references/portability-matrix.md for the substitution list.',
      'bce run --blueprint .blueprints/skill-standard.blueprint.json --ct-repo .',
    ]) {
      expect(re.test(line), `S7 false-positived on: ${line}`).toBe(false);
    }
  });
});
