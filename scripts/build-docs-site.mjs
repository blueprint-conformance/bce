#!/usr/bin/env node
/**
 * build-docs-site.mjs — ZERO-dependency static site builder for the spec pack.
 *
 * Assembles `_site/`: the published JSON Schemas (byte-for-byte, at the exact
 * paths their `$id` values name) plus a rendered documentation site around
 * them — specification, guides, agent material, RFCs.
 *
 * This is the SAME payload `.github/workflows/publish-schemas.yml` deploys.
 * That workflow's deploy job was hard-disabled until the public flip and is now active; this
 * script only ever writes a local directory, so it is safe to run — and to
 * gate in CI — long before anything is published. Running it proves the site
 * still assembles; it does not publish, and cannot.
 *
 * WHY A HAND-ROLLED RENDERER, NOT A MARKDOWN LIBRARY
 * --------------------------------------------------
 * The markdown surface here is bounded and MEASURED, not guessed: across the
 * 20 published sources it is ATX headings, fenced code, GFM pipe tables,
 * ordered/unordered lists nested at most two deep, blockquotes, thematic
 * breaks, HTML comments, and inline links / code spans / emphasis. There are
 * no setext headings, no raw HTML blocks, no footnotes, no reference links.
 *
 * A general parser would render every one of those constructs AND silently
 * render whatever else appeared later — including a construct nobody checked.
 * A renderer that handles exactly the measured surface and REFUSES anything
 * else turns "a doc grew a construct we do not render" into a red build
 * instead of a subtly wrong page. That is the same fail-closed trade this
 * project makes everywhere else, and it costs zero dependencies at exactly
 * the moment the project's own pitch is supply-chain discipline.
 *
 * WHAT IS CHECKED (all fail-closed; there is no skip flag)
 * -------------------------------------------------------
 *   1. IA completeness — every publishable source doc is in the page map, or
 *      is explicitly listed as unpublished WITH a reason. A new docs/*.md
 *      added later without a map entry fails the build rather than shipping
 *      un-navigable once live.
 *   2. Every source named by the map exists.
 *   3. Schemas are copied byte-identically, and the copied set equals the
 *      tree's set — the `$id` URLs keep resolving to the same bytes.
 *   4. Internal links resolve — every generated href pointing at a site-local
 *      route resolves to a route this build actually produced, and every
 *      fragment resolves to a heading anchor that page actually carries.
 *      Zero network calls: external links are recorded, never fetched.
 *   5. Unrenderable source is refused, not published (exit 2). A setext
 *      heading, a raw HTML block, a reference-style link definition, or an
 *      unterminated fence would each be published as something visibly wrong
 *      while the build stayed green. Each is named and refused instead. Every
 *      one of these refusals is exercised by scripts/docs-site-selftest.mjs.
 *   6. This script itself stays grep-scannable text — no literal NUL byte.
 *      It carries visitor-facing prose (the generated trust page, the section
 *      blurbs, the paper placeholder), and a single literal NUL would make
 *      grep classify the file as binary, silently exempting that prose from
 *      the banned-phrase gate's sweep (`--binary-files=without-match`).
 *   7. The trust page's two state claims stay tethered to their records: the
 *      witness count is read from ATTESTATIONS.md's own headline, and the
 *      "pending, and ship-blocked" citation claim is asserted against
 *      CITATION.cff's actual placeholder tokens.
 *
 * Usage:
 *   node scripts/build-docs-site.mjs [--out <dir>] [--quiet]
 *
 * Exit codes: 0 = site assembled and every check passed; 1 = a check failed
 * (IA drift, dangling internal link, schema mismatch); 2 = harness failure
 * (missing source, unrenderable construct, bad usage).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SITE_NAME = 'bce';
const SITE_TAGLINE = 'the blueprint conformance engine';
const REPO_BLOB = 'https://github.com/blueprint-conformance/bce/blob/main/';
const REPO_TREE = 'https://github.com/blueprint-conformance/bce/tree/main/';

// ---------------------------------------------------------------------------
// The information architecture. Source file -> site route, in one place.
//
// `route` is the site path; the page is written to `<route>/index.html` (or
// `index.html` at the root). `nav` marks the entries that appear in the top
// navigation, in this order.
//
// Titles come from each source's own H1, so a retitled doc retitles its page.
// One entry below carries an explicit `title`, and says why: it is a navigation
// label for a document whose H1 is the project's name rather than its own. The
// page body is never rewritten — only what the nav and the card call it.
// ---------------------------------------------------------------------------
const PAGES = [
  { route: '', kind: 'landing', source: 'README.md', nav: 'Home', section: null },

  { route: 'guides/quickstart', source: 'docs/quickstart.md', nav: 'Quickstart', section: 'Guides' },
  { route: 'guides/first-win', source: 'docs/first-win.md', section: 'Guides' },

  { route: 'spec', source: 'spec/SPEC.md', nav: 'Specification', section: 'Specification' },
  { route: 'spec/conformance-vectors', source: 'spec/conformance-vectors/README.md', section: 'Specification' },
  { route: 'schemas', kind: 'schemas-index', section: 'Specification' },

  { route: 'guides', kind: 'section-index', section: 'Guides', nav: 'Guides' },
  { route: 'guides/adopt-existing-repo', source: 'docs/adopt-existing-repo.md', section: 'Guides' },
  { route: 'guides/agent-loop', source: 'docs/agent-loop.md', section: 'Guides' },
  { route: 'guides/self-hosting', source: 'docs/self-hosting.md', section: 'Guides' },
  { route: 'guides/agent-estate', source: 'docs/fleet-dogfooding.md', section: 'Guides' },
  { route: 'guides/exit-codes', source: 'docs/exit-codes.md', section: 'Guides' },
  { route: 'guides/report-contract', source: 'docs/report-contract.md', section: 'Guides' },
  { route: 'guides/evidence-format', source: 'docs/evidence-format.md', section: 'Guides' },
  { route: 'guides/extending-extractors', source: 'docs/extending-extractors.md', section: 'Guides' },
  { route: 'guides/pin-ceremony', source: 'docs/pin-ceremony.md', section: 'Guides' },
  { route: 'guides/comparison', source: 'docs/comparison.md', section: 'Guides' },

  { route: 'agents', kind: 'section-index', section: 'For Agents', nav: 'For Agents' },
  // `title` overrides the source's own H1 for NAVIGATION only — the page still
  // renders the document unchanged. llms.txt opens with the project's name
  // rather than the document's, which as a card label says nothing.
  { route: 'agents/llms-txt', source: 'llms.txt', section: 'For Agents', title: 'llms.txt — the machine-readable index' },
  { route: 'agents/integrations', source: 'integrations/README.md', section: 'For Agents' },
  // The Agent Skill's own SKILL.md is deliberately NOT the published page: it opens with
  // YAML frontmatter, which is a rule directly under text — a setext heading this renderer
  // refuses (correctly) rather than publish as an accidental heading. The directory README
  // is the page; it links to the SKILL.md on the forge, which is where a reader copies it
  // from anyway. `skills/` is outside PUBLISHABLE_GLOBS, so nothing else there needs a decision.
  { route: 'agents/skill', source: 'skills/README.md', section: 'For Agents' },
  { route: 'agents/blueprint-author', source: 'prompts/blueprint-author.md', section: 'For Agents' },
  { route: 'agents/prompt-validation', source: 'prompts/VALIDATION.md', section: 'For Agents' },

  { route: 'rfcs', kind: 'section-index', section: 'RFCs', nav: 'RFCs' },
  { route: 'rfcs/RFC-0001-process', source: 'rfcs/RFC-0001-process.md', section: 'RFCs' },

  { route: 'guides/faq', source: 'docs/faq.md', nav: 'FAQ', section: 'Guides' },

  { route: 'paper', kind: 'paper', nav: 'Paper', section: null },
  { route: 'trust', kind: 'trust', nav: 'Trust', section: null },
];

// ---------------------------------------------------------------------------
// The Trust / Evidence page. GENERATED, not a mapped source: the substance
// lives in the records it links to — the witness ledger, the citation file,
// the landing page's Credibility section — and duplicating any of it here
// would create a second copy to drift. This page only says where each record
// is and the state each is honestly in — and neither state claim is
// hand-written: the witness count is READ from ATTESTATIONS.md's own
// headline at build time (the same one-source discipline as
// blurbsFromLlmsTxt), and the citation claim is ASSERTED against
// CITATION.cff's actual placeholder tokens, so the first witness row updates
// this page and a landed DOI turns the build red until the copy is rewritten
// deliberately — never a silently-false page. The page is rendered through
// the same pipeline as every mapped document, so every link is validated by
// the build's own checks — including the #credibility anchor on the landing
// page, which turns "the README dropped its Credibility section" into a red
// build instead of a dead link here, and the link-target check, which turns
// a renamed check-release-citation.mjs into a red build too.
// ---------------------------------------------------------------------------
function trustMd() {
  // Witness count: derived, never restated. The ledger's own headline is the
  // one source; if its shape changes, refuse rather than guess (exit 2 — the
  // page cannot be honestly rendered).
  const ledger = readSource('ATTESTATIONS.md');
  const m = /^>\s*\*\*Count:\s*(\d+)\.\*\*/m.exec(ledger);
  if (!m) {
    harness(
      'ATTESTATIONS.md no longer carries the "> **Count: N.**" headline the trust page ' +
      'derives its witness count from — re-point the derivation at the ledger\'s new shape.',
    );
  }
  const count = Number(m[1]);

  // Citation state: placeholders are forbidden. Absent paper identifiers are honest for a
  // software release; provisional identifiers are not.
  const cff = readSource('CITATION.cff');
  // Two pending-token generations exist: the original '-PENDING' spelling and the
  // ship-blocker marker-family spelling (assembled from parts so this file cannot
  // trip the tracked-file blocker scan). Either spelling means "still pending";
  // Either present means the public metadata is provisional and must be refused.
  const SM = ['_DO', 'NOT', 'SHIP'].join('_');
  for (const [label, spellings] of [
    ['arXiv-id', ['ARXIV-ID-PENDING', `ARXIV_ID_PENDING${SM}`]],
    ['DOI', ['DOI-PENDING', `DOI_PENDING${SM}`]],
  ]) {
    if (spellings.some((token) => cff.includes(token))) {
      problem(
        `trust page: CITATION.cff carries a pending ${label} placeholder; remove provisional ` +
        'metadata and add identifiers only after real records exist.',
      );
    }
  }

  return `# Trust and evidence

Where this project's credibility records live, and the state each one is in
today. The records are the substance — this page only points at them.

- **What is measured, and by whom** — the landing page's
  [Credibility](README.md#credibility) section states the position in full:
  every proof in this repository is produced by machinery its authors wrote,
  run on infrastructure its authors control, and that is not the same thing
  as independent confirmation.
- **Independent witnesses: ${count}.** [ATTESTATIONS.md](ATTESTATIONS.md) is the
  witness ledger, published at its honest count. The one-minute, offline
  procedure for adding a row — including a run that contradicts the
  documentation — is [docs/launch/witness-kit.md](docs/launch/witness-kit.md).
- **Citation metadata is software-only.** [CITATION.cff](CITATION.cff) carries
  no provisional paper, arXiv, or DOI identifier. A preferred paper citation
  is added only after a real manuscript and archival record exist;
  [scripts/check-release-citation.mjs](scripts/check-release-citation.mjs)
  refuses placeholder identifiers.
`;
}

// Section order for the landing page's "Start here" block and for section
// indexes. A section not listed here would be a map bug, so the build says so.
const SECTION_ORDER = ['Specification', 'Guides', 'For Agents', 'RFCs'];

const SECTION_BLURB = {
  Specification: 'The normative artifact model, constraint taxonomy, scoring, modes, and versioning policy — plus the generated JSON Schemas and the conformance vectors.',
  Guides: 'Adopting the gate, reading its output, and extending it.',
  'For Agents': 'What an agent working in a gated repository needs: the machine-readable index, drop-in loop snippets, and the experimental authoring prompt pack.',
  RFCs: 'How the format changes.',
};

// Sources that are deliberately NOT published, each with the reason. Anything
// publishable that is neither mapped above nor listed here fails the build.
const UNPUBLISHED = {
  'docs/launch/README-contested-variant.md': 'launch-preparation material, not documentation',
  'docs/launch/public-flip-checklist.md': 'launch-preparation material, not documentation',
  'docs/launch/show-hn-draft.md': 'launch-preparation material, not documentation',
  'docs/launch/week-1-triage.md': 'launch-preparation material, not documentation',
  'docs/launch/witness-kit.md': 'launch-preparation material, not documentation',
  'docs/launch/landscape-reverify-2026-08-27.md': 'dated launch-verification record, not documentation',
  'docs/launch/skill-listing-drafts.md': 'launch-preparation material, not documentation',
};

// Directories swept for publishable markdown when checking IA completeness.
const PUBLISHABLE_GLOBS = [
  { dir: 'docs', recursive: true },
  { dir: 'rfcs', recursive: false },
  { dir: 'prompts', recursive: false },
];

// Files copied to the site verbatim, at a fixed route. `llms.txt` is served at
// the site root because that is the convention agents look for.
const VERBATIM = [{ source: 'llms.txt', route: 'llms.txt' }];

// ---------------------------------------------------------------------------
// Failure reporting. Two classes, two exit codes, mirroring tools/verify-chain.mjs:
// a harness problem (2) is "this build could not run"; a check failure (1) is
// "this build ran and the site is wrong".
// ---------------------------------------------------------------------------
const problems = [];
function harness(msg) {
  console.error(`build-docs-site: ${msg}`);
  process.exit(2);
}
function problem(msg) {
  problems.push(msg);
}

// ---------------------------------------------------------------------------
// Rendering — markdown to HTML, over the measured construct surface only.
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** GitHub's heading-anchor algorithm: lowercase, drop punctuation, spaces to
 *  hyphens. Matched deliberately — existing docs already link to anchors in
 *  that shape (e.g. spec/SPEC.md#13-exit-code-contract-reference-cli). */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N} \-_]/gu, '')
    .trim()
    .replace(/ /g, '-');
}

/**
 * Rewrite one markdown link target into a site URL.
 *
 * A target that names a published source becomes a relative site route (so the
 * site is independent of the base path it is served from — it works the same at
 * a project path or a domain root). A target that names anything else in the
 * repository becomes a link to that file's source on the forge, which is the
 * honest destination: the site publishes documentation, not the whole tree.
 */
function rewriteTarget(rawTarget, sourceFile, fromRoute, ctx) {
  const hashAt = rawTarget.indexOf('#');
  const fragment = hashAt >= 0 ? rawTarget.slice(hashAt) : '';
  let target = hashAt >= 0 ? rawTarget.slice(0, hashAt) : rawTarget;

  if (target === '') return { href: fragment, internal: true, selfAnchor: true };

  // An absolute URL (any scheme) is an external link: pass it through verbatim
  // and never path-join it. Without this guard, the first document to use an
  // inline [text](https://...) link — none of the originally measured sources
  // did — had its URL joined onto the source directory and reported as a
  // missing file in the tree (found on main 2026-08-27, first fired by
  // docs/comparison.md's evidence links).
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return { href: rawTarget, internal: false };
  }

  // Resolve against the source file's own directory, exactly as a reader
  // following the link in the repository would.
  const abs = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), target));
  const repoPath = abs.replace(/^\.\//, '').replace(/\/$/, '');

  const mapped = ctx.routeBySource.get(repoPath);
  if (mapped !== undefined) {
    return { href: relativeUrl(fromRoute, mapped, true) + fragment, internal: true, targetRoute: mapped, fragment };
  }

  const verbatim = ctx.verbatimBySource.get(repoPath);
  if (verbatim !== undefined) {
    return { href: relativeUrl(fromRoute, verbatim, false) + fragment, internal: true, targetFile: verbatim, fragment };
  }

  // The published schemas: individual files, and the directory that holds them.
  if (/^spec\/schemas\/[A-Za-z0-9._-]+\.schema\.json$/.test(repoPath)) {
    const file = `schemas/${path.posix.basename(repoPath)}`;
    return { href: relativeUrl(fromRoute, file, false) + fragment, internal: true, targetFile: file, fragment };
  }
  if (repoPath === 'spec/schemas') {
    return { href: relativeUrl(fromRoute, 'schemas', true) + fragment, internal: true, targetRoute: 'schemas', fragment };
  }

  // Repository images referenced by a published page are PUBLISHED WITH the
  // site, at the same relative path. Without this they would fall through to
  // the forge-link branch below and the landing page's hero would resolve to a
  // blob URL — an HTML page, not an image — so every hero image would be a
  // broken image on the site while remaining fine on the forge's own README
  // view. The build copies exactly the set collected here; nothing else.
  if (/^assets\/[A-Za-z0-9._/-]+\.svg$/.test(repoPath) && fs.existsSync(path.join(repoRoot, repoPath))) {
    ctx.siteAssets.add(repoPath);
    return { href: relativeUrl(fromRoute, repoPath, false) + fragment, internal: true, targetFile: repoPath, fragment };
  }

  // Everything else lives in the repository, not on this site.
  const onDisk = path.join(repoRoot, repoPath);
  if (!fs.existsSync(onDisk)) {
    problem(`${sourceFile}: link target does not exist in the tree: ${rawTarget} (resolved to ${repoPath})`);
    return { href: REPO_BLOB + repoPath + fragment, internal: false };
  }
  const isDir = fs.statSync(onDisk).isDirectory();
  return { href: (isDir ? REPO_TREE : REPO_BLOB) + repoPath + fragment, internal: false };
}

/** Relative URL from one route to another, so no page hard-codes a base path. */
function relativeUrl(fromRoute, to, toIsRoute) {
  const fromDir = fromRoute === '' ? '.' : fromRoute;
  const toPath = toIsRoute ? (to === '' ? '.' : to) : to;
  let rel = path.posix.relative(fromDir, toPath);
  if (rel === '') rel = '.';
  if (toIsRoute && !rel.endsWith('/')) rel += '/';
  return rel;
}

/**
 * Emit one <img>, rewriting its src the same way a link target is rewritten so a
 * site-published asset resolves site-locally and anything else points at the forge.
 *
 * Values arrive ALREADY ESCAPED. The markdown caller runs inside renderInline, which has
 * escaped the whole run before the image pass; the hero-block caller escapes what it parsed
 * out of the raw source line. Escaping here as well would double-encode the markdown path's
 * alt text, so the contract is "caller escapes" and both callers honour it.
 */
function emitImg({ src, alt, width, height }, sourceFile, fromRoute, ctx, hrefSink) {
  const r = rewriteTarget(src, sourceFile, fromRoute, ctx);
  if (hrefSink && r.internal) hrefSink.push(r);
  const w = width ? ` width="${width}"` : '';
  const h = height ? ` height="${height}"` : '';
  return `<img src="${r.href}" alt="${alt}"${w}${h}>`;
}

/** Inline rendering. Code spans are extracted first so nothing inside them is
 *  ever treated as markup, then links, then emphasis, then bare URLs.
 *
 *  The span sentinel is the NUL character — the one code point that cannot
 *  appear in a utf8-decoded markdown source — written as the ESCAPE \u0000,
 *  NEVER a literal byte. A literal NUL makes grep classify this file as
 *  binary, and the banned-phrase gate's `--binary-files=without-match` sweep
 *  then skips the file entirely — including the visitor-facing prose it
 *  carries (the trust page, the section blurbs, the paper placeholder),
 *  exactly the copy genre that gate exists to police. Proven 2026-08-27: a
 *  phrase planted in a NUL-bearing copy of this file went uncaught by the
 *  gate's own scan command. Check 6 in main() refuses the build if a literal
 *  NUL ever returns. */
function renderInline(text, sourceFile, fromRoute, ctx, hrefSink) {
  const codeSpans = [];
  let work = text.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code) => {
    codeSpans.push(code);
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  work = escapeHtml(work);

  // Images, markdown form. `alt` is REQUIRED here for the same reason it is in
  // the hero block: an image with no text alternative is unreadable to anyone
  // using a screen reader, and on the landing page it is the hero itself.
  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    if (alt.trim() === '') {
      harness(`${sourceFile}: image ${src} has no alt text — every image on this site must carry one`);
    }
    return emitImg({ src, alt }, sourceFile, fromRoute, ctx, hrefSink);
  });

  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, target) => {
    const r = rewriteTarget(target, sourceFile, fromRoute, ctx);
    if (hrefSink) hrefSink.push(r);
    const ext = r.internal ? '' : ' rel="noopener"';
    return `<a href="${r.href}"${ext}>${label}</a>`;
  });

  // Emphasis spans newlines: every source in this tree hard-wraps its prose, so
  // a **run** that starts on one line and closes on the next is the COMMON case,
  // not an edge one. A newline-forbidding pattern leaves the asterisks on the
  // page and then mis-pairs the next run against them. Scope is bounded because
  // renderInline is called per block (paragraph, list item, table cell).
  work = work.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  work = work.replace(/(?<![*\w])\*([^*]+?)\*(?!\w)/g, '<em>$1</em>');
  work = work.replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '<em>$1</em>');

  // Bare URLs that survived the link pass are not yet anchors.
  work = work.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:])/g,
    (_m, pre, url) => `${pre}<a href="${url}" rel="noopener">${url}</a>`);

  return work.replace(/\u0000CODE(\d+)\u0000/g, (_m, i) => `<code>${escapeHtml(codeSpans[Number(i)])}</code>`);
}

const BULLET = /^(\s*)([-*])\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)\.\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*```(\S*)\s*$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_DELIM = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

// ---------------------------------------------------------------------------
// The ONE raw-HTML construct this renderer accepts: a centered hero block.
//
// Markdown has no way to centre anything, and the landing page's hero — banner,
// terminal cast, shields row — is the one place the project needs it. Rather
// than open the renderer to HTML generally (which is what "just use a markdown
// library" would have done), exactly four shapes are recognised: the centred
// wrapper, an <img>, an <a> wrapping an <img>, and the matching close tag.
// EVERYTHING else starting with `<` still hits the refusal below, unchanged —
// this widens the measured surface by four constructs, it does not remove the
// fail-closed default. A construct that is recognised but malformed (an <img>
// with no alt, an unknown attribute, a mismatched close tag) is REFUSED rather
// than rendered, so the whitelist cannot be a hole.
// ---------------------------------------------------------------------------
const CENTER_OPEN = /^<(p|div) align="center">$/;
const CENTER_CLOSE = /^<\/(p|div)>$/;
// `>` is legal INSIDE a quoted attribute value and nowhere else — alt="node: >=22"
// is a real caption, not malformed markup. The attribute run is therefore matched
// as a sequence of (bare chars | quoted strings), which admits the caption while
// still refusing a stray unquoted `<` or `>` that would mean the tag is malformed.
const ATTR_RUN = '(?:[^<>"]|"[^"]*")*?';
const IMG_ONLY = new RegExp(`^<img\\s+(${ATTR_RUN})\\s*/?>$`);
const LINKED_IMG = new RegExp(`^<a\\s+href="([^"<>]+)"\\s*>\\s*(<img\\s+${ATTR_RUN}\\s*/?>)\\s*</a>$`);
/** Attributes an <img> in a hero block may carry. Anything else is refused. */
const IMG_ATTRS = new Set(['src', 'alt', 'width', 'height']);

/**
 * Render a markdown document. Returns { html, title, headings }.
 *
 * Refuses (exit 2) on any block construct outside the measured surface, so a
 * doc that grows one is caught by a red build, not by a reader.
 */
function renderMarkdown(md, sourceFile, fromRoute, ctx, hrefSink) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  const seenSlugs = new Map();
  let title = null;
  let i = 0;

  const inline = (t) => renderInline(t, sourceFile, fromRoute, ctx, hrefSink);

  const pushHeading = (level, rawText) => {
    const text = inline(rawText.replace(/\s+#+\s*$/, ''));
    let slug = slugify(rawText.replace(/`/g, ''));
    if (slug === '') slug = 'section';
    const n = seenSlugs.get(slug) ?? 0;
    seenSlugs.set(slug, n + 1);
    const id = n === 0 ? slug : `${slug}-${n}`;
    if (level === 1 && title === null) title = rawText.replace(/[`*_]/g, '').trim();
    headings.push({ level, id, text });
    out.push(`<h${level} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Permalink">#</a></h${level}>`);
  };

  // Collect consecutive lines that belong to one paragraph-ish run.
  const paragraph = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${inline(paragraph.join('\n'))}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // HTML comments are maintainer notes about the document, not part of it.
    // They are dropped rather than published — several name internal
    // launch-preparation files this site deliberately does not carry.
    if (/^\s*<!--/.test(line)) {
      flushParagraph();
      while (i < lines.length && !/-->/.test(lines[i])) i += 1;
      i += 1;
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      i += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const lang = fence[1];
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) harness(`${sourceFile}: unterminated code fence`);
      i += 1;
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(body.join('\n'))}\n</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      pushHeading(heading[1].length, heading[2]);
      i += 1;
      continue;
    }

    if (RULE.test(line) && paragraph.length === 0) {
      out.push('<hr>');
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      // A rule directly under text is a setext heading in markdown. The tree
      // contains none; refuse rather than render an accidental heading as a line.
      harness(`${sourceFile}:${i + 1}: setext heading (rule under text) is not rendered — use an ATX heading`);
    }

    // Table: a header row followed by a delimiter row.
    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_DELIM.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flushParagraph();
      const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const header = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        body.push(cells(lines[i]));
        i += 1;
      }
      const th = header.map((c) => `<th>${inline(c)}</th>`).join('');
      const rows = body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      flushParagraph();
      const quoted = [];
      // Every quoted line in this tree carries its own '>' marker; lazy
      // continuation (an unmarked line inside a quote) is not used anywhere and
      // is not accepted here — it would end the quote silently rather than
      // guess at what the author meant.
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      const inner = renderMarkdown(quoted.join('\n'), sourceFile, fromRoute, ctx, hrefSink);
      out.push(`<blockquote>${inner.html}</blockquote>`);
      continue;
    }

    if (BULLET.test(line) || ORDERED.test(line)) {
      flushParagraph();
      const { html, next } = renderList(lines, i, sourceFile, fromRoute, ctx, hrefSink);
      out.push(html);
      i = next;
      continue;
    }

    // The centred hero block — the ONLY raw-HTML construct this renderer
    // accepts. Note this runs BEFORE the raw-HTML refusal below and therefore
    // must be airtight: anything it recognises but cannot render exactly is
    // refused HERE, by its own message. A branch placed ahead of a refusal that
    // fell through silently would turn that refusal off for a whole class.
    if (CENTER_OPEN.test(line.trim())) {
      flushParagraph();
      const tag = CENTER_OPEN.exec(line.trim())[1];
      const startLine = i + 1;
      const parts = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        const inner = lines[i].trim();
        i += 1;
        if (inner === '') continue;
        const close = CENTER_CLOSE.exec(inner);
        if (close) {
          if (close[1] !== tag) {
            harness(`${sourceFile}:${i}: hero block opened with <${tag} align="center"> but closed with </${close[1]}>`);
          }
          closed = true;
          break;
        }

        const linked = LINKED_IMG.exec(inner);
        const imgSource = linked ? linked[2] : inner;
        const img = IMG_ONLY.exec(imgSource);
        if (!img) {
          harness(
            `${sourceFile}:${i}: a centered hero block may contain only <img> or <a href="…"><img …></a>.\n  ${inner}`,
          );
        }

        const attrs = {};
        for (const m of img[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
        for (const name of Object.keys(attrs)) {
          if (!IMG_ATTRS.has(name)) {
            harness(`${sourceFile}:${i}: <img ${name}="…"> is not an attribute this renderer emits — allowed: ${[...IMG_ATTRS].join(', ')}`);
          }
        }
        if (!attrs.src) harness(`${sourceFile}:${i}: <img> has no src`);
        if (!attrs.alt || attrs.alt.trim() === '') {
          harness(
            `${sourceFile}:${i}: <img src="${attrs.src}"> has no alt text — every image on this site must ` +
            'carry one, and the hero is the image a reader is most likely to need described.',
          );
        }

        const el = emitImg(
          {
            src: attrs.src,
            alt: escapeHtml(attrs.alt),
            width: attrs.width ? escapeHtml(attrs.width) : undefined,
            height: attrs.height ? escapeHtml(attrs.height) : undefined,
          },
          sourceFile,
          fromRoute,
          ctx,
          hrefSink,
        );

        if (linked) {
          const r = rewriteTarget(linked[1], sourceFile, fromRoute, ctx);
          if (hrefSink) hrefSink.push(r);
          parts.push(`<a href="${r.href}"${r.internal ? '' : ' rel="noopener"'}>${el}</a>`);
        } else {
          parts.push(el);
        }
      }
      if (!closed) harness(`${sourceFile}:${startLine}: hero block opened with <${tag} align="center"> is never closed`);
      out.push(`<p class="hero">${parts.join('\n')}</p>`);
      continue;
    }

    // Two constructs would otherwise reach the paragraph fallback and be
    // published as escaped literal text — visibly wrong, but green. Refuse
    // them instead, so the build says so rather than the page.
    if (/^\s*<[a-zA-Z!/]/.test(line)) {
      harness(
        `${sourceFile}:${i + 1}: raw HTML block is not rendered — it would be published as ` +
        `literal text. Use markdown, or extend this renderer deliberately.\n  ${line.trim()}`,
      );
    }
    if (/^\s*\[[^\]]+\]:\s+\S/.test(line)) {
      harness(
        `${sourceFile}:${i + 1}: reference-style link definition is not rendered — the label ` +
        `would be published as literal text. Use an inline [text](target) link.\n  ${line.trim()}`,
      );
    }

    paragraph.push(line.trim());
    i += 1;
  }
  flushParagraph();

  return { html: out.join('\n'), title, headings };
}

/** Lists, including the two-deep nesting the tree actually uses. */
function renderList(lines, start, sourceFile, fromRoute, ctx, hrefSink) {
  const first = BULLET.exec(lines[start]) ?? ORDERED.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = ORDERED.test(lines[start]) && !BULLET.test(lines[start]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1] ?? '';
      const m = BULLET.exec(next) ?? ORDERED.exec(next);
      const continues = (m && m[1].length >= baseIndent) || /^\s{2,}\S/.test(next);
      if (!continues) break;
      i += 1;
      continue;
    }
    const m = BULLET.exec(line) ?? ORDERED.exec(line);
    if (m) {
      const indent = m[1].length;
      if (indent < baseIndent) break;
      if (indent > baseIndent) {
        const nested = renderList(lines, i, sourceFile, fromRoute, ctx, hrefSink);
        if (items.length === 0) harness(`${sourceFile}:${i + 1}: nested list with no parent item`);
        items[items.length - 1].nested.push(nested.html);
        i = nested.next;
        continue;
      }
      const sameKind = (ORDERED.test(line) && !BULLET.test(line)) === ordered;
      if (!sameKind) break;
      items.push({ text: [m[3]], nested: [] });
      i += 1;
      continue;
    }
    // A continuation line of the current item (lazy or indented).
    if (items.length === 0) break;
    if (line.trim().startsWith('|') || FENCE.test(line) || HEADING.test(line)) break;
    items[items.length - 1].text.push(line.trim());
    i += 1;
  }

  const tag = ordered ? 'ol' : 'ul';
  const body = items
    .map((it) => `<li>${renderInline(it.text.join('\n'), sourceFile, fromRoute, ctx, hrefSink)}${it.nested.join('')}</li>`)
    .join('');
  return { html: `<${tag}>${body}</${tag}>`, next: i };
}

// ---------------------------------------------------------------------------
// Page template. One stylesheet, served from this site — no external asset of
// any kind, so the site renders identically offline and leaks no request to a
// third party.
// ---------------------------------------------------------------------------

function navHtml(fromRoute, currentRoute) {
  const entries = PAGES.filter((p) => p.nav);
  return entries
    .map((p) => {
      const cls = p.route === currentRoute ? ' class="current" aria-current="page"' : '';
      return `<a href="${relativeUrl(fromRoute, p.route, true)}"${cls}>${escapeHtml(p.nav)}</a>`;
    })
    .join('');
}

function tocHtml(headings) {
  const h2 = headings.filter((h) => h.level === 2);
  if (h2.length < 6) return '';
  const items = h2.map((h) => `<li><a href="#${h.id}">${h.text}</a></li>`).join('');
  return `<nav class="toc" aria-label="On this page"><p class="toc-title">On this page</p><ul>${items}</ul></nav>`;
}

/** The contents block belongs UNDER the document's title, not above it — a
 *  reader meets the page's name first. Long reference documents get one; a
 *  landing or section index is already a list of links and does not. */
function withToc(bodyHtml, headings, wanted) {
  const toc = wanted ? tocHtml(headings ?? []) : '';
  if (toc === '') return bodyHtml;
  const end = bodyHtml.indexOf('</h1>');
  if (end === -1) return `${toc}\n${bodyHtml}`;
  const at = end + '</h1>'.length;
  return `${bodyHtml.slice(0, at)}\n${toc}${bodyHtml.slice(at)}`;
}

function pageHtml({ route, title, bodyHtml, headings, sourceFile, wantToc }) {
  const depth = route === '' ? 0 : route.split('/').length;
  const cssHref = `${'../'.repeat(depth) || './'}assets/site.css`;
  const homeHref = relativeUrl(route, '', true);
  const docTitle = route === '' ? `${SITE_NAME} — ${SITE_TAGLINE}` : `${title} — ${SITE_NAME}`;
  const source = sourceFile
    ? `<p class="source">Source: <a href="${REPO_BLOB}${sourceFile}" rel="noopener">${escapeHtml(sourceFile)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(docTitle)}</title>
<link rel="stylesheet" href="${cssHref}">
</head>
<body>
<header class="site-header">
  <a class="brand" href="${homeHref}"><strong>${SITE_NAME}</strong> <span>${SITE_TAGLINE}</span></a>
  <nav class="site-nav" aria-label="Sections">${navHtml(route, route)}</nav>
</header>
<main>
<article>
${withToc(bodyHtml, headings, wantToc)}
</article>
${source}
</main>
<footer class="site-footer">
  <p>Apache-2.0. Pre-release: names, schemas, and commands may change before the initial public tag.</p>
</footer>
</body>
</html>
`;
}

const STYLESHEET = `/* bce documentation site — one local stylesheet, no external assets. */
:root {
  --bg: #ffffff; --fg: #1b1f24; --muted: #5a6472; --line: #d8dee6;
  --accent: #0b5fff; --code-bg: #f5f7fa; --quote: #f2f6ff;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #101418; --fg: #e6e9ee; --muted: #9aa4b2; --line: #2a323c;
    --accent: #6ea8ff; --code-bg: #171d24; --quote: #161d29;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
a { color: var(--accent); }
.site-header {
  display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; align-items: baseline;
  padding: 1rem 1.25rem; border-bottom: 1px solid var(--line);
}
.brand { text-decoration: none; color: var(--fg); }
.brand span { color: var(--muted); font-size: .9rem; }
.site-nav { display: flex; flex-wrap: wrap; gap: 1rem; margin-left: auto; }
.site-nav a { text-decoration: none; font-size: .93rem; }
.site-nav a.current { color: var(--fg); font-weight: 600; }
main { max-width: 46rem; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
article > :first-child { margin-top: 0; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 2rem 0 .75rem; }
h1 { font-size: 1.9rem; letter-spacing: -.01em; }
h2 { font-size: 1.35rem; padding-top: .5rem; border-top: 1px solid var(--line); }
h3 { font-size: 1.1rem; }
h4, h5, h6 { font-size: 1rem; }
p, ul, ol, blockquote, .table-wrap, pre { margin: 0 0 1rem; }
li { margin: .25rem 0; }
li > ul, li > ol { margin: .25rem 0 .25rem 0; }
code {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: .88em; background: var(--code-bg); padding: .1em .35em; border-radius: 3px;
}
pre {
  background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px;
  padding: .85rem 1rem; overflow-x: auto;
}
pre code { background: none; padding: 0; font-size: .85rem; line-height: 1.55; }
blockquote {
  margin-left: 0; padding: .6rem 1rem; background: var(--quote);
  border-left: 3px solid var(--accent); border-radius: 0 4px 4px 0;
}
blockquote > :last-child { margin-bottom: 0; }
.table-wrap { overflow-x: auto; }
/* The centred hero block. Images scale down on a narrow viewport rather than
   forcing the page to scroll sideways; the shields row wraps instead of
   overflowing. */
.hero { text-align: center; line-height: 0; }
.hero img { max-width: 100%; height: auto; margin: .2rem .15rem; }
table { border-collapse: collapse; width: 100%; font-size: .93rem; }
th, td { text-align: left; vertical-align: top; padding: .45rem .7rem; border: 1px solid var(--line); }
th { background: var(--code-bg); font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--line); margin: 2rem 0; }
.anchor {
  margin-left: .4rem; opacity: 0; text-decoration: none; font-weight: 400; color: var(--muted);
}
h1:hover .anchor, h2:hover .anchor, h3:hover .anchor,
h4:hover .anchor, h5:hover .anchor, h6:hover .anchor { opacity: 1; }
.toc {
  border: 1px solid var(--line); border-radius: 6px; padding: .85rem 1rem;
  margin: 0 0 2rem; background: var(--code-bg); font-size: .92rem;
}
.toc-title { margin: 0 0 .4rem; font-weight: 600; color: var(--muted); }
.toc ul { margin: 0; padding-left: 1.1rem; }
.cards { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); padding: 0; margin: 0 0 1.5rem; list-style: none; }
.cards li { border: 1px solid var(--line); border-radius: 6px; padding: .9rem 1rem; margin: 0; }
.cards h3 { margin: 0 0 .35rem; font-size: 1rem; }
.cards p { margin: 0; color: var(--muted); font-size: .92rem; }
.source { color: var(--muted); font-size: .85rem; margin-top: 2.5rem; }
.site-footer {
  border-top: 1px solid var(--line); padding: 1.25rem; text-align: center;
  color: var(--muted); font-size: .85rem;
}
@media (max-width: 40rem) {
  .site-nav { margin-left: 0; gap: .75rem; }
  main { padding: 1.5rem 1rem 3rem; }
}
`;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = { out: path.join(repoRoot, '_site'), quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out') {
      const v = argv[i + 1];
      if (!v) harness('--out needs a directory');
      opts.out = path.resolve(v);
      i += 1;
    } else if (argv[i] === '--quiet') {
      opts.quiet = true;
    } else {
      harness(`unknown argument: ${argv[i]}\nusage: node scripts/build-docs-site.mjs [--out <dir>] [--quiet]`);
    }
  }
  return opts;
}

function readSource(rel) {
  const p = path.join(repoRoot, rel);
  if (!fs.existsSync(p)) harness(`mapped source does not exist: ${rel}`);
  return fs.readFileSync(p, 'utf8');
}

/** One-line descriptions, parsed out of llms.txt so they are maintained in
 *  exactly one place and cannot drift from the machine-readable index. */
function blurbsFromLlmsTxt() {
  const map = new Map();
  for (const line of readSource('llms.txt').split('\n')) {
    const m = /^-\s+\[[^\]]+\]\(([^)]+)\):\s*(.+?)\s*$/.exec(line);
    if (m) map.set(m[1].replace(/^\.\//, ''), m[2]);
  }
  return map;
}

function walkMarkdown(dir, recursive, acc) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return acc;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recursive) walkMarkdown(rel, recursive, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(rel);
    }
  }
  return acc;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = opts.out;
  const log = (m) => { if (!opts.quiet) console.log(m); };

  // ---- check 6: this file must stay grep-scannable text --------------------
  // One literal NUL byte here and grep classifies the whole file as binary;
  // the banned-phrase gate's sweep (`grep -rniF --binary-files=without-match`)
  // then skips it silently — a gate that can no longer go red on exactly the
  // visitor-facing prose this script carries. The code-span sentinel is
  // written as an escape for this reason; refuse the build if a literal NUL
  // ever returns.
  const selfSource = fs.readFileSync(fileURLToPath(import.meta.url));
  if (selfSource.includes(0)) {
    harness(
      'scripts/build-docs-site.mjs contains a literal NUL byte — grep would classify it as ' +
      'binary and the banned-phrase gate would silently skip every phrase in it. Write the ' +
      'byte as an escape (e.g. the \\u0000 code-span sentinel), never literally.',
    );
  }

  // ---- context: what maps to what -----------------------------------------
  const routeBySource = new Map();
  for (const p of PAGES) if (p.source) routeBySource.set(p.source, p.route);
  const verbatimBySource = new Map(VERBATIM.map((v) => [v.source, v.route]));
  // Filled during rendering: every assets/*.svg a published page actually
  // references. Copying the whole directory instead would publish assets no
  // page uses and hide a typo'd src behind a file that happens to be there.
  const ctx = { routeBySource, verbatimBySource, siteAssets: new Set() };

  for (const p of PAGES) {
    if (p.section && !SECTION_ORDER.includes(p.section)) {
      harness(`page ${p.route || '/'} names section "${p.section}", which is not in SECTION_ORDER`);
    }
  }

  // ---- check 1: IA completeness -------------------------------------------
  const publishable = [];
  for (const g of PUBLISHABLE_GLOBS) walkMarkdown(g.dir, g.recursive, publishable);
  publishable.push('spec/SPEC.md', 'spec/conformance-vectors/README.md', 'integrations/README.md', 'llms.txt', 'README.md');
  for (const src of publishable.sort()) {
    if (routeBySource.has(src) || Object.hasOwn(UNPUBLISHED, src)) continue;
    problem(
      `IA drift: ${src} is publishable but has no route in PAGES. Add a route, ` +
      'or list it in UNPUBLISHED with the reason it is not published.',
    );
  }
  for (const src of Object.keys(UNPUBLISHED)) {
    if (!fs.existsSync(path.join(repoRoot, src))) {
      problem(`UNPUBLISHED names ${src}, which no longer exists — remove the entry.`);
    }
  }

  // ---- clean output --------------------------------------------------------
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(outDir, 'assets/site.css'), STYLESHEET);

  // ---- schemas: byte-for-byte, at the paths their $id names ---------------
  const schemaDir = path.join(repoRoot, 'spec/schemas');
  const schemaFiles = fs.readdirSync(schemaDir).filter((f) => f.endsWith('.schema.json')).sort();
  if (schemaFiles.length === 0) harness('spec/schemas contains no *.schema.json');
  fs.mkdirSync(path.join(outDir, 'schemas'), { recursive: true });
  for (const f of schemaFiles) {
    const src = fs.readFileSync(path.join(schemaDir, f));
    const dest = path.join(outDir, 'schemas', f);
    fs.writeFileSync(dest, src);
    if (!fs.readFileSync(dest).equals(src)) problem(`schema copy differs from source: ${f}`);
  }

  // ---- verbatim files ------------------------------------------------------
  for (const v of VERBATIM) {
    fs.writeFileSync(path.join(outDir, v.route), readSource(v.source));
  }

  const blurbs = blurbsFromLlmsTxt();
  const produced = new Map(); // route -> { anchors:Set, hrefs:[] }

  const titleOf = new Map();
  const renderedBody = new Map();

  // ---- render every mapped source once ------------------------------------
  for (const p of PAGES) {
    if (!p.source) continue;
    const md = readSource(p.source);
    const hrefs = [];
    const r = renderMarkdown(md, p.source, p.route, ctx, hrefs);
    const title = p.title ?? r.title ?? p.route;
    titleOf.set(p.route, title);
    renderedBody.set(p.route, { r, hrefs });
  }

  // ---- referenced images: copied byte-for-byte, before the link check ------
  // Runs after rendering (which is what discovers the set) and before check 4,
  // which asserts every internal href resolves to a file this build produced.
  for (const rel of [...ctx.siteAssets].sort()) {
    const src = fs.readFileSync(path.join(repoRoot, rel));
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, src);
    if (!fs.readFileSync(dest).equals(src)) problem(`asset copy differs from source: ${rel}`);
  }

  const linkTo = (fromRoute, toRoute) => relativeUrl(fromRoute, toRoute, true);

  const cardList = (fromRoute, pages) =>
    `<ul class="cards">${pages
      .map((p) => {
        const t = titleOf.get(p.route) ?? p.route;
        const b = p.source ? blurbs.get(p.source) : undefined;
        return `<li><h3><a href="${linkTo(fromRoute, p.route)}">${escapeHtml(t)}</a></h3>${
          b ? `<p>${renderInline(b, 'llms.txt', fromRoute, ctx, null)}</p>` : ''
        }</li>`;
      })
      .join('')}</ul>`;

  // ---- write pages ---------------------------------------------------------
  for (const p of PAGES) {
    const hrefs = [];
    let bodyHtml;
    let headings = [];
    let title = titleOf.get(p.route) ?? p.route;

    if (p.kind === 'landing') {
      const { r, hrefs: h } = renderedBody.get(p.route);
      headings = r.headings;
      hrefs.push(...h);
      const sections = SECTION_ORDER.map((s) => {
        const index = PAGES.find((q) => q.section === s && (q.kind === 'section-index' || q.route === 'spec'));
        const href = linkTo(p.route, index ? index.route : '');
        if (index) hrefs.push({ href, internal: true, targetRoute: index.route, fragment: '' });
        return `<li><h3><a href="${href}">${escapeHtml(s)}</a></h3><p>${escapeHtml(SECTION_BLURB[s] ?? '')}</p></li>`;
      }).join('');
      bodyHtml = `${r.html}\n<h2 id="documentation">Documentation</h2>\n<ul class="cards">${sections}</ul>`;
      headings = headings.concat([{ level: 2, id: 'documentation', text: 'Documentation' }]);
      title = SITE_NAME;
    } else if (p.kind === 'section-index') {
      const children = PAGES.filter((q) => q.section === p.section && q.route !== p.route && q.kind === undefined);
      title = p.section;
      const cards = cardList(p.route, children);
      for (const c of children) hrefs.push({ href: linkTo(p.route, c.route), internal: true, targetRoute: c.route, fragment: '' });
      bodyHtml = `<h1 id="${slugify(p.section)}">${escapeHtml(p.section)}</h1>\n<p>${escapeHtml(SECTION_BLURB[p.section] ?? '')}</p>\n${cards}`;
      headings = [{ level: 1, id: slugify(p.section), text: escapeHtml(p.section) }];
    } else if (p.kind === 'schemas-index') {
      title = 'JSON Schemas';
      // Generated from the actual file set, never a hand-maintained list.
      const items = schemaFiles
        .map((f) => `<li><a href="./${f}"><code>${escapeHtml(f)}</code></a></li>`)
        .join('');
      for (const f of schemaFiles) hrefs.push({ href: `./${f}`, internal: true, targetFile: `schemas/${f}`, fragment: '' });
      const specHref = linkTo(p.route, 'spec');
      hrefs.push({ href: specHref, internal: true, targetRoute: 'spec', fragment: '' });
      bodyHtml =
        `<h1 id="json-schemas">JSON Schemas</h1>\n` +
        `<p>The generated draft-07 schemas for the <code>blueprint-conformance/v1alpha1</code> namespace. ` +
        `Each file is served at the exact path its <code>$id</code> names; the normative text is the ` +
        `<a href="${specHref}">specification</a>.</p>\n<ul>${items}</ul>`;
      headings = [{ level: 1, id: 'json-schemas', text: 'JSON Schemas' }];
    } else if (p.kind === 'paper') {
      title = 'Paper';
      bodyHtml =
        `<h1 id="paper">Paper</h1>\n` +
        `<p><em>Placeholder — added at release.</em> The measurement this project reports is the ` +
        `seeded-defect recall run described in the specification and reproduced in CI; the write-up ` +
        `is linked here when it is published.</p>`;
      headings = [{ level: 1, id: 'paper', text: 'Paper' }];
    } else if (p.kind === 'trust') {
      // The pseudo source name carries no '/' on purpose: rewriteTarget
      // resolves link targets against the source's directory, and a bare name
      // resolves them against the repository root, which is how TRUST_MD's
      // links are written.
      const r = renderMarkdown(trustMd(), 'trust (generated)', p.route, ctx, hrefs);
      title = r.title ?? 'Trust and evidence';
      bodyHtml = r.html;
      headings = r.headings;
    } else {
      const entry = renderedBody.get(p.route);
      bodyHtml = entry.r.html;
      headings = entry.r.headings;
      hrefs.push(...entry.hrefs);
    }

    const html = pageHtml({
      route: p.route,
      title,
      bodyHtml,
      headings,
      sourceFile: p.source ?? null,
      wantToc: p.kind === undefined,
    });
    const dir = p.route === '' ? outDir : path.join(outDir, p.route);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);

    const anchors = new Set(headings.map((h) => h.id));
    produced.set(p.route, { anchors, hrefs });
  }

  // ---- check 4: internal links resolve ------------------------------------
  let internal = 0;
  let external = 0;
  for (const [route, info] of produced) {
    for (const h of info.hrefs) {
      if (!h.internal) { external += 1; continue; }
      internal += 1;
      const from = route === '' ? '.' : route;

      if (h.selfAnchor) {
        const frag = h.href.replace(/^#/, '');
        if (frag && !info.anchors.has(frag)) {
          problem(`/${route || ''}: in-page anchor #${frag} has no matching heading`);
        }
        continue;
      }

      const bare = h.href.split('#')[0];
      const fragment = (h.fragment ?? '').replace(/^#/, '');
      const resolved = path.posix.normalize(path.posix.join(from, bare));
      // Normalize back to the route spelling the page map uses: no leading
      // "./", no trailing slash, and the site root spelled as the empty string.
      const asRoute = resolved.replace(/^\.\//, '').replace(/\/+$/, '').replace(/^\.$/, '');

      if (h.targetRoute !== undefined || bare.endsWith('/') || bare === '.') {
        if (!produced.has(asRoute)) {
          problem(`/${route || ''}: link "${h.href}" points at route "/${asRoute}", which this build does not produce`);
          continue;
        }
        if (fragment && !produced.get(asRoute).anchors.has(fragment)) {
          problem(`/${route || ''}: link "${h.href}" names anchor #${fragment}, which /${asRoute} does not carry`);
        }
        continue;
      }

      const file = path.join(outDir, resolved);
      if (!fs.existsSync(file)) {
        problem(`/${route || ''}: link "${h.href}" points at "${resolved}", which this build does not produce`);
        continue;
      }
      if (fragment) {
        problem(`/${route || ''}: link "${h.href}" names a fragment on a non-HTML file`);
      }
    }
  }

  // ---- report --------------------------------------------------------------
  const pageCount = PAGES.length;
  if (problems.length > 0) {
    console.error('');
    console.error(`build-docs-site: FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    console.error('The site was written, but it is wrong. Fix the map or the link and re-run.');
    process.exit(1);
  }

  log(`build-docs-site: PASS`);
  log(`  pages     ${pageCount} (${path.relative(repoRoot, outDir)}/)`);
  log(`  schemas   ${schemaFiles.length} copied byte-for-byte to ${path.relative(repoRoot, outDir)}/schemas/`);
  log(`  assets    ${ctx.siteAssets.size} referenced image(s) copied byte-for-byte`);
  log(`  links     ${internal} internal (all resolve), ${external} external (not fetched)`);
}

main();
