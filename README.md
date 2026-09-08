<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="assets/bce-banner-mobile.svg">
    <img src="assets/bce-banner.svg" alt="bce — architecture that holds while agents move fast. A human-owned blueprint and an agent code change enter the BCE gate. The gate catches a forbidden dependency, names its source line, and blocks the merge.">
  </picture>
</p>

# Check architectural boundaries in agent-written code

`bce` gives coding agents a local, deterministic architecture check. A versioned
`EngineeringBlueprint` records the repository's structural rules. Agents draft those rules from
your intent, inspect the code, and repair violations; the same engine checks every pull request.
Humans own the intent and approve policy changes. Agents operate the day-to-day loop.

**Released support (`v0.3.0`):** TypeScript/JavaScript framework-surface AST extraction,
direct TypeScript/JavaScript module boundaries, a Python import-surface MVP, and structured Python
module boundaries. Node 22+ is required; the contract remains pre-1.0.

**Evidence boundary:** a score of 100 means the implemented checks passed over the observed
surface. Route guard checks find governed call sites; they do not prove authorization, tenant
isolation, or execution on every path. See the [route evidence limits and correction](docs/first-win.md#route-guard-evidence-boundary),
including the export forms missed by the immutable v0.3.0 release. Start with a bounded pilot and
verify realistic violations in your own repository.

<!-- award-slot: reserved. Activate only in a PR that links an award actually won. -->

<p align="center">
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml/badge.svg" alt="self-gate workflow status"></a>
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml/badge.svg" alt="continuous integration workflow status"></a>
  <img src="assets/badges/tests.svg" alt="tests: 1039">
</p>

[Watch BCE govern its own main branch](https://blueprint-conformance.github.io/bce/trust/#self-adoption-status): live GitHub stages, authenticated self-adoption, and explicit evidence boundaries.

## Watch the context move

<p align="center">
  <a href="https://blueprint-conformance.github.io/bce/films/#context-spectrum"><img src="https://github.com/blueprint-conformance/bce/releases/download/media-2026-09-07/context-spectrum-preview.gif" alt="Animated preview of the architectural zoom from services to components and code. Open the complete interactive C1–C4 context spectrum."></a>
</p>

[Explore the interactive C1–C4 spectrum](https://blueprint-conformance.github.io/bce/assets/films/context-spectrum/index.html) · [Watch the films](https://blueprint-conformance.github.io/bce/films/) · [Read the static overview](docs/films.md)

Follow context narrowing into work, inherited rules surviving the zoom, and findings returning as
evidence for review. This illustrates the wider **reference architecture**; it is not a claim that
the complete platform loop is released in BCE. C1–C4 here means architectural zoom levels, distinct
from the engine’s constraint type identifiers. The brief preview plays once; the full film and
interactive experience have playback controls.

## Start with your coding agent

Give your existing agent this task:

```text
Read https://blueprint-conformance.github.io/bce/llms.txt and its agent start guide.
Inspect this repository and identify one supported architecture boundary from our stated intent.
Use BCE to draft the rule, prove a real RED → code fix → GREEN, and wire the local agent loop.
Keep setup advisory and present policy changes for my review. Report unsupported scope explicitly.
```

[The agent start guide](docs/agent-start.md) routes an existing gated repository straight to MCP
`run_gate {}` and a new repository to local authoring and onboarding. Your current agent can do
this with its own tools; BCE needs no additional model account for that path. The blueprint
inspection tools and review cockpit let humans examine the same contract and evidence.

## Run a real gate

Three commands. No account, hosted service, API key, or repository setup:

```bash
npm view bce-engine@0.3.0 version dist.integrity
npm install --save-dev --save-exact bce-engine@0.3.0
npx --no-install bce demo
```

The released demo runs one conforming tree and one drifted tree. List six targeted recipes for
extension registration, tenant access, egress, TypeScript and Python module layering, and
configuration widening, then run the boundary closest to your repository:

```bash
npx --no-install bce demo --list
npx --no-install bce demo --recipe module-layering
```

[Run the released First Win recipes](docs/first-win.md), or keep the zero-argument proof above.

## The architecture package

One checked-in blueprint defines the intended components, relationships, and boundaries. BCE
extracts the repository it received, compares the two, and returns one deterministic verdict.

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="assets/bce-architecture-package-mobile.svg">
    <img src="assets/bce-architecture-package.svg" alt="A checked-in EngineeringBlueprint defines four architecture constraints. BCE compares them with an observed plugin graph. The required component, governed registration, and path boundary pass; an axios import violates C3 and produces an exact blocking diagnosis at src/greeting.plugin.ts line 16.">
  </picture>
</p>

These are the specification's first four enforcing types: **C1 `requiredComponent`** requires a
real `pluginSurface`; **C2 `requiredDependency`** requires its governed registration edge;
**C3 `forbiddenDependency`** rejects the `axios` import; and **C4 `forbiddenPath`** keeps extracted
components out of `src/legacy/**`. The taxonomy has four more enforcing types and three explicit
reserved types—[open the C1–C4 visual guide](docs/constraint-guide.md) or
[read the exact semantics](spec/SPEC.md#3-constraint-taxonomy--11-types).

In `v0.3.0`, the AI-first review surface's `bce propose` writes an immutable draft
packet to quarantine; the model cannot approve or land policy. [Read the review
ceremony](docs/ai-first-review.md).

## See the gate discriminate

This excerpt is cut from a live engine run on every push. It keeps the decisive lines selectable
while the [full transcript](docs/launch/hero-demo.txt) retains every emitted detail.

<p align="center">
  <img src="assets/hero-cast.svg" alt="Animated terminal replay of BCE running the same architectural rule against a drifted tree and a corrected tree. The first run names the forbidden axios edge at src/greeting.plugin.ts line 16 and exits 1; the second scores 100 and exits 0. The exact output remains selectable below.">
</p>

```console
$ bce gate --repo drift --blueprint-dir blueprint --extractor ast --all
::error::    - [no-direct-http-client/critical] extension:greeting.plugin
        observed: forbidden edge extension:greeting.plugin -> axios is present
        at:       src/greeting.plugin.ts#L16
bce gate [enforced]: 1/1 blueprint(s) evaluated, 1 failing.
$ echo $?
1

$ bce gate --repo clean --blueprint-dir blueprint --extractor ast
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
$ echo $?
0
```

CI derives those lines from real RED and GREEN runs and rejects byte drift. The
[proof contract](tests/root-readme-proof.test.ts) also verifies the complete recording and visual
replay against the engine.

## One engine, three entry points

Use the **CLI** for local feedback, the pinned **GitHub Action** at the merge boundary, or ten
read-only **MCP tools** inside an agent loop. They share the same extraction, evaluation, report,
and exit-code path; policy changes remain outside MCP. The released Action source is pinned to
`blueprint-conformance/bce@9fe4a02d39c05dbdf280b359e9b364de84e1eda8`.

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="assets/bce-agent-skill-loop-mobile.svg">
    <img src="assets/bce-agent-skill-loop.svg" alt="The BCE Agent Skill loads on demand and directs an agent to change source code, call the read-only run_gate tool, use the exact RED diagnosis to fix source code without editing policy, and call the same gate again until it returns GREEN. A human-owned EngineeringBlueprint supplies the unchanged contract to both runs.">
  </picture>
</p>

The Agent Skill loads these instructions on demand, prefers the read-only `run_gate {}` tool, fixes
source code on RED, and re-runs the same contract. [Inspect the skill](skills/README.md),
[wire the done-check](docs/agent-loop.md), or [follow ordered onboarding](docs/onboarding.md).

## Adopt without freezing the repository

<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="assets/bce-flow-mobile.svg">
    <img src="assets/bce-flow.svg" alt="BCE adoption ratchet. Advisory mode exposes current drift. A shrink-only baseline allows known debt to disappear but not grow. Enforced mode blocks new violations. Moving backward requires a visible, reviewed rationale.">
  </picture>
</p>

Start in advisory mode, capture known debt in a shrink-only baseline, then enforce the same verdict.
The mode is committed policy—not a skip flag—and moving backward requires a reviewed rationale.
[Read the brownfield adoption guide](docs/adopt-existing-repo.md).

## Evidence and limits

**Mechanism evidence is strong; causal product benefit is not established.** This repository has
a generated suite whose current count is shown above, replayed RED/GREEN fixtures, 47/47 killed
self-blueprint mutants, deterministic reports,
and cross-platform CI. Those are first-party proofs on author-controlled infrastructure;
[independent witnesses remain 0](ATTESTATIONS.md).

Accelerated pilot v6 retained all 16 paired attempts in one exact local model/client cell. Its
author-operated record contains useful directional observations, including 2/8 versus 3/8 safe
successful completions, but it is permanently ineligible for a product decision. One baseline
infrastructure timeout remains in the intention-to-treat denominator. The Evidence Foundry v3
primary stage—120 paired tasks and 240 retained attempts—has not run; its later transport stages are
separately gated. We do not claim that BCE makes agents more successful, cheaper, faster, or safer than a baseline.
[Inspect and replay the public evidence](https://blueprint-conformance.github.io/bce/trust/),
[check the public truth ledger](STATUS.md), or
[inspect the study contract](research/model-evaluation/README.md).

<!-- fleet-record:begin -->
<!-- Private fleet telemetry is intentionally excluded from public capability claims. -->
<!-- fleet-record:end -->

## Start with your repository

The `v0.3.0` release contains six packaged architecture recipes. Run one, then adapt it with a
measured authoring walkthrough for an empty repository, plain JavaScript, TypeScript, a monorepo,
or direct module layering: **[choose the boundary that must hold](docs/first-win.md)**. The measured
test keeps every layout's author → RED → fix → GREEN first win in under 60 seconds, including
loaded-runner contention.

Specification: [blueprint-conformance/v1alpha1](spec/SPEC.md) · Agent loop:
[MCP and agent workflow](docs/agent-loop.md) · Documentation:
[blueprint-conformance.github.io/bce](https://blueprint-conformance.github.io/bce/)

**Source candidate: v0.3.1.** This stages the route-inventory correction and makes its
call-site evidence limit visible in the terminal. The registry release remains v0.3.0 until the
candidate passes the release workflow and the published artifact is verified. Check availability
before choosing an install target:

```bash
npm view bce-engine@0.3.1 version dist.integrity
```

The v0.3.1 candidate also packages the previously merged offline review preparation, explicit
solo-steward lifecycle, and local specification; these remain absent from immutable v0.3.0.

**Current registry release: v0.3.0.** Its exact npm integrity is
`sha512-KwWyEYOZu70xrQG5JYEyHNhz3eqTalno9d9+KUugytYBiWtHGO7Wpa+X/7xgi9xDc49V7OUchTJtN8Pu8T37iw==`,
and its source/Action commit is `9fe4a02d39c05dbdf280b359e9b364de84e1eda8`. The canonical GitHub
Release is immutable with the exact tarball, signed payload manifest, signed EvidenceRecord, and
compliance report attached. [Read the verification and incident record](docs/release-v0.3.0.md).
Compatibility remains pre-1.0.

Apache-2.0 — [license](LICENSE), [notice](NOTICE), and [trademarks](TRADEMARKS.md).
