<p align="center">
  <picture>
    <source media="(max-width: 600px)" srcset="assets/bce-banner-mobile.svg">
    <img src="assets/bce-banner.svg" alt="bce — architecture that holds while agents move fast. A human-owned blueprint and an agent code change enter the BCE gate. The gate catches a forbidden dependency, names its source line, and blocks the merge.">
  </picture>
</p>

# Architecture rules your agents cannot quietly break

`bce` is a local, deterministic merge gate for software architecture. You check a versioned
`EngineeringBlueprint` into the repository; each change must conform or return an exact reason it
cannot merge.

**Support:** TypeScript/JavaScript AST extraction is mature; Python import-graph extraction is MVP;
Node 22+ is required; the contract remains pre-1.0.

<!-- award-slot: reserved. Activate only in a PR that links an award actually won. -->

<p align="center">
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml/badge.svg" alt="self-gate workflow status"></a>
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml/badge.svg" alt="continuous integration workflow status"></a>
  <img src="assets/badges/tests.svg" alt="tests: 851">
</p>

## Run a real gate

Two commands. No account, hosted service, API key, or repository setup:

```bash
npm install --save-dev --save-exact bce-engine@0.1.5
npx --no-install bce demo
```

The packaged demo runs one conforming tree and one drifted tree. To reach the same first win on
your code in under 10 seconds, [choose your repository shape](docs/first-win.md).

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
reserved types—[read the exact semantics](spec/SPEC.md#3-constraint-taxonomy--11-types).

On a release that includes the AI-first review surface, `bce propose` writes an immutable draft
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
`blueprint-conformance/bce@3611709acf0dace4698dd1876f835a73ec44837b`.

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
851 tests, replayed RED/GREEN fixtures, 45/45 killed self-blueprint mutants, deterministic reports,
and cross-platform CI. Those are first-party proofs on author-controlled infrastructure;
[independent witnesses remain 0](ATTESTATIONS.md).

The accelerated model pilot proved the evaluation machinery runs, but its easy tasks saturated both
arms. The held-out 240-trial study has not run. We do not yet claim that BCE makes agents more
successful, cheaper, faster, or safer than a baseline. [Check the public truth ledger](STATUS.md) or
[inspect the study contract](research/model-evaluation/README.md).

<!-- fleet-record:begin -->
<!-- Private fleet telemetry is intentionally excluded from public capability claims. -->
<!-- fleet-record:end -->

## Start with your repository

Choose the closest shape—empty repo, plain JavaScript, TypeScript, or monorepo—and follow one
measured path from install to a real RED, correction, and GREEN: **[choose your repository
shape](docs/first-win.md)**.

Specification: [blueprint-conformance/v1alpha1](spec/SPEC.md) · Agent loop:
[MCP and agent workflow](docs/agent-loop.md) · Documentation:
[blueprint-conformance.github.io/bce](https://blueprint-conformance.github.io/bce/)

**Status: v0.1.5 released.** The npm package has provenance. Its historical tag is mutable;
repository-level release immutability now protects future releases. Compatibility remains pre-1.0.

Apache-2.0 — [license](LICENSE), [notice](NOTICE), and [trademarks](TRADEMARKS.md).
