#!/usr/bin/env node
/**
 * gen-fleet-evidence.mjs — the fleet numbers on the landing page are GENERATED, never typed.
 *
 * WHY THIS EXISTS. `scripts/gen-badges.mjs` kills one failure class for the shields: a badge is
 * a claim rendered as a fact, and the usual way it goes wrong is not that it is wrong on the day
 * it is written — it is that the tree moves and the number does not. This script applies the same
 * discipline to a harder case: numbers about a production estate that is NOT this repository.
 *
 * THE HONEST PROBLEM, STATED UP FRONT. The estate these numbers describe lives in a PRIVATE
 * repository. A public reader cannot re-derive them. That is a real weakness and it is the reason
 * this file exists rather than a paragraph of prose: the numbers are pinned to a committed record
 * (evidence/fleet/fleet-record.json) that carries its own provenance and its own limits, `--check`
 * refuses any drift between that record and the prose that cites it, and every consumer of the
 * number is forced through the record rather than retyping it. That does not make the measurement
 * independently verifiable. Nothing in this repository can make it independently verifiable. The
 * witness ledger (ATTESTATIONS.md) is the mechanism for independent confirmation, and this record
 * is deliberately NOT filed there: the authors are not witnesses to their own estate, and a ledger
 * that counted them would measure nothing.
 *
 * TWO MODES, DELIBERATELY ASYMMETRIC:
 *
 *   --refresh   Re-derives the record from the GitHub API. Requires read access to a private
 *               repository, so only the steward can run it. Writes evidence/fleet/fleet-record.json.
 *               Refuses to write a record whose merge total is LOWER than the committed one unless
 *               --allow-regression is passed: a silently shrinking count is far more likely to be a
 *               broken query than a real decline, and a broken query must not quietly rewrite a
 *               published number downward.
 *
 *   --check     Offline. Zero network. Verifies that every number cited in README.md and
 *               docs/fleet-dogfooding.md matches the committed record exactly. This is the mode CI
 *               runs, and it is the mode a public contributor can run: they cannot re-derive the
 *               measurement, but they CAN prove the page does not disagree with the record it cites.
 *               A number in the prose with no counterpart in the record is a FAILURE, not a warning —
 *               an uncited number is exactly the one that will one day be quietly false.
 *
 * A value that cannot be derived is a REFUSAL, not a default. Zero dependencies.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = join(ROOT, 'evidence/fleet/fleet-record.json');
const CITING_FILES = ['README.md', 'docs/fleet-dogfooding.md'];

const die = (msg) => { console.error(`gen-fleet-evidence: ${msg}`); process.exit(1); };
const readRecord = () => {
  if (!existsSync(RECORD)) die(`no record at evidence/fleet/fleet-record.json — run --refresh (steward only)`);
  try { return JSON.parse(readFileSync(RECORD, 'utf8')); }
  catch (e) { die(`record is not valid JSON: ${e.message}`); }
};

/* ---------- the citation contract ---------- */
/* Every number the prose is allowed to state, and where it comes from in the record.
   Adding a number to the page without adding it here makes --check fail: that is the point. */
const citations = (r) => ([
  { token: String(r.merges.total),          what: 'merges.total' },
  { token: String(r.merges.agentAuthored),  what: 'merges.agentAuthored' },
  { token: String(r.merges.humanAuthored),  what: 'merges.humanAuthored' },
  { token: `${r.merges.agentSharePct}%`,    what: 'merges.agentSharePct' },
  { token: r.gate.enginePin,                what: 'gate.enginePin' },
  { token: String(r.gate.blueprintsAuthored), what: 'gate.blueprintsAuthored' },
  { token: String(r.gate.consumerRepositories), what: 'gate.consumerRepositories' },
  { token: String(r.gatePresenceSample.checkRunPresent), what: 'gatePresenceSample.checkRunPresent' },
  { token: String(r.gatePresenceSample.sampled), what: 'gatePresenceSample.sampled' },
]);

/* ---------- --check : offline, the mode CI runs ---------- */
function check() {
  const r = readRecord();
  let fail = 0;

  // 1. The record must carry its own honesty. A record that has quietly lost its
  //    provenance or its limits is worse than no record: it reads as a plain fact.
  if (r.provenance?.independentlyVerifiable !== false)
    { console.error('FAIL record: provenance.independentlyVerifiable must be false — this measurement is self-measurement'); fail = 1; }
  if (!Array.isArray(r.honestLimits) || r.honestLimits.length === 0)
    { console.error('FAIL record: honestLimits must be non-empty'); fail = 1; }

  // 2. Internal arithmetic must hold. A total that no longer equals its parts means the
  //    refresh half-wrote, and half-written numbers are the ones that get quoted.
  const parts = r.merges.agentAuthored + r.merges.humanAuthored;
  if (parts !== r.merges.total)
    { console.error(`FAIL record: merges.total ${r.merges.total} != agent+human ${parts}`); fail = 1; }
  const share = +(r.merges.agentAuthored / r.merges.total * 100).toFixed(1);
  if (share !== r.merges.agentSharePct)
    { console.error(`FAIL record: agentSharePct ${r.merges.agentSharePct} != derived ${share}`); fail = 1; }
  const sample = r.gatePresenceSample;
  if (sample.checkRunPresent + sample.checkRunAbsent !== sample.sampled)
    { console.error('FAIL record: gatePresenceSample parts do not sum to sampled'); fail = 1; }

  // 3. An exact engine pin, never a moving tag — a moving-latest gate is non-deterministic.
  if (r.gate.pinIsExact !== true || !/^\d+\.\d+\.\d+$/.test(r.gate.enginePin))
    { console.error(`FAIL record: gate.enginePin must be an exact version, got "${r.gate.enginePin}"`); fail = 1; }

  // 4. VALUE CLOSURE, per region — not "appears somewhere".
  //    The first version of this check asked only that each record value appear in AT LEAST
  //    ONE citing file. That is trivially green for the exact drift it exists to catch: change
  //    1712 to 9999 in the README and the check still passed, because the other file still
  //    carried the true value. Caught by seeding that drift on purpose before shipping. The
  //    contract is now inverted and scoped: inside a delimited region, EVERY emphasised number
  //    must be a value the record contains. An unknown number is a failure by construction.
  const allowed = new Set(citations(r).map(c => c.token));
  const NUM = /\*\*([0-9][0-9.,]*%?)\*\*|(?<![\w.])([0-9]{2,}(?:\.[0-9]+)?%)(?![\w.])/g;
  const regions = [];
  const bodies = {};
  for (const f of CITING_FILES) {
    const fp = join(ROOT, f);
    if (!existsSync(fp)) { console.error(`FAIL missing citing file: ${f}`); fail = 1; continue; }
    const body = readFileSync(fp, 'utf8');
    bodies[f] = body;
    if (f === 'README.md') {
      const m = body.match(/<!--\s*fleet-record:begin\s*-->([\s\S]*?)<!--\s*fleet-record:end\s*-->/);
      if (!m) { console.error('FAIL README.md: fleet-record region markers missing — the estate numbers must be delimited so they can be checked'); fail = 1; }
      else regions.push([f, m[1]]);
    } else regions.push([f, body]);
  }
  for (const [f, text] of regions) {
    for (const m of text.matchAll(NUM)) {
      const tok = (m[1] || m[2]).replace(/,/g, '');
      if (!allowed.has(tok)) { console.error(`FAIL ${f}: number "${tok}" is not a value in the record — every estate number must come from evidence/fleet/fleet-record.json`); fail = 1; }
    }
  }
  //    ...and the converse: a record value nobody cites is dead weight in the contract.
  for (const { token, what } of citations(r)) {
    if (!regions.some(([, t]) => t.includes(token))) { console.error(`FAIL uncited: record ${what} = "${token}" appears in no cited region`); fail = 1; }
  }

  // 5. The page must never present this as independent confirmation.
  for (const [f, b] of Object.entries(bodies)) {
    if (/independent(ly)?\s+(verified|confirmed)/i.test(b) && !/NOT independently|cannot be independently/i.test(b))
      { console.error(`FAIL ${f}: claims independent verification`); fail = 1; }
  }

  if (fail) { console.error('\ngen-fleet-evidence --check: FAIL'); process.exit(1); }
  console.log(`gen-fleet-evidence --check: OK (${citations(r).length} cited values, record ${r.measuredAt})`);
}

/* ---------- --refresh : steward only, needs private read ---------- */
function refresh(argv) {
  const repo = process.env.FLEET_REPO;
  if (!repo) die('--refresh needs FLEET_REPO=<owner/name> (a private estate; steward only)');
  const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));
  const prev = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, 'utf8')) : null;
  const since = prev?.window?.start || die('--refresh needs an existing record to inherit window.start');
  const count = (q) => gh(['api', '-X', 'GET', 'search/issues', '-f', `q=${q}`, '--jq', '{n:.total_count}']).n;

  const base = `repo:${repo} is:pr is:merged merged:>=${since}`;
  const total = count(base);
  const agent = count(`${base} author:${process.env.FLEET_AGENT_LOGIN || ''}`) +
                count(`${base} author:${process.env.FLEET_BOT_LOGIN || ''}`);
  if (!total) die('refresh derived 0 total merges — refusing to write (a zero is a broken query, not a measurement)');
  if (prev && total < prev.merges.total && !argv.includes('--allow-regression'))
    die(`refresh derived ${total} merges, below the committed ${prev.merges.total} — refusing. Pass --allow-regression only if the decline is real.`);

  const rec = { ...prev, measuredAt: new Date().toISOString().slice(0, 10) };
  rec.merges = { total, agentAuthored: agent, humanAuthored: total - agent,
                 agentSharePct: +(agent / total * 100).toFixed(1) };
  rec.window = { ...rec.window, end: rec.measuredAt };
  writeFileSync(RECORD, JSON.stringify(rec, null, 2) + '\n');
  console.log(`gen-fleet-evidence --refresh: wrote ${total} merges (${rec.merges.agentSharePct}% agent)`);
  console.log('Now update the prose to match, then run --check.');
}

const argv = process.argv.slice(2);
if (argv.includes('--refresh')) refresh(argv);
else if (argv.includes('--check')) check();
else { console.error('usage: gen-fleet-evidence.mjs --check | --refresh'); process.exit(2); }
