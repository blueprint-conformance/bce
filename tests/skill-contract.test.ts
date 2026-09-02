/**
 * skill-contract.test.ts — the Agent Skill cannot drift from the engine it drives.
 *
 * WHY THIS EXISTS. `skills/bce/SKILL.md` is instructions an agent will follow literally: it
 * prints command lines and the agent runs them. A doc that goes stale is an annoyance; a SKILL
 * that goes stale is an agent confidently running a flag the CLI has never accepted, reading the
 * refusal as a repo problem, and working around it. Nothing else in this tree would notice — the
 * skill is not imported, not built, and not published, so a renamed verb or a dropped flag breaks
 * it silently and only a user finds out.
 *
 * So the skill is held to the same discipline as everything else here: it is PROVEN against the
 * engine, on every run, with the engine as the oracle.
 *
 *   1. FRONTMATTER — the file parses as an Agent Skill: a leading YAML block carrying `name` and
 *      `description`, a name in the format's character set that matches its own directory.
 *   2. VERBS AND FLAGS — every `bce …` command line in the skill (fenced blocks AND inline code
 *      spans) names a verb the CLI actually dispatches and only flags the CLI actually reads. The
 *      truth sets are DERIVED FROM `src/cli.ts` itself, never restated here, so renaming a flag in
 *      the CLI reddens this test rather than quietly orphaning the skill.
 *   3. TAXONOMY — every constraint type and extraction profile the skill names is a real member of
 *      the schema's enum, imported from `src/schema.ts`.
 *   4. THE GATES THAT GUARD THE TREE — the skill files pass the leakage scan and the banned-phrase
 *      scan. Both are run from the WORKFLOWS' OWN BYTES (the leakage scan body is extracted between
 *      its in-file markers and executed; the banned-phrase list is read out of its workflow), so
 *      this file adds no third copy of either pattern list to drift from.
 *
 * No LLM, no network — filesystem, the CLI source, and one bash invocation of the real scan.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConstraintTypeSchema, ExtractionProfileSchema } from '../src/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(HERE, '..');
const SKILL_DIR = path.join(repoRoot, 'skills', 'bce');
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const SKILL_README = path.join(repoRoot, 'skills', 'README.md');
const CLI_SRC = path.join(repoRoot, 'src', 'cli.ts');

const skillText = fs.readFileSync(SKILL_MD, 'utf8');
const skillDocuments = [SKILL_MD, ...fs.readdirSync(path.join(SKILL_DIR, 'references'), { recursive: true })
  .filter((entry) => typeof entry === 'string' && entry.endsWith('.md'))
  .map((entry) => path.join(SKILL_DIR, 'references', entry as string))]
  .map((file) => ({ source: path.relative(repoRoot, file), text: fs.readFileSync(file, 'utf8') }));
const skillSurfaceText = skillDocuments.map(({ text }) => text).join('\n');
const cliSource = fs.readFileSync(CLI_SRC, 'utf8');

// ---------------------------------------------------------------------------
// Frontmatter. A hand-rolled reader over the format's actual surface (a leading
// `---` block of `key: value` lines) rather than a YAML dependency — the same
// trade the docs-site builder makes, and for the same reason: an unexpected
// construct should be a red test, not a silently-different parse.
// ---------------------------------------------------------------------------
function readFrontmatter(text: string): { keys: Record<string, string>; body: string } {
  const lines = text.split('\n');
  if (lines[0] !== '---') {
    throw new Error('SKILL.md does not open with a `---` frontmatter fence');
  }
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('SKILL.md frontmatter fence is never closed');
  const keys: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue;
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) throw new Error(`frontmatter line is not a \`key: value\` pair: ${JSON.stringify(line)}`);
    keys[m[1] as string] = (m[2] as string).trim();
  }
  return { keys, body: lines.slice(end + 1).join('\n') };
}

// ---------------------------------------------------------------------------
// The engine's own truth, read out of the CLI source. Restating either set here
// would create exactly the second copy this test exists to prevent.
// ---------------------------------------------------------------------------

/** Verbs the CLI dispatches — `cmd === '…'` — plus the portfolio subcommands (`sub === '…'`). */
function cliVerbs(): { verbs: Set<string>; subcommands: Set<string> } {
  const verbs = new Set<string>();
  const subcommands = new Set<string>();
  for (const m of cliSource.matchAll(/\bcmd === '([a-z][a-z-]*)'/g)) verbs.add(m[1] as string);
  for (const m of cliSource.matchAll(/\bsub === '([a-z][a-z-]*)'/g)) subcommands.add(m[1] as string);
  verbs.delete('help'); // the usage verb: real, but never a command the skill instructs
  return { verbs, subcommands };
}

/** Long-option names the CLI actually reads, in every shape it reads them. */
function cliFlags(): Set<string> {
  const flags = new Set<string>();
  for (const m of cliSource.matchAll(/\bargs\['([a-z0-9][a-z0-9-]*)'\]/g)) flags.add(m[1] as string);
  for (const m of cliSource.matchAll(/\bargs\.([a-z][a-zA-Z0-9]*)\b/g)) flags.add(m[1] as string);
  for (const m of cliSource.matchAll(/collectRepeatable\(rawArgv, '([a-z0-9][a-z0-9-]*)'\)/g)) {
    flags.add(m[1] as string);
  }
  flags.delete('_'); // the positional bucket, not a flag
  return flags;
}

// ---------------------------------------------------------------------------
// Command extraction. Two shapes carry commands in a skill: fenced blocks (what
// the agent copies) and inline code spans (what the prose instructs). Both are
// checked; a wrong flag is just as wrong inside backticks.
// ---------------------------------------------------------------------------
interface Invocation {
  readonly source: string;
  readonly line: string;
  readonly verb: string;
  readonly subcommand: string | null;
  readonly flags: readonly string[];
}

/** Join shell line-continuations so a multi-line invocation is parsed as one command. */
function logicalLines(block: string): string[] {
  const joined: string[] = [];
  let pending = '';
  for (const raw of block.split('\n')) {
    const line = raw.trimEnd();
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1).trim()} `;
      continue;
    }
    joined.push(`${pending}${line.trim()}`);
    pending = '';
  }
  if (pending.trim() !== '') joined.push(pending.trim());
  return joined;
}

function parseInvocation(line: string, source: string): Invocation | null {
  const cleaned = line.replace(/\s+#.*$/, '').trim();
  if (!/^bce\s+\S/.test(cleaned)) return null;
  const tokens = cleaned.split(/\s+/).slice(1);
  const verb = tokens[0];
  if (verb === undefined || verb.startsWith('-')) return null;
  const second = tokens[1];
  const subcommand = verb === 'portfolio' && second !== undefined && !second.startsWith('-') ? second : null;
  const flags = tokens.filter((t) => t.startsWith('--')).map((t) => t.replace(/^--/, '').split('=')[0] as string);
  return { source, line: cleaned, verb, subcommand, flags };
}

function invocationsIn(text: string, source: string): Invocation[] {
  const found: Invocation[] = [];
  // Fenced blocks.
  for (const m of text.matchAll(/^```[a-z]*\n([\s\S]*?)^```$/gm)) {
    for (const line of logicalLines(m[1] as string)) {
      const inv = parseInvocation(line, source);
      if (inv) found.push(inv);
    }
  }
  // Inline code spans, with fenced regions removed first so nothing is counted twice.
  const prose = text.replace(/^```[a-z]*\n[\s\S]*?^```$/gm, '');
  for (const m of prose.matchAll(/`([^`\n]+)`/g)) {
    const inv = parseInvocation(m[1] as string, source);
    if (inv) found.push(inv);
  }
  return found;
}

const invocations = [
  ...skillDocuments.flatMap(({ source, text }) => invocationsIn(text, source)),
  ...invocationsIn(fs.readFileSync(SKILL_README, 'utf8'), 'skills/README.md'),
];

/**
 * Long options the skill names on their own, in prose — `--no-pin`, `--all`. These are
 * instructions too, and a renamed flag would rot here just as silently as in a command line.
 */
function inlineFlagMentions(text: string): string[] {
  const prose = text.replace(/^```[a-z]*\n[\s\S]*?^```$/gm, '');
  const out: string[] = [];
  for (const m of prose.matchAll(/`(--[a-z0-9][a-z0-9-]*)[^`\n]*`/g)) {
    out.push((m[1] as string).replace(/^--/, ''));
  }
  return out;
}

/**
 * The flags the skill promises do NOT exist. Asserted absent from the CLI rather than exempted
 * from the check: "there are no skip flags" is a claim, and a claim gets proven here like any
 * other. If one of these is ever added, this test goes red and the skill's text is wrong.
 */
const ABSENT_BY_DESIGN = ['skip', 'force', 'no-verify'] as const;

describe('Agent Skill — frontmatter', () => {
  const { keys, body } = readFrontmatter(skillText);

  it('opens with a parseable frontmatter block carrying name and description', () => {
    expect(Object.keys(keys).sort()).toContain('name');
    expect(Object.keys(keys).sort()).toContain('description');
    expect(keys.name).toBeTruthy();
    expect(keys.description).toBeTruthy();
  });

  it('names itself in the format character set, matching its own directory', () => {
    expect(keys.name).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
    expect(keys.name).toBe(path.basename(SKILL_DIR));
  });

  it('carries a description a router can actually trigger on, within the length ceiling', () => {
    // The description is the ONLY thing most consumers see when deciding whether to load the
    // skill. A one-liner that says "the bce skill" is a skill that never fires.
    expect((keys.description as string).length).toBeGreaterThan(80);
    expect((keys.description as string).length).toBeLessThanOrEqual(1024);
    expect(keys.description).toContain('MCP');
  });

  it('has a body — the frontmatter is not the whole file', () => {
    expect(body.trim().length).toBeGreaterThan(1000);
    expect(body).toMatch(/^#\s+\S/m);
  });

  it('keeps the always-loaded routing surface compact and defers lifecycle detail', () => {
    expect(skillText.split('\n').length).toBeLessThanOrEqual(140);
    expect(skillText).toContain('references/lifecycle.md');
    expect(fs.existsSync(path.join(SKILL_DIR, 'references', 'lifecycle.md'))).toBe(true);
  });
});

describe('Agent Skill — every command it teaches is a real command', () => {
  const { verbs, subcommands } = cliVerbs();
  const flags = cliFlags();

  it('the truth sets were actually derived (a silent empty parse would pass everything)', () => {
    expect(verbs.size).toBeGreaterThanOrEqual(8);
    expect(subcommands.size).toBeGreaterThanOrEqual(2);
    expect(flags.size).toBeGreaterThanOrEqual(20);
    // Anchors: if these three stop being found, the extraction regexes have gone stale.
    expect(verbs.has('gate')).toBe(true);
    expect(verbs.has('teeth')).toBe(true);
    expect(flags.has('no-pin')).toBe(true);
  });

  it('finds the invocations it is meant to check', () => {
    expect(invocations.length).toBeGreaterThanOrEqual(10);
  });

  it('names only verbs the CLI dispatches', () => {
    const bad = invocations.filter((i) => !verbs.has(i.verb));
    expect(
      bad,
      `unknown verb(s):\n${bad.map((b) => `  ${b.source}: ${b.line}`).join('\n')}\n` +
        `CLI dispatches: ${[...verbs].sort().join(' ')}`,
    ).toEqual([]);
  });

  it('names only portfolio subcommands the CLI dispatches', () => {
    const bad = invocations.filter((i) => i.subcommand !== null && !subcommands.has(i.subcommand));
    expect(
      bad,
      `unknown subcommand(s):\n${bad.map((b) => `  ${b.source}: ${b.line}`).join('\n')}`,
    ).toEqual([]);
  });

  it('passes only flags the CLI reads', () => {
    const bad: string[] = [];
    for (const inv of invocations) {
      for (const f of inv.flags) {
        if (!flags.has(f)) bad.push(`  ${inv.source}: --${f} in \`${inv.line}\``);
      }
    }
    expect(
      bad,
      `flag(s) the CLI never reads:\n${bad.join('\n')}\nCLI reads: ${[...flags].sort().join(' ')}`,
    ).toEqual([]);
  });

  it('names only real flags in prose too, except the ones it says do not exist', () => {
    const mentioned = inlineFlagMentions(skillSurfaceText);
    // The compact primary skill intentionally moves most flags into executable command blocks;
    // keep two prose anchors so this separate extractor cannot silently go empty.
    expect(mentioned.length).toBeGreaterThanOrEqual(2);
    const absent = new Set<string>(ABSENT_BY_DESIGN);
    const bad = [...new Set(mentioned)].filter((f) => !flags.has(f) && !absent.has(f));
    expect(bad, `prose names flag(s) the CLI never reads: ${bad.map((f) => `--${f}`).join(' ')}`).toEqual([]);
  });

  it('the flags it says do not exist really do not exist', () => {
    const present = ABSENT_BY_DESIGN.filter((f) => flags.has(f));
    expect(
      present,
      `the skill tells agents these are unavailable, but the CLI now reads: ${present.map((f) => `--${f}`).join(' ')}`,
    ).toEqual([]);
  });
});

describe('Agent Skill — the taxonomy it teaches is the schema\'s', () => {
  it('every constraint type it names is a real ConstraintType', () => {
    const real = new Set<string>(ConstraintTypeSchema.options);
    // Constraint types appear as `type` or `type:arg` inside code spans; collect the bare heads.
    const named = new Set<string>();
    for (const m of skillSurfaceText.matchAll(/`(forbidden|required|minimum|custom|behavioral)([A-Za-z]+)[`:]/g)) {
      named.add(`${m[1] as string}${m[2] as string}`);
    }
    expect(named.size, 'the skill names no constraint types — the extraction went stale').toBeGreaterThanOrEqual(8);
    const unknown = [...named].filter((n) => !real.has(n));
    expect(unknown, `not in ConstraintTypeSchema: ${unknown.join(', ')}`).toEqual([]);
  });

  it('every extraction profile it names is a real ExtractionProfile', () => {
    const real = new Set<string>(ExtractionProfileSchema.options);
    const named = new Set<string>();
    for (const m of skillSurfaceText.matchAll(/`([a-z][a-z-]*-(?:handler|surface))`/g)) named.add(m[1] as string);
    expect(named.size).toBeGreaterThanOrEqual(1);
    const unknown = [...named].filter((n) => !real.has(n));
    expect(unknown, `not in ExtractionProfileSchema: ${unknown.join(', ')}`).toEqual([]);
  });
});

describe('Agent Skill — the tree-wide gates hold over it', () => {
  /** Copy the skill surface into a scratch tree so a scan can walk it in isolation. */
  function stageSkillFiles(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-skill-scan-'));
    fs.mkdirSync(path.join(dir, 'skills', 'bce'), { recursive: true });
    fs.copyFileSync(SKILL_MD, path.join(dir, 'skills', 'bce', 'SKILL.md'));
    fs.copyFileSync(SKILL_README, path.join(dir, 'skills', 'README.md'));
    return dir;
  }

  it('passes the leakage scan — run from leakage-gate.yml\'s own bytes, not a copy of them', () => {
    const lines = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'leakage-gate.yml'), 'utf8').split('\n');
    const begin = lines.findIndex((l) => l.includes('# --- scan body begin ---'));
    const end = lines.findIndex((l) => l.includes('# --- scan body end ---'));
    expect(begin, 'leakage-gate.yml lost its scan-body markers').toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    // The body is indented inside the workflow's `run: |` block; strip that indent to run it.
    const indent = (/^\s*/.exec(lines[begin] as string) as RegExpExecArray)[0].length;
    const script = lines.slice(begin, end + 1).map((l) => l.slice(indent)).join('\n');

    const dir = stageSkillFiles();
    try {
      const r = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' });
      expect(r.status, `leakage scan output:\n${r.stdout}${r.stderr}`).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes the banned-phrase scan — the phrase list read out of its own workflow', () => {
    const wf = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'banned-phrase-gate.yml'), 'utf8');
    const block = /PATTERNS=\(\n([\s\S]*?)\n\s*\)/.exec(wf);
    expect(block, 'banned-phrase-gate.yml no longer carries a PATTERNS array').toBeTruthy();
    const phrases = (block as RegExpExecArray)[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^['"]|['"]$/g, ''));
    expect(phrases.length).toBeGreaterThanOrEqual(9);

    const haystacks: ReadonlyArray<readonly [string, string]> = [
      ...skillDocuments.map(({ source, text }) => [source, text.toLowerCase()] as const),
      ['skills/README.md', fs.readFileSync(SKILL_README, 'utf8').toLowerCase()],
    ];
    const hits: string[] = [];
    for (const [name, text] of haystacks) {
      for (const p of phrases) {
        if (text.includes(p.toLowerCase())) hits.push(`  ${name}: "${p}"`);
      }
    }
    expect(hits, `banned positioning phrase(s):\n${hits.join('\n')}`).toEqual([]);
  });
});

/**
 * The plugin manifests, held to the two properties `claude plugin validate --strict` does NOT check.
 *
 * WHY THIS EXISTS, and why it is not a second copy of the validator. CI already runs
 * `claude plugin validate . --strict`, which covers schema, unknown fields, and whether every
 * `skills[]` path resolves. Both assertions below were MEASURED against that validator on a
 * seeded manifest and it returned "Validation passed" for each — they are its blind spots, not
 * a restatement of its work.
 *
 *   1. CONTAINMENT. The `skills` key is ADDITIVE, not an allowlist — measured: everything under
 *      `skills/` is auto-discovered whether or not the key names it, and an entry pointing
 *      OUTSIDE `skills/` ADDS that directory to the installer's session. So the key is the one
 *      way a SKILL.md under `examples/`, `fixtures/`, or `corpus/` could ship into every
 *      installer's Claude Code as a real, loadable skill. Those trees exist to hold deliberately
 *      broken and seeded material; publishing one is a supply-chain-shaped mistake that no
 *      schema check can see, because the manifest is perfectly well-formed.
 *
 *   2. THE INSTALL STRING. `blueprint@bce` is `<plugin name>@<marketplace name>`, composed from
 *      two files that nothing forces to agree — the validator passes a marketplace entry whose
 *      `name` contradicts the plugin's own. Once a listing is published that string is fixed:
 *      every install line, every doc, every directory entry carries it. It is pinned here as a
 *      literal ON PURPOSE. This is a lock, not a derivation — if a future change means to move
 *      it, the diff should say so out loud rather than silently invalidating published text.
 */
describe('Claude Code plugin — the manifests the validator cannot fully check', () => {
  const pluginManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'plugin.json'), 'utf8'),
  ) as { name: string; skills?: readonly string[] };
  const marketplaceManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf8'),
  ) as { name: string; plugins: ReadonlyArray<{ name: string; source: string }> };

  it('publishes only skills that live under skills/ — never a fixture or corpus tree', () => {
    const declared = pluginManifest.skills ?? [];
    expect(declared.length, 'plugin.json declares no skills at all').toBeGreaterThan(0);

    const escaping = declared.filter((entry) => {
      const resolved = path.resolve(repoRoot, entry);
      const skillsRoot = path.join(repoRoot, 'skills');
      return resolved !== skillsRoot && !resolved.startsWith(`${skillsRoot}${path.sep}`);
    });
    expect(
      escaping,
      `plugin.json publishes skill director${escaping.length === 1 ? 'y' : 'ies'} outside skills/: ` +
        `${escaping.join(', ')} — every installer would load ${escaping.length === 1 ? 'it' : 'them'}`,
    ).toEqual([]);

    // The instrument has to be able to SEE a skill, or the assertion above is vacuous.
    expect(declared, 'the shipped skill is no longer published by the plugin').toContain(
      './skills/bce',
    );
    for (const entry of declared) {
      expect(
        fs.existsSync(path.join(path.resolve(repoRoot, entry), 'SKILL.md')),
        `${entry} is declared in plugin.json but holds no SKILL.md`,
      ).toBe(true);
    }
  });

  it('keeps the published install string blueprint@bce intact across both manifests', () => {
    expect(marketplaceManifest.plugins).toHaveLength(1);
    const entry = marketplaceManifest.plugins[0] as { name: string; source: string };

    // Agreement: the two files describe the same plugin.
    expect(entry.name).toBe(pluginManifest.name);
    // Root-is-plugin: the marketplace entry resolves to this repository, so plugin.json is the
    // single authority for version and component paths.
    expect(entry.source).toBe('./');

    // The lock itself.
    expect(`${entry.name}@${marketplaceManifest.name}`).toBe('blueprint@bce');
  });
});
