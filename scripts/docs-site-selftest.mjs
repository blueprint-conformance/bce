#!/usr/bin/env node
/**
 * docs-site-selftest.mjs — prove the site build can REFUSE before trusting its pass.
 *
 * `scripts/build-docs-site.mjs` guards things nobody watches directly: that every
 * publishable doc has a route (IA completeness), that every internal link resolves
 * to a route the build produces, that every fragment resolves to a heading the
 * target page carries, and that source it cannot honestly render is refused rather
 * than published as visibly-wrong literal text. Every one of those is the kind of
 * check that keeps printing PASS long after a typo has made it unmatchable — the
 * output is identical either way.
 *
 * So each check is planted against, individually, and required to fail NAMING
 * its own class. An unexercised check is one nobody has watched fail. Probes are
 * planted in a COPY of the tree, never in the working tree, so a crash cannot
 * leave a planted defect behind for someone else to find.
 *
 * Zero dependencies, same discipline as scripts/witness-kit-selftest.mjs.
 *
 * Exit codes:
 *   0 — every check refused its probe, and the clean tree still passes.
 *   1 — a check did not refuse its probe (or the clean tree does not pass).
 *   2 — harness failure (cannot stage the tree, cannot run the build).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The WHOLE tree is staged, minus build output and history. The build resolves
// every documentation link against the real tree — a doc may legitimately link
// to `src/`, `corpus/`, `action.yml` or a workflow file — so a partial stage
// would make the clean tree fail for reasons that have nothing to do with the
// probe, and every refusal below would then be a false pass.
const SKIP = new Set(['.git', 'node_modules', 'dist', '_site', 'coverage', '.nyc_output']);

function harness(msg) {
  console.error(`docs-site-selftest: ${msg}`);
  process.exit(2);
}

function stage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bce-docs-site-'));
  fs.cpSync(repoRoot, dir, {
    recursive: true,
    // Other parallel tests briefly create repo-local .tmp-* harness roots. They
    // are not part of the committed tree and may disappear during cpSync.
    filter: (src) => {
      const basename = path.basename(src);
      return !SKIP.has(basename) && !basename.startsWith('.tmp-');
    },
  });
  if (!fs.existsSync(path.join(dir, 'scripts/build-docs-site.mjs'))) {
    harness('staged tree is missing scripts/build-docs-site.mjs');
  }
  return dir;
}

function runBuild(dir) {
  const r = spawnSync(process.execPath, ['scripts/build-docs-site.mjs', '--quiet'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (r.error) harness(`could not run the build: ${r.error.message}`);
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/**
 * Each probe: a defect to plant, the exit code the build MUST return, and a
 * phrase the refusal MUST contain. The phrase is asserted so a probe cannot
 * pass by tripping some unrelated check — a dangling-link probe that reddened
 * the IA check would be a false pass.
 *
 * `exit` follows the build's contract: 1 = the site assembled and is wrong,
 * 2 = the build could not honestly render the source at all.
 *
 * A probe may also carry `verify(dir)` — an assertion on the BUILT output of
 * a probe that must succeed (exit 0). It returns null, or the failure reason.
 * This is how a derivation is proven live: a check that only ran green could
 * be a hardcoded string wearing a derivation's comment.
 */
const PROBES = [
  {
    name: 'dangling internal link',
    plant: (dir) => {
      const f = path.join(dir, 'docs/faq.md');
      fs.appendFileSync(f, '\n\nSee [the planted page](./planted-no-such-page.md).\n');
    },
    expect: 'link target does not exist in the tree',
  },
  {
    name: 'dangling heading fragment',
    plant: (dir) => {
      const f = path.join(dir, 'docs/faq.md');
      fs.appendFileSync(f, '\n\nSee [the planted anchor](../spec/SPEC.md#planted-no-such-heading).\n');
    },
    expect: 'which /spec does not carry',
  },
  {
    name: 'IA drift — a new doc with no route',
    plant: (dir) => {
      fs.writeFileSync(path.join(dir, 'docs/planted-unmapped-guide.md'), '# A planted guide\n\nBody.\n');
    },
    expect: 'IA drift',
  },
  {
    name: 'UNPUBLISHED naming a file that no longer exists',
    plant: (dir) => {
      fs.rmSync(path.join(dir, 'docs/launch/week-1-triage.md'));
    },
    expect: 'no longer exists',
  },
  // The two constructs below would otherwise be published as escaped literal
  // text — visibly wrong on the page, but a green build. They are refused at
  // exit 2 (the source cannot be honestly rendered), not exit 1.
  {
    name: 'raw HTML block',
    plant: (dir) => {
      fs.appendFileSync(path.join(dir, 'docs/faq.md'), '\n\n<div class="planted">Raw block.</div>\n');
    },
    exit: 2,
    expect: 'raw HTML block is not rendered',
  },
  {
    name: 'reference-style link definition',
    plant: (dir) => {
      fs.appendFileSync(path.join(dir, 'docs/faq.md'), '\n\nSee [the planted ref][planted].\n\n[planted]: https://example.invalid/planted\n');
    },
    exit: 2,
    expect: 'reference-style link definition is not rendered',
  },
  {
    // POSITIVE polarity: this probe asserts the build does NOT refuse. An
    // inline [text](https://...) link is external and must pass through
    // verbatim — before the scheme guard (2026-08-27) it was path-joined onto
    // the source directory and refused as a missing file. exit 0 IS the
    // assertion: a regressed guard exits 1 naming the joined path, which fails
    // this probe on the code mismatch and prints that reason.
    name: 'inline external link (must NOT refuse)',
    plant: (dir) => {
      fs.appendFileSync(path.join(dir, 'docs/faq.md'), '\n\nEvidence: [external source](https://example.invalid/planted-external-link).\n');
    },
    exit: 0,
    expect: '',
  },
  // The trust page's two state claims are tethered to the records they
  // describe, not restated beside them. Three probes prove the tether has
  // teeth in both directions: the count moves WITH the ledger, an unreadable
  // ledger is refused rather than guessed at, and a citation record that has
  // gains a provisional identifier and turns the build red instead of publishing it.
  {
    name: 'trust page derives the witness count from the ledger',
    plant: (dir) => {
      const f = path.join(dir, 'ATTESTATIONS.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\*\*Count: \d+\.\*\*/, '**Count: 3.**'));
    },
    exit: 0,
    expect: '',
    verify: (dir) => {
      const page = fs.readFileSync(path.join(dir, '_site/trust/index.html'), 'utf8');
      return page.includes('Independent witnesses: 3.')
        ? null
        : 'the staged ledger says Count: 3 but the built /trust page does not say ' +
          '"Independent witnesses: 3." — the count is a second hand-written copy, not a derivation';
    },
  },
  {
    name: 'trust page refuses an unreadable ledger headline',
    plant: (dir) => {
      const f = path.join(dir, 'ATTESTATIONS.md');
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\*\*Count: \d+\.\*\*/, '**Count: several.**'));
    },
    exit: 2,
    expect: 'derives its witness count',
  },
  {
    name: 'trust page refuses provisional citation identifiers',
    plant: (dir) => {
      const f = path.join(dir, 'CITATION.cff');
      fs.appendFileSync(f, '\n# planted provisional metadata: DOI-PENDING\n');
    },
    expect: 'pending DOI placeholder',
  },
  {
    // A literal NUL byte anywhere in the build script makes grep classify it
    // as binary, and the banned-phrase gate's `--binary-files=without-match`
    // sweep then silently skips every visitor-facing phrase the script
    // carries. The build refuses to run in that state; this probe proves it.
    name: 'literal NUL byte in the build script itself',
    plant: (dir) => {
      fs.appendFileSync(path.join(dir, 'scripts/build-docs-site.mjs'), '\n// planted: \u0000\n');
    },
    exit: 2,
    expect: 'literal NUL byte',
  },

  // -------------------------------------------------------------------------
  // The centred hero block — the one raw-HTML construct the renderer accepts.
  //
  // It is recognised AHEAD of the raw-HTML refusal, which makes it the most
  // dangerous code in this file: a shape it matches but mis-handles would be
  // rendered wrong (or silently dropped) instead of refused, with the refusal
  // that used to cover it now unreachable. So the whole surface is probed —
  // both what it must accept and every way it must refuse — and the `raw HTML
  // block` probe above still asserts the general refusal survived.
  // -------------------------------------------------------------------------
  {
    // POSITIVE polarity: the construct the README's hero actually uses.
    name: 'centered hero block with an img (must NOT refuse)',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/bce-banner.svg" alt="A planted banner with alt text">\n</p>\n',
      );
    },
    exit: 0,
    expect: '',
  },
  {
    // POSITIVE polarity: an <a> wrapping an <img> — how a shield links to what
    // it reports.
    name: 'centered hero block with a linked img (must NOT refuse)',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<div align="center">\n  <a href="../LICENSE"><img src="../assets/badges/license.svg" alt="license: Apache-2.0"></a>\n</div>\n',
      );
    },
    exit: 0,
    expect: '',
  },
  {
    // POSITIVE polarity: GitHub-safe responsive art with a required accessible fallback.
    name: 'centered responsive picture (must NOT refuse)',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <picture>\n    <source media="(max-width: 600px)" srcset="../assets/bce-banner-mobile.svg">\n    <img src="../assets/bce-banner.svg" alt="A responsive planted banner">\n  </picture>\n</p>\n',
      );
    },
    exit: 0,
    expect: '',
  },
  {
    name: 'responsive picture without fallback alt text',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <picture>\n    <source media="(max-width: 600px)" srcset="../assets/bce-banner-mobile.svg">\n    <img src="../assets/bce-banner.svg">\n  </picture>\n</p>\n',
      );
    },
    exit: 2,
    expect: 'has no alt text',
  },
  {
    name: 'hero img with no alt text',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/bce-banner.svg">\n</p>\n',
      );
    },
    exit: 2,
    expect: 'has no alt text',
  },
  {
    name: 'hero block containing something other than an image',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <strong>planted prose in a hero block</strong>\n</p>\n',
      );
    },
    exit: 2,
    expect: 'may contain only',
  },
  {
    // The whitelist is what keeps an event handler off the page: `onerror` is
    // not in IMG_ATTRS, so it is refused rather than copied through.
    name: 'hero img carrying an attribute outside the whitelist',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/bce-banner.svg" alt="planted" onerror="planted()">\n</p>\n',
      );
    },
    exit: 2,
    expect: 'is not an attribute this renderer emits',
  },
  {
    name: 'hero block closed with the wrong tag',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/bce-banner.svg" alt="planted">\n</div>\n',
      );
    },
    exit: 2,
    expect: 'closed with',
  },
  {
    name: 'hero block never closed',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/bce-banner.svg" alt="planted">\n',
      );
    },
    exit: 2,
    expect: 'is never closed',
  },
  {
    // The site must publish the bytes it links to. A referenced asset that is
    // NOT copied leaves the landing page's hero as a broken image while the
    // build stays green — so the link check has to see it as site-local.
    name: 'referenced asset missing from the tree',
    plant: (dir) => {
      fs.appendFileSync(
        path.join(dir, 'docs/faq.md'),
        '\n\n<p align="center">\n  <img src="../assets/planted-no-such-asset.svg" alt="planted">\n</p>\n',
      );
    },
    expect: 'link target does not exist in the tree',
  },
];

function main() {
  let failures = 0;

  // The clean tree must pass first. A staged tree that cannot build makes every
  // planted-probe refusal meaningless — it would refuse for the wrong reason.
  const clean = stage();
  try {
    const base = runBuild(clean);
    if (base.code !== 0) {
      console.error('docs-site-selftest: FAIL — the CLEAN staged tree does not build.');
      console.error(base.out);
      process.exit(1);
    }
    console.log('docs-site-selftest: clean tree builds (exit 0) — probes are meaningful.');
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
  }

  for (const probe of PROBES) {
    const dir = stage();
    try {
      probe.plant(dir);
      const wanted = probe.exit ?? 1;
      const { code, out } = runBuild(dir);
      if (code !== wanted) {
        console.error(`  FAIL  ${probe.name} — build exited ${code}, expected ${wanted}.`);
        console.error(out.split('\n').slice(0, 20).join('\n'));
        failures += 1;
      } else if (!out.includes(probe.expect)) {
        console.error(`  FAIL  ${probe.name} — refused, but not for its own reason.`);
        console.error(`        expected the refusal to mention: ${probe.expect}`);
        console.error(out.split('\n').slice(0, 20).join('\n'));
        failures += 1;
      } else {
        const reason = probe.verify ? probe.verify(dir) : null;
        if (reason) {
          console.error(`  FAIL  ${probe.name} — ${reason}`);
          failures += 1;
        } else {
          const verb = wanted === 0 ? 'built clean' : 'refused';
          console.log(`  PASS  ${probe.name} — ${verb} (exit ${wanted})${wanted === 0 ? '' : ', naming its own class'}.`);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  if (failures > 0) {
    console.error('');
    console.error(`docs-site-selftest: FAIL — ${failures} check(s) did not refuse their probe.`);
    console.error('A check that cannot go red cannot vouch for a green one.');
    process.exit(1);
  }
  console.log(`docs-site-selftest: PASS — all ${PROBES.length} checks refuse their own probe.`);
}

if (process.argv.includes('--print-probe-count')) {
  console.log(PROBES.length);
} else {
  main();
}
