# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary user (inferred from the public repository, onboarding material, and the user's brief): a staff/principal engineer, architect, or OSS maintainer responsible for keeping architecture coherent while coding agents make changes quickly.
- Secondary user (inferred): an AI coding agent that needs a deterministic, machine-readable done-check and a precise repair path.

## Product Purpose

bce turns a versioned architecture blueprint into a deterministic conformance verdict. It exists so humans can state structural boundaries once, agents can work normally, and pull requests cannot quietly merge architecture drift. The public repository succeeds when a first-time technical visitor understands that mechanism, can run a real RED/GREEN proof immediately, and can judge the evidence without mistaking first-party verification for independent validation.

## Positioning

The distinguishing mechanism is a fail-closed, local-first architecture gate that evaluates code against a reviewed blueprint outside the generation path. The same engine serves the CLI, GitHub Action, MCP tools, and Agent Skills; policy changes stay visible in version control rather than becoming hidden prompt instructions.

## Operating Context

- Agent-heavy repositories where code generation outpaces manual architectural review.
- Local terminals, pull-request checks, MCP-enabled coding-agent sessions, and offline evidence verification.
- Brownfield adoption through advisory mode, a shrink-only baseline, and explicit graduation to enforcement.
- Public evaluation by technically skeptical readers who expect exact commands, source-linked evidence, and plainly stated limitations.

## Capabilities and Constraints

- Node 22 or newer; the released package is `bce-engine@0.2.0`.
- TypeScript/JavaScript framework AST extraction is the mature released path. The v0.3.0 source candidate adds direct TypeScript/JavaScript and structured Python module graphs while preserving the released Python import-surface profile.
- Validation, extraction, gating, MCP discovery, and evidence verification work without a hosted service after installation.
- Critical unsupported analysis, missing rules, unsafe paths, and unknown constraints fail closed.
- GitHub README rendering constrains the public surface to portable Markdown, HTML supported by GitHub, and repository-owned assets.
- Product efficacy is not established. The held-out, provider-identified 240-trial confirmatory study has not run, and the public page must not claim improved agent success, cost, latency, or safety.
- Independent witnesses remain at zero until an external party records a run.

## Brand Commitments

- The product name is lowercase `bce`; expand it as “blueprint conformance engine” when context requires.
- Voice is direct, technically literate, calm, and falsifiable. Prefer concrete mechanics over superlatives.
- Preserve the visible distinction between human-owned policy, agent-produced change, deterministic judgment, and reviewed policy amendment.
- The GitHub page must feel human-facing and immediately legible, not like a scientific paper or a generic SaaS landing page.
- Visuals must explain real relationships and outcomes. Graph structure is information, not decoration.
- The chosen public direction is a clean, authentic tool surface: real commands, real verdicts, and real diagnostics set the craft bar. Avoid borrowed product styling, metaphor-heavy art direction, and ornamental polish.

## Evidence on Hand

- Live RED/GREEN transcript and byte-for-byte proof: `docs/launch/hero-demo.txt`, `tests/root-readme-proof.test.ts`, and `scripts/hero-demo-record.mjs`.
- Self-gate and mutation evidence: `.blueprints/`, `extractor-teeth-report.json`, and the repository workflows.
- Public claim ledger: `STATUS.md`.
- Reproducible model-evaluation pilot and explicit limits: `research/model-evaluation/pilots/accelerated-v3/RESULTS.md` and `research/model-evaluation/README.md`.
- External but creator-maintained Action witness: `https://github.com/blueprint-conformance/bce-action-witness`.
- Independent attestation ledger, currently zero: `ATTESTATIONS.md`.
- No testimonials, customer logos, independent benchmarks, peer-reviewed paper, DOI, or causal efficacy result may be invented.

## Product Principles

1. Demonstrate the gate before explaining the framework.
2. Make policy changes visible and code repairs actionable.
3. Label first-party mechanism evidence and unmeasured outcomes separately.
4. Let agents move fast without placing a model or hosted service in the decision path.
5. Prefer a reproducible contradiction over an untestable promise.

## Accessibility & Inclusion

The public surface must remain understandable without animation or color alone, provide meaningful alternative text for every explanatory visual, preserve selectable command/output text, and work in GitHub's light and dark themes at narrow and wide viewport sizes.
