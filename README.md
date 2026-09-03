<p align="center">
  <img src="assets/bce-banner.svg" alt="bce — architecture that holds while agents move fast. A blueprint and an agent pull request converge on the BCE gate, which catches a forbidden dependency and blocks the merge.">
</p>

# Architecture rules your agents cannot quietly break

> **bce turns architecture decisions into a deterministic merge gate.** Define the boundary once,
> let agents move at full speed, and catch structural drift before it becomes your next refactor.

<!-- award-slot: RESERVED, and deliberately inert.
     A chip goes live ONLY when the thing is actually won, in a PR that links the award —
     never as a decoration that rides along with an unrelated change. The promise
     `readme/award-slots` in scripts/launch-readiness-check.mjs refuses any chip that appears
     outside this comment, so activation cannot happen by accident.
<p align="center">
  <a href="AWARD-URL"><img src="assets/badges/award-PLACEHOLDER.svg" alt="AWARD-NAME"></a>
</p>
-->

<p align="center">
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/self-gate.yml/badge.svg" alt="self-gate workflow status"></a>
  <a href="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml"><img src="https://github.com/blueprint-conformance/bce/actions/workflows/ci.yml/badge.svg" alt="continuous integration workflow status"></a>
  <img src="assets/badges/tests.svg" alt="tests: 788">
  <img src="assets/badges/license.svg" alt="license: Apache-2.0">
  <img src="assets/badges/docs.svg" alt="docs: zero-dep">
  <img src="assets/badges/node.svg" alt="node: >=22">
  <img src="assets/badges/any-agent.svg" alt="any agent: CLI · Action · MCP">
</p>

**[Quick start](#get-your-first-red-in-seconds) · [Watch it work](#watch-the-gate-do-its-job) · [Choose your surface](#one-engine-every-surface) · [Adopt safely](#start-advisory-grow-teeth) · [Trust and evidence](#proof-not-promises) · [Docs](#go-deeper)**

## The agent writes. BCE decides what may merge.

| 1 · Define the shape | 2 · Let agents build | 3 · Keep the boundary |
|---|---|---|
| Write a small, versioned JSON blueprint for the architecture you intend. | Humans and agents keep using their normal tools. BCE does not sit in the generation path. | The same deterministic engine runs locally, through MCP, and on every pull request. |
| Rules live beside the code and change by review. | No hosted service, prompt proxy, or model dependency. | Conforming changes can merge. Drift gets an exact file, line, violated rule, and non-zero exit. |

No architecture slide deck to keep synchronized. No second policy engine for agents. No green check
that means “the command ran” while a forbidden edge slipped through.

<p align="center">
  <img src="assets/bce-flow.svg" alt="How BCE fits into the agent loop: a human-owned blueprint and an agent code change enter the deterministic BCE gate. Conforming changes merge; drift gets a precise diagnosis and loops back for correction. Policy amendments return to human review.">
</p>

## Get your first RED in seconds

Install the exact verified release on Node 22 or newer, then run the packaged offline proof:

```bash
npm install --save-dev --save-exact bce-engine@0.1.5
npx --no-install bce demo
```

That is a real GREEN/RED discrimination with no repository setup, account, or API key. When you are
ready to use your own code, **author a contract, catch a real violation, and go green on your own
repo in under 10 seconds.** The four supported starting shapes are timed in CI; this is a regression
ceiling on local fixtures, not an independent performance benchmark.

[Pick your repository shape](docs/first-win.md) · [Run the five-minute walkthrough](docs/quickstart.md) · [Onboard the complete stack](docs/onboarding.md)

## Watch the gate do its job

One forbidden import, caught at the moment it matters:

| Without BCE | With BCE |
|---|---|
| The agent adds `import axios` to a plugin. It compiles and its tests pass. | BCE refuses `no-direct-http-client`, names `src/greeting.plugin.ts#L16`, and exits 1. |
| A reviewer has to notice one architectural edge inside a large diff. | The pull request gets the violated rule, observed edge, expected shape, and both repair paths. |
| The rule survives only while somebody remembers it. | Fix the code or amend the blueprint visibly. Nothing weakens in silence. |

<p align="center">
  <img src="assets/hero-cast.svg" alt="Animated terminal replay: bce gate runs against the drifted tree and fails with exit code 1, naming the forbidden edge extension:greeting.plugin to axios at src/greeting.plugin.ts line 16; it then runs against the corrected tree and passes with exit code 0. The same transcript follows as selectable text.">
</p>

### Copyable, replayable, kept honest by CI

```console
$ bce gate --repo drift --blueprint-dir blueprint --extractor ast --all
::error::blueprint no-direct-http-client@0.1.0 FAILED — score 60: 1 NEW violation(s). 1 constraint(s) evaluated; 1 violation(s); score 60
::error::  no-direct-http-client (critical): 1 violation(s)
::error::    - [no-direct-http-client/critical] extension:greeting.plugin
        observed: forbidden edge extension:greeting.plugin -> axios is present
        expected: no axios edge
        at:       src/greeting.plugin.ts#L16
      fix: change the code to satisfy 'no-direct-http-client'  |  amend: if the rule is wrong, edit/remove 'no-direct-http-client' in the blueprint via PR
bce gate [enforced]: 1/1 blueprint(s) evaluated, 1 failing.
$ echo $?
1

$ bce gate --repo clean --blueprint-dir blueprint --extractor ast
  ✓ no-direct-http-client@0.1.0 — score 100 (pass)
bce gate [enforced]: 1/1 blueprint(s) evaluated, 0 failing.
$ echo $?
0
```

Both runs are re-executed on every push and checked byte-for-byte against this page. The animation
contains the same selectable transcript, so neither the demo nor the drawing can quietly become
marketing fiction. [See the proof test](tests/root-readme-proof.test.ts) or [regenerate the recording](scripts/hero-demo-record.mjs).

## One engine, every surface

| CLI | GitHub Action | MCP + Agent Skills |
|---|---|---|
| Author, validate, scan, prove teeth, and gate from a terminal or script. | Install one immutable action and make conformance a required pull-request check. | Give compatible agents six typed, read-only tools plus the workflow for using them correctly. |
| Best for local feedback and CI outside GitHub. | Best for merge enforcement and a visible policy history. | Best for diagnosis and correction inside an agent loop; policy changes stay outside MCP. |

The adapters do not reimplement policy. They all consume the same engine, blueprint, report
contract, and exit codes.

### Designed for agent-heavy repositories

| Fail closed | Works offline | Evidence you can replay |
|---|---|---|
| Missing rules, unsupported critical analysis, unsafe paths, and unknown constraints refuse instead of passing. | After installation, validation, extraction, gating, evidence verification, and MCP discovery need no network. | Optional hash-chained records can be re-derived with a zero-dependency verifier. |
| **Brownfield friendly** | **Language-aware** | **Self-hosted** |
| Start advisory, baseline existing debt without hiding it, then graduate one way to enforcement. | Full TypeScript/JavaScript AST extraction plus a Python import-graph MVP behind one provider seam. | BCE gates its own repository with the same public action and engine path adopters receive. |

## Start advisory. Grow teeth.

Existing repositories should not receive an unreviewed wall of red on day one. BCE makes adoption
a visible progression:

1. **Advisory** — score and report everything while the team learns the boundary.
2. **Shrink-only baseline** — accept known debt explicitly; new violations block and old debt can
   disappear but cannot silently grow.
3. **Enforced** — `bce graduate` records the decision and turns the same verdict into a merge gate.

The mode is committed policy, never a convenient CLI flag. A downgrade requires a recorded
rationale. [Adopt BCE on a living repository](docs/adopt-existing-repo.md).

## Put it on every pull request

`bce onboard` generates the full workflow plus agent context, project skills, and project-local MCP
configuration. The core Action wiring is deliberately small:

```yaml
# .github/workflows/blueprint-conformance.yml
name: blueprint conformance
on: [pull_request]
jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
        with: { fetch-depth: 0 }
      - uses: blueprint-conformance/bce@3611709acf0dace4698dd1876f835a73ec44837b
        with:
          repo: .
          engine: bce-engine@0.1.5
```

Both executable surfaces are exact pins. The comment may be readable; the SHA and package version
are what run. [Follow the ordered onboarding path](docs/onboarding.md).

## Proof, not promises

| Verified in this repository | Deliberately not claimed |
|---|---|
| 788 tests; GREEN/RED fixtures; 38/38 self-blueprint mutants killed through the production path. | Completeness against every possible architectural defect. |
| Self-gating, clean-consumer installs, deterministic reports, restricted-network operation, and Ubuntu/macOS/Windows × Node 22/24 CI. | Independent confirmation merely because author-controlled automation is green. |
| A sealed eight-attempt model-evaluation pilot whose public evidence replays exactly. Both arms completed and both scored 4/4 on the easy pilot tasks. | That BCE makes agents more successful, cheaper, faster, or safer than a baseline. The pilot saturated and cannot estimate uplift. |
| Agent Skills and MCP discovery, routing, and correction mechanics. | A model success rate or proof that agents reliably choose the BCE mechanism in the wild. |

The product-efficacy line is explicit: the evaluation apparatus now works, but the held-out,
provider-identified 240-trial confirmatory study has not run. The accelerated pilot observed no
skill reads, no MCP calls, one model-initiated BCE gate call, and no trustworthy cost data. Read the
[pilot result](research/model-evaluation/pilots/accelerated-v3/RESULTS.md), the [canonical study contract](research/model-evaluation/README.md), or the complete [claim ledger](STATUS.md).

<!-- fleet-record:begin -->
<!-- Private fleet telemetry is intentionally excluded from public capability claims. -->
<!-- fleet-record:end -->

## Credibility

Every proof above is produced by machinery in this repository, run on infrastructure its authors
control, from code its authors wrote. That is useful first-party evidence. It is not independent
confirmation.

- **Independent witnesses: 0.** [ATTESTATIONS.md](ATTESTATIONS.md) is intentionally public at zero.
  The [one-minute witness kit](docs/launch/witness-kit.md) records contradictions too, because a
  falsifying run is more valuable than another self-issued badge.
- **External execution exists, but remains creator-maintained.** The public
  [consumer repository](https://github.com/blueprint-conformance/bce-action-witness) records clean
  GREEN, planted drift blocking the enforced workflow, and GREEN after correction. That proves the
  Action crosses repository boundaries; it is not an independent adoption.
- **Citation metadata is software-only.** [CITATION.cff](CITATION.cff) invents no paper, DOI, or
  arXiv identifier. Those appear only after real archival records exist.

If BCE is useful in your repository, star it. That is one signal its authors cannot manufacture.

## Go deeper

| Goal | Start here |
|---|---|
| Understand the contract model | [Specification](spec/SPEC.md) · [JSON Schemas](spec/schemas) · [Conformance vectors](spec/conformance-vectors) |
| Put BCE inside an agent loop | [Agent loop](docs/agent-loop.md) · [MCP compatibility](docs/mcp-compatibility.md) · [Agent Skills](skills/README.md) |
| Read and verify evidence | [Evidence format](docs/evidence-format.md) · [Report contract](docs/report-contract.md) · [Exit codes](docs/exit-codes.md) |
| Compare alternatives honestly | [Comparison](docs/comparison.md) · [FAQ](docs/faq.md) · [Roadmap](ROADMAP.md) |
| Contribute or report a problem | [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Governance](GOVERNANCE.md) |

Docs site: <https://blueprint-conformance.github.io/bce/>

**Status: v0.1.5 released.** The npm package has provenance and the release evidence is verified.
Its historical tag is mutable; repository-level release immutability now protects future releases,
so executable examples pin the v0.1.5 source commit. The schema remains
`blueprint-conformance/v1alpha1` and compatibility remains pre-1.0.

## License

Apache-2.0 — see [LICENSE](LICENSE), [NOTICE](NOTICE), and [TRADEMARKS.md](TRADEMARKS.md).
