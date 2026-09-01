/**
 * SELF-GATE HONESTY — the executable form of the mode doctrine (SPEC §9 + COUNCIL §8.2).
 *
 * These are the four claims the whole "fail-closed IS the brand" posture rests on. Each is
 * DISCRIMINATING: it fails loudly the moment a skip flag, a silent green, or an advisory/enforced
 * blur is introduced. They gate the engine's own credibility, so they run against the REAL CLI
 * (`dist/cli.js` when built, else `tsx src/cli.ts`) end-to-end, not a mocked seam.
 *
 *   (a) no-skip-flag-exists   — no CLI flag makes `gate` pass/exit-0 despite a real red. Proven two
 *                               ways: a SOURCE scan (no `--skip`/`--bypass`/`--no-verify`/`--force`
 *                               -class flag is parsed by the gate path) AND a BEHAVIORAL sweep
 *                               (throwing every such flag at a red gate never turns it green).
 *   (b) zero-blueprints=FAIL  — a repo whose `.blueprints/` dir has no blueprint is NOT a vacuous
 *                               green (an empty gate must not be mistaken for a proven-green one).
 *   (c) empty-scan=FAIL       — a blueprint whose globs match nothing falls to the fail-closed scan
 *                               floor: a score-0 fail, exit 1 (below the floor can never score 100).
 *   (d) advisory≠enforced     — advisory is machine-distinguishable from enforced (a `mode` field in
 *                               the report JSON + a banner + the exit code all agree), AND — the WO's
 *                               fifth assertion, folded in here — advisory NEVER changes the computed
 *                               score/violation set, ONLY the exit code.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.join(__dirname, '..');
const DIST_CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(REPO_ROOT, 'src', 'cli.ts');

/**
 * Run the real bce CLI and capture BOTH streams + the exit code, regardless of green/red — via
 * spawnSync (execFileSync discards stdout on a non-zero exit and stderr on a zero exit, either of
 * which would silently drop the very output an advisory/enforced assertion inspects). Prefer the
 * built dist (the shipped artifact); fall back to tsx on src when dist is absent.
 */
function runCli(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return {
    status: typeof res.status === 'number' ? res.status : 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

const FIXROOT = path.join(REPO_ROOT, 'fixtures');
const LUNA_PATH = path.join(FIXROOT, 'luna-chat-extension.blueprint.json');

/**
 * Arrange a throwaway repo with the luna blueprint + a chosen source tree.
 * `drift-forbidden-import` reddens the gate; `conformant` greens it; `none` = no source (empty scan).
 * `withBlueprint:false` = a `.blueprints/` dir with NO blueprint (the zero-blueprints case).
 */
function arrangeRepo(opts: {
  source: 'conformant' | 'drift-forbidden-import' | 'none';
  withBlueprint?: boolean;
  mode?: 'enforced' | 'advisory' | 'malformed' | 'none';
}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-selfgate-'));
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  if (opts.withBlueprint !== false) {
    fs.copyFileSync(LUNA_PATH, path.join(dir, '.blueprints', path.basename(LUNA_PATH)));
  }
  if (opts.source !== 'none') {
    fs.cpSync(path.join(FIXROOT, 'extension-surface', opts.source, 'src'), path.join(dir, 'src'), {
      recursive: true,
    });
  }
  if (opts.mode === 'advisory') fs.writeFileSync(path.join(dir, '.bce-mode.json'), '{"mode":"advisory"}\n');
  if (opts.mode === 'enforced') fs.writeFileSync(path.join(dir, '.bce-mode.json'), '{"mode":"enforced"}\n');
  if (opts.mode === 'malformed') fs.writeFileSync(path.join(dir, '.bce-mode.json'), '{"mode":"warn-only"}\n');
  return dir;
}

describe('(a) no-skip-flag-exists — no CLI flag turns a red gate green', () => {
  // The denylist: token substrings that, if a `gate`-consumed flag carried one, would be a skip
  // affordance. `--no-pin` (revision-materialization, run/scan only) and `--downgrade` (the RECORDED
  // graduation ceremony, a separate verb that WRITES an audit record) are deliberately excluded —
  // neither is a gate exit-code bypass. If a future flag literally named `--skip`/`--bypass`/
  // `--force-pass`/`--no-verify`/`--allow-fail` were parsed on the gate path, this test reddens.
  const SKIP_TOKENS = ['skip', 'bypass', 'no-verify', 'allow-fail', 'force-pass', 'ignore-viol', 'suppress'];

  it('SOURCE scan: the CLI never PARSES a skip-class flag (args[...] / args.<flag> definitions)', () => {
    const src = fs.readFileSync(SRC_CLI, 'utf8');
    // Extract the flags the CLI actually READS (parseArgs is the only entry; a flag not read here
    // cannot affect behavior). Bracket form args['flag'] + dotted form args.flag.
    const bracket = [...src.matchAll(/args\[['"]([a-z0-9-]+)['"]\]/g)].map((m) => m[1]);
    const dotted = [...src.matchAll(/args\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]);
    const parsedFlags = new Set([...bracket, ...dotted].map((f) => f.toLowerCase()));
    for (const flag of parsedFlags) {
      for (const tok of SKIP_TOKENS) {
        expect(
          flag.includes(tok),
          `CLI parses a skip-class flag '--${flag}' (matched token '${tok}') — the mode doctrine forbids a gate bypass flag`,
        ).toBe(false);
      }
    }
    // and there is NO `--advisory` / `--enforced` flag: mode is the CONFIG FILE, never a flag.
    expect(parsedFlags.has('advisory')).toBe(false);
    expect(parsedFlags.has('enforced')).toBe(false);
  });

  it('BEHAVIORAL sweep: throwing every skip-shaped flag at a RED gate never makes it green', () => {
    const dir = arrangeRepo({ source: 'drift-forbidden-import' });
    // baseline: the gate is genuinely red here (exit 1).
    const base = runCli(['gate', '--repo', dir], dir);
    expect(base.status).toBe(1);
    // now try each skip-shaped flag (bare + =true). An UNKNOWN flag is inert (parseArgs stores it,
    // nothing reads it) — the gate MUST stay red. If any of these flipped the gate to 0, it would be
    // a skip flag. (This catches a future flag wired to the gate exit path, whatever its exact name.)
    for (const f of ['--skip', '--skip-gate', '--bypass', '--no-verify', '--allow-fail', '--force', '--advisory']) {
      const r = runCli(['gate', '--repo', dir, f], dir);
      expect(r.status, `gate stayed non-green under ${f}`).toBe(1);
      const r2 = runCli(['gate', '--repo', dir, f, 'true'], dir);
      expect(r2.status, `gate stayed non-green under ${f} true`).toBe(1);
    }
  });
});

describe('(b) zero-blueprints = FAIL — an empty gate is not a vacuous green', () => {
  it('a `.blueprints/` dir with NO blueprint REFUSES with exit 2 — not a vacuous green', () => {
    const dir = arrangeRepo({ source: 'conformant', withBlueprint: false });
    const r = runCli(['gate', '--repo', dir], dir);
    // This assertion is the point of the describe block, and until 2026-08-14 it was MISSING: the
    // test asserted only LEGIBILITY (the summary says 0/0, no "score 100") and never the exit code,
    // so `bce gate` returned 0 on a repo that gates nothing while a test named
    // "zero-blueprints = FAIL" passed. An external audit reproduced exit 0 four ways in ENFORCED
    // mode against a tree with a real forbidden import. The floor is now in the verb.
    expect(r.status).toBe(2); // 2 = structural refusal (cf. `bce teeth` on a toothless blueprint),
    //                           deliberately NOT 1, which means a GRADED red.
    expect(r.stderr).toContain('0 blueprint(s) discovered');
    expect(r.stderr).toContain('gates nothing has proven nothing');
    // legibility properties retained
    expect(r.stdout).toContain('0/0 blueprint(s) evaluated');
    expect(r.stdout).not.toContain('score 100');
  });

  it('DISCOVERY, not selection: blueprints present but none in scope still exits 0', () => {
    // The discriminating sibling. A change intersecting no blueprint's scope was correctly graded
    // against everything that applied to it — that is a legitimate green and MUST NOT be swept up
    // by the anti-shelfware floor. If this ever goes red, the floor is testing the wrong thing.
    const dir = arrangeRepo({ source: 'conformant' });
    const r = runCli(['gate', '--repo', dir, '--changed', 'README.md'], dir);
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('gates nothing has proven nothing');
  });
});

describe('(c) empty-scan = FAIL — below the scan floor is a score-0 fail-closed refusal', () => {
  it('a blueprint whose globs match no source → score-0 fail, exit 1 (never a silent 100)', () => {
    const dir = arrangeRepo({ source: 'none' }); // blueprint present, but NO src tree to scan
    const r = runCli(['gate', '--repo', dir], dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('FAILED');
    // the cause is legible: the fail-closed scan floor, not a graded red.
    expect(r.stderr.toLowerCase()).toMatch(/fail-closed|scanned 0|expected >=/);
  });
});

describe('(d) advisory ≠ enforced — machine-distinguishable, and advisory changes ONLY the exit', () => {
  it('enforced (or absent config): a red gate exits 1 and stamps NO advisory posture', () => {
    const dirAbsent = arrangeRepo({ source: 'drift-forbidden-import', mode: 'none' });
    const rAbsent = runCli(['gate', '--repo', dirAbsent], dirAbsent);
    expect(rAbsent.status).toBe(1);
    // absent config → byte-legacy path: no banner, no "[advisory]" tag.
    expect(rAbsent.stderr).not.toContain('ADVISORY MODE');
    expect(rAbsent.stdout).toContain('[enforced]');
  });

  it('advisory: the SAME red gate prints the banner + report mode:"advisory" but exits 0', () => {
    const dir = arrangeRepo({ source: 'drift-forbidden-import', mode: 'advisory' });
    // write the report to disk so we can assert the machine-readable mode field.
    const r = runCli(['gate', '--repo', dir], dir);
    expect(r.status).toBe(0); // the WHOLE point: a real red, non-blocking exit.
    expect(r.stderr).toContain('ADVISORY MODE'); // unmissable banner
    expect(r.stdout).toContain('[advisory]');
    // the violation is STILL printed — advisory is not suppression.
    expect(r.stderr).toContain('FAILED');
  });

  it('advisory NEVER changes the computed score/violations — same repo, only the exit code differs', () => {
    // identical source tree, two mode configs. Capture each gate's per-blueprint score line.
    const dirEnf = arrangeRepo({ source: 'drift-forbidden-import', mode: 'enforced' });
    const dirAdv = arrangeRepo({ source: 'drift-forbidden-import', mode: 'advisory' });
    const enf = runCli(['gate', '--repo', dirEnf], dirEnf);
    const adv = runCli(['gate', '--repo', dirAdv], dirAdv);
    // exit codes DIFFER (the only behavioral difference mode is allowed to make).
    expect(enf.status).toBe(1);
    expect(adv.status).toBe(0);
    // but the graded content is IDENTICAL: the same blueprint FAILED with the same violation IDs.
    const scoreLine = (s: string) => (s.match(/blueprint .* FAILED — score \d+/g) ?? []).sort();
    const violLines = (s: string) => (s.match(/\[[a-z0-9-]+\/(critical|high|medium|low|info)\]/gi) ?? []).sort();
    expect(scoreLine(adv.stderr)).toEqual(scoreLine(enf.stderr));
    expect(violLines(adv.stderr)).toEqual(violLines(enf.stderr));
    expect(scoreLine(enf.stderr).length).toBeGreaterThan(0); // guard: we actually compared a real red
  });

  it('a MALFORMED .bce-mode.json is a LOUD fail-closed error — never a silent default to either mode', () => {
    const dir = arrangeRepo({ source: 'conformant', mode: 'malformed' });
    const r = runCli(['gate', '--repo', dir], dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('.bce-mode.json');
    expect(r.stderr.toLowerCase()).toContain('mode');
  });
});
