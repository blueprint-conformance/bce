#!/usr/bin/env node
/**
 * Negative control for the Lane-A pin guard in .github/workflows/self-gate.yml.
 *
 * WHY THIS EXISTS
 * ---------------
 * Lane A is the trust anchor: it installs the EXACT published engine from the public registry so
 * a defective engine change in a PR under review cannot influence the verdict. The guard decides
 * dormant-vs-live. Before the change this control was written for, a `published:true` claim whose
 * pin did NOT resolve emitted a `::warning::` and left `live=false` — which `if:`-skips the Lane-A
 * step and leaves the JOB GREEN. The trust anchor reported success having graded nothing.
 *
 * That is live-reachable: docs/pin-ceremony.md flips `published:true` in the same PR that first
 * publishes 0.1.0. If the publish leg fails, the flip still lands.
 *
 * CONSTRUCTION RULES (each learned by getting it wrong first)
 * ----------------------------------------------------------
 *  - EXECUTE THE SHIPPED TEXT, never a copy. The guard body is extracted from self-gate.yml and
 *    run verbatim. A second copy of the logic in this file would drift from the workflow, and
 *    drift is precisely the class this control exists to catch.
 *  - BASELINE FIRST, AND LET IT REFUSE. If extraction yields nothing, every case would "pass"
 *    trivially by running an empty script. The baseline asserts the block is non-empty and
 *    contains its own marker before any case is trusted.
 *  - BOTH DIRECTIONS. An under-fire control (the bug: claims published, is absent -> must be RED)
 *    and an over-fire control (dormant while the pin happens to resolve -> must stay GREEN).
 *    A guard that reddens everything is not a guard.
 *  - REAL REGISTRY, NOT A MOCK. bce-engine@0.0.0 is published (the reserved stub) and @0.1.0 is
 *    not, so the resolvable/unresolvable controls are real npm answers, not fixtures we invented.
 *
 * Usage:
 *   node scripts/lane-a-pin-guard-selftest.mjs                 # against the working tree
 *   node scripts/lane-a-pin-guard-selftest.mjs --against <yml> # against another revision's file
 *
 * Exit 0 = every case behaved. Exit 1 = a case did not (or the baseline refused).
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STEP_NAME = 'Resolve the Lane-A pin and decide dormant vs live';
const MARKER = '.engine-pin.json';

const argAgainst = process.argv.indexOf('--against');
const YML = argAgainst !== -1 ? process.argv[argAgainst + 1] : '.github/workflows/self-gate.yml';

/** Pull the named step's `run:` block out of the workflow, dedented. No YAML lib: the shape is fixed. */
function extractRunBlock(ymlPath, stepName) {
  const lines = readFileSync(ymlPath, 'utf8').split('\n');
  const nameIdx = lines.findIndex((l) => l.includes(`name: ${stepName}`));
  if (nameIdx === -1) return null;

  let runIdx = -1;
  for (let i = nameIdx; i < Math.min(nameIdx + 12, lines.length); i++) {
    if (/^\s*run:\s*\|/.test(lines[i])) { runIdx = i; break; }
  }
  if (runIdx === -1) return null;

  const bodyIndent = (lines[runIdx + 1] ?? '').match(/^(\s*)/)[1].length;
  if (bodyIndent === 0) return null;

  const body = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') { body.push(''); continue; }
    const ind = l.match(/^(\s*)/)[1].length;
    if (ind < bodyIndent) break;
    body.push(l.slice(bodyIndent));
  }
  return body.join('\n').replace(/\s+$/, '') + '\n';
}

/** Run the guard under a fabricated .engine-pin.json. Returns {code, out, live}. */
function runCase({ pkg, pin, published, range = false }, script) {
  const dir = mkdtempSync(join(tmpdir(), 'lane-a-guard-'));
  writeFileSync(
    join(dir, '.engine-pin.json'),
    JSON.stringify({ package: pkg, pin, published, range }, null, 2),
  );
  const outFile = join(dir, 'gh-output');
  writeFileSync(outFile, '');
  const scriptFile = join(dir, 'guard.sh');
  writeFileSync(scriptFile, script);

  const r = spawnSync('bash', [scriptFile], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_OUTPUT: outFile },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const live = (readFileSync(outFile, 'utf8').match(/^live=(\S+)$/m) ?? [])[1] ?? '(unset)';
  return { code: r.status, out, live };
}

const script = extractRunBlock(YML, STEP_NAME);

// ---- BASELINE: refuse to report on anything if the extraction did not work. -------------------
if (!script || !script.includes(MARKER)) {
  console.error(
    `baseline REFUSED: could not extract the '${STEP_NAME}' run block from ${YML} ` +
      `(got ${script ? `${script.length} bytes without the '${MARKER}' marker` : 'nothing'}). ` +
      `Every case below would have passed against an empty script — that is why this refuses.`,
  );
  process.exit(1);
}
console.log(`baseline: extracted ${script.split('\n').length} lines of the shipped guard from ${YML}\n`);

// bce-engine@0.0.0 IS published (reserved stub); @0.1.0 is NOT. Real registry answers.
const RESOLVABLE = '0.0.0';
const ABSENT = '0.1.0';

const CASES = [
  {
    label: 'dormant, pin absent    (published:false + unresolvable) -> GREEN, live=false',
    fixture: { pkg: 'bce-engine', pin: ABSENT, published: false },
    want: { code: 0, live: 'false' },
    why: 'the honest bootstrap-0 exception — must stay green',
  },
  {
    label: 'dormant, pin present   (published:false + resolvable)   -> GREEN, live=false',
    fixture: { pkg: 'bce-engine', pin: RESOLVABLE, published: false },
    want: { code: 0, live: 'false' },
    why: 'OVER-FIRE control: not-yet-flipped is legitimate, must not redden',
  },
  {
    label: 'live                   (published:true  + resolvable)   -> GREEN, live=true',
    fixture: { pkg: 'bce-engine', pin: RESOLVABLE, published: true },
    want: { code: 0, live: 'true' },
    why: 'the working path must still arm Lane A',
  },
  {
    label: 'FALSE CLAIM            (published:true  + unresolvable) -> RED, exit 1',
    fixture: { pkg: 'bce-engine', pin: ABSENT, published: true },
    want: { code: 1 },
    why: 'THE BUG: previously warned and left the trust anchor green having graded nothing',
  },
];

let failures = 0;
for (const c of CASES) {
  const got = runCase(c.fixture, script);
  const codeOk = got.code === c.want.code;
  const liveOk = c.want.live === undefined || got.live === c.want.live;
  const ok = codeOk && liveOk;
  if (!ok) failures++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${c.label}`);
  console.log(`         ${c.why}`);
  console.log(`         got exit=${got.code} live=${got.live}; want exit=${c.want.code}${c.want.live !== undefined ? ` live=${c.want.live}` : ''}`);
  const signal = got.out.split('\n').find((l) => l.includes('::error::') || l.includes('::warning::'));
  if (signal) console.log(`         ${signal.trim().slice(0, 200)}`);
  console.log();
}

if (failures) {
  console.error(`lane-a-pin-guard-selftest: FAIL — ${failures} of ${CASES.length} case(s) did not behave.`);
  process.exit(1);
}
console.log(`lane-a-pin-guard-selftest: PASS — ${CASES.length}/${CASES.length}; the guard fails closed on a false published claim and does not over-fire while dormant.`);
