#!/usr/bin/env node
/**
 * Generate the eleven responsive diagrams used by the public documentation.
 *
 * The source of truth is the semantic content below. Each concept is rendered
 * twice: a wide reading-column composition and a narrow composition that
 * reflows the same facts instead of shrinking the desktop labels.
 *
 * Usage:
 *   node scripts/generate-doc-diagrams.mjs
 *   node scripts/generate-doc-diagrams.mjs --check
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'assets', 'diagrams');
const check = process.argv.slice(2).includes('--check');

if (process.argv.slice(2).some((arg) => arg !== '--check')) {
  console.error('usage: node scripts/generate-doc-diagrams.mjs [--check]');
  process.exit(2);
}

const defs = `
  <defs>
    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#263249" stroke-width="1" opacity="0.24"/>
    </pattern>
    <marker id="cyan-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#61c9ef"/>
    </marker>
    <marker id="red-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#f05c67"/>
    </marker>
    <marker id="green-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#48c99a"/>
    </marker>
    <marker id="steel-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
      <path d="M0 0L10 5L0 10Z" fill="#7890a3"/>
    </marker>
    <style>
      .sans{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .mono{font-family:ui-monospace,"SFMono-Regular",Menlo,Consolas,"Liberation Mono",monospace}
      .title{font-size:28px;font-weight:720;letter-spacing:-.4px;fill:#e8ebed}
      .m-title{font-size:32px;font-weight:720;letter-spacing:-.4px;fill:#e8ebed}
      .heading{font-size:18px;font-weight:700;fill:#e8ebed}
      .m-heading{font-size:24px;font-weight:700;fill:#e8ebed}
      .label{font-size:13px;font-weight:700;letter-spacing:1px;fill:#7890a3}
      .m-label{font-size:18px;font-weight:700;letter-spacing:1px;fill:#7890a3}
      .body{font-size:17px;fill:#c9d5e1}
      .m-body{font-size:23px;fill:#c9d5e1}
      .code{font-size:16px;fill:#e8ebed}
      .m-code{font-size:22px;fill:#e8ebed}
      .small{font-size:14px;fill:#8fa4b5}
      .m-small{font-size:19px;fill:#8fa4b5}
      .cyan{fill:#61c9ef}.green{fill:#48c99a}.red{fill:#f05c67}.steel{fill:#7890a3}
      .node{fill:#0d1025;stroke:#566274;stroke-width:1.5;vector-effect:non-scaling-stroke}
      .cyan-node{fill:#0d1428;stroke:#61c9ef}.green-node{fill:#0c1b1c;stroke:#48c99a}.red-node{fill:#24121e;stroke:#f05c67}
      .rule{stroke:#36445b;stroke-width:1;vector-effect:non-scaling-stroke}
      .route{fill:none;stroke:#61c9ef;stroke-width:2;marker-end:url(#cyan-arrow);vector-effect:non-scaling-stroke}
      .red-route{fill:none;stroke:#f05c67;stroke-width:2;marker-end:url(#red-arrow);vector-effect:non-scaling-stroke}
      .green-route{fill:none;stroke:#48c99a;stroke-width:2;marker-end:url(#green-arrow);vector-effect:non-scaling-stroke}
      .steel-route{fill:none;stroke:#7890a3;stroke-width:1.8;marker-end:url(#steel-arrow);vector-effect:non-scaling-stroke}
      .dash{stroke-dasharray:7 7}
    </style>
  </defs>`;

function svg({ slug, title, desc, width, height, mobile = false, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${slug}-title ${slug}-desc">
  <title id="${slug}-title">${title}</title>
  <desc id="${slug}-desc">${desc}</desc>${defs}
  <rect width="${width}" height="${height}" rx="4" fill="#080919"/>
  <rect width="${width}" height="${height}" rx="4" fill="url(#grid)"/>
  ${body}
</svg>
`;
}

function wideHeader(title, label) {
  return `<text x="44" y="50" class="sans title">${title}</text>
  <text x="1236" y="49" text-anchor="end" class="mono label">${label}</text>
  <path d="M44 70H1236" class="rule"/>`;
}

function narrowHeader(title, label) {
  return `<text x="36" y="54" class="sans m-title">${title}</text>
  <text x="36" y="91" class="mono m-label">${label}</text>
  <path d="M36 112H724" class="rule"/>`;
}

function writeDiagram(slug, desktop, mobile) {
  for (const [suffix, contents] of [['', desktop], ['-mobile', mobile]]) {
    const file = path.join(outDir, `${slug}${suffix}.svg`);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
        console.error(`generated diagram differs: ${path.relative(repoRoot, file)}`);
        process.exitCode = 1;
      }
    } else {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(file, contents);
    }
  }
}

const diagrams = [
  {
    slug: 'c1-required-component',
    title: 'C1 — requiredComponent',
    desc: 'A requiredComponent constraint asks whether at least one component of the declared type exists in the observed graph. Here the extractor finds zero pluginSurface components, so BCE emits exactly one violation and blocks.',
    desktop: `${wideHeader('C1 — require a real component', 'OBSERVED COMPONENT SET')}
      <text x="44" y="108" class="sans heading">Contract</text>
      <rect x="44" y="130" width="328" height="180" rx="4" class="node cyan-node"/>
      <text x="68" y="166" class="mono label cyan">ENGINEERINGBLUEPRINT</text>
      <text x="68" y="204" class="mono code">type: requiredComponent</text>
      <text x="68" y="237" class="mono code">component: pluginSurface</text>
      <text x="68" y="278" class="sans small">At least one must exist.</text>
      <path d="M372 220H454" class="route"/>
      <text x="478" y="108" class="sans heading">Observed graph</text>
      <rect x="478" y="130" width="332" height="180" rx="4" class="node"/>
      <text x="502" y="166" class="mono label">AST EXTRACTION</text>
      <text x="502" y="211" class="mono code">pluginSurface count</text>
      <text x="502" y="260" class="mono title red">0</text>
      <text x="548" y="260" class="sans body">found in scanned scope</text>
      <path d="M810 220H892" class="red-route"/>
      <text x="916" y="108" class="sans heading">Deterministic verdict</text>
      <rect x="916" y="130" width="320" height="180" rx="4" class="node red-node"/>
      <text x="940" y="168" class="mono label red">1 · BLOCK</text>
      <text x="940" y="207" class="mono code">component: pluginSurface</text>
      <text x="940" y="240" class="sans small">observed: no component found</text>
      <text x="940" y="273" class="sans small red">exactly one C1 violation</text>
      <path d="M44 352H1236" class="rule"/>
      <text x="44" y="394" class="sans body">C1 measures presence, not file count or naming intent.</text>
      <text x="1236" y="394" text-anchor="end" class="mono small">zero → one violation</text>`,
    mobile: `${narrowHeader('C1 — require a real component', 'REQUIREDCOMPONENT')}
      <text x="36" y="157" class="sans m-heading">Contract</text>
      <rect x="36" y="178" width="688" height="170" rx="4" class="node cyan-node"/>
      <text x="62" y="218" class="mono m-label cyan">ENGINEERINGBLUEPRINT</text>
      <text x="62" y="264" class="mono m-code">component: pluginSurface</text>
      <text x="62" y="310" class="sans m-small">At least one must exist.</text>
      <path d="M380 348V400" class="route"/>
      <text x="36" y="447" class="sans m-heading">Observed graph</text>
      <rect x="36" y="468" width="688" height="154" rx="4" class="node"/>
      <text x="62" y="514" class="mono m-code">pluginSurface count</text>
      <text x="62" y="574" class="mono m-title red">0</text>
      <text x="106" y="574" class="sans m-body">found in scanned scope</text>
      <path d="M380 622V674" class="red-route"/>
      <text x="36" y="721" class="sans m-heading">Deterministic verdict</text>
      <rect x="36" y="742" width="688" height="172" rx="4" class="node red-node"/>
      <text x="62" y="788" class="mono m-label red">1 · BLOCK</text>
      <text x="62" y="834" class="mono m-code">no pluginSurface found</text>
      <text x="62" y="878" class="sans m-small">Zero produces exactly one C1 violation.</text>`,
  },
  {
    slug: 'c2-required-dependency',
    title: 'C2 — requiredDependency',
    desc: 'A requiredDependency constraint checks every target component for a governed outgoing edge. The plugin surface exists but has no provides edge, so BCE names the component and blocks. Zero target components also fail closed rather than passing vacuously.',
    desktop: `${wideHeader('C2 — require the governed edge', 'OBSERVED COMPONENTS + EDGES')}
      <rect x="44" y="118" width="332" height="220" rx="4" class="node cyan-node"/>
      <text x="68" y="156" class="mono label cyan">CONTRACT</text>
      <text x="68" y="196" class="mono code">type: requiredDependency</text>
      <text x="68" y="229" class="mono code">component: pluginSurface</text>
      <text x="68" y="262" class="mono code">edge: provides</text>
      <text x="68" y="307" class="sans small">Every target needs an edge.</text>
      <path d="M376 228H446" class="route"/>
      <rect x="470" y="118" width="358" height="220" rx="4" class="node"/>
      <text x="494" y="156" class="mono label">OBSERVED GRAPH</text>
      <rect x="494" y="181" width="310" height="66" rx="4" class="node cyan-node"/>
      <text x="514" y="221" class="mono code">extension:greeting.plugin</text>
      <path d="M649 247V291" stroke="#f05c67" stroke-width="2" stroke-dasharray="6 6" class="dash"/>
      <text x="669" y="281" class="mono small red">no provides edge</text>
      <path d="M828 228H898" class="red-route"/>
      <rect x="922" y="118" width="314" height="220" rx="4" class="node red-node"/>
      <text x="946" y="156" class="mono label red">1 · BLOCK</text>
      <text x="946" y="198" class="mono code">greeting.plugin</text>
      <text x="946" y="231" class="sans small">observed: no provides edge</text>
      <text x="946" y="264" class="sans small">expected: governed registration</text>
      <text x="946" y="307" class="mono small red">file + line anchored</text>
      <path d="M44 376H1236" class="rule"/>
      <text x="44" y="418" class="sans body">No target component is also RED: C2 never passes vacuously.</text>
      <text x="1236" y="418" text-anchor="end" class="mono small">each missing edge → violation</text>`,
    mobile: `${narrowHeader('C2 — require the governed edge', 'REQUIREDDEPENDENCY')}
      <rect x="36" y="148" width="688" height="190" rx="4" class="node cyan-node"/>
      <text x="62" y="192" class="mono m-label cyan">CONTRACT</text>
      <text x="62" y="238" class="mono m-code">pluginSurface → provides</text>
      <text x="62" y="292" class="sans m-small">Every target needs the governed edge.</text>
      <path d="M380 338V390" class="route"/>
      <rect x="36" y="412" width="688" height="208" rx="4" class="node"/>
      <text x="62" y="456" class="mono m-label">OBSERVED GRAPH</text>
      <rect x="62" y="484" width="636" height="70" rx="4" class="node cyan-node"/>
      <text x="86" y="528" class="mono m-code">extension:greeting.plugin</text>
      <text x="62" y="592" class="mono m-small red">no provides edge</text>
      <path d="M380 620V672" class="red-route"/>
      <rect x="36" y="694" width="688" height="190" rx="4" class="node red-node"/>
      <text x="62" y="740" class="mono m-label red">1 · BLOCK</text>
      <text x="62" y="786" class="mono m-code">missing governed registration</text>
      <text x="62" y="836" class="sans m-small">Zero targets also fail closed.</text>`,
  },
  {
    slug: 'c3-forbidden-dependency',
    title: 'C3 — forbiddenDependency',
    desc: 'A forbiddenDependency constraint checks observed import edges. An import from greeting.plugin to axios matches the prohibited destination and produces one exact violation at source line 16. Each matching edge is its own violation.',
    desktop: `${wideHeader('C3 — reject a forbidden import edge', 'OBSERVED IMPORT EDGES')}
      <rect x="44" y="118" width="322" height="224" rx="4" class="node cyan-node"/>
      <text x="68" y="156" class="mono label cyan">CONTRACT</text>
      <text x="68" y="198" class="mono code">type: forbiddenDependency</text>
      <text x="68" y="231" class="mono code">from: *</text>
      <text x="68" y="264" class="mono code">to: axios</text>
      <text x="68" y="309" class="sans small">Any matching import is drift.</text>
      <path d="M366 230H436" class="route"/>
      <rect x="460" y="118" width="390" height="224" rx="4" class="node"/>
      <text x="484" y="156" class="mono label">OBSERVED GRAPH</text>
      <rect x="484" y="181" width="232" height="62" rx="4" class="node cyan-node"/>
      <text x="504" y="219" class="mono code">greeting.plugin</text>
      <path d="M716 212H798V263" class="red-route"/>
      <rect x="770" y="263" width="56" height="52" rx="4" class="node red-node"/>
      <text x="798" y="295" text-anchor="middle" class="mono code red">axios</text>
      <text x="484" y="302" class="mono small red">src/greeting.plugin.ts#L16</text>
      <path d="M850 230H920" class="red-route"/>
      <rect x="944" y="118" width="292" height="224" rx="4" class="node red-node"/>
      <text x="968" y="156" class="mono label red">1 · BLOCK</text>
      <text x="968" y="198" class="mono code">no-direct-http-client</text>
      <text x="968" y="233" class="mono small">greeting.plugin → axios</text>
      <text x="968" y="268" class="mono small">line 16</text>
      <text x="968" y="309" class="sans small red">one hit · one violation</text>
      <path d="M44 380H1236" class="rule"/>
      <text x="44" y="422" class="sans body">Optional scope paths narrow importers; they never widen the allowed destination.</text>`,
    mobile: `${narrowHeader('C3 — reject a forbidden import', 'FORBIDDENDEPENDENCY')}
      <rect x="36" y="148" width="688" height="178" rx="4" class="node cyan-node"/>
      <text x="62" y="192" class="mono m-label cyan">CONTRACT</text>
      <text x="62" y="238" class="mono m-code">from: *   →   to: axios</text>
      <text x="62" y="286" class="sans m-small">Any matching import is drift.</text>
      <path d="M380 326V378" class="route"/>
      <rect x="36" y="400" width="688" height="218" rx="4" class="node"/>
      <text x="62" y="444" class="mono m-label">OBSERVED EDGE</text>
      <rect x="62" y="472" width="382" height="68" rx="4" class="node cyan-node"/>
      <text x="84" y="514" class="mono m-code">greeting.plugin</text>
      <path d="M444 506H584" class="red-route"/>
      <text x="612" y="514" class="mono m-code red">axios</text>
      <text x="62" y="584" class="mono m-small red">src/greeting.plugin.ts#L16</text>
      <path d="M380 618V670" class="red-route"/>
      <rect x="36" y="692" width="688" height="190" rx="4" class="node red-node"/>
      <text x="62" y="738" class="mono m-label red">1 · BLOCK</text>
      <text x="62" y="784" class="mono m-code">no-direct-http-client</text>
      <text x="62" y="834" class="sans m-small">Each matching edge is one violation.</text>`,
  },
  {
    slug: 'c4-forbidden-path',
    title: 'C4 — forbiddenPath',
    desc: 'A forbiddenPath constraint compares extracted component paths with a prohibited glob. An extracted pluginSurface under src/legacy matches the glob and blocks. A raw file that extracts no component is outside C4 and belongs to forbiddenFile instead.',
    desktop: `${wideHeader('C4 — keep components out of a path', 'EXTRACTED COMPONENT PATHS')}
      <rect x="44" y="118" width="324" height="224" rx="4" class="node cyan-node"/>
      <text x="68" y="156" class="mono label cyan">CONTRACT</text>
      <text x="68" y="198" class="mono code">type: forbiddenPath</text>
      <text x="68" y="231" class="mono code">path: src/legacy/**</text>
      <text x="68" y="276" class="sans small">Matches component paths.</text>
      <text x="68" y="309" class="sans small steel">Not the raw file set.</text>
      <path d="M368 230H438" class="route"/>
      <rect x="462" y="118" width="388" height="224" rx="4" class="node"/>
      <text x="486" y="156" class="mono label">OBSERVED COMPONENT</text>
      <rect x="486" y="181" width="340" height="70" rx="4" class="node red-node"/>
      <text x="508" y="210" class="mono code">extension:legacy.plugin</text>
      <text x="508" y="237" class="mono small red">src/legacy/legacy.plugin.ts</text>
      <text x="486" y="297" class="mono small red">path glob matched</text>
      <path d="M850 230H920" class="red-route"/>
      <rect x="944" y="118" width="292" height="224" rx="4" class="node red-node"/>
      <text x="968" y="156" class="mono label red">1 · BLOCK</text>
      <text x="968" y="198" class="mono code">legacy.plugin</text>
      <text x="968" y="233" class="sans small">observed: component in path</text>
      <text x="968" y="268" class="sans small">expected: outside legacy</text>
      <text x="968" y="309" class="mono small red">one component · one hit</text>
      <path d="M44 380H1236" class="rule"/>
      <text x="44" y="422" class="sans body">Need to ban every raw file? Use C5 forbiddenFile; C4 only sees extracted components.</text>`,
    mobile: `${narrowHeader('C4 — keep components out', 'FORBIDDENPATH')}
      <rect x="36" y="148" width="688" height="178" rx="4" class="node cyan-node"/>
      <text x="62" y="192" class="mono m-label cyan">CONTRACT</text>
      <text x="62" y="238" class="mono m-code">path: src/legacy/**</text>
      <text x="62" y="286" class="sans m-small">Checks extracted component paths.</text>
      <path d="M380 326V378" class="route"/>
      <rect x="36" y="400" width="688" height="220" rx="4" class="node"/>
      <text x="62" y="444" class="mono m-label">OBSERVED COMPONENT</text>
      <rect x="62" y="472" width="636" height="92" rx="4" class="node red-node"/>
      <text x="86" y="510" class="mono m-code">extension:legacy.plugin</text>
      <text x="86" y="544" class="mono m-small red">src/legacy/legacy.plugin.ts</text>
      <text x="62" y="596" class="mono m-small red">path glob matched</text>
      <path d="M380 620V672" class="red-route"/>
      <rect x="36" y="694" width="688" height="204" rx="4" class="node red-node"/>
      <text x="62" y="740" class="mono m-label red">1 · BLOCK</text>
      <text x="62" y="786" class="mono m-code">component is in legacy path</text>
      <text x="62" y="840" class="sans m-small">Raw files with no component use C5.</text>`,
  },
  {
    slug: 'source-to-verdict',
    title: 'From repository bytes to one verdict',
    desc: 'BCE scans a pinned or live repository surface, applies the selected extractor profile, records an observed graph and coverage envelope, evaluates the human-owned blueprint, and emits both a deterministic report and process exit code.',
    desktop: `${wideHeader('From repository bytes to one verdict', 'ONE ENGINE PATH')}
      <rect x="44" y="126" width="210" height="116" rx="4" class="node"/>
      <text x="68" y="164" class="mono label">REPOSITORY</text>
      <text x="68" y="202" class="mono code">source files</text>
      <text x="68" y="226" class="sans small">pinned or live tree</text>
      <path d="M254 184H310" class="route"/>
      <rect x="334" y="126" width="210" height="116" rx="4" class="node cyan-node"/>
      <text x="358" y="164" class="mono label cyan">EXTRACT</text>
      <text x="358" y="202" class="mono code">profile + scope</text>
      <text x="358" y="226" class="sans small">AST or observation</text>
      <path d="M544 184H600" class="route"/>
      <rect x="624" y="104" width="246" height="160" rx="4" class="node"/>
      <text x="648" y="142" class="mono label">OBSERVED FACTS</text>
      <text x="648" y="180" class="mono code">architecture graph</text>
      <text x="648" y="213" class="mono code">coverage envelope</text>
      <text x="648" y="241" class="sans small">nodes · edges · file anchors</text>
      <path d="M870 184H926" class="route"/>
      <rect x="950" y="126" width="286" height="116" rx="4" class="node cyan-node"/>
      <text x="974" y="164" class="mono label cyan">EVALUATE</text>
      <text x="974" y="202" class="mono code">EngineeringBlueprint</text>
      <text x="974" y="226" class="sans small">C1–C8 + explicit skips</text>
      <path d="M1093 242V310" class="route"/>
      <rect x="842" y="332" width="394" height="96" rx="4" class="node green-node"/>
      <text x="866" y="368" class="mono label green">OUTPUT</text>
      <text x="866" y="402" class="mono code">compliance report + exit 0 / 1 / 2</text>
      <path d="M44 380H790" class="rule"/>
      <text x="44" y="414" class="sans body">CLI, Action, and MCP call this same path.</text>`,
    mobile: `${narrowHeader('From source to verdict', 'ONE ENGINE PATH')}
      <rect x="36" y="146" width="688" height="120" rx="4" class="node"/>
      <text x="62" y="190" class="mono m-label">REPOSITORY</text>
      <text x="62" y="232" class="mono m-code">source files · pinned or live</text>
      <path d="M380 266V310" class="route"/>
      <rect x="36" y="332" width="688" height="120" rx="4" class="node cyan-node"/>
      <text x="62" y="376" class="mono m-label cyan">EXTRACT</text>
      <text x="62" y="418" class="mono m-code">profile + resolved scope</text>
      <path d="M380 452V496" class="route"/>
      <rect x="36" y="518" width="688" height="144" rx="4" class="node"/>
      <text x="62" y="562" class="mono m-label">OBSERVED FACTS</text>
      <text x="62" y="606" class="mono m-code">graph + coverage envelope</text>
      <text x="62" y="640" class="sans m-small">nodes · edges · file anchors</text>
      <path d="M380 662V706" class="route"/>
      <rect x="36" y="728" width="688" height="126" rx="4" class="node cyan-node"/>
      <text x="62" y="772" class="mono m-label cyan">EVALUATE BLUEPRINT</text>
      <text x="62" y="816" class="mono m-code">C1–C8 + explicit skips</text>
      <path d="M380 854V898" class="route"/>
      <rect x="36" y="920" width="688" height="124" rx="4" class="node green-node"/>
      <text x="62" y="964" class="mono m-label green">OUTPUT</text>
      <text x="62" y="1008" class="mono m-code">report + exit 0 / 1 / 2</text>`,
  },
  {
    slug: 'exit-code-contract',
    title: 'Three exits preserve three meanings',
    desc: 'BCE exit zero means a successful command, exit one means a graded violation or user error, and exit two means the engine refused because it could not honestly grade. Both one and two block an enforced merge. Advisory mode only makes a graded violation non-blocking; it never hides a refusal.',
    desktop: `${wideHeader('Three exits preserve three meanings', 'PROCESS CONTRACT')}
      <rect x="44" y="114" width="322" height="228" rx="4" class="node green-node"/>
      <text x="68" y="158" class="mono title green">0</text>
      <text x="118" y="156" class="sans heading">successful command</text>
      <text x="68" y="204" class="mono code">GREEN · graded pass</text>
      <text x="68" y="244" class="sans small">merge may proceed</text>
      <text x="68" y="292" class="sans small steel">Advisory RED also exits 0,</text>
      <text x="68" y="316" class="sans small steel">with its verdict still visible.</text>
      <rect x="479" y="114" width="322" height="228" rx="4" class="node red-node"/>
      <text x="503" y="158" class="mono title red">1</text>
      <text x="553" y="156" class="sans heading">red or user error</text>
      <text x="503" y="204" class="mono code">graded violation</text>
      <text x="503" y="244" class="sans small">exact constraint + evidence</text>
      <text x="503" y="292" class="mono label red">BLOCKS ENFORCED MERGE</text>
      <rect x="914" y="114" width="322" height="228" rx="4" class="node red-node"/>
      <text x="938" y="158" class="mono title red">2</text>
      <text x="988" y="156" class="sans heading">fail-closed refusal</text>
      <text x="938" y="204" class="mono code">not honestly graded</text>
      <text x="938" y="244" class="sans small">empty scan · unsupported input</text>
      <text x="938" y="292" class="mono label red">BLOCKS IN EVERY MODE</text>
      <path d="M44 382H1236" class="rule"/>
      <text x="44" y="424" class="sans body">A refusal is never converted into a pass.</text>
      <text x="1236" y="424" text-anchor="end" class="mono small">outcome: pass · violation · refusal</text>`,
    mobile: `${narrowHeader('Three exits, three meanings', 'PROCESS CONTRACT')}
      <rect x="36" y="148" width="688" height="202" rx="4" class="node green-node"/>
      <text x="62" y="202" class="mono m-title green">0</text>
      <text x="120" y="200" class="sans m-heading">successful command</text>
      <text x="62" y="250" class="mono m-code">GREEN · merge may proceed</text>
      <text x="62" y="306" class="sans m-small steel">Advisory RED remains visibly RED.</text>
      <rect x="36" y="382" width="688" height="190" rx="4" class="node red-node"/>
      <text x="62" y="436" class="mono m-title red">1</text>
      <text x="120" y="434" class="sans m-heading">graded violation</text>
      <text x="62" y="484" class="mono m-code">exact constraint + evidence</text>
      <text x="62" y="536" class="mono m-label red">BLOCKS ENFORCED MERGE</text>
      <rect x="36" y="604" width="688" height="210" rx="4" class="node red-node"/>
      <text x="62" y="658" class="mono m-title red">2</text>
      <text x="120" y="656" class="sans m-heading">fail-closed refusal</text>
      <text x="62" y="706" class="mono m-code">the engine could not grade</text>
      <text x="62" y="758" class="mono m-label red">BLOCKS IN EVERY MODE</text>
      <text x="36" y="864" class="sans m-body">A refusal is never converted into a pass.</text>`,
  },
  {
    slug: 'deterministic-report',
    title: 'Same inputs produce the same report bytes',
    desc: 'The exact EngineeringBlueprint and observed architecture graph enter the deterministic evaluator. Violations are sorted, object keys are canonicalized, and the result is one byte-identical compliance report with a content-addressed graph reference.',
    desktop: `${wideHeader('Same inputs produce the same report bytes', 'DETERMINISTIC REPORT')}
      <rect x="44" y="122" width="260" height="116" rx="4" class="node cyan-node"/>
      <text x="68" y="160" class="mono label cyan">INPUT A</text>
      <text x="68" y="198" class="mono code">EngineeringBlueprint</text>
      <text x="68" y="222" class="sans small">exact reviewed bytes</text>
      <rect x="44" y="278" width="260" height="116" rx="4" class="node"/>
      <text x="68" y="316" class="mono label">INPUT B</text>
      <text x="68" y="354" class="mono code">architecture graph</text>
      <text x="68" y="378" class="sans small">exact observed bytes</text>
      <path d="M304 180H390V236" class="route"/>
      <path d="M304 336H390V280" class="route"/>
      <rect x="414" y="164" width="286" height="192" rx="4" class="node cyan-node"/>
      <text x="438" y="204" class="mono label cyan">PURE EVALUATION</text>
      <text x="438" y="244" class="mono code">evaluate constraints</text>
      <text x="438" y="277" class="mono code">sort violations</text>
      <text x="438" y="310" class="mono code">stable serialization</text>
      <path d="M700 260H786" class="green-route"/>
      <rect x="810" y="122" width="426" height="272" rx="4" class="node green-node"/>
      <text x="834" y="162" class="mono label green">COMPLIANCE REPORT</text>
      <text x="834" y="202" class="mono code">score · verdict · violations</text>
      <text x="834" y="235" class="mono code">coverage · summary</text>
      <text x="834" y="278" class="mono small">architecture-graph.json</text>
      <text x="834" y="306" class="mono small green">@sha256:&lt;graph hash&gt;</text>
      <path d="M834 330H1212" class="rule"/>
      <text x="834" y="365" class="sans small">repeat run → byte-identical output</text>
      <text x="44" y="440" class="sans body">No clock, random seed, or insertion order changes the report.</text>`,
    mobile: `${narrowHeader('Same inputs, same report bytes', 'DETERMINISTIC REPORT')}
      <rect x="36" y="148" width="320" height="166" rx="4" class="node cyan-node"/>
      <text x="62" y="194" class="mono m-label cyan">INPUT A</text>
      <text x="62" y="242" class="mono m-code">blueprint bytes</text>
      <text x="62" y="282" class="sans m-small">reviewed contract</text>
      <rect x="404" y="148" width="320" height="166" rx="4" class="node"/>
      <text x="430" y="194" class="mono m-label">INPUT B</text>
      <text x="430" y="242" class="mono m-code">graph bytes</text>
      <text x="430" y="282" class="sans m-small">observed facts</text>
      <path d="M196 314V364H340" class="route"/>
      <path d="M564 314V364H420" class="route"/>
      <rect x="36" y="388" width="688" height="184" rx="4" class="node cyan-node"/>
      <text x="62" y="434" class="mono m-label cyan">PURE EVALUATION</text>
      <text x="62" y="482" class="mono m-code">evaluate → sort → stable serialize</text>
      <text x="62" y="530" class="sans m-small">No clock or random seed enters.</text>
      <path d="M380 572V624" class="green-route"/>
      <rect x="36" y="646" width="688" height="234" rx="4" class="node green-node"/>
      <text x="62" y="692" class="mono m-label green">COMPLIANCE REPORT</text>
      <text x="62" y="740" class="mono m-code">score · verdict · violations</text>
      <text x="62" y="784" class="mono m-code">coverage · graph hash</text>
      <text x="62" y="840" class="sans m-small">Repeat run → byte-identical output.</text>`,
  },
  {
    slug: 'evidence-hash-chain',
    title: 'Each evidence record commits to its ancestry',
    desc: 'A compliance report and previous hash produce an evidence record. Each next record includes the previous record hash. Editing an earlier record breaks its own hash, while rehashing or removing it breaks the next link. Producer identity is a separate signature layer.',
    desktop: `${wideHeader('Each record commits to its ancestry', 'TAMPER-EVIDENT EVIDENCE')}
      <rect x="44" y="126" width="232" height="112" rx="4" class="node cyan-node"/>
      <text x="68" y="164" class="mono label cyan">GENESIS</text>
      <text x="68" y="202" class="mono code">previousHash: 00…00</text>
      <path d="M276 182H344" class="route"/>
      <rect x="368" y="106" width="244" height="152" rx="4" class="node"/>
      <text x="392" y="144" class="mono label">RECORD 001</text>
      <text x="392" y="182" class="mono code">report hash A</text>
      <text x="392" y="215" class="mono code">hash: 81…c2</text>
      <path d="M612 182H680" class="route"/>
      <rect x="704" y="106" width="244" height="152" rx="4" class="node"/>
      <text x="728" y="144" class="mono label">RECORD 002</text>
      <text x="728" y="182" class="mono code">prev: 81…c2</text>
      <text x="728" y="215" class="mono code">hash: a4…19</text>
      <path d="M948 182H1016" class="route"/>
      <rect x="1040" y="106" width="196" height="152" rx="4" class="node green-node"/>
      <text x="1064" y="144" class="mono label green">RECORD 003</text>
      <text x="1064" y="182" class="mono code">prev: a4…19</text>
      <text x="1064" y="215" class="mono code">chain intact</text>
      <path d="M488 258V320" class="red-route"/>
      <rect x="300" y="342" width="376" height="94" rx="4" class="node red-node"/>
      <text x="324" y="378" class="mono label red">EDIT OR EXCISE RECORD 001</text>
      <text x="324" y="410" class="sans small">its hash fails; rehashing breaks the next link</text>
      <rect x="760" y="342" width="476" height="94" rx="4" class="node"/>
      <text x="784" y="378" class="mono label">SEPARATE IDENTITY LAYER</text>
      <text x="784" y="410" class="sans small">integrity chain ≠ producer authentication</text>`,
    mobile: `${narrowHeader('Each record commits to its ancestry', 'TAMPER-EVIDENT EVIDENCE')}
      <rect x="36" y="148" width="688" height="118" rx="4" class="node cyan-node"/>
      <text x="62" y="194" class="mono m-label cyan">GENESIS</text>
      <text x="62" y="236" class="mono m-code">previousHash: 00…00</text>
      <path d="M380 266V310" class="route"/>
      <rect x="36" y="332" width="688" height="138" rx="4" class="node"/>
      <text x="62" y="378" class="mono m-label">RECORD 001</text>
      <text x="62" y="422" class="mono m-code">report A · hash 81…c2</text>
      <path d="M380 470V514" class="route"/>
      <rect x="36" y="536" width="688" height="138" rx="4" class="node"/>
      <text x="62" y="582" class="mono m-label">RECORD 002</text>
      <text x="62" y="626" class="mono m-code">prev 81…c2 · hash a4…19</text>
      <path d="M380 674V718" class="route"/>
      <rect x="36" y="740" width="688" height="138" rx="4" class="node green-node"/>
      <text x="62" y="786" class="mono m-label green">RECORD 003</text>
      <text x="62" y="830" class="mono m-code">prev a4…19 · chain intact</text>
      <rect x="36" y="914" width="688" height="150" rx="4" class="node red-node"/>
      <text x="62" y="962" class="mono m-label red">TAMPER OR EXCISE</text>
      <text x="62" y="1008" class="sans m-small">Its hash or the next link fails.</text>
      <text x="62" y="1042" class="sans m-small steel">Producer identity is a separate signature.</text>`,
  },
  {
    slug: 'ai-review-authority',
    title: 'AI drafts; deterministic checks and humans govern',
    desc: 'Bounded disclosed repository context is sent to the registered assistant, whose output remains an untrusted draft in quarantine. BCE deterministically validates and tests the exact candidate, emits an immutable review packet, and requires a bound human GitHub review before the attended ratification ceremony. The assistant has no approval or policy-write path.',
    desktop: `${wideHeader('AI drafts; deterministic checks and humans govern', 'AUTHORITY BOUNDARY')}
      <rect x="44" y="120" width="210" height="122" rx="4" class="node"/>
      <text x="68" y="158" class="mono label">BOUNDED CONTEXT</text>
      <text x="68" y="196" class="mono code">disclosure manifest</text>
      <text x="68" y="220" class="sans small">previewed before call</text>
      <path d="M254 181H306" class="route"/>
      <rect x="330" y="120" width="210" height="122" rx="4" class="node cyan-node"/>
      <text x="354" y="158" class="mono label cyan">ASSISTANT</text>
      <text x="354" y="196" class="mono code">untrusted draft plan</text>
      <text x="354" y="220" class="sans small">quarantine only</text>
      <path d="M540 181H592" class="route"/>
      <rect x="616" y="96" width="260" height="170" rx="4" class="node cyan-node"/>
      <text x="640" y="136" class="mono label cyan">DETERMINISTIC BCE</text>
      <text x="640" y="174" class="mono code">validate · scope · gate</text>
      <text x="640" y="207" class="mono code">teeth · semantic diff</text>
      <text x="640" y="240" class="sans small">same exact candidate bytes</text>
      <path d="M876 181H928" class="route"/>
      <rect x="952" y="120" width="284" height="122" rx="4" class="node"/>
      <text x="976" y="158" class="mono label">REVIEW PACKET</text>
      <text x="976" y="196" class="mono code">immutable + digest-bound</text>
      <text x="976" y="220" class="sans small">reviewable, not approved</text>
      <path d="M1094 242V302" class="steel-route"/>
      <rect x="756" y="324" width="480" height="108" rx="4" class="node green-node"/>
      <text x="780" y="362" class="mono label green">HUMAN REVIEW + ATTENDED RATIFY</text>
      <text x="780" y="400" class="mono code">authenticated decision → policy ceremony</text>
      <path d="M434 242V356H698" class="red-route dash"/>
      <text x="44" y="366" class="mono label red">NO AUTHORITY PATH</text>
      <text x="44" y="400" class="sans body">Assistant cannot approve, ratify, amend, graduate, or grow baseline.</text>`,
    mobile: `${narrowHeader('AI drafts; humans govern', 'AUTHORITY BOUNDARY')}
      <rect x="36" y="148" width="688" height="126" rx="4" class="node"/>
      <text x="62" y="194" class="mono m-label">BOUNDED CONTEXT</text>
      <text x="62" y="238" class="mono m-code">previewed disclosure manifest</text>
      <path d="M380 274V316" class="route"/>
      <rect x="36" y="338" width="688" height="126" rx="4" class="node cyan-node"/>
      <text x="62" y="384" class="mono m-label cyan">ASSISTANT</text>
      <text x="62" y="428" class="mono m-code">untrusted draft · quarantine only</text>
      <path d="M380 464V506" class="route"/>
      <rect x="36" y="528" width="688" height="164" rx="4" class="node cyan-node"/>
      <text x="62" y="574" class="mono m-label cyan">DETERMINISTIC BCE</text>
      <text x="62" y="620" class="mono m-code">validate · gate · teeth · diff</text>
      <text x="62" y="660" class="sans m-small">Exact candidate bytes.</text>
      <path d="M380 692V734" class="route"/>
      <rect x="36" y="756" width="688" height="126" rx="4" class="node"/>
      <text x="62" y="802" class="mono m-label">IMMUTABLE REVIEW PACKET</text>
      <text x="62" y="846" class="mono m-code">reviewable · not approved</text>
      <path d="M380 882V924" class="steel-route"/>
      <rect x="36" y="946" width="688" height="154" rx="4" class="node green-node"/>
      <text x="62" y="992" class="mono m-label green">HUMAN + ATTENDED CEREMONY</text>
      <text x="62" y="1038" class="mono m-code">bound review → ratify</text>
      <text x="62" y="1076" class="sans m-small red">AI has no approval or policy-write path.</text>`,
  },
  {
    slug: 'brownfield-adoption',
    title: 'Adopt today without hiding existing debt',
    desc: 'Advisory mode reveals all current drift without blocking. A reviewed shrink-only baseline partitions old debt from new drift. Enforced mode blocks every new violation while the known baseline decreases from 75 to 38 to zero. Downgrading posture requires a visible reviewed rationale.',
    desktop: `${wideHeader('Adopt today without hiding existing debt', 'COMMITTED POLICY RATCHET')}
      <rect x="44" y="118" width="294" height="190" rx="4" class="node cyan-node"/>
      <text x="68" y="158" class="mono label cyan">ADVISORY</text>
      <text x="68" y="200" class="mono title">75</text>
      <text x="120" y="200" class="sans body">violations visible</text>
      <text x="68" y="239" class="sans small">graded RED · exit 0</text>
      <text x="68" y="273" class="sans small steel">mode is committed</text>
      <path d="M338 213H420" class="route"/>
      <rect x="444" y="96" width="392" height="234" rx="4" class="node"/>
      <text x="468" y="136" class="mono label">SHRINK-ONLY BASELINE</text>
      <text x="468" y="178" class="mono code">known debt   75 → 38 → 0</text>
      <path d="M468 202H794" stroke="#48c99a" stroke-width="7"/>
      <circle cx="468" cy="202" r="8" fill="#f05c67"/>
      <circle cx="632" cy="202" r="8" fill="#61c9ef"/>
      <circle cx="794" cy="202" r="8" fill="#48c99a"/>
      <text x="468" y="250" class="mono small red">NEW → blocks</text>
      <text x="468" y="282" class="mono small">BASELINED → visible, non-blocking</text>
      <text x="468" y="308" class="sans small steel">baseline cannot grow in place</text>
      <path d="M836 213H918" class="green-route"/>
      <rect x="942" y="118" width="294" height="190" rx="4" class="node green-node"/>
      <text x="966" y="158" class="mono label green">ENFORCED</text>
      <text x="966" y="200" class="mono title green">NEW → BLOCK</text>
      <text x="966" y="239" class="sans small">existing debt keeps shrinking</text>
      <text x="966" y="273" class="sans small">zero debt → full conformance</text>
      <path d="M1088 308V382H190V326" class="steel-route dash"/>
      <text x="640" y="374" text-anchor="middle" class="mono label steel">DOWNGRADE REQUIRES REVIEWED RATIONALE</text>
      <text x="640" y="422" text-anchor="middle" class="sans body">The grader never weakens; only the committed blocking posture changes.</text>`,
    mobile: `${narrowHeader('Adopt without hiding debt', 'COMMITTED POLICY RATCHET')}
      <rect x="36" y="148" width="688" height="180" rx="4" class="node cyan-node"/>
      <text x="62" y="194" class="mono m-label cyan">ADVISORY</text>
      <text x="62" y="248" class="mono m-title">75</text>
      <text x="116" y="248" class="sans m-body">violations visible</text>
      <text x="62" y="294" class="sans m-small">graded RED · intentionally non-blocking</text>
      <path d="M380 328V372" class="route"/>
      <rect x="36" y="394" width="688" height="242" rx="4" class="node"/>
      <text x="62" y="440" class="mono m-label">SHRINK-ONLY BASELINE</text>
      <text x="62" y="490" class="mono m-code">known debt   75 → 38 → 0</text>
      <path d="M62 524H668" stroke="#48c99a" stroke-width="8"/>
      <circle cx="62" cy="524" r="10" fill="#f05c67"/>
      <circle cx="365" cy="524" r="10" fill="#61c9ef"/>
      <circle cx="668" cy="524" r="10" fill="#48c99a"/>
      <text x="62" y="578" class="mono m-small red">NEW blocks</text>
      <text x="308" y="578" class="mono m-small">KNOWN stays visible</text>
      <text x="62" y="614" class="sans m-small steel">Cannot grow in place.</text>
      <path d="M380 636V680" class="green-route"/>
      <rect x="36" y="702" width="688" height="188" rx="4" class="node green-node"/>
      <text x="62" y="748" class="mono m-label green">ENFORCED</text>
      <text x="62" y="800" class="mono m-code green">NEW → BLOCK</text>
      <text x="62" y="850" class="sans m-small">Known debt keeps shrinking to zero.</text>
      <path d="M380 890V942" class="steel-route dash"/>
      <rect x="36" y="964" width="688" height="116" rx="4" class="node"/>
      <text x="62" y="1012" class="mono m-label steel">DOWNGRADE</text>
      <text x="62" y="1054" class="sans m-small">Requires visible reviewed rationale.</text>`,
  },
  {
    slug: 'first-win-recipes',
    title: 'Choose the architecture boundary that must hold',
    desc: 'Six packaged BCE source-candidate recipes branch from the boundary a maintainer needs to protect: extension registration, tenant route access, governed network egress, TypeScript module layering, Python module layering, or configuration widening. Each recipe executes one conforming tree and one planted drift tree through the candidate engine.',
    desktopHeight: 540,
    mobileHeight: 1180,
    desktop: `${wideHeader('Choose the boundary that must hold', 'V0.3 CANDIDATE · 6 RECIPES')}
      <rect x="44" y="170" width="220" height="118" rx="4" class="node cyan-node"/>
      <text x="68" y="210" class="mono label cyan">YOUR REPOSITORY</text>
      <text x="68" y="246" class="sans body">What cannot drift?</text>
      <text x="68" y="270" class="sans small">Pick one real proof.</text>
      <path d="M264 229H330V115H410" class="route"/>
      <path d="M330 179H410" class="route"/>
      <path d="M330 243H410" class="route"/>
      <path d="M330 307H410" class="route"/>
      <path d="M330 371H410" class="route"/>
      <path d="M330 435H410" class="route"/>
      <rect x="410" y="90" width="468" height="50" rx="4" class="node"/>
      <text x="430" y="121" class="mono code">extension-contract</text>
      <path d="M878 115H914" class="green-route"/>
      <rect x="914" y="90" width="322" height="50" rx="4" class="node green-node"/>
      <text x="934" y="121" class="mono label green">TS/JS · MATURE AST</text>
      <rect x="410" y="154" width="468" height="50" rx="4" class="node"/>
      <text x="430" y="185" class="mono code">tenant-route-guard</text>
      <path d="M878 179H914" class="green-route"/>
      <rect x="914" y="154" width="322" height="50" rx="4" class="node green-node"/>
      <text x="934" y="185" class="mono label green">NEXT.JS · MATURE AST</text>
      <rect x="410" y="218" width="468" height="50" rx="4" class="node"/>
      <text x="430" y="249" class="mono code">governed-egress</text>
      <path d="M878 243H914" class="green-route"/>
      <rect x="914" y="218" width="322" height="50" rx="4" class="node green-node"/>
      <text x="934" y="249" class="mono label green">TS/JS · MATURE AST</text>
      <rect x="410" y="282" width="468" height="50" rx="4" class="node cyan-node"/>
      <text x="430" y="313" class="mono code cyan">module-layering</text>
      <path d="M878 307H914" class="route"/>
      <rect x="914" y="282" width="322" height="50" rx="4" class="node cyan-node"/>
      <text x="934" y="313" class="mono label cyan">TS/JS · DIRECT GRAPH</text>
      <rect x="410" y="346" width="468" height="50" rx="4" class="node cyan-node"/>
      <text x="430" y="377" class="mono code cyan">python-module-layering</text>
      <path d="M878 371H914" class="route"/>
      <rect x="914" y="346" width="322" height="50" rx="4" class="node cyan-node"/>
      <text x="934" y="377" class="mono label cyan">PYTHON · DIRECT GRAPH</text>
      <rect x="410" y="410" width="468" height="50" rx="4" class="node"/>
      <text x="430" y="441" class="mono code">configuration-allowlist</text>
      <path d="M878 435H914" class="steel-route"/>
      <rect x="914" y="410" width="322" height="50" rx="4" class="node"/>
      <text x="934" y="441" class="mono label steel">CONFIG · REAL-SOURCE PAIR</text>
      <path d="M44 484H1236" class="rule"/>
      <text x="44" y="514" class="sans small">Every route executes: conforming tree → GREEN · planted drift → named RED.</text>`,
    mobile: `${narrowHeader('Choose what must hold', 'V0.3 CANDIDATE · 6 RECIPES')}
      <rect x="36" y="148" width="688" height="118" rx="4" class="node cyan-node"/>
      <text x="62" y="194" class="mono m-label cyan">YOUR REPOSITORY</text>
      <text x="62" y="238" class="sans m-body">What cannot drift?</text>
      <path d="M380 266V288H70V958" fill="none" stroke="#61c9ef" stroke-width="2.7" vector-effect="non-scaling-stroke"/>
      <path d="M70 338H110" class="route"/>
      <rect x="110" y="292" width="614" height="92" rx="4" class="node green-node"/>
      <text x="136" y="330" class="mono m-label green">TS/JS · MATURE AST</text>
      <text x="136" y="366" class="mono m-code">extension-contract</text>
      <path d="M70 458H110" class="route"/>
      <rect x="110" y="412" width="614" height="92" rx="4" class="node green-node"/>
      <text x="136" y="450" class="mono m-label green">NEXT.JS · MATURE AST</text>
      <text x="136" y="486" class="mono m-code">tenant-route-guard</text>
      <path d="M70 578H110" class="route"/>
      <rect x="110" y="532" width="614" height="92" rx="4" class="node green-node"/>
      <text x="136" y="570" class="mono m-label green">TS/JS · MATURE AST</text>
      <text x="136" y="606" class="mono m-code">governed-egress</text>
      <path d="M70 698H110" class="route"/>
      <rect x="110" y="652" width="614" height="92" rx="4" class="node cyan-node"/>
      <text x="136" y="690" class="mono m-label cyan">TS/JS · DIRECT GRAPH</text>
      <text x="136" y="726" class="mono m-code cyan">module-layering</text>
      <path d="M70 818H110" class="route"/>
      <rect x="110" y="772" width="614" height="92" rx="4" class="node cyan-node"/>
      <text x="136" y="810" class="mono m-label cyan">PYTHON · DIRECT GRAPH</text>
      <text x="136" y="846" class="mono m-code cyan">python-module-layering</text>
      <path d="M70 938H110" class="steel-route"/>
      <rect x="110" y="892" width="614" height="92" rx="4" class="node"/>
      <text x="136" y="930" class="mono m-label steel">CONFIG · REAL-SOURCE PAIR</text>
      <text x="136" y="966" class="mono m-code">configuration-allowlist</text>
      <rect x="36" y="1018" width="688" height="116" rx="4" class="node cyan-node"/>
      <text x="62" y="1058" class="mono m-label cyan">EACH RECIPE EXECUTES</text>
      <text x="62" y="1102" class="mono m-code"><tspan class="green">GREEN 100</tspan><tspan class="steel">  ·  </tspan><tspan class="red">NAMED RED</tspan></text>`,
  },
];

for (const diagram of diagrams) {
  writeDiagram(
    diagram.slug,
    svg({ slug: diagram.slug, title: diagram.title, desc: diagram.desc, width: 1280, height: diagram.desktopHeight ?? 480, body: diagram.desktop }),
    svg({ slug: `${diagram.slug}-mobile`, title: diagram.title, desc: diagram.desc, width: 760, height: diagram.mobileHeight ?? 1120, mobile: true, body: diagram.mobile }),
  );
}

if (!check) console.log(`generated ${diagrams.length * 2} SVG files in ${path.relative(repoRoot, outDir)}`);
