/**
 * first-win-matrix — the four starting shapes in `examples/first-win/` each complete a real
 * `bce author` → RED → fix → GREEN loop, and each is TIMED against a hard 120-second budget.
 *
 * WHY THIS EXISTS. `examples/quickstart` proves ONE fixed shape: a pre-authored, ratified
 * blueprint gating a two-tree example. It cannot answer the question a visitor actually has —
 * "what does this look like on a repo shaped like mine, where I have to write the contract
 * myself?" The first-win matrix answers that for four shapes (empty-repo / plain-js /
 * typescript / monorepo), and this suite is what stops the answer from being a story:
 *
 *   1. EVERY `bce` command is EXTRACTED FROM THE WALKTHROUGH'S OWN ```bash BLOCKS and executed
 *      verbatim — never re-typed here. A walkthrough whose commands stop working fails HERE,
 *      and a command that only works in the test but not in the README is impossible by
 *      construction. (Same anti-stale discipline as tests/examples-readme-proof.test.ts, which
 *      pins the quickstart's displayed output to the engine's actual output.)
 *   2. EVERY blueprint in the matrix is produced by a REAL `bce author` invocation — no
 *      hand-authored JSON is committed for these fixtures, and the assertion below proves the
 *      authored artifact appeared only after the command ran.
 *   3. Each README's displayed verdict lines are asserted to be lines the engine ACTUALLY
 *      printed, so a verdict-semantics change reddens here instead of silently staling four
 *      walkthroughs.
 *   4. The full sequence per shape is WALL-CLOCK MEASURED and must land under 120_000ms. The
 *      budget is measured, not estimated: exceeding it fails the run.
 *
 * Fixtures are copied to a temp dir before anything runs, so the suite never mutates this tree.
 * No LLM, no network — pure CLI + filesystem.
 *
 * The per-test timeout is set ABOVE the 120s budget on purpose: the budget assertion must be
 * what fails on a slow shape, not vitest's own timeout (which would report a timeout instead of
 * the measured overrun).
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.join(__dirname, '..');
const DIST_CLI = path.join(REPO_ROOT, 'dist', 'cli.js');
const SRC_CLI = path.join(REPO_ROOT, 'src', 'cli.ts');
const MATRIX_ROOT = path.join(REPO_ROOT, 'examples', 'first-win');

/** The measured budget every shape's full sequence must land under (Success Criterion 2). */
const BUDGET_MS = 120_000;
/** Above the budget, so the budget assertion — not vitest — is what fails a slow shape. */
const TEST_TIMEOUT_MS = 150_000;

/**
 * Run the real bce CLI, capturing BOTH streams and the exit code regardless of verdict — via
 * spawnSync (execFileSync discards stdout on a non-zero exit, which would drop the very RED
 * output these assertions read). Prefers the BUILT dist artifact — the thing an adopter
 * actually runs, and what CI has on disk by the time `npm test` runs (ci.yml builds first) —
 * and falls back to tsx on src when dist is absent, so a bare `npm test` in a fresh checkout
 * still exercises the same code path. Mirrors tests/self-gate-honesty.test.ts.
 */
function runCli(args: readonly string[], cwd: string): { status: number; out: string } {
  const useDist = fs.existsSync(DIST_CLI);
  const cmd = useDist ? process.execPath : path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
  const argv = useDist ? [DIST_CLI, ...args] : [SRC_CLI, ...args];
  const res = spawnSync(cmd, argv, { cwd, encoding: 'utf8' });
  return {
    status: typeof res.status === 'number' ? res.status : 1,
    out: `${res.stdout ?? ''}${res.stderr ?? ''}`,
  };
}

/**
 * Split a shell command line into argv, honouring single and double quotes (no expansion —
 * the walkthroughs deliberately single-quote any argument containing `$` or `{`, and those
 * characters must reach the engine literally).
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(cur);
        cur = '';
        started = false;
      }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

/**
 * Extract every `bce …` invocation from a walkthrough's ```bash blocks, in document order, as
 * argv arrays with the leading `bce` dropped. Backslash-continued lines are joined first, so a
 * multi-line `bce author \` block becomes one command exactly as a reader's shell would see it.
 *
 * This is the load-bearing anti-drift mechanism: the test cannot run a command the README does
 * not show, and the README cannot show a command the test does not run.
 */
function bceCommandsFrom(readmePath: string): string[][] {
  const md = fs.readFileSync(readmePath, 'utf8');
  const blocks = [...md.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] as string);
  const commands: string[][] = [];
  for (const block of blocks) {
    const joined = block.replace(/\\\n\s*/g, ' ');
    for (const raw of joined.split('\n')) {
      const line = raw.trim();
      if (!line.startsWith('bce ')) continue;
      const argv = tokenize(line);
      commands.push(argv.slice(1));
    }
  }
  return commands;
}

/** Assert the README displays this exact engine line — a stale walkthrough fails here. */
function assertReadmeCarries(readmePath: string, line: string): void {
  const md = fs.readFileSync(readmePath, 'utf8');
  expect(
    md.includes(line),
    `${path.relative(REPO_ROOT, readmePath)} does not display the engine's actual output line:\n` +
      `  ${line}\n` +
      'The walkthrough is stale against the engine — update its displayed output block.',
  ).toBe(true);
}

/** Copy a shape's starting tree into a fresh temp dir and prepare `.blueprints/`, as step 0 does. */
function arrangeShape(shape: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bce-first-win-${shape}-`));
  fs.cpSync(path.join(MATRIX_ROOT, shape, 'repo'), dir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.blueprints'), { recursive: true });
  return dir;
}

function readFile(dir: string, rel: string): string {
  return fs.readFileSync(path.join(dir, rel), 'utf8');
}

function writeFile(dir: string, rel: string, content: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Replace exactly one occurrence of `from` with `to`, failing loudly if it is not present. */
function replaceOnce(dir: string, rel: string, from: string, to: string): void {
  const before = readFile(dir, rel);
  expect(before.includes(from), `fixture ${rel} no longer contains the line the walkthrough fixes:\n  ${from}`).toBe(
    true,
  );
  writeFile(dir, rel, before.replace(from, to));
}

const SHAPES = ['empty-repo', 'plain-js', 'typescript', 'monorepo'] as const;
/** Filled in as each shape runs; asserted as a set at the end so the summary is one place. */
const measured = new Map<string, number>();

describe('first-win matrix — four shapes, each a real author → RED → fix → GREEN loop', () => {
  it(
    'empty-repo: author REFUSES an empty scope (exit 2), then first-file → RED → fix → GREEN',
    () => {
      const readme = path.join(MATRIX_ROOT, 'empty-repo', 'README.md');
      const cmds = bceCommandsFrom(readme);
      // step 1 author (re-used verbatim in step 2), step 3 gate --all, step 4 gate
      expect(cmds).toHaveLength(3);
      const [author, gateRed, gateGreen] = cmds as [string[], string[], string[]];
      expect(author[0]).toBe('author');

      const dir = arrangeShape('empty-repo');
      const started = Date.now();
      try {
        // 1. author against a repo with NO source — the honest refusal.
        const refused = runCli(author, dir);
        expect(refused.status, 'authoring against an empty scope must exit 2').toBe(2);
        expect(refused.out).toContain('author sanity FAILED: the blueprint scope matched 0 files');
        assertReadmeCarries(
          readme,
          "::error::author sanity FAILED: the blueprint scope matched 0 files in . (profile 'plugin-surface', paths: src/**/*.js). A blueprint whose scope resolves nothing gates nothing — fix --scope-paths (draft left at .blueprints/fetch-through-the-platform.blueprint.json for editing).",
        );

        // 2. write the first source file (the walkthrough's ```js block), then re-author.
        const firstFile = [
          "'use strict';",
          "const fetch = require('node-fetch');",
          '',
          'async function checkUpstream(url) {',
          "  const res = await fetch(url, { method: 'HEAD' });",
          '  return { ok: res.ok, status: res.status };',
          '}',
          '',
          'module.exports = { checkUpstream };',
          '',
        ].join('\n');
        assertReadmeCarries(readme, firstFile.trimEnd());
        writeFile(dir, 'src/health.check.js', firstFile);

        const authored = runCli(author, dir);
        expect(authored.status, 'authoring with one in-scope file must succeed').toBe(0);
        expect(authored.out).toContain('author sanity: scope matches 1 file(s) in .');
        // Success Criterion 3: the blueprint exists ONLY because the real command produced it.
        const bpPath = path.join(dir, '.blueprints', 'fetch-through-the-platform.blueprint.json');
        expect(fs.existsSync(bpPath), 'bce author must have written the blueprint').toBe(true);
        const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8')) as {
          metadata: { status: string; version: string };
        };
        expect(bp.metadata.status, 'an authored blueprint is born a draft, never ratified').toBe('draft');

        // 3. gate → RED, naming the file and line.
        const red = runCli(gateRed, dir);
        expect(red.status, 'the seeded violation must exit 1').toBe(1);
        expect(red.out).toContain('src/health.check.js#L2');
        assertReadmeCarries(readme, 'observed: forbidden edge file:src/health.check.js -> node-fetch is present');
        assertReadmeCarries(readme, 'at:       src/health.check.js#L2');

        // 4. the one-line fix — delete the require; Node's global fetch keeps the body working.
        replaceOnce(dir, 'src/health.check.js', "const fetch = require('node-fetch');\n", '');

        const green = runCli(gateGreen, dir);
        expect(green.status, 'after the fix the gate must be green').toBe(0);
        expect(green.out).toContain('score 100 (pass)');
        assertReadmeCarries(readme, 'bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.');
      } finally {
        measured.set('empty-repo', Date.now() - started);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const elapsed = measured.get('empty-repo') as number;
      // eslint-disable-next-line no-console
      console.log(`  first-win[empty-repo]  ${elapsed}ms  (budget ${BUDGET_MS}ms)`);
      expect(elapsed, `empty-repo took ${elapsed}ms, over the ${BUDGET_MS}ms first-win budget`).toBeLessThan(
        BUDGET_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'plain-js: a CommonJS require() is real AST evidence — author → RED → fix → GREEN',
    () => {
      const readme = path.join(MATRIX_ROOT, 'plain-js', 'README.md');
      const cmds = bceCommandsFrom(readme);
      expect(cmds).toHaveLength(3);
      const [author, gateRed, gateGreen] = cmds as [string[], string[], string[]];
      expect(author[0]).toBe('author');

      const dir = arrangeShape('plain-js');
      const started = Date.now();
      try {
        const authored = runCli(author, dir);
        expect(authored.status).toBe(0);
        expect(authored.out).toContain('author sanity: scope matches 2 file(s) in .');
        const bpPath = path.join(dir, '.blueprints', 'dates-through-intl.blueprint.json');
        expect(fs.existsSync(bpPath), 'bce author must have written the blueprint').toBe(true);

        const red = runCli(gateRed, dir);
        expect(red.status, 'the seeded moment require must exit 1').toBe(1);
        expect(red.out).toContain('src/invoice.report.js#L10');
        assertReadmeCarries(readme, 'observed: forbidden edge file:src/invoice.report.js -> moment is present');
        assertReadmeCarries(readme, 'at:       src/invoice.report.js#L10');
        // the conformant sibling is scanned but NOT reported — the report names violations, not files.
        expect(red.out).not.toContain('src/money.js');

        // the two-line fix the walkthrough documents.
        replaceOnce(dir, 'src/invoice.report.js', "const moment = require('moment');\n", '');
        replaceOnce(
          dir,
          'src/invoice.report.js',
          "const issued = moment(invoice.issuedAt).format('YYYY-MM-DD');",
          "const issued = new Intl.DateTimeFormat('en-CA').format(invoice.issuedAt);",
        );
        assertReadmeCarries(readme, "const issued = new Intl.DateTimeFormat('en-CA').format(invoice.issuedAt);");

        const green = runCli(gateGreen, dir);
        expect(green.status).toBe(0);
        expect(green.out).toContain('score 100 (pass)');
      } finally {
        measured.set('plain-js', Date.now() - started);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const elapsed = measured.get('plain-js') as number;
      // eslint-disable-next-line no-console
      console.log(`  first-win[plain-js]    ${elapsed}ms  (budget ${BUDGET_MS}ms)`);
      expect(elapsed, `plain-js took ${elapsed}ms, over the ${BUDGET_MS}ms first-win budget`).toBeLessThan(BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'typescript: an authored forbiddenPattern (content rule) → RED → fix → GREEN',
    () => {
      const readme = path.join(MATRIX_ROOT, 'typescript', 'README.md');
      const cmds = bceCommandsFrom(readme);
      expect(cmds).toHaveLength(3);
      const [author, gateRed, gateGreen] = cmds as [string[], string[], string[]];
      expect(author[0]).toBe('author');
      // The pattern must survive the walkthrough's single-quoting intact — `$` and `{` reach the
      // engine literally. If a future edit drops the quotes, this catches it before the shell does.
      expect(author).toContain('forbiddenPattern:SELECT .*\\$\\{:critical');

      const dir = arrangeShape('typescript');
      const started = Date.now();
      try {
        const authored = runCli(author, dir);
        expect(authored.status).toBe(0);
        expect(authored.out).toContain('author sanity: scope matches 2 file(s) in .');
        const bpPath = path.join(dir, '.blueprints', 'parameterized-queries-only.blueprint.json');
        expect(fs.existsSync(bpPath), 'bce author must have written the blueprint').toBe(true);
        const bp = JSON.parse(fs.readFileSync(bpPath, 'utf8')) as {
          constraints: Array<{ type: string }>;
        };
        expect(bp.constraints[0]?.type, 'the matrix must exercise a content rule, not a 4th dependency edge').toBe(
          'forbiddenPattern',
        );

        const red = runCli(gateRed, dir);
        expect(red.status, 'the interpolated SQL must exit 1').toBe(1);
        expect(red.out).toContain('src/handlers/orders.ts#L12');
        assertReadmeCarries(
          readme,
          'observed: forbidden content pattern /SELECT .*\\$\\{/ matched at src/handlers/orders.ts#L12',
        );

        const parameterized =
          "  return pool.query('SELECT * FROM orders WHERE customer_id = $1 ORDER BY placed_at DESC', [customerId]);";
        replaceOnce(
          dir,
          'src/handlers/orders.ts',
          '  return pool.query(`SELECT * FROM orders WHERE customer_id = \'${customerId}\' ORDER BY placed_at DESC`);',
          parameterized,
        );
        assertReadmeCarries(readme, parameterized.trim());

        const green = runCli(gateGreen, dir);
        expect(green.status).toBe(0);
        expect(green.out).toContain('score 100 (pass)');
      } finally {
        measured.set('typescript', Date.now() - started);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const elapsed = measured.get('typescript') as number;
      // eslint-disable-next-line no-console
      console.log(`  first-win[typescript]  ${elapsed}ms  (budget ${BUDGET_MS}ms)`);
      expect(elapsed, `typescript took ${elapsed}ms, over the ${BUDGET_MS}ms first-win budget`).toBeLessThan(
        BUDGET_MS,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'monorepo: --scope-paths narrows the rule to one package — the other stays conformant',
    () => {
      const readme = path.join(MATRIX_ROOT, 'monorepo', 'README.md');
      const cmds = bceCommandsFrom(readme);
      expect(cmds).toHaveLength(3);
      const [author, gateRed, gateGreen] = cmds as [string[], string[], string[]];
      expect(author[0]).toBe('author');
      expect(author, 'the monorepo shape must narrow the scope — that is what it exists to prove').toContain(
        'packages/web/src/**/*.ts',
      );

      const dir = arrangeShape('monorepo');
      const started = Date.now();
      try {
        const authored = runCli(author, dir);
        expect(authored.status).toBe(0);
        // TWO source files exist; the narrowed scope deliberately resolves ONE.
        expect(authored.out, 'the narrowing must be visible before the gate ever runs').toContain(
          'author sanity: scope matches 1 file(s) in .',
        );

        const red = runCli(gateRed, dir);
        expect(red.status).toBe(1);
        expect(red.out).toContain('packages/web/src/checkout.page.ts#L8');
        // The load-bearing assertion of this shape: the api package imports the SAME module and
        // is NOT reported, because it is outside the authored scope.
        expect(
          red.out.includes('packages/api'),
          'the out-of-scope server import must NOT be reported — that is the whole point of --scope-paths',
        ).toBe(false);
        assertReadmeCarries(
          readme,
          'observed: forbidden edge file:packages/web/src/checkout.page.ts -> stripe is present',
        );

        writeFile(
          dir,
          'packages/web/src/checkout.page.ts',
          [
            '/**',
            ' * Browser-side checkout.',
            ' *',
            ' * FIXED: the browser no longer imports the payment SDK. It posts to the api package\'s',
            ' * route, which owns the secret key and the SDK call.',
            ' */',
            'export async function startCheckout(cartId: string, amountCents: number) {',
            "  const res = await fetch('/api/checkout/session', {",
            "    method: 'POST',",
            "    headers: { 'content-type': 'application/json' },",
            '    body: JSON.stringify({ cartId, amountCents }),',
            '  });',
            '  const session = (await res.json()) as { url: string };',
            '  window.location.assign(session.url);',
            '}',
            '',
          ].join('\n'),
        );

        const green = runCli(gateGreen, dir);
        expect(green.status).toBe(0);
        expect(green.out).toContain('score 100 (pass)');
        // …and the server package still imports the SDK, untouched. A "fix" that also stripped the
        // legitimate server-side import would be the gate breaking the architecture it protects.
        const apiSource = readFile(dir, 'packages/api/src/billing.service.ts').split('\n');
        expect(apiSource).toContain("import Stripe from 'stripe';");
        // The walkthrough names that import's line number explicitly; keep the claim true.
        expect(apiSource[9], 'the monorepo walkthrough cites this import at line 10').toBe(
          "import Stripe from 'stripe';",
        );
      } finally {
        measured.set('monorepo', Date.now() - started);
        fs.rmSync(dir, { recursive: true, force: true });
      }
      const elapsed = measured.get('monorepo') as number;
      // eslint-disable-next-line no-console
      console.log(`  first-win[monorepo]    ${elapsed}ms  (budget ${BUDGET_MS}ms)`);
      expect(elapsed, `monorepo took ${elapsed}ms, over the ${BUDGET_MS}ms first-win budget`).toBeLessThan(BUDGET_MS);
    },
    TEST_TIMEOUT_MS,
  );

  it('every shape was measured, and every measurement is under the 120s budget', () => {
    for (const shape of SHAPES) {
      const elapsed = measured.get(shape);
      expect(elapsed, `${shape} produced no measurement — its sequence did not run`).toBeTypeOf('number');
      expect(elapsed as number).toBeLessThan(BUDGET_MS);
    }
  });

  /**
   * The FRONT PAGE's speed claim, bound to this measurement.
   *
   * WHY THIS EXISTS. The root README leads with a bold, linked claim about how long a first
   * win takes, and links it HERE as the proof. But the budget asserted above is 120 seconds —
   * a deliberately generous ceiling for a slow shared runner — so on its own it vouches for
   * nothing like the number a reader sees. A page that cites a test as its evidence, where
   * the test permits a value thirty times larger, is exactly the "measured, not asserted"
   * failure this repository exists to refuse; it just happens to be committed by us.
   *
   * So the claim is not re-typed here as a constant that could drift from the page. The
   * NUMBER IS PARSED OUT OF THE README and the live measurement is required to satisfy it,
   * in both directions:
   *
   *   - raise the claim on the page and this test raises its own bar with it;
   *   - slow the loop past what the page promises and this test reds, naming the shape.
   *
   * The page therefore cannot claim a number the engine does not meet, and cannot cite this
   * file as proof of something this file does not check. Direction of repair, as everywhere
   * else here: the PAGE is corrected to match the engine, never the reverse — if a shape
   * genuinely takes longer, the honest fix is a bigger number on the README.
   *
   * WHY THE PAGE'S NUMBER HAS MARGIN, AND WHY IT MUST KEEP IT. This binding is only worth
   * having if it fails for a real reason, so the claim it binds has to clear the SLOW
   * environment, not the author's laptop. Measured on this repository's own CI (three runs,
   * standard GitHub runner): 3751 / 3842 / 3770 ms for the slowest shape (empty-repo), against
   * 796-962 ms for the same shape on an M-series laptop — roughly 4x. A claim set just above
   * the CI figure would leave a few percent of headroom and turn a busy runner into a red
   * check on an unrelated PR, which is how a gate stops being believed. The number on the page
   * is therefore chosen to clear the measured CI worst case with room for a loaded runner, and
   * the SPECIFIC measured range is published next to it, where it does the honest bragging.
   * A 2026-09-05 Node 22 local full-suite run measured 15.024s for the TypeScript shape while
   * the synchronous extractor-teeth proof shared the machine. The front-page budget is therefore
   * 30s: still four times tighter than the 120s hard ceiling, with measured loaded-runner margin.
   * Tightening the claim later is fine; tightening it to within noise of the measurement is
   * how this check becomes the flaky one everybody learns to ignore.
   */
  it('the README\'s first-win claim is met by every measured shape', () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8');
    const claim = /in under (\d+(?:\.\d+)?) seconds/.exec(readme);
    expect(
      claim,
      'README.md no longer states a first-win claim in the form "in under N seconds".\n' +
        'This test binds that claim to the measurement below; if the claim moved, move this ' +
        'matcher with it rather than dropping the binding.',
    ).not.toBeNull();

    const claimedMs = Number((claim as RegExpExecArray)[1]) * 1000;
    for (const shape of SHAPES) {
      const elapsed = measured.get(shape) as number;
      expect(
        elapsed,
        `README promises a first win in under ${claimedMs / 1000}s, but ${shape} measured ` +
          `${elapsed}ms. Correct the PAGE to the number the engine actually meets.`,
      ).toBeLessThan(claimedMs);
    }
  });
});

describe('first-win matrix — the honesty claims are checked against the repo, not asserted in prose', () => {
  const MATRIX_README = path.join(MATRIX_ROOT, 'README.md');
  const FIRST_WIN_DOC = path.join(REPO_ROOT, 'docs', 'first-win.md');

  it('the npx claim in the docs tracks .engine-pin.json — in whichever direction it points', () => {
    // This asserts the INVARIANT (the docs describe the real publish state), not a snapshot of
    // today's state. While `published:false`, the walkthroughs must say the npx path is unproven
    // and cite the pin. When the operator flips the pin on publish day, that same PR must update
    // these two pages — and this test tells it so, by name, instead of going red for a reason the
    // author has to reverse-engineer.
    const pin = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.engine-pin.json'), 'utf8')) as {
      published: boolean;
    };
    for (const doc of [MATRIX_README, FIRST_WIN_DOC]) {
      const rel = path.relative(REPO_ROOT, doc);
      const md = fs.readFileSync(doc, 'utf8');
      if (pin.published) {
        expect(
          md.includes('"published": false'),
          `.engine-pin.json now says published:true, but ${rel} still cites "published": false. ` +
            'The engine is published — update the checkout-vs-package section (and prove the npx ' +
            'path before claiming it).',
        ).toBe(false);
      } else {
        expect(md, `${rel} must cite the pin state it relies on`).toContain('"published": false');
        expect(md, `${rel} must not claim the npx path works while the engine is unpublished`).not.toMatch(
          /npx bce-engine@0\.1\.0 (?:init|works)/,
        );
      }
    }
  });

  it('the full consumer package includes the worked examples claimed by the docs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      files: string[];
    };
    expect(pkg.files).toContain('examples');
    for (const doc of [MATRIX_README, FIRST_WIN_DOC]) {
      expect(fs.readFileSync(doc, 'utf8')).toContain('includes `examples/`');
    }
  });

  it('every shape has a walkthrough, a starting tree, and a row in the matrix index', () => {
    const index = fs.readFileSync(MATRIX_README, 'utf8');
    for (const shape of SHAPES) {
      expect(fs.existsSync(path.join(MATRIX_ROOT, shape, 'README.md')), `${shape} walkthrough missing`).toBe(true);
      expect(fs.existsSync(path.join(MATRIX_ROOT, shape, 'repo')), `${shape} starting tree missing`).toBe(true);
      expect(index, `${shape} has no row in the matrix index`).toContain(`(${shape}/README.md)`);
    }
  });

  it('no fixture ships a pre-authored blueprint — every one is produced by the real author command', () => {
    // Success Criterion 3, enforced structurally: if a hand-written blueprint were committed under
    // a fixture's starting tree, the walkthrough's `bce author` step would be decorative.
    const stray: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name.endsWith('.blueprint.json')) stray.push(path.relative(REPO_ROOT, abs));
      }
    };
    walk(MATRIX_ROOT);
    expect(stray, 'these blueprints are committed, not authored — delete them and let the walkthrough author them').toEqual(
      [],
    );
  });
});
