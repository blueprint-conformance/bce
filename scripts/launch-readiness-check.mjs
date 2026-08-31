#!/usr/bin/env node
/**
 * launch-readiness-check.mjs — the promises that must be true the moment this
 * repository becomes public, enforced instead of remembered.
 *
 * Several launch steps are "do this before/with the flip": clear the citation
 * placeholders, replace the README's placeholder links, activate the badge block,
 * flip the engine pin once 0.1.0 is published. Today every one of them depends on
 * a human remembering, at the busiest moment of the whole ceremony, in the right
 * order. Nothing detects a miss.
 *
 * The cost of forgetting is asymmetric. A private repo with placeholder links is
 * a TODO. A PUBLIC repo whose README still says "_placeholder — added at release_"
 * is the first thing a launch-post reader sees, on the page that is supposed to
 * demonstrate rigour. And the R2 case is worse than embarrassing: public while npm
 * still serves the 0.0.0 stub means every visitor's first command silently
 * installs something that is not the engine.
 *
 * So this gate is INERT while the repository is private -- it reports each promise
 * as PENDING and exits 0, because none of them are due yet -- and grows teeth the
 * instant the repository is public. Nothing to remember, nothing to schedule.
 *
 * Visibility comes from the caller (the workflow passes GitHub's own value).
 * LAUNCH_READINESS_FORCE_PUBLIC=1 forces the public branch so the gate's teeth can
 * be PROVEN while the repository is still private -- a gate that cannot go red is
 * not a gate, and this one would otherwise sit green for months and never once
 * demonstrate it can refuse.
 *
 * Exit codes:
 *   0 — private (inert), or public and every promise kept.
 *   1 — public (or forced) and at least one promise broken.
 *   2 — harness failure (a file this gate reasons about is missing).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => {
  const p = path.join(repoRoot, rel);
  if (!existsSync(p)) {
    console.error(`launch-readiness: FAIL(harness) — ${rel} is missing; this gate reasons about it.`);
    process.exit(2);
  }
  return readFileSync(p, 'utf8');
};

const forced = process.env.LAUNCH_READINESS_FORCE_PUBLIC === '1';
const isPublic = forced || process.env.REPO_IS_PRIVATE === 'false';

/** @type {{id:string, ready:boolean, detail:string, remedy:string}[]} */
const promises = [];
const promise = (id, ready, detail, remedy) => promises.push({ id, ready, detail, remedy });

// ---------------------------------------------------------------------------
// R2 — the one that is not merely embarrassing.
// bce-engine@0.1.0 must be live on npm BEFORE this repository is public, or the
// quickstart's first command installs the 0.0.0 reservation stub instead of the
// engine. The pin file records the operator's own flip; npm is the ground truth.
// ---------------------------------------------------------------------------
const pin = JSON.parse(read('.engine-pin.json'));
promise(
  'R2/engine-pin',
  pin.published === true,
  `.engine-pin.json published=${pin.published} (pin ${pin.package}@${pin.pin})`,
  'flip published:true in the same PR that first publishes 0.1.0 (docs/pin-ceremony.md)'
);

let npmVersion = '(not checked)';
let npmOk = false;
try {
  npmVersion = execFileSync('npm', ['view', `${pin.package}@${pin.pin}`, 'version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  npmOk = npmVersion === pin.pin;
} catch {
  npmVersion = 'not published';
  npmOk = false;
}
promise(
  'R2/npm-live',
  npmOk,
  `npm serves ${pin.package}@${pin.pin} -> ${npmVersion || 'not published'}`,
  'publish 0.1.0 BEFORE flipping the repository public — otherwise the quickstart installs the 0.0.0 stub'
);

// ---------------------------------------------------------------------------
// Citation metadata — release.yml's own gate refuses a tag while these remain,
// so a public repo carrying them means the flip ran ahead of the tag.
// ---------------------------------------------------------------------------
const cff = read('CITATION.cff');
// Both the ORIGINAL placeholder spellings and the ship-blocker token family.
// Without the second term this promise reported READY on a CITATION.cff that
// still carried an unreplaced ship-blocker token — a detector that only knows
// the spelling it was born with goes quiet the moment the placeholder is
// renamed, which is the silent-pass this whole gate exists to prevent.
//
// The marker is ASSEMBLED, never written literally: check-ship-blockers.mjs
// scans every tracked file, so spelling it here would make this detector flag
// ITSELF. Exempting the file was the alternative and it is worse — an exemption
// is a hole big enough to hide a real placeholder in.
const SHIP_MARKER = ['_DO', 'NOT', 'SHIP'].join('_');
const cffLeft = ['ARXIV-ID-PENDING', 'DOI-PENDING'].filter((t) => cff.includes(t))
  .concat(cff.includes(SHIP_MARKER) ? [`a *${SHIP_MARKER} ship-blocker token`] : []);
promise(
  'citation/placeholders',
  cffLeft.length === 0,
  cffLeft.length ? `CITATION.cff still carries: ${cffLeft.join(', ')}` : 'CITATION.cff carries real identifiers',
  'replace with the real arXiv id and Zenodo DOI (release.yml refuses the tag until then)'
);

// ---------------------------------------------------------------------------
// README — the page a launch-post reader lands on.
// ---------------------------------------------------------------------------
const readme = read('README.md');
// `_placeholder` (the original marker) OR a ship-blocker token — see the
// CITATION note above for why one spelling is not enough.
const phLines = readme.split('\n').map((l, i) => [i + 1, l])
  .filter(([, l]) => /_placeholder/.test(l) || l.includes(SHIP_MARKER));
promise(
  'readme/placeholder-links',
  phLines.length === 0,
  phLines.length ? `README.md has ${phLines.length} placeholder link(s) at line(s) ${phLines.map(([n]) => n).join(', ')}` : 'README.md has no placeholder links',
  'replace the paper / artifacts / spec links once the DOI and arXiv id exist'
);
promise(
  'readme/badge-block',
  !readme.includes('badge-placeholder'),
  readme.includes('badge-placeholder') ? 'README.md still carries the badge-placeholder markers' : 'badge block is active',
  'remove the badge-placeholder comment markers at the public flip'
);

// The reserved award chips. These are the opposite promise to the badge block above: that one
// is BROKEN until its markers are REMOVED at the flip, this one is broken the moment a chip
// LEAVES its comment. An award chip is the cheapest thing on a launch page to fake and the
// hardest for a reader to check, so activation has to be a deliberate act — a PR that links
// the award — and never something that rides along inside an unrelated change.
//
// Comments are stripped first and the remainder is searched, so the reserved markup inside the
// comment is inert by construction and only an ACTIVATED chip can trip this.
const readmeUncommented = readme.replace(/<!--[\s\S]*?-->/g, '');
const liveAwardSlots = readmeUncommented.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /award-slot|assets\/badges\/award-/.test(l));
promise(
  'readme/award-slots',
  liveAwardSlots.length === 0,
  liveAwardSlots.length
    ? `README.md has ${liveAwardSlots.length} ACTIVATED award chip(s) at line(s) ${liveAwardSlots.map(([n]) => n).join(', ')} — each must name a real, won award`
    : 'award chips are reserved and inert',
  'activate a chip only in a PR that links the award it claims; otherwise leave it inside the award-slot comment'
);

// The status line. Self-refuting on a public page — a reader is being told the
// repository is private on the page they are reading publicly. The sibling
// artifacts repository carries the same shape at its README line 11; this one was
// missed when that was gated.
const statusPrivate = readme.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /Status:?\s*(pre-release|private)/i.test(l) || /This repository is private/i.test(l));
promise(
  'readme/status-line',
  statusPrivate.length === 0,
  statusPrivate.length
    ? `README.md still declares itself private/pre-release at line ${statusPrivate.map(([n]) => n).join(', ')}`
    : 'README status line does not claim to be private',
  'reword the Status line at the flip — a public page cannot tell its reader it is private'
);

// The npm-stub instruction. Today it correctly warns that npm serves the 0.0.0
// reservation and tells the reader to use the `local` engine source instead. Once
// 0.1.0 is published that is not merely stale -- it actively instructs every
// visitor to AVOID the published package, which is the exact outcome R2 exists to
// prevent, arriving by documentation rather than by a missing publish.
const npmStubLines = readme.split('\n')
  .map((l, i) => [i + 1, l])
  .filter(([, l]) => /npm serves a `?0\.0\.0`? placeholder/i.test(l));
promise(
  'readme/npm-stub-instruction',
  npmStubLines.length === 0,
  npmStubLines.length
    ? `README.md still tells readers npm serves a 0.0.0 placeholder and to prefer the local engine, at line ${npmStubLines.map(([n]) => n).join(', ')}`
    : 'README does not carry the pre-publish npm-stub instruction',
  'reword once 0.1.0 is on npm — otherwise the page tells visitors to avoid the package you just published'
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Contributor-facing docs. These are the files a NEW ARRIVAL opens first, and
// both currently say the project is not open yet.
//
// CONTRIBUTING.md: "pre-release, private phase; external contributions open with
// the initial public release." On a public repository that turns the first
// would-be contributor away at the door — the exact people a launch post brings.
//
// SECURITY.md: "This policy will be expanded before the initial public release."
// Stale promises are worst in the security policy, because it is the document a
// researcher reads while deciding whether to disclose responsibly rather than
// publicly. An unkept "before release" promise on an already-released project is
// a reason to doubt the rest of it.
//
// Scanned as one promise over both files so a third contributor-facing doc can
// join without a new branch of logic.
// ---------------------------------------------------------------------------
const CONTRIB_DOCS = ['CONTRIBUTING.md', 'SECURITY.md'];
const PRERELEASE_CLAIM = /(pre-release,?\s*private phase|contributions open with the initial public release|before the initial public release|this repository is (in a )?(pre-release|private))/i;
const contribHits = [];
for (const rel of CONTRIB_DOCS) {
  const p = path.join(repoRoot, rel);
  if (!existsSync(p)) continue;   // absent is not this gate's business
  readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
    if (PRERELEASE_CLAIM.test(l)) contribHits.push(`${rel}:${i + 1}`);
  });
}
promise(
  'contributor-docs/pre-release',
  contribHits.length === 0,
  contribHits.length
    ? `contributor docs still describe a pre-release/private phase at ${contribHits.join(', ')}`
    : 'contributor docs do not claim the project is unreleased',
  'reword at the flip — these are the first files a new arrival opens, and they currently say the project is not open yet'
);

// CORPUS-MAP calls the artifacts repository "private". That stops being true the
// moment the artifacts repo is flipped, and a referee follows this reference.
// ---------------------------------------------------------------------------
const corpusMap = read('corpus/CORPUS-MAP.md');
promise(
  'corpus-map/private-wording',
  !/private\s+`?bce-paper-artifacts/i.test(corpusMap),
  /private\s+`?bce-paper-artifacts/i.test(corpusMap)
    ? 'corpus/CORPUS-MAP.md still describes bce-paper-artifacts as private'
    : 'CORPUS-MAP describes the artifacts repository accurately',
  'reword once the artifacts repository is public'
);

// ---------------------------------------------------------------------------
const broken = promises.filter((p) => !p.ready);
const label = forced ? 'PUBLIC (forced — self-test)' : isPublic ? 'PUBLIC' : 'private';
console.log(`launch-readiness: repository is ${label}\n`);
for (const p of promises) {
  const mark = p.ready ? 'READY  ' : isPublic ? 'BROKEN ' : 'pending';
  console.log(`  ${mark} ${p.id.padEnd(26)} ${p.detail}`);
}

if (!isPublic) {
  console.log(`\nlaunch-readiness: INERT — the repository is private, so none of these are due yet.`);
  console.log(`${broken.length} promise(s) still outstanding; they become blocking at the public flip.`);
  process.exit(0);
}

if (broken.length === 0) {
  console.log(`\nlaunch-readiness: PASS — the repository is public and every launch promise is kept.`);
  process.exit(0);
}

console.error(`\n::error::launch-readiness: FAIL — the repository is PUBLIC with ${broken.length} broken promise(s).`);
for (const p of broken) {
  console.error(`  - ${p.id}: ${p.detail}`);
  console.error(`      remedy: ${p.remedy}`);
}
console.error('\nThese are visible to every visitor right now. Fix forward — do not un-flip.');
process.exit(1);
