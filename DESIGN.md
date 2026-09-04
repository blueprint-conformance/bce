---
name: bce
description: Evidence-first developer-tool documentation built around the real conformance engine.
colors:
  engine-canvas: "#080919"
  engine-ink: "#e8ebed"
  engine-cyan: "#61c9ef"
  verdict-pass: "#48c99a"
  verdict-block: "#f05c67"
  muted-steel: "#7890a3"
  node-line: "#566274"
  docs-light-bg: "#ffffff"
  docs-light-fg: "#1b1f24"
  docs-accent: "#0b5fff"
  docs-dark-bg: "#101418"
  docs-dark-fg: "#e6e9ee"
typography:
  hero-display:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "43px"
    fontWeight: 760
    lineHeight: 1.16
    letterSpacing: "-1.2px"
  diagram-title:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.4px"
  diagram-label:
    fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "1px"
  diagram-mono:
    fontFamily: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace'
    fontSize: "18px"
    fontWeight: 450
    lineHeight: 1.4
    letterSpacing: "normal"
  docs-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  docs-code:
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
rounded:
  engine: "3px"
  node: "4px"
  docs: "6px"
  terminal: "8px"
spacing:
  xs: "0.25rem"
  sm: "0.75rem"
  md: "1rem"
  content-gutter: "1.25rem"
  section: "2rem"
  page-bottom: "4rem"
  diagram-inset: "32px"
components:
  engine-node:
    backgroundColor: "{colors.engine-canvas}"
    textColor: "{colors.engine-ink}"
    typography: "{typography.diagram-mono}"
    rounded: "{rounded.engine}"
    padding: "16px 24px"
  entry-node:
    backgroundColor: "{colors.engine-canvas}"
    textColor: "{colors.engine-cyan}"
    typography: "{typography.diagram-label}"
    rounded: "{rounded.node}"
    padding: "16px 24px"
  verdict-merge:
    backgroundColor: "{colors.engine-canvas}"
    textColor: "{colors.verdict-pass}"
    typography: "{typography.diagram-mono}"
    rounded: "{rounded.engine}"
    padding: "16px 24px"
  verdict-block:
    backgroundColor: "{colors.engine-canvas}"
    textColor: "{colors.verdict-block}"
    typography: "{typography.diagram-mono}"
    rounded: "{rounded.engine}"
    padding: "16px 24px"
  docs-code-block:
    backgroundColor: "#f5f7fa"
    textColor: "{colors.docs-light-fg}"
    typography: "{typography.docs-code}"
    rounded: "{rounded.docs}"
    padding: "0.85rem 1rem"
  terminal-replay:
    backgroundColor: "#0b1622"
    textColor: "#c9d5e1"
    typography: "{typography.docs-code}"
    rounded: "{rounded.terminal}"
    padding: "22px"
---

# Design System: bce

## Overview

**Creative North Star: "Architecture That Holds"**

bce presents itself as a real developer tool, not a campaign, a dashboard, or a research paper. The header leads with the user promise, then proves it with one recognizable pull-request moment: human-owned policy and an agent change enter the gate; an exact violation blocks the merge. Executable artifacts, literal commands, diagnostics, exit codes, and reproducible evidence carry the rest of the page.

The system pairs a dimensional deep-navy tool header with a compact, native documentation shell. It is precise, calm, and product-led: cyan identifies the blueprint and gate, green signals health, red blocks, and muted steel carries secondary context. Familiar developer-tool conventions are used without copying another product's identity.

**Key Characteristics:**

- One direct promise paired with one concrete product moment.
- Real labels, commands, verdicts, and diagnostics instead of metaphor or invented proof.
- Restrained depth, thin strokes, compact radii, native fonts, and no ornamental effects.
- Mechanism evidence first; efficacy limits and evidence provenance remain explicit.
- Purpose-built desktop and mobile diagrams with equivalent meaning.

## Colors

The engine palette is a restrained semantic system on one dark canvas; the documentation shell uses native light and dark neutrals so long-form reading feels at home on GitHub and the web.

### Primary

- **Engine Cyan:** Structural paths, entry surfaces, the lowercase wordmark, command prompts, and the primary diagram emphasis. It means “this is the active system path,” not “this is clickable.”

### Secondary

- **Verdict Green:** A conforming result and forward graduation to enforced mode.
- **Verdict Red:** A blocking result, exact violation, and code-correction return path. Red is intentionally scarce so one contradiction owns attention.

### Neutral

- **Engine Canvas:** The single, self-contained background for engine diagrams.
- **Engine Ink:** Primary copy and function labels on the engine canvas.
- **Muted Steel:** Governance paths, quiet labels, and secondary explanatory structure.
- **Node Line:** Default borders around non-semantic nodes.
- **Documentation Light and Dark:** The generated site swaps its reading background and foreground with `prefers-color-scheme`; it does not recolor the embedded engine assets.
- **Documentation Accent:** Links in the reading shell. It is distinct from engine cyan because navigation and graph structure have different jobs.

The terminal replay retains a slightly softer, terminal-specific palette: command cyan, output gray, pass green, error red, and one amber window control. Treat those as local syntax colors, not new brand accents.

**The Semantic Accent Rule.** Cyan describes the route, green permits, red refuses, and steel governs; never exchange these roles for variety.

**The One Canvas Rule.** Each explanatory SVG owns one uninterrupted tool canvas. The header may use its restrained navy depth gradient and blueprint grid; do not introduce glass, glow, shadow, or unrelated texture.

## Typography

**Display Font:** Native system sans, set firmly and compactly

**Body Font:** Native system sans (`-apple-system`, BlinkMacSystemFont, `Segoe UI`, Roboto, Helvetica, Arial)

**Label/Mono Font:** Native system monospace (`ui-monospace`, SFMono, Menlo, Consolas, Liberation Mono)

**Character:** A strong native sans makes the opening promise direct without turning it into a poster. The same family keeps prose and supporting labels familiar; monospace is reserved for executable names, commands, file paths, diagnostics, state labels, and exit codes.

### Hierarchy

- **Hero Display:** A tightly set sentence-case promise beside the pull-request panel. Desktop and mobile use the same native family at composition-specific sizes for legibility.
- **Diagram Title:** Bold system sans for short explanatory statements such as the adoption-ratchet heading.
- **Functional Label:** Compact, tracked sans or mono for ownership and state. Uppercase is permitted for graph labels such as `HUMAN REVIEW`; it is not a decorative eyebrow style.
- **Function / Diagnostic:** Monospace for `runGate()`, report stages, exact rules, edges, files, lines, commands, and `0 · MERGE` / `1 · BLOCK`.
- **Documentation Body:** Native sans at a relaxed reading rhythm. The generated site holds content to a `46rem` column; GitHub Markdown remains the authoritative public reading behavior.
- **Documentation Code:** Native monospace at a compact size with a comfortable line height and horizontal overflow rather than wrapping executable text.

**The Executable Type Rule.** If text can be copied into a shell, names a code symbol, or is emitted by the gate, set it in monospace; explanatory prose stays sans.

**The No Decorative Eyebrow Rule.** Tracked uppercase exists only when it conveys a functional role, state, or ownership boundary.

## Layout

The opening asset is a two-part product story on a `1280 × 420` desktop viewBox. The left half carries the bce mark, the promise “Architecture that holds while agents move fast,” one plain-language consequence, and the three supported surfaces. The right half is a compact pull-request check: a blueprint and agent change converge on the gate, which returns a named blocking diagnosis. The promise attracts attention; the product moment earns it.

The README uses responsive `<picture>` elements at a `600px` threshold. The fallback `<img>` is the desktop asset; one preceding `<source media="(max-width: 600px)">` selects a separately composed mobile SVG. Mobile is not a scale-down: the `760 × 1030` header stacks the promise above a larger version of the same pull-request check so the blueprint, agent change, gate, diagnosis, file, line, and exit code remain legible. The adoption diagram likewise moves from a `1280 × 330` horizontal progression to a `760 × 790` vertical progression. Meaning and sequence must remain equivalent across variants even when geometry changes.

On the generated docs site, the first landing hero is lifted above the documentation shell and spans the viewport on its tool canvas, capped at `1280px`. Everything else stays in the centered `46rem` reading column with a `1.25rem` gutter, `2rem` section rhythm, and `4rem` lower breathing room. At `40rem`, navigation wraps and the main gutter tightens to `1rem`. Index cards use an auto-fitting grid with a `15rem` minimum; explanatory tables scroll horizontally when needed.

Copy follows an evidence-first sequence: mechanism image, plain-language H1, two-command run path, ownership model, real RED/GREEN replay plus selectable transcript, adapter choices, adoption ratchet, pull-request wiring, evidence boundary, credibility ledger, and deeper references. Keep “verified here” and “not established” adjacent; first-party mechanism evidence must never visually masquerade as independent validation.

**The Recompose, Do Not Shrink Rule.** When graph labels or branches stop scanning comfortably, author a meaning-equivalent narrow composition and switch it with `<picture>`.

**The One Product Moment Rule.** The header demonstrates one consequence completely; do not scatter the first viewport into equal-weight feature tiles or multiple competing demos.

## Elevation & Depth

The system is flat by design. It uses no shadows in diagrams or in the documentation shell. Depth comes from tonal separation, thin borders, the terminal replay's darker title bar, and the spatial hierarchy of nodes and paths. Hover affordances in the docs site rely on text color, weight, or anchor visibility rather than lift.

**The Flat Evidence Rule.** Evidence should look inspectable and literal. Never make a verdict feel more credible with glow, glass, bevel, drop shadow, or simulated material.

## Shapes

Engine nodes are square or barely softened: `3px` on the desktop spine and `4px` on mobile and the adoption ratchet. Documentation containers use restrained `4–6px` corners; the terminal replay alone may use `8px` to preserve the familiar window frame. Badges may keep their native shield geometry, but do not introduce pill-shaped product UI.

Graph routes are orthogonal and functional. Default borders are approximately `1.5–2px`; active mobile routes may rise to roughly `2.7px` for legibility. Arrowheads appear only where sequence or return direction matters. Solid cyan carries forward execution, solid green and red carry outcomes, dashed red carries the code-fix loop, and dashed steel carries governance or downgrade review. Lines may bend around content, but they may not cross labels or imply a policy change is an automatic agent repair.

**The Functional Arrow Rule.** Every arrow must explain ordering, branching, correction, or governance; delete any arrow that only decorates empty space.

## Components

### Header Product Moment

The signature component pairs one outcome-led promise with a compact, believable pull-request check. Preserve the distinction between the human-owned blueprint and agent-produced change, their convergence at the BCE gate, and the exact blocking diagnosis. Keep CLI, GitHub Action, and MCP visible as supported surfaces without turning them into competing calls to action.

### Responsive Diagram

Each desktop/mobile pair is one semantic component. Keep both files updated together and wire them through a GitHub-safe `<picture>` with exactly one local mobile `<source>` before one accessible desktop `<img>` fallback. The generated docs renderer deliberately accepts only that narrow construct and copies referenced SVGs byte-for-byte; do not add arbitrary HTML attributes or multiple sources without updating and testing the fail-closed renderer.

### Adoption Ratchet

Show advisory, shrink-only baseline, and enforced in forward order. Cyan connects progress; green marks enforced; the reverse path is dashed steel and explicitly requires reviewed rationale. Never render downgrade as a symmetric, effortless toggle.

### Terminal Replay

The terminal is an exact product proof. Its base state contains the complete transcript, then a short linear reveal adds motion; a non-animating renderer must still show all lines. Under `prefers-reduced-motion: reduce`, hold the transcript still and hide the cursor. The README must repeat the same output as selectable text directly below the animation.

### Documentation Shell

Use one local stylesheet and no external font or asset request. Body copy, navigation, code blocks, blockquotes, tables, and section cards remain modest and native. Light/dark themes switch the shell tokens, while the engine visuals keep their own stable dark canvas. Code blocks and tables favor exactness and horizontal scrolling over visual compression.

### Evidence Boundary

Lead the section with one plain statement separating mechanism evidence from causal efficacy. Follow with a balanced “Verified here / Not established” comparison, then the current study limitation and source links. Credibility counts and citation state must derive from their records when the docs build supports that derivation; do not hand-copy volatile proof claims into decorative callouts.

All explanatory SVGs require `role="img"`, an `aria-labelledby` pair, and meaningful `<title>` and `<desc>` content. README fallback images require prose-quality `alt` text. Color is always reinforced by labels, exit codes, route shape, and position.

## Do's and Don'ts

### Do:

- **Do** make the real engine path, command, verdict, or diagnostic the visual subject.
- **Do** keep cyan, green, red, and steel tied to their semantic roles.
- **Do** update desktop and mobile SVG variants as one component and verify both compositions.
- **Do** preserve governance and correction as visibly distinct branches.
- **Do** pair animated or diagrammatic proof with equivalent accessible text and honor reduced motion.
- **Do** state evidence provenance and unmeasured outcomes near the claims they qualify.

### Don't:

- **Don't** replace the engine with generic feature cards, dashboard widgets, fake charts, decorative terminals, or abstract illustration.
- **Don't** use gradients, glassmorphism, glow, shadows, oversized pills, ornamental arrows, or borrowed product styling.
- **Don't** shrink the desktop graph until labels become unreadable; recompose it for the narrow viewport.
- **Don't** turn commands, diagnostics, or transcripts into image-only content.
- **Don't** imply that agents may amend policy through the same loop that repairs code.
- **Don't** invent customers, testimonials, awards, benchmarks, efficacy results, independent validation, or paper-like authority.
